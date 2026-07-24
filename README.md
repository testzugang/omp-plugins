# OMP Plugins

A collection of OMP-native shared skills and independently installable plugins.

## Local development: root resources

From this repository's root, link the private workspace package for local development:

```bash
omp plugin link .
```

The linked root package provides the shared [`skills/`](skills/) directory and the [`session-branding`](extensions/session-branding) extension. OMP discovers a linked or installed package's conventional `skills/` directory. The root package does not use an `omp.skills` entry, and it does not discover skills nested in [`packages/`](packages/); install a public package below to load that package's skills.

### Shared root skills

- [`grill-with-docs`](skills/grill-with-docs) — pressure-test a plan against existing context and architectural decisions.
- [`improve-codebase-architecture`](skills/improve-codebase-architecture) — identify architectural friction and design-deepening opportunities.
- [`handoff`](skills/handoff) — produce a compact in-session handoff at `local://handoff-<slug>.md`; create a persistent project artifact only when explicitly requested.

### Session branding

`/session-branding` opens its interactive configuration menu. Its direct subcommands are:

```text
/session-branding name <name>
/session-branding color <red|orange|yellow|green|blue|purple|black|white>
/session-branding sound <command|clear|default>
```

The session name uses OMP session-name persistence. Repository color and optional blocked-state sound configuration are stored in `.omp/branding.json`. The extension updates the terminal title and widget with the current status, prioritizing blocked interaction over tool execution, agent activity, and idle state.

## Public packages

Install each public package independently. The package-local skill, where present, is discovered from that installed package's conventional `skills/` directory.

| Package | Install | Capability after installation |
| --- | --- | --- |
| [`@testzugang/omp-handoff-session`](packages/omp-handoff-session) | `omp plugin install @testzugang/omp-handoff-session` | Provides `/handoff-session [goal]`, an interactive-TUI handoff transition that requires a selected, authenticated model. The optional saved record is contained under `docs/omp/handoffs/`; model settings read `getAgentDir()/settings.json` and `.omp/settings.json`. |
| [`@testzugang/omp-migrate-to-agents-md`](packages/omp-migrate-to-agents-md) | `omp plugin install @testzugang/omp-migrate-to-agents-md` | Provides the package-local `/skill:migrate-to-agents-md` skill for moving agent-specific guidance from `CLAUDE.md` to `AGENTS.md` while preserving project documentation. |
| [`@testzugang/omp-audit-agents-md`](packages/omp-audit-agents-md) | `omp plugin install @testzugang/omp-audit-agents-md` | Provides the package-local `/skill:audit-agents-md` skill for auditing `AGENTS.md` clarity, contradictions, stale harness guidance, and automation safety. |
| [`@testzugang/omp-commit`](packages/omp-commit) | `omp plugin install @testzugang/omp-commit` | Provides the package-local `/skill:commit` skill for reviewed, confirmed gitmoji commits. |
| [`@testzugang/omp-pr-findings`](packages/omp-pr-findings) | `omp plugin install @testzugang/omp-pr-findings` | Provides the package-local `/skill:pr-findings` guidance and the `pr_findings` tool. |
| [`@testzugang/omp-dependency-audit`](packages/omp-dependency-audit) | `omp plugin install @testzugang/omp-dependency-audit` | Provides the package-local `/skill:dependency-audit` skill for static-first dependency and supply-chain auditing. |

### PR findings tool

Authenticate the GitHub CLI before calling the tool:

```bash
gh auth login
```

`pr_findings` fetches GitHub pull-request review findings through `gh` and groups them by severity. It accepts this contract:

```text
pr_findings({
  prNumber?: number,
  repo?: "owner/repo",
  unresolved?: boolean,
  severity?: "blocker" | "warning" | "nit" | "all",
  includeStale?: boolean,
  mine?: boolean,
  waitForNextReview?: boolean,
  waitMode?: "new-review-activity" | "checks-finished",
  waitTimeoutSec?: number,
  waitPollSec?: number
})
```

If `prNumber` is omitted, the tool resolves the pull request for the current branch. `waitForNextReview: true` waits for `new-review-activity` by default; `checks-finished` is available as an alternative. The default waiting timeout is 60 seconds and the default polling interval is 30 seconds.

## Deliberately omitted features

Browser tools, a HUD, and approval recording are intentionally not distributed. OMP already provides native browser, TUI, and approval behavior, so separate implementations would duplicate or conflict with host capabilities.

## Repository layout

```text
omp-plugins/
  extensions/                       # Root session-branding extension
  skills/                           # Root shared skills
  packages/
    omp-handoff-session/            # Independently installable extension
    omp-migrate-to-agents-md/       # Independently installable skill
    omp-audit-agents-md/            # Independently installable skill
    omp-commit/                     # Independently installable skill
    omp-pr-findings/                # Independently installable extension and skill
    omp-dependency-audit/           # Independently installable skill
```
