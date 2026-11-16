#!/usr/bin/env python3
"""Upgrade 6 tests: run-to-run diff keyed by stable control id, pinned to both builds.
Run: python3 selftest/test_w0_rundiff.py"""
import json, os, sys, tempfile

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "tools"))
import run_diff as RD

FAILS = []


def check(name, cond, extra=""):
    print(("PASS " if cond else "FAIL ") + name + (" " + str(extra)[:500] if extra and not cond else ""))
    if not cond:
        FAILS.append(name)


def ctl(sid, name, broken=(), exercised=True):
    return {"control_id": "sweep:button:" + name, "sid": sid, "name": name, "exercised": exercised, "broken": list(broken)}


def run(d, slug, controls, sha="1" * 40, v=2, checks=None):
    rec = {"slug": slug, "schema_version": v, "checks": checks or {}}
    if v >= 2:
        rec.update(deploy={"backend_sha": sha}, controls=controls)
    json.dump(rec, open(os.path.join(d, "lens-%s.json" % slug), "w"))


def test_categories():
    p, c = tempfile.mkdtemp(), tempfile.mkdtemp()
    run(p, "chem", [ctl("c_a", "A", ["http_5xx"]), ctl("c_b", "B"), ctl("c_c", "C", ["js_error"]), ctl("c_d", "D"), ctl("c_x", "X", ["slow_call"])], sha="a" * 40)
    # cur: A fixed, B new broken, C still broken, D gone, E new ok, F new broken, X reordered + renamed whitespace (same sid) still broken
    run(c, "chem", [ctl("c_x", "X ", ["slow_call"]), ctl("c_a", "A"), ctl("c_b", "B", ["fake_success"]), ctl("c_c", "C", ["js_error"]),
                    ctl("c_e", "E"), ctl("c_f", "F", ["ownership"]), ctl("c_g", "G", ["http_4xx"], exercised=False)], sha="b" * 40)
    run(p, "hub", [ctl("c_h", "H", ["http_5xx"])], sha="a" * 40)  # not walked in cur
    d = RD.diff(p, c)
    ch = d["lenses"]["chem"]
    cats = {r["sid"]: r["category"] for r in ch["rows"]}
    check("fixed", cats.get("c_a") == "fixed", cats)
    check("new_broken (regressed)", cats.get("c_b") == "new_broken")
    check("unchanged_broken (keyed by sid; reorder/name churn ignored)", cats.get("c_c") == "unchanged_broken" and cats.get("c_x") == "unchanged_broken")
    check("disappeared", cats.get("c_d") == "disappeared")
    check("new control broken counts as new_broken", cats.get("c_f") == "new_broken")
    check("unexercised controls are not judged", "c_g" not in cats)
    check("headline counts", d["headline"]["fixed"] == 1 and d["headline"]["new_broken"] == 2 and d["headline"]["unchanged_broken"] == 2
          and d["headline"]["disappeared"] == 1 and d["headline"]["unchanged_ok"] == 1, d["headline"])
    check("lens not walked now is not 'fixed' or 'disappeared'", d["lenses"]["hub"]["status"] == "lens_not_walked" and d["headline"]["lens_not_walked"] == 1)
    check("both builds pinned + change flagged", ch["prev_build"] == "a" * 12 and ch["cur_build"] == "b" * 12 and ch["build_changed"])
    check("progress line", d["progress"] == "1 fixed, 2 new broken, 2 still broken", d["progress"])


def test_unknown_build_and_v1():
    p, c = tempfile.mkdtemp(), tempfile.mkdtemp()
    run(p, "chem", None, v=1, checks={"escape_focus": {"status": "FAIL"}, "export": {"status": "PASS"}, "contrast": {"status": "NOT_RUN"}})
    run(c, "chem", None, v=1, checks={"escape_focus": {"status": "PASS"}, "export": {"status": "FAIL"}})
    d = RD.diff(p, c)
    ch = d["lenses"]["chem"]
    cats = {r["sid"]: r["category"] for r in ch["rows"]}
    check("v1 checks compared as pseudo-controls", cats == {"check:escape_focus": "fixed", "check:export": "new_broken"}, cats)
    check("missing build stamp is flagged, never assumed", ch["build_flag"] and ch["cur_build"] is None and d["cur_builds"] == [])


def test_cli_and_failure_paths():
    p, c = tempfile.mkdtemp(), tempfile.mkdtemp()
    run(p, "a", [ctl("c_1", "one", ["http_5xx"])])
    run(c, "a", [ctl("c_1", "one")])
    open(os.path.join(c, "lens-bad.json"), "w").write("{not json")
    RD.main(["--prev", p, "--cur", c])
    d = json.load(open(os.path.join(c, "run-diff.json")))
    check("CLI writes json+md; corrupt record skipped", d["headline"]["fixed"] == 1 and os.path.exists(os.path.join(c, "run-diff.md")) and "bad" not in d["lenses"])
    try:
        RD.main(["--prev", "/nonexistent/x", "--cur", c])
        check("missing run dir refused", False)
    except SystemExit:
        check("missing run dir refused", True)
    e = tempfile.mkdtemp()
    d2 = RD.diff(e, e)
    check("empty runs -> zero headline, no crash", sum(d2["headline"].values()) == 0)


if __name__ == "__main__":
    for fn in [v for k, v in sorted(globals().items()) if k.startswith("test_")]:
        fn()
    print("\n%d failure(s)" % len(FAILS))
    sys.exit(1 if FAILS else 0)
