#!/usr/bin/env python3
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import shutil
import subprocess
import sys
import tempfile
import urllib.request
from pathlib import Path
from typing import Any

SECURITY_ENV_VARS = [
    "GITHUB_TOKEN",
    "GH_TOKEN",
    "NPM_TOKEN",
    "NODE_AUTH_TOKEN",
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
    "AWS_SESSION_TOKEN",
    "VAULT_TOKEN",
]

SCRIPT_DIR = Path(__file__).resolve().parent
SKILL_DIR = SCRIPT_DIR.parent
TRIAGE_SCRIPT = SCRIPT_DIR / "npm_ts_static_triage.py"
SUMMARIZE_SCRIPT = SCRIPT_DIR / "summarize_omp_dependency_audit.py"
REPO_CONFIG_PATH = SKILL_DIR / "config.json"
HOME_CONFIG_PATH = Path.home() / ".omp" / "dependency-audit.json"
DEFAULT_CONFIG = {
    "min_update_age_hours": 24,
}


def run(cmd: list[str], cwd: Path | None = None, check: bool = True) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        cmd,
        cwd=str(cwd) if cwd else None,
        text=True,
        capture_output=True,
        check=check,
    )


def unset_security_env() -> None:
    for env_var in SECURITY_ENV_VARS:
        os.environ.pop(env_var, None)


def utcnow() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def parse_iso_datetime(value: str | None) -> dt.datetime | None:
    if not value:
        return None
    text = value.strip()
    if not text:
        return None
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        parsed = dt.datetime.fromisoformat(text)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=dt.timezone.utc)
    return parsed.astimezone(dt.timezone.utc)


def age_hours(since: dt.datetime | None) -> float | None:
    if since is None:
        return None
    delta = utcnow() - since
    return max(0.0, delta.total_seconds() / 3600.0)


def read_non_comment_lines(path: Path) -> list[str]:
    if not path.exists():
        return []
    out: list[str] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        value = line.strip()
        if not value or value.startswith("#"):
            continue
        out.append(value)
    return out


def read_json_file(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"Invalid JSON config at {path}: {exc}") from exc
    if not isinstance(data, dict):
        raise RuntimeError(f"Config at {path} must be a JSON object")
    return data


def normalize_config(raw: dict[str, Any]) -> dict[str, Any]:
    cfg = dict(DEFAULT_CONFIG)
    cfg.update(raw)

    value = cfg.get("min_update_age_hours", DEFAULT_CONFIG["min_update_age_hours"])
    try:
        number = float(value)
    except (TypeError, ValueError):
        number = float(DEFAULT_CONFIG["min_update_age_hours"])
    cfg["min_update_age_hours"] = max(0.0, number)
    return cfg


def load_config(config_override: str) -> tuple[dict[str, Any], list[str]]:
    merged: dict[str, Any] = {}
    sources: list[str] = []

    for path in [REPO_CONFIG_PATH, HOME_CONFIG_PATH]:
        if path.exists():
            merged.update(read_json_file(path))
            sources.append(str(path))

    if config_override:
        override_path = Path(config_override)
        merged.update(read_json_file(override_path))
        sources.append(str(override_path))

    return normalize_config(merged), sources


def _plugin_list_entry(entry: Any, plugin_type: str) -> dict[str, str] | None:
    if isinstance(entry, str):
        name = entry.strip()
        data: dict[str, Any] = {}
    elif isinstance(entry, dict):
        data = entry
        name = str(data.get("name") or data.get("package") or "").strip()
    else:
        return None
    if not name:
        return None

    path = str(data.get("path") or data.get("installPath") or "").strip()
    if plugin_type == "npm":
        target = name
    else:
        marketplace = str(data.get("marketplace") or data.get("registry") or "").strip()
        target = f"{name}@{marketplace}" if marketplace else name
    return {"name": name, "type": plugin_type, "path": path, "upgrade_target": target}


