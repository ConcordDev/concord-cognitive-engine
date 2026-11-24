#!/usr/bin/env python3
"""ULW C28 isolation-observer self-test (walk-2 ruling GB-1561 / CB-0887: t2 writes, t1 observes).

No browser. Pins:
  * auth.isolation_observer_key: "t2" by default (pre-ruling behaviour), the configured
    `isolation_observer` when it names an account, "t2" again when it dangles;
  * write_account "t2" + isolation_observer "t1" with saved sessions -> the proof PASSES
    (no problems), distinct_from_observer True, distinct_from_t2 n/a (None);
  * write_account "t2" WITHOUT an observer override -> still REFUSED (backward compatible:
    the default observer is t2 itself);
  * write_account == the configured observer -> REFUSED;
  * a write account whose username equals the observer's -> REFUSED;
  * write_account "t1" is always REFUSED (t1 is the evidence account);
  * live leg (preflight.verify_sessions_live, fake browser): distinct live usernames -> no
    problems; the same live user behind the write account and the observer -> REFUSED.
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


def base_cfg():
    cfg = util.load_config(os.path.join(WALKER, "config.json"))
    tmp = tempfile.mkdtemp(prefix="c28-obs-")
    cfg["accounts"] = {
        "t1": {"username": "qa-reader", "expected_roles": ["member", "user"], "storage_state": os.path.join(tmp, "t1.json")},
        "t2": {"username": "qa-writer", "expected_roles": ["member", "user"], "storage_state": os.path.join(tmp, "t2.json")},
    }
    for a in cfg["accounts"].values():
        json.dump({"cookies": [], "origins": []}, open(a["storage_state"], "w"))
    cfg.pop("isolation_observer", None)
    cfg["write_account"] = "t2"
    return cfg


def t_observer_key():
    cfg = base_cfg()
    assert auth.isolation_observer_key(cfg) == "t2"
    cfg["isolation_observer"] = "t1"
    assert auth.isolation_observer_key(cfg) == "t1"
    cfg["isolation_observer"] = "nope"
    assert auth.isolation_observer_key(cfg) == "t2"


def t_t2_writer_t1_observer_passes():
    cfg = base_cfg()
    cfg["isolation_observer"] = "t1"
    p = auth.write_account_proof(cfg)
    assert p["problems"] == [], p
    assert p["key"] == "t2" and p["observer"] == "t1", p
    assert p["distinct_from_t1"] is True and p["distinct_from_observer"] is True, p
    assert p["distinct_from_t2"] is None, p


def t_t2_writer_default_observer_refused():
    cfg = base_cfg()
    p = auth.write_account_proof(cfg)
    assert any("isolation observer" in x for x in p["problems"]), p


def t_writer_is_configured_observer_refused():
    cfg = base_cfg()
    cfg["isolation_observer"] = "t2"
    p = auth.write_account_proof(cfg)
    assert any("is the isolation observer" in x for x in p["problems"]), p


def t_writer_username_equals_observer_refused():
    cfg = base_cfg()
    cfg["isolation_observer"] = "t1"
    cfg["accounts"]["t2"]["username"] = "qa-reader"
    p = auth.write_account_proof(cfg)
    assert p["distinct_from_observer"] is False, p
    assert any("equals" in x for x in p["problems"]), p


def t_t1_writer_refused():
    cfg = base_cfg()
    cfg["write_account"] = "t1"
    cfg["isolation_observer"] = "t2"
    p = auth.write_account_proof(cfg)
    assert any("equals t1" in x for x in p["problems"]), p


class _Ctx:
    def close(self):
        pass


def _live(cfg, names):
    saved = (auth.new_context, auth.assert_account)
    auth.new_context = lambda b, c, key, vp, **kw: _KeyCtx(key)
    auth.assert_account = lambda ctx, c, key, purpose, log=None: {"ok": True, "username": names[ctx.key], "role": "member"}
    try:
        return preflight.verify_sessions_live(object(), cfg)
    finally:
        auth.new_context, auth.assert_account = saved


class _KeyCtx(_Ctx):
    def __init__(self, key):
        self.key = key


def t_live_distinct_users_pass():
    cfg = base_cfg()
    cfg["isolation_observer"] = "t1"
    probs = _live(cfg, {"t1": "qa-reader", "t2": "qa-writer"})
    assert probs == [], probs


def t_live_same_user_refused():
    cfg = base_cfg()
    cfg["isolation_observer"] = "t1"
    probs = _live(cfg, {"t1": "qa-same", "t2": "qa-same"})
    assert any("same live user" in x for x in probs), probs


def main():
    tests = [t_observer_key, t_t2_writer_t1_observer_passes, t_t2_writer_default_observer_refused,
             t_writer_is_configured_observer_refused, t_writer_username_equals_observer_refused,
             t_t1_writer_refused, t_live_distinct_users_pass, t_live_same_user_refused]
    failed = 0
    for t in tests:
        try:
            t()
            print("PASS", t.__name__)
        except Exception as e:
            failed += 1
            print("FAIL", t.__name__, "->", repr(e)[:240])
    print("test_c28_isolation_observer: %d/%d passed" % (len(tests) - failed, len(tests)))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
