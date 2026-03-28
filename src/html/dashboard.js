// Client-side dashboard logic - injected into the HTML template.
// Data variables (D, PLAN, IDEAS, COMMITS) are set by the generator before this script.

function esc(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML.replace(/'/g, "&#39;");
}
function fmt(n) {
  return n != null ? n.toLocaleString() : "-";
}
function dCls(p) {
  return D.config.bestDirection === "lower"
    ? p < 0
      ? "good"
      : p > 0
        ? "bad"
        : "neutral"
    : p > 0
      ? "good"
      : p < 0
        ? "bad"
        : "neutral";
}
function fD(p) {
  return (p > 0 ? "+" : "") + p.toFixed(1) + "%";
}

let primaryChart = null;
let sessionStartedGoal = null; // tracks "session queued" state across re-renders

function destroyCharts() {
  if (primaryChart) {
    primaryChart.destroy();
    primaryChart = null;
  }
}

function showTab(id) {
  document.querySelectorAll(".tab-content").forEach((t) => {
    t.classList.remove("active");
    t.hidden = true;
  });
  document.querySelectorAll(".nav-tab").forEach((t) => {
    t.classList.remove("active");
    t.setAttribute("aria-selected", "false");
    t.setAttribute("tabindex", "-1");
  });

  const activePanel = document.getElementById("tab-" + id);
  const activeTab = document.querySelector('.nav-tab[data-tab="' + id + '"]');
  if (activePanel) {
    activePanel.classList.add("active");
    activePanel.hidden = false;
  }
  if (activeTab) {
    activeTab.classList.add("active");
    activeTab.setAttribute("aria-selected", "true");
    activeTab.setAttribute("tabindex", "0");
  }
  if (id === "dashboard" && !window._chartsRendered) renderDashboard();
}

function initTabKeyboardNav() {
  const tabs = [...document.querySelectorAll(".nav-tab")];
  tabs.forEach((tab, index) => {
    tab.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft" && e.key !== "Home" && e.key !== "End") return;
      e.preventDefault();
      let target = index;
      if (e.key === "ArrowRight") target = (index + 1) % tabs.length;
      if (e.key === "ArrowLeft") target = (index - 1 + tabs.length) % tabs.length;
      if (e.key === "Home") target = 0;
      if (e.key === "End") target = tabs.length - 1;
      const next = tabs[target];
      next.focus();
      showTab(next.dataset.tab);
    });
  });
}

const THEME_KEY = "arstudio-theme";

function readStoredTheme() {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === "light" || stored === "dark") {
      return stored;
    }
  } catch {}
  return null;
}

