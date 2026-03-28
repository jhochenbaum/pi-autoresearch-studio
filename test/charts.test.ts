import { describe, it, expect } from "vitest";
import { fmtYLabel, fmtDelta, renderLineChart, renderHBar, sideBySide } from "../src/tui/charts.js";
import { createMockTheme } from "./helpers.js";

// ─── fmtYLabel ───────────────────────────────────────────────────────────────

describe("fmtYLabel", () => {
  it("formats millions", () => {
    expect(fmtYLabel(1_000_000)).toBe("1.0M");
    expect(fmtYLabel(2_500_000)).toBe("2.5M");
    expect(fmtYLabel(10_300_000)).toBe("10.3M");
  });

  it("formats thousands", () => {
    expect(fmtYLabel(1_000)).toBe("1.0K");
    expect(fmtYLabel(1_500)).toBe("1.5K");
    expect(fmtYLabel(999_999)).toBe("1000.0K");
  });

  it("formats small numbers as rounded integers", () => {
    expect(fmtYLabel(0)).toBe("0");
    expect(fmtYLabel(1)).toBe("1");
    expect(fmtYLabel(42)).toBe("42");
    expect(fmtYLabel(999)).toBe("999");
  });

  it("rounds small fractional numbers", () => {
    expect(fmtYLabel(3.7)).toBe("4");
    expect(fmtYLabel(0.4)).toBe("0");
  });
});

// ─── fmtDelta ────────────────────────────────────────────────────────────────

describe("fmtDelta", () => {
  it("prefixes positive values with +", () => {
    expect(fmtDelta(5.0)).toBe("+5.0%");
    expect(fmtDelta(0.1)).toBe("+0.1%");
  });

  it("shows negative values without extra prefix", () => {
    expect(fmtDelta(-3.2)).toBe("-3.2%");
    expect(fmtDelta(-100.0)).toBe("-100.0%");
  });

  it("shows zero without sign", () => {
    expect(fmtDelta(0)).toBe("0.0%");
  });

  it("formats to 1 decimal place", () => {
    expect(fmtDelta(1.234)).toBe("+1.2%");
    expect(fmtDelta(-0.567)).toBe("-0.6%");
  });
});

// ─── renderLineChart ─────────────────────────────────────────────────────────

describe("renderLineChart", () => {
  const theme = createMockTheme();

  it("returns empty array for no data", () => {
    expect(renderLineChart([], [], 80, 8, theme)).toEqual([]);
  });

  it("returns the correct number of lines for a single data point", () => {
    const lines = renderLineChart([100], ["keep"], 40, 6, theme);
    // height rows + axis line + label line = 6 + 1 + 1 = 8
    expect(lines).toHaveLength(8);
  });

  it("returns the correct number of lines for multiple data points", () => {
    const values = [100, 90, 80, 70];
    const statuses = ["keep", "keep", "discard", "keep"];
    const lines = renderLineChart(values, statuses, 80, 8, theme);
    // 8 height rows + 1 axis + 1 labels = 10
    expect(lines).toHaveLength(10);
  });

  it("handles all same values (flat chart) without crashing", () => {
    const values = [50, 50, 50, 50, 50];
    const statuses = ["keep", "keep", "keep", "keep", "keep"];
    const lines = renderLineChart(values, statuses, 60, 6, theme);
    expect(lines.length).toBeGreaterThan(0);
  });

  it("handles a single value", () => {
    const lines = renderLineChart([42], ["keep"], 30, 4, theme);
    expect(lines.length).toBe(6); // 4 + axis + labels
  });

  it("includes y-axis labels at top, middle, and bottom rows", () => {
    const lines = renderLineChart([10, 100], ["keep", "discard"], 60, 6, theme);
    // Y-axis labels appear at rows 0, 3, and 5 (bottom, mid, top of 6-row chart)
    // With mock theme, we can check that labels are present
    const topRow = lines[0]; // row 5 (height-1)
    const bottomRow = lines[5]; // row 0
    // Both should have non-space content at the start (y-axis label area)
    expect(topRow.trimStart().length).toBeGreaterThan(0);
    expect(bottomRow.trimStart().length).toBeGreaterThan(0);
  });

  it("contains axis connector at the bottom", () => {
    const lines = renderLineChart([10, 20], ["keep", "keep"], 40, 4, theme);
    const axisLine = lines[4]; // right after the chart rows
    expect(axisLine).toContain("╰");
    expect(axisLine).toContain("─");
  });
});

