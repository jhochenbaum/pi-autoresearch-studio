import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parseJsonl } from "./parser.js";

import type { Run } from "./parser.js";

export interface DashboardData {
  config: { name: string; metricName: string; metricUnit: string; bestDirection: string };
  runs: Run[];
  allRuns: Run[];
  secondaryMetrics: string[];
  plan: string;
  ideas: string;
  hasSession: boolean;
  startCommand: string;
}

/** Check whether an autoresearch session exists in the given directory. */
export function detectAutoresearchSession(cwd: string): boolean {
  return existsSync(join(cwd, "autoresearch.jsonl")) || existsSync(join(cwd, "autoresearch.md"));
}

/** Read a text file or return empty string. */
function readOr(path: string): string {
  return existsSync(path) ? readFileSync(path, "utf-8") : "";
}

/** Collect all dashboard data from the project directory. */
export function collectDashboardData(cwd: string): DashboardData {
  const { configs, runs } = parseJsonl(cwd);
  const lastConfig = configs[configs.length - 1] ?? {
    name: "Autoresearch Studio",
    metricName: "",
    metricUnit: "",
    bestDirection: "lower",
  };
  const latestSegment = runs.length > 0 ? Math.max(...runs.map((r) => r.segment)) : 0;
  const segRuns = runs.filter((r) => r.segment === latestSegment);
  const secNames = new Set<string>();
  for (const r of segRuns) {
    if (r.metrics) {
      Object.keys(r.metrics).forEach((k) => secNames.add(k));
    }
  }

  return {
    config: lastConfig,
    runs: segRuns,
    allRuns: runs,
    secondaryMetrics: [...secNames],
    plan: readOr(join(cwd, "autoresearch.md")),
    ideas: readOr(join(cwd, "autoresearch.ideas.md")),
    hasSession: detectAutoresearchSession(cwd),
    startCommand: "/autoresearch <goal>",
  };
}