function preferredTheme() {
  const stored = readStoredTheme();
  if (stored) return stored;
  return window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

function updateThemeToggleLabel(theme) {
  const btn = document.getElementById("theme-toggle");
  if (!btn) return;
  const next = theme === "dark" ? "light" : "dark";
  btn.textContent = next === "light" ? "☀️ Light" : "🌙 Dark";
  btn.setAttribute("aria-label", "Switch to " + next + " mode");
}

function applyTheme(theme, rerender = false) {
  document.documentElement.dataset.theme = theme;
  updateThemeToggleLabel(theme);
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {}

  if (rerender) {
    const dashActive = document.getElementById("tab-dashboard")?.classList.contains("active");
    if (dashActive) {
      window._chartsRendered = false;
      renderDashboard();
    }
  }
}

function initThemeToggle() {
  applyTheme(preferredTheme());
  const btn = document.getElementById("theme-toggle");
  if (!btn) return;
  btn.addEventListener("click", () => {
    const current = document.documentElement.dataset.theme === "light" ? "light" : "dark";
    const next = current === "dark" ? "light" : "dark";
    applyTheme(next, true);
  });
}

function prefersReducedMotion() {
  return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function renderDashboard() {
  const a = document.getElementById("tab-dashboard"),
    r = D.runs;
  destroyCharts();
  if (!r.length) {
    if (sessionStartedGoal) {
      // Session was started — show persistent "queued" state
      a.innerHTML =
        '<div class="empty-state">' +
        "<h2>Session starting…</h2>" +
        '<p class="empty-state-desc">Goal: <strong>' + esc(sessionStartedGoal) + "</strong></p>" +
        '<div class="empty-state-status success">Session queued in pi. The agent is setting up — experiments will appear here once the first benchmark runs.</div>' +
        '<p class="empty-state-desc" style="margin-top:1em;opacity:0.7">Switch to the <strong>Activity</strong> tab to watch live agent output.</p>' +
        "</div>";
      return;
    }
    a.innerHTML =
      '<div class="empty-state">' +
      "<h2>Ready to optimize</h2>" +
      '<p class="empty-state-desc">Describe what to optimize. Studio runs experiments, tracks metrics, and surfaces the best results.</p>' +
      '<div class="empty-state-form">' +
      '<input id="new-goal-input" class="empty-state-input" type="text" placeholder="e.g., optimize test runtime" />' +
      '<button id="new-goal-btn" class="pr-btn primary" onclick="startNewSession()">New Session</button>' +
      "</div>" +
      '<div id="new-goal-status" class="empty-state-status"></div>' +
      '<ul class="empty-state-examples" id="goal-examples">' +
      '<li data-goal="optimize unit test runtime, monitor correctness">optimize unit test runtime, monitor correctness</li>' +
      '<li data-goal="reduce bundle size while keeping all features">reduce bundle size while keeping all features</li>' +
      '<li data-goal="train model for 5 minutes, track loss as metric">train model for 5 minutes, track loss as metric</li>' +
      "</ul>" +
      '<div class="empty-state-hint">' +
      "or in pi: <code>/arstudio new</code>" +
      "</div>" +
      "</div>";
    const inp = document.getElementById("new-goal-input");
    if (inp) {
      inp.addEventListener("keydown", function (e) {
        if (e.key === "Enter") startNewSession();
      });
    }
    const examples = document.getElementById("goal-examples");
    if (examples && inp) {
      examples.addEventListener("click", function (e) {
        const li = e.target.closest("li[data-goal]");
        if (li && inp) {
          inp.value = li.dataset.goal;
          inp.focus();
        }
      });
    }
    return;
  }
  const k = r.filter((x) => x.status === "keep"),
    bl = k[0]?.metric ?? 0,
    cur = k[k.length - 1]?.metric ?? 0,
    ms = k.map((x) => x.metric),
    best = D.config.bestDirection === "lower" ? Math.min(...ms) : Math.max(...ms),
    pC = bl ? ((cur - bl) / bl) * 100 : 0,
    pB = bl ? ((best - bl) / bl) * 100 : 0,
    td = r.length - k.length,
    enter = !window._dashboardAnimatedOnce && !prefersReducedMotion(),
    kpiClass = enter ? "kpi-grid motion-enter delay-1" : "kpi-grid",
    chartsClass = enter ? "charts motion-enter delay-2" : "charts",
    logClass = enter ? "tw motion-enter delay-3" : "tw";
  let h = '<section class="' + kpiClass + '" aria-label="Performance overview">';
  h +=
    '<article class="card card-hero"><div class="l">Current result</div><div class="v current">' +
    fmt(cur) +
    '</div><div class="d ' +
    dCls(pC) +
    '">' +
    fD(pC) +
    " vs baseline</div></article>";
  h +=
    '<article class="card"><div class="l">Best run</div><div class="v best">' +
    fmt(best) +
    '</div><div class="d ' +
    dCls(pB) +
    '">' +
    fD(pB) +
    "</div></article>";
  h +=
    '<article class="card"><div class="l">Baseline</div><div class="v">' +
    fmt(bl) +
    '</div><div class="d neutral">Run #' +
    (k[0]?.run ?? "?") +
    "</div></article>";
  h +=
    '<article class="card"><div class="l">Experiment count</div><div class="v">' +
    r.length +
    '</div><div class="d neutral">' +
    k.length +
    " kept · " +
    td +
    " other</div></article></section>";

  h +=
    '<section class="' +
    chartsClass +
    '" aria-label="Metric trends"><article class="cbox"><h2>Primary Metric</h2><canvas id="c1"></canvas></article>';
  h += D.secondaryMetrics.length
    ? '<article class="cbox"><h2>Secondary Metrics (latest vs baseline)</h2><div id="sec-bars" class="sec-bars"></div></article>'
    : '<article class="cbox"><h2>Secondary Metrics</h2><div class="chart-empty">No secondary metrics recorded for this session.</div></article>';
  h += "</section>";

  h +=
    '<section class="' +
    logClass +
    '" aria-label="Experiment log"><div class="tw-head"><h2>Experiment Log</h2><p class="tw-sub">Inspect winners, then promote selected commits.</p></div><div class="pr-actions"><div class="pr-btn-group"><button class="pr-btn secondary" onclick="selectKept()">Select All</button><button class="pr-btn secondary" onclick="selectNone()">Clear</button></div><div class="pr-main-action"><button class="pr-btn secondary" id="pr-dryrun-btn" disabled onclick="dryRun()">🔍 Dry Run</button><button class="pr-btn primary" id="pr-create-btn" disabled onclick="createPR()">📋 Copy PR Command</button><span class="pr-count" id="pr-count">0 selected</span></div></div><div id="pr-status" class="pr-status"></div><div class="log-layout" id="log-layout"><div class="log-table-wrap"><table><thead><tr><th>#</th><th>Status</th><th>' +
    esc(D.config.metricName) +
    '</th><th>Δ%</th><th>Conf.</th><th>Commit</th><th class="col-pr">PR</th><th class="col-explain">Explain</th><th>Description</th></tr></thead><tbody>';

  for (let i = r.length - 1; i >= 0; i--) {
    const x = r[i],
      d = bl ? ((x.metric - bl) / bl) * 100 : 0,
      dc = x.status === "keep" ? dCls(d) : "neutral",
      cs = x.confidence != null ? x.confidence.toFixed(1) + "×" : "-",
      cc = x.confidence == null ? "" : x.confidence >= 2 ? "good" : x.confidence >= 1 ? "neutral" : "bad",
      rowId = "pr-row-" + x.run;

    h +=
      '<tr onclick="toggleRow(this)" onkeydown="if(event.key===\'Enter\'||event.key===\' \'){event.preventDefault();toggleRow(this)}" tabindex="0" class="log-row"><td>' +
      x.run +
      '</td><td><span class="st ' +
      x.status +
      '">' +
      (x.status === "keep" ? "✓" : x.status === "discard" ? "✗" : "💥") +
      " " +
      x.status +
      "</span></td><td>" +
      fmt(x.metric) +
      '</td><td class="' +
      dc +
      '">' +
      (x.metric > 0 ? fD(d) : "-") +
      '</td><td class="' +
      cc +
      '">' +
      cs +
      '</td><td class="cm">' +
      esc(x.commit.slice(0, 7)) +
      '</td><td><label class="sr-only" for="' +
      rowId +
      '">Select commit ' +
      esc(x.commit.slice(0, 7)) +
      ' for PR</label><input id="' +
      rowId +
      '" class="pr-check" type="checkbox" data-commit="' +
      esc(x.commit) +
      '" data-status="' +
      x.status +
      '"' +
      (x.status !== "keep" ? " disabled" : "") +
      ' onclick="event.stopPropagation();updatePRCount()"></td><td><button class="pr-btn secondary explain-btn compact" data-commit="' +
      esc(x.commit) +
      '" aria-label="Explain experiment ' +
      esc(String(x.run)) +
      '" onclick="event.stopPropagation();explainWin(\'' +
      esc(x.commit) +
      '\')">💡</button></td><td class="ds" title="' +
      esc(x.description) +
      '">' +
      esc(x.description) +
      "</td></tr>";
  }

  h += '</tbody></table></div><aside id="explain-panel" class="explain-panel" hidden></aside></div></section>';
  a.innerHTML = h;
  window._chartsRendered = true;
  if (enter) {
    window._dashboardAnimatedOnce = true;
  }

  const css = getComputedStyle(document.documentElement);
  const tok = (name, fallback) => css.getPropertyValue(name).trim() || fallback;
  const chartTokens = {
    keep: tok("--green", "#4ccf78"),
    discard: tok("--yellow", "#d8b35f"),
    crash: tok("--red", "#ef6b73"),
    accent: tok("--accent", "#7ab3f8"),
    fg2: tok("--fg2", "#bcc8da"),
    fg3: tok("--fg3", "#8d98ab"),
    grid: tok("--line", "#2b3444"),
    surface: tok("--surface-2", "#1b2230"),
  };

  // Primary metric chart
  const x1 = document.getElementById("c1").getContext("2d"),
    pc = r.map((x) =>
      x.status === "keep" ? chartTokens.keep : x.status === "discard" ? chartTokens.discard : chartTokens.crash
    );
  primaryChart = new Chart(x1, {
    type: "line",
    data: {
      labels: r.map((x) => "#" + x.run),
      datasets: [
        {
          label: D.config.metricName,
          data: r.map((x) => x.metric),
          borderColor: chartTokens.accent,
          backgroundColor: "rgba(122,179,248,0.12)",
          fill: true,
          tension: 0.3,
          pointBackgroundColor: pc,
          pointRadius: r.map((x) => (x.status === "keep" ? 4 : 2.5)),
        },
        {
          label: "Baseline",
          data: r.map(() => bl),
          borderColor: chartTokens.fg2,
          borderDash: [6, 4],
          pointRadius: 0,
        },
      ],
    },
    options: {
      responsive: true,
      plugins: {
        legend: { labels: { color: chartTokens.fg2 } },
        tooltip: {
          callbacks: {
            afterBody: function (c) {
              const i = c[0].dataIndex,
                x = r[i];
              let l = [x.status.toUpperCase(), x.description.slice(0, 80)];
              if (x.metrics) for (const [k, v] of Object.entries(x.metrics)) l.push(k + ": " + v.toLocaleString());
              return l;
            },
          },
        },
      },
      scales: {
        x: { ticks: { color: chartTokens.fg3 }, grid: { color: chartTokens.grid } },
        y: { ticks: { color: chartTokens.fg3 }, grid: { color: chartTokens.grid } },
      },
    },
  });

  // Secondary metrics or status doughnut
  if (D.secondaryMetrics.length) {
    const el = document.getElementById("sec-bars"),
      latest = k[k.length - 1],
      base = k[0],
      p = [chartTokens.accent, chartTokens.keep, chartTokens.discard, tok("--chart-4", "#9d96dc"), tok("--chart-5", "#d2aa7a"), tok("--chart-6", "#72b7a2")];
    const maxVal = Math.max(
      ...D.secondaryMetrics.map((n) =>
        Math.max((latest.metrics && latest.metrics[n]) ?? 0, (base.metrics && base.metrics[n]) ?? 0)
      )
    );
    let bh = "";
    D.secondaryMetrics.forEach((n, i) => {
      const val = (latest.metrics && latest.metrics[n]) ?? 0;
      const bv = (base.metrics && base.metrics[n]) ?? 0;
      const pct = maxVal > 0 ? (val / maxVal) * 100 : 0;
      const delta = bv ? ((val - bv) / bv) * 100 : 0;
      const dc =
        D.config.bestDirection === "lower"
          ? delta <= 0
            ? "var(--green)"
            : "var(--red)"
          : delta >= 0
            ? "var(--green)"
            : "var(--red)";
      bh +=
        '<div class="sec-row"><div class="sec-row-head"><span class="sec-name">' +
        esc(n) +
        '</span><span class="sec-values"><span class="sec-value">' +
        fmt(val) +
        '</span> <span class="sec-delta" style="color:' +
        dc +
        '">' +
        fD(delta) +
        '</span></span></div><div class="sec-track"><div class="sec-fill" style="--fill:' +
        pct +
        "%;--fill-color:" +
        p[i % p.length] +
        '"></div></div></div>';
    });
    el.innerHTML = bh;
  }
}

// ── Plan/Ideas with edit mode ──

// Mutable copies for editing
let planDraft = PLAN;
let ideasDraft = IDEAS;
let planEditing = false;
let ideasEditing = false;

function renderMdTab(el, content, draft, editing, filename, toggleFn, saveFn) {
  if (!content && !editing) {
    const desc =
      filename === "autoresearch.md"
        ? "This file defines the optimization objective, metrics, constraints, and what's been tried. It's created when a session starts."
        : "This file captures optimization ideas to explore in future experiments. Add notes as you go.";
    el.innerHTML =
      '<div class="md-empty">' +
      "<p>" +
      esc(filename) +
      " doesn't exist yet.</p>" +
      '<p class="md-empty-desc">' +
      desc +
      "</p>" +
      '<button class="pr-btn secondary" onclick="' +
      toggleFn +
      '()">Create ' +
      esc(filename) +
      "</button>" +
      "</div>";
    return;
  }
  let h = '<div class="md-toolbar">';
  if (editing) {
    h += '<button class="pr-btn primary" onclick="' + saveFn + '()">💾 Save</button>';
    h += '<button class="pr-btn secondary" onclick="' + toggleFn + '()">Cancel</button>';
    h += '<span class="save-hint" id="save-hint-' + esc(filename) + '"></span>';
  } else {
    h += '<button class="pr-btn secondary" onclick="' + toggleFn + '()">✏️ Edit</button>';
  }
  h += "</div>";
  if (editing) {
    h +=
      '<textarea class="md-editor" id="editor-' + esc(filename) + '" spellcheck="false">' + esc(draft) + "</textarea>";
  } else {
    h += '<div class="md-content">' + DOMPurify.sanitize(marked.parse(draft || "")) + "</div>";
  }
  el.innerHTML = h;
  if (editing) {
    const ta = document.getElementById("editor-" + filename);
    if (ta) {
      ta.focus();
      ta.style.height = Math.max(400, ta.scrollHeight) + "px";
      ta.addEventListener("input", function () {
        this.style.height = "auto";
        this.style.height = Math.max(400, this.scrollHeight) + "px";
      });
      // Ctrl+S / Cmd+S to save
      ta.addEventListener("keydown", function (e) {
        if ((e.ctrlKey || e.metaKey) && e.key === "s") {
          e.preventDefault();
          window[saveFn]();
        }
      });
    }
  }
}

function togglePlanEdit() {
  if (planEditing) {
    planDraft = PLAN;
  }
  planEditing = !planEditing;
  renderPlan();
}
function savePlan() {
  const ta = document.getElementById("editor-autoresearch.md");
  if (ta) {
    planDraft = ta.value;
  }
  saveFile("plan", planDraft, "autoresearch.md");
  planEditing = false;
  renderPlan();
}

function toggleIdeasEdit() {
  if (ideasEditing) {
    ideasDraft = IDEAS;
  }
  ideasEditing = !ideasEditing;
  renderIdeas();
}
function saveIdeas() {
  const ta = document.getElementById("editor-autoresearch.ideas.md");
  if (ta) {
    ideasDraft = ta.value;
  }
  saveFile("ideas", ideasDraft, "autoresearch.ideas.md");
  ideasEditing = false;
  renderIdeas();
}

async function saveFile(fileKey, content, displayName) {
  const hint = document.getElementById("save-hint-" + displayName);
  try {
    const res = await fetch("/api/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file: fileKey, content }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || "Save failed");
    }
    if (hint) {
      hint.textContent = "✓ Saved";
      hint.style.color = "var(--green)";
    }
  } catch (e) {
    if (hint) {
      hint.textContent = "✗ " + (e.message || "Save failed");
      hint.style.color = "var(--red)";
    }
  }
}

function renderPlan() {
  renderMdTab(
    document.getElementById("tab-plan"),
    PLAN,
    planDraft,
    planEditing,
    "autoresearch.md",
    "togglePlanEdit",
    "savePlan"
  );
}
function renderIdeas() {
  renderMdTab(
    document.getElementById("tab-ideas"),
    IDEAS,
    ideasDraft,
    ideasEditing,
    "autoresearch.ideas.md",
    "toggleIdeasEdit",
    "saveIdeas"
  );
}

function toggleRow(tr) {
  const cb = tr.querySelector("input[type=checkbox]");
  if (cb) {
    if (cb.dataset.status !== "keep") {
      return;
    }
    cb.checked = !cb.checked;
    updatePRCount();
  }
}
function selectKept() {
  document.querySelectorAll("tbody input[type=checkbox]").forEach((cb) => {
    cb.checked = cb.dataset.status === "keep";
  });
  updatePRCount();
}
function selectNone() {
  document.querySelectorAll("tbody input[type=checkbox]").forEach((cb) => {
    cb.checked = false;
  });
  updatePRCount();
  document.getElementById("pr-status").innerHTML = "";
  hideExplainPanel();
}
function updatePRCount() {
  const n = document.querySelectorAll("tbody input[type=checkbox]:checked").length;
  document.getElementById("pr-count").textContent = n + " selected";
  document.getElementById("pr-create-btn").disabled = n === 0;
  document.getElementById("pr-dryrun-btn").disabled = n === 0;
  if (n === 0) {
    document.getElementById("pr-status").innerHTML = "";
  }
}
function copyCommandWithStatus(cmd, subtitle) {
  const el = document.getElementById("pr-status");
  navigator.clipboard.writeText(cmd).then(
    () => {
      el.innerHTML =
        '<div class="feedback-row">' +
        '<span class="feedback-success">✓ Copied to clipboard</span>' +
        '<code class="feedback-code">' +
        esc(cmd) +
        "</code>" +
        "</div>" +
        '<div class="feedback-hint">' +
        esc(subtitle) +
        "</div>";
    },
    () => {
      el.innerHTML =
        '<div class="feedback">' +
        '<span class="feedback-muted">Copy and paste in pi:</span>' +
        '<code class="feedback-code-block">' +
        esc(cmd) +
        "</code>" +
        "</div>";
    }
  );
}



function showExplainPanel(contentHtml) {
  const panel = document.getElementById("explain-panel");
  const layout = document.getElementById("log-layout");
  if (!panel || !layout) {
    return;
  }
  if (panel._hideTimer) {
    clearTimeout(panel._hideTimer);
    panel._hideTimer = null;
  }
  panel.hidden = false;
  panel.innerHTML = contentHtml;
  layout.classList.add("has-explain");
  if (prefersReducedMotion()) {
    panel.classList.add("is-open");
    return;
  }
  requestAnimationFrame(() => panel.classList.add("is-open"));
}

function hideExplainPanel() {
  const panel = document.getElementById("explain-panel");
  const layout = document.getElementById("log-layout");
  if (!panel || !layout) {
    return;
  }
  layout.classList.remove("has-explain");
  panel.classList.remove("is-open");
  if (prefersReducedMotion()) {
    panel.hidden = true;
    panel.innerHTML = "";
    return;
  }
  panel._hideTimer = setTimeout(() => {
    panel.hidden = true;
    panel.innerHTML = "";
    panel._hideTimer = null;
  }, 170);
}

async function explainWin(commit) {
  const statusEl = document.getElementById("pr-status");
  const buttons = [...document.querySelectorAll(".explain-btn")];

  buttons.forEach((btn) => {
    btn.disabled = true;
    btn.style.opacity = "0.6";
  });

  statusEl.innerHTML = '<span class="feedback-muted">Generating explanation…</span>';
  showExplainPanel(
    '<div class="explain-head"><span class="explain-title">💡 Explain This Experiment</span></div>' +
      '<div class="explain-loading">Generating explanation... this can take a few seconds.</div>'
  );

  try {
    const res = await fetch("/api/explain?commit=" + encodeURIComponent(commit));
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || "Failed to explain this run");
    }

    const body = await res.json();
    const html = DOMPurify.sanitize(marked.parse(body.explanation || ""));
    const meta = `Source: ${body.source || "unknown"}${body.cached ? " (cached)" : ""}${body.model ? ` · Model: ${body.model}` : ""}`;

    showExplainPanel(
      '<div class="explain-head">' +
        '<span class="explain-title">💡 Explain This Experiment</span>' +
        '<button class="pr-btn secondary explain-close" onclick="hideExplainPanel()">Close</button>' +
        "</div>" +
        '<div class="explain-meta">' +
        esc(meta) +
        "</div>" +
        '<div class="md-content explain-content">' +
        html +
        "</div>"
    );
    statusEl.innerHTML = '<span class="feedback-success">✓ Explanation ready</span>';
  } catch (e) {
    const msg = esc(e.message || "Failed");
    showExplainPanel(
      '<div class="explain-head">' +
        '<span class="explain-title">💡 Explain This Experiment</span>' +
        '<button class="pr-btn secondary explain-close" onclick="hideExplainPanel()">Close</button>' +
        "</div>" +
        '<div class="explain-error">✗ ' +
        msg +
        "</div>"
    );
    statusEl.innerHTML = '<span class="feedback-error">✗ Failed</span>';
  } finally {
    buttons.forEach((btn) => {
      btn.disabled = false;
      btn.style.opacity = "";
    });
  }
}

