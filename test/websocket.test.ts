import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import WebSocket from "ws";
import { startServer, type StudioServer } from "../src/server/index.js";

function makeConfig() {
  return {
    type: "config",
    name: "WS Test",
    metricName: "ms",
    metricUnit: "ms",
    bestDirection: "lower",
  };
}

function makeRun(n: number) {
  return {
    run: n,
    commit: `abc${n}`,
    metric: 100 - n,
    metrics: {},
    status: "keep",
    description: `run ${n}`,
    timestamp: Date.now(),
    segment: 0,
    confidence: null,
  };
}

function writeJsonl(dir: string, lines: object[]) {
  writeFileSync(join(dir, "autoresearch.jsonl"), lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
}

describe("WebSocket live updates", () => {
  let dir: string;
  let server: StudioServer;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "ar-ws-"));
    writeJsonl(dir, [makeConfig(), makeRun(1)]);
    writeFileSync(join(dir, "autoresearch.md"), "# Plan");
    writeFileSync(join(dir, "autoresearch.ideas.md"), "# Ideas");
    server = await startServer(dir);
  });

  afterAll(() => {
    server.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  it("rejects WebSocket connection without auth cookie", async () => {
    const ws = new WebSocket(`${server.url.replace("http", "ws")}/ws`);
    const error = await new Promise<string>((resolve) => {
      ws.on("error", () => resolve("error"));
      ws.on("unexpected-response", (_req, res) => resolve(`${res.statusCode}`));
      ws.on("open", () => resolve("open"));
    });
    expect(error).toBe("401");
    ws.close();
  });

  it("accepts WebSocket connection with valid auth cookie", async () => {
    // Get cookie from page load
    const pageRes = await fetch(server.url);
    const cookies = pageRes.headers.get("set-cookie") ?? "";
    const token = cookies.match(/_ars_token=([^;]+)/)?.[1];

    const ws = new WebSocket(`${server.url.replace("http", "ws")}/ws`, {
      headers: { Cookie: `_ars_token=${token}` },
    });

    const opened = await new Promise<boolean>((resolve) => {
      ws.on("open", () => resolve(true));
      ws.on("error", () => resolve(false));
      setTimeout(() => resolve(false), 2000);
    });

    expect(opened).toBe(true);
    ws.close();
  });

  it("rejects upgrade on invalid websocket path", async () => {
    const pageRes = await fetch(server.url);
    const cookies = pageRes.headers.get("set-cookie") ?? "";
    const token = cookies.match(/_ars_token=([^;]+)/)?.[1];

    const ws = new WebSocket(`${server.url.replace("http", "ws")}/not-ws`, {
      headers: { Cookie: `_ars_token=${token}` },
    });

    const status = await new Promise<string>((resolve) => {
      ws.on("unexpected-response", (_req, res) => resolve(`${res.statusCode}`));
      ws.on("error", () => resolve("error"));
      ws.on("open", () => resolve("open"));
    });

    expect(status).toBe("404");
    ws.close();
  });

  it("rejects websocket origin outside localhost", async () => {
    const pageRes = await fetch(server.url);
    const cookies = pageRes.headers.get("set-cookie") ?? "";
    const token = cookies.match(/_ars_token=([^;]+)/)?.[1];

    const ws = new WebSocket(`${server.url.replace("http", "ws")}/ws`, {
      headers: {
        Cookie: `_ars_token=${token}`,
        Origin: "http://evil.example.com",
      },
    });

    const status = await new Promise<string>((resolve) => {
      ws.on("unexpected-response", (_req, res) => resolve(`${res.statusCode}`));
      ws.on("error", () => resolve("error"));
      ws.on("open", () => resolve("open"));
    });

    expect(status).toBe("403");
    ws.close();
  });

  it("broadcasts update when autoresearch.jsonl changes", async () => {
    const pageRes = await fetch(server.url);
    const cookies = pageRes.headers.get("set-cookie") ?? "";
    const token = cookies.match(/_ars_token=([^;]+)/)?.[1];

    const ws = new WebSocket(`${server.url.replace("http", "ws")}/ws`, {
      headers: { Cookie: `_ars_token=${token}` },
    });

    await new Promise<void>((resolve) => ws.on("open", resolve));

    // Listen for message
    const messagePromise = new Promise<string>((resolve) => {
      ws.on("message", (data) => resolve(data.toString()));
    });

    // Trigger a file change
    appendFileSync(join(dir, "autoresearch.jsonl"), JSON.stringify(makeRun(2)) + "\n");

    // Wait for broadcast (debounce is 300ms)
    const msg = await Promise.race([
      messagePromise,
      new Promise<string>((resolve) => setTimeout(() => resolve("timeout"), 7000)),
    ]);

    expect(msg).not.toBe("timeout");
    const parsed = JSON.parse(msg);
    expect(parsed.type).toBe("update");
    expect(parsed.data.runs.length).toBe(2);

    ws.close();
  });
});
