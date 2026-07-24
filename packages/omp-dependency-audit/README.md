# @testzugang/omp-dependency-audit

Static dependency and supply-chain malware auditing skill for OMP. Global OMP plugin audits write JSON plus Markdown reports, and default config treats `@oh-my-pi/*` as a trusted peer dependency scope only.

## Install

```bash
omp plugin install @testzugang/omp-dependency-audit
```

## Usage

```text
/skill:dependency-audit
```

## Reports and configuration

- End-to-end audits write `/tmp/omp_audit_aggregated.json` and `/tmp/omp_audit_report.md` by default.
- Markdown reports include held-back/rejected update details for blocked, quarantined, errored, or too-fresh updates.
- Config lives in [`skills/dependency-audit/config.json`](skills/dependency-audit/config.json) or `~/.omp/dependency-audit.json`.
- Trusted peer dependency allowlists apply only to `peerDependencies`; normal dependency fields stay strict.

## Interactive Terminal Integration (Wrapper)

See [SKILL.md](skills/dependency-audit/SKILL.md) for full instructions on setting up automated shell interception for security checks on `omp plugin upgrade`.