async function startNewSession() {
  const inp = document.getElementById("new-goal-input");
  const btn = document.getElementById("new-goal-btn");
  const status = document.getElementById("new-goal-status");
  const goal = inp ? inp.value.trim() : "";
  if (!goal) {
    if (inp) inp.focus();
    return;
  }
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Starting...";
  }
  if (status) status.textContent = "";
  try {
    const res = await fetch("/api/new", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ goal: goal }),
    });
    if (!res.ok) {
      const err = await res.json().catch(function () {
        return {};
      });
      throw new Error(err.error || "Failed to start session");
    }
    sessionStartedGoal = goal;
    if (btn) {
      btn.textContent = "✓ Started";
      btn.classList.remove("primary");
    }
    if (inp) inp.disabled = true;
    if (status) {
      status.innerHTML = "Session queued in pi. Experiments will appear here as they complete.";
      status.classList.add("success");
    }
  } catch (e) {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "New Session";
    }
    if (status) {
      status.textContent = e.message || "Failed to start session";
      status.classList.add("error");
    }
  }
}

function dismissDryRun() {
  document.getElementById("pr-status").innerHTML = "";
}

function dryRun() {
  const commits = [...document.querySelectorAll("tbody input[type=checkbox]:checked")]
    .map(function(cb) { return cb.dataset.commit; })
    .filter(Boolean);
  if (commits.length === 0) return;

  const el = document.getElementById("pr-status");
  const btn = document.getElementById("pr-dryrun-btn");
  btn.disabled = true;
  el.innerHTML =
    '<div class="dryrun-progress-bar">' +
    '<span class="dryrun-spinner" style="display:inline-block;width:0.75rem;height:0.75rem;border:2px solid var(--border,#444);border-top-color:var(--accent,#58a6ff);border-radius:50%;animation:spin .6s linear infinite;vertical-align:middle"></span>' +
    ' <span id="dryrun-progress-text">Analyzing\u2026</span>' +
    '</div>';

  fetch("/api/dryrun", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ hashes: commits }),
  })
    .then(function(response) {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      function processChunk(result) {
        if (result.done) {
          // Process any remaining buffer
          if (buffer.trim()) processLine(buffer.trim());
          return;
        }
        buffer += decoder.decode(result.value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        lines.forEach(function(line) {
          if (line.trim()) processLine(line.trim());
        });
        return reader.read().then(processChunk);
      }

      function processLine(line) {
        try {
          const data = JSON.parse(line);
          if (data.type === "progress") {
            const textEl = document.getElementById("dryrun-progress-text");
            if (textEl) textEl.textContent = data.message;
          } else if (data.type === "result") {
            if (data.ok) {
              const isReady = data.report.indexOf("\u2713 Ready") >= 0;
              el.innerHTML =
                '<div class="dryrun-result">' +
                "<pre>" + esc(data.report) + "</pre>" +
                '<div class="dryrun-actions">' +
                (isReady ? '<button class="pr-btn primary" onclick="dismissDryRun();createPR()">\ud83d\udccb Copy PR Command</button>' : "") +
                '<button class="pr-btn secondary" onclick="dismissDryRun()">Dismiss</button>' +
                "</div></div>";
            } else {
              el.innerHTML =
                '<div class="feedback-row"><span class="feedback-error">\u2717 ' +
                esc(data.error || "Dry run failed") +
                "</span></div>";
            }
            btn.disabled = false;
            updatePRCount();
          }
        } catch(e) { console.warn("[arstudio] Failed to parse dry-run line:", e); }
      }

      return reader.read().then(processChunk);
    })
    .catch(function(err) {
      el.innerHTML =
        '<div class="feedback-row"><span class="feedback-error">\u2717 ' +
        esc(err.message || "Network error") +
        "</span></div>";
      btn.disabled = false;
      updatePRCount();
    });
}

