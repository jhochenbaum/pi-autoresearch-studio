import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export interface Config {
  name: string;
  metricName: string;
  metricUnit: string;
  bestDirection: "lower" | "higher";
}

export interface Run {
  run: number;
  commit: string;
  metric: number;
  metrics: Record<string, number>;
  status: string;
  description: string;
  timestamp: number;
  segment: number;
  confidence: number | null;
}

/** Parse autoresearch.jsonl from the given directory into configs and runs. */
export function parseJsonl(cwd: string): { configs: Config[]; runs: Run[] } {
  const file = join(cwd, "autoresearch.jsonl");
  if (!existsSync(file)) return { configs: [], runs: [] };
  const lines = readFileSync(file, "utf-8").trim().split("\n").filter(Boolean);
  const configs: Config[] = [];
  const runs: Run[] = [];
  let skipped = 0;
  for (const line of lines) {
    try {
      const o = JSON.parse(line);
      if (o.type === "config") {
        configs.push(o);
      } else if ("run" in o) {
        runs.push(o);
      }
    } catch {
      skipped++;
    }
  }
  if (skipped > 0) {
    console.warn(`[arstudio] Skipped ${skipped} malformed line(s) in autoresearch.jsonl`);
  }
  return { configs, runs };
}
