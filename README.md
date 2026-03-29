<div align="center">
<img height="350" alt="pi-autoresearch-studio-logo" src="https://github.com/user-attachments/assets/2714516c-f586-46f7-9cff-80ce0468bcc8" />

# pi-autoresearch-studio
### The control plane for pi-autoresearch — a [pi](https://pi.dev/) implementation of Andrej Karpathy's [autoresearch](https://github.com/karpathy/autoresearch).

**[Features](#features)** · **[Install](#install)** · **[Usage](#usage)** · **[PR Workflow](#pr-workflow)** · **[Development](#development)**
</div>

---

## What is autoresearch?

Give an AI agent an optimization target, let it experiment autonomously: edit code → run benchmark → measure → keep improvements, discard regressions → repeat. You come back to a log of experiments and (hopefully) a better result. Works for anything with a measurable metric: test speed, bundle size, LLM training loss, build times, etc.

**[pi-autoresearch](https://github.com/davebcn87/pi-autoresearch)** provides the loop engine — `run_experiment`, `log_experiment`, confidence scoring, git commit/revert, and a built-in status widget (`Ctrl+X` / `Ctrl+Shift+X`).

**pi-autoresearch-studio** adds the control plane on top. Autoresearch-studio reads the same `autoresearch.jsonl` and `autoresearch.md` files — it complements the built-in UI, it doesn't replace it.

<img width="1728" height="712" alt="Image" src="https://github.com/user-attachments/assets/844fcbbe-7853-498c-92c7-f07a62d3ba72" />

<div align="center">
  
**[🎬 TUI Dashboard](##tui-dashboard)** · **[🎬 Web Dashboard](##web-dashboard)**

</div>

---

## Features

### Rich Visual Dashboard

Real-time experiment monitoring, available as a TUI (in-terminal) and a web UI (experimental, opens in browser via `/arstudio web`).

- **Primary metric chart** — color-coded by status (keep / discard / crash) with trend visualization
- **Secondary metrics** — horizontal bar comparisons vs baseline with delta percentages
- **Experiment log** — scrollable table with run number, status, metric, Δ%, confidence score, commit hash, and full description
- **Tab navigation** — switch between Dashboard, Plan, and Ideas views

The web UI (experimental) adds interactive chart tooltips, in-browser markdown editing, and live updates that auto-refresh when experiment files change.

### Granular PR Creation

Ship experiment results as reviewable PRs — select exactly the experiments you want.

- **Selective promotion** — pick non-sequential experiments, skip the rest
- **Dependency resolution** — automatically detects and includes required intermediate commits
- **Dry run** — test the full pipeline without pushing anything
- **Three PR modes** — consolidated, stacked, or individual
- **Autoresearch metadata stripped** — PRs contain only code changes
- **Selection UI** — toggle individual experiments with `space`, select all kept with `a`, clear with `n`
- Discarded/crashed experiments are visually marked as non-selectable

### Explain This Experiment

Understand what each experiment tried and why it worked (or didn't).

- LLM-powered explanations via OpenAI API (if `OPENAI_API_KEY` is set)
- Heuristic fallback when no API key is available
- Cached locally — repeated lookups are instant

### Plan & Ideas Editor

Steer the agent between experiments.

- Syntax-highlighted view of `autoresearch.md` and `autoresearch.ideas.md`
- In-place editing via pi's editor (TUI) or the browser (web UI)

---

## Install

```bash
pi install https://github.com/jhochenbaum/pi-autoresearch-studio
```

<details>
<summary>Manual install</summary>

```bash
git clone https://github.com/jhochenbaum/pi-autoresearch-studio ~/.pi/agent/extensions/pi-autoresearch-studio
```

Then `/reload` in pi.

</details>

### Prerequisites

- [pi](https://pi.dev/) — the coding agent
- [pi-autoresearch](https://github.com/davebcn87/pi-autoresearch) — the experiment loop engine
- [gh CLI](https://cli.github.com/) — optional, enables automatic draft PR creation. Without it, PRs are opened via browser URL with pre-filled title and description
- `OPENAI_API_KEY` — optional, enables LLM-powered experiment explanations. When set, experiment metadata (config name, metric values, descriptions) is sent to the OpenAI API. Supports `OPENAI_BASE_URL` for compatible APIs

---

## Usage

All commands are under `/arstudio`:

| Command | Description |
|---|---|
| `/arstudio` | Open TUI dashboard |
| `/arstudio web` | Open HTML dashboard in browser |
| `/arstudio web stop` | Stop the web server |
| `/arstudio plan` | View `autoresearch.md` |
| `/arstudio plan edit` | Edit `autoresearch.md` |
| `/arstudio ideas` | View `autoresearch.ideas.md` |
| `/arstudio ideas edit` | Edit `autoresearch.ideas.md` |
| `/arstudio pr <hashes...>` | Create PR(s) from commits |
| `/arstudio new [goal]` | Start a new autoresearch session |

### Keyboard Shortcuts

<details>
<summary>Dashboard</summary>

| Key | Action |
|---|---|
| `j` / `k` | Navigate experiment log |
| `g` / `G` | Jump to top / bottom |
| `space` | Toggle commit for PR (kept only) |
| `a` | Select all kept |
| `n` | Clear selection |
| `d` | Dry run |
| `x` | Explain experiment |
| `enter` | Create PR |

</details>

<details>
<summary>Plan / Ideas</summary>

| Key | Action |
|---|---|
| `j` / `k` | Scroll |
| `g` / `G` | Jump to top / bottom |
| `e` | Edit file |
| `esc` | Back to Dashboard |

</details>

<details>
<summary>Global</summary>

| Key | Action |
|---|---|
| `1` / `2` / `3` | Switch to Dashboard / Plan / Ideas |
| `tab` / `shift+tab` | Cycle views |
| `w` | Open HTML dashboard |
| `esc` | Back (from Plan/Ideas) or quit (from Dashboard) |
| `q` | Quit |

</details>

---

## PR Workflow

### Basic Flow

1. Select experiments in the dashboard (`space` to toggle, `a` for all kept)
2. Press `d` to dry run — verify which commits will be included
3. Press `enter` to create the PR
4. Choose a mode: **consolidated** (1 PR), **stacked** (chained PRs), or **individual** (separate PRs)

<details>
<summary>Dependency Resolution</summary>

When you select non-sequential experiments, the system figures out what's needed:

```
Experiment log:    #5   #6   #7   #8   #9   #10   #11   #12   #13   #14   #15
You select:                   ✓                ✓                       ✓    ✓

Dependency check:  7 is independent ✓
                   10 is independent ✓
                   14 needs 13 → auto-include
                   15 is independent ✓

Consolidated (1 PR):
  PR #1:  #7 → #10 → #13* → #14 → #15

Stacked (chained PRs, each targets the previous):
  PR #1:  #7
  PR #2:  #10         ← targets PR #1
  PR #3:  #13* → #14  ← targets PR #2
  PR #4:  #15         ← targets PR #3

Individual (separate PRs):
  PR #1:  #7
  PR #2:  #10
  PR #3:  #13* → #14
  PR #4:  #15

* = auto-included dependency
```

1. **File-overlap pre-filter** — fast check comparing changed files, excluding autoresearch metadata
2. **Cherry-pick verification** — tries minimal subsets to find the smallest dependency set
3. **Notification** — any auto-included commits are reported before proceeding

If experiment 14 depends on changes from experiment 13, only 13 is auto-included — not 11, 12, or anything else in the gap.

</details>

<details>
<summary>Autoresearch Metadata</summary>

Autoresearch files (`autoresearch.jsonl`, `.md`, `.ideas.md`, `.sh`, `.checks.sh`) are handled automatically:

- Excluded from dependency detection
- Auto-resolved during cherry-pick conflicts
- Stripped from PR branches before pushing

</details>

<details>
<summary>Relationship to autoresearch-finalize</summary>

pi-autoresearch includes a built-in [autoresearch-finalize](https://github.com/davebcn87/pi-autoresearch) skill that takes a different approach. The two complement each other:

| | Studio | autoresearch-finalize |
|---|---|---|
| **When** | Anytime | Post-session |
| **Selection** | Interactive — toggle individual experiments | All kept — agent groups into changesets |
| **Strategy** | Cherry-pick with dependency resolution | File-checkout per group (squashed) |
| **Granularity** | Preserves individual commits | One commit per group |
| **Skipping** | ✓ auto-includes only what's needed | Groups by file overlap |
| **Branch target** | Current branch | merge-base (independent) |

**Studio** gives you fine-grained control — browse the experiment log, select exactly what you want (even non-sequential), and the tool figures out dependencies. Ship a subset of results, leave some out, or promote changes incrementally.

**Finalize** takes a hands-off approach — the agent groups all kept experiments by file overlap into logical changesets and creates independent branches.

Both strip autoresearch metadata and work with the same `autoresearch.jsonl` data.

</details>

---

## How It Works

```
┌─────────────────────────────────────────────────────┐
│  You                                                │
│  • Set the goal: "optimize test runtime"            │
│  • Review experiments in /arstudio                  │
│  • Edit the plan to steer the agent                 │
│  • Ship results as PRs                              │
└───────────────┬─────────────────────────────────────┘
                │
┌───────────────▼─────────────────────────────────────┐
│  pi-autoresearch-studio  (/arstudio)                │
│  • TUI + HTML dashboards                            │
│  • Plan/ideas viewer & editor                       │
│  • PR workflow (cherry-pick → draft PR)             │
│  • Explain experiment (LLM + heuristic)             │
└───────────────┬─────────────────────────────────────┘
                │ reads autoresearch.jsonl + .md
┌───────────────▼─────────────────────────────────────┐
│  pi-autoresearch  (engine)                          │
│  • run_experiment / log_experiment tools             │
│  • Confidence scoring & noise floor                 │
│  • Git commit on keep, revert on discard            │
└───────────────┬─────────────────────────────────────┘
                │ autonomous loop
┌───────────────▼─────────────────────────────────────┐
│  pi agent                                           │
│  • Edits code, runs benchmarks                      │
│  • Keeps improvements, discards regressions         │
└─────────────────────────────────────────────────────┘
```

---

<details>
<summary>TUI Layout Overrides</summary>

If your terminal clips the top toolbar area, tune the reserved rows:

```bash
ARSTUDIO_TUI_ROW_RESERVE=5 ARSTUDIO_TUI_TOP_GAP=1 pi
```

- `ARSTUDIO_TUI_ROW_RESERVE` — rows reserved for pi chrome (default: `5`)
- `ARSTUDIO_TUI_TOP_GAP` — spacer between chrome and studio nav (default: `1`)

</details>

<details>
<summary>Limitations</summary>

- **File-based communication** — studio watches `autoresearch.jsonl` via `fs.watch` and re-parses on every change. If pi-autoresearch emitted structured events via pi's event bus, updates would be faster and more precise.
- **Single-segment dashboard** — only the latest experiment segment is shown; historical segments are not browsable.

</details>

---

## Development

```bash
npm test                  # Unit tests (~1.5s)
npm run test:integration  # Git integration tests (~37s)
npm run test:all          # All tests
npm run check             # TypeScript strict mode
npm run lint              # ESLint
npm run format            # Prettier
npm run ci                # All of the above
```

## TUI Dashboard
https://github.com/user-attachments/assets/54981011-d39b-4d61-a319-58b21c69bbcf

## Web Dashboard
https://github.com/user-attachments/assets/d513c70b-61b7-4283-8889-48b0b5b8f0ef

## License

MIT
