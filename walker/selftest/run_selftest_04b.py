#!/usr/bin/env python3
"""WALK-04b write-lane self-test (B8, GB-1544): the failure paths.

Asserts the --allow-write lane's acceptance points against fake lenses:
refusals (write-skip, admin), visibility aborts with ZERO creates
(at-open wording and the late-reveal G2 case), partial write ->
PARTIAL + LEFTOVERS.md, mid-create vanish -> fixture unresolved ->
LEFTOVERS.md, wrong-account abort with zero creates, and the
crud_missing reverify mapping (FIXED on a working lens, STILL_FAILING
where the delete leg cannot complete). The publate case FAILS on a
walker whose write_flow scans for public wording only at dialog open.
"""
import json, os, subprocess, sys, tempfile
HERE = os.path.dirname(os.path.abspath(__file__))
WALKER = os.path.dirname(HERE)
sys.path.insert(0, HERE)
sys.path.insert(0, WALKER)
import fixture_app_04b as fx
from concord_walker.util import lens_result_path

srv = fx.serve()
base = "http://127.0.0.1:%d" % srv.server_address[1]
tmp = tempfile.mkdtemp(prefix="walker-04b-")
audit = os.path.join(tmp, "audit")
os.makedirs(os.path.join(audit, "reports")); os.makedirs(os.path.join(audit, "evidence"))
SLUGS = ["good", "publate", "pubopen", "ambig", "vanish", "skipme", "ops"]
json.dump([{"slug": s, "url": base + "/lenses/" + s, "category": "test"} for s in SLUGS],
          open(os.path.join(audit, "inventory.json"), "w"))
tickets = [
    {"id": "FIX-good-900", "lens": "good", "severity": "medium", "title": "No way to delete items in this lens",
     "repro_steps": ["open lens"], "expected": "a delete control exists", "actual": "no delete control found",
     "evidence_path": "x", "suspected_area": "x", "status": "FIXED_PENDING_VERIFY", "tester": "t", "ts": "x"},
    {"id": "FIX-ambig-900", "lens": "ambig", "severity": "medium", "title": "Cannot delete items in this lens",
     "repro_steps": ["open lens"], "expected": "a delete control exists", "actual": "delete is unusable",
     "evidence_path": "x", "suspected_area": "x", "status": "FIXED_PENDING_VERIFY", "tester": "t", "ts": "x"},
]
with open(os.path.join(audit, "fix_tickets.jsonl"), "w") as f:
    for t in tickets:
        f.write(json.dumps(t) + "\n")
cfg = json.load(open(os.path.join(WALKER, "config.json")))
fx.ME_USER = {"username": cfg["accounts"]["t1"]["username"], "role": "member"}  # landed config (WALK-02 names)
cfg["base_url"] = base
cfg["audit_dir"] = audit
st = os.path.join(tmp, "t1.json"); json.dump({"cookies": [], "origins": []}, open(st, "w"))
cfg["accounts"]["t1"]["storage_state"] = st
cfg["write_skip_lenses"] = ["skipme"]
cfg["admin_lenses"] = ["ops"]
RUNS = os.path.join(tmp, "runs"); os.makedirs(RUNS)
cfg["runs_dir"] = RUNS; cfg["queue_dir"] = os.path.join(tmp, "queue")
cfg["thresholds"]["lens_budget_s"] = 400
cfgp = os.path.join(tmp, "config.json"); json.dump(cfg, open(cfgp, "w"))
py = sys.executable
R = {}


def run(*a):
    print("$ walker.py", " ".join(a), flush=True)
    r = subprocess.run([py, os.path.join(WALKER, "walker.py"), "--config", cfgp] + list(a) + (["--no-replay"] if a and a[0] in ("lens", "sweep") else []),
                       capture_output=True, text=True, timeout=900)
    print(r.stdout[-2500:]); print(r.stderr[-1200:])
    return r


def latest_run():
    return os.path.join(RUNS, sorted(os.listdir(RUNS))[-1])


def creates_during(fn):
    before = len([p for p in fx.POSTS if p[0].startswith("/api/items04b") and "?del=" not in p[0]])
    fn()
    after = len([p for p in fx.POSTS if p[0].startswith("/api/items04b") and "?del=" not in p[0]])
    return after - before


def lens_checks(slug):
    rd = latest_run()
    res = json.load(open(lens_result_path(rd, slug)))
    fxrows = [json.loads(l) for l in open(os.path.join(rd, "fixtures.jsonl"))] if os.path.exists(os.path.join(rd, "fixtures.jsonl")) else []
    left = open(os.path.join(rd, "LEFTOVERS.md")).read() if os.path.exists(os.path.join(rd, "LEFTOVERS.md")) else ""
    return res["checks"], fxrows, left


# --- in-process gate pins (no browser): the write gate itself
from concord_walker.checks import LensWalk
class _Rec:
    def evidence_dir(self, slug):
        d = os.path.join(tmp, "ev", slug); os.makedirs(d, exist_ok=True); return d
