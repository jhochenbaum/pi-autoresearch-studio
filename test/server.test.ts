import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startServer, type StudioServer } from "../src/server/index.js";

function makeConfig(overrides = {}) {
  return {
    type: "config",
    name: "Server Test",
    metricName: "ms",
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

function resetDir(dir: string) {
  writeJsonl(dir, [makeConfig(), makeRun()]);
  writeFileSync(join(dir, "autoresearch.md"), "# Test Plan\n\nSome content.");
  writeFileSync(join(dir, "autoresearch.ideas.md"), "# Ideas\n\n- Idea 1");
}

describe("Studio Server", () => {
  let dir: string;
  let server: StudioServer;
  let token: string;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "ar-server-"));
    resetDir(dir);
    server = await startServer(dir);
    // Pre-fetch token once
    const pageRes = await fetch(server.url);
    const cookies = pageRes.headers.get("set-cookie") ?? "";
    token = cookies.match(/_ars_token=([^;]+)/)?.[1] ?? "";
  });

  afterAll(() => {
    server.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  it("starts on a random port", () => {
    expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  });

  it("tracks running state", async () => {
    expect(server.isRunning()).toBe(true);
    server.stop();
    expect(server.isRunning()).toBe(false);

    // restore server for remaining tests
    server = await startServer(dir);
    expect(server.isRunning()).toBe(true);
    // Re-fetch token since server changed
    const pageRes = await fetch(server.url);
    const cookies = pageRes.headers.get("set-cookie") ?? "";
    token = cookies.match(/_ars_token=([^;]+)/)?.[1] ?? "";
  });

  it("serves the dashboard HTML with auth cookie", async () => {
    const res = await fetch(server.url);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");

    const cookies = res.headers.get("set-cookie") ?? "";
    expect(cookies).toContain("_ars_token=");
    expect(cookies).toContain("HttpOnly");
    expect(cookies).toContain("SameSite=Strict");

    const html = await res.text();
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("Server Test");
  });

  it("returns 401 for /api/data without cookie", async () => {
    const res = await fetch(`${server.url}/api/data`);
    expect(res.status).toBe(401);
  });

  it("returns data with valid cookie", async () => {
    resetDir(dir);
    const res = await fetch(`${server.url}/api/data`, {
      headers: { Cookie: `_ars_token=${token}` },
    });
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.config.name).toBe("Server Test");
    expect(data.runs).toHaveLength(1);
    expect(data.plan).toContain("Test Plan");
    expect(data.ideas).toContain("Idea 1");
  });

  it("saves plan file via /api/save", async () => {
    resetDir(dir);
    const res = await fetch(`${server.url}/api/save`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `_ars_token=${token}`,
      },
      body: JSON.stringify({ file: "plan", content: "# Updated Plan\n\nNew content." }),
    });
    expect(res.status).toBe(200);

    const saved = readFileSync(join(dir, "autoresearch.md"), "utf-8");
    expect(saved).toBe("# Updated Plan\n\nNew content.");
  });

  it("saves ideas file via /api/save", async () => {
    resetDir(dir);
    const res = await fetch(`${server.url}/api/save`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `_ars_token=${token}`,
      },
      body: JSON.stringify({ file: "ideas", content: "# New Ideas\n\n- Better idea" }),
    });
    expect(res.status).toBe(200);

    const saved = readFileSync(join(dir, "autoresearch.ideas.md"), "utf-8");
    expect(saved).toBe("# New Ideas\n\n- Better idea");
  });

  it("rejects save for invalid file key", async () => {
    const res = await fetch(`${server.url}/api/save`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `_ars_token=${token}`,
      },
      body: JSON.stringify({ file: "secrets", content: "hacked" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("Invalid file");
  });

  it("rejects save without auth", async () => {
    resetDir(dir);
    const res = await fetch(`${server.url}/api/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file: "plan", content: "nope" }),
    });
    expect(res.status).toBe(401);

    // Verify file was NOT modified
    const content = readFileSync(join(dir, "autoresearch.md"), "utf-8");
    expect(content).toContain("Test Plan");
  });

  it("returns explanation for a valid commit", async () => {
    resetDir(dir);
    // Ensure heuristic mode (no LLM API call) for fast test
    const savedKey = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;

    const res = await fetch(`${server.url}/api/explain?commit=abc1234`, {
      headers: { Cookie: `_ars_token=${token}` },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.explanation).toBe("string");
    expect(body.explanation.length).toBeGreaterThan(40);
    expect(["llm", "heuristic"]).toContain(body.source);

    // Restore API key
    if (savedKey !== undefined) process.env.OPENAI_API_KEY = savedKey;
  });

  it("returns 404 for unknown explain commit", async () => {
    const res = await fetch(`${server.url}/api/explain?commit=deadbeef`, {
      headers: { Cookie: `_ars_token=${token}` },
    });

    expect(res.status).toBe(404);
  });

  it("returns 404 for unknown routes", async () => {
    const res = await fetch(`${server.url}/unknown`);
    expect(res.status).toBe(404);
  });

  it("rejects save with invalid JSON body", async () => {
    const res = await fetch(`${server.url}/api/save`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `_ars_token=${token}`,
      },
      body: "not json {{{",
    });
    expect(res.status).toBe(400);
  });

  it("rejects save with missing content", async () => {
    const res = await fetch(`${server.url}/api/save`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `_ars_token=${token}`,
      },
      body: JSON.stringify({ file: "plan" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("Missing content");
  });

  it("returns 413 for oversized save payload", async () => {
    const oversized = "x".repeat(10 * 1024 * 1024 + 1);
    const res = await fetch(`${server.url}/api/save`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `_ars_token=${token}`,
      },
      body: JSON.stringify({ file: "plan", content: oversized }),
    });

    expect(res.status).toBe(413);
    const body = await res.json();
    expect(body.error).toContain("Payload too large");
  });
});
