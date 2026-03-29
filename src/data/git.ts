import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { Config, Run } from "./parser.js";

export type PRMode = "consolidated" | "stacked" | "individual";

/** Run a git command via pi.exec and return stdout. Throws on non-zero exit. */
async function git(pi: ExtensionAPI, args: string[], cwd: string): Promise<string> {
  const result = await pi.exec("git", args, { cwd });
  if (result.code !== 0) {
    throw new Error(result.stderr || `git ${args[0]} failed with code ${result.code}`);
  }
  return result.stdout.trim();
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

interface BranchTracker {
  local: Set<string>;
  remote: Set<string>;
}

/** Get commits on the current branch that aren't on main. */
export async function getBranchCommits(pi: ExtensionAPI, cwd: string): Promise<{ hash: string; subject: string }[]> {
  try {
    const result = await git(pi, ["log", "--oneline", "main..HEAD", "--no-merges"], cwd);
    return result
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [hash, ...rest] = line.split(" ");
        return { hash, subject: rest.join(" ") };
      });
  } catch {
    try {
      const result = await git(pi, ["log", "--oneline", "origin/main..HEAD", "--no-merges"], cwd);
      return result
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const [hash, ...rest] = line.split(" ");
          return { hash, subject: rest.join(" ") };
        });
    } catch {
      return [];
    }
  }
}

// ─── PR description builder ─────────────────────────────────────────────────

function fmtDelta(pct: number): string {
  return (pct > 0 ? "+" : "") + pct.toFixed(1) + "%";
}

function fmtMetric(value: number, unit: string): string {
  const formatted = value.toLocaleString();
  return unit ? `${formatted} ${unit}` : formatted;
}

/** Extract the objective section from autoresearch.md. */
function extractObjective(cwd: string): string | null {
  const mdPath = join(cwd, "autoresearch.md");
  if (!existsSync(mdPath)) {
    return null;
  }
  const content = readFileSync(mdPath, "utf-8");
  const lines = content.split("\n");

  let inObjective = false;
  const objectiveLines: string[] = [];
  for (const line of lines) {
    if (/^##\s+objective/i.test(line)) {
      inObjective = true;
      continue;
    }
    if (inObjective) {
      if (line.startsWith("## ")) {
        break;
      }
      objectiveLines.push(line);
    }
  }
  if (objectiveLines.length > 0) {
    const text = objectiveLines.join("\n").trim();
    return text || null;
  }

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("#") && !trimmed.startsWith("---")) {
      return trimmed;
    }
  }
  return null;
}

/** Extract "What's Been Tried" section from autoresearch.md. */
function extractWhatsTried(cwd: string): string | null {
  const mdPath = join(cwd, "autoresearch.md");
  if (!existsSync(mdPath)) {
    return null;
  }
  const content = readFileSync(mdPath, "utf-8");
  const lines = content.split("\n");

  let inSection = false;
  const sectionLines: string[] = [];
  for (const line of lines) {
    if (/^##\s+what.*tried/i.test(line)) {
      inSection = true;
      continue;
    }
    if (inSection) {
      if (line.startsWith("## ")) {
        break;
      }
      sectionLines.push(line);
    }
  }
  if (sectionLines.length > 0) {
    const text = sectionLines.join("\n").trim();
    const summaryLines: string[] = [];
    for (const sl of sectionLines) {
      if (sl.startsWith("### ")) {
        summaryLines.push(sl);
      }
    }
    if (summaryLines.length > 0) {
      return summaryLines.join("\n");
    }
    return text.length > 1000 ? text.slice(0, 1000) + "\n\n*(truncated)*" : text;
  }
  return null;
}

interface PRBodyContext {
  config: Config;
  runs: Run[];
  cwd: string;
  currentBranch: string;
  selectedHashes: string[];
  branchCommits: { hash: string; subject: string }[];
  /** For stacked/individual: which PR in the series (1-indexed) */
  prIndex?: number;
  /** For stacked/individual: total PRs in the series */
  prTotal?: number;
  /** For stacked: the previous PR URL */
  prevPrUrl?: string;
  /** Model name/provider used during the session */
  modelInfo?: string;
}

