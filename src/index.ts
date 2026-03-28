/**
 * Autoresearch Studio
 *
 * Unified extension for autoresearch workflows. All commands under /arstudio:
 *
 *   /arstudio                  TUI dashboard (charts, metrics, experiment log)
 *   /arstudio web              Open web dashboard (starts local server)
 *   /arstudio web stop         Stop the web server
 *   /arstudio plan             View autoresearch.md (scrollable, highlighted)
 *   /arstudio plan edit        Edit autoresearch.md in pi's editor
 *   /arstudio ideas            View autoresearch.ideas.md
 *   /arstudio ideas edit       Edit autoresearch.ideas.md
 *   /arstudio pr               Cherry-pick selected commits into a draft PR
 *   /arstudio pr <hashes>      Cherry-pick specific commits
 *   /arstudio new [goal]       Start a new autoresearch session
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { join } from "node:path";
import { startServer, type StudioServer, type ActivityEvent } from "./server/index.js";
import { showApp, editFile, type View } from "./tui/app.js";
import { getBranchCommits, executePR, type PRMode } from "./data/git.js";
import { parseJsonl } from "./data/parser.js";

function normalizeAutoresearchGoal(goal: string): string {
  return goal.trim().replace(/\s+/g, " ");
}

export default function autoresearchStudio(pi: ExtensionAPI) {
  let server: StudioServer | null = null;
  let serverCwd: string | null = null;

  async function launchNewAutoresearch(ctx: ExtensionCommandContext, goal: string): Promise<void> {
    const normalizedGoal = normalizeAutoresearchGoal(goal);
    if (!normalizedGoal) {
      ctx.ui.notify("Enter goal text first.", "warning");
      return;
    }

    if (!ctx.isIdle()) {
      ctx.ui.notify("Pi is busy — try again when idle.", "warning");
      return;
    }

    const currentSessionFile = ctx.sessionManager.getSessionFile();
    const result = await ctx.newSession({
      parentSession: currentSessionFile,
    });
    if (result.cancelled) {
      ctx.ui.notify("Cancelled.", "info");
      return;
    }

    pi.sendUserMessage(`/autoresearch ${normalizedGoal}`);
    ctx.ui.notify("Opened a fresh session and launched autoresearch.", "info");
  }

  async function ensureServer(cwd: string): Promise<StudioServer> {
    // Restart if cwd changed (different project) or server is stale/dead
    if (server && (serverCwd !== cwd || !server.isRunning())) {
      server.stop();
      server = null;
      serverCwd = null;
    }
    if (!server) {
      server = await startServer(cwd, {
        triggerStartAutoresearch: async (goal: string) => {
          const normalizedGoal = normalizeAutoresearchGoal(goal);
          pi.sendUserMessage(`/autoresearch ${normalizedGoal}`);
        },
        triggerDryRun: async (hashes: string[], onProgress?: (msg: string) => void) => {
          const { dryRunPR, getBranchCommits } = await import("./data/git.js");
          const branchCommits = await getBranchCommits(pi, cwd);
          let currentBranch = "";
          try {
            const branchResult = await pi.exec("git", ["branch", "--show-current"], { cwd });
            currentBranch = branchResult.stdout.trim();
          } catch {}
          return dryRunPR(pi, cwd, hashes, branchCommits, currentBranch, onProgress);
        },
      });
      serverCwd = cwd;
    }
    return server;
  }

  function stopServer(): void {
    if (server) {
      server.stop();
      server = null;
      serverCwd = null;
    }
  }

  pi.registerCommand("arstudio", {
    description: "Autoresearch studio. /arstudio [web|plan|ideas|pr|new]",
    getArgumentCompletions: (prefix: string) => {
      const cmds = [
        { value: "", label: "(app)", description: "Open unified TUI app" },
        { value: "web", label: "web", description: "Open web dashboard in browser" },
        { value: "web stop", label: "web stop", description: "Stop the web server" },
        { value: "plan", label: "plan", description: "Open app on Plan tab" },
        { value: "plan edit", label: "plan edit", description: "Edit autoresearch.md directly" },
        { value: "ideas", label: "ideas", description: "Open app on Ideas tab" },
        { value: "ideas edit", label: "ideas edit", description: "Edit ideas directly" },
        { value: "pr", label: "pr", description: "Create PR from commits (or use space in dashboard)" },

        { value: "new", label: "new", description: "Start a new autoresearch session" },
      ];
      const filtered = cmds.filter((c) => c.value.startsWith(prefix));
      return filtered.length > 0 ? filtered : null;
    },
    handler: async (args, ctx) => {
      const cwd = ctx.cwd;
      const parts = (args ?? "").trim().split(/\s+/);
      const sub = parts[0]?.toLowerCase() ?? "";
      const rest = parts.slice(1).join(" ").trim();

      if (sub === "web") {
        if (rest === "stop") {
          if (server) {
            stopServer();
            ctx.ui.notify("Web server stopped.", "info");
          } else {
            ctx.ui.notify("No server running.", "info");
          }
          return;
        }

        const s = await ensureServer(cwd);
        try {
          if (process.platform === "darwin") {
            await pi.exec("open", [s.url]);
          } else if (process.platform === "linux") {
            await pi.exec("xdg-open", [s.url]);
          } else {
            await pi.exec("cmd", ["/c", "start", "", s.url]);
          }
        } catch {}
        ctx.ui.notify(`Web dashboard → ${s.url}`, "info");
        return;
      }

      if (sub === "plan" && rest === "edit") {
        await editFile(join(cwd, "autoresearch.md"), "autoresearch.md", ctx);
        return;
      }

      if (sub === "ideas" && rest === "edit") {
        await editFile(join(cwd, "autoresearch.ideas.md"), "autoresearch.ideas.md", ctx);
        return;
      }

      // PR subcommand — /arstudio pr <hash1> <hash2> ...
      if (sub === "pr") {
        const hashes = rest.split(/\s+/).filter(Boolean);
        if (hashes.length === 0) {
          ctx.ui.notify("Usage: /arstudio pr <commit-hash> [hash2] ...", "warning");
          return;
        }

        const n = hashes.length;
        const modeChoices = [
          `Consolidated — 1 PR with all ${n} commits`,
          `Stacked — ${n} chained PRs, each targeting the previous`,
          `Individual — ${n} independent PRs`,
        ];
        const modeChoice = await ctx.ui.select(`Create PR from ${n} experiments:`, modeChoices);
        if (modeChoice == null) {
          return;
        }
        const modeMap: PRMode[] = ["consolidated", "stacked", "individual"];
        const mode = modeMap[modeChoices.indexOf(modeChoice)];

        const branchCommits = await getBranchCommits(pi, cwd);
        const { configs, runs } = parseJsonl(cwd);
        const lastConfig = configs[configs.length - 1];
        let currentBranch = "";
        try {
          const branchResult = await pi.exec("git", ["branch", "--show-current"], { cwd });
          currentBranch = branchResult.stdout.trim();
        } catch {}

        const modelInfo = ctx.model ? `${ctx.model.name} (${ctx.model.provider})` : undefined;
        await executePR(pi, cwd, hashes, branchCommits, lastConfig, runs, currentBranch, mode, ctx, modelInfo);
        return;
      }

      // New session subcommand — /arstudio new [goal]
      if (sub === "new") {
        const goal = rest || undefined;
        if (goal) {
          await launchNewAutoresearch(ctx, goal);
        } else {
          // No goal provided — show input prompt
          const { promptAutoresearchGoal } = await import("./tui/app.js");
          const prompted = await promptAutoresearchGoal(ctx);
          if (prompted) {
            await launchNewAutoresearch(ctx, prompted);
          }
        }
        return;
      }

      // Map subcommand to starting view
      const viewMap: Record<string, View> = { plan: "plan", ideas: "ideas" };
      const startView: View = viewMap[sub] ?? "dashboard";
      return showApp(
        pi,
        cwd,
        startView,
        ctx,
        async () => {
          const s = await ensureServer(cwd);
          try {
            if (process.platform === "darwin") {
              await pi.exec("open", [s.url]);
            } else if (process.platform === "linux") {
              await pi.exec("xdg-open", [s.url]);
            } else {
              await pi.exec("cmd", ["/c", "start", "", s.url]);
            }
          } catch {}
        },
        async (goal: string) => {
          await launchNewAutoresearch(ctx, goal);
        }
      );
    },
  });

  pi.on("session_shutdown", async () => {
    stopServer();
  });

  // ── Live agent activity feed → web UI ──

  function emitActivity(event: ActivityEvent): void {
    if (server?.isRunning()) {
      server.broadcastActivity(event);
    }
  }

  function textFromContent(content: Array<{ type: string; text?: string }>): string {
    return content
      .filter((c) => c.type === "text" && c.text)
      .map((c) => c.text!)
      .join("\n");
  }

  pi.on("agent_start", async () => {
    emitActivity({ kind: "agent_start", ts: Date.now(), data: {} });
  });

  pi.on("agent_end", async () => {
    emitActivity({ kind: "agent_end", ts: Date.now(), data: {} });
  });

  pi.on("message_start", async (event) => {
    const msg = event.message;
    if (msg.role === "assistant" && msg.content) {
      const text =
        typeof msg.content === "string"
          ? msg.content
          : textFromContent(msg.content as Array<{ type: string; text?: string }>);
      if (text) {
        emitActivity({ kind: "message", ts: Date.now(), data: { role: "assistant", text } });
      }
    }
  });

  pi.on("message_update", async (event) => {
    const msg = event.message;
    if (msg.role === "assistant" && msg.content) {
      const text =
        typeof msg.content === "string"
          ? msg.content
          : textFromContent(msg.content as Array<{ type: string; text?: string }>);
      if (text) {
        emitActivity({ kind: "message", ts: Date.now(), data: { role: "assistant", text, streaming: true } });
      }
    }
  });

  pi.on("tool_execution_start", async (event) => {
    emitActivity({
      kind: "tool_start",
      ts: Date.now(),
      data: { toolName: event.toolName, toolCallId: event.toolCallId, args: event.args },
    });
  });

  pi.on("tool_execution_update", async (event) => {
    let text = "";
    try {
      const pr = event.partialResult;
      if (pr && Array.isArray(pr)) {
        text = textFromContent(pr);
      } else if (typeof pr === "string") {
        text = pr;
      }
    } catch {}
    emitActivity({
      kind: "tool_update",
      ts: Date.now(),
      data: { toolName: event.toolName, toolCallId: event.toolCallId, text },
    });
  });

  pi.on("tool_execution_end", async (event) => {
    let text = "";
    try {
      const r = event.result;
      if (r && r.content && Array.isArray(r.content)) {
        text = textFromContent(r.content);
      } else if (typeof r === "string") {
        text = r;
      }
    } catch {}
    emitActivity({
      kind: "tool_end",
      ts: Date.now(),
      data: { toolName: event.toolName, toolCallId: event.toolCallId, text, isError: event.isError },
    });
  });
}
