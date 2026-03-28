import { matchesKey, truncateToWidth, type TUI, type KeybindingsManager } from "@mariozechner/pi-tui";
import type { ExtensionAPI, ExtensionCommandContext, Theme } from "@mariozechner/pi-coding-agent";
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseJsonl } from "../data/parser.js";
import { detectAutoresearchSession } from "../data/collect.js";
import { getOrGenerateWinExplanation } from "../data/explain.js";
import { getBranchCommits, executePR, dryRunPR, type PRMode } from "../data/git.js";
import { buildDashboard } from "./dashboard.js";
import { buildPlanView } from "./plan-viewer.js";
import { renderNav } from "./nav.js";
import { PLAN_VIEWER } from "./constants.js";
import { normalizeBodyLines } from "./layout.js";

export type View = "dashboard" | "plan" | "ideas";

/** Check for cancel (escape or ctrl+c) using the keybindings system.
 * pi-tui's input buffer may swallow bare \x1b when cellSizeQueryPending is true,
 * so we use the "tui.select.cancel" binding which matches both escape and ctrl+c. */
function isCancel(data: string, kb: KeybindingsManager): boolean {
  return kb.matches(data, "tui.select.cancel");
}

function intFromEnv(name: string, fallback: number, min = 0, max = 20): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

// Tuned defaults for typical pi sessions where the built-in autoresearch/status chrome
// occupies a few rows above this custom UI. Users can override per terminal/profile.
const TUI_ROW_RESERVE = intFromEnv("ARSTUDIO_TUI_ROW_RESERVE", 5, 0, 20);
const TUI_TOP_GAP = intFromEnv("ARSTUDIO_TUI_TOP_GAP", 1, 0, 10);

function wrapTextLines(text: string, width: number): string[] {
  const maxWidth = Math.max(10, width);
  const out: string[] = [];
  for (const rawLine of text.split("\n")) {
    if (rawLine.length <= maxWidth) {
      out.push(rawLine);
      continue;
    }
    let rest = rawLine;
    while (rest.length > maxWidth) {
      out.push(rest.slice(0, maxWidth));
      rest = rest.slice(maxWidth);
    }
    if (rest.length > 0) {
      out.push(rest);
    }
  }
  return out;
}

function normalizeAutoresearchGoal(goal: string): string {
  return goal.trim().replace(/\s+/g, " ");
}

export async function promptAutoresearchGoal(ctx: ExtensionCommandContext): Promise<string | undefined> {
  const value = await ctx.ui.input(
    [
      "What should autoresearch optimize?",
      "",
      "Examples:",
      "- optimize unit test runtime, monitor correctness",
      "- model training, run 5 minutes of train.py and note the loss ratio as optimization target",
    ].join("\n"),
    "optimize unit test runtime, monitor correctness"
  );
  if (value == null) {
    return undefined;
  }
  const goal = normalizeAutoresearchGoal(value);
  if (!goal) {
    ctx.ui.notify("Enter goal text first.", "warning");
    return undefined;
  }
  return goal;
}

function buildNoSessionView(
  theme: Theme,
  contentH: number,
  width: number,
  inputState?: { value: string; cursor: number }
): string[] {
  const t = theme;
  const clamp = (line: string): string => truncateToWidth(line, width);

  if (inputState) {
    const before = inputState.value.slice(0, inputState.cursor);
    const atCursor = inputState.value[inputState.cursor] ?? " ";
    const after = inputState.value.slice(inputState.cursor + 1);
    const cursorChar = `\x1b[7m${atCursor}\x1b[27m`;
    const lines = [
      "",
      clamp(`  ${t.fg("accent", t.bold("What should autoresearch optimize?"))}`),
      "",
      clamp(`  ${t.fg("muted", "Examples:")}`),
      clamp(`  ${t.fg("dim", "- optimize unit test runtime, monitor correctness")}`),
      clamp(`  ${t.fg("dim", "- model training, run 5 minutes of train.py")}`),
      "",
      clamp(`  > ${before}${cursorChar}${after}`),
      "",
      clamp(`  ${t.fg("dim", "enter submit · esc back")}`),
    ];
    return normalizeBodyLines(lines, contentH);
  }

  const lines = [
    "",
    clamp(`  ${t.fg("accent", t.bold("Ready to optimize"))}`),
    "",
    clamp(`  ${t.fg("muted", "Describe what to optimize. Studio will run experiments,")}`),
    clamp(`  ${t.fg("muted", "track metrics, and surface the best results.")}`),
    "",
    clamp(`  ${t.fg("success", "n")} ${t.fg("text", "new session")}`),
    clamp(`  ${t.fg("success", "w")} ${t.fg("text", "open web UI")}`),
    clamp(`  ${t.fg("success", "q")} ${t.fg("text", "quit")}`),
  ];
  return normalizeBodyLines(lines, contentH);
}