/** Build a PR body from autoresearch session data. */
function buildPRBody(prCtx: PRBodyContext): { title: string; body: string } {
  const { config, runs, cwd, currentBranch, selectedHashes, branchCommits, prIndex, prTotal, prevPrUrl } = prCtx;
  const chronological = [...selectedHashes].reverse();

  const seg = runs.length > 0 ? Math.max(...runs.map((r) => r.segment)) : 0;
  const segRuns = runs.filter((r) => r.segment === seg);
  const kept = segRuns.filter((r) => r.status === "keep");
  const baseline = kept.length > 0 ? kept[0].metric : null;

  const selectedRuns = chronological
    .map((h) => segRuns.find((r) => r.commit === h || r.commit.startsWith(h)))
    .filter((r): r is Run => r != null);

  // Title
  let title = `[Autoresearch] ${config.name}`;
  if (prIndex != null && prTotal != null) {
    title += ` (${prIndex}/${prTotal})`;
  }

  const lines: string[] = [];

  // ── Stack context ──
  if (prIndex != null && prTotal != null) {
    lines.push(
      `> 📚 **Part ${prIndex} of ${prTotal}** in an autoresearch experiment series.${prevPrUrl ? ` Previous: ${prevPrUrl}` : ""}`,
      ""
    );
  }

  // ── Purpose ──
  lines.push("## Purpose", "");
  const objective = extractObjective(cwd);
  if (objective) {
    lines.push(objective, "");
  }

  // ── Results (scoped to selected experiments) ──
  lines.push("## Results", "");
  const arrow = config.bestDirection === "lower" ? "↓" : "↑";
  lines.push(`**${config.metricName}** — ${arrow} ${config.bestDirection} is better`, "");

  if (selectedRuns.length > 0 && baseline != null) {
    const firstSelected = selectedRuns[0];
    const lastSelected = selectedRuns[selectedRuns.length - 1];
    const priorRun = kept.filter((r) => r.run < firstSelected.run).pop();
    const before = priorRun?.metric ?? baseline;
    const after = lastSelected.metric;
    const pctChange = before ? ((after - before) / before) * 100 : 0;

    lines.push(`| | ${config.metricName}${config.metricUnit ? ` (${config.metricUnit})` : ""} | Change |`);
    lines.push(`|---|---|---|`);
    lines.push(`| Before this PR | ${fmtMetric(before, "")} | — |`);
    lines.push(`| After this PR | ${fmtMetric(after, "")} | ${fmtDelta(pctChange)} |`);
    if (baseline !== before) {
      const pctFromBaseline = baseline ? ((after - baseline) / baseline) * 100 : 0;
      lines.push(
        `| vs. session baseline | ${fmtMetric(baseline, "")} → ${fmtMetric(after, "")} | ${fmtDelta(pctFromBaseline)} |`
      );
    }
    lines.push("");

    // Secondary metrics
    const firstSecNames = Object.keys(firstSelected.metrics ?? {});
    const lastSecNames = Object.keys(lastSelected.metrics ?? {});
    const allSecNames = [...new Set([...firstSecNames, ...lastSecNames])];
    if (allSecNames.length > 0 && selectedRuns.length > 1) {
      const priorSecMetrics = priorRun?.metrics ?? kept[0]?.metrics ?? {};
      lines.push("### Secondary Metrics", "");
      lines.push(`| Metric | Before | After | Change |`);
      lines.push(`|--------|--------|-------|--------|`);
      for (const name of allSecNames) {
        const beforeVal = priorSecMetrics[name] ?? firstSelected.metrics?.[name];
        const afterVal = lastSelected.metrics[name];
        if (beforeVal != null && afterVal != null) {
          const delta = beforeVal !== 0 ? fmtDelta(((afterVal - beforeVal) / beforeVal) * 100) : "—";
          lines.push(`| ${name} | ${beforeVal.toLocaleString()} | ${afterVal.toLocaleString()} | ${delta} |`);
        }
      }
      lines.push("");
    }
  }

  lines.push(
    `*${selectedRuns.length} experiment${selectedRuns.length === 1 ? "" : "s"} from a session of ${segRuns.length} total runs (${kept.length} kept)*`,
    ""
  );

  // ── Experiments table ──
  lines.push("## Experiments", "");
  if (selectedRuns.length > 0) {
    lines.push(`| # | Commit | ${config.metricName} | Δ% | Conf. | Description |`);
    lines.push(`|---|--------|${"-".repeat(Math.max(config.metricName.length, 6) + 2)}|----|-------|-------------|`);
    for (const r of selectedRuns) {
      const delta = baseline ? fmtDelta(((r.metric - baseline) / baseline) * 100) : "—";
      const conf = r.confidence != null ? `${r.confidence.toFixed(1)}×` : "—";
      lines.push(
        `| ${r.run} | \`${r.commit.slice(0, 7)}\` | ${r.metric.toLocaleString()} | ${delta} | ${conf} | ${r.description} |`
      );
    }
  } else {
    for (const h of chronological) {
      const c = branchCommits.find((bc) => bc.hash.startsWith(h));
      lines.push(c ? `- \`${c.hash.slice(0, 7)}\` ${c.subject}` : `- \`${h}\``);
    }
  }
  lines.push("");

  // ── Research context (only on first/consolidated PR to avoid repetition) ──
  if (prIndex == null || prIndex === 1) {
    const whatsTried = extractWhatsTried(cwd);
    if (whatsTried) {
      lines.push("## Research Context", "");
      lines.push(
        "<details>",
        "<summary>What was tried during this session (from autoresearch.md)</summary>",
        "",
        whatsTried,
        "",
        "</details>",
        ""
      );
    }
  }

  // ── Metadata ──
  lines.push("## Metadata", "");
  lines.push(`- **Session:** ${config.name}`);
  lines.push(`- **Branch:** \`${currentBranch}\``);
  lines.push(`- **Metric:** ${config.metricName}${config.metricUnit ? ` (${config.metricUnit})` : ""}`);
  lines.push(`- **Direction:** ${config.bestDirection} is better`);
  lines.push("");

  lines.push("## AI Tools Used", "");
  lines.push("- Pi (autoresearch mode)");
  if (prCtx.modelInfo) {
    lines.push(`- Model: ${prCtx.modelInfo}`);
  }
  lines.push("- pi-autoresearch-studio", "");

  return { title, body: lines.join("\n") };
}

// ─── Create a single PR via gh CLI ───────────────────────────────────────────

/**
 * Parse a GitHub remote URL into owner/repo.
 * Handles HTTPS (github.com/owner/repo.git) and SSH (git@github.com:owner/repo.git).
 */
function parseGitHubRemote(remoteUrl: string): { owner: string; repo: string } | null {
  // HTTPS: https://github.com/owner/repo.git
  const httpsMatch = remoteUrl.match(/github\.com\/([^/]+)\/([^/.]+)/);
  if (httpsMatch) return { owner: httpsMatch[1], repo: httpsMatch[2] };
  // SSH: git@github.com:owner/repo.git
  const sshMatch = remoteUrl.match(/github\.com:([^/]+)\/([^/.]+)/);
  if (sshMatch) return { owner: sshMatch[1], repo: sshMatch[2] };
  return null;
}

