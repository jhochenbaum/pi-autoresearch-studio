import { visibleWidth } from "@mariozechner/pi-tui";
import type { Theme } from "@mariozechner/pi-coding-agent";
import { BLOCKS, CHART } from "./constants.js";

type ThemeColor = Parameters<Theme["fg"]>[0];

export function fmtYLabel(n: number): string {
  if (n >= 1_000_000) {
    return (n / 1_000_000).toFixed(1) + "M";
  }
  if (n >= 1_000) {
    return (n / 1_000).toFixed(1) + "K";
  }
  return String(Math.round(n));
}

export function fmtDelta(pct: number): string {
  return (pct > 0 ? "+" : "") + pct.toFixed(1) + "%";
}

/** Render a vertical bar chart of values with color-coded statuses. */
export function renderLineChart(
  values: number[],
  statuses: string[],
  width: number,
  height: number,
  theme: Theme
): string[] {
  if (values.length === 0) {
    return [];
  }

  const min = values.reduce((a, b) => Math.min(a, b), Infinity);
  const max = values.reduce((a, b) => Math.max(a, b), -Infinity);
  const range = max - min || 1;
  const yAxisW = CHART.yAxisWidth;
  const chartW = width - yAxisW;
  const colsPerPoint = Math.max(1, Math.floor(chartW / values.length));

  const lines: string[] = [];
  for (let row = height - 1; row >= 0; row--) {
    let yLabel: string;
    if (row === height - 1 || row === 0 || row === Math.floor(height / 2)) {
      const yVal = min + (range * (row + 0.5)) / height;
      yLabel = fmtYLabel(yVal).padStart(yAxisW - 1) + " ";
    } else {
      yLabel = " ".repeat(yAxisW);
    }

    let line = theme.fg("dim", yLabel);
    for (let di = 0; di < values.length; di++) {
      const norm = (values[di] - min) / range;
      const fillRows = norm * height;
      const fullRows = Math.floor(fillRows);
      const partial = fillRows - fullRows;
      let char: string;
      if (row < fullRows) {
        char = "█";
      } else if (row === fullRows) {
        const idx = Math.min(Math.round(partial * (BLOCKS.length - 1)), BLOCKS.length - 1);
        char = BLOCKS[idx];
      } else {
        char = " ";
      }
      const color: ThemeColor = statuses[di] === "keep" ? "success" : statuses[di] === "discard" ? "warning" : "error";
      line += char === " " ? " ".repeat(colsPerPoint) : theme.fg(color, char.repeat(colsPerPoint));
    }
    lines.push(line);
  }

  lines.push(" ".repeat(yAxisW) + theme.fg("dim", "╰" + "─".repeat(colsPerPoint * values.length)));

  let labelLine = " ".repeat(yAxisW);
  for (let di = 0; di < values.length; di++) {
    const label = "#" + (di + 1);
    if (colsPerPoint >= label.length + 1 || di === 0 || di === values.length - 1) {
      labelLine += theme.fg("dim", label.padEnd(colsPerPoint));
    } else {
      labelLine += " ".repeat(colsPerPoint);
    }
  }
  lines.push(labelLine);
  return lines;
}

/** Render a horizontal bar with label, value, and optional suffix. */
export function renderHBar(
  label: string,
  value: number,
  maxVal: number,
  barWidth: number,
  theme: Theme,
  color: ThemeColor,
  suffix: string
): string {
  const lbl = label.padEnd(16).slice(0, 16);
  const ratio = maxVal > 0 ? value / maxVal : 0;
  const filled = Math.max(value > 0 ? 1 : 0, Math.round(ratio * barWidth));
  const empty = barWidth - filled;
  const bar = theme.fg(color, "█".repeat(filled)) + theme.fg("dim", "░".repeat(empty));
  return `${theme.fg("muted", lbl)} ${bar} ${theme.fg("text", value.toLocaleString())}${suffix}`;
}

/** Combine two column arrays side-by-side with a separator. */
export function sideBySide(left: string[], right: string[], leftW: number, sep: string): string[] {
  const maxLen = Math.max(left.length, right.length);
  const result: string[] = [];
  for (let i = 0; i < maxLen; i++) {
    const l = i < left.length ? left[i] : "";
    const r = i < right.length ? right[i] : "";
    const lVis = visibleWidth(l);
    const pad = Math.max(0, leftW - lVis);
    result.push(l + " ".repeat(pad) + sep + r);
  }
  return result;
}