async function viewReadOnlyText(title: string, text: string, ctx: ExtensionCommandContext): Promise<void> {
  let scroll = 0;
  await ctx.ui.custom<void>((tui: TUI, theme: Theme, kb: KeybindingsManager, done: () => void) => {
    return {
      render(width: number): string[] {
        const termH = tui.terminal.rows ?? 40;
        const header = truncateToWidth(
          ` ${theme.fg("accent", theme.bold(title))} ${theme.fg("dim", "(read-only · q/esc to close)")}`,
          width
        );
        const divider = truncateToWidth(theme.fg("dim", "─".repeat(Math.max(0, width - 1))), width);
        const wrapped = wrapTextLines(text, Math.max(1, width - 2));

        const bodyH = Math.max(1, termH - 3);
        const maxScroll = Math.max(0, wrapped.length - bodyH);
        scroll = Math.max(0, Math.min(scroll, maxScroll));

        const lines = [header, divider];
        for (let i = 0; i < bodyH; i++) {
          lines.push(truncateToWidth(" " + (wrapped[scroll + i] ?? ""), width));
        }
        lines.push(
          truncateToWidth(
            theme.fg("dim", ` ${scroll + 1}-${Math.min(scroll + bodyH, wrapped.length)} of ${wrapped.length} lines`),
            width
          )
        );
        return lines;
      },
      invalidate() {},
      handleInput(data: string) {
        if (isCancel(data, kb) || data === "q" || matchesKey(data, "enter")) {
          done();
          return;
        }
        if (matchesKey(data, "up") || data === "k") {
          scroll = Math.max(0, scroll - 1);
          tui.requestRender();
          return;
        }
        if (matchesKey(data, "down") || data === "j") {
          scroll += 1;
          tui.requestRender();
          return;
        }
        if (data === "g") {
          scroll = 0;
          tui.requestRender();
          return;
        }
        if (data === "G") {
          scroll = Number.MAX_SAFE_INTEGER;
          tui.requestRender();
        }
      },
    };
  });
}

function countTableRows(cwd: string): number {
  const { runs } = parseJsonl(cwd);
  let total = 0;
  let prevSeg = -1;
  for (let i = runs.length - 1; i >= 0; i--) {
    if (prevSeg !== -1 && runs[i].segment !== prevSeg) {
      total++;
    }
    prevSeg = runs[i].segment;
    total++;
  }
  return total;
}

