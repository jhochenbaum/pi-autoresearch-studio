import { collectDashboardData } from "../data/collect.js";
import { buildPageHTML } from "./build.js";

/**
 * Generate a self-contained HTML dashboard.
 *
 * Note: standalone generation does not shell out for git metadata;
 * PR commit selection is available in the live /arstudio web flow.
 */
export function generateHTML(cwd: string): string {
  const data = collectDashboardData(cwd);
  return buildPageHTML(data, "[]");
}
