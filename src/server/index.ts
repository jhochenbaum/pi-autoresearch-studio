import { createServer, type Server } from "node:http";
import { generateToken } from "./auth.js";
import { handleRequest } from "./routes.js";
import { WebSocketManager } from "./websocket.js";
import { clearAssetCache } from "../html/utils.js";

export interface ActivityEvent {
  /** Event kind: what happened */
  kind:
    | "agent_start"
    | "agent_end"
    | "message"
    | "tool_start"
    | "tool_update"
    | "tool_end"
    | "tool_call"
    | "tool_result";
  /** Timestamp (ms since epoch) */
  ts: number;
  /** Event-specific payload */
  data: Record<string, unknown>;
}

export interface StudioServer {
  /** The URL to open in the browser. */
  url: string;
  /** Stop the server and clean up. */
  stop(): void;
  /** Whether the server is still running. */
  isRunning(): boolean;
  /** Broadcast a live agent activity event to all connected web clients. */
  broadcastActivity(event: ActivityEvent): void;
}

export interface StudioServerOptions {
  /** Called when the web UI triggers an autoresearch start. */
  triggerStartAutoresearch?: (goal: string) => Promise<void>;
  /** Called when the web UI triggers a dry run. Returns the report text. onProgress streams status updates. */
  triggerDryRun?: (hashes: string[], onProgress?: (message: string) => void) => Promise<string>;
}

/** Start the studio server on a random port, bound to 127.0.0.1 only. */
export function startServer(cwd: string, _options?: StudioServerOptions): Promise<StudioServer> {
  clearAssetCache();
  return new Promise((resolve, reject) => {
    const token = generateToken();
    const options = _options ?? {};
    const server: Server = createServer((req, res) => handleRequest(req, res, cwd, token, options));
    const wsManager = new WebSocketManager(server, token, cwd);
    let running = true;

    server.once("error", reject);
    server.once("close", () => {
      running = false;
    });

    // Listen on random port, localhost only
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("Failed to get server address"));
        return;
      }

      wsManager.start();

      const url = `http://127.0.0.1:${addr.port}`;
      resolve({
        url,
        stop() {
          if (!running) {
            return;
          }
          wsManager.stop();
          server.close();
          server.closeAllConnections();
          running = false;
        },
        isRunning() {
          return running;
        },
        broadcastActivity(event: ActivityEvent) {
          if (!running) return;
          wsManager.broadcast(JSON.stringify({ type: "activity", event }));
        },
      });
    });
  });
}
