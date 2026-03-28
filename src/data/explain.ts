import { createHash } from "node:crypto";
import type { Config, Run } from "./parser.js";
import { appendStudioEntry, findCachedExplanation } from "./studio.js";

const PROMPT_VERSION = "v4";
const FALLBACK_MODEL = "heuristic-v2";

function fmtDelta(before: number, after: number): string {
  if (before == null || before === 0) {
    return "—";
  }
  const pct = ((after - before) / before) * 100;
  return `${pct > 0 ? "+" : ""}${pct.toFixed(1)}%`;
}

function confidenceLabel(confidence: number | null): string {
  if (confidence == null) {
    return "not available";
  }
  if (confidence >= 2) {
    return `high (${confidence.toFixed(1)}× noise floor)`;
  }
  if (confidence >= 1) {
    return `moderate (${confidence.toFixed(1)}× noise floor)`;
  }
  return `low (${confidence.toFixed(1)}× noise floor)`;
}

interface ExplainInput {
  config: Config;
  target: Run;
  baseline: Run;
  priorRun: Run;
  keptRunsInSegment: number;
  direction: "lower" | "higher";
}

interface ExplanationResult {
  explanation: string;
  source: "llm" | "heuristic";
  model: string;
  promptVersion: string;
  inputHash: string;
  run: number;
  segment: number;
  cached: boolean;
}

function extractInput(config: Config | undefined, runs: Run[], commit: string): ExplainInput | null {
  if (runs.length === 0) {
    return null;
  }

  const latestSegment = Math.max(...runs.map((r) => r.segment));
  const segmentRuns = runs.filter((r) => r.segment === latestSegment).sort((a, b) => a.run - b.run);
  if (segmentRuns.length === 0) {
    return null;
  }

  const keptRuns = segmentRuns.filter((r) => r.status === "keep");
  const target = segmentRuns.find((r) => r.commit === commit || r.commit.startsWith(commit));
  if (!target) {
    return null;
  }

  const cfg: Config =
    config ??
    ({
      name: "Autoresearch Session",
      metricName: "metric",
      metricUnit: "",
      bestDirection: "lower",
    } as Config);

  const baseline = keptRuns[0] ?? segmentRuns[0];
  const priorRun = segmentRuns.filter((r) => r.run < target.run).pop() ?? baseline;

  return {
    config: cfg,
    target,
    baseline,
    priorRun,
    keptRunsInSegment: keptRuns.length,
    direction: cfg.bestDirection,
  };
}

function inputHash(input: ExplainInput): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

function buildOutcomeAssessment(input: ExplainInput): string {
  const { target, priorRun, baseline, direction } = input;
  const betterVsPrior = direction === "lower" ? target.metric < priorRun.metric : target.metric > priorRun.metric;
  const betterVsBaseline = direction === "lower" ? target.metric < baseline.metric : target.metric > baseline.metric;

  if (target.status === "keep") {
    return `This run was kept. It ${betterVsPrior ? "improved" : "did not improve"} vs prior run and ${betterVsBaseline ? "improved" : "did not improve"} vs baseline.`;
  }

  if (target.status === "discard") {
    return `This run was discarded. It ${betterVsPrior ? "showed a short-term improvement" : "did not improve"} vs prior run and ${betterVsBaseline ? "improved" : "did not improve"} vs baseline; discard likely came from policy/noise/secondary concerns.`;
  }

  if (target.status === "checks_failed") {
    return "Benchmark may have passed, but guardrail checks failed, so the run was rejected.";
  }

  if (target.status === "crash") {
    return "Experiment execution crashed; no trustworthy performance conclusion can be drawn from this run.";
  }

  return "Run outcome requires manual review.";
}

