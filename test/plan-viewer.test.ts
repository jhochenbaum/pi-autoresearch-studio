import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { visibleWidth } from "@mariozechner/pi-tui";
import { buildPlanView } from "../src/tui/plan-viewer.js";
import { createMockTheme } from "./helpers.js";

describe("buildPlanView", () => {
  const theme = createMockTheme();
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "ar-plan-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("shows not found message for missing file", () => {
    const lines = buildPlanView(join(dir, "nope.md"), "nope.md", theme, 0, 20, 80);
    expect(lines.some((l) => l.includes("nope.md") && l.includes("exist yet"))).toBe(true);
  });

  it("renders markdown headings with correct styling calls", () => {
    const path = join(dir, "test.md");
    writeFileSync(path, "# Title\n## Section\n### Subsection\n");
    const lines = buildPlanView(path, "test.md", theme, 0, 40, 80);
    expect(lines.some((l) => l.includes("# Title"))).toBe(true);
    expect(lines.some((l) => l.includes("## Section"))).toBe(true);
    expect(lines.some((l) => l.includes("### Subsection"))).toBe(true);
  });

  it("renders bullet points with bullet markers", () => {
    const path = join(dir, "test.md");
    writeFileSync(path, "- First item\n- Second item\n  - Nested item\n");
    const lines = buildPlanView(path, "test.md", theme, 0, 40, 80);
    expect(lines.some((l) => l.includes("•") && l.includes("First item"))).toBe(true);
    expect(lines.some((l) => l.includes("•") && l.includes("Second item"))).toBe(true);
    expect(lines.some((l) => l.includes("◦") && l.includes("Nested item"))).toBe(true);
  });

  it("preserves empty lines", () => {
    const path = join(dir, "test.md");
    writeFileSync(path, "Line one\n\nLine three\n");
    const lines = buildPlanView(path, "test.md", theme, 0, 40, 80);
    // Should have empty string for the blank line
    expect(lines.filter((l) => l === "").length).toBeGreaterThanOrEqual(1);
  });

  it("includes footer with scroll percentage", () => {
    const path = join(dir, "test.md");
    writeFileSync(path, "Short content\n");
    const lines = buildPlanView(path, "test.md", theme, 0, 40, 80);
    const footer = lines[lines.length - 1];
    expect(footer).toContain("j/k scroll");
    expect(footer).toContain("e edit");
    expect(footer).toContain("esc back");
    expect(footer).toContain("q quit");
    expect(footer).toContain("100%");
  });

  it("scrolls content and updates percentage", () => {
    const path = join(dir, "test.md");
    // Create content taller than viewport
    const longContent = Array.from({ length: 50 }, (_, i) => `Line ${i + 1}`).join("\n");
    writeFileSync(path, longContent);

    const noScroll = buildPlanView(path, "test.md", theme, 0, 10, 80);
    const scrolled = buildPlanView(path, "test.md", theme, 20, 10, 80);

    // Scrolled view should show different content
    const noScrollContent = noScroll.slice(0, -2).join("\n");
    const scrolledContent = scrolled.slice(0, -2).join("\n");
    expect(noScrollContent).not.toBe(scrolledContent);

    // Scrolled percentage should not be 0%
    const scrolledFooter = scrolled[scrolled.length - 1];
    expect(scrolledFooter).not.toContain("0%");
  });

  it("clamps scroll to max scroll position", () => {
    const path = join(dir, "test.md");
    writeFileSync(path, "Line 1\nLine 2\nLine 3\n");

    // Scroll way past end — should clamp
    const overScrolled = buildPlanView(path, "test.md", theme, 999, 10, 80);
    const footer = overScrolled[overScrolled.length - 1];
    expect(footer).toContain("100%");
  });

  it("handles regular text lines", () => {
    const path = join(dir, "test.md");
    writeFileSync(path, "Just some regular text.\n");
    const lines = buildPlanView(path, "test.md", theme, 0, 40, 80);
    expect(lines.some((l) => l.includes("Just some regular text."))).toBe(true);
  });

  it("does not crash on very narrow widths", () => {
    const path = join(dir, "test.md");
    writeFileSync(path, "# Title\nSome content\n");
    expect(() => buildPlanView(path, "test.md", theme, 0, 10, 4)).not.toThrow();
    expect(() => buildPlanView(path, "test.md", theme, 0, 10, 1)).not.toThrow();
  });

  it("respects width contract", () => {
    const path = join(dir, "test.md");
    writeFileSync(path, "# Title\n## Section\n- bullet\n  - nested\nRegular text line\n");
    for (const width of [20, 40, 80]) {
      const lines = buildPlanView(path, "test.md", theme, 0, 40, width);
      expect(lines.every((l) => visibleWidth(l) <= width)).toBe(true);
    }
  });
});
