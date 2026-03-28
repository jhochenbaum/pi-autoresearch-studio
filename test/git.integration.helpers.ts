import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync, execSync } from "node:child_process";
import type { Run } from "../src/data/parser.js";

export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface ExecCall {
  cmd: string;
  args: string[];
  cwd?: string;
}

export interface TestRepo {
  rootDir: string;
  repoDir: string;
  remoteDir: string;
}

// Environment overrides to speed up git operations in tests:
// - Skip global/system config lookups
// - Disable gpg signing
// - Set author/committer info via env (avoids git config calls)
// Environment overrides to speed up git operations in tests
const GIT_TEST_ENV: Record<string, string> = {
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "AR Studio Tests",
  GIT_AUTHOR_EMAIL: "arstudio@example.com",
  GIT_COMMITTER_NAME: "AR Studio Tests",
  GIT_COMMITTER_EMAIL: "arstudio@example.com",
  GIT_TERMINAL_PROMPT: "0",
  GIT_OPTIONAL_LOCKS: "0",
};

export function runCommand(command: string, args: string[], cwd: string): CommandResult {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf-8",
    env: { ...process.env, ...GIT_TEST_ENV },
  });
  if (result.error) {
    throw result.error;
  }
  return {
    code: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

export function runGitChecked(cwd: string, args: string[]): string {
  const result = runCommand("git", args, cwd);
  if (result.code !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  }
  return result.stdout.trim();
}

export function createRepo(): TestRepo {
  const rootDir = mkdtempSync(join(tmpdir(), "ar-git-int-"));
  const repoDir = join(rootDir, "repo");
  const remoteDir = join(rootDir, "remote.git");

  mkdirSync(repoDir);

  runGitChecked(rootDir, ["init", "--bare", remoteDir]);

  runGitChecked(repoDir, ["init"]);
  runGitChecked(repoDir, ["checkout", "-b", "main"]);

  writeFileSync(join(repoDir, "README.md"), "base\n", "utf-8");
  runGitChecked(repoDir, ["add", "README.md"]);
  runGitChecked(repoDir, ["commit", "--no-gpg-sign", "-m", "initial"]);

  runGitChecked(repoDir, ["remote", "add", "origin", remoteDir]);
  runGitChecked(repoDir, ["push", "--no-tags", "-u", "origin", "main"]);

  runGitChecked(repoDir, ["checkout", "-b", "feature"]);

  writeFileSync(join(repoDir, "feature-one.txt"), "line 1\n", "utf-8");
  runGitChecked(repoDir, ["add", "feature-one.txt"]);
  runGitChecked(repoDir, ["commit", "--no-gpg-sign", "-m", "feat: first"]);

  writeFileSync(join(repoDir, "feature-two.txt"), "line 2\n", "utf-8");
  runGitChecked(repoDir, ["add", "feature-two.txt"]);
  runGitChecked(repoDir, ["commit", "--no-gpg-sign", "-m", "feat: second"]);

  return { rootDir, repoDir, remoteDir };
}

export function listLocalBranches(repoDir: string): string[] {
  return runGitChecked(repoDir, ["branch", "--format=%(refname:short)"])
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function listRemoteHeads(repoDir: string): string[] {
  const out = runGitChecked(repoDir, ["ls-remote", "--heads", "origin"]);
  return out
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split("\t")[1]?.replace("refs/heads/", "") ?? "")
    .filter(Boolean);
}

export function buildRuns(commitHashesNewestFirst: string[]): Run[] {
  const chronological = [...commitHashesNewestFirst].reverse();
  return chronological.map((hash, i) => ({
    run: i + 1,
    commit: hash,
    metric: 100 - i,
    metrics: {},
    status: "keep",
    description: `run ${i + 1}`,
    timestamp: Date.now(),
    segment: 0,
    confidence: null,
  }));
}

export function makeCtx(confirmResults: boolean[]) {
  const notifications: Array<{ message: string; level: string }> = [];
  return {
    ctx: {
      ui: {
        confirm: async () => confirmResults.shift() ?? true,
        notify: (message: string, level: string) => notifications.push({ message, level }),
      },
    },
    notifications,
  };
}

export function makePi(execCalls: ExecCall[]) {
  let ghCounter = 0;

  return {
    exec: async (cmd: string, args: string[], options?: { cwd?: string }) => {
      execCalls.push({ cmd, args, cwd: options?.cwd });

      if (cmd === "gh") {
        ghCounter += 1;
        return {
          code: 0,
          stdout: `https://example.test/pr/${ghCounter}\n`,
          stderr: "",
        };
      }

      if (cmd === "git") {
        const result = runCommand("git", args, options?.cwd ?? process.cwd());
        return result;
      }

      return { code: 1, stdout: "", stderr: `unsupported command: ${cmd}` };
    },
  };
}

export function copyRepo(templateRepo: TestRepo): TestRepo {
  const rootDir = mkdtempSync(join(tmpdir(), "ar-git-int-"));
  const repoDir = join(rootDir, "repo");
  const remoteDir = join(rootDir, "remote.git");
  execSync(`cp -r "${templateRepo.repoDir}" "${repoDir}" && cp -r "${templateRepo.remoteDir}" "${remoteDir}"`, {
    stdio: "ignore",
  });
  runGitChecked(repoDir, ["remote", "set-url", "origin", remoteDir]);
  return { rootDir, repoDir, remoteDir };
}