function createPR() {
  const commits = [...document.querySelectorAll("tbody input[type=checkbox]:checked")]
    .map((cb) => cb.dataset.commit)
    .filter(Boolean);
  const cmd = "/arstudio pr " + commits.join(" ");
  copyCommandWithStatus(
    cmd,
    "Paste in pi to create PR - you'll pick the mode there (consolidated, stacked, or individual)"
  );
}

// ── WebSocket live updates ──

let wsReconnectTimer = null;
let pollTimer = null;
let liveTicker = null;
let socketOpen = false;
let lastUpdateTs = Date.now();
let lastRunTimestampMs = 0;
let cadenceMs = 45000;

function likelyRunState() {
  // Activity feed knows definitively if the agent is running
  if (agentRunning) return "running";
  if (!socketOpen || !lastRunTimestampMs || (D.runs || []).length === 0) {
    return "idle";
  }
  const sinceLast = Date.now() - lastRunTimestampMs;
  const lower = Math.max(12000, cadenceMs * 0.7);
  const upper = Math.min(10 * 60 * 1000, cadenceMs * 2.2);
  return sinceLast >= lower && sinceLast <= upper ? "likely running" : "idle";
}

function setLiveStatus(state, detail) {
  const el = document.getElementById("live-status");
  if (!el) return;
  el.classList.remove("live", "connecting", "reconnecting", "offline");
  el.classList.add(state);

  if (state === "live") {
    const ageSec = Math.max(0, Math.floor((Date.now() - lastUpdateTs) / 1000));
    const freshness = ageSec < 3 ? "just now" : ageSec < 60 ? `${ageSec}s ago` : `${Math.floor(ageSec / 60)}m ago`;
    el.textContent = `Live · ${likelyRunState()} · updated ${freshness}`;
    return;
  }

  if (state === "connecting") {
    el.textContent = "Connecting...";
    return;
  }

  if (state === "reconnecting") {
    el.textContent = detail || "Reconnecting...";
    return;
  }

  el.textContent = detail || "Offline";
}

