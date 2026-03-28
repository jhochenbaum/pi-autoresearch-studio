import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { rmSync } from "node:fs";
import { executePR, getBranchCommits, type PRMode } from "../src/data/git.js";
import type { Config } from "../src/data/parser.js";
import {
  type TestRepo,
  type ExecCall,
  createRepo,
  copyRepo,
  runGitChecked,
  listLocalBranches,
  listRemoteHeads,
  buildRuns,
  makeCtx,
  makePi,
} from "./git.integration.helpers.js";

const config: Config = {
  name: "Integration Session",
  metricName: "ms",
  metricUnit: "ms",
  bestDirection: "lower",
};

describe("git integration (part 2)", () => {
  let repo: TestRepo;
  let templateRepo: TestRepo;

  beforeAll(() => {
    templateRepo = createRepo();
  });

  afterAll(() => {
    rmSync(templateRepo.rootDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    repo = copyRepo(templateRepo);
  });

  afterEach(() => {
    rmSync(repo.rootDir, { recursive: true, force: true });
  });

  async function runMode(mode: PRMode): Promise<{ execCalls: ExecCall[]; hashes: string[] }> {
    const execCalls: ExecCall[] = [];
    const pi = makePi(execCalls);
    const { ctx } = makeCtx([true]);

    const branchCommits = await getBranchCommits(pi as never, repo.repoDir);
    const hashes = branchCommits.map((c) => c.hash);
    const runs = buildRuns(hashes);

    await executePR(pi as never, repo.repoDir, hashes, branchCommits, config, runs, "feature", mode, ctx as never);

    return { execCalls, hashes };
  }

  it("individual mode creates independent PR branches and restores original branch", async () => {
    const { execCalls } = await runMode("individual");

    const ghCalls = execCalls.filter((c) => c.cmd === "gh" && c.args[0] === "pr" && c.args[1] === "create");
    expect(ghCalls).toHaveLength(2);
    // All PRs now specify --base (targets current branch)
    expect(ghCalls.every((c) => c.args.includes("--base"))).toBe(true);

    const localBranches = listLocalBranches(repo.repoDir).filter((b) => b.startsWith("feature-pr-"));
    const remoteHeads = listRemoteHeads(repo.repoDir).filter((b) => b.startsWith("feature-pr-"));
    expect(localBranches).toHaveLength(2);
    expect(remoteHeads).toHaveLength(2);

    const currentBranch = runGitChecked(repo.repoDir, ["branch", "--show-current"]);
    expect(currentBranch).toBe("feature");
  });

  it("stacked failure with cleanup confirmed removes partial local and remote PR branches", async () => {
    const execCalls: ExecCall[] = [];
    const pi = makePi(execCalls);
    const { ctx } = makeCtx([true, true]);

    const branchCommits = await getBranchCommits(pi as never, repo.repoDir);
    const hashes = ["deadbeef", branchCommits[0].hash];
    const runs = buildRuns([branchCommits[0].hash, branchCommits[1].hash]);

    await executePR(pi as never, repo.repoDir, hashes, branchCommits, config, runs, "feature", "stacked", ctx as never);

    const localBranches = listLocalBranches(repo.repoDir).filter((b) => b.startsWith("feature-pr-"));
    const remoteHeads = listRemoteHeads(repo.repoDir).filter((b) => b.startsWith("feature-pr-"));
    expect(localBranches).toHaveLength(0);
    expect(remoteHeads).toHaveLength(0);

    const currentBranch = runGitChecked(repo.repoDir, ["branch", "--show-current"]);
    expect(currentBranch).toBe("feature");
  });
});
