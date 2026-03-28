import type { IncomingMessage, ServerResponse } from "node:http";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { collectDashboardData } from "../data/collect.js";
import { getOrGenerateWinExplanation } from "../data/explain.js";
import { parseJsonl } from "../data/parser.js";
import { setAuthCookie, verifyAuth, sendUnauthorized } from "./auth.js";
import { buildPageHTML } from "./html.js";
import type { StudioServerOptions } from "./index.js";

// Re-export for WebSocket manager
export { collectDashboardData as collectData } from "../data/collect.js";

const ALLOWED_FILES: Record<string, string> = {
  plan: "autoresearch.md",
  ideas: "autoresearch.ideas.md",
};

const MAX_BODY_BYTES = 10 * 1024 * 1024; // 10 MB

class BodyTooLargeError extends Error {
  constructor() {
    super("Body too large");
    this.name = "BodyTooLargeError";
  }
}

/** Parse JSON body from a request with size limit. */
function parseBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let done = false;

    req.on("data", (chunk: Buffer) => {
      if (done) {
        return;
      }
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        done = true;
        req.removeAllListeners("data");
        req.resume();
        reject(new BodyTooLargeError());
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => {
      if (!done) {
        resolve(Buffer.concat(chunks).toString("utf-8"));
      }
    });

    req.on("error", (error) => {
      if (!done) {
        reject(error);
      }
    });
  });
}

/** Handle all HTTP requests. */
export function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  cwd: string,
  token: string,
  options?: StudioServerOptions
): void {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
  const path = url.pathname;

  // ── Serve dashboard HTML (sets cookie) ──
  if (path === "/" && req.method === "GET") {
    const data = collectDashboardData(cwd);
    const html = buildPageHTML(data);
    setAuthCookie(res, token);
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
    return;
  }

  // ── All API routes require auth ──
  if (path.startsWith("/api/")) {
    if (!verifyAuth(req, token)) {
      sendUnauthorized(res);
      return;
    }

    // GET /api/data — return current data as JSON
    if (path === "/api/data" && req.method === "GET") {
      const data = collectDashboardData(cwd);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data));
      return;
    }

    // GET /api/explain — explain a win for a commit hash
    if (path === "/api/explain" && req.method === "GET") {
      const commit = (url.searchParams.get("commit") ?? "").trim();
      if (!commit) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Missing commit query parameter" }));
        return;
      }

      (async () => {
        const { configs, runs } = parseJsonl(cwd);
        if (configs.length === 0) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "No configuration found" }));
          return;
        }
        const result = await getOrGenerateWinExplanation(cwd, configs[configs.length - 1], runs, commit);
        if (!result) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "No explanation available for this commit" }));
          return;
        }

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            commit,
            explanation: result.explanation,
            source: result.source,
            model: result.model,
            cached: result.cached,
            promptVersion: result.promptVersion,
          })
        );
      })().catch(() => {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Failed to generate explanation" }));
      });
      return;
    }

    // POST /api/new — start a new autoresearch session
    if (path === "/api/new" && req.method === "POST") {
      if (!options?.triggerStartAutoresearch) {
        res.writeHead(501, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Start not available in standalone mode" }));
        return;
      }
      parseBody(req)
        .then(async (body) => {
          let parsed: { goal?: string };
          try {
            parsed = JSON.parse(body);
          } catch {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Invalid JSON" }));
            return;
          }
          const goal = (parsed.goal ?? "").trim();
          if (!goal) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Missing goal" }));
            return;
          }
          await options.triggerStartAutoresearch!(goal);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, goal }));
        })
        .catch(() => {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Internal error" }));
        });
      return;
    }

    // POST /api/dryrun — test dependency resolution
    if (path === "/api/dryrun" && req.method === "POST") {
      if (!options?.triggerDryRun) {
        res.writeHead(501, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Dry run not available in standalone mode" }));
        return;
      }
      parseBody(req)
        .then(async (body) => {
          let parsed: { hashes?: string[] };
          try {
            parsed = JSON.parse(body);
          } catch {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Invalid JSON" }));
            return;
          }
          const hashes = parsed.hashes ?? [];
          if (hashes.length === 0) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "No hashes provided" }));
            return;
          }
          res.writeHead(200, {
            "Content-Type": "text/plain; charset=utf-8",
            "Transfer-Encoding": "chunked",
            "Cache-Control": "no-cache",
          });
          const report = await options.triggerDryRun!(hashes, (msg: string) => {
            try {
              res.write(JSON.stringify({ type: "progress", message: msg }) + "\n");
            } catch {}
          });
          res.end(JSON.stringify({ type: "result", ok: true, report }) + "\n");
        })
        .catch((err) => {
          if (!res.headersSent) {
            res.writeHead(500, { "Content-Type": "application/json" });
          }
          res.end(JSON.stringify({ type: "result", ok: false, error: err?.message ?? "Internal error" }) + "\n");
        });
      return;
    }

    // POST /api/save — save plan or ideas
    if (path === "/api/save" && req.method === "POST") {
      parseBody(req)
        .then(async (body) => {
          let parsed: { file?: string; content?: string };
          try {
            parsed = JSON.parse(body);
          } catch {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Invalid JSON" }));
            return;
          }

          const filename = ALLOWED_FILES[parsed.file ?? ""];
          if (!filename) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: 'Invalid file. Use "plan" or "ideas".' }));
            return;
          }

          if (typeof parsed.content !== "string") {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Missing content" }));
            return;
          }

          const filePath = join(cwd, filename);
          await writeFile(filePath, parsed.content, "utf-8");
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, file: filename }));
        })
        .catch((error: unknown) => {
          if (error instanceof BodyTooLargeError) {
            res.writeHead(413, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Payload too large" }));
            return;
          }
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Internal error" }));
        });
      return;
    }
  }

  // ── 404 ──
  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not found");
}
