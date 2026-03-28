import { WebSocketServer, type WebSocket } from "ws";
import type { Server } from "node:http";
import type { IncomingMessage } from "node:http";
import { watch, type FSWatcher } from "node:fs";
import { getAuthCookie, verifyToken } from "./auth.js";
import { collectData } from "./routes.js";

interface WSClient {
  ws: WebSocket;
  isAlive: boolean;
}

function isAllowedOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return url.hostname === "127.0.0.1" || url.hostname === "localhost";
  } catch {
    return false;
  }
}

/** Manages WebSocket connections and file watching for live updates. */
export class WebSocketManager {
  private wss: WebSocketServer;
  private clients: Set<WSClient> = new Set();
  private watcher: FSWatcher | null = null;
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private token: string;
  private cwd: string;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(server: Server, token: string, cwd: string) {
    this.token = token;
    this.cwd = cwd;

    this.wss = new WebSocketServer({ noServer: true });

    // Handle upgrade requests from the HTTP server
    server.on("upgrade", (req: IncomingMessage, socket, head) => {
      const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
      if (pathname !== "/ws") {
        socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
        socket.destroy();
        return;
      }

      const origin = req.headers.origin;
      if (origin && !isAllowedOrigin(origin)) {
        socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
        socket.destroy();
        return;
      }

      // Verify auth cookie using timing-safe compare
      if (!verifyToken(getAuthCookie(req), this.token)) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }

      this.wss.handleUpgrade(req, socket, head, (ws) => {
        this.onConnection(ws);
      });
    });
  }

  /** Start watching the project directory and pinging clients. */
  start(): void {
    // Heartbeat: detect and remove dead connections
    this.heartbeatInterval = setInterval(() => {
      for (const client of this.clients) {
        if (!client.isAlive) {
          client.ws.terminate();
          this.clients.delete(client);
          continue;
        }
        client.isAlive = false;
        client.ws.ping();
      }
    }, 30_000);

    // Watch the directory — catches new files, renames, all changes
    try {
      this.watcher = watch(this.cwd, { persistent: false, recursive: false }, (_event, filename) => {
        if (
          filename === "autoresearch.jsonl" ||
          filename === "autoresearch.md" ||
          filename === "autoresearch.ideas.md"
        ) {
          this.onFileChange();
        }
      });
    } catch {
      // Fallback: no live updates if watch fails
    }
  }

  /** Stop all watchers and disconnect all clients. */
  stop(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    for (const client of this.clients) {
      client.ws.close();
    }
    this.clients.clear();
    this.wss.close();
  }

  /** Handle a new WebSocket connection. */
  private onConnection(ws: WebSocket): void {
    const client: WSClient = { ws, isAlive: true };
    this.clients.add(client);

    ws.on("pong", () => {
      client.isAlive = true;
    });

    ws.on("close", () => {
      this.clients.delete(client);
    });

    ws.on("error", () => {
      this.clients.delete(client);
    });
  }

  /** Broadcast a message to all connected clients. */
  broadcast(message: string): void {
    for (const client of this.clients) {
      if (client.ws.readyState === client.ws.OPEN) {
        client.ws.send(message);
      }
    }
  }

  /** Called when a watched file changes. Debounced to avoid rapid-fire updates. */
  private onFileChange(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      const data = collectData(this.cwd);
      this.broadcast(JSON.stringify({ type: "update", data }));
    }, 300);
  }
}