/**
 * Build a GitHub PR creation URL with pre-filled title, body, and base branch.
 * Falls back to just the compare URL if the body is too long for URL params.
 */
function buildGitHubPRUrl(
  owner: string,
  repo: string,
  branch: string,
  title: string,
  body: string,
  baseBranch?: string
): string {
  const base = baseBranch ?? "main";
  const compareUrl = `https://github.com/${owner}/${repo}/compare/${encodeURIComponent(base)}...${encodeURIComponent(branch)}`;
  const params = new URLSearchParams({ expand: "1", title });
  // URL length limit ~8000 chars — include body only if it fits
  const withBody = new URLSearchParams({ expand: "1", title, body });
  const fullUrl = `${compareUrl}?${withBody.toString()}`;
  if (fullUrl.length <= 8000) return fullUrl;
  // Body too long — just pre-fill title
  return `${compareUrl}?${params.toString()}`;
}

/** Create a PR. Tries `gh` CLI first (creates draft PR), falls back to a GitHub URL. */
async function createPR(
  pi: ExtensionAPI,
  cwd: string,
  branch: string,
  title: string,
  body: string,
  baseBranch?: string
): Promise<{ url: string; method: "gh" | "url" }> {
  // Try gh CLI first
  const ghCheck = await pi.exec("gh", ["--version"], { cwd });
  if (ghCheck.code === 0) {
    const args = ["pr", "create", "--draft", "--title", title, "--body", body];
    if (baseBranch) {
      args.push("--base", baseBranch);
    }
    const result = await pi.exec("gh", args, { cwd });
    if (result.code === 0) {
      return { url: result.stdout.trim(), method: "gh" };
    }
    // gh failed (not authenticated, etc.) — fall through to URL
  }

  // Fallback: build GitHub PR URL
  const remoteResult = await pi.exec("git", ["remote", "get-url", "origin"], { cwd });
  const remoteUrl = remoteResult.stdout.trim();
  const parsed = parseGitHubRemote(remoteUrl);
  if (parsed) {
    const url = buildGitHubPRUrl(parsed.owner, parsed.repo, branch, title, body, baseBranch);
    return { url, method: "url" };
  }

  // Not a GitHub remote — just return the branch name
  return { url: `Branch '${branch}' pushed to origin. Create a PR manually.`, method: "url" };
}

// ─── executePR ───────────────────────────────────────────────────────────────

/** Cherry-pick commits and create PRs in the selected mode. */
/** Progress callback for dry run status updates. */
export type DryRunProgress = (message: string) => void;

/** Run dependency resolution without creating PRs. Returns a human-readable report. */
export async function dryRunPR(
  pi: ExtensionAPI,
  cwd: string,
  hashes: string[],
  branchCommits: { hash: string; subject: string }[],
  currentBranch: string,
  onProgress?: DryRunProgress
): Promise<string> {
  const chronological = sortHashesByTopology(hashes, branchCommits);
  const firstParent = `${chronological[0]}~1`;

  const commitName = (h: string) => {
    const c = branchCommits.find((bc) => bc.hash === h || bc.hash.startsWith(h));
    return c ? `${c.hash.slice(0, 7)} ${c.subject}` : h.slice(0, 7);
  };

  onProgress?.("Fetching latest from origin…");
  await git(pi, ["fetch", "origin", "main"], cwd);

  // Run resolution in a temporary worktree so we never modify the main working directory.
  // This prevents the web dashboard from seeing a branch switch mid-operation.
  const worktreeDir = join(cwd, `../__arstudio-dryrun-${Date.now().toString(36)}`);
  const testBranchName = `__dep-resolve-${Date.now().toString(36)}`;

  let depResult: { resolved: string[]; autoIncluded: string[]; ok: boolean };
  try {
    await pi.exec("git", ["worktree", "add", "-b", testBranchName, worktreeDir, firstParent], { cwd });

    onProgress?.("Analyzing file changes…");
    depResult = await resolveDependencies(
      pi,
      worktreeDir,
      chronological,
      branchCommits,
      firstParent,
      testBranchName,
      onProgress
    );
  } finally {
    // Always clean up worktree and branch
    try {
      await pi.exec("git", ["worktree", "remove", "--force", worktreeDir], { cwd });
    } catch {}
    try {
      await pi.exec("git", ["branch", "-D", testBranchName], { cwd });
    } catch {}
  }

  const lines: string[] = [];

  if (depResult.ok) {
    // ── Success summary ──
    const nSelected = hashes.length;
    const nAuto = depResult.autoIncluded.length;
    const nTotal = depResult.resolved.length;
    const nSkipped =
      chronological.length > 1
        ? (() => {
            const allOldestFirst = [...branchCommits].reverse().map((bc) => bc.hash);
            const firstIdx = allOldestFirst.findIndex(
              (h) =>
                h === chronological[0] || h.startsWith(chronological[0]) || chronological[0].startsWith(h.slice(0, 7))
            );
            const lastIdx = allOldestFirst.findIndex(
              (h) =>
                h === chronological[chronological.length - 1] ||
                h.startsWith(chronological[chronological.length - 1]) ||
                chronological[chronological.length - 1].startsWith(h.slice(0, 7))
            );
            return firstIdx >= 0 && lastIdx >= 0 ? lastIdx - firstIdx + 1 - nTotal : 0;
          })()
        : 0;

    lines.push("✓ Ready to create PR");
    lines.push("");
    lines.push(`PR will target: ${currentBranch}`);
    lines.push("");

    if (nAuto === 0 && nSkipped === 0) {
      lines.push(`All ${nSelected} selected experiments are independent — no extra`);
      lines.push("commits needed. The PR will contain exactly what you selected.");
    } else if (nAuto === 0 && nSkipped > 0) {
      lines.push(`All ${nSelected} selected experiments are independent.`);
      lines.push(`${nSkipped} experiment(s) between them will be skipped.`);
      lines.push("The PR will contain only the changes you selected.");
    } else {
      lines.push(`${nAuto} additional commit(s) are needed because your selected`);
      lines.push("experiments depend on changes introduced by them:");
      lines.push("");
      for (const h of depResult.autoIncluded) {
        lines.push(`  + ${commitName(h)}`);
      }
      if (nSkipped > 0) {
        lines.push("");
        lines.push(`${nSkipped} other experiment(s) between them will be skipped.`);
      }
    }

    lines.push("");
    lines.push(`── Commits to include (${nTotal}) ──`);
    lines.push("");
    for (const h of depResult.resolved) {
      const isAuto = depResult.autoIncluded.includes(h);
      lines.push(`  ${isAuto ? "＋" : "●"} ${commitName(h)}${isAuto ? "  ← dependency" : ""}`);
    }

    lines.push("");
    lines.push("Autoresearch metadata files will be stripped from the PR.");
  } else {
    // ── Failure summary ──
    lines.push("✗ Cannot create clean PR");
    lines.push("");
    lines.push("The selected experiments could not be cherry-picked together,");
    lines.push("even after including intermediate dependency commits.");
    lines.push("");
    lines.push("This usually means:");
    lines.push("  • The gap between selected experiments is too large");
    lines.push("  • Multiple experiments modify the same code in conflicting ways");
    lines.push("  • A non-experiment commit in between introduces breaking changes");
    lines.push("");
    lines.push("Try selecting experiments that are closer together, or");
    lines.push("include the experiments in between.");
    lines.push("");
    lines.push(`── Selected commits (${chronological.length}) ──`);
    lines.push("");
    for (const h of chronological) {
      lines.push(`  ● ${commitName(h)}`);
    }
  }

  return lines.join("\n");
}

