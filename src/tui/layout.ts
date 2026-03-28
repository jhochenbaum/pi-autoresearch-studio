/** Clamp/pad rendered body content to exactly fill the available TUI content height. */
export function normalizeBodyLines(content: string[], contentH: number): string[] {
  const clamped = content.slice(0, Math.max(0, contentH));
  while (clamped.length < Math.max(0, contentH)) {
    clamped.push(" ");
  }
  return clamped;
}
