#!/usr/bin/env python3
"""Offline self-test: walks a local fake lens with deliberate bugs and asserts the walker
catches them, dedupes against an existing ticket, cleans up its fixture, and re-verifies."""
import json, os, shutil, subprocess, sys, tempfile
HERE = os.path.dirname(os.path.abspath(__file__))
WALKER = os.path.dirname(HERE)
sys.path.insert(0, HERE)
from fixture_app import serve

srv = serve()
base = "http://127.0.0.1:%d" % srv.server_address[1]
tmp = tempfile.mkdtemp(prefix="walker-selftest-")
audit = os.path.join(tmp, "audit")
os.makedirs(os.path.join(audit, "reports")); os.makedirs(os.path.join(audit, "evidence"))
json.dump([{"slug": "demo", "url": base + "/lenses/demo", "category": "test", "checks": {"export": "PASS"}},
           {"slug": "chat", "url": base + "/lenses/chat", "category": "test"}], open(os.path.join(audit, "inventory.json"), "w"))
existing = [
    {"id": "FIX-demo-001", "lens": "demo", "severity": "low", "title": "Settings text fails contrast", "repro_steps": ["x"],
     "expected": "AA", "actual": "low contrast text", "evidence_path": "x", "suspected_area": "x", "status": "OPEN", "tester": "t", "ts": "x"},
    {"id": "FIX-demo-002", "lens": "demo", "severity": "medium", "title": "Escape doesn't close the 'Filters' dialog", "repro_steps": ["Click 'Filters'", "Press Escape"],
     "expected": "closes", "actual": "stays open", "evidence_path": "x", "suspected_area": "x", "status": "FIXED_PENDING_VERIFY", "tester": "t", "ts": "x"},
    {"id": "FIX-demo-003", "lens": "demo", "severity": "medium", "title": "Escape doesn't close the 'Settings' dialog", "repro_steps": ["Click 'Settings'", "Press Escape"],
     "expected": "closes", "actual": "stays open", "evidence_path": "x", "suspected_area": "x", "status": "FIXED_PENDING_VERIFY", "tester": "t", "ts": "x"},
    {"id": "FIX-deities-002", "lens": "demo", "severity": "Medium", "title": "Mobile 390x844 reload crashed the tab", "repro_steps": "see evidence",
     "expected": "no crash", "actual": "crash", "evidence_path": "x", "suspected_area": "x", "status": "OPEN", "ts": "x"},
    {"id": "FIX-007", "lens": "chat", "severity": "medium", "title": "Mobile chat input fill/click timeouts", "repro_steps": ["Open Chat at 390x844", "Focus composer and send a message"],
     "expected": "works", "actual": "timeouts", "evidence_path": "x", "suspected_area": "x", "status": "OPEN", "ts": "x"},
]
with open(os.path.join(audit, "fix_tickets.jsonl"), "w") as f:
    for t in existing:
        f.write(json.dumps(t) + "\n")
cfg = json.load(open(os.path.join(WALKER, "config.json")))
cfg["base_url"] = base
cfg["audit_dir"] = audit
st = os.path.join(tmp, "t1.json"); json.dump({"cookies": [], "origins": []}, open(st, "w"))
cfg["accounts"]["t1"]["storage_state"] = st
cfg["write_skip_lenses"] = ["chat"]
RUNS = os.path.join(tmp, "runs"); os.makedirs(RUNS)
cfg["runs_dir"] = RUNS; cfg["queue_dir"] = os.path.join(tmp, "queue")
cfg["thresholds"]["lens_budget_s"] = 400
cfgp = os.path.join(tmp, "config.json"); json.dump(cfg, open(cfgp, "w"))

py = sys.executable
def run(*a):
    print("$ walker.py", " ".join(a), flush=True)
    r = subprocess.run([py, os.path.join(WALKER, "walker.py"), "--config", cfgp] + list(a), capture_output=True, text=True, timeout=900)
    print(r.stdout[-6000:]); print(r.stderr[-3000:])
    return r

