#!/usr/bin/env python3
"""MST-W0-05 packer tests on a fixture index + fixture runs (no browser, no network).
Run: python3 selftest/test_w0_pack.py"""
import hashlib, io, json, os, shutil, subprocess, sys, tempfile
from contextlib import redirect_stderr, redirect_stdout

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "tools"))
import pack as PK
from concord_walker import lensrecord as LR

FAILS = []


def check(name, cond, extra=""):
    print(("PASS " if cond else "FAIL ") + name + (" " + str(extra)[:600] if extra and not cond else ""))
    if not cond:
        FAILS.append(name)


def jl(p, rows):
    with open(p, "w") as f:
        for r in rows:
            f.write(json.dumps(r) + "\n")


def make_world(build="a" * 40, many_steps=0):
    w = tempfile.mkdtemp(prefix="pack-")
    ix = os.path.join(w, "index")
    os.makedirs(os.path.join(ix, "LENS-INDEX"))
    T = lambda i, lenses, backend, src=(), deps=(): {"id": i, "title": "ticket " + i, "lenses": list(lenses), "backend": list(backend),
                                                     "source_ids": list(src), "depends_on": list(deps), "wave": 1, "gate": "build_gated",
                                                     "gate_reason": "fixture", "done_criteria": "items load 2xx", "walker_recipe_hook": "recipe asserts GET /api/items 2xx",
                                                     "phase": "W1"}
    jl(os.path.join(ix, "MASTER-TICKETS.jsonl"), [
        T("MST-T-01", ["alpha"], ["GET /api/items/:id (server/routes/items.js)"], src=["FIX-alpha-001"], deps=["MST-T-03"]),
        T("MST-T-02", ["ghost"], ["server/domains/ghost.js"]),
        T("MST-T-03", ["*"], ["walker"], src=["escape.sub_lens_expand_menu"]),
        T("MST-T-04", ["beta"], ["nothing matches"]),
        T("MST-T-05", ["alpha", "beta", "ghost"], ["many lenses"]),
    ])
    steps = [{"id": "S-%03d" % i, "title": "alpha step %d with a reasonably long descriptive title to take up space" % i, "plans": ["PLAN.md"],
              "wave": 1, "master_parent": "MST-T-01", "lenses": ["alpha"], "step": i} for i in range(3 + many_steps)]
    steps += [{"id": "S-STAR", "title": "everywhere", "plans": ["PLAN.md"], "wave": 0, "master_parent": "MST-T-03", "lenses": ["*"], "step": 99},
              {"id": "S-BETA", "title": "beta step", "plans": ["B.md"], "wave": 2, "master_parent": "MST-T-04", "lenses": ["beta"], "step": 100}]
    jl(os.path.join(ix, "MASTER-V1-FULL.jsonl"), steps)
    jl(os.path.join(ix, "MASTER-CHILD-MAP.jsonl"), [{"plan": "PLAN.md", "orig_id": "P-1", "master_id": "MST-T-01"}])
    open(os.path.join(ix, "LENS-INDEX.md"), "w").write("# index\n")
    open(os.path.join(ix, "LENS-INDEX", "alpha.md"), "w").write("# alpha stub\n")
    reg = {"sha": "a" * 40, "source": "dir:/fixture", "counts": {},
           "routes": [{"method": "GET", "pattern": "/api/items/:p", "file": "server/routes/items.js", "line": 3, "source": "express", "mount": ""},
                      {"method": "GET", "pattern": "/lenses/alpha", "file": "app/lenses/alpha/page.tsx", "line": 1, "source": "next-page", "mount": ""},
                      {"method": "GET", "pattern": "/lenses/beta", "file": "app/lenses/beta/page.tsx", "line": 1, "source": "next-page", "mount": ""},
                      {"method": "GET", "pattern": "/lenses/ghost", "file": "app/lenses/ghost/page.tsx", "line": 1, "source": "next-page", "mount": ""},
                      {"method": "GET", "pattern": "/lenses/:p", "file": "app/lenses/[slug]/page.tsx", "line": 1, "source": "next-page", "mount": ""}],
           "actions": [{"domain": "alpha", "action": "calc", "file": "server/domains/alpha.js", "line": 1, "receipt_class": "NONE", "fe_callers": [], "fe_caller_count": 0}]}
    regp = os.path.join(w, "actions-aaaaaaaaaaaa.json")
    json.dump(reg, open(regp, "w"))
    audit = os.path.join(w, "audit")
    os.makedirs(os.path.join(audit, "evidence", "beta"))
    open(os.path.join(audit, "evidence", "beta", "b1.png"), "wb").write(b"\x89PNG")
    jl(os.path.join(audit, "fix_tickets.jsonl"), [
        {"id": "FIX-alpha-001", "lens": "alpha", "severity": "medium", "title": "items 500", "status": "OPEN", "evidence_path": "evidence/alpha/a.png", "suspected_area": "api"},
        {"id": "FIX-alpha-002", "lens": "alpha", "severity": "low", "title": "old", "status": "VERIFIED", "evidence_path": "", "suspected_area": "x"},
        {"id": "FIX-beta-001", "lens": "beta", "severity": "low", "title": "Escape doesn't close", "status": "OPEN", "evidence_path": "evidence/beta/b1.png", "suspected_area": "overlay keyboard"},
    ])
    json.dump({"rows": [{"signature": "escape.sub_lens_expand_menu", "title": "Escape", "severity": "low", "count": 1, "lenses": ["beta"],
                         "evidence": ["evidence/beta/b1.png"], "suspected_area": "overlay keyboard", "ticket_ids": ["FIX-beta-001"]}]},
              open(os.path.join(audit, "root_causes.json"), "w"))
    open(os.path.join(audit, "root_causes.md"), "w").write("# rc\n")
    runs = os.path.join(w, "runs")
    r1 = os.path.join(runs, "20261116-090000")
    os.makedirs(r1)
    stamp = {"build_sha": build[:12], "walked_at": "2026-11-16T09:00:00-0500"}
    alpha = {"slug": "alpha", "schema_version": 2, "started": "x",
             "deploy": {"backend_sha": build, "frontend_build_id": "fe-1", "sha_status": "ok", "walked_at": stamp["walked_at"], "base_url": "http://fixture"},
             "checks": {"reach_desktop": {"status": "PASS"}, "export": {"status": "NOT_RUN"}},
             "findings": [{"id": "FIX-alpha-001", "signature": "lens.alpha.api_5xx", "severity": "medium", "check": "console", "title": "items 500",
                           "evidence": ["evidence/alpha/a.png"], "area": "api", **stamp}],
             "controls": [
                 dict({"control_id": "load:page:-", "sid": "c_load", "name": "-", "exercised": True, "effect": "request", "broken": [],
                       "requests": [{"method": "GET", "path": "/api/poll", "status": 200, "n": 9, "ms": 3}], "lens_actions": []}, **stamp),
                 dict({"control_id": "sweep:button:open-item", "sid": "c_open", "name": "Open item", "exercised": True, "effect": "request", "broken": ["http_5xx"],
                       "requests": [{"method": "GET", "path": "/api/items/:uuid", "status": 500, "n": 1, "ms": 40}], "lens_actions": []}, **stamp),
                 dict({"control_id": "sweep:button:ghost", "sid": "c_ghost", "name": "Ghost", "exercised": True, "effect": "request", "broken": ["http_4xx"],
                       "requests": [{"method": "GET", "path": "/api/ghost", "status": 404, "n": 1, "ms": 4}], "lens_actions": []}, **stamp),
                 dict({"control_id": "sweep:button:dyn", "sid": "c_dyn", "name": "Dyn", "exercised": True, "effect": "request", "broken": [],
                       "requests": [{"method": "GET", "path": "/api/dyn", "status": 200, "n": 1, "ms": 4}], "lens_actions": []}, **stamp),
                 dict({"control_id": "sweep:button:delete-all", "sid": "c_del", "name": "Delete all", "exercised": False, "reason": "destructive",
                       "effect": None, "broken": [], "requests": []}, **stamp)],
             "endpoints": [dict({"method": "GET", "path": "/api/items/:uuid", "statuses": {"500": 1}, "n": 1, "write": False, "max_ms": 40}, **stamp),
                           dict({"method": "GET", "path": "/api/poll", "statuses": {"200": 9}, "n": 9, "write": False, "max_ms": 3}, **stamp)],
             "actions": [],
             "premap_findings": [dict({"class": "fake_success", "control_id": "sweep:button:star", "sid": "c_star", "title": "'Star' 2xx but gone after reload",
                                       "evidence": ["evidence/alpha/fail-star.png"]}, **stamp),
                                 dict({"class": "ownership", "control_id": "sweep:button:open-item", "sid": "c_open", "title": "t2 read t1's item",
                                       "evidence": []}, **stamp)],
             "two_account": {"status": "FAIL", "replayed": 2, "ownership_failures": 1, "calls": [{"path": "/api/items/:uuid", "status": 200}]},
             "screenshots": [{"path": "evidence/alpha/fail-star.png", "kind": "failure"}, {"path": "evidence/alpha/init.png", "kind": "initial"}],
             "initial_evidence": "evidence/alpha/init.png"}
    json.dump(alpha, open(os.path.join(r1, "lens-alpha.json"), "w"))
    beta = {"slug": "beta", "started": "2026-11-15 9:00 AM ET", "checks": {"escape_focus": {"status": "FAIL"}, "contrast": {"status": "NOT_RUN"}},
            "console": {"http_5xx": ["503 https://x/api/items/12"]}, "new_tickets": ["FIX-beta-001"], "initial_evidence": "evidence/beta/b1.png"}
    json.dump(beta, open(os.path.join(r1, "lens-beta.json"), "w"))
    return w, ix, regp, audit, runs, r1


