import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/** Escape HTML entities for safe embedding in HTML attributes/content. */
export function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Safely embed a value as JSON inside a <script> tag. Prevents </script> injection. */
export function safeJson(value: unknown): string {
  return JSON.stringify(value).replace(/<\//g, "<\\/");
}

const _assetCache = new Map<string, string>();

/** Clear the HTML asset cache. Called when the server restarts to pick up file changes. */
export function clearAssetCache(): void {
  _assetCache.clear();
}
const _htmlDir = dirname(fileURLToPath(import.meta.url));

/** Read an asset file from the html/ directory (resolves relative to this module). Cached after first read. */
export function readHtmlAsset(filename: string): string {
  if (filename.includes("..") || filename.includes("/") || filename.includes("\\")) {
    throw new Error(`Invalid asset filename: ${filename}`);
  }
  let content = _assetCache.get(filename);
  if (content === undefined) {
    content = readFileSync(join(_htmlDir, filename), "utf-8");
    _assetCache.set(filename, content);
  }
  return content;
}