export async function executePR(
  pi: ExtensionAPI,
  cwd: string,
  hashes: string[],
  branchCommits: { hash: string; subject: string }[],
  config: Config | undefined,
  runs: Run[],
  currentBranch: string,
  mode: PRMode,
  ctx: ExtensionCommandContext,
  modelInfo?: string
): Promise<void> {
  const fallbackConfig: Config = {
    name: currentBranch,
    metricName: "metric",
    metricUnit: "",
    bestDirection: "lower",
  };
  const cfg = config ?? fallbackConfig;
  // Sort hashes into git topological order (oldest first).
  // branchCommits is newest-first from `git log`, so reverse gives oldest-first.
  // Match selected hashes against that order to ensure correct ancestry for direct branching.
  const chronological = sortHashesByTopology(hashes, branchCommits);

  const commitList = hashes
    .map((h) => {
      const c = branchCommits.find((bc) => bc.hash.startsWith(h));
      return c ? `${c.hash.slice(0, 7)} ${c.subject}` : h;
    })
    .join("\n  ");

  const modeLabel =
    mode === "consolidated"
      ? "1 consolidated PR"
      : mode === "stacked"
        ? `${chronological.length} stacked PRs`
        : `${chronological.length} individual PRs`;

  const ok = await ctx.ui.confirm(`Create ${modeLabel}?`, `Cherry-picking ${hashes.length} commits:\n  ${commitList}`);
  if (!ok) {
    return;
  }

  const branchTracker: BranchTracker = { local: new Set(), remote: new Set() };

  try {
    await git(pi, ["fetch", "origin", "main"], cwd);

    // Determine the base ref for PR branches.
    // Try origin/main first (clean cherry-pick PRs). If a cherry-pick fails,
    // we'll retry from the merge-base so the commits apply on familiar context.
    const mergeBase = await findMergeBase(pi, cwd);

    // Run dependency resolution in a temporary worktree so we never modify the
    // user's working directory during the cherry-pick testing phase.
    const firstParent = `${chronological[0]}~1`;
    const depWorktreeDir = join(cwd, `../__arstudio-depresolve-${Date.now().toString(36)}`);
    const depTestBranch = `__dep-resolve-${Date.now().toString(36)}`;

    let depResult: { resolved: string[]; autoIncluded: string[]; ok: boolean };
    try {
      await pi.exec("git", ["worktree", "add", "-b", depTestBranch, depWorktreeDir, firstParent], { cwd });
      depResult = await resolveDependencies(
        pi,
        depWorktreeDir,
        chronological,
        branchCommits,
        firstParent,
        depTestBranch
      );
    } finally {
      try {
        await pi.exec("git", ["worktree", "remove", "--force", depWorktreeDir], { cwd });
      } catch {
        /* worktree already cleaned */
      }
      try {
        await pi.exec("git", ["branch", "-D", depTestBranch], { cwd });
      } catch {
        /* branch already cleaned */
      }
    }

    let resolvedChronological = chronological;

    if (depResult.ok && depResult.autoIncluded.length > 0) {
      const autoNames = depResult.autoIncluded.map((h) => {
        const c = branchCommits.find((bc) => bc.hash === h || bc.hash.startsWith(h));
        return c ? `${c.hash.slice(0, 7)} ${c.subject}` : h.slice(0, 7);
      });
      ctx.ui.notify(
        `Auto-included ${autoNames.length} required dependency commit(s):\n  ${autoNames.join("\n  ")}`,
        "info"
      );
      resolvedChronological = depResult.resolved;
    }

    if (mode === "consolidated") {
      await createConsolidatedPR(
        pi,
        cwd,
        resolvedChronological,
        branchCommits,
        cfg,
        runs,
        currentBranch,
        ctx,
        branchTracker,
        modelInfo,
        mergeBase
      );
    } else if (mode === "stacked") {
      await createStackedPRs(
        pi,
        cwd,
        resolvedChronological,
        branchCommits,
        cfg,
        runs,
        currentBranch,
        ctx,
        branchTracker,
        modelInfo,
        mergeBase
      );
    } else {
      await createIndividualPRs(
        pi,
        cwd,
        resolvedChronological,
        branchCommits,
        cfg,
        runs,
        currentBranch,
        ctx,
        branchTracker,
        modelInfo,
        mergeBase
      );
    }
  } catch (error: unknown) {
    try {
      await git(pi, ["checkout", currentBranch], cwd);
    } catch {}

    const cleanupLocal = [...branchTracker.local].filter((branch) => branch !== currentBranch);
    const cleanupRemote = [...branchTracker.remote];

    if (cleanupLocal.length > 0 || cleanupRemote.length > 0) {
      const shouldCleanup = await ctx.ui.confirm(
        "Cleanup partially-created PR branches?",
        `Local: ${cleanupLocal.length}\nRemote: ${cleanupRemote.length}`
      );
      if (shouldCleanup) {
        const failedRemote: string[] = [];
        for (const branch of cleanupRemote) {
          try {
            await git(pi, ["push", "origin", "--delete", branch], cwd);
          } catch {
            failedRemote.push(branch);
          }
        }
        for (const branch of cleanupLocal) {
          try {
            await git(pi, ["branch", "-D", branch], cwd);
          } catch {}
        }
        if (failedRemote.length > 0) {
          ctx.ui.notify(
            `Cleaned up local branches but failed to delete ${failedRemote.length} remote branch(es):\n  ${failedRemote.join("\n  ")}\nManually delete with: git push origin --delete <branch>`,
            "warning"
          );
        } else {
          ctx.ui.notify("Cleaned up partially-created branches.", "info");
        }
      } else {
        ctx.ui.notify(
          `Left partially-created branches intact. Local: ${cleanupLocal.join(", ") || "none"}; Remote: ${cleanupRemote.join(", ") || "none"}`,
          "warning"
        );
      }
    }

    ctx.ui.notify(`PR creation failed: ${getErrorMessage(error).slice(0, 200)}`, "error");
  }
}

