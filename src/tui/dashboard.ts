import { truncateToWidth } from "@mariozechner/pi-tui";
import type { Theme } from "@mariozechner/pi-coding-agent";
import { parseJsonl } from "../data/parser.js";
import { renderLineChart, renderHBar, sideBySide, fmtDelta } from "./charts.js";
import { COL_WIDTHS, MAX_DIVIDER_WIDTH } from "./constants.js";

type ThemeColor = Parameters<Theme["fg"]>[0];

/** Return the theme color for a percentage delta relative to the optimization direction. */
function getDeltaColor(pct: number, direction: string): ThemeColor {
  if (direction === "lower") {
    if (pct < 0) return "success";
    if (pct > 0) return "error";
    return "dim";
  }
  if (pct > 0) return "success";
  if (pct < 0) return "error";
  return "dim";
}

/** Return the theme color for a confidence score. */
function getConfidenceColor(confidence: number | null): ThemeColor {
  if (confidence == null) return "dim";
  if (confidence >= 2) return "success";
  if (confidence >= 1) return "warning";
  return "error";
}

/** Returned by buildDashboard — exposes only the minimum needed for UI rendering. */
export interface DashboardResult {
  lines: string[];
  rowCommitMap: (string | null)[];
  rowStatusMap: (string | null)[];
}

