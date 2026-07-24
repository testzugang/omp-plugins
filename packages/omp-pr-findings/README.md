# @testzugang/omp-pr-findings

Fetch and group GitHub PR review findings by severity in OMP.

## Install

```bash
omp plugin install @testzugang/omp-pr-findings
```

For local development, link the package directory:

```bash
omp plugin link /absolute/path/to/omp-pr-findings
```

## Prerequisite

Authenticate the GitHub CLI before using the tool:

```bash
gh auth login
```

## Usage

Invoke the package skill when you need help choosing tool arguments:

```text
/skill:pr-findings
```

Call the registered OMP tool directly to fetch findings:

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

Use `waitForNextReview: true` after pushing fixes to wait for either fresh review activity (the default) or checks to finish before collecting the current findings.