def run(argv):
    out, err = io.StringIO(), io.StringIO()
    with redirect_stdout(out), redirect_stderr(err):
        try:
            rc = PK.main(argv)
        except SystemExit as e:
            rc = e.code if isinstance(e.code, int) else 9
    return rc, out.getvalue() + err.getvalue()


def base(w, ix, regp, audit, runs, out):
    return ["--index", ix, "--runs", runs, "--registry", regp, "--fix-tickets", os.path.join(audit, "fix_tickets.jsonl"),
            "--root-causes", os.path.join(audit, "root_causes.md"), "--out", out]


def tree_bytes(d):
    return {f: open(os.path.join(d, f), "rb").read() for f in sorted(os.listdir(d))}


def test_determinism_and_slots():
    w, ix, regp, audit, runs, r1 = make_world()
    o1, o2 = os.path.join(w, "p1"), os.path.join(w, "p2")
    rc1, _ = run(base(w, ix, regp, audit, runs, o1) + ["--all"])
    rc2, _ = run(base(w, ix, regp, audit, runs, o2) + ["--all"])
    check("--all exits 0", rc1 == 0 and rc2 == 0, (rc1, rc2))
    check("same inputs -> byte-identical packets + INDEX", tree_bytes(o1) == tree_bytes(o2))
    files = sorted(os.listdir(o1))
    check("packet per ticket + per lens, md + json", all(x in files for x in ["packet-MST-T-01.md", "packet-MST-T-01.json", "packet-MST-T-03.md",
                                                                             "lens-alpha.md", "lens-beta.json", "lens-ghost.md", "INDEX.json"]), files)
    t1 = open(os.path.join(o1, "packet-MST-T-01.md")).read()
    check("ticket header: wave, gate, depends_on with status", "wave 1 · build_gated" in t1 and "MST-T-03 (wave 1, build_gated" in t1)
    check("source pointers, no plan prose", "PLAN.md#P-1" in t1 and "PLAN.md#S-000" in t1)
    check("build verdict + walked stamp per lens", "ran against build aaaaaaaaaaaa (no fix commit named)" in t1 and "walked 2026-11-16T09:00:00-0500" in t1)
    check("controls narrowed to requests hitting ticket.backend", "requests hitting a path/action named in ticket.backend" in t1
          and "open-item" in t1 and "sweep:button:dyn" not in t1, t1)
    check("relevant finding starred", "★ FIX-alpha-001" in t1)
    check("registry: true 404 real_missing + 500 matched_failing listed; 2xx unmatched only as noise count",
          "real_missing GET /api/ghost 404" in t1 and "matched_failing GET /api/items/:uuid 500" in t1 and "/api/dyn 200" not in t1.split("registry diff")[1].split("screenshots")[0]
          and "noise unmatched_but_ok 2 (not bugs)" in t1, t1)
    check("premap + two-account findings with counts", "premap findings (fake_success 1, ownership 1)" in t1
          and "two-account check: FAIL · replayed 2 · ownership failures 1" in t1, t1)
    check("closed fix tickets left out", "FIX-alpha-002" not in t1)
    ga = open(os.path.join(o1, "packet-MST-T-02.md")).read()
    check("ticket on an unwalked lens gets the not-walked slot", "coverage: lens not walked this run" in ga)
    lb = open(os.path.join(o1, "lens-beta.md")).read()
    check("v1 record packs with 'v1 record: no endpoint data'", "v1 record: no endpoint data" in lb)
    check("v1 record: build flagged unknown, never current", "UNKNOWN build" in lb and "no build stamp (v1 record)" in lb)
    check("evidence resolved against the audit dir (paths only)", os.path.join(audit, "evidence", "beta", "b1.png") in lb)
    check("root causes as pointers", "root_causes.md#escape.sub_lens_expand_menu" in lb)
    la = open(os.path.join(o1, "lens-alpha.md")).read()
    check("lens packet pulls every step tagged to the lens + * step ids", all("S-%03d" % i in la for i in range(3)) and "S-STAR" in la)
    check("lens packet lists its tickets and the * tickets", "MST-T-01" in la and "cross-cutting (`*`): MST-T-03" in la)
    check("skipped control shows its reason", "skipped: destructive" in la)
    check("failure screenshot first", la.index("fail-star.png") < la.index("init.png"))
    star = open(os.path.join(o1, "packet-MST-T-03.md")).read()
    check("* ticket: shell summary, not every lens", "`*` shell summary" in star and "## Lens:" not in star and "escape.sub_lens_expand_menu" in star)
    idx = json.load(open(os.path.join(o1, "INDEX.json")))
    p = idx["packets"]["packet-MST-T-01"]
    check("INDEX maps packet -> input hashes", p["inputs"]["tickets"] and p["inputs"]["record:alpha"] and p["inputs"]["registry"] and p["bytes"] > 0)
    js = json.load(open(os.path.join(o1, "lens-alpha.json")))
    check("json packet mirrors the slots", js["walk"]["build_sha"] == "a" * 12 and js["walk"]["premap_counts"] == {"fake_success": 1, "ownership": 1})
    allt = "".join(open(os.path.join(o1, f)).read() for f in files)
    check("no wall clock / bodies / base64 in packets", "data:image" not in allt and "base64" not in allt and "req_keys" not in allt)
    # an input change changes the hash
    with open(os.path.join(audit, "fix_tickets.jsonl"), "a") as f:
        f.write(json.dumps({"id": "FIX-alpha-003", "lens": "alpha", "severity": "low", "title": "new", "status": "OPEN", "evidence_path": ""}) + "\n")
    o3 = os.path.join(w, "p3")
    run(base(w, ix, regp, audit, runs, o3) + ["--all"])
    i3 = json.load(open(os.path.join(o3, "INDEX.json")))
    check("changed input -> new input hash", i3["packets"]["lens-alpha"]["inputs"]["fix_tickets"] != idx["packets"]["lens-alpha"]["inputs"]["fix_tickets"])


