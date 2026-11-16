#!/usr/bin/env python3
"""Offline self-test: walks a local fake lens with deliberate bugs and asserts the walker
catches them, dedupes against an existing ticket, cleans up its fixture, and re-verifies."""
import json, os, shutil, subprocess, sys, tempfile
HERE = os.path.dirname(os.path.abspath(__file__))
WALKER = os.path.dirname(HERE)
sys.path.insert(0, HERE)
from fixture_app import serve, FIXTURE_SHA

srv = serve()
base = "http://127.0.0.1:%d" % srv.server_address[1]
tmp = tempfile.mkdtemp(prefix="walker-selftest-")
audit = os.path.join(tmp, "audit")
os.makedirs(os.path.join(audit, "reports")); os.makedirs(os.path.join(audit, "evidence"))
json.dump([{"slug": "demo", "url": base + "/lenses/demo", "category": "test", "checks": {"export": "PASS"}},
           {"slug": "chat", "url": base + "/lenses/chat", "category": "test"},
           {"slug": "ghost", "url": base + "/lenses/ghost", "category": "test"}], open(os.path.join(audit, "inventory.json"), "w"))
existing = [
    {"id": "FIX-demo-001", "lens": "demo", "severity": "low", "title": "Settings text fails contrast", "repro_steps": ["x"],
     "expected": "AA", "actual": "low contrast text", "evidence_path": "x", "suspected_area": "x", "status": "OPEN", "tester": "t", "ts": "x"},
    {"id": "FIX-demo-002", "lens": "demo", "severity": "medium", "title": "Escape doesn't close the 'Filters' dialog", "repro_steps": ["Click 'Filters'", "Press Escape"],
     "expected": "closes", "actual": "stays open", "evidence_path": "x", "suspected_area": "x", "status": "FIXED_PENDING_VERIFY", "tester": "t", "ts": "x"},
    {"id": "FIX-demo-003", "lens": "demo", "severity": "medium", "title": "Escape doesn't close the 'Settings' dialog", "repro_steps": ["Click 'Settings'", "Press Escape"],
     "expected": "closes", "actual": "stays open", "evidence_path": "x", "suspected_area": "x", "status": "FIXED_PENDING_VERIFY", "tester": "t", "ts": "x"},
    {"id": "FIX-deities-002", "lens": "demo", "severity": "Medium", "title": "Mobile 390x844 reload crashed the tab", "repro_steps": "see evidence",
     "expected": "no crash", "actual": "crash", "evidence_path": "x", "suspected_area": "x", "status": "FIXED_PENDING_VERIFY", "ts": "x"},
    {"id": "FIX-007", "lens": "chat", "severity": "medium", "title": "Mobile chat input fill/click timeouts", "repro_steps": ["Open Chat at 390x844", "Focus composer and send a message"],
     "expected": "works", "actual": "timeouts", "evidence_path": "x", "suspected_area": "x", "status": "OPEN", "ts": "x"},
    # coverage-table fixtures: an in-inventory lens the walk never visited, a lens
    # missing from inventory, and an already-VERIFIED ticket (out of scope: no row)
    {"id": "FIX-ghost-001", "lens": "ghost", "severity": "low", "title": "Escape doesn't close the 'Map' dialog", "repro_steps": ["Click 'Map'", "Press Escape"],
     "expected": "closes", "actual": "stays open", "evidence_path": "x", "suspected_area": "x", "status": "FIXED_PENDING_VERIFY", "ts": "x"},
    {"id": "FIX-nolens-001", "lens": "nolens", "severity": "low", "title": "Tab 'Feed' errors", "repro_steps": ["Click 'Feed'"],
     "expected": "loads", "actual": "error", "evidence_path": "x", "suspected_area": "x", "status": "open", "ts": "x"},
    {"id": "FIX-demo-009", "lens": "demo", "severity": "low", "title": "Old verified ticket", "repro_steps": ["x"],
     "expected": "x", "actual": "x", "evidence_path": "x", "suspected_area": "x", "status": "VERIFIED", "ts": "x"},
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
cfg["records_dir"] = os.path.join(tmp, "records")  # never write the ledger into the source tree
cfg["thresholds"]["lens_budget_s"] = 400
cfgp = os.path.join(tmp, "config.json"); json.dump(cfg, open(cfgp, "w"))

py = sys.executable
def run(*a):
    print("$ walker.py", " ".join(a), flush=True)
    r = subprocess.run([py, os.path.join(WALKER, "walker.py"), "--config", cfgp] + list(a) + (["--no-replay"] if a and a[0] in ("lens", "sweep") else []), capture_output=True, text=True, timeout=900)
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

# --apply-status needs --expect-sha (WALK-01); the fixture /health serves FIXTURE_SHA.
# --walked-run = the lens run above (demo only): chat/ghost tickets are NOT_ATTEMPTED.
run("reverify", "FIX-demo-002", "FIX-demo-003", "FIX-deities-002", "FIX-007", "FIX-ghost-001", "FIX-nolens-001", "FIX-demo-009",
    "--apply-status", "--expect-sha", FIXTURE_SHA, "--walked-run", rd)
runs = sorted(os.listdir(RUNS))
rvd = os.path.join(RUNS, runs[-1])
rv = [json.loads(l) for l in open(os.path.join(rvd, "reverify.jsonl"))]
results["reverify"] = {r["id"]: r["verdict"] for r in rv}
rvby = {r["id"]: r for r in rv}
results["demo003_capped"] = (rvby.get("FIX-demo-003", {}).get("coverage_basis") == "keyword" and rvby["FIX-demo-003"].get("capped") is True
                             and rvby["FIX-demo-003"].get("uncapped_verdict") == "FIXED"
                             and rvby["FIX-demo-003"]["notes"].startswith("no hand-written repro recipe; keyword match only (escape)"))
results["deities_recipe_basis"] = (rvby.get("FIX-deities-002", {}).get("coverage_basis") == "recipe" and rvby["FIX-deities-002"].get("recipe_kind") == "per-ticket")
ledger_p = os.path.join(cfg["records_dir"], "walker.jsonl")
led = [json.loads(l) for l in open(ledger_p)] if os.path.exists(ledger_p) else []
ledst = {r["id"]: r["status"] for r in led}
results["ledger"] = ledst
results["ledger_ok"] = (ledst.get("FIX-demo-002") == "REOPENED" and ledst.get("FIX-deities-002") == "VERIFIED"
                        and "FIX-demo-003" not in ledst and all(r.get("live_sha") == FIXTURE_SHA for r in led))
covp = os.path.join(audit, "reverify_coverage.json")
cov = json.load(open(covp)) if os.path.exists(covp) else {"rows": []}
covby = {r["id"]: r for r in cov["rows"]}
results["coverage_ids"] = sorted(covby)
md = open(os.path.join(audit, "reverify_coverage.md")).read() if os.path.exists(os.path.join(audit, "reverify_coverage.md")) else ""
results["coverage_ok"] = (
    sorted(covby) == sorted(["FIX-demo-002", "FIX-demo-003", "FIX-deities-002", "FIX-007", "FIX-ghost-001", "FIX-nolens-001"])
    and len(cov["rows"]) == len(covby)
    and all(r["reason"] for r in cov["rows"])
    and covby["FIX-ghost-001"]["verdict"] == "NOT_ATTEMPTED" and not covby["FIX-ghost-001"]["attempted"]
    and covby["FIX-ghost-001"]["reason"].startswith("lens not walked this run")
    and covby["FIX-007"]["reason"].startswith("lens not walked this run")
    and covby["FIX-nolens-001"]["verdict"] == "NOT_ATTEMPTED" and covby["FIX-nolens-001"]["reason"].startswith("lens not in inventory")
    and covby["FIX-nolens-001"]["prior_status"] == "OPEN"
    and covby["FIX-demo-003"]["verdict"] == "NEEDS_HUMAN" and covby["FIX-demo-003"]["attempted"]
    and covby["FIX-demo-002"]["verdict"] == "STILL_FAILING" and covby["FIX-deities-002"]["verdict"] == "FIXED"
    and "judge re-verify by the next run's NEEDS_HUMAN queue length" in md.split("## Summary")[0]
    and covby["FIX-demo-003"]["coverage_basis"] == "keyword" and covby["FIX-demo-003"]["reason"].startswith("no hand-written repro recipe; keyword match only (escape)")
    and covby["FIX-deities-002"]["coverage_basis"] == "recipe" and covby["FIX-ghost-001"]["coverage_basis"] == "none"
    and covby["FIX-demo-002"]["coverage_basis"] == "keyword"
    and os.path.exists(os.path.join(rvd, "reverify_coverage.json")))
# --only-lens: an in-scope ticket on another lens is NOT_ATTEMPTED 'excluded by filter';
# FIX-007 without --allow-write stays NEEDS_HUMAN (no send).
run("reverify", "FIX-007", "FIX-demo-001", "--only-lens", "chat")
runs = sorted(os.listdir(RUNS))
cov2 = json.load(open(os.path.join(RUNS, runs[-1], "reverify_coverage.json")))
c2 = {r["id"]: r for r in cov2["rows"]}
results["filter_ok"] = (c2.get("FIX-demo-001", {}).get("verdict") == "NOT_ATTEMPTED" and c2["FIX-demo-001"]["reason"].startswith("excluded by filter")
                        and c2.get("FIX-007", {}).get("verdict") == "NEEDS_HUMAN")
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
      and results["reverify"].get("FIX-demo-002") == "STILL_FAILING" and results["reverify"].get("FIX-demo-003") == "NEEDS_HUMAN"
      and results["reverify"].get("FIX-deities-002") == "FIXED" and "FIX-007" not in results["reverify"]
      and results["demo003_capped"] and results["deities_recipe_basis"] and results["ledger_ok"]
      and results["coverage_ok"] and results["filter_ok"])
print(json.dumps(results, indent=1))
print("SELFTEST", "PASS" if ok else "FAIL", "(tmp audit dir:", tmp, ")")
srv.shutdown()
sys.exit(0 if ok else 1)
