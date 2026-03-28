import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseJsonl } from "../src/data/parser.js";

describe("parseJsonl", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "ar-test-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns empty results when file does not exist", () => {
    const result = parseJsonl(dir);
    expect(result.configs).toEqual([]);
    expect(result.runs).toEqual([]);
  });

  it("returns empty results for an empty file", () => {
    writeFileSync(join(dir, "autoresearch.jsonl"), "");
    const result = parseJsonl(dir);
    expect(result.configs).toEqual([]);
    expect(result.runs).toEqual([]);
  });

  it("parses a single config line", () => {
    const config = {
      type: "config",
      name: "Test Experiment",
      metricName: "total_µs",
      metricUnit: "µs",
      bestDirection: "lower",
    };
    writeFileSync(join(dir, "autoresearch.jsonl"), JSON.stringify(config) + "\n");
    const result = parseJsonl(dir);
    expect(result.configs).toHaveLength(1);
    expect(result.configs[0].name).toBe("Test Experiment");
    expect(result.configs[0].metricName).toBe("total_µs");
    expect(result.configs[0].bestDirection).toBe("lower");
    expect(result.runs).toEqual([]);
  });

  it("parses run entries", () => {
    const run = {
      run: 1,
      commit: "abc1234",
      metric: 1500,
      metrics: { compile_µs: 400, render_µs: 1100 },
      status: "keep",
      description: "First experiment",
      timestamp: 1700000000,
      segment: 0,
      confidence: null,
    };
    writeFileSync(join(dir, "autoresearch.jsonl"), JSON.stringify(run) + "\n");
    const result = parseJsonl(dir);
    expect(result.configs).toEqual([]);
    expect(result.runs).toHaveLength(1);
    expect(result.runs[0].run).toBe(1);
    expect(result.runs[0].commit).toBe("abc1234");
    expect(result.runs[0].metric).toBe(1500);
    expect(result.runs[0].metrics).toEqual({ compile_µs: 400, render_µs: 1100 });
    expect(result.runs[0].status).toBe("keep");
  });

  it("parses a multi-line file with config and multiple runs", () => {
    const lines = [
      JSON.stringify({ type: "config", name: "Opt", metricName: "ms", metricUnit: "ms", bestDirection: "lower" }),
      JSON.stringify({
        run: 1,
        commit: "aaa1111",
        metric: 100,
        metrics: {},
        status: "keep",
        description: "baseline",
        timestamp: 1,
        segment: 0,
        confidence: null,
      }),
      JSON.stringify({
        run: 2,
        commit: "bbb2222",
        metric: 90,
        metrics: {},
        status: "keep",
        description: "improved",
        timestamp: 2,
        segment: 0,
        confidence: 2.5,
      }),
      JSON.stringify({
        run: 3,
        commit: "ccc3333",
        metric: 95,
        metrics: {},
        status: "discard",
        description: "regression",
        timestamp: 3,
        segment: 0,
        confidence: 1.2,
      }),
    ];
    writeFileSync(join(dir, "autoresearch.jsonl"), lines.join("\n") + "\n");

    const result = parseJsonl(dir);
    expect(result.configs).toHaveLength(1);
    expect(result.runs).toHaveLength(3);
    expect(result.runs[0].status).toBe("keep");
    expect(result.runs[1].metric).toBe(90);
    expect(result.runs[2].status).toBe("discard");
  });

  it("gracefully skips malformed JSON lines", () => {
    const lines = [
      JSON.stringify({ type: "config", name: "X", metricName: "m", metricUnit: "", bestDirection: "higher" }),
      "not valid json {{{",
      "",
      JSON.stringify({
        run: 1,
        commit: "ddd4444",
        metric: 50,
        metrics: {},
        status: "keep",
        description: "ok",
        timestamp: 1,
        segment: 0,
        confidence: null,
      }),
      "another broken line",
    ];
    writeFileSync(join(dir, "autoresearch.jsonl"), lines.join("\n") + "\n");

    const result = parseJsonl(dir);
    expect(result.configs).toHaveLength(1);
    expect(result.runs).toHaveLength(1);
  });

  it("handles multiple config entries (multi-segment)", () => {
    const lines = [
      JSON.stringify({ type: "config", name: "Seg1", metricName: "a", metricUnit: "", bestDirection: "lower" }),
      JSON.stringify({
        run: 1,
        commit: "eee5555",
        metric: 200,
        metrics: {},
        status: "keep",
        description: "s1",
        timestamp: 1,
        segment: 0,
        confidence: null,
      }),
      JSON.stringify({ type: "config", name: "Seg2", metricName: "b", metricUnit: "", bestDirection: "higher" }),
      JSON.stringify({
        run: 2,
        commit: "fff6666",
        metric: 300,
        metrics: {},
        status: "keep",
        description: "s2",
        timestamp: 2,
        segment: 1,
        confidence: null,
      }),
    ];
    writeFileSync(join(dir, "autoresearch.jsonl"), lines.join("\n") + "\n");

    const result = parseJsonl(dir);
    expect(result.configs).toHaveLength(2);
    expect(result.configs[0].name).toBe("Seg1");
    expect(result.configs[1].name).toBe("Seg2");
    expect(result.runs).toHaveLength(2);
    expect(result.runs[0].segment).toBe(0);
    expect(result.runs[1].segment).toBe(1);
  });

  it("ignores lines that are neither config nor run", () => {
    const lines = [
      JSON.stringify({ type: "config", name: "X", metricName: "m", metricUnit: "", bestDirection: "lower" }),
      JSON.stringify({ type: "comment", text: "this is a note" }),
      JSON.stringify({ foo: "bar" }),
    ];
    writeFileSync(join(dir, "autoresearch.jsonl"), lines.join("\n") + "\n");

    const result = parseJsonl(dir);
    expect(result.configs).toHaveLength(1);
    expect(result.runs).toEqual([]);
  });
});