def test_caps_trim_and_overcap():
    w, ix, regp, audit, runs, r1 = make_world(many_steps=400)
    o = os.path.join(w, "p")
    rc, msg = run(base(w, ix, regp, audit, runs, o) + ["--lens", "alpha", "--ticket", "MST-T-01"])
    la = open(os.path.join(o, "lens-alpha.md")).read()
    t1 = open(os.path.join(o, "packet-MST-T-01.md")).read()
    check("big lens packet trimmed under 24 KB", rc == 0 and len(la.encode()) <= 24 * 1024, (rc, len(la.encode())))
    check("big ticket packet trimmed under 12 KB", len(t1.encode()) <= 12 * 1024, len(t1.encode()))
    check("trim is explicit: '+N more (see <path>)' + listed in Not in this packet", "more (see " in la and "trimmed to fit the size cap" in la)
    old = PK.TICKET_CAP
    PK.TICKET_CAP = 300
    try:
        rc, msg = run(base(w, ix, regp, audit, runs, os.path.join(w, "q")) + ["--ticket", "MST-T-01"])
    finally:
        PK.TICKET_CAP = old
    idx = json.load(open(os.path.join(w, "q", "INDEX.json")))
    check("still over the cap after trimming -> exit 3, loud", rc == 3 and "OVER CAP" in msg and idx["over_cap"], (rc, msg))