// ─── Consolidated: one branch, one PR ────────────────────────────────────────

async function createConsolidatedPR(
  pi: ExtensionAPI,
  cwd: string,
  chronological: string[],
  branchCommits: { hash: string; subject: string }[],
  config: Config,
  runs: Run[],
  currentBranch: string,
  ctx: ExtensionCommandContext,
  branchTracker: BranchTracker,
  modelInfo?: string,
  mergeBase?: string | null
): Promise<void> {
  const prBranch = `${currentBranch}-pr-${Date.now().toString(36)}`;
  let strategy = "cherry-pick";

  // Cherry-pick onto parent of first selected commit — PR targets the current branch
  const baseRef = `${chronological[0]}~1`;
  ctx.ui.notify(`Creating branch and cherry-picking (target: ${currentBranch})...`, "info");
  await git(pi, ["checkout", "-b", prBranch, baseRef], cwd);
  branchTracker.local.add(prBranch);

  let cherryPickOk = true;
  for (const hash of chronological) {
    if (!(await cherryPickOrAbort(pi, cwd, hash, currentBranch, ctx))) {
      cherryPickOk = false;
      break;
    }
  }

  // Fallback 1: retry from merge-base
  if (!cherryPickOk && mergeBase) {
    ctx.ui.notify("Retrying from merge-base...", "info");
    try {
      await git(pi, ["branch", "-D", prBranch], cwd);
    } catch {}
    branchTracker.local.delete(prBranch);

    await git(pi, ["checkout", "-b", prBranch, mergeBase], cwd);
    branchTracker.local.add(prBranch);

    let mergeBaseOk = true;
    for (const hash of chronological) {
      if (!(await cherryPickOrAbort(pi, cwd, hash, currentBranch, ctx))) {
        mergeBaseOk = false;
        break;
      }
    }

    if (mergeBaseOk) {
      strategy = "merge-base";
    } else {
      // Fallback 2: direct branch at last selected commit
      ctx.ui.notify("Using direct branch at last commit (includes full branch history).", "info");
      try {
        await git(pi, ["branch", "-D", prBranch], cwd);
      } catch {}
      branchTracker.local.delete(prBranch);

      const lastCommit = chronological[chronological.length - 1];
      await git(pi, ["checkout", "-b", prBranch, lastCommit], cwd);
      branchTracker.local.add(prBranch);
      strategy = "direct";
    }
  } else if (!cherryPickOk) {
    // No merge-base available — try direct
    ctx.ui.notify("Using direct branch at last commit (includes full branch history).", "info");
    try {
      await git(pi, ["branch", "-D", prBranch], cwd);
    } catch {}
    branchTracker.local.delete(prBranch);

    const lastCommit = chronological[chronological.length - 1];
    await git(pi, ["checkout", "-b", prBranch, lastCommit], cwd);
    branchTracker.local.add(prBranch);
    strategy = "direct";
  }

  await stripAutoresearchFiles(pi, cwd);
  ctx.ui.notify("Pushing...", "info");
  await git(pi, ["push", "-u", "origin", prBranch], cwd);
  branchTracker.remote.add(prBranch);

  const { title, body } = buildPRBody({
    config,
    runs,
    cwd,
    currentBranch,
    selectedHashes: chronological,
    branchCommits,
    modelInfo,
  });

  const pr = await createPR(pi, cwd, prBranch, title, body, currentBranch);
  await git(pi, ["checkout", currentBranch], cwd);
  const notes: Record<string, string> = {
    "cherry-pick": "",
    "merge-base": " (includes branch context)",
    direct: " (includes full branch history)",
  };
  if (pr.method === "gh") {
    ctx.ui.notify(`Draft PR created${notes[strategy]} (targets ${currentBranch}): ${pr.url}`, "info");
  } else {
    ctx.ui.notify(`Branch pushed${notes[strategy]}. Open PR: ${pr.url}`, "info");
  }
}