// ─── renderHBar ──────────────────────────────────────────────────────────────

describe("renderHBar", () => {
  const theme = createMockTheme();

  it("renders a full bar when value equals max", () => {
    const result = renderHBar("metric_a", 100, 100, 20, theme, "success", "");
    expect(result).toContain("█".repeat(20));
    expect(result).not.toContain("░");
  });

  it("renders a half bar when value is half of max", () => {
    const result = renderHBar("metric_b", 50, 100, 20, theme, "accent", "");
    expect(result).toContain("█".repeat(10));
    expect(result).toContain("░".repeat(10));
  });

  it("renders at least 1 filled block for non-zero values", () => {
    const result = renderHBar("tiny", 1, 10000, 20, theme, "warning", "");
    expect(result).toContain("█");
  });

  it("renders all empty when value is zero", () => {
    const result = renderHBar("zero", 0, 100, 10, theme, "dim", "");
    expect(result).toContain("░".repeat(10));
    expect(result).not.toContain("█");
  });

  it("truncates long labels to 16 chars", () => {
    const result = renderHBar("this_is_a_very_long_label_name", 50, 100, 10, theme, "accent", "");
    // Label should be 16 chars padded
    expect(result).toContain("this_is_a_very_l");
  });

  it("includes the suffix text", () => {
    const result = renderHBar("metric", 80, 100, 10, theme, "accent", " +5.0%");
    expect(result).toContain("+5.0%");
  });

  it("includes the formatted value", () => {
    const result = renderHBar("metric", 1500, 2000, 10, theme, "accent", "");
    expect(result).toContain("1,500");
  });

  it("handles maxVal of zero without crashing", () => {
    const result = renderHBar("metric", 0, 0, 10, theme, "dim", "");
    expect(result).toBeDefined();
  });
});

// ─── sideBySide ──────────────────────────────────────────────────────────────

describe("sideBySide", () => {
  it("combines two equal-length arrays", () => {
    const left = ["aaa", "bbb"];
    const right = ["111", "222"];
    const result = sideBySide(left, right, 5, " | ");
    expect(result).toHaveLength(2);
    expect(result[0]).toContain("aaa");
    expect(result[0]).toContain("111");
    expect(result[1]).toContain("bbb");
    expect(result[1]).toContain("222");
  });

  it("pads shorter left array with empty strings", () => {
    const left = ["a"];
    const right = ["1", "2", "3"];
    const result = sideBySide(left, right, 5, "|");
    expect(result).toHaveLength(3);
    // Third line should still have the right side
    expect(result[2]).toContain("3");
  });

  it("pads shorter right array with empty strings", () => {
    const left = ["a", "b", "c"];
    const right = ["1"];
    const result = sideBySide(left, right, 5, "|");
    expect(result).toHaveLength(3);
    expect(result[0]).toContain("1");
    // Lines 2 and 3 should have left content but empty right
    expect(result[1]).toContain("b");
    expect(result[2]).toContain("c");
  });

  it("handles both arrays empty", () => {
    expect(sideBySide([], [], 10, "|")).toEqual([]);
  });

  it("respects separator between columns", () => {
    const result = sideBySide(["L"], ["R"], 3, " | ");
    expect(result[0]).toContain(" | ");
  });

  it("pads left column to specified width", () => {
    // "ab" has visible width 2; leftW=10 should add 8 spaces
    const result = sideBySide(["ab"], ["R"], 10, "|");
    // Between "ab" and "|" there should be padding
    const parts = result[0].split("|");
    expect(parts[0].length).toBe(10); // "ab" + 8 spaces
  });
});
