import { describe, it, expect } from "vitest";
import { visibleWidth } from "@mariozechner/pi-tui";
import { renderNav } from "../src/tui/nav.js";
import { createMockTheme } from "./helpers.js";

describe("renderNav", () => {
  const theme = createMockTheme();

  it("returns two lines (tabs + divider)", () => {
    const lines = renderNav("dashboard", theme, 80);
    expect(lines).toHaveLength(2);
  });

  it("highlights the active tab", () => {
    const lines = renderNav("plan", theme, 80);
    expect(lines[0]).toContain("[2:Plan]");
  });

  it("includes keyboard hints", () => {
    const lines = renderNav("dashboard", theme, 80);
    expect(lines[0]).toContain("w=web");
    expect(lines[0]).toContain("q=quit");
  });

  it("does not crash on very narrow widths", () => {
    expect(() => renderNav("dashboard", theme, 1)).not.toThrow();
    expect(() => renderNav("dashboard", theme, 3)).not.toThrow();
  });

  it("respects width contract", () => {
    for (const width of [10, 40, 80, 200]) {
      const lines = renderNav("dashboard", theme, width);
      for (const line of lines) {
        expect(visibleWidth(line)).toBeLessThanOrEqual(width);
      }
    }
  });

  it("appends extra hint when provided", () => {
    const lines = renderNav("dashboard", theme, 120, "s=start");
    expect(lines[0]).toContain("s=start");
  });
});
