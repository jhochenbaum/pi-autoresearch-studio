import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { generateHTML } from "../src/html/generator.js";

function makeConfig(overrides = {}) {
  return {
    type: "config",
    name: "HTML Test",
    metricName: "total_ms",
    metricUnit: "ms",
    bestDirection: "lower",
    ...overrides,
  };
}

function makeRun(overrides = {}) {
  return {
    run: 1,
    commit: "abc1234",
    metric: 100,
    metrics: {},
    status: "keep",
    description: "test",
    timestamp: Date.now(),
    segment: 0,
    confidence: null,
    ...overrides,
  };
}

function writeJsonl(dir: string, lines: object[]) {
  writeFileSync(join(dir, "autoresearch.jsonl"), lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
}

describe("generateHTML", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "ar-html-"));
    try {
      execSync(
        "git init && git config user.email test@test.com && git config user.name Test && git commit --allow-empty -m init",
        { cwd: dir, stdio: "ignore" }
      );
    } catch {
      console.warn("[test] git init failed — some tests may behave differently");
    }
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("produces valid HTML with doctype and closing tags", () => {
    writeJsonl(dir, [makeConfig(), makeRun()]);
    const html = generateHTML(dir);

    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("<html>");
    expect(html).toContain("</html>");
    expect(html).toContain("<head>");
    expect(html).toContain("</head>");
    expect(html).toContain("<body>");
    expect(html).toContain("</body>");
  });

  it("includes the experiment name in the title and header", () => {
    writeJsonl(dir, [makeConfig({ name: "My Experiment" }), makeRun()]);
    const html = generateHTML(dir);

    expect(html).toContain("<title>Autoresearch — My Experiment</title>");
    expect(html).toContain("My Experiment");
  });

  it("includes Chart.js CDN script", () => {
    writeJsonl(dir, [makeConfig(), makeRun()]);
    const html = generateHTML(dir);
    expect(html).toContain("cdn.jsdelivr.net/npm/chart.js");
  });

  it("includes marked.js CDN script", () => {
    writeJsonl(dir, [makeConfig(), makeRun()]);
    const html = generateHTML(dir);
    expect(html).toContain("cdn.jsdelivr.net/npm/marked");
  });

  it("embeds run data as JSON", () => {
    writeJsonl(dir, [
      makeConfig(),
      makeRun({ run: 1, commit: "aaa1111", metric: 42 }),
      makeRun({ run: 2, commit: "bbb2222", metric: 38, status: "keep" }),
    ]);
    const html = generateHTML(dir);

    // Data should be embedded in a script tag
    expect(html).toContain('"metric":42');
    expect(html).toContain('"metric":38');
    expect(html).toContain('"commit":"aaa1111"');
  });

  it("includes CSS styles", () => {
    writeJsonl(dir, [makeConfig(), makeRun()]);
    const html = generateHTML(dir);

    expect(html).toContain("<style>");
    expect(html).toMatch(/--bg:/);
    expect(html).toMatch(/--accent:/);
  });

  it("includes the client-side dashboard JS", () => {
    writeJsonl(dir, [makeConfig(), makeRun()]);
    const html = generateHTML(dir);

    expect(html).toContain("renderDashboard()");
    expect(html).toContain("renderPlan()");
    expect(html).toContain("renderIdeas()");
  });

  it("shows direction indicator in subtitle", () => {
    writeJsonl(dir, [makeConfig({ bestDirection: "lower" }), makeRun()]);
    const html = generateHTML(dir);
    expect(html).toContain("↓ lower");

    writeJsonl(dir, [makeConfig({ bestDirection: "higher" }), makeRun()]);
    const html2 = generateHTML(dir);
    expect(html2).toContain("↑ higher");
  });

  it("includes metric unit in subtitle when present", () => {
    writeJsonl(dir, [makeConfig({ metricUnit: "µs" }), makeRun()]);
    const html = generateHTML(dir);
    expect(html).toContain("(µs)");
  });

  it("embeds plan content when autoresearch.md exists", () => {
    writeJsonl(dir, [makeConfig(), makeRun()]);
    writeFileSync(join(dir, "autoresearch.md"), "# My Plan\n\nSome content here.");
    const html = generateHTML(dir);
    expect(html).toContain("My Plan");
    expect(html).toContain("Some content here.");
  });

  it("embeds ideas content when autoresearch.ideas.md exists", () => {
    writeJsonl(dir, [makeConfig(), makeRun()]);
    writeFileSync(join(dir, "autoresearch.ideas.md"), "# Ideas\n\n- Try caching");
    const html = generateHTML(dir);
    expect(html).toContain("Ideas");
    expect(html).toContain("Try caching");
  });

  it("handles missing plan and ideas gracefully", () => {
    writeJsonl(dir, [makeConfig(), makeRun()]);
    const html = generateHTML(dir);
    // Should still produce valid HTML even without plan/ideas
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("</html>");
  });

  it("escapes HTML entities in config name", () => {
    writeJsonl(dir, [makeConfig({ name: '<script>alert("xss")</script>' }), makeRun()]);
    const html = generateHTML(dir);
    expect(html).not.toContain('<script>alert("xss")</script>');
    expect(html).toContain("&lt;script&gt;");
  });

  it("produces default content when no data exists", () => {
    writeFileSync(join(dir, "autoresearch.jsonl"), "");
    const html = generateHTML(dir);
    expect(html).toContain("Autoresearch Studio");
    expect(html).toContain("<!DOCTYPE html>");
  });

  it("includes tab navigation", () => {
    writeJsonl(dir, [makeConfig(), makeRun()]);
    const html = generateHTML(dir);
    expect(html).toContain("Dashboard");
    expect(html).toContain("Plan");
    expect(html).toContain("Ideas");
    expect(html).toContain("nav-tab");
  });

  it("includes secondary metrics in embedded data", () => {
    writeJsonl(dir, [makeConfig(), makeRun({ metrics: { dep_only: 100, layer_only: 50 } })]);
    const html = generateHTML(dir);
    expect(html).toContain('"dep_only"');
    expect(html).toContain('"layer_only"');
  });
});
