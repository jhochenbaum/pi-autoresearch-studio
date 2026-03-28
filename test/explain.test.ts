import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildWinExplanation, getOrGenerateWinExplanation } from "../src/data/explain.js";
import type { Config, Run } from "../src/data/parser.js";

const config: Config = {
  name: "Explain Test",
  metricName: "total_ms",
  metricUnit: "ms",
  bestDirection: "lower",
};

const runs: Run[] = [
  {
    run: 1,
    commit: "aaa1111",
    metric: 100,
    metrics: { secondary: 10 },
    status: "keep",
    description: "baseline",
    timestamp: Date.now(),
    segment: 0,
    confidence: null,
  },
  {
    run: 2,
    commit: "bbb2222",
    metric: 90,
    metrics: { secondary: 9 },
    status: "keep",
    description: "optimize hot loop",
    timestamp: Date.now(),
    segment: 0,
    confidence: 1.5,
  },
];

describe("buildWinExplanation", () => {
  it("returns explanation markdown for a matching commit", () => {
    const text = buildWinExplanation(config, runs, "bbb2222");
    expect(text).toContain("Explain This Experiment — Run #2");
    expect(text).toContain("Commit:");
    expect(text).toContain("optimize hot loop");
    expect(text).toContain("Secondary metric impact");
  });

  it("supports prefix commit matching", () => {
    const text = buildWinExplanation(config, runs, "bbb");
    expect(text).toContain("Run #2");
  });

  it("returns null when commit does not exist", () => {
    expect(buildWinExplanation(config, runs, "deadbeef")).toBeNull();
  });

  it("supports failed experiments (discard/crash)", () => {
    const failed: Run[] = [
      { ...runs[0], run: 1, commit: "aaa1111", status: "keep", metric: 100 },
      { ...runs[1], run: 2, commit: "bbb2222", status: "discard", metric: 110, description: "bad idea" },
      { ...runs[1], run: 3, commit: "ccc3333", status: "crash", metric: 0, description: "crashed" },
    ];

    const discardText = buildWinExplanation(config, failed, "bbb2222");
    expect(discardText).toContain("Status:** discard");

    const crashText = buildWinExplanation(config, failed, "ccc3333");
    expect(crashText).toContain("Status:** crash");
  });

  it("uses higher-is-better direction", () => {
    const higher: Config = { ...config, bestDirection: "higher" };
    const higherRuns: Run[] = [
      { ...runs[0], metric: 100, run: 1, commit: "aaa1111" },
      { ...runs[1], metric: 120, run: 2, commit: "bbb2222" },
    ];
    const text = buildWinExplanation(higher, higherRuns, "bbb2222");
    expect(text).toContain("Direction:** higher is better");
  });
});

describe("getOrGenerateWinExplanation", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "ar-explain-"));
    delete process.env.OPENAI_API_KEY;
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("writes explanation to autoresearch.studio.jsonl and serves from cache", async () => {
    const first = await getOrGenerateWinExplanation(dir, config, runs, "bbb2222");
    expect(first).not.toBeNull();
    expect(first!.cached).toBe(false);
    expect(first!.source).toBe("heuristic");

    const second = await getOrGenerateWinExplanation(dir, config, runs, "bbb2222");
    expect(second).not.toBeNull();
    expect(second!.cached).toBe(true);

    const studioLog = readFileSync(join(dir, "autoresearch.studio.jsonl"), "utf-8");
    expect(studioLog).toContain('"type":"explanation"');
    expect(studioLog).toContain('"commit":"bbb2222"');
  });
});