run("lens", "demo", "--allow-write")
runs = sorted(os.listdir(RUNS))
rd = os.path.join(RUNS, runs[-1])
findings = [json.loads(l) for l in open(os.path.join(rd, "findings.jsonl"))] if os.path.exists(os.path.join(rd, "findings.jsonl")) else []
checks = {f["check"] for f in findings}
print("FINDING CHECKS:", sorted(checks))
new = [json.loads(l) for l in open(os.path.join(audit, "fix_tickets.jsonl"))][len(existing):]
expect = {"tab_error", "timing", "contrast", "escape", "unnamed", "keyboard", "overflow390", "delete_confirm"}
results = {"missing_expected": sorted(expect - checks)}
results["contrast_deduped"] = not any(t["title"].endswith("WCAG AA contrast") for t in new)
results["ticket_keys_ok"] = all(list(t)[:12] == ["id", "lens", "severity", "title", "repro_steps", "expected", "actual", "evidence_path",
                                                  "suspected_area", "status", "tester", "ts"] for t in new)
results["all_findings_have_evidence"] = all(f["evidence"] and all(os.path.exists(os.path.join(audit, e)) for e in f["evidence"]) for f in findings)
fx = [json.loads(l) for l in open(os.path.join(rd, "fixtures.jsonl"))] if os.path.exists(os.path.join(rd, "fixtures.jsonl")) else []
results["fixture_deleted"] = any(f["state"] == "deleted" for f in fx)
results["new_ticket_ids"] = [t["id"] for t in new]

run("reverify", "FIX-demo-002", "FIX-demo-003", "FIX-deities-002", "FIX-007", "--apply-status")
runs = sorted(os.listdir(RUNS))
rv = [json.loads(l) for l in open(os.path.join(RUNS, runs[-1], "reverify.jsonl"))]
results["reverify"] = {r["id"]: r["verdict"] for r in rv}
run("reverify", "FIX-007", "--allow-write")
runs = sorted(os.listdir(RUNS))
rv2 = [json.loads(l) for l in open(os.path.join(RUNS, runs[-1], "reverify.jsonl"))]
results["fix007_write"] = rv2[0]["verdict"]
lo = open(os.path.join(audit, "reports", "LEFTOVER_FIXTURES.md")).read() if os.path.exists(os.path.join(audit, "reports", "LEFTOVER_FIXTURES.md")) else ""
results["fix007_leftover_logged"] = "qa-walker-chat" in lo
import re as _re
pkg = os.path.join(WALKER, "concord_walker")
banned = _re.compile(r"\.(evaluate|evaluate_handle|locator|query_selector|query_selector_all|add_init_script|add_script_tag|expose_function|expose_binding|fill|get_by_\w+|wait_for_selector|wait_for_function|route)\(|Runtime\.evaluate|Runtime\.callFunctionOn")
hits = [f + ":" + str(i + 1) for f in os.listdir(pkg) if f.endswith(".py")
        for i, line in enumerate(open(os.path.join(pkg, f))) if banned.search(line)]
results["no_page_js_calls"] = not hits
if hits: print("PAGE-JS CALLS FOUND:", hits)
ok = (results["fix007_write"] == "FIXED" and results["fix007_leftover_logged"] and results["no_page_js_calls"] and not results["missing_expected"] and results["contrast_deduped"] and results["ticket_keys_ok"]
      and results["all_findings_have_evidence"] and results["fixture_deleted"]
      and results["reverify"].get("FIX-demo-002") == "STILL_FAILING" and results["reverify"].get("FIX-demo-003") == "FIXED"
      and results["reverify"].get("FIX-deities-002") == "FIXED" and results["reverify"].get("FIX-007") == "NEEDS_HUMAN")
print(json.dumps(results, indent=1))
print("SELFTEST", "PASS" if ok else "FAIL", "(tmp audit dir:", tmp, ")")
srv.shutdown()
sys.exit(0 if ok else 1)
