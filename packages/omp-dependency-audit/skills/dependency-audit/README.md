# npm/TypeScript Package Audit Skill

Static-first Skill for reviewing TypeScript dependencies, npm packages and npm-based repositories before install or use.

## What it does

- Scans `package.json`, npm/pnpm/yarn lockfiles, `.npmrc`, TypeScript config, GitHub Actions and TS/JS source files.
- Detects risky npm lifecycle scripts, Git/URL/File dependencies, optional dependency traps, bundled dependencies, non-default tarball sources and missing integrity.
- Scans npm `.tgz` tarballs without executing package code.
- Flags malware patterns such as download+execute, credential access+network, obfuscation, cloud metadata probes, GitHub API write behavior and IDE/AI-agent persistence.
- Produces Markdown, JSON and SARIF output.
- Allows narrow trusted peer dependency rules. Default config treats `@oh-my-pi/*` peer dependency ranges as INFO-only, while normal dependencies and optional dependencies remain strict.
- Global OMP plugin audits automatically write a Markdown report with held-back/rejected update details.

## Quick start

```bash
python3 scripts/npm_ts_static_triage.py /path/to/repo-or-package.tgz \
  --mode package \
  --markdown npm-ts-audit.md \
  --json npm-ts-audit.json \
  --sarif npm-ts-audit.sarif \
  --strict-exit
```

For global OMP plugin checks without on-the-fly shell loops:

```bash
bash scripts/omp-check-current-global-versions.sh
bash scripts/omp-check-latest-npm-versions.sh
bash scripts/omp-check-git-source-updates.sh
# or everything in one run
bash scripts/omp-check-all-updates.sh

# full static update audit; writes JSON and Markdown summary
python3 scripts/run_omp_dependency_audit.py \
  --output /tmp/omp_audit_aggregated.json \
  --markdown-output /tmp/omp_audit_report.md
```

Age-gate configuration (default: 24h):

- repo default: `skills/dependency-audit/config.json`
- user override: `~/.omp/dependency-audit.json`
- highest priority override: `--config /path/to/config.json`

Example config:

```json
{
  "min_update_age_hours": 24,
  "trusted_peer_dependency_scopes": ["@oh-my-pi"],
  "trusted_peer_dependency_packages": []
}
```

Trusted peer dependency rules apply only to `peerDependencies`; `dependencies`, `devDependencies`, `optionalDependencies`, `overrides` and `resolutions` stay strict.

`--strict-exit` exits with code `2` for HIGH/CRITICAL findings and `1` for MEDIUM-only findings.

## Safe package acquisition

```bash
npm view <package>@<version> name version dist.tarball dist.integrity dist.shasum time maintainers repository license --json
curl -fL -o package-under-review.tgz '<dist.tarball-url>'
sha256sum package-under-review.tgz
python3 scripts/npm_ts_static_triage.py package-under-review.tgz --markdown report.md --json report.json --strict-exit
```

Do not run `npm install`, `npm ci`, `npm pack`, `npm test`, `npm run build`, `npx`, `node`, `tsx` or `ts-node` against untrusted code before static review.

## Files

- `SKILL.md`: full German skill instructions and policy.
- `scripts/npm_ts_static_triage.py`: standalone stdlib-only scanner.
- `scripts/omp-check-current-global-versions.sh`: reads installed versions for default/global OMP plugin packages.
- `scripts/omp-check-latest-npm-versions.sh`: reads latest npm registry versions for default/global OMP plugin packages.
- `scripts/omp-check-git-source-updates.sh`: compares local git checkouts with origin branch heads.
- `scripts/omp-check-all-updates.sh`: runs all three checks in sequence.
- `scripts/omp-default-packages.txt`: default package target list for the helper scripts.
- `scripts/omp-default-git-repos.txt`: default git repo target list for update checks.
- `scripts/run_omp_dependency_audit.py`: end-to-end static audit workflow for global OMP plugin updates; writes JSON and Markdown reports.
- `scripts/summarize_omp_dependency_audit.py`: creates a markdown summary from aggregated JSON results, including held-back/rejected update details.
- `scripts/omp-interactive-update.py`: interactive CLI wrapper and menu selector for native `omp plugin upgrade` integration.
- `config.json`: default config (`min_update_age_hours`, trusted peer dependency scopes/packages).
- `rules/iocs.txt`: editable IOC seed list.
- `templates/report.md`: manual review template.
- `examples/sample-commands.md`: safe commands and review playbooks.
- `examples/github-actions-static-audit.yml`: example CI workflow for static-only scanning.

## Interactive Shell Wrapper (`omp plugin upgrade` integration)

To intercept the native `omp plugin upgrade` command in your terminal so it automatically runs this security audit first and prompts you with a selection menu of verified-safe updates, add the following wrapper function to your shell configuration (e.g., `~/.zshrc` or `~/.bashrc`):

```bash
# Wrapper for OMP plugin upgrades to prepend dependency-audit and trigger interactive CLI selection
omp() {
    if [[ "$1" == "plugin" && "$2" == "upgrade" && -z "$3" ]]; then
        python3 ~/.omp/agent/git/github.com/testzugang/omp-plugins/packages/omp-dependency-audit/skills/dependency-audit/scripts/omp-interactive-update.py
    else
        command omp "$@"
    fi
}
```

After reloading your shell (`source ~/.zshrc`), typing `omp plugin upgrade` launches the interactive audit menu before running any updates.

## Important limitation

A clean static report is not proof of safety. Use it as a pre-installation gate and combine it with registry metadata review, version cooldown, script suppression, provenance/signature checks, sandboxing and human review.