/** Build the full TUI dashboard: stats, charts, and scrollable experiment log. */
export function buildDashboard(
  cwd: string,
  theme: Theme,
  tableScroll: number,
  width: number,
  termHeight: number,
  prChecked?: Set<number>
): DashboardResult {
  const { configs, runs } = parseJsonl(cwd);
  const t = theme;
  const rowCommitMap: (string | null)[] = [];
  const rowStatusMap: (string | null)[] = [];

  if (configs.length === 0) {
    return {
      lines: [
        "",
        "  " + t.fg("warning", "No autoresearch.jsonl found."),
        "",
        "  " + t.fg("dim", "Run /arstudio new to start a session."),
      ],
      rowCommitMap,
      rowStatusMap,
    };
  }

  const cfg = configs[configs.length - 1];
  const seg = runs.length > 0 ? Math.max(...runs.map((r) => r.segment)) : 0;
  const segRuns = runs.filter((r) => r.segment === seg);
  const kept = segRuns.filter((r) => r.status === "keep");
  const lines: string[] = [];

  // Header
  const arrow = cfg.bestDirection === "lower" ? "↓" : "↑";
  lines.push(
    `  ${t.fg("accent", t.bold(cfg.name))}  ${t.fg("dim", cfg.metricName + " · " + arrow + " " + cfg.bestDirection + " is better")}`
  );

  if (kept.length === 0) {
    lines.push("  " + t.fg("muted", "Waiting for first experiment results…"));
    return { lines, rowCommitMap, rowStatusMap };
  }

  // Stats
  const baseline = kept[0].metric;
  const current = kept[kept.length - 1].metric;
  const best =
    cfg.bestDirection === "lower" ? Math.min(...kept.map((r) => r.metric)) : Math.max(...kept.map((r) => r.metric));
  const pctCur = baseline ? ((current - baseline) / baseline) * 100 : 0;
  const pctBest = baseline ? ((best - baseline) / baseline) * 100 : 0;
  const bClr = (pct: number): ThemeColor => getDeltaColor(pct, cfg.bestDirection);

  lines.push(
    `  ${t.fg("dim", "BASELINE")} ${t.bold(baseline.toLocaleString())}  ${t.fg("dim", "CURRENT")} ${t.fg("accent", t.bold(current.toLocaleString()))} ${t.fg(bClr(pctCur), fmtDelta(pctCur))}  ${t.fg("dim", "BEST")} ${t.fg("success", t.bold(best.toLocaleString()))} ${t.fg(bClr(pctBest), fmtDelta(pctBest))}  ${t.fg("dim", "RUNS")} ${t.bold(String(segRuns.length))} ${t.fg("dim", "(" + kept.length + " kept)")}`
  );
  lines.push("");

  // Side-by-side: chart (left) + secondary metrics (right)
  const latestKept = kept[kept.length - 1];
  const secNames = Object.keys(latestKept.metrics ?? {});
  const hasSecondary = secNames.length > 0;
  const gap = 3;
  const rightW = hasSecondary ? Math.min(Math.max(Math.floor(width * 0.35), 30), 60) : 0;
  const leftW = width - rightW - gap - 4;
  const chartH = Math.max(6, Math.min(10, termHeight - 20));

  const leftLines: string[] = [];
  leftLines.push(`${t.fg("accent", "▎")} ${t.bold("Primary Metric")}`);
  leftLines.push("");
  leftLines.push(
    ...renderLineChart(
      segRuns.map((r) => r.metric),
      segRuns.map((r) => r.status),
      leftW,
      chartH,
      t
    )
  );

  const rightLines: string[] = [];
  if (hasSecondary) {
    rightLines.push(`${t.fg("accent", "▎")} ${t.bold("Secondary Metrics")}`);
    rightLines.push("");
    const baselineKept = kept[0];
    const barW = Math.max(rightW - 28, 5);
    const maxVal = Math.max(
      ...secNames.map((k) => Math.max(latestKept.metrics[k] ?? 0, baselineKept.metrics?.[k] ?? 0))
    );
    const palette: ThemeColor[] = ["accent", "success", "warning", "muted", "dim"];
    for (let i = 0; i < secNames.length; i++) {
      const name = secNames[i];
      const val = latestKept.metrics[name] ?? 0;
      const baseVal = baselineKept.metrics?.[name];
      let suffix = "";
      if (baseVal != null && baseVal !== 0) {
        const p = ((val - baseVal) / baseVal) * 100;
        suffix = " " + t.fg(getDeltaColor(p, cfg.bestDirection), fmtDelta(p));
      }
      rightLines.push(
        truncateToWidth(renderHBar(name, val, maxVal, barW, t, palette[i % palette.length], suffix), rightW)
      );
      rightLines.push("");
    }
  }

  for (const line of sideBySide(leftLines, rightLines, leftW, hasSecondary ? t.fg("dim", "│") + " " : "")) {
    lines.push(truncateToWidth("  " + line, width));
  }
  lines.push("");

  // Experiment log with inline PR selection
  const checkedSet = prChecked ?? null;
  const hasPR = checkedSet !== null;
  const prCount = checkedSet?.size ?? 0;
  const prLabel =
    hasPR && prCount > 0 ? `  ${t.fg("success", `${prCount} selected`)} ${t.fg("dim", "— enter to create PR")}` : "";
  lines.push(`  ${t.fg("accent", "▎")} ${t.bold("Experiment Log")}${prLabel}`);
  lines.push("");

  const colW = {
    ...COL_WIDTHS,
    pr: hasPR ? COL_WIDTHS.pr : 0,
  };

  const prHdr = hasPR ? t.fg("dim", "PR".padEnd(colW.pr)) : "";
  lines.push(
    `  ${t.fg("dim", "#".padEnd(colW.run))}${t.fg("dim", "Status".padEnd(colW.status))}${t.fg("dim", cfg.metricName.slice(0, 10).padEnd(colW.metric))}${t.fg("dim", "Δ%".padEnd(colW.delta))}${t.fg("dim", "Conf.".padEnd(colW.conf))}${t.fg("dim", "Commit".padEnd(colW.commit))}${prHdr}${t.fg("dim", "Description")}`
  );
  lines.push(`  ${t.fg("dim", "─".repeat(Math.max(0, Math.min(width - 4, MAX_DIVIDER_WIDTH))))}`);

  const tableRows: string[] = [];
  let prevSeg = -1;
  for (let i = runs.length - 1; i >= 0; i--) {
    const r = runs[i];
    if (prevSeg !== -1 && r.segment !== prevSeg) {
      tableRows.push(
        `  ${t.fg("dim", "── segment " + r.segment + " " + "─".repeat(Math.max(0, Math.min(width - 20, MAX_DIVIDER_WIDTH))))}`
      );
      rowCommitMap.push(null);
      rowStatusMap.push(null);
    }
    prevSeg = r.segment;

    const stMap: Record<string, [string, string]> = {
      keep: ["✓ keep", "success"],
      discard: ["✗ discard", "warning"],
      crash: ["💥 crash", "error"],
      checks_failed: ["⚠ chk_fl", "error"],
    };
    const [stText, stColor] = (stMap[r.status] ?? [r.status, "dim"]) as [string, ThemeColor];
    const delta = baseline ? ((r.metric - baseline) / baseline) * 100 : 0;
    const dc: ThemeColor = r.status === "keep" && baseline ? bClr(delta) : "dim";
    const conf = r.confidence != null ? r.confidence.toFixed(1) + "×" : "—";
    const confColor = getConfidenceColor(r.confidence);
    const totalColW = colW.run + colW.status + colW.metric + colW.delta + colW.conf + colW.commit + colW.pr + 8;
    const descW = Math.max(width - totalColW, 10);
    const desc = r.description.length > descW ? r.description.slice(0, descW - 1) + "…" : r.description;
    const selected = tableRows.length === tableScroll;
    const pointer = selected ? t.fg("accent", "▸ ") : "  ";
    const rowIdx = tableRows.length;
    const isChecked = checkedSet !== null && checkedSet.has(rowIdx);
    const canSelect = r.status === "keep";
    const checkbox = hasPR
      ? canSelect
        ? isChecked
          ? t.fg("success", "[x]".padEnd(colW.pr))
          : t.fg("dim", "[ ]".padEnd(colW.pr))
        : t.fg("dim", " · ".padEnd(colW.pr))
      : "";

    tableRows.push(
      `${pointer}${String(r.run).padEnd(colW.run)}${t.fg(stColor, stText.padEnd(colW.status))}${String(r.metric).padEnd(colW.metric)}${t.fg(dc, (r.metric > 0 ? fmtDelta(delta) : "—").padEnd(colW.delta))}${t.fg(confColor, conf.padEnd(colW.conf))}${t.fg("accent", r.commit.slice(0, 7).padEnd(colW.commit))}${checkbox}${t.fg(selected ? "text" : "dim", desc)}`
    );
    rowCommitMap.push(r.commit);
    rowStatusMap.push(r.status);
  }

  const maxVisibleRows = Math.max(3, termHeight - lines.length - 3);
  if (tableRows.length <= maxVisibleRows) {
    for (const row of tableRows) {
      lines.push(row);
    }
  } else {
    const scrollStart = Math.max(
      0,
      Math.min(tableScroll - Math.floor(maxVisibleRows / 2), tableRows.length - maxVisibleRows)
    );
    const visibleRows = tableRows.slice(scrollStart, scrollStart + maxVisibleRows);
    for (const row of visibleRows) {
      lines.push(row);
    }
    lines.push(
      `  ${t.fg("dim", `── ${scrollStart + 1}-${scrollStart + visibleRows.length} of ${tableRows.length} ──`)}`
    );
  }

  lines.push("");
  lines.push(
    `  ${t.fg("dim", "j/k=navigate · space=toggle PR · a=select kept · d=dry run · x=explain · enter=create PR · tab=next view")}`
  );

  // Enforce TUI width contract: every emitted line must fit within the requested width.
  return { lines: lines.map((l) => truncateToWidth(l, width)), rowCommitMap, rowStatusMap };
}
