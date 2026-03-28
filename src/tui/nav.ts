import { truncateToWidth } from "@mariozechner/pi-tui";
import { MAX_DIVIDER_WIDTH } from "./constants.js";
import type { Theme } from "@mariozechner/pi-coding-agent";
import type { View } from "./app.js";

/** Render the tab navigation bar with view indicators and keyboard hints. */
export function renderNav(currentView: View, theme: Theme, width: number, extraHint?: string): string[] {
  const t = theme;
  const tab = (key: string, label: string, view: View) => {
    if (currentView === view) {
      return t.fg("accent", t.bold(`[${key}:${label}]`));
    }
    return t.fg("dim", ` ${key}:${label} `);
  };

  const nav = `  ${tab("1", "Dashboard", "dashboard")}  ${tab("2", "Plan", "plan")}  ${tab("3", "Ideas", "ideas")}  ${t.fg("dim", "│")} ${t.fg("dim", "w=web  q=quit")}${extraHint ? "  " + t.fg("dim", extraHint) : ""}`;

  return [
    truncateToWidth(nav, width),
    truncateToWidth(`  ${t.fg("dim", "─".repeat(Math.max(0, Math.min(width - 4, MAX_DIVIDER_WIDTH))))}`, width),
  ];
}
