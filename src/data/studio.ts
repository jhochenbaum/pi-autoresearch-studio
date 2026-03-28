import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface StudioExplanationEntry {
  type: "explanation";
  commit: string;
  run: number;
  segment: number;
  inputHash: string;
  promptVersion: string;
  source: "llm" | "heuristic";
  model: string;
  content: string;
  createdAt: number;
}

export type StudioEntry = StudioExplanationEntry;

function studioPath(cwd: string): string {
  return join(cwd, "autoresearch.studio.jsonl");
}

export function readStudioEntries(cwd: string): StudioEntry[] {
  const file = studioPath(cwd);
  if (!existsSync(file)) {
    return [];
  }

  return readFileSync(file, "utf-8")
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      try {
        const parsed = JSON.parse(line) as StudioEntry;
        return parsed.type === "explanation" ? [parsed] : [];
      } catch {
        return [];
      }
    });
}

export function appendStudioEntry(cwd: string, entry: StudioEntry): void {
  appendFileSync(studioPath(cwd), JSON.stringify(entry) + "\n", "utf-8");
}

export function findCachedExplanation(
  cwd: string,
  commit: string,
  inputHash: string,
  promptVersion: string
): StudioExplanationEntry | null {
  const entries = readStudioEntries(cwd)
    .filter((e) => e.type === "explanation")
    .filter((e) => e.commit === commit && e.inputHash === inputHash && e.promptVersion === promptVersion)
    .sort((a, b) => b.createdAt - a.createdAt);

  return entries[0] ?? null;
}
