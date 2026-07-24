#!/usr/bin/env python3
import json
import os
import subprocess
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
RUN_AUDIT_SCRIPT = SCRIPT_DIR / "run_omp_dependency_audit.py"
AGGREGATED_JSON = Path("/tmp/omp_audit_aggregated.json")
MARKDOWN_REPORT = Path("/tmp/omp_audit_report.md")
UPGRADE_ELIGIBLE_DECISION = "PASS_WITH_CAUTION"


def is_upgrade_eligible(item):
    return (
        item.get("status") == "update_available"
        and item.get("decision") == UPGRADE_ELIGIBLE_DECISION
    )


def upgrade_command(item):
    target = str(item.get("upgrade_target") or item.get("name") or "").strip()
    if not target:
        raise ValueError("Missing OMP plugin upgrade target")
    return ["omp", "plugin", "upgrade", target]



def main():
    print("\n🛡️ Starte Sicherheits-Audit der OMP-Plugins...")
    
    # 1. Run the audit script
    audit_res = subprocess.run(["python3", str(RUN_AUDIT_SCRIPT)], text=True)
    if audit_res.returncode != 0:
        print("❌ Audit fehlgeschlagen oder abgebrochen.")
        return 1
        
    if not AGGREGATED_JSON.exists():
        print("❌ Audit-Ergebnisdatei nicht gefunden.")
        return 1
    if MARKDOWN_REPORT.exists():
        print(f"📄 Detail-Report: {MARKDOWN_REPORT}")
        
    try:
        results = json.loads(AGGREGATED_JSON.read_text(encoding="utf-8"))
    except Exception as e:
        print(f"❌ Fehler beim Lesen der Audit-Ergebnisse: {e}")
        return 1
        
    # 2. Only PASS_WITH_CAUTION updates may be presented or selected.
    updates = [item for item in results if is_upgrade_eligible(item)]
    if not updates:
        print("\n✅ Keine sicher freigegebenen OMP-Plugin-Updates vorhanden.")
        return 0

    def get_omp_source(item):
        return str(item.get("upgrade_target") or item.get("name") or "")
        
    # Print menu
    for idx, item in enumerate(updates, start=1):
        name = item.get("name")
        current = item.get("current")[:8] if item.get("type") == "git" and item.get("current") else item.get("current")
        latest = item.get("latest")[:8] if item.get("type") == "git" and item.get("latest") else item.get("latest")
        decision = item.get("decision", "UNKNOWN")
        status = item.get("status")
        
        # Format decision string
        if decision in {"QUARANTINE", "BLOCK_UNTIL_REVIEW"}:
            dec_str = f"❌ {decision}"
        elif decision == "REVIEW_BEFORE_USE":
            dec_str = f"🟡 {decision}"
        elif status == "too_fresh":
            dec_str = f"⏱️ TOO FRESH (Alterssperre)"
        else:
            dec_str = f"✅ SAFE"
            
        print(f"[{idx}] {name} ({current} -> {latest})")
        print(f"    Urteil: {dec_str} | Quelle: {get_omp_source(item)}")
        print("-" * 80)
        
    print("\nOptionen:")
    print(" - Gib die Nummern der sicher freigegebenen Updates ein (z.B. 1, 3, 5)")
    print(" - 'safe' oder 'all' für alle sicher freigegebenen Updates")
    print(" - 'q' zum Abbrechen")
    if MARKDOWN_REPORT.exists():
        print(f"\nDetails zu blockierten/verschobenen Updates: {MARKDOWN_REPORT}")
    
    try:
        user_input = input("\nDeine Auswahl: ").strip().lower()
    except KeyboardInterrupt:
        print("\nAbgebrochen.")
        return 0
        
    if user_input in {"q", "quit", "exit", ""}:
        print("Abgebrochen.")
        return 0
        
    selected_items = []
    
    if user_input in {"safe", "all"}:
        selected_items = list(updates)
    else:
        # Parse numbers
        parts = [p.strip() for p in user_input.split(",")]
        for p in parts:
            try:
                idx = int(p)
                if 1 <= idx <= len(updates):
                    selected_items.append(updates[idx - 1])
                else:
                    print(f"⚠️ Ungültige Nummer: {idx}")
            except ValueError:
                if p:
                    print(f"⚠️ Ungültige Eingabe übersprungen: '{p}'")
                
    selected_items = [item for item in selected_items if is_upgrade_eligible(item)]
    if not selected_items:
        print("Keine sicher freigegebenen Updates ausgewählt.")
        return 0
        
    print(f"\n🚀 Folgende {len(selected_items)} Updates werden installiert:")
    for item in selected_items:
        print(f"  - {item.get('name')} ({get_omp_source(item)})")
        
    try:
        confirm = input("\nFortfahren? [j/N]: ").strip().lower()
    except KeyboardInterrupt:
        print("\nAbgebrochen.")
        return 0
        
    if confirm not in {"j", "ja", "yes", "y"}:
        print("Abgebrochen.")
        return 0
        
    # Execute OMP plugin upgrades only after selection and confirmation.
    for item in selected_items:
        command = upgrade_command(item)
        print(f"\n========================================================")
        print(f"📦 Führe aus: {' '.join(command)}")
        print(f"========================================================")
        subprocess.run(command)
        
    print("\n✅ Update-Prozess beendet!")
    return 0

if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        print("\nAbgebrochen.")
        sys.exit(0)
