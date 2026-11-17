"""Intended-public allowlist: matcher, shipped config, and the offline re-grade script."""
import json, os, subprocess, sys, tempfile
from concord_walker import intended_public as ip

fails = 0
def check(name, cond, info=None):
    global fails
    print(("PASS " if cond else "FAIL ") + name + ("" if cond else "  %r" % (info,)))
    fails += 0 if cond else 1

E = ip.load()
m = ip.match(E, "GET", "/api/ct/merit/:uuid")
check("shipped allowlist lists GET /api/ct/merit/:userId decided by Dutch 2026-11-16",
      m is not None and m["route"] == "/api/ct/merit/:userId" and m["decided_by"] == "Dutch" and m["date"] == "2026-11-16" and m["reason"], m)
check("matches a raw id too", ip.match(E, "GET", "/api/ct/merit/5f1c2a") is not None)
check("method must match (POST merit not covered)", ip.match(E, "POST", "/api/ct/merit/:uuid") is None)
check("sibling loan-eligibility is NOT public", ip.match(E, "GET", "/api/ct/loan-eligibility/:uuid") is None)
check("no prefix match (/api/ct/merit/:id/history)", ip.match(E, "GET", "/api/ct/merit/:id/history") is None)
check("non-listed route", ip.match(E, "GET", "/api/notes/:uuid") is None)
with tempfile.TemporaryDirectory() as d:
    bad = os.path.join(d, "a.json")
    json.dump({"routes": [{"method": "GET", "route": "/x/:id", "reason": "r", "date": "2026-11-16"}]}, open(bad, "w"))
    try:
        ip.load(bad); ok = False
    except ValueError:
        ok = True
    check("an entry without decided_by is rejected", ok)
    check("missing allowlist file = empty list", ip.load(os.path.join(d, "nope.json")) == [])

    # offline re-grade over a fake run dir: read-only on records, writes one audit file
    run = os.path.join(d, "live", "runs", "20261116-000000"); os.makedirs(run)
    rec = {"slug": "global", "two_account": {"status": "FAIL", "replayed": 3, "ownership_failures": 2, "calls": [
        {"method": "GET", "path": "/api/ct/merit/:uuid", "status": 200, "verdict": "OWNERSHIP_FAIL", "same_as_t1": True},
        {"method": "GET", "path": "/api/notes/:uuid", "status": 200, "verdict": "OWNERSHIP_FAIL", "same_as_t1": True},
        {"method": "GET", "path": "/api/chat/memory/:id", "status": 200, "verdict": "EMPTY"}]},
        "premap_findings": [
        {"class": "ownership", "control_id": "load:page:-", "title": "Second account can read the first account's object: GET /api/ct/merit/:uuid -> 200"},
        {"class": "ownership", "control_id": "load:page:-", "title": "Second account can read the first account's object: GET /api/notes/:uuid -> 200"}]}
    rec2 = {"slug": "hub", "two_account": {"status": "FAIL", "replayed": 1, "ownership_failures": 1, "calls": [
        {"method": "GET", "path": "/api/ct/merit/:uuid", "status": 200, "verdict": "OWNERSHIP_FAIL"}]}, "premap_findings": []}
    for n, r in (("global", rec), ("hub", rec2)):
        json.dump(r, open(os.path.join(run, "lens-%s.json" % n), "w"))
    before = {n: open(os.path.join(run, n)).read() for n in os.listdir(run)}
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    p = subprocess.run([sys.executable, os.path.join(here, "tools", "regrade_intended_public.py"), run], capture_output=True, text=True,
                       env=dict(os.environ, PYTHONPATH=here))
    out = os.path.join(d, "live", "audit", "regraded-20261116-000000.json")
    check("regrade exits 0 and writes audit/regraded-<rid>.json", p.returncode == 0 and os.path.exists(out), p.stdout + p.stderr)
    g = json.load(open(out)) if os.path.exists(out) else {}
    gl = g.get("lenses", {}).get("global", {})
    check("regrade: merit -> PUBLIC_INTENDED, notes stays OWNERSHIP_FAIL",
          {c["path"]: c["verdict"] for c in gl.get("calls", [])} == {"/api/ct/merit/:uuid": "PUBLIC_INTENDED", "/api/notes/:uuid": "OWNERSHIP_FAIL", "/api/chat/memory/:id": "EMPTY"}, gl)
    check("regrade: global still FAIL (notes), 1 failure after", gl.get("status_after") == "FAIL" and gl.get("ownership_failures_after") == 1, gl)
    check("regrade: only the merit ownership finding is suppressed",
          [f["title"] for f in gl.get("suppressed_premap_findings", [])] == ["Second account can read the first account's object: GET /api/ct/merit/:uuid -> 200"], gl)
    hb = g.get("lenses", {}).get("hub", {})
    check("regrade: a lens whose only failure was merit flips FAIL -> PASS", hb.get("status_before") == "FAIL" and hb.get("status_after") == "PASS", hb)
    check("regrade: run dir unchanged (read-only)", before == {n: open(os.path.join(run, n)).read() for n in os.listdir(run)}, sorted(os.listdir(run)))
print("failures:", fails)
sys.exit(1 if fails else 0)