def discover_omp_plugins() -> list[dict[str, str]]:
    result = run(["omp", "plugin", "list", "--json"], check=False)
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or "omp plugin list --json failed")
    try:
        data = json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        raise RuntimeError("omp plugin list --json returned invalid JSON") from exc
    if not isinstance(data, dict):
        raise RuntimeError("omp plugin list --json must return an object")

    discovered: list[dict[str, str]] = []
    for plugin_type in ("npm", "marketplace"):
        entries = data.get(plugin_type, [])
        if not isinstance(entries, list):
            raise RuntimeError(f"omp plugin list --json field {plugin_type!r} must be an array")
        for entry in entries:
            normalized = _plugin_list_entry(entry, plugin_type)
            if normalized is not None:
                discovered.append(normalized)
    return discovered


def upgrade_command(plugin: dict[str, Any]) -> list[str]:
    target = str(plugin.get("upgrade_target") or plugin.get("name") or "").strip()
    if not target:
        raise ValueError("Missing OMP plugin upgrade target")
    return ["omp", "plugin", "upgrade", target]


def current_installed_version(plugin_path: Path) -> str | None:
    package_json = plugin_path / "package.json"
    if not package_json.exists():
        return None
    try:
        data = json.loads(package_json.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    version = data.get("version") if isinstance(data, dict) else None
    return str(version).strip() if version else None


def npm_latest_version(package: str) -> str | None:
    result = run(["npm", "view", package, "version"], check=False)
    version = (result.stdout or "").strip()
    return version or None


def npm_version_published_at(package: str, version: str) -> dt.datetime | None:
    result = run(["npm", "view", package, "time", "--json"], check=False)
    if result.returncode != 0:
        return None
    try:
        data = json.loads((result.stdout or "").strip())
    except json.JSONDecodeError:
        return None
    if not isinstance(data, dict):
        return None
    raw = data.get(version)
    return parse_iso_datetime(raw if isinstance(raw, str) else None)


def npm_tarball_url(package: str, version: str) -> str:
    result = run(["npm", "view", f"{package}@{version}", "dist.tarball"])
    url = result.stdout.strip()
    if not url:
        raise RuntimeError(f"No dist.tarball returned for {package}@{version}")
    return url


def scan_with_triage(target: Path, mode: str, report_json: Path, config_path: str = "") -> dict[str, Any]:
    cmd = [
        "python3",
        str(TRIAGE_SCRIPT),
        str(target),
        "--mode",
        mode,
        "--json",
        str(report_json),
    ]
    if config_path:
        cmd.extend(["--config", config_path])
    run(cmd)
    return json.loads(report_json.read_text(encoding="utf-8"))


def _canonical_finding_path(finding: dict[str, Any]) -> str:
    path = str(finding.get("path", "")).replace("\\", "/").lstrip("./")
    return path.removeprefix("package/")


def _finding_identity(finding: dict[str, Any]) -> tuple[str, str, str]:
    return (
        str(finding.get("category", "")),
        _canonical_finding_path(finding),
        str(finding.get("title", "")),
    )


def _finding_signature(finding: dict[str, Any]) -> str:
    return json.dumps(
        {
            "identity": _finding_identity(finding),
            "severity": str(finding.get("severity", "")),
            "evidence": str(finding.get("evidence", "")),
            "recommendation": str(finding.get("recommendation", "")),
            "confidence": str(finding.get("confidence", "")),
            "tags": sorted(str(tag) for tag in finding.get("tags", []) if isinstance(tag, str)),
        },
        sort_keys=True,
        separators=(",", ":"),
    )


def _finding_diff_view(finding: dict[str, Any] | None) -> dict[str, Any] | None:
    if finding is None:
        return None
    return {
        "severity": finding.get("severity"),
        "category": finding.get("category"),
        "path": _canonical_finding_path(finding),
        "title": finding.get("title"),
        "evidence": finding.get("evidence"),
        "recommendation": finding.get("recommendation"),
    }


def classify_update_findings(
    installed_findings: list[dict[str, Any]], candidate_findings: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    """Label candidate findings against the currently installed artifact."""
    installed_by_signature: dict[str, dict[str, Any]] = {}
    installed_by_identity: dict[tuple[str, str, str], list[dict[str, Any]]] = {}
    for finding in installed_findings:
        installed_by_signature.setdefault(_finding_signature(finding), finding)
        installed_by_identity.setdefault(_finding_identity(finding), []).append(finding)
    for findings in installed_by_identity.values():
        findings.sort(key=_finding_signature)

    classified: list[dict[str, Any]] = []
    for finding in candidate_findings:
        classified_finding = dict(finding)
        baseline = installed_by_signature.get(_finding_signature(finding))
        if baseline is not None:
            classification = "inherited"
        else:
            matching = installed_by_identity.get(_finding_identity(finding), [])
            baseline = matching[0] if matching else None
            classification = "changed_existing" if baseline is not None else "new_in_update"
        classified_finding["classification"] = classification
        if str(finding.get("severity", "")).upper() in {"HIGH", "CRITICAL"}:
            classified_finding["diff_evidence"] = {
                "baseline": _finding_diff_view(baseline),
                "candidate": _finding_diff_view(finding),
            }
        classified.append(classified_finding)
    return classified


def decision_for_update_findings(findings: list[dict[str, Any]]) -> str:
    introduced_severities = {
        str(finding.get("severity", "")).upper()
        for finding in findings
        if finding.get("classification") != "inherited"
    }
    if "CRITICAL" in introduced_severities:
        return "QUARANTINE"
    if "HIGH" in introduced_severities:
        return "BLOCK_UNTIL_REVIEW"
    if "MEDIUM" in introduced_severities:
        return "REVIEW_BEFORE_USE"
    return "PASS_WITH_CAUTION"

def audit_npm_packages(
    workspace: Path, packages: list[dict[str, str]], min_age_hours: float, config_path: str = ""
) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []

    print(f"[npm] Checking {len(packages)} package(s)…")
    for idx, plugin in enumerate(packages, start=1):
        package = plugin["name"]
        plugin_path = Path(plugin["path"]).expanduser() if plugin.get("path") else Path()
        print(f"[npm {idx}/{len(packages)}] {package}")
        current = current_installed_version(plugin_path)
        latest = npm_latest_version(package)

        if current is None:
            print("  - not installed")
            results.append(
                {
                    "name": package,
                    "type": str(plugin.get("type") or "npm"),
                    "upgrade_target": str(plugin.get("upgrade_target") or package).strip() or package,
                    "status": "not_installed",
                    "current": None,
                    "latest": latest,
                    "decision": "SKIP_NOT_INSTALLED",
                    "counts": {},
                    "findings": [],
                }
            )
            continue

        if latest is None:
            print(f"  - registry lookup failed (current={current})")
            results.append(
                {
                    "name": package,
                    "type": str(plugin.get("type") or "npm"),
                    "upgrade_target": str(plugin.get("upgrade_target") or package).strip() or package,
                    "status": "registry_lookup_failed",
                    "current": current,
                    "latest": None,
                    "decision": "ERROR",
                    "counts": {},
                    "findings": [],
                }
            )
            continue

        if current == latest:
            print(f"  - up to date ({current})")
            results.append(
                {
                    "name": package,
                    "type": str(plugin.get("type") or "npm"),
                    "upgrade_target": str(plugin.get("upgrade_target") or package).strip() or package,
                    "status": "up_to_date",
                    "current": current,
                    "latest": latest,
                    "decision": "PASS_UP_TO_DATE",
                    "counts": {"CRITICAL": 0, "HIGH": 0, "MEDIUM": 0, "LOW": 0, "INFO": 0},
                    "findings": [],
                }
            )
            continue

        published_at = npm_version_published_at(package, latest)
        update_age = age_hours(published_at)
        if update_age is not None and update_age < min_age_hours:
            print(f"  - too fresh: {current} -> {latest} ({update_age:.1f}h < {min_age_hours:.1f}h)")
            results.append(
                {
                    "name": package,
                    "type": str(plugin.get("type") or "npm"),
                    "upgrade_target": str(plugin.get("upgrade_target") or package).strip() or package,
                    "status": "too_fresh",
                    "current": current,
                    "latest": latest,
                    "published_at": published_at.isoformat() if published_at else None,
                    "update_age_hours": round(update_age, 3) if update_age is not None else None,
                    "min_update_age_hours": min_age_hours,
                    "decision": "SKIP_TOO_FRESH",
                    "counts": {},
                    "findings": [],
                }
            )
            continue

        try:
            print(f"  - update found: {current} -> {latest}")
            tarball_url = npm_tarball_url(package, latest)
            tarball_path = workspace / f"{package.replace('/', '_')}@{latest}.tgz"
            urllib.request.urlretrieve(tarball_url, tarball_path)

            installed_report_json = workspace / f"{package.replace('/', '_')}_{current}_installed_report.json"
            installed_report_data = scan_with_triage(
                plugin_path, "package", installed_report_json, config_path
            )
            report_json = workspace / f"{package.replace('/', '_')}_{latest}_candidate_report.json"
            report_data = scan_with_triage(tarball_path, "package", report_json, config_path)
            findings = classify_update_findings(
                installed_report_data.get("findings", []), report_data.get("findings", [])
            )
            decision = decision_for_update_findings(findings)
            classification_counts = {
                label: sum(1 for finding in findings if finding.get("classification") == label)
                for label in ("new_in_update", "changed_existing", "inherited")
            }
            print(f"  - update-aware triage decision: {decision}")

            results.append(
                {
                    "name": package,
                    "type": str(plugin.get("type") or "npm"),
                    "upgrade_target": str(plugin.get("upgrade_target") or package).strip() or package,
                    "status": "update_available",
                    "current": current,
                    "latest": latest,
                    "published_at": published_at.isoformat() if published_at else None,
                    "update_age_hours": round(update_age, 3) if update_age is not None else None,
                    "min_update_age_hours": min_age_hours,
                    "decision": decision,
                    "candidate_decision": report_data.get("decision", "UNKNOWN"),
                    "counts": report_data.get("counts_by_severity", {}),
                    "installed_counts": installed_report_data.get("counts_by_severity", {}),
                    "finding_classification_counts": classification_counts,
                    "findings": findings,
                }
            )
        except Exception as exc:  # noqa: BLE001
            print(f"  - error: {exc}")
            results.append(
                {
                    "name": package,
                    "type": str(plugin.get("type") or "npm"),
                    "upgrade_target": str(plugin.get("upgrade_target") or package).strip() or package,
                    "status": "error",
                    "current": current,
                    "latest": latest,
                    "decision": "ERROR",
                    "error": str(exc),
                }
            )

    return results


def repo_update_info(repo_path: Path) -> tuple[str, str, str, dt.datetime | None] | None:
    if not repo_path.exists() or not (repo_path / ".git").exists():
        return None

    branch = run(["git", "-C", str(repo_path), "rev-parse", "--abbrev-ref", "HEAD"], check=False).stdout.strip() or "HEAD"
    current = run(["git", "-C", str(repo_path), "rev-parse", "HEAD"], check=False).stdout.strip() or "UNKNOWN"
    run(["git", "-C", str(repo_path), "fetch", "--quiet", "origin"], check=False)

    remote = "NO_REMOTE_BRANCH"
    remote_time: dt.datetime | None = None
    if branch not in {"HEAD", "DETACHED"}:
        remote_ref = f"origin/{branch}"
        remote = run(["git", "-C", str(repo_path), "rev-parse", remote_ref], check=False).stdout.strip() or "NO_REMOTE_BRANCH"
        if remote not in {"NO_REMOTE_BRANCH", ""}:
            time_out = run(["git", "-C", str(repo_path), "show", "-s", "--format=%cI", remote_ref], check=False).stdout.strip()
            remote_time = parse_iso_datetime(time_out)
    return branch, current, remote, remote_time


def audit_git_repos(workspace: Path, repos: list[str], min_age_hours: float, config_path: str = "") -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []

    print(f"[git] Checking {len(repos)} repo(s)…")
    for idx, repo in enumerate(repos, start=1):
        repo_path = Path(repo).expanduser()
        print(f"[git {idx}/{len(repos)}] {repo_path}")
        info = repo_update_info(repo_path)
        if info is None:
            print("  - missing or not a git repo")
            results.append(
                {
                    "name": repo,
                    "type": "git",
                    "status": "missing_or_not_git",
                    "decision": "SKIP_MISSING",
                }
            )
            continue

        branch, current, remote, remote_time = info
        origin_url = run(["git", "-C", str(repo_path), "remote", "get-url", "origin"], check=False).stdout.strip()

        if remote in {"NO_REMOTE_BRANCH", ""}:
            print(f"  - no remote branch for {branch}")
            results.append(
                {
                    "name": repo_path.name,
                    "type": "git",
                    "status": "unknown",
                    "branch": branch,
                    "current": current,
                    "latest": None,
                    "decision": "SKIP_NO_REMOTE_BRANCH",
                }
            )
            continue

        if current == remote:
            print(f"  - up to date on {branch}")
            results.append(
                {
                    "name": repo_path.name,
                    "type": "git",
                    "status": "up_to_date",
                    "branch": branch,
                    "current": current,
                    "latest": remote,
                    "decision": "PASS_UP_TO_DATE",
                    "counts": {"CRITICAL": 0, "HIGH": 0, "MEDIUM": 0, "LOW": 0, "INFO": 0},
                    "findings": [],
                }
            )
            continue

        remote_age = age_hours(remote_time)
        if remote_age is not None and remote_age < min_age_hours:
            print(f"  - too fresh: {current[:8]} -> {remote[:8]} ({remote_age:.1f}h < {min_age_hours:.1f}h)")
            results.append(
                {
                    "name": repo_path.name,
                    "type": "git",
                    "status": "too_fresh",
                    "branch": branch,
                    "current": current,
                    "latest": remote,
                    "published_at": remote_time.isoformat() if remote_time else None,
                    "update_age_hours": round(remote_age, 3) if remote_age is not None else None,
                    "min_update_age_hours": min_age_hours,
                    "decision": "SKIP_TOO_FRESH",
                    "counts": {},
                    "findings": [],
                }
            )
            continue

        try:
            print(f"  - update found: {current[:8]} -> {remote[:8]}")
            clone_target = workspace / f"{repo_path.name}_latest"
            if clone_target.exists():
                shutil.rmtree(clone_target)

            run(["git", "clone", "--no-checkout", origin_url, str(clone_target)])
            run(["git", "-C", str(clone_target), "checkout", "--detach", remote])

            installed_report_json = workspace / f"{repo_path.name}_{current[:8]}_installed_report.json"
            installed_report_data = scan_with_triage(repo_path, "repo", installed_report_json, config_path)
            report_json = workspace / f"{repo_path.name}_{remote[:8]}_candidate_report.json"
            report_data = scan_with_triage(clone_target, "repo", report_json, config_path)
            findings = classify_update_findings(
                installed_report_data.get("findings", []), report_data.get("findings", [])
            )
            decision = decision_for_update_findings(findings)
            classification_counts = {
                label: sum(1 for finding in findings if finding.get("classification") == label)
                for label in ("new_in_update", "changed_existing", "inherited")
            }
            print(f"  - update-aware triage decision: {decision}")

            results.append(
                {
                    "name": repo_path.name,
                    "type": "git",
                    "status": "update_available",
                    "branch": branch,
                    "current": current,
                    "latest": remote,
                    "published_at": remote_time.isoformat() if remote_time else None,
                    "update_age_hours": round(remote_age, 3) if remote_age is not None else None,
                    "min_update_age_hours": min_age_hours,
                    "decision": decision,
                    "candidate_decision": report_data.get("decision", "UNKNOWN"),
                    "counts": report_data.get("counts_by_severity", {}),
                    "installed_counts": installed_report_data.get("counts_by_severity", {}),
                    "finding_classification_counts": classification_counts,
                    "findings": findings,
                }
            )
        except Exception as exc:  # noqa: BLE001
            print(f"  - error: {exc}")
            results.append(
                {
                    "name": repo_path.name,
                    "type": "git",
                    "status": "error",
                    "branch": branch,
                    "current": current,
                    "latest": remote,
                    "decision": "ERROR",
                    "error": str(exc),
                }
            )

    return results


def summarize_results(results: list[dict[str, Any]]) -> None:
    status_counts: dict[str, int] = {}
    decision_counts: dict[str, int] = {}
    for item in results:
        status = str(item.get("status", "unknown"))
        decision = str(item.get("decision", "UNKNOWN"))
        status_counts[status] = status_counts.get(status, 0) + 1
        decision_counts[decision] = decision_counts.get(decision, 0) + 1

    print("\nSummary by status:")
    for key in sorted(status_counts):
        print(f"  - {key}: {status_counts[key]}")

    print("Summary by decision:")
    for key in sorted(decision_counts):
        print(f"  - {key}: {decision_counts[key]}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Static audit for global OMP plugin updates.")
    parser.add_argument("--packages-file", default="", help="Optional newline-separated npm package list")
    parser.add_argument("--repos-file", default="", help="Optional newline-separated git repo path list")
    parser.add_argument("--workspace", default="", help="Workspace dir (default: temporary directory)")
    parser.add_argument("--output", default="/tmp/omp_audit_aggregated.json", help="Aggregated JSON output path")
    parser.add_argument("--markdown-output", default="/tmp/omp_audit_report.md", help="Markdown summary output path")
    parser.add_argument("--config", default="", help="Optional config JSON path (highest precedence)")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    unset_security_env()

    if not TRIAGE_SCRIPT.exists():
        print(f"Missing triage script: {TRIAGE_SCRIPT}", file=sys.stderr)
        return 2

    config, config_sources = load_config(args.config)
    min_age_hours = float(config.get("min_update_age_hours", DEFAULT_CONFIG["min_update_age_hours"]))

    print(f"Config: min_update_age_hours={min_age_hours:.1f}")
    if config_sources:
        print("Config sources:")
        for source in config_sources:
            print(f"  - {source}")
    else:
        print("Config sources: defaults only")

    if args.packages_file:
        packages = [{"name": name, "path": ""} for name in read_non_comment_lines(Path(args.packages_file))]
    else:
        try:
            discovered = discover_omp_plugins()
        except RuntimeError as exc:
            print(f"OMP plugin discovery failed: {exc}", file=sys.stderr)
            return 2
        packages = discovered
    repos = read_non_comment_lines(Path(args.repos_file)) if args.repos_file else []

    workspace = Path(args.workspace) if args.workspace else Path(tempfile.mkdtemp(prefix="omp-audit-"))
    workspace.mkdir(parents=True, exist_ok=True)

    print(f"Workspace: {workspace}")

    results: list[dict[str, Any]] = []
    results.extend(audit_npm_packages(workspace, packages, min_age_hours, args.config))
    results.extend(audit_git_repos(workspace, repos, min_age_hours, args.config))

    output = Path(args.output)
    output.write_text(json.dumps(results, indent=2), encoding="utf-8")
    print(f"Wrote aggregated report: {output}")

    markdown_output = Path(args.markdown_output)
    if SUMMARIZE_SCRIPT.exists():
        run(["python3", str(SUMMARIZE_SCRIPT), "--input", str(output), "--output", str(markdown_output)])
        print(f"Wrote markdown report: {markdown_output}")
    else:
        print(f"Markdown summarizer not found: {SUMMARIZE_SCRIPT}", file=sys.stderr)

    summarize_results(results)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
