import { describe, it, expect } from "vitest";
import { normalizeBodyLines } from "../src/tui/layout.js";

describe("normalizeBodyLines", () => {
  it("pads short content to exact target height", () => {
    const out = normalizeBodyLines(["a", "b"], 5);
    expect(out).toEqual(["a", "b", " ", " ", " "]);
    expect(out).toHaveLength(5);
  });

  it("truncates long content to exact target height", () => {
    const out = normalizeBodyLines(["1", "2", "3", "4"], 2);
    expect(out).toEqual(["1", "2"]);
    expect(out).toHaveLength(2);
  });

  it("returns empty for non-positive heights", () => {
    expect(normalizeBodyLines(["x"], 0)).toEqual([]);
    expect(normalizeBodyLines(["x"], -3)).toEqual([]);
  });
});