function buildHeuristicExplanationFromInput(input: ExplainInput): string {
  const { config, target, baseline, priorRun, direction } = input;

  const deltaVsPrior = fmtDelta(priorRun.metric, target.metric);
  const deltaVsBaseline = fmtDelta(baseline.metric, target.metric);
  const metricName = config.metricName ?? "metric";

  const lines: string[] = [];
  lines.push(`# Explain This Experiment — Run #${target.run}`, "");
  lines.push("## Summary", "");
  lines.push(`- **Commit:** \`${target.commit.slice(0, 7)}\``);
  lines.push(`- **Status:** ${target.status}`);
  lines.push(`- **${metricName}:** ${target.metric.toLocaleString()}`);
  lines.push(`- **Direction:** ${direction} is better`);
  lines.push(`- **Confidence:** ${confidenceLabel(target.confidence)}`);
  lines.push("");

  lines.push("## Outcome analysis", "");
  lines.push(`- Versus previous run (#${priorRun.run}): **${deltaVsPrior}** (${priorRun.metric} → ${target.metric})`);
  lines.push(
    `- Versus baseline run (#${baseline.run}): **${deltaVsBaseline}** (${baseline.metric} → ${target.metric})`
  );
  lines.push(`- Assessment: ${buildOutcomeAssessment(input)}`);
  lines.push("");

  lines.push("## Likely mechanism", "");
  lines.push(`- Run description: ${target.description || "(none)"}`);
  lines.push("- Inference is based on run metadata and metric movement.");
  lines.push("");

  const metricNames = Array.from(
    new Set([...Object.keys(priorRun.metrics ?? {}), ...Object.keys(target.metrics ?? {})])
  );
  if (metricNames.length > 0) {
    lines.push("## Secondary metric impact", "");
    for (const name of metricNames) {
      const before = priorRun.metrics?.[name];
      const after = target.metrics?.[name];
      if (before == null || after == null) {
        continue;
      }
      const delta = fmtDelta(before, after);
      const better = direction === "lower" ? after <= before : after >= before;
      lines.push(
        `- ${name}: ${before.toLocaleString()} → ${after.toLocaleString()} (${delta}, ${better ? "favorable" : "unfavorable"})`
      );
    }
    lines.push("");
  }

  lines.push("## Recommendation", "");
  if (target.status === "keep") {
    lines.push("- Re-run the benchmark 2-3 times to confirm stability, then consider promoting this commit.");
  } else if (target.status === "discard") {
    lines.push("- Keep this discarded unless follow-up runs reproduce improvement with confidence ≥1.0×.");
  } else if (target.status === "checks_failed") {
    lines.push("- Fix failing checks first, then re-run to measure true performance impact.");
  } else if (target.status === "crash") {
    lines.push("- Stabilize the experiment path and rerun before drawing performance conclusions.");
  } else {
    lines.push("- Re-run with tighter controls and compare against baseline before deciding.");
  }

  return lines.join("\n");
}

async function generateLLMExplanation(input: ExplainInput): Promise<{ text: string; model: string } | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return null;
  }

  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const system =
    "You are an expert experiment analyst. Be direct, concise, and decision-oriented. Infer the likely domain (performance, quality, reliability, cost, product behavior) from metrics and descriptions, then analyze from that lens. Use confident language when evidence is strong and explicitly state confidence level (high/medium/low) for major claims. Do not fabricate code-level causes. Avoid excessive hedging and boilerplate disclaimers.";
  const user = [
    "Explain this experiment outcome (including failed/discarded runs) from the provided metadata.",
    "First infer the most likely experiment domain from session name, metric names/units, and run descriptions.",
    "Then provide actionable analysis for an engineering decision.",
    "Use sections: Summary, Outcome analysis, Likely mechanism, Secondary metric impact, Recommendation.",
    "In Recommendation, state one clear next step.",
    "Base reasoning only on supplied data; if evidence is weak, say that briefly and move on.",
    JSON.stringify(input, null, 2),
  ].join("\n\n");

  try {
    const baseUrl = process.env.OPENAI_BASE_URL || process.env.OPENAI_API_BASE || "https://api.openai.com/v1";
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });

    if (!res.ok) {
      return null;
    }

    const body = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const text = body.choices?.[0]?.message?.content?.trim();
    if (!text) {
      return null;
    }

    return { text, model };
  } catch {
    return null;
  }
}

export async function getOrGenerateWinExplanation(
  cwd: string,
  config: Config | undefined,
  runs: Run[],
  commit: string
): Promise<ExplanationResult | null> {
  const input = extractInput(config, runs, commit);
  if (!input) {
    return null;
  }

  const hash = inputHash(input);
  const cached = findCachedExplanation(cwd, input.target.commit, hash, PROMPT_VERSION);
  if (cached) {
    return {
      explanation: cached.content,
      source: cached.source,
      model: cached.model,
      promptVersion: cached.promptVersion,
      inputHash: cached.inputHash,
      run: cached.run,
      segment: cached.segment,
      cached: true,
    };
  }

  const llm = await generateLLMExplanation(input);
  const explanation = llm ? llm.text : buildHeuristicExplanationFromInput(input);
  const source: "llm" | "heuristic" = llm ? "llm" : "heuristic";
  const model = llm ? llm.model : FALLBACK_MODEL;

  appendStudioEntry(cwd, {
    type: "explanation",
    commit: input.target.commit,
    run: input.target.run,
    segment: input.target.segment,
    inputHash: hash,
    promptVersion: PROMPT_VERSION,
    source,
    model,
    content: explanation,
    createdAt: Date.now(),
  });

  return {
    explanation,
    source,
    model,
    promptVersion: PROMPT_VERSION,
    inputHash: hash,
    run: input.target.run,
    segment: input.target.segment,
    cached: false,
  };
}

export function buildWinExplanation(config: Config | undefined, runs: Run[], commit: string): string | null {
  const input = extractInput(config, runs, commit);
  return input ? buildHeuristicExplanationFromInput(input) : null;
}
