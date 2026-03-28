import type { DashboardData } from "../data/collect.js";
import { esc, safeJson, readHtmlAsset } from "./utils.js";

/** Build the full HTML page from dashboard data. */
export function buildPageHTML(data: DashboardData, commitsJson: string = "[]"): string {
  const template = readHtmlAsset("template.html");
  const css = readHtmlAsset("styles.css");
  const js = readHtmlAsset("dashboard.js");

  const hasMetric = data.config.metricName && data.config.metricName.trim().length > 0;
  const subtitle = hasMetric
    ? `${esc(data.config.metricName)}${data.config.metricUnit ? " (" + esc(data.config.metricUnit) + ")" : ""} · ${data.config.bestDirection === "lower" ? "↓ lower" : "↑ higher"} is better`
    : data.hasSession
      ? "Waiting for first experiment results…"
      : "No autoresearch session yet — start one with /arstudio new";

  return template
    .replace(/{{CONFIG_NAME}}/g, () => esc(data.config.name))
    .replace("{{CONFIG_SUBTITLE}}", () => subtitle)
    .replace("{{CSS}}", () => css)
    .replace("{{DATA_JSON}}", () =>
      safeJson({
        config: data.config,
        runs: data.runs,
        allRuns: data.allRuns,
        secondaryMetrics: data.secondaryMetrics,
        hasSession: data.hasSession,
      })
    )
    .replace("{{PLAN_JSON}}", () => safeJson(data.plan))
    .replace("{{IDEAS_JSON}}", () => safeJson(data.ideas))
    .replace("{{COMMITS_JSON}}", () => commitsJson.replace(/<\//g, "<\\/"))
    .replace("{{JS}}", () => js);
}