/** Open a file in pi's editor and save changes back. */
export async function editFile(filePath: string, label: string, ctx: ExtensionCommandContext): Promise<void> {
  if (!existsSync(filePath)) {
    ctx.ui.notify(`${label} not found`, "warning");
    return;
  }
  try {
    const content = readFileSync(filePath, "utf-8");
    const edited = await ctx.ui.editor(`Edit ${label}:`, content);
    if (edited != null && edited !== content) {
      writeFileSync(filePath, edited, "utf-8");
      ctx.ui.notify(`${label} saved`, "info");
    } else {
      ctx.ui.notify("No changes", "info");
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    ctx.ui.notify(`Failed to edit ${label}: ${message.slice(0, 150)}`, "error");
  }
}

/** Launch the unified TUI app with dashboard, plan, and ideas tabs. */
export async function showApp(
  pi: ExtensionAPI,
  cwd: string,
  startView: View,
  ctx: ExtensionCommandContext,
  onOpenHTML?: () => void | Promise<void>,
  onStartAutoresearch?: (goal: string) => Promise<void>
): Promise<void> {
  if (!ctx.hasUI) {
    ctx.ui.notify("Use /arstudio web in non-interactive mode", "warning");
    return;
  }

  const mdPath = join(cwd, "autoresearch.md");
  const ideasPath = join(cwd, "autoresearch.ideas.md");

  let view: View = startView;
  let dashScroll = 0;
  let planScroll = 0;
  let ideasScroll = 0;
  const prChecked = new Set<number>();

  // Dry run state — shown as an overlay on the dashboard
  let dryRunState: { status: "running" | "done"; report: string; progress: string } | null = null;
  const spinnerFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  let spinnerIdx = 0;
  let spinnerTimer: ReturnType<typeof setInterval> | null = null;
  const viewCycle: View[] = ["dashboard", "plan", "ideas"];

  while (true) {
    // Store dashboard result for use in handleInput
    let lastDashResult: { rowCommitMap: (string | null)[]; rowStatusMap: (string | null)[] } | null = null;

    // Inline input mode state (for the goal input on the no-session screen).
    // Kept outside the custom component so it survives re-renders.
    let inputMode = false;
    let inputValue = "";
    let inputCursor = 0;

    const result = await ctx.ui.custom<string | null>(
      (tui: TUI, theme: Theme, kb: KeybindingsManager, done: (v: string | null) => void) => {
        return {
          render(width: number): string[] {
            // Reserve terminal/status chrome lines to avoid vertical overflow.
            const termH = Math.max(6, (tui.terminal.rows ?? 40) - TUI_ROW_RESERVE);
            const topGap = TUI_TOP_GAP; // breathing room between pi toolbars and arstudio nav
            const nav = renderNav(view, theme, width);
            const contentH = Math.max(1, termH - nav.length - topGap);

            let content: string[] = [];
            const hasSession = detectAutoresearchSession(cwd);

            if (!hasSession) {
              content = buildNoSessionView(
                theme,
                contentH,
                width,
                inputMode ? { value: inputValue, cursor: inputCursor } : undefined
              );
            } else if (view === "dashboard") {
              const dashResult = buildDashboard(cwd, theme, dashScroll, width, contentH, prChecked);
              content = dashResult.lines;
              lastDashResult = { rowCommitMap: dashResult.rowCommitMap, rowStatusMap: dashResult.rowStatusMap };
            } else if (view === "plan") {
              content = buildPlanView(mdPath, "autoresearch.md", theme, planScroll, contentH, width);
            } else if (view === "ideas") {
              content = buildPlanView(ideasPath, "autoresearch.ideas.md", theme, ideasScroll, contentH, width);
            }

            // Dry run overlay — replaces content when active
            if (dryRunState) {
              const t = theme;
              const clamp = (line: string): string => truncateToWidth(line, width);
              const overlayLines: string[] = [];
              overlayLines.push("");
              if (dryRunState.status === "running") {
                const spinner = spinnerFrames[spinnerIdx % spinnerFrames.length];
                overlayLines.push(clamp(`  ${t.fg("accent", spinner)}  ${t.fg("accent", t.bold("Dry Run"))}`));
                overlayLines.push("");
                overlayLines.push(clamp(`  ${t.fg("text", dryRunState.progress || "Starting…")}`));
                overlayLines.push("");
                overlayLines.push(clamp(`  ${t.fg("dim", "Testing cherry-pick strategies to determine which")}`));
                overlayLines.push(clamp(`  ${t.fg("dim", "commits can be included independently.")}`));
              } else {
                overlayLines.push(
                  clamp(`  ${t.fg("accent", t.bold("Dry Run Results"))}  ${t.fg("dim", "(q/esc to close)")}`)
                );
                overlayLines.push("");
                for (const line of dryRunState.report.split("\n")) {
                  overlayLines.push(clamp(`  ${line}`));
                }
              }
              return [...Array(topGap).fill(""), ...nav, ...normalizeBodyLines(overlayLines, contentH)];
            }

            // Keep chrome stable: nav always visible and body height consistent across tabs.
            return [...Array(topGap).fill(""), ...nav, ...normalizeBodyLines(content, contentH)];
          },
          invalidate() {},
          handleInput(data: string) {
            // Dry run overlay input — dismiss on esc/q
            if (dryRunState) {
              if (dryRunState.status === "done" && (isCancel(data, kb) || data === "q" || matchesKey(data, "enter"))) {
                if (spinnerTimer) {
                  clearInterval(spinnerTimer);
                  spinnerTimer = null;
                }
                dryRunState = null;
                tui.requestRender();
              }
              return;
            }

            const hasSession = detectAutoresearchSession(cwd);

            if (!hasSession) {
              // ── Input mode: user is typing their optimization goal ──
              if (inputMode) {
                if (isCancel(data, kb)) {
                  inputMode = false;
                  inputValue = "";
                  inputCursor = 0;
                  tui.requestRender();
                  return;
                }
                if (matchesKey(data, "enter") || data === "\n") {
                  const goal = inputValue.trim().replace(/\s+/g, " ");
                  if (goal) {
                    done(`goal:${goal}`);
                  } else {
                    // Empty — go back to menu
                    inputMode = false;
                    inputValue = "";
                    inputCursor = 0;
                    tui.requestRender();
                  }
                  return;
                }
                // Backspace
                if (matchesKey(data, "backspace") || data === "\x7f" || data === "\b") {
                  if (inputCursor > 0) {
                    inputValue = inputValue.slice(0, inputCursor - 1) + inputValue.slice(inputCursor);
                    inputCursor--;
                  }
                  tui.requestRender();
                  return;
                }
                // Delete
                if (matchesKey(data, "delete")) {
                  if (inputCursor < inputValue.length) {
                    inputValue = inputValue.slice(0, inputCursor) + inputValue.slice(inputCursor + 1);
                  }
                  tui.requestRender();
                  return;
                }
                // Cursor movement
                if (matchesKey(data, "left")) {
                  inputCursor = Math.max(0, inputCursor - 1);
                  tui.requestRender();
                  return;
                }
                if (matchesKey(data, "right")) {
                  inputCursor = Math.min(inputValue.length, inputCursor + 1);
                  tui.requestRender();
                  return;
                }
                if (matchesKey(data, "home") || matchesKey(data, "ctrl+a")) {
                  inputCursor = 0;
                  tui.requestRender();
                  return;
                }
                if (matchesKey(data, "end") || matchesKey(data, "ctrl+e")) {
                  inputCursor = inputValue.length;
                  tui.requestRender();
                  return;
                }
                // Ctrl+U — delete to start of line
                if (matchesKey(data, "ctrl+u")) {
                  inputValue = inputValue.slice(inputCursor);
                  inputCursor = 0;
                  tui.requestRender();
                  return;
                }
                // Ctrl+K — delete to end of line
                if (matchesKey(data, "ctrl+k")) {
                  inputValue = inputValue.slice(0, inputCursor);
                  tui.requestRender();
                  return;
                }
                // Ctrl+W — delete word backwards
                if (matchesKey(data, "ctrl+w")) {
                  const before = inputValue.slice(0, inputCursor);
                  const trimmed = before.replace(/\S+\s*$/, "");
                  inputValue = trimmed + inputValue.slice(inputCursor);
                  inputCursor = trimmed.length;
                  tui.requestRender();
                  return;
                }
                // Regular printable characters
                const hasControlChars = [...data].some((ch) => {
                  const code = ch.charCodeAt(0);
                  return code < 32 || code === 0x7f || (code >= 0x80 && code <= 0x9f);
                });
                if (!hasControlChars && data.length > 0) {
                  inputValue = inputValue.slice(0, inputCursor) + data + inputValue.slice(inputCursor);
                  inputCursor += data.length;
                  tui.requestRender();
                }
                return;
              }

              // ── Menu mode ──
              if (isCancel(data, kb) || data === "q") {
                done(null);
                return;
              }
              if (data === "w") {
                done("open-html");
                return;
              }
              if (data === "n") {
                inputMode = true;
                inputValue = "";
                inputCursor = 0;
                tui.requestRender();
                return;
              }
              return;
            }

            // ── Global nav (all views) ──
            if (data === "q") {
              done(null);
              return;
            }
            if (isCancel(data, kb)) {
              // On secondary views (plan/ideas), ESC goes back to dashboard
              if (view !== "dashboard") {
                view = "dashboard";
                tui.requestRender();
                return;
              }
              // On dashboard, ESC quits
              done(null);
              return;
            }
            if (data === "1") {
              view = "dashboard";
              tui.requestRender();
              return;
            }
            if (data === "2") {
              view = "plan";
              tui.requestRender();
              return;
            }
            if (data === "3") {
              view = "ideas";
              tui.requestRender();
              return;
            }
            if (matchesKey(data, "tab")) {
              view = viewCycle[(viewCycle.indexOf(view) + 1) % viewCycle.length];
              tui.requestRender();
              return;
            }
            if (matchesKey(data, "shift+tab")) {
              view = viewCycle[(viewCycle.indexOf(view) - 1 + viewCycle.length) % viewCycle.length];
              tui.requestRender();
              return;
            }
            if (data === "w") {
              done("open-html");
              return;
            }

            // ── Dashboard keys ──
            if (view === "dashboard") {
              const maxIdx = Math.max(0, countTableRows(cwd) - 1);
              const rowMap = lastDashResult?.rowCommitMap ?? [];
              const statusMap = lastDashResult?.rowStatusMap ?? [];

              if (matchesKey(data, "up") || data === "k") {
                dashScroll = Math.max(0, dashScroll - 1);
                tui.requestRender();
                return;
              }
              if (matchesKey(data, "down") || data === "j") {
                dashScroll = Math.min(dashScroll + 1, maxIdx);
                tui.requestRender();
                return;
              }
              if (data === "g") {
                dashScroll = 0;
                tui.requestRender();
                return;
              }
              if (data === "G") {
                dashScroll = maxIdx;
                tui.requestRender();
                return;
              }
              if (data === " ") {
                const commit = rowMap[dashScroll];
                if (commit) {
                  if (statusMap[dashScroll] !== "keep") {
                    ctx.ui.notify("Only kept experiments can be selected for PR", "warning");
                  } else if (prChecked.has(dashScroll)) {
                    prChecked.delete(dashScroll);
                  } else {
                    prChecked.add(dashScroll);
                  }
                }
                tui.requestRender();
                return;
              }
              if (data === "a") {
                prChecked.clear();
                rowMap.forEach((c, i) => {
                  if (c && statusMap[i] === "keep") {
                    prChecked.add(i);
                  }
                });
                tui.requestRender();
                return;
              }
              if (data === "A") {
                rowMap.forEach((c, i) => {
                  if (c && statusMap[i] === "keep") {
                    prChecked.add(i);
                  }
                });
                tui.requestRender();
                return;
              }
              if (data === "n") {
                prChecked.clear();
                tui.requestRender();
                return;
              }
              if (matchesKey(data, "enter")) {
                if (prChecked.size > 0) {
                  done("create-pr");
                }
                return;
              }
              // "b" for create-pr-best removed — feature not implemented
              if (data === "d") {
                if (prChecked.size > 0) {
                  const hashes = [...prChecked]
                    .map((idx) => (lastDashResult?.rowCommitMap ?? [])[idx])
                    .filter((c): c is string => c != null)
                    .filter((c, i, arr) => arr.indexOf(c) === i);
                  if (hashes.length > 0) {
                    dryRunState = { status: "running", report: "", progress: "" };
                    // Start spinner animation
                    spinnerIdx = 0;
                    spinnerTimer = setInterval(() => {
                      spinnerIdx++;
                      tui.requestRender();
                    }, 80);
                    tui.requestRender();
                    // Run async — update progress and state when done
                    (async () => {
                      try {
                        const branchCommits = await getBranchCommits(pi, cwd);
                        let currentBranch = "";
                        try {
                          const branchResult = await pi.exec("git", ["branch", "--show-current"], { cwd });
                          currentBranch = branchResult.stdout.trim();
                        } catch {
                          /* branch name unavailable */
                        }
                        const report = await dryRunPR(pi, cwd, hashes, branchCommits, currentBranch, (msg) => {
                          if (dryRunState) {
                            dryRunState.progress = msg;
                            tui.requestRender();
                          }
                        });
                        dryRunState = { status: "done", report, progress: "" };
                      } catch (error: unknown) {
                        dryRunState = {
                          status: "done",
                          report: `Failed: ${error instanceof Error ? error.message : String(error)}`,
                          progress: "",
                        };
                      }
                      if (spinnerTimer) {
                        clearInterval(spinnerTimer);
                        spinnerTimer = null;
                      }
                      tui.requestRender();
                    })();
                  }
                }
                return;
              }
              if (data === "x") {
                done("explain-win");
                return;
              }
            }

            // ── Plan/Ideas keys ──
            if (view === "plan" || view === "ideas") {
              if (matchesKey(data, "up") || data === "k") {
                if (view === "ideas") {
                  ideasScroll = Math.max(0, ideasScroll - PLAN_VIEWER.scrollStep);
                } else {
                  planScroll = Math.max(0, planScroll - PLAN_VIEWER.scrollStep);
                }
                tui.requestRender();
                return;
              }
              if (matchesKey(data, "down") || data === "j") {
                if (view === "ideas") {
                  ideasScroll += PLAN_VIEWER.scrollStep;
                } else {
                  planScroll += PLAN_VIEWER.scrollStep;
                }
                tui.requestRender();
                return;
              }
              if (data === "e") {
                done(view === "ideas" ? "edit-ideas" : "edit-plan");
                return;
              }
              if (data === "g") {
                if (view === "ideas") {
                  ideasScroll = 0;
                } else {
                  planScroll = 0;
                }
                tui.requestRender();
                return;
              }
              if (data === "G") {
                if (view === "ideas") {
                  ideasScroll = Number.MAX_SAFE_INTEGER;
                } else {
                  planScroll = Number.MAX_SAFE_INTEGER;
                }
                tui.requestRender();
                return;
              }
            }
          },
        };
      }
    );

    // ── Handle actions that need to leave ctx.ui.custom ──
    if (result?.startsWith("goal:")) {
      const goal = result.slice(5);
      if (onStartAutoresearch) {
        await onStartAutoresearch(goal);
        return;
      }
      ctx.ui.notify("Use /arstudio new <goal> to start a new session.", "info");
      return;
    } else if (result === "edit-plan") {
      await editFile(mdPath, "autoresearch.md", ctx);
    } else if (result === "edit-ideas") {
      await editFile(ideasPath, "autoresearch.ideas.md", ctx);
    } else if (result === "open-html") {
      try {
        await onOpenHTML?.();
      } catch {
        /* failed to open HTML dashboard */
      }
      // Stay in the loop
    } else if (result === "explain-win") {
      const dashResult = lastDashResult as { rowCommitMap: (string | null)[]; rowStatusMap: (string | null)[] } | null;
      const commit = dashResult ? dashResult.rowCommitMap[dashScroll] : null;
      const status = dashResult ? dashResult.rowStatusMap[dashScroll] : null;
      if (!commit || !status) {
        ctx.ui.notify("Select an experiment row to explain.", "warning");
        continue;
      }

      const { configs, runs } = parseJsonl(cwd);
      ctx.ui.setStatus("arstudio.explain", "Generating explanation…");
      let explanation: Awaited<ReturnType<typeof getOrGenerateWinExplanation>>;
      try {
        explanation = await getOrGenerateWinExplanation(cwd, configs[configs.length - 1], runs, commit);
      } finally {
        ctx.ui.setStatus("arstudio.explain", undefined);
      }
      if (!explanation) {
        ctx.ui.notify("No explanation available for this run.", "warning");
        continue;
      }

      const meta = `Source: ${explanation.source}${explanation.cached ? " (cached)" : ""} · Model: ${explanation.model}`;
      await viewReadOnlyText(
        `Explain experiment (${commit.slice(0, 7)})`,
        `${meta}\n\n${explanation.explanation}`,
        ctx
      );
    } else if (result === "create-pr") {
      const { configs, runs } = parseJsonl(cwd);
      const hashes = [...prChecked]
        .map((idx) => lastDashResult?.rowCommitMap[idx])
        .filter((c): c is string => c != null)
        .filter((c, i, arr) => arr.indexOf(c) === i);

      if (hashes.length === 0) {
        ctx.ui.notify("No commits selected for PR.", "warning");
        continue;
      }

      const n = hashes.length;
      const modeChoices = [
        `Consolidated — 1 PR with all ${n} commits`,
        `Stacked — ${n} chained PRs, each targeting the previous`,
        `Individual — ${n} independent PRs`,
      ];
      const modeChoice = await ctx.ui.select(`Create PR from ${n} experiments:`, modeChoices);
      if (modeChoice == null) {
        continue;
      }
      const modeMap: PRMode[] = ["consolidated", "stacked", "individual"];
      const mode = modeMap[modeChoices.indexOf(modeChoice)];

      const branchCommits = await getBranchCommits(pi, cwd);
      const lastConfig = configs[configs.length - 1];
      let currentBranch = "";
      try {
        const branchResult = await pi.exec("git", ["branch", "--show-current"], { cwd });
        currentBranch = branchResult.stdout.trim();
      } catch {
        /* branch name unavailable */
      }

      const modelInfo = ctx.model ? `${ctx.model.name} (${ctx.model.provider})` : undefined;
      await executePR(pi, cwd, hashes, branchCommits, lastConfig, runs, currentBranch, mode, ctx, modelInfo);
      prChecked.clear();
      view = "dashboard";
    } else {
      break; // null = quit
    }
  }
}
