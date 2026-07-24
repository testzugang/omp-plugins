#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import json
import subprocess
import tempfile
import unittest
from types import SimpleNamespace
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
TRIAGE_SCRIPT = SCRIPT_DIR / "npm_ts_static_triage.py"
INTERACTIVE_UPDATE_SCRIPT = SCRIPT_DIR / "omp-interactive-update.py"
SUMMARIZE_SCRIPT = SCRIPT_DIR / "summarize_omp_dependency_audit.py"


def load_module(path: Path, module_name: str):
    spec = importlib.util.spec_from_file_location(module_name, path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def finding(severity: str, path: str, title: str, evidence: str) -> dict[str, object]:
    return {
        "severity": severity,
        "category": "script",
        "path": path,
        "line": 1,
        "title": title,
        "evidence": evidence,
        "recommendation": "Review before upgrading.",
        "confidence": "high",
        "tags": ["test"],
    }


RUN_AUDIT_SCRIPT = SCRIPT_DIR / "run_omp_dependency_audit.py"


def load_run_audit_module():
    spec = importlib.util.spec_from_file_location("run_omp_dependency_audit", RUN_AUDIT_SCRIPT)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def load_interactive_update_module():
    return load_module(INTERACTIVE_UPDATE_SCRIPT, "omp_interactive_update")


def load_summary_module():
    return load_module(SUMMARIZE_SCRIPT, "summarize_omp_dependency_audit")




def run_cmd(args: list[str], cwd: Path | None = None) -> subprocess.CompletedProcess[str]:
    return subprocess.run(args, cwd=cwd, text=True, capture_output=True, check=False)


class DependencyAuditBehaviorTest(unittest.TestCase):
    def test_trusted_peer_dependency_scope_downgrades_floating_range_to_info(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            package_json = root / "package.json"
            report_json = root / "report.json"
            config_json = root / "config.json"

            package_json.write_text(
                json.dumps(
                    {
                        "name": "sample-plugin",
                        "version": "1.0.0",
                        "license": "MIT",
                        "peerDependencies": {"@oh-my-pi/pi-coding-agent": "*"},
                    },
                    indent=2,
                ),
                encoding="utf-8",
            )
            config_json.write_text(
                json.dumps({"trusted_peer_dependency_scopes": ["@oh-my-pi"]}),
                encoding="utf-8",
            )

            result = run_cmd(
                [
                    "python3",
                    str(TRIAGE_SCRIPT),
                    str(package_json),
                    "--mode",
                    "package",
                    "--config",
                    str(config_json),
                    "--json",
                    str(report_json),
                ]
            )

            self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
            report = json.loads(report_json.read_text(encoding="utf-8"))
            peer_findings = [
                finding
                for finding in report["findings"]
                if finding["category"] == "dependency-spec" and "@oh-my-pi/pi-coding-agent" in finding["evidence"]
            ]
            self.assertEqual(len(peer_findings), 1)
            self.assertEqual(peer_findings[0]["severity"], "INFO")
            self.assertIn("trusted-peer", peer_findings[0]["tags"])
            self.assertEqual(report["decision"], "PASS_WITH_CAUTION")

    def test_run_omp_dependency_audit_writes_markdown_report(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            packages_file = root / "packages.txt"
            repos_file = root / "repos.txt"
            output_json = root / "audit.json"
            output_md = root / "audit.md"
            packages_file.write_text("", encoding="utf-8")
            repos_file.write_text("", encoding="utf-8")

            result = run_cmd(
                [
                    "python3",
                    str(RUN_AUDIT_SCRIPT),
                    "--packages-file",
                    str(packages_file),
                    "--repos-file",
                    str(repos_file),
                    "--workspace",
                    str(root / "workspace"),
                    "--output",
                    str(output_json),
                    "--markdown-output",
                    str(output_md),
                ]
            )

            self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
            self.assertTrue(output_json.exists())
            self.assertTrue(output_md.exists())
            self.assertIn("Global OMP Dependency Security Audit Report", output_md.read_text(encoding="utf-8"))
            self.assertIn(f"Wrote markdown report: {output_md}", result.stdout)

    def test_git_repo_paths_expand_tilde_before_repo_check(self) -> None:
        module = load_run_audit_module()
        captured_paths: list[Path] = []

        def fake_repo_update_info(repo_path: Path):
            captured_paths.append(repo_path)
            return None

        original = module.repo_update_info
        module.repo_update_info = fake_repo_update_info
        try:
            results = module.audit_git_repos(Path(tempfile.gettempdir()), ["~/omp-plugin-repos/testzugang/omp-plugins"], 24.0)
        finally:
            module.repo_update_info = original

        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]["status"], "missing_or_not_git")
        self.assertTrue(captured_paths)
        self.assertEqual(captured_paths[0], Path("~/omp-plugin-repos/testzugang/omp-plugins").expanduser())

    def test_blank_final_confirmation_declines_upgrade(self) -> None:
        module = load_interactive_update_module()
        with tempfile.TemporaryDirectory() as tmp:
            aggregated_json = Path(tmp) / "aggregated.json"
            aggregated_json.write_text(
                json.dumps(
                    [
                        {
                            "name": "@testzugang/omp-example",
                            "type": "npm",
                            "status": "update_available",
                            "current": "1.0.0",
                            "latest": "1.1.0",
                            "decision": "PASS_WITH_CAUTION",
                        }
                    ]
                ),
                encoding="utf-8",
            )
            original_run = module.subprocess.run
            original_aggregated = module.AGGREGATED_JSON
            original_markdown = module.MARKDOWN_REPORT
            module.AGGREGATED_JSON = aggregated_json
            module.MARKDOWN_REPORT = Path(tmp) / "report.md"
            calls: list[list[str]] = []

            def fake_run(args: list[str], **kwargs: object) -> subprocess.CompletedProcess[str]:
                calls.append(args)
                return subprocess.CompletedProcess(args, 0)

            module.subprocess.run = fake_run
            try:
                from unittest.mock import patch

                with patch("builtins.input", side_effect=["safe", ""]):
                    self.assertEqual(module.main(), 0)
            finally:
                module.subprocess.run = original_run
                module.AGGREGATED_JSON = original_aggregated
                module.MARKDOWN_REPORT = original_markdown

            self.assertEqual(calls, [["python3", str(module.RUN_AUDIT_SCRIPT)]])

    def test_update_findings_are_classified_and_inherited_high_does_not_block(self) -> None:
        module = load_run_audit_module()
        installed = [finding("HIGH", "scripts/install.js", "Network install hook", "curl https://old.example")]
        candidate = [
            finding("HIGH", "package/scripts/install.js", "Network install hook", "curl https://old.example"),
            finding("HIGH", "package/scripts/install.js", "Network install hook", "curl https://new.example"),
            finding("CRITICAL", "package/scripts/postinstall.js", "New shell execution", "exec('sh -c payload')"),
        ]

        classified = module.classify_update_findings(installed, candidate)

        self.assertEqual(
            [item["classification"] for item in classified],
            ["inherited", "changed_existing", "new_in_update"],
        )
        self.assertEqual(module.decision_for_update_findings(classified[:1]), "PASS_WITH_CAUTION")
        self.assertEqual(module.decision_for_update_findings(classified), "QUARANTINE")
        for item in classified:
            self.assertIn("diff_evidence", item)
            self.assertIn("candidate", item["diff_evidence"])
        self.assertEqual(classified[1]["diff_evidence"]["baseline"]["evidence"], "curl https://old.example")
        self.assertEqual(classified[1]["diff_evidence"]["candidate"]["evidence"], "curl https://new.example")

    def test_summary_reports_high_finding_classification_and_diff_evidence(self) -> None:
        module = load_summary_module()
        markdown = module.render_markdown(
            [
                {
                    "name": "@testzugang/omp-example",
                    "type": "npm",
                    "status": "update_available",
                    "current": "1.0.0",
                    "latest": "1.1.0",
                    "decision": "BLOCK_UNTIL_REVIEW",
                    "counts": {"HIGH": 1},
                    "findings": [
                        {
                            **finding("HIGH", "package/scripts/install.js", "Network install hook", "curl https://new.example"),
                            "classification": "changed_existing",
                            "diff_evidence": {
                                "baseline": {"evidence": "curl https://old.example"},
                                "candidate": {"evidence": "curl https://new.example"},
                            },
                        }
                    ],
                }
            ]
        )

        self.assertIn("Classification: `changed_existing`", markdown)
        self.assertIn("Baseline evidence: `curl https://old.example`", markdown)
        self.assertIn("Candidate evidence: `curl https://new.example`", markdown)

    def test_suggested_upgrade_command_excludes_review_required_updates(self) -> None:
        module = load_summary_module()
        markdown = module.render_markdown(
            [
                {
                    "name": "@testzugang/omp-safe",
                    "type": "npm",
                    "status": "update_available",
                    "current": "1.0.0",
                    "latest": "1.1.0",
                    "decision": "PASS_WITH_CAUTION",
                    "counts": {},
                    "findings": [],
                },
                {
                    "name": "@testzugang/omp-review",
                    "type": "npm",
                    "status": "update_available",
                    "current": "1.0.0",
                    "latest": "1.1.0",
                    "decision": "REVIEW_BEFORE_USE",
                    "counts": {},
                    "findings": [],
                },
            ]
        )

        self.assertIn("omp plugin upgrade @testzugang/omp-safe", markdown)
        self.assertNotIn("omp plugin upgrade @testzugang/omp-review", markdown)


    def test_all_selection_only_upgrades_pass_with_caution_updates(self) -> None:
        module = load_interactive_update_module()
        with tempfile.TemporaryDirectory() as tmp:
            aggregated_json = Path(tmp) / "aggregated.json"
            aggregated_json.write_text(
                json.dumps(
                    [
                        {
                            "name": "@testzugang/omp-safe",
                            "type": "npm",
                            "status": "update_available",
                            "current": "1.0.0",
                            "latest": "1.1.0",
                            "decision": "PASS_WITH_CAUTION",
                        },
                        {
                            "name": "@testzugang/omp-blocked",
                            "type": "npm",
                            "status": "update_available",
                            "current": "1.0.0",
                            "latest": "1.1.0",
                            "decision": "BLOCK_UNTIL_REVIEW",
                        },
                        {
                            "name": "@testzugang/omp-quarantined",
                            "type": "npm",
                            "status": "update_available",
                            "current": "1.0.0",
                            "latest": "1.1.0",
                            "decision": "QUARANTINE",
                        },
                        {
                            "name": "@testzugang/omp-fresh",
                            "type": "npm",
                            "status": "too_fresh",
                            "current": "1.0.0",
                            "latest": "1.1.0",
                            "decision": "PASS_WITH_CAUTION",
                        },
                        {
                            "name": "@testzugang/omp-review",
                            "type": "npm",
                            "status": "update_available",
                            "current": "1.0.0",
                            "latest": "1.1.0",
                            "decision": "REVIEW_BEFORE_USE",
                        },
                    ]
                ),
                encoding="utf-8",
            )
            original_run = module.subprocess.run
            original_aggregated = module.AGGREGATED_JSON
            original_markdown = module.MARKDOWN_REPORT
            module.AGGREGATED_JSON = aggregated_json
            module.MARKDOWN_REPORT = Path(tmp) / "report.md"
            calls: list[list[str]] = []

            def fake_run(args: list[str], **kwargs: object) -> subprocess.CompletedProcess[str]:
                calls.append(args)
                return subprocess.CompletedProcess(args, 0)

            module.subprocess.run = fake_run
            try:
                from unittest.mock import patch

                with patch("builtins.input", side_effect=["all", "yes"]):
                    self.assertEqual(module.main(), 0)
            finally:
                module.subprocess.run = original_run
                module.AGGREGATED_JSON = original_aggregated
                module.MARKDOWN_REPORT = original_markdown

            self.assertEqual(
                calls,
                [
                    ["python3", str(module.RUN_AUDIT_SCRIPT)],
                    ["omp", "plugin", "upgrade", "@testzugang/omp-safe"],
                ],
            )

    def test_numeric_selection_cannot_upgrade_unsafe_updates(self) -> None:
        module = load_interactive_update_module()
        with tempfile.TemporaryDirectory() as tmp:
            aggregated_json = Path(tmp) / "aggregated.json"
            aggregated_json.write_text(
                json.dumps(
                    [
                        {
                            "name": "@testzugang/omp-safe",
                            "type": "npm",
                            "status": "update_available",
                            "current": "1.0.0",
                            "latest": "1.1.0",
                            "decision": "PASS_WITH_CAUTION",
                        },
                        {
                            "name": "@testzugang/omp-blocked",
                            "type": "npm",
                            "status": "update_available",
                            "current": "1.0.0",
                            "latest": "1.1.0",
                            "decision": "BLOCK_UNTIL_REVIEW",
                        },
                    ]
                ),
                encoding="utf-8",
            )
            original_run = module.subprocess.run
            original_aggregated = module.AGGREGATED_JSON
            original_markdown = module.MARKDOWN_REPORT
            module.AGGREGATED_JSON = aggregated_json
            module.MARKDOWN_REPORT = Path(tmp) / "report.md"
            calls: list[list[str]] = []

            def fake_run(args: list[str], **kwargs: object) -> subprocess.CompletedProcess[str]:
                calls.append(args)
                return subprocess.CompletedProcess(args, 0)

            module.subprocess.run = fake_run
            try:
                from unittest.mock import patch

                with patch("builtins.input", side_effect=["1,2", "yes"]):
                    self.assertEqual(module.main(), 0)
            finally:
                module.subprocess.run = original_run
                module.AGGREGATED_JSON = original_aggregated
                module.MARKDOWN_REPORT = original_markdown

            self.assertEqual(
                calls,
                [
                    ["python3", str(module.RUN_AUDIT_SCRIPT)],
                    ["omp", "plugin", "upgrade", "@testzugang/omp-safe"],
                ],
            )

    def test_interactive_safe_marketplace_update_uses_qualified_target(self) -> None:
        module = load_interactive_update_module()
        with tempfile.TemporaryDirectory() as tmp:
            aggregated_json = Path(tmp) / "aggregated.json"
            aggregated_json.write_text(
                json.dumps(
                    [
                        {
                            "name": "security-review",
                            "type": "marketplace",
                            "upgrade_target": "security-review@testzugang",
                            "status": "update_available",
                            "current": "1.0.0",
                            "latest": "1.1.0",
                            "decision": "PASS_WITH_CAUTION",
                        }
                    ]
                ),
                encoding="utf-8",
            )
            original_run = module.subprocess.run
            original_aggregated = module.AGGREGATED_JSON
            original_markdown = module.MARKDOWN_REPORT
            module.AGGREGATED_JSON = aggregated_json
            module.MARKDOWN_REPORT = Path(tmp) / "report.md"
            calls: list[list[str]] = []

            def fake_run(args: list[str], **kwargs: object) -> subprocess.CompletedProcess[str]:
                calls.append(args)
                return subprocess.CompletedProcess(args, 0)

            module.subprocess.run = fake_run
            try:
                from unittest.mock import patch

                with patch("builtins.input", side_effect=["1", "yes"]):
                    self.assertEqual(module.main(), 0)
            finally:
                module.subprocess.run = original_run
                module.AGGREGATED_JSON = original_aggregated
                module.MARKDOWN_REPORT = original_markdown

            self.assertEqual(
                calls,
                [
                    ["python3", str(module.RUN_AUDIT_SCRIPT)],
                    ["omp", "plugin", "upgrade", "security-review@testzugang"],
                ],
            )

    def test_summary_emits_qualified_command_for_safe_marketplace_update(self) -> None:
        summary = load_summary_module()
        markdown = summary.render_markdown(
            [
                {
                    "name": "security-review",
                    "type": "marketplace",
                    "upgrade_target": "security-review@testzugang",
                    "status": "update_available",
                    "current": "1.0.0",
                    "latest": "1.1.0",
                    "decision": "PASS_WITH_CAUTION",
                    "findings": [],
                }
            ]
        )

        self.assertIn("omp plugin upgrade security-review@testzugang", markdown)
        self.assertNotIn("```bash\nomp plugin upgrade\n```", markdown)

    def test_discovered_marketplace_plugin_reaches_audit_result_with_qualified_upgrade_target(self) -> None:
        module = load_run_audit_module()
        plugin_list = {
            "npm": [],
            "marketplace": [
                {
                    "name": "security-review",
                    "marketplace": "testzugang",
                    "path": "/tmp/omp/marketplace/security-review",
                }
            ],
        }

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            output = root / "audit.json"
            original_parse_args = module.parse_args
            original_run = module.run
            original_audit_npm_packages = module.audit_npm_packages
            original_audit_git_repos = module.audit_git_repos
            original_summarize_script = module.SUMMARIZE_SCRIPT
            audited_packages: list[dict[str, object]] = []

            def fake_run(args: list[str], **kwargs: object) -> subprocess.CompletedProcess[str]:
                self.assertEqual(args, ["omp", "plugin", "list", "--json"])
                return subprocess.CompletedProcess(args, 0, json.dumps(plugin_list), "")

            def fake_audit_npm_packages(
                workspace: Path,
                packages: list[dict[str, object]],
                min_age_hours: float,
                config_path: str = "",
            ) -> list[dict[str, object]]:
                audited_packages.extend(packages)
                return [
                    {
                        **package,
                        "status": "update-available",
                        "decision": "PASS_WITH_CAUTION",
                    }
                    for package in packages
                ]

            module.parse_args = lambda: SimpleNamespace(
                packages_file="",
                repos_file="",
                workspace=str(root / "workspace"),
                output=str(output),
                markdown_output=str(root / "report.md"),
                config="",
            )
            module.run = fake_run
            module.audit_npm_packages = fake_audit_npm_packages
            module.audit_git_repos = lambda *args: []
            module.SUMMARIZE_SCRIPT = root / "missing-summary.py"
            try:
                self.assertEqual(module.main(), 0)
            finally:
                module.parse_args = original_parse_args
                module.run = original_run
                module.audit_npm_packages = original_audit_npm_packages
                module.audit_git_repos = original_audit_git_repos
                module.SUMMARIZE_SCRIPT = original_summarize_script

            self.assertEqual(
                audited_packages,
                [
                    {
                        "name": "security-review",
                        "type": "marketplace",
                        "path": "/tmp/omp/marketplace/security-review",
                        "upgrade_target": "security-review@testzugang",
                    }
                ],
            )
            results = json.loads(output.read_text(encoding="utf-8"))
            self.assertEqual(results[0]["upgrade_target"], "security-review@testzugang")
            self.assertEqual(
                module.upgrade_command(results[0]),
                ["omp", "plugin", "upgrade", "security-review@testzugang"],
            )

    def test_marketplace_audit_result_preserves_qualified_upgrade_target(self) -> None:
        module = load_run_audit_module()
        original_current_installed_version = module.current_installed_version
        original_npm_latest_version = module.npm_latest_version
        module.current_installed_version = lambda path: "1.0.0"
        module.npm_latest_version = lambda package: "1.0.0"
        try:
            results = module.audit_npm_packages(
                Path(tempfile.gettempdir()),
                [
                    {
                        "name": "security-review",
                        "type": "marketplace",
                        "path": "/tmp/omp/marketplace/security-review",
                        "upgrade_target": "security-review@testzugang",
                    }
                ],
                24.0,
            )
        finally:
            module.current_installed_version = original_current_installed_version
            module.npm_latest_version = original_npm_latest_version

        self.assertEqual(results[0]["type"], "marketplace")
        self.assertEqual(results[0]["upgrade_target"], "security-review@testzugang")
        self.assertEqual(
            module.upgrade_command(results[0]),
            ["omp", "plugin", "upgrade", "security-review@testzugang"],
        )

    def test_omp_plugin_list_drives_direct_npm_and_marketplace_commands(self) -> None:
        module = load_run_audit_module()
        original_run = module.run
        plugin_list = {
            "npm": [
                {
                    "name": "@testzugang/omp-commit",
                    "path": "/tmp/omp/npm/@testzugang/omp-commit",
                }
            ],
            "marketplace": [
                {
                    "name": "security-review",
                    "marketplace": "testzugang",
                    "path": "/tmp/omp/marketplace/security-review",
                }
            ],
        }

        def fake_run(args: list[str], **kwargs: object) -> subprocess.CompletedProcess[str]:
            self.assertEqual(args, ["omp", "plugin", "list", "--json"])
            return subprocess.CompletedProcess(args, 0, json.dumps(plugin_list), "")

        module.run = fake_run
        try:
            discovered = module.discover_omp_plugins()
        finally:
            module.run = original_run

        self.assertEqual(
            discovered,
            [
                {
                    "name": "@testzugang/omp-commit",
                    "type": "npm",
                    "path": "/tmp/omp/npm/@testzugang/omp-commit",
                    "upgrade_target": "@testzugang/omp-commit",
                },
                {
                    "name": "security-review",
                    "type": "marketplace",
                    "path": "/tmp/omp/marketplace/security-review",
                    "upgrade_target": "security-review@testzugang",
                },
            ],
        )
        self.assertEqual(
            module.upgrade_command(discovered[0]),
            ["omp", "plugin", "upgrade", "@testzugang/omp-commit"],
        )
        self.assertEqual(
            module.upgrade_command(discovered[1]),
            ["omp", "plugin", "upgrade", "security-review@testzugang"],
        )
        self.assertNotIn(".omp/" + "agent/git", RUN_AUDIT_SCRIPT.read_text(encoding="utf-8"))
if __name__ == "__main__":
    unittest.main()