function startLiveTicker() {
  if (liveTicker) return;
  liveTicker = setInterval(() => {
    const el = document.getElementById("live-status");
    if (el && el.classList.contains("live")) {
      setLiveStatus("live");
    }
  }, 5000);
}

function seedRunHeuristicFromData(data) {
  const runs = [...(data.runs || [])].sort((a, b) => a.run - b.run);
  if (runs.length > 0) {
    lastRunTimestampMs = runs[runs.length - 1].timestamp || Date.now();
  }

  if (runs.length >= 3) {
    const recent = runs.slice(-5);
    const gaps = [];
    for (let i = 1; i < recent.length; i++) {
      const g = recent[i].timestamp - recent[i - 1].timestamp;
      if (g > 0) gaps.push(g);
    }
    if (gaps.length > 0) {
      gaps.sort((a, b) => a - b);
      cadenceMs = gaps[Math.floor(gaps.length / 2)];
    }
  }
}

function applyIncomingData(data) {
  const prevLastRun = D.runs && D.runs.length > 0 ? D.runs[D.runs.length - 1].run : 0;

  D.config = data.config;
  D.runs = data.runs;
  D.allRuns = data.allRuns;
  D.secondaryMetrics = data.secondaryMetrics;
  lastUpdateTs = Date.now();
  seedRunHeuristicFromData(data);

  const nextLastRun = D.runs && D.runs.length > 0 ? D.runs[D.runs.length - 1].run : 0;
  if (nextLastRun > prevLastRun && D.runs.length > 0) {
    lastRunTimestampMs = D.runs[D.runs.length - 1].timestamp || Date.now();
  }

  // Clear "session started" state once real data arrives
  if (D.runs && D.runs.length > 0) {
    sessionStartedGoal = null;
  }

  if (!planEditing) {
    PLAN = data.plan;
    planDraft = PLAN;
  }
  if (!ideasEditing) {
    IDEAS = data.ideas;
    ideasDraft = IDEAS;
  }

  window._chartsRendered = false;
  renderDashboard();
  if (!planEditing) renderPlan();
  if (!ideasEditing) renderIdeas();
  setLiveStatus("live");
}

