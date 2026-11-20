#!/usr/bin/env python3
"""SELFTEST C38 — WRITE-OWN profiles for write-skip lenses (ULW C38).

Browser-free: exercises the profile machinery, the Reverifier write-ctx
threading, the clone gate, and the step-decision routing on stubs. The
live firings (a real t2 session; a real clone) are walk-2 desk acts.

Run:  python3 selftest/run_selftest_c38_c42.py
Exit: 0 = all pass. Against a pristine tree (no write_own/clone_legs) the
import fails and the run FAILS — the discrimination control.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

from concord_walker import write_own                     # noqa: E402  (absent on pristine -> FAIL)
from concord_walker.reverify import Reverifier             # noqa: E402

RESULTS = []


def check(name, cond):
    RESULTS.append((name, bool(cond)))
    print("%s %s" % ("PASS" if cond else "FAIL", name))


CFG = {
    "fixture_prefix": "qa-walker",
    "base_url": "https://concord-os.org",
    "write_skip_lenses": ["social", "feed", "marketplace"],
    "admin_lenses": ["admin", "social"],   # social in both: admin must win
    "accounts": {"t1": {}, "t2": {}, "admin": {}},
    "clone": {"base_url": "http://clone.local:5099",
              "health_marker": {"db": "sb38-clone", "env": "clone"}},
    "thresholds": {},
}


class Rec:
    rid = "run-20261119-abcdef"
    run_dir = "/tmp"

    def __init__(self):
        self.fixtures = {}

    def fixture(self, label, lens, state, note=""):
        self.fixtures[label] = {"label": label, "lens": lens, "state": state}


# ---------------------------------------------------------------- C38
check("C38 candidate: write-skip lens qualifies", write_own.is_write_own_candidate(CFG, "feed"))
check("C38 candidate: admin lens never qualifies", not write_own.is_write_own_candidate(CFG, "social"))
check("C38 candidate: non-skip lens does not qualify", not write_own.is_write_own_candidate(CFG, "retail"))

prof = write_own.write_own_profile(CFG, "feed", "run-20261119-abcdef", "FIX-feed-009")
check("C38 profile account is t2", prof["account"] == "t2")
check("C38 profile stem carries lens + t2", prof["label_base"].startswith("qa-walker-feed-t2-"))

for bad, why in [(("admin lens"), "admin"), (("retail"), "not skip-listed")]:
    try:
        write_own.write_own_profile(CFG, bad[0] if isinstance(bad, tuple) else bad, "r", "T")
        check("C38 profile refused: %s" % why, False)
    except write_own.WriteOwnRefused:
        check("C38 profile refused: %s" % why, True)

cfg_no_t2 = dict(CFG, accounts={"t1": {}})
try:
    write_own.write_own_profile(cfg_no_t2, "feed", "r", "T")
    check("C38 profile refused: no t2 account", False)
except write_own.WriteOwnRefused:
    check("C38 profile refused: no t2 account", True)

rec = Rec()
stem = prof["label_base"]
rec.fixtures = {
    stem: {"label": stem, "lens": "feed", "state": "live"},
    stem + "-2": {"label": stem + "-2", "lens": "feed", "state": "live"},
    stem + "-gone": {"label": stem + "-gone", "lens": "feed", "state": "deleted"},
    "qa-walker-feed-t1-xxxxxx-y": {"label": "qa-walker-feed-t1-xxxxxx-y", "lens": "feed", "state": "live"},
    "qa-walker-social-t2-xxxxxx-y": {"label": "qa-walker-social-t2-xxxxxx-y", "lens": "social", "state": "live"},
}
own = write_own.own_labels(prof, rec.fixtures)
check("C38 own_labels: only own live t2-stem labels", sorted(own) == sorted([stem, stem + "-2"]))
check("C38 label_is_own: t1 label rejected", not write_own.label_is_own(prof, "qa-walker-feed-t1-xxxxxx-y"))

# Reverifier threading: t2 + write-own on -> ctx; every other shape -> None
inv = [{"slug": "feed"}, {"slug": "retail"}, {"slug": "admin"}]
rv = Reverifier(None, CFG, Rec(), None, lambda *a: None, inv,
                allow_write=True, allow_write_own=True)
t = {"lens": "feed", "id": "FIX-feed-009"}
ctx = rv._write_ctx(t, "t2", False, True)
check("C38 _write_ctx: t2 write-own ctx issued", bool(ctx) and ctx.get("write_own") and ctx.get("account") == "t2" and ctx.get("write_skip") is False)
check("C38 _write_ctx: t1 session gets NO write-own ctx", rv._write_ctx(t, "t1", False, True) is None)
rv_off = Reverifier(None, CFG, Rec(), None, lambda *a: None, inv, allow_write=True, allow_write_own=False)
check("C38 _write_ctx: flag off -> None on skip lens", rv_off._write_ctx(t, "t2", False, True) is None)
check("C38 _write_ctx: admin never gets a ctx", rv._write_ctx({"lens": "admin", "id": "X"}, "t2", True, True) is None)


fails = [n for n, c in RESULTS if not c]
print("SELFTEST-C38 %s %d/%d" % ("PASS" if not fails else "FAIL", len(RESULTS) - len(fails), len(RESULTS)))
sys.exit(0 if not fails else 1)
