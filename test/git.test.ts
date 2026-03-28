import { describe, it, expect } from "vitest";
import { executePR, type PRMode } from "../src/data/git.js";
import type { Config, Run } from "../src/data/parser.js";

interface ExecCall {
  cmd: string;
  args: string[];
}

function makeContext(confirmResults: boolean[]) {
  const notifications: Array<{ message: string; level: string }> = [];
  const confirms: Array<{ title: string; message: string }> = [];

  const ctx = {
    ui: {
      confirm: async (title: string, message: string) => {
        confirms.push({ title, message });
        return confirmResults.shift() ?? true;
      },
      notify: (message: string, level: string) => {
        notifications.push({ message, level });
      },
    },
  };

  return { ctx, notifications, confirms };
}

function makePi(execImpl: (cmd: string, args: string[]) => Promise<{ code: number; stdout: string; stderr: string }>) {
  return {
    exec: execImpl,
  };
}

const config: Config = {
  name: "session",
  metricName: "ms",
  metricUnit: "ms",
  bestDirection: "lower",
};

const runs: Run[] = [
  {
    run: 1,
    commit: "aaa1111",
    metric: 100,
    metrics: {},
    status: "keep",
    description: "first",
    timestamp: Date.now(),
    segment: 0,
    confidence: null,
  },
  {
    run: 2,
    commit: "bbb2222",
    metric: 95,
    metrics: {},
    status: "keep",
    description: "second",
    timestamp: Date.now(),
    segment: 0,
    confidence: null,
  },
];

// getBranchCommits returns newest-first (like `git log`)
const branchCommits = [
  { hash: "bbb2222", subject: "second" },
  { hash: "aaa1111", subject: "first" },
];

describe("executePR cleanup behavior", () => {
  it("does nothing when user cancels initial confirmation", async () => {
    const calls: ExecCall[] = [];
    const pi = makePi(async (cmd, args) => {
      calls.push({ cmd, args });
      return { code: 0, stdout: "ok\n", stderr: "" };
    });

    const { ctx } = makeContext([false]);

    await executePR(
      pi as never,
      "/tmp/repo",
      ["bbb2222", "aaa1111"],
      branchCommits,
      config,
      runs,
      "feature-branch",
      "consolidated" satisfies PRMode,
      ctx as never
    );

    expect(calls).toHaveLength(0);
  });
  it("cleans remote/local branches after stacked failure when user confirms cleanup", async () => {
    const calls: ExecCall[] = [];

    const pi = makePi(async (cmd, args) => {
      calls.push({ cmd, args });

      if (cmd === "git" && args[0] === "cherry-pick" && args[1] === "bbb2222") {
        return { code: 1, stdout: "", stderr: "conflict" };
      }
      if (cmd === "gh") {
        return { code: 0, stdout: "https://github.com/org/repo/pull/1\n", stderr: "" };
      }
      return { code: 0, stdout: "ok\n", stderr: "" };
    });

    const { ctx } = makeContext([true, true]);

    await executePR(
      pi as never,
      "/tmp/repo",
      ["bbb2222", "aaa1111"],
      branchCommits,
      config,
      runs,
      "feature-branch",
      "stacked" satisfies PRMode,
      ctx as never
    );

    const remoteDeletes = calls.filter(
      (c) => c.cmd === "git" && c.args[0] === "push" && c.args[1] === "origin" && c.args[2] === "--delete"
    );
    const localDeletes = calls.filter((c) => c.cmd === "git" && c.args[0] === "branch" && c.args[1] === "-D");

    expect(remoteDeletes.length).toBeGreaterThan(0);
    expect(remoteDeletes.every((c) => c.args[3]?.startsWith("feature-branch-pr-"))).toBe(true);
    expect(localDeletes.length).toBeGreaterThan(0);
  });

  it("keeps partially created branches when cleanup is declined", async () => {
    const calls: ExecCall[] = [];

    const pi = makePi(async (cmd, args) => {
      calls.push({ cmd, args });

      if (cmd === "git" && args[0] === "cherry-pick" && args[1] === "bbb2222") {
        return { code: 1, stdout: "", stderr: "conflict" };
      }
      if (cmd === "gh") {
        return { code: 0, stdout: "https://github.com/org/repo/pull/1\n", stderr: "" };
      }
      return { code: 0, stdout: "ok\n", stderr: "" };
    });

    const { ctx } = makeContext([true, false]);

    await executePR(
      pi as never,
      "/tmp/repo",
      ["bbb2222", "aaa1111"],
      branchCommits,
      config,
      runs,
      "feature-branch",
      "stacked" satisfies PRMode,
      ctx as never
    );

    const remoteDeletes = calls.filter(
      (c) => c.cmd === "git" && c.args[0] === "push" && c.args[1] === "origin" && c.args[2] === "--delete"
    );

    expect(remoteDeletes).toHaveLength(0);
  });

  it("restores original branch after individual mode failure", async () => {
    const calls: ExecCall[] = [];

    const pi = makePi(async (cmd, args) => {
      calls.push({ cmd, args });

      if (cmd === "git" && args[0] === "cherry-pick" && args[1] === "bbb2222") {
        return { code: 1, stdout: "", stderr: "conflict" };
      }
      if (cmd === "gh") {
        return { code: 0, stdout: "https://github.com/org/repo/pull/1\n", stderr: "" };
      }
      return { code: 0, stdout: "ok\n", stderr: "" };
    });

    const { ctx } = makeContext([true, true]);

    await executePR(
      pi as never,
      "/tmp/repo",
      ["bbb2222", "aaa1111"],
      branchCommits,
      config,
      runs,
      "feature-branch",
      "individual" satisfies PRMode,
      ctx as never
    );

    const checkoutsToOriginal = calls.filter(
      (c) => c.cmd === "git" && c.args[0] === "checkout" && c.args[1] === "feature-branch"
    );

    expect(checkoutsToOriginal.length).toBeGreaterThan(0);
  });

  it("creates one PR in consolidated mode and returns to original branch", async () => {
    const calls: ExecCall[] = [];

    const pi = makePi(async (cmd, args) => {
      calls.push({ cmd, args });
      if (cmd === "gh") {
        return { code: 0, stdout: "https://github.com/org/repo/pull/1\n", stderr: "" };
      }
      return { code: 0, stdout: "ok\n", stderr: "" };
    });

    const { ctx } = makeContext([true]);

    await executePR(
      pi as never,
      "/tmp/repo",
      ["bbb2222", "aaa1111"],
      branchCommits,
      config,
      runs,
      "feature-branch",
      "consolidated" satisfies PRMode,
      ctx as never
    );

    const ghCalls = calls.filter((c) => c.cmd === "gh" && c.args[0] === "pr" && c.args[1] === "create");
    expect(ghCalls).toHaveLength(1);

    const finalCheckout = [...calls]
      .reverse()
      .find((c) => c.cmd === "git" && c.args[0] === "checkout" && c.args[1] === "feature-branch");
    expect(finalCheckout).toBeTruthy();
  });
});