function startFallbackPolling() {
  if (pollTimer) return;
  pollTimer = setInterval(async () => {
    try {
      const res = await fetch("/api/data", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      applyIncomingData(data);
    } catch (e) { console.warn("[arstudio] Polling fetch failed:", e); }
  }, 3000);
}

function stopFallbackPolling() {
  if (!pollTimer) return;
  clearInterval(pollTimer);
  pollTimer = null;
}

function scheduleReconnect() {
  if (wsReconnectTimer) return;
  wsReconnectTimer = setTimeout(() => {
    wsReconnectTimer = null;
    connectWebSocket();
  }, 2000);
}

function connectWebSocket() {
  setLiveStatus("connecting");
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const socket = new WebSocket(proto + "//" + location.host + "/ws");

  socket.onopen = function () {
    socketOpen = true;
    stopFallbackPolling();
    setLiveStatus("live");
  };

  socket.onmessage = function (event) {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === "update" && msg.data) {
        applyIncomingData(msg.data);
      } else if (msg.type === "activity" && msg.event) {
        handleActivityEvent(msg.event);
      }
    } catch (e) { console.warn("[arstudio] WebSocket message parse error:", e); }
  };

  socket.onclose = function () {
    socketOpen = false;
    setLiveStatus("reconnecting", "Reconnecting... polling fallback");
    startFallbackPolling();
    scheduleReconnect();
  };

  socket.onerror = function () {
    socket.close();
  };
}

