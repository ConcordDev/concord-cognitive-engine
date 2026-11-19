#!/usr/bin/env python3
"""ULW C8 self-test (seat B6): pre-flight verification (GATE §4).

No browser, no live site: the pins are machinery pins —
  * coverage arithmetic: create/delete coverage is a NUMBER — covered +
    blocked == inventory total, with the write-skip / admin split counted
    honestly (an admin lens also in the skip list is counted once);
  * verify_config on the shipped config publishes the write-skip list in
    the report and names every missing session as a problem (a fresh
    checkout has no auth/*.json — pre-flight must SAY so, by account);
  * verify_config on a fully-provisioned stub config (session files on
    disk, the C28 write account configured) reports ok with zero problems;
  * labelling: the write account's label stem differs from t1's;
  * the live leg reports a failing session by account and never raises —
    pre-flight REPORTS; the caller decides.

The pristine control is the pre-C8 tree: concord_walker.preflight does not
exist there — every pin fails.
"""
import copy
import json
import os
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
WALKER = os.path.dirname(HERE)
sys.path.insert(0, WALKER)

from concord_walker import auth, preflight, util


def shipped_cfg():
    return util.load_config(os.path.join(WALKER, "config.json"))


def shipped_inventory():
    return json.load(open(os.path.join(WALKER, "inventory.json")))


def t_coverage_arithmetic():
    cfg = {"write_skip_lenses": ["a", "b"], "admin_lenses": ["b", "c"]}
    inv = [{"slug": s} for s in ("a", "b", "c", "d", "e")]
    cov = preflight.coverage_numbers(cfg, inv)
    assert cov["inventory_total"] == 5, cov
    assert cov["create_delete_covered"] == 2, cov  # d, e
    assert cov["create_delete_blocked"] == 3, cov  # a, b, c — b counted once
    assert cov["blocked_write_skip"] == 2, cov
    assert cov["blocked_admin"] == 1, cov  # c only; b already in skip
    assert cov["covered_slugs"] == ["d", "e"], cov


def t_coverage_shipped():
    cfg, inv = shipped_cfg(), shipped_inventory()
    cov = preflight.coverage_numbers(cfg, inv)
    assert cov["inventory_total"] == 270, cov["inventory_total"]
    assert cov["create_delete_covered"] + cov["create_delete_blocked"] == 270, cov
    assert cov["create_delete_covered"] > 200, cov  # the day-one number is real, not a stub


def t_verify_shipped_names_missing_sessions():
    cfg, inv = shipped_cfg(), shipped_inventory()
    rep = preflight.verify_config(cfg, inv)
    assert rep["write_skip_lenses"] == sorted(cfg["write_skip_lenses"]), "write-skip list published in the report"
    assert rep["ok"] is False, rep["problems"]
    named = " ".join(rep["problems"])
    for key in ("t1", "t2", "tw"):
        assert key in rep["sessions"], key
        assert rep["sessions"][key]["session_present"] is False, key
    assert "no saved session for t1" in named and "no saved session for t2" in named, rep["problems"]
    assert rep["coverage"]["create_delete_covered"] > 200, rep["coverage"]


def _provisioned_cfg():
    cfg = shipped_cfg()
    tmp = tempfile.mkdtemp(prefix="c8-pf-")
    cfg["_walker_dir"] = tmp
    os.makedirs(os.path.join(tmp, "auth"))
    for key in ("t1", "t2", "tw"):
        with open(os.path.join(tmp, "auth", "%s.json" % key), "w") as f:
            f.write("{}")
    return cfg


def t_verify_provisioned_ok():
    cfg = _provisioned_cfg()
    rep = preflight.verify_config(cfg, shipped_inventory())
    assert rep["problems"] == [], rep["problems"]
    assert rep["ok"] is True
    assert rep["write_account"]["configured"] and rep["write_account"]["session_present"]
    assert rep["labelling"]["stems_differ"] is True, rep["labelling"]


def t_labelling():
    lab = preflight.labelling_proof(shipped_cfg())
    assert lab["fixture_prefix"] == "qa-walker", lab
    assert lab["stems_differ"] is True and lab["problems"] == [], lab
    bare = shipped_cfg()
    bare["fixture_prefix"] = ""
    lab2 = preflight.labelling_proof(bare)
    assert lab2["problems"], lab2


def t_live_leg_reports_not_raises():
    cfg = _provisioned_cfg()
    orig_nc, orig_aa = auth.new_context, auth.assert_account

    class Ctx:
        def close(self):
            pass

    def fake_nc(browser, c, key, vp, **kw):
        return Ctx()

    def fake_aa(ctx, c, key, purpose, log=None):
        if key == "t2":
            raise auth.AccountMismatch("auth/me shows 'someoneelse', expected 'zukoqb'")

    auth.new_context, auth.assert_account = fake_nc, fake_aa
    try:
        problems = preflight.verify_sessions_live(object(), cfg)
    finally:
        auth.new_context, auth.assert_account = orig_nc, orig_aa
    assert len(problems) == 1 and "t2" in problems[0], problems


def main():
    tests = [t_coverage_arithmetic, t_coverage_shipped,
             t_verify_shipped_names_missing_sessions, t_verify_provisioned_ok,
             t_labelling, t_live_leg_reports_not_raises]
    failed = 0
    for t in tests:
        try:
            t()
            print("PASS", t.__name__)
        except Exception as e:
            failed += 1
            print("FAIL", t.__name__, "->", repr(e)[:240])
    print("test_c8_preflight: %d/%d passed" % (len(tests) - failed, len(tests)))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