// ─── Stacked: one chain of PRs, each targeting the previous ──────────────────

async function createStackedPRs(
  pi: ExtensionAPI,
  cwd: string,
  chronological: string[],
  branchCommits: { hash: string; subject: string }[],
  config: Config,
  runs: Run[],
  currentBranch: string,
  ctx: ExtensionCommandContext,
  branchTracker: BranchTracker,
  modelInfo?: string,
  _mergeBase?: string | null
): Promise<void> {
  const ts = Date.now().toString(36);
  const prUrls: string[] = [];

  // Cherry-pick onto parent of first selected commit, PR targets current branch
  const baseRef = `${chronological[0]}~1`;
  let prevBranch = baseRef;

  for (let i = 0; i < chronological.length; i++) {
    const hash = chronological[i];
    const prBranch = `${currentBranch}-pr-${ts}-${i + 1}`;

    ctx.ui.notify(`Creating PR ${i + 1}/${chronological.length}...`, "info");
    await git(pi, ["checkout", "-b", prBranch, prevBranch], cwd);
    branchTracker.local.add(prBranch);

    if (!(await cherryPickOrAbort(pi, cwd, hash, currentBranch, ctx))) {
      throw new Error("Cherry-pick failed");
    }

    await stripAutoresearchFiles(pi, cwd);
    await git(pi, ["push", "-u", "origin", prBranch], cwd);
    branchTracker.remote.add(prBranch);

    const baseBranchForPR = i === 0 ? currentBranch : `${currentBranch}-pr-${ts}-${i}`;

    const { title, body } = buildPRBody({
      config,
      runs,
      cwd,
      currentBranch,
      selectedHashes: [hash],
      branchCommits,
      prIndex: i + 1,
      prTotal: chronological.length,
      prevPrUrl: prUrls.length > 0 ? prUrls[prUrls.length - 1] : undefined,
      modelInfo,
    });

    const pr = await createPR(pi, cwd, prBranch, title, body, baseBranchForPR);
    prUrls.push(pr.url);
    prevBranch = prBranch;
  }

  await git(pi, ["checkout", currentBranch], cwd);
  ctx.ui.notify(`Created ${prUrls.length} stacked PRs (targets ${currentBranch}):\n${prUrls.join("\n")}`, "info");
}

// ─── Individual: separate branches, independent PRs ──────────────────────────