// ── Activity Feed ──

let activityLog = [];
const MAX_ACTIVITY_ITEMS = 200;
let activityAutoScroll = true;
let agentRunning = false;
let lastAssistantMsgId = null;

function handleActivityEvent(ev) {
  const kind = ev.kind;
  const data = ev.data || {};
  const ts = ev.ts || Date.now();

  if (kind === "agent_start") {
    agentRunning = true;
    activityLog.push({ kind: kind, ts: ts, data: data });
    if (socketOpen) setLiveStatus("live"); // refresh header to show "running"
  } else if (kind === "agent_end") {
    agentRunning = false;
    activityLog.push({ kind: kind, ts: ts, data: data });
    lastAssistantMsgId = null;
    if (socketOpen) setLiveStatus("live"); // refresh header to show "idle"
  } else if (kind === "message") {
    // Streaming assistant messages: merge updates into one entry
    if (data.streaming && lastAssistantMsgId !== null) {
      const existing = activityLog[lastAssistantMsgId];
      if (existing && existing.kind === "message") {
        existing.data = data;
        existing.ts = ts;
        renderActivity();
        return;
      }
    }
    activityLog.push({ kind: kind, ts: ts, data: data });
    if (data.role === "assistant") {
      lastAssistantMsgId = activityLog.length - 1;
    }
  } else if (kind === "tool_start") {
    activityLog.push({ kind: kind, ts: ts, data: data });
    lastAssistantMsgId = null;
  } else if (kind === "tool_update") {
    // Merge tool updates into the most recent tool_start with same toolCallId
    let found = false;
    for (let i = activityLog.length - 1; i >= 0; i--) {
      if (activityLog[i].data && activityLog[i].data.toolCallId === data.toolCallId) {
        if (activityLog[i].kind === "tool_start" || activityLog[i].kind === "tool_update") {
          activityLog[i].kind = "tool_update";
          activityLog[i].data.text = data.text;
          activityLog[i].ts = ts;
          found = true;
          break;
        }
      }
    }
    if (!found) {
      activityLog.push({ kind: kind, ts: ts, data: data });
    }
  } else if (kind === "tool_end") {
    // Replace the tool_start/tool_update entry with the final result
    let replaced = false;
    for (let j = activityLog.length - 1; j >= 0; j--) {
      if (activityLog[j].data && activityLog[j].data.toolCallId === data.toolCallId) {
        activityLog[j].kind = "tool_end";
        activityLog[j].data.text = data.text;
        activityLog[j].data.isError = data.isError;
        activityLog[j].ts = ts;
        replaced = true;
        break;
      }
    }
    if (!replaced) {
      activityLog.push({ kind: kind, ts: ts, data: data });
    }
  } else {
    activityLog.push({ kind: kind, ts: ts, data: data });
  }

  // Trim old entries
  while (activityLog.length > MAX_ACTIVITY_ITEMS) {
    activityLog.shift();
    if (lastAssistantMsgId !== null) lastAssistantMsgId--;
  }

  renderActivity();
}

function escHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function fmtTime(ts) {
  const d = new Date(ts);
  return String(d.getHours()).padStart(2, "0") + ":" +
         String(d.getMinutes()).padStart(2, "0") + ":" +
         String(d.getSeconds()).padStart(2, "0");
}

function truncateText(text, maxLen) {
  if (!text) return "";
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + "…";
}

function renderActivityItem(item) {
  const kind = item.kind;
  const data = item.data || {};
  const time = '<span class="activity-time">' + fmtTime(item.ts) + "</span>";

  if (kind === "agent_start") {
    return '<div class="activity-item activity-agent-start">' + time +
      '<span class="activity-badge badge-agent">▶ Agent started</span></div>';
  }
  if (kind === "agent_end") {
    return '<div class="activity-item activity-agent-end">' + time +
      '<span class="activity-badge badge-agent">■ Agent stopped</span></div>';
  }
  if (kind === "message") {
    const role = data.role || "unknown";
    const text = escHtml(data.text || "");
    // Truncate very long messages for display, with expand toggle
    let displayText = text;
    const isLong = text.length > 800;
    if (isLong) {
      displayText = text.slice(0, 800) + '<span class="activity-more">… (truncated)</span>';
    }
    const streamClass = data.streaming ? " streaming" : "";
    return '<div class="activity-item activity-message' + streamClass + '">' + time +
      '<span class="activity-badge badge-' + escHtml(role) + '">' + escHtml(role) + "</span>" +
      '<div class="activity-text">' + displayText + "</div></div>";
  }
  if (kind === "tool_start") {
    const toolName = escHtml(data.toolName || "tool");
    let argsStr = "";
    if (data.args) {
      try {
        // Show compact args preview
        if (data.args.command) {
          argsStr = escHtml(truncateText(data.args.command, 120));
        } else if (data.args.path) {
          argsStr = escHtml(data.args.path);
        } else {
          argsStr = escHtml(truncateText(JSON.stringify(data.args), 120));
        }
      } catch (e) { argsStr = ""; }
    }
    return '<div class="activity-item activity-tool-start">' + time +
      '<span class="activity-badge badge-tool">⚙ ' + toolName + "</span>" +
      (argsStr ? '<code class="activity-args">' + argsStr + "</code>" : "") +
      '<span class="activity-spinner">⟳</span></div>';
  }
  if (kind === "tool_update") {
    const tName = escHtml(data.toolName || "tool");
    const output = escHtml(truncateText(data.text || "", 500));
    return '<div class="activity-item activity-tool-update">' + time +
      '<span class="activity-badge badge-tool">⚙ ' + tName + "</span>" +
      (output ? '<pre class="activity-output">' + output + "</pre>" : '<span class="activity-spinner">⟳</span>') +
      "</div>";
  }
  if (kind === "tool_end") {
    const tn = escHtml(data.toolName || "tool");
    const result = escHtml(truncateText(data.text || "", 500));
    const errClass = data.isError ? " tool-error" : " tool-success";
    const icon = data.isError ? "✗" : "✓";
    return '<div class="activity-item activity-tool-end' + errClass + '">' + time +
      '<span class="activity-badge badge-tool">' + icon + " " + tn + "</span>" +
      (result ? '<pre class="activity-output">' + result + "</pre>" : "") +
      "</div>";
  }
  // Fallback for unknown kinds
  return '<div class="activity-item">' + time +
    '<span class="activity-badge">' + escHtml(kind) + "</span>" +
    '<pre class="activity-output">' + escHtml(JSON.stringify(data, null, 2)) + "</pre></div>";
}

function renderActivity() {
  const el = document.getElementById("tab-activity");
  if (!el) return;

  const headerHtml = '<div class="activity-header">' +
    '<div class="activity-status">' +
    (agentRunning
      ? '<span class="activity-indicator running">● Agent running</span>'
      : '<span class="activity-indicator idle">○ Agent idle</span>') +
    '</div>' +
    '<button class="activity-clear-btn" onclick="clearActivity()">Clear</button>' +
    '</div>';

  if (activityLog.length === 0) {
    el.innerHTML = headerHtml +
      '<div class="activity-empty">' +
      "<p>No agent activity yet.</p>" +
      "<p>Start an autoresearch session and agent output will stream here in real time.</p>" +
      "</div>";
    return;
  }

  const items = activityLog.map(renderActivityItem).join("");
  el.innerHTML = headerHtml + '<div class="activity-feed" id="activity-feed">' + items + "</div>";

  // Auto-scroll to bottom
  if (activityAutoScroll) {
    const feed = document.getElementById("activity-feed");
    if (feed) feed.scrollTop = feed.scrollHeight;
  }
}

function clearActivity() {
  activityLog = [];
  lastAssistantMsgId = null;
  renderActivity();
}

// ── Init ──

initTabKeyboardNav();
initThemeToggle();
seedRunHeuristicFromData(D);
startLiveTicker();
showTab("dashboard");
renderPlan();
renderIdeas();
renderActivity();
connectWebSocket();
