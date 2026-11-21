#!/usr/bin/env python3
"""ULW C40 self-test (seat B6): the UPGRADE-PLAN §6 click deny list, everywhere.

No browser: the pins are policy pins —
  * every §6 money verb (transfer, withdraw, payout, mint, stake, tip, gift,
    donate, subscribe, checkout, buy, purchase, pay) is refused by EVERY
    click-decision surface in concord_walker.safety: sweep_decision,
    write_step_decision (read-only AND --allow-write), is_opener_safe and
    is_tab_safe, in bare and phrased control names;
  * the canonical MONEY_VERBS set and the compiled lists agree (a verb added
    to the plan list but missing from a list fails here);
  * benign controls are NOT collateral: a plain export opener, a compute
    verb on a writable lens, and an ordinary tab still pass their surfaces.

The pristine control is the pre-C40 safety.py: SWEEP_DENY carried only 6 of
the 13 verbs (the sweep clicked past tip/stake/donate/subscribe/checkout/
gift/payout names), HARD_DENY missed payout + gift, WRITE_NEVER missed gift,
and is_tab_safe consulted no money list at all.
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
WALKER = os.path.dirname(HERE)
sys.path.insert(0, WALKER)

from concord_walker import safety

VERBS = ["transfer", "withdraw", "payout", "mint", "stake", "tip", "gift",
         "donate", "subscribe", "checkout", "buy", "purchase", "pay"]

# Bare names and realistic phrasings a lens could put on a button.
NAMES = []
for v in VERBS:
    NAMES.append(v.capitalize())
    NAMES.append("%s now" % v.capitalize())
    NAMES.append("%s funds" % v.capitalize())


def t_canonical_set():
    assert tuple(VERBS) == safety.MONEY_VERBS, safety.MONEY_VERBS
    for v in VERBS:
        assert safety.money_deny(v), v
        assert safety.money_deny("Please %s today" % v), v


def t_lists_carry_every_verb():
    for v in VERBS:
        assert safety.HARD_DENY.search(v), ("HARD_DENY", v)
        assert safety.SWEEP_DENY.search(v), ("SWEEP_DENY", v)
        assert safety.WRITE_NEVER.search(v), ("WRITE_NEVER", v)


def t_sweep_refuses():
    for name in NAMES:
        ok, reason = safety.sweep_decision(name)
        assert not ok, (name, reason)
        ok2, _ = safety.sweep_decision(name, admin=True)
        assert not ok2, (name, "admin")


def t_write_step_refuses():
    for name in NAMES:
        allowed, reason, kind = safety.write_step_decision(name)
        assert not allowed, (name, reason, kind)
        allowed2, reason2, _ = safety.write_step_decision(
            name, allow_write=True, fixture_labels=("qa-walker-x-tw-abc",))
        assert not allowed2, (name, reason2, "allow_write must not rescue a money verb")


def t_opener_and_tab_refuse():
    for v in VERBS:
        assert not safety.is_opener_safe("Export %s history" % v), v
        assert not safety.is_tab_safe("%s" % v.capitalize()), v
        assert not safety.is_tab_safe("%s settings" % v.capitalize()), v


def t_benign_controls_survive():
    # the deny list must not eat the walker's ordinary vocabulary
    assert safety.is_opener_safe("Export CSV")
    assert safety.is_opener_safe("Download CSV")
    assert safety.is_tab_safe("Overview")
    assert safety.is_tab_safe("Activity")
    ok, _ = safety.sweep_decision("Calculate")
    assert ok, "compute verb on a writable lens stays clickable"
    ok, _ = safety.sweep_decision("View details")
    assert ok
    allowed, _, kind = safety.write_step_decision("Calculate")
    assert allowed and kind == "read"
    # words that merely CONTAIN a verb's letters are not the verb
    assert not safety.money_deny("Display settings")
    assert not safety.money_deny("Gifted students roster")  # \bgift\b, not 'gifted'
    assert safety.is_opener_safe("Export gifted roster")


def t_open_only_overlays():
    # GB-1581 item 3a: Share / Publish / Export / Download openers may be
    # OPENED for the Escape check (open, then Escape, no submit) ...
    for name in ("Share & Publish", "Share", "Publish", "Export", "Export CSV", "Download CSV"):
        assert safety.is_open_only_safe(name), name
    # ... while their ACTIONS stay refused everywhere, exactly as before
    for name in ("Share & Publish", "Publish", "Share"):
        allowed, _, _ = safety.write_step_decision(name, allow_write=True,
                                                   fixture_labels=("qa-walker-x-tw-abc",))
        assert not allowed, (name, "open-only must never become a write step")
    # money / payment / bulk-global qualifiers refuse even the open, and a
    # surviving HARD_DENY verb refuses too ("report" the verb, as in the
    # export phase's is_export_safe — a "Download report" stays closed)
    for name in ("Share payment link", "Export all users", "Publish to everyone",
                 "Share billing details", "Download backup", "Export pay history",
                 "Download report"):
        assert not safety.is_open_only_safe(name), name
    # admin lenses stay look-only; ordinary controls are not open-only openers
    assert not safety.is_open_only_safe("Share & Publish", admin=True)
    assert not safety.is_open_only_safe("Settings")
    assert not safety.is_open_only_safe("Create share")


def main():
    tests = [t_canonical_set, t_lists_carry_every_verb, t_sweep_refuses,
             t_write_step_refuses, t_opener_and_tab_refuse, t_benign_controls_survive,
             t_open_only_overlays]
    failed = 0
    for t in tests:
        try:
            t()
            print("PASS", t.__name__)
        except Exception as e:
            failed += 1
            print("FAIL", t.__name__, "->", repr(e)[:240])
    print("test_c40_safety: %d/%d passed" % (len(tests) - failed, len(tests)))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