def test_many_lens_ticket_compact():
    w, ix, regp, audit, runs, r1 = make_world()
    old = PK.MAX_FULL_LENSES
    PK.MAX_FULL_LENSES = 2
    try:
        rc, _ = run(base(w, ix, regp, audit, runs, os.path.join(w, "m")) + ["--ticket", "MST-T-05"])
    finally:
        PK.MAX_FULL_LENSES = old
    t = open(os.path.join(w, "m", "packet-MST-T-05.md")).read()
    js = json.load(open(os.path.join(w, "m", "packet-MST-T-05.json")))
    check("ticket over many lenses: one row per lens, pointer to lens packets", rc == 0 and "## Lenses (3; one row each" in t
          and "| ghost | lens not walked this run" in t and "| alpha | 20261116-090000 v2 | aaaaaaaaaaaa | 1 | fake_success 1, ownership 1 | 2 | 1 |" in t, t)
    check("compact json carries summaries, not full slots", js["lenses"][0]["packet"] == "lens-alpha" and "controls" not in js["lenses"][0])


def test_exit_codes():
    w, ix, regp, audit, runs, r1 = make_world()
    rc, msg = run(base(w, ix, regp, audit, runs, os.path.join(w, "x")) + ["--lens", "nope"])
    check("lens not under app/lenses -> exit 2", rc == 2 and "nope" in msg, (rc, msg))
    rc, msg = run(base(w, ix, regp, audit, runs, os.path.join(w, "x")) + ["--ticket", "MST-NOPE"])
    check("unknown ticket -> exit 2", rc == 2)
    with open(os.path.join(ix, "MASTER-TICKETS.jsonl"), "a") as f:
        f.write(json.dumps({"id": "MST-T-09", "title": "bad", "lenses": ["not-a-lens"], "backend": [], "source_ids": [], "depends_on": [],
                            "wave": 1, "gate": "g", "gate_reason": "", "done_criteria": "", "walker_recipe_hook": ""}) + "\n")
    rc, msg = run(base(w, ix, regp, audit, runs, os.path.join(w, "y")) + ["--all"])
    check("--all with an index slug absent from app/lenses -> packets written, exit 2", rc == 2 and os.path.exists(os.path.join(w, "y", "packet-MST-T-01.md")), (rc, msg))
    try:
        run(["--index", os.path.join(w, "nowhere"), "--runs", runs, "--out", os.path.join(w, "z"), "--all"])
        rc = 0
    except SystemExit:
        rc = 1
    check("missing index refused", not os.path.exists(os.path.join(w, "z", "INDEX.json")))


