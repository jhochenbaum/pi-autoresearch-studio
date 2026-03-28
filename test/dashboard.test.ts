import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { visibleWidth } from "@mariozechner/pi-tui";
import { buildDashboard } from "../src/tui/dashboard.js";
import { createMockTheme } from "./helpers.js";

function makeConfig(overrides = {}) {
  return {
    type: "config",
    name: "Test Session",
    metricName: "violations",
    metricUnit: "",
    bestDirection: "lower",
    ...overrides,
  };
}

function makeRun(overrides = {}) {
  return {
    run: 1,
    commit: "abc1234def5678",
    metric: 100,
    metrics: {},
    status: "keep",
    description: "test run",
    timestamp: Date.now(),
    segment: 0,
    confidence: null,
    ...overrides,
  };
}

function writeJsonl(dir: string, lines: object[]) {
  writeFileSync(join(dir, "autoresearch.jsonl"), lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
}

describe("buildDashboard", () => {
  const theme = createMockTheme();
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "ar-dash-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("shows warning when no jsonl exists", () => {
    const result = buildDashboard(dir, theme, 0, 100, 40);
    expect(result.lines.some((l) => l.includes("No autoresearch.jsonl found"))).toBe(true);
    expect(result.rowCommitMap).toEqual([]);
    expect(result.rowStatusMap).toEqual([]);
  });

  it("shows 'No results yet' when config exists but no kept runs", () => {
    writeJsonl(dir, [makeConfig(), makeRun({ status: "crash", metric: 0 })]);
    const result = buildDashboard(dir, theme, 0, 100, 40);
    expect(result.lines.some((l) => l.includes("Waiting for first experiment"))).toBe(true);
  });

  it("returns DashboardResult with all three fields", () => {
    writeJsonl(dir, [makeConfig(), makeRun({ run: 1, commit: "aaa1111" })]);
    const result = buildDashboard(dir, theme, 0, 100, 40);
    expect(result).toHaveProperty("lines");
    expect(result).toHaveProperty("rowCommitMap");
    expect(result).toHaveProperty("rowStatusMap");
    expect(Array.isArray(result.lines)).toBe(true);
    expect(Array.isArray(result.rowCommitMap)).toBe(true);
    expect(Array.isArray(result.rowStatusMap)).toBe(true);
  });

  it("displays experiment name in header", () => {
    writeJsonl(dir, [makeConfig({ name: "Optimize Packwerk" }), makeRun()]);
    const result = buildDashboard(dir, theme, 0, 100, 40);
    expect(result.lines.some((l) => l.includes("Optimize Packwerk"))).toBe(true);
  });

  it("displays BASELINE, CURRENT, BEST stats", () => {
    writeJsonl(dir, [
      makeConfig(),
      makeRun({ run: 1, commit: "aaa1111", metric: 100 }),
      makeRun({ run: 2, commit: "bbb2222", metric: 80, status: "keep" }),
    ]);
    const result = buildDashboard(dir, theme, 0, 120, 40);
    const statsLine = result.lines.find((l) => l.includes("BASELINE"));
    expect(statsLine).toBeDefined();
    expect(statsLine).toContain("CURRENT");
    expect(statsLine).toContain("BEST");
  });

  it("populates rowCommitMap and rowStatusMap for runs", () => {
    writeJsonl(dir, [
      makeConfig(),
      makeRun({ run: 1, commit: "aaa1111", status: "keep" }),
      makeRun({ run: 2, commit: "bbb2222", status: "discard" }),
      makeRun({ run: 3, commit: "ccc3333", status: "crash" }),
    ]);
    const result = buildDashboard(dir, theme, 0, 120, 60);
    // Runs are displayed newest-first
    expect(result.rowCommitMap).toContain("ccc3333");
    expect(result.rowCommitMap).toContain("bbb2222");
    expect(result.rowCommitMap).toContain("aaa1111");
    expect(result.rowStatusMap).toContain("keep");
    expect(result.rowStatusMap).toContain("discard");
    expect(result.rowStatusMap).toContain("crash");
  });

  it("includes segment separators for multi-segment data", () => {
    writeJsonl(dir, [
      makeConfig(),
      makeRun({ run: 1, commit: "aaa1111", segment: 0, status: "keep" }),
      makeRun({ run: 2, commit: "bbb2222", segment: 1, status: "keep" }),
    ]);
    const result = buildDashboard(dir, theme, 0, 120, 60);
    // A segment separator inserts a null in the commit map
    expect(result.rowCommitMap).toContain(null);
  });

  it("shows PR selection count when prChecked is provided", () => {
    writeJsonl(dir, [makeConfig(), makeRun({ run: 1, commit: "aaa1111" }), makeRun({ run: 2, commit: "bbb2222" })]);
    // Row indices: runs are displayed newest-first, so run 2 = row 0, run 1 = row 1
    const prChecked = new Set([0, 1]);
    const result = buildDashboard(dir, theme, 0, 120, 60, prChecked);
    expect(result.lines.some((l) => l.includes("2 selected"))).toBe(true);
  });

  it("uses latest segment only", () => {
    writeJsonl(dir, [
      makeConfig(),
      makeRun({ run: 1, commit: "aaa1111", segment: 0, metric: 200, status: "keep" }),
      makeConfig({ name: "Seg2" }),
      makeRun({ run: 2, commit: "bbb2222", segment: 1, metric: 100, status: "keep" }),
    ]);
    const result = buildDashboard(dir, theme, 0, 120, 60);
    // Should display Seg2 (latest config)
    expect(result.lines.some((l) => l.includes("Seg2"))).toBe(true);
  });

  it("shows secondary metrics when present", () => {
    writeJsonl(dir, [
      makeConfig(),
      makeRun({
        run: 1,
        commit: "aaa1111",
        metrics: { dep_only: 50, layer_only: 20 },
      }),
    ]);
    const result = buildDashboard(dir, theme, 0, 120, 40);
    expect(result.lines.some((l) => l.includes("Secondary Metrics"))).toBe(true);
  });

  it("includes keyboard hint footer", () => {
    writeJsonl(dir, [makeConfig(), makeRun()]);
    // Use wide terminal so the full footer fits without truncation
    const result = buildDashboard(dir, theme, 0, 200, 40);
    const lastLines = result.lines.slice(-3).join(" ");
    expect(lastLines).toContain("j/k=navigate");
    expect(lastLines).toContain("tab=next view");
  });

  it("handles higher-is-better direction", () => {
    writeJsonl(dir, [
      makeConfig({ bestDirection: "higher" }),
      makeRun({ run: 1, commit: "aaa1111", metric: 50 }),
      makeRun({ run: 2, commit: "bbb2222", metric: 80, status: "keep" }),
    ]);
    const result = buildDashboard(dir, theme, 0, 120, 40);
    expect(result.lines.some((l) => l.includes("↑") && l.includes("higher is better"))).toBe(true);
  });

  it("respects width contract at 120 columns", () => {
    writeJsonl(dir, [
      makeConfig(),
      makeRun({ run: 1, commit: "aaa1111", metric: 100, metrics: { sec_a: 50, sec_b: 20 } }),
      makeRun({ run: 2, commit: "bbb2222", metric: 80, metrics: { sec_a: 45, sec_b: 18 } }),
    ]);
    const result = buildDashboard(dir, theme, 0, 120, 40);
    expect(result.lines.every((line) => visibleWidth(line) <= 120)).toBe(true);
  });

  it("respects width contract at 80 columns", () => {
    writeJsonl(dir, [
      makeConfig(),
      makeRun({ run: 1, commit: "aaa1111", metric: 100, metrics: { sec_a: 50 } }),
      makeRun({ run: 2, commit: "bbb2222", metric: 80, metrics: { sec_a: 45 } }),
    ]);
    const result = buildDashboard(dir, theme, 0, 80, 40);
    expect(result.lines.every((line) => visibleWidth(line) <= 80)).toBe(true);
  });

  it("respects width contract at 60 columns", () => {
    writeJsonl(dir, [makeConfig(), makeRun({ run: 1, commit: "aaa1111", metric: 100 })]);
    const result = buildDashboard(dir, theme, 0, 60, 40);
    expect(result.lines.every((line) => visibleWidth(line) <= 60)).toBe(true);
  });

  it("never renders lines wider than the requested width", () => {
    writeJsonl(dir, [
      makeConfig({ name: "Optimize unit test runtime", metricName: "test_runtime_ms" }),
      makeRun({
        run: 1,
        commit: "f613004",
        metric: 6940,
        metrics: { min_ms: 6714, max_ms: 7548, mean_ms: 7074.4, spread_ms: 834 },
        description: "Baseline median Vitest runtime with correctness checks enabled",
      }),
      makeRun({
        run: 2,
        commit: "048e477",
        metric: 5796,
        metrics: { min_ms: 5623, max_ms: 6231, mean_ms: 5896.4, spread_ms: 608 },
        description:
          "Disable external explanation API env in server tests so explain-route coverage stays deterministic and local",
      }),
      makeRun({
        run: 3,
        commit: "b9bc61f",
        metric: 2985,
        metrics: { min_ms: 2678, max_ms: 4735, mean_ms: 3488.2, spread_ms: 2057 },
        confidence: 3.5,
        description:
          "Reuse a prebuilt git integration test repository snapshot and clone it per test instead of rebuilding/pushing repos in every case",
      }),
    ]);

    const width = 215;
    const result = buildDashboard(dir, theme, 0, width, 60);
    expect(result.lines.every((line) => visibleWidth(line) <= width)).toBe(true);
  });
});