async function createIndividualPRs(
  pi: ExtensionAPI,
  cwd: string,
  chronological: string[],
  branchCommits: { hash: string; subject: string }[],
  config: Config,
  runs: Run[],
  currentBranch: string,
  ctx: ExtensionCommandContext,
  branchTracker: BranchTracker,
  modelInfo?: string,
  _mergeBase?: string | null
): Promise<void> {
  const ts = Date.now().toString(36);
  const prUrls: string[] = [];
  const baseRef = `${chronological[0]}~1`;

  for (let i = 0; i < chronological.length; i++) {
    const hash = chronological[i];
    const prBranch = `${currentBranch}-pr-${ts}-${i + 1}`;

    ctx.ui.notify(`Creating PR ${i + 1}/${chronological.length}...`, "info");
    await git(pi, ["checkout", "-b", prBranch, baseRef], cwd);
    branchTracker.local.add(prBranch);

    if (!(await cherryPickOrAbort(pi, cwd, hash, currentBranch, ctx))) {
      throw new Error("Cherry-pick failed");
    }

    await stripAutoresearchFiles(pi, cwd);
    await git(pi, ["push", "-u", "origin", prBranch], cwd);
    branchTracker.remote.add(prBranch);

    const { title, body } = buildPRBody({
      config,
      runs,
      cwd,
      currentBranch,
      selectedHashes: [hash],
      branchCommits,
      prIndex: i + 1,
      prTotal: chronological.length,
      modelInfo,
    });

    const pr = await createPR(pi, cwd, prBranch, title, body, currentBranch);
    prUrls.push(pr.url);
  }

  await git(pi, ["checkout", currentBranch], cwd);
  ctx.ui.notify(`Created ${prUrls.length} individual PRs (targets ${currentBranch}):\n${prUrls.join("\n")}`, "info");
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Autoresearch metadata files — auto-resolved during cherry-pick and stripped from PR branches. */
const AUTORESEARCH_FILES = [
  "autoresearch.jsonl",
  "autoresearch.md",
  "autoresearch.ideas.md",
  "autoresearch.sh",
  "autoresearch.checks.sh",
];

/**
 * Remove autoresearch metadata files from the current branch and commit the removal.
 * Called before pushing a PR branch so the PR only contains code changes.
 */
async function stripAutoresearchFiles(pi: ExtensionAPI, cwd: string): Promise<void> {
  const rmArgs = ["rm", "-f", "--ignore-unmatch", ...AUTORESEARCH_FILES];
  const rmResult = await pi.exec("git", rmArgs, { cwd });
  if (rmResult.code !== 0) return; // nothing to remove

  // Check if there are staged changes (files were actually removed)
  const diffResult = await pi.exec("git", ["diff", "--cached", "--quiet"], { cwd });
  if (diffResult.code !== 0) {
    // There are staged removals — commit them
    await pi.exec("git", ["commit", "-m", "chore: strip autoresearch metadata from PR branch"], { cwd });
  }
}

/**
 * Attempt a cherry-pick. If it conflicts only on autoresearch metadata files,
 * auto-resolve them (accept theirs) and continue. Returns true on success.
 */
async function smartCherryPick(pi: ExtensionAPI, cwd: string, hash: string): Promise<boolean> {
  const result = await pi.exec("git", ["cherry-pick", hash], { cwd });
  if (result.code === 0) return true;

  // Check if all conflicts are in autoresearch metadata files
  const conflictResult = await pi.exec("git", ["diff", "--name-only", "--diff-filter=U"], { cwd });
  if (conflictResult.code !== 0) return false;

  const conflictFiles = conflictResult.stdout.trim().split("\n").filter(Boolean);
  if (conflictFiles.length === 0) return false;

  const allAutoResolvable = conflictFiles.every((f) =>
    AUTORESEARCH_FILES.some((af) => f === af || f.endsWith("/" + af))
  );
  if (!allAutoResolvable) return false;

  // Auto-resolve: accept theirs (the cherry-picked version) for metadata files
  for (const f of conflictFiles) {
    await pi.exec("git", ["checkout", "--theirs", f], { cwd });
    await pi.exec("git", ["add", f], { cwd });
  }

  // Continue the cherry-pick
  const contResult = await pi.exec("git", ["-c", "core.editor=true", "cherry-pick", "--continue"], { cwd });
  return contResult.code === 0;
}

async function cherryPickOrAbort(
  pi: ExtensionAPI,
  cwd: string,
  hash: string,
  returnBranch: string,
  ctx: ExtensionCommandContext
): Promise<boolean> {
  if (await smartCherryPick(pi, cwd, hash)) {
    return true;
  }
  ctx.ui.notify(`Cherry-pick failed for ${hash.slice(0, 7)}: non-autoresearch conflicts`, "error");
  await forceCheckout(pi, cwd, returnBranch);
  return false;
}

/**
 * Sort selected hashes into git topological order (oldest ancestor first).
 * Uses branchCommits (newest-first from `git log`) as the authoritative order.
 * Hashes not found in branchCommits are appended at the end in their original order.
 */
function sortHashesByTopology(hashes: string[], branchCommits: { hash: string; subject: string }[]): string[] {
  // branchCommits is newest-first; reverse to get oldest-first
  const oldestFirst = [...branchCommits].reverse();
  const selected = new Set(hashes);

  // Pick commits in topological order (oldest first)
  const sorted: string[] = [];
  for (const bc of oldestFirst) {
    // Match by full hash or prefix
    const match = hashes.find((h) => bc.hash === h || bc.hash.startsWith(h) || h.startsWith(bc.hash.slice(0, 7)));
    if (match && selected.has(match)) {
      sorted.push(match);
      selected.delete(match);
    }
  }

  // Append any hashes not found in branchCommits (shouldn't happen, but be safe)
  for (const h of hashes) {
    if (selected.has(h)) {
      sorted.push(h);
    }
  }

  return sorted;
}

/**
 * Resolve dependencies for non-sequential commit selections.
 *
 * Cherry-picks each selected commit in order onto a test branch. When a commit
 * fails, walks backwards through the gap (skipped commits between the previous
 * selected commit and this one) and tries adding them one at a time until the
 * failing commit applies.  Auto-included gap commits are tracked so the caller
 * can notify the user.
 *
 * Returns the expanded (resolved) list in topological order and the set of
 * auto-included hashes.  If resolution is impossible (a commit still fails
 * after exhausting its gap), the original list is returned unchanged and the
 * caller should fall back to merge-base / direct strategies.
 */
/** Get the set of files touched by a commit, excluding autoresearch metadata. */
async function getCommitFiles(pi: ExtensionAPI, cwd: string, hash: string): Promise<Set<string>> {
  try {
    const result = await pi.exec("git", ["diff-tree", "--no-commit-id", "--name-only", "-r", hash], { cwd });
    if (result.code !== 0) return new Set();
    return new Set(
      result.stdout
        .trim()
        .split("\n")
        .filter((f) => f && !AUTORESEARCH_FILES.some((af) => f === af || f.endsWith("/" + af)))
    );
  } catch {
    return new Set();
  }
}

/** Check if two file sets have any overlap. */
function filesOverlap(a: Set<string>, b: Set<string>): boolean {
  for (const f of a) {
    if (b.has(f)) return true;
  }
  return false;
}

async function resolveDependencies(
  pi: ExtensionAPI,
  cwd: string,
  selectedChronological: string[],
  branchCommits: { hash: string; subject: string }[],
  _baseRef: string,
  _currentBranch: string,
  onProgress?: (message: string) => void
): Promise<{ resolved: string[]; autoIncluded: string[]; ok: boolean }> {
  // Build the full ordered list of hashes (oldest first) from branchCommits
  const allOldestFirst = [...branchCommits].reverse().map((bc) => bc.hash);
  const selectedSet = new Set(selectedChronological);

  // Build a map: for each selected commit, the gap commits preceding it
  const gaps = new Map<string, string[]>();
  let lastSelectedIdx = -1;

  for (const hash of selectedChronological) {
    const idx = allOldestFirst.findIndex((h) => h === hash || h.startsWith(hash) || hash.startsWith(h.slice(0, 7)));
    if (idx === -1) continue;

    const gapStart = lastSelectedIdx + 1;
    const gapCommits: string[] = [];
    for (let i = gapStart; i < idx; i++) {
      if (!selectedSet.has(allOldestFirst[i])) {
        gapCommits.push(allOldestFirst[i]);
      }
    }
    gaps.set(hash, gapCommits);
    lastSelectedIdx = idx;
  }

  // Phase 1: File-overlap pre-filter.
  onProgress?.("Checking file overlaps between commits…");
  const fileCache = new Map<string, Set<string>>();

  async function getCachedFiles(hash: string): Promise<Set<string>> {
    let files = fileCache.get(hash);
    if (!files) {
      files = await getCommitFiles(pi, cwd, hash);
      fileCache.set(hash, files);
    }
    return files;
  }

  // For each selected commit, identify gap commits with file overlap (potential deps)
  const potentialDeps = new Map<string, string[]>();
  for (const hash of selectedChronological) {
    const gap = gaps.get(hash) ?? [];
    if (gap.length === 0) {
      potentialDeps.set(hash, []);
      continue;
    }

    const targetFiles = await getCachedFiles(hash);
    const overlapping: string[] = [];
    for (const gapHash of gap) {
      const gapFiles = await getCachedFiles(gapHash);
      if (filesOverlap(targetFiles, gapFiles)) {
        overlapping.push(gapHash);
      }
    }
    potentialDeps.set(hash, overlapping);
  }

  // Phase 2: Cherry-pick verification.
  // The caller provides a cwd that's already at the right base ref (e.g. a worktree).
  // We cherry-pick directly here — no branch creation needed.
  onProgress?.("Testing cherry-pick compatibility…");
  try {
    const resolved: string[] = [];
    const autoIncluded: string[] = [];

    for (let si = 0; si < selectedChronological.length; si++) {
      const hash = selectedChronological[si];
      const commitLabel =
        branchCommits.find((bc) => bc.hash === hash || bc.hash.startsWith(hash))?.hash.slice(0, 7) ?? hash.slice(0, 7);
      onProgress?.(`Testing commit ${si + 1}/${selectedChronological.length}: ${commitLabel}…`);

      if (await smartCherryPick(pi, cwd, hash)) {
        resolved.push(hash);
        continue;
      }

      // Cherry-pick failed — use file-overlap candidates to find minimal deps.
      // If file-overlap candidates don't resolve it, fall back to full gap.
      await pi.exec("git", ["cherry-pick", "--abort"], { cwd });

      const gap = gaps.get(hash) ?? [];
      if (gap.length === 0) {
        return { resolved: selectedChronological, autoIncluded: [], ok: false };
      }

      const fileOverlapCandidates = potentialDeps.get(hash) ?? [];
      // Try file-overlap candidates first, then full gap as fallback
      const candidateSets = fileOverlapCandidates.length > 0 ? [fileOverlapCandidates, gap] : [gap];

      const savePoint = (await pi.exec("git", ["rev-parse", "HEAD"], { cwd })).stdout.trim();

      onProgress?.(`Commit ${commitLabel} needs dependencies — resolving…`);
      let found = false;
      for (const candidates of candidateSets) {
        if (found) break;

        // Try minimal subsets from nearest candidate backwards
        for (let startIdx = candidates.length - 1; startIdx >= 0; startIdx--) {
          await pi.exec("git", ["reset", "--hard", savePoint], { cwd });

          const subset = candidates.slice(startIdx);
          let subsetOk = true;
          for (const depHash of subset) {
            if (!(await smartCherryPick(pi, cwd, depHash))) {
              await pi.exec("git", ["cherry-pick", "--abort"], { cwd });
              subsetOk = false;
              break;
            }
          }
          if (!subsetOk) continue;

          if (await smartCherryPick(pi, cwd, hash)) {
            for (const depHash of subset) {
              resolved.push(depHash);
              autoIncluded.push(depHash);
            }
            resolved.push(hash);
            found = true;
            break;
          }
          await pi.exec("git", ["cherry-pick", "--abort"], { cwd });
        }
      }

      if (!found) {
        return { resolved: selectedChronological, autoIncluded: [], ok: false };
      }
    }

    return { resolved, autoIncluded, ok: true };
  } catch {
    return { resolved: selectedChronological, autoIncluded: [], ok: false };
  }
}

/** Force-reset to a branch, cleaning any dirty state from failed operations. Never throws. */
async function forceCheckout(pi: ExtensionAPI, cwd: string, branch: string): Promise<void> {
  // Each step is best-effort — use pi.exec directly to avoid git() throwing
  try {
    await pi.exec("git", ["cherry-pick", "--abort"], { cwd });
  } catch {}
  try {
    await pi.exec("git", ["merge", "--abort"], { cwd });
  } catch {}
  try {
    await pi.exec("git", ["reset", "--hard", "HEAD"], { cwd });
  } catch {}
  try {
    await pi.exec("git", ["checkout", branch], { cwd });
  } catch {}
}


/**
 * Find the merge-base between the current branch and origin/main.
 * Returns null if it can't be determined.
 */
async function findMergeBase(pi: ExtensionAPI, cwd: string): Promise<string | null> {
  try {
    return await git(pi, ["merge-base", "origin/main", "HEAD"], cwd);
  } catch {
    try {
      return await git(pi, ["merge-base", "main", "HEAD"], cwd);
    } catch {
      return null;
    }
  }
}