def test_check_live_and_containment():
    r = tempfile.mkdtemp()
    g = lambda *a: subprocess.run(["git", "-C", r] + list(a), capture_output=True, text=True, check=True).stdout.strip()
    g("init", "-q")
    shas = []
    for i in range(3):
        open(os.path.join(r, "f"), "w").write(str(i))
        g("add", "f")
        g("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "c%d" % i)
        shas.append(g("rev-parse", "HEAD"))
    w, ix, regp, audit, runs, r1 = make_world(build=shas[1])
    o = os.path.join(w, "c")
    rc, _ = run(base(w, ix, regp, audit, runs, o) + ["--repo", r, "--fix-commit", "MST-T-01=" + shas[0], "--fix-commit", "MST-T-04=" + shas[2],
                                                     "--ticket", "MST-T-01", "--ticket", "MST-T-04"])
    t1 = open(os.path.join(o, "packet-MST-T-01.md")).read()
    t4 = open(os.path.join(o, "packet-MST-T-04.md")).read()
    check("build contains the fix commit (merge-base)", "which CONTAINS fix commit %s" % shas[0][:12] in t1, t1[:900])
    check("v1 lens with a fix commit -> UNKNOWN, never assumed", "UNKNOWN build" in t4 and "cannot say whether fix %s" % shas[2][:12] in t4)
    o = os.path.join(w, "c2")
    run(base(w, ix, regp, audit, runs, o) + ["--fix-commit", "MST-T-01=" + shas[2], "--ticket", "MST-T-01"])
    check("no repo -> containment UNKNOWN", "containment UNKNOWN for fix commit" in open(os.path.join(o, "packet-MST-T-01.md")).read())
    o = os.path.join(w, "c3")
    run(base(w, ix, regp, audit, runs, o) + ["--repo", r, "--fix-commit", "MST-T-01=" + shas[2], "--ticket", "MST-T-01"])
    check("build without the fix -> does NOT contain", "which does NOT contain fix commit" in open(os.path.join(o, "packet-MST-T-01.md")).read())
    real = LR.deploy_stamp
    try:
        LR.deploy_stamp = lambda base, **k: {"backend_sha": "f" * 40}
        o = os.path.join(w, "live")
        run(base(w, ix, regp, audit, runs, o) + ["--check-live", "--lens", "alpha", "--lens", "beta"])
        la, lb = open(os.path.join(o, "lens-alpha.md")).read(), open(os.path.join(o, "lens-beta.md")).read()
        check("--check-live: different live sha -> STALE", "STALE: walked %s, live now ffffffffffff" % shas[1][:12] in la)
        check("--check-live: unstamped record -> STALE? unknown", "STALE? record has no build stamp" in lb)
        LR.deploy_stamp = lambda base, **k: {"backend_sha": shas[1]}
        o = os.path.join(w, "live2")
        run(base(w, ix, regp, audit, runs, o) + ["--check-live", "--lens", "alpha"])
        check("--check-live: same sha -> not stale", "STALE" not in open(os.path.join(o, "lens-alpha.md")).read())
        LR.deploy_stamp = lambda base, **k: {"backend_sha": None}
        o = os.path.join(w, "live3")
        run(base(w, ix, regp, audit, runs, o) + ["--check-live", "--lens", "alpha"])
        check("--check-live: live gives no sha -> flagged", "STALE? live /health gave no buildSha" in open(os.path.join(o, "lens-alpha.md")).read())
    finally:
        LR.deploy_stamp = real


def test_run_diff_slot_and_v2_preference():
    w, ix, regp, audit, runs, r1 = make_world()
    prev = os.path.join(w, "prev", "20261115-090000")
    os.makedirs(prev)
    a = json.load(open(os.path.join(r1, "lens-alpha.json")))
    pa = json.loads(json.dumps(a))
    pa["deploy"]["backend_sha"] = "b" * 40
    for c in pa["controls"]:
        if c["sid"] == "c_open":
            c["broken"] = []
        if c["sid"] == "c_dyn":
            c["broken"] = ["js_error"]
    pa["controls"].append({"control_id": "sweep:button:gone", "sid": "c_gone", "name": "Gone", "exercised": True, "broken": [], "requests": []})
    json.dump(pa, open(os.path.join(prev, "lens-alpha.json"), "w"))
    # a newer v1 record in a later run must not shadow the v2 record
    r2 = os.path.join(runs, "20261116-100000")
    os.makedirs(r2)
    json.dump({"slug": "alpha", "checks": {}}, open(os.path.join(r2, "lens-alpha.json"), "w"))
    o = os.path.join(w, "d")
    run(base(w, ix, regp, audit, runs, o) + ["--prev-runs", os.path.join(w, "prev"), "--lens", "alpha"])
    la = open(os.path.join(o, "lens-alpha.md")).read()
    check("v2 record preferred over a newer v1 record", "record schema v2" in la)
    check("run diff slot pinned to both builds with headline", "run diff vs 20261115-090000 (bbbbbbbbbbbb → aaaaaaaaaaaa): 1 fixed · 1 new broken · 1 still broken · 1 gone" in la, la)
    check("run diff rows keyed by stable id", "new_broken Open item (c_open)" in la and "fixed Dyn (c_dyn)" in la)


if __name__ == "__main__":
    for fn in [v for k, v in sorted(globals().items()) if k.startswith("test_")]:
        fn()
    print("\n%d failure(s)" % len(FAILS))
    sys.exit(1 if FAILS else 0)
