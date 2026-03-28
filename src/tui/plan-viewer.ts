import { truncateToWidth } from "@mariozechner/pi-tui";
import type { Theme } from "@mariozechner/pi-coding-agent";
import { readFileSync, existsSync } from "node:fs";
import { PLAN_VIEWER, MAX_DIVIDER_WIDTH } from "./constants.js";

/** Build a scrollable, syntax-highlighted view of a markdown file. */
export function buildPlanView(
  filePath: string,
  filename: string,
  theme: Theme,
  scroll: number,
  termHeight: number,
  width: number
): string[] {
  const t = theme;
  const lines: string[] = [];

  const pushLine = (line: string) => {
    lines.push(truncateToWidth(line, width));
  };

  if (!existsSync(filePath)) {
    pushLine("");
    pushLine(`  ${t.fg("muted", filename + " doesn't exist yet.")}`);
    pushLine("");
    if (filename.includes("ideas")) {
      pushLine(`  ${t.fg("dim", "This file captures optimization ideas for future experiments.")}`);
      pushLine(`  ${t.fg("dim", "Press e to create it.")}`);
    } else {
      pushLine(`  ${t.fg("dim", "This file defines the objective, metrics, and constraints.")}`);
      pushLine(`  ${t.fg("dim", "It's created when a session starts, or press e to create it.")}`);
    }
  } else {
    const content = readFileSync(filePath, "utf-8");
    pushLine("");
    for (const ml of content.split("\n")) {
      if (ml.startsWith("# ")) {
        pushLine(`  ${t.fg("accent", t.bold(ml))}`);
      } else if (ml.startsWith("## ")) {
        pushLine(`  ${t.fg("accent", ml)}`);
      } else if (ml.startsWith("### ")) {
        pushLine(`  ${t.fg("warning", ml)}`);
      } else if (ml.startsWith("- ")) {
        pushLine(`  ${t.fg("success", "•")} ${t.fg("text", ml.slice(2))}`);
      } else if (ml.startsWith("  - ")) {
        pushLine(`    ${t.fg("dim", "◦")} ${t.fg("muted", ml.slice(4))}`);
      } else if (ml.trim() === "") {
        pushLine("");
      } else {
        pushLine(`  ${t.fg("text", ml)}`);
      }
    }
  }

  // Scroll + footer
  const contentViewH = Math.max(1, termHeight - PLAN_VIEWER.footerHeight);
  const maxScroll = Math.max(0, lines.length - contentViewH);
  const clampedScroll = Math.min(scroll, maxScroll);
  const visibleContent = lines.slice(clampedScroll, clampedScroll + contentViewH);

  const pct = maxScroll > 0 ? Math.round((clampedScroll / maxScroll) * 100) : 100;
  const footerSep = truncateToWidth(
    `  ${t.fg("dim", "─".repeat(Math.max(0, Math.min(width - 4, MAX_DIVIDER_WIDTH))))}`,
    width
  );
  const footerText = truncateToWidth(`  ${t.fg("dim", `j/k scroll · e edit · esc back · q quit · ${pct}%`)}`, width);

  return [...visibleContent, footerSep, footerText];
}