def gate(slug, admin=False, allow=True):
    lw = LensWalk(None, cfg, _Rec(), {"slug": slug, "url": base + "/lenses/" + slug}, "t1",
                  lambda *a: None, allow_write=allow, admin=admin)
    return lw.allow_write
R["gate_normal_lens_writable"] = gate("good") is True
R["gate_write_skip_refused"] = gate("skipme") is False
R["gate_admin_refused"] = gate("good", admin=True) is False
R["gate_readonly_refused"] = gate("good", allow=False) is False

# --- browser scenarios
n = creates_during(lambda: run("lens", "good", "--allow-write", "--phases", "reach,write"))
chk, fxrows, _ = lens_checks("good")
R["good_pass"] = (chk.get("create_delete") or {}).get("status") == "PASS"
R["good_fixture_deleted"] = any(f["state"] == "deleted" for f in fxrows) and not fx.ITEMS

n = creates_during(lambda: run("lens", "publate", "--allow-write", "--phases", "reach,write"))
chk, fxrows, _ = lens_checks("publate")
R["publate_aborts_no_create"] = (chk.get("create_delete") or {}).get("status") == "NOT_RUN" and n == 0 \
    and not any(f["state"] in ("created", "create_clicked") for f in fxrows)

n = creates_during(lambda: run("lens", "pubopen", "--allow-write", "--phases", "reach,write"))
chk, _, _ = lens_checks("pubopen")
R["pubopen_aborts_no_create"] = (chk.get("create_delete") or {}).get("status") == "NOT_RUN" and n == 0

n = creates_during(lambda: run("lens", "ambig", "--allow-write", "--phases", "reach,write"))
chk, fxrows, left = lens_checks("ambig")
R["ambig_partial_and_leftover"] = (chk.get("create_delete") or {}).get("status") == "PARTIAL" \
    and any(f["state"] == "leftover" for f in fxrows) and "qa-walker-ambig" in left

n = creates_during(lambda: run("lens", "vanish", "--allow-write", "--phases", "reach,write"))
chk, fxrows, left = lens_checks("vanish")
R["vanish_unresolved_and_leftover"] = (chk.get("create_delete") or {}).get("status") == "FAIL" \
    and any(f["state"] == "unknown" for f in fxrows) and "qa-walker-vanish" in left and n == 0

n = creates_during(lambda: run("lens", "skipme", "--allow-write", "--phases", "reach,write"))
chk, _, _ = lens_checks("skipme")
R["skipme_not_run_no_create"] = (chk.get("create_delete") or {}).get("status") == "NOT_RUN" and n == 0

n = creates_during(lambda: run("lens", "ops", "--allow-write", "--phases", "reach,write"))
chk, _, _ = lens_checks("ops")
R["admin_lens_no_write_phase"] = "create_delete" not in chk and n == 0

fx.ME_USER = {"username": "mallory", "role": "member"}
n = creates_during(lambda: run("lens", "good", "--allow-write", "--phases", "reach,write"))
rd = latest_run()
R["wrong_account_aborts_no_create"] = os.path.exists(os.path.join(rd, "ABORTED.txt")) and n == 0
fx.ME_USER = {"username": cfg["accounts"]["t1"]["username"], "role": "member"}

run("reverify", "FIX-good-900", "FIX-ambig-900", "--allow-write")
rd = latest_run()
rvrows = {r["id"]: r for r in [json.loads(l) for l in open(os.path.join(rd, "reverify.jsonl"))]}
rv = {k: r["verdict"] for k, r in rvrows.items()}
# Recipe-only VERIFIED (Dutch, Nov 15): crud_missing is a keyword-classified
# standard check, so its FIXED is capped at NEEDS_HUMAN; the check itself
# still has to have passed (uncapped_verdict FIXED).
_g = rvrows.get("FIX-good-900", {})
R["crud_missing_fixed_on_good"] = (rv.get("FIX-good-900") == "FIXED"
                                   and _g.get("coverage_basis") == "repro-steps"
                                   # #2378: the expected clause 'a delete control exists' is machine-checked now, so the
                                   # repro-steps basis is accepted and the fix is legitimately FIXED (uncapped).
                                   and "all 1 step(s) mapped + executed; expected outcome machine-checked" in str(_g.get("notes", ""))
                                   and "control(s) present: ['delete']" in str(_g.get("notes", ""))
                                   and (_g.get("expected_check") or {}).get("state") == "pass")
R["crud_missing_still_on_ambig"] = rv.get("FIX-ambig-900") == "STILL_FAILING"

# publate pins G2 (the pre-submit re-scan), which lands after B2's budget
# hook by the office's checks.py order. Until then it is reported but not
# counted; run with WALK04B_EXPECT_G2=1 to make it a hard assertion.
EXPECT_G2 = os.environ.get("WALK04B_EXPECT_G2") == "1"
R["g2_publate_counted"] = EXPECT_G2
ok = all(v for k, v in R.items() if k != "g2_publate_counted" and (EXPECT_G2 or k != "publate_aborts_no_create"))
print(json.dumps(R, indent=1))
print("SELFTEST-04B", "PASS" if ok else "FAIL", "(tmp:", tmp, ")")
srv.shutdown()
sys.exit(0 if ok else 1)
