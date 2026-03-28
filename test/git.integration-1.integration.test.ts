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

describe("git integration", () => {
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

  it("getBranchCommits returns feature commits not on main", async () => {
    const execCalls: ExecCall[] = [];
    const pi = makePi(execCalls);

    const commits = await getBranchCommits(pi as never, repo.repoDir);

    expect(commits).toHaveLength(2);
    expect(commits[0].subject).toContain("feat: second");
    expect(commits[1].subject).toContain("feat: first");
    expect(execCalls.some((c) => c.cmd === "git" && c.args.join(" ").includes("main..HEAD"))).toBe(true);
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

  it("consolidated mode creates one PR branch and restores original branch", async () => {
    const { execCalls } = await runMode("consolidated");

    const ghCalls = execCalls.filter((c) => c.cmd === "gh" && c.args[0] === "pr" && c.args[1] === "create");
    expect(ghCalls).toHaveLength(1);

    const localBranches = listLocalBranches(repo.repoDir).filter((b) => b.startsWith("feature-pr-"));
    const remoteHeads = listRemoteHeads(repo.repoDir).filter((b) => b.startsWith("feature-pr-"));
    expect(localBranches).toHaveLength(1);
    expect(remoteHeads).toHaveLength(1);

    const currentBranch = runGitChecked(repo.repoDir, ["branch", "--show-current"]);
    expect(currentBranch).toBe("feature");
  });

  it("stacked mode creates chained PR branches with base arg on later PRs", async () => {
    const { execCalls } = await runMode("stacked");

    const ghCalls = execCalls.filter((c) => c.cmd === "gh" && c.args[0] === "pr" && c.args[1] === "create");
    expect(ghCalls).toHaveLength(2);

    // All PRs now specify --base (first targets current branch, second targets first PR branch)
    expect(ghCalls[0].args.includes("--base")).toBe(true);
    expect(ghCalls[1].args.includes("--base")).toBe(true);

    const localBranches = listLocalBranches(repo.repoDir).filter((b) => b.startsWith("feature-pr-"));
    const remoteHeads = listRemoteHeads(repo.repoDir).filter((b) => b.startsWith("feature-pr-"));
    expect(localBranches).toHaveLength(2);
    expect(remoteHeads).toHaveLength(2);

    const currentBranch = runGitChecked(repo.repoDir, ["branch", "--show-current"]);
    expect(currentBranch).toBe("feature");
  });
});
