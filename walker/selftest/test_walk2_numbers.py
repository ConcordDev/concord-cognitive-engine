#!/usr/bin/env python3
"""Walk-2 gate receipt §4 numbers pass (B2): the founder's time caps in
their to-the-numbers form — replay 180 s/lens · settle 30 s · per-check
45 s · cut items go to the carry-over queue, never dropped · Tier 1 first
in the drain order.

Covers, without a browser:
  * the walker config of record (walker/config.json) carries the three
    numbers in thresholds;
  * ReplayBudget.from_config on that config yields the 180 s as a per-lens
    FLOOR (GB-1581 item 5c supersedes the flat reading: many-ticket lenses
    scale by the formula past the floor, capped at 900);
  * a LensWalk built on a thresholds dict WITHOUT the keys still
    defaults to settle 30 / check 45 (the numbers are the machinery's
    own, not only the config's);
  * a budget-cut check (NOT_RUN, reason 'lens time budget exceeded')
    surfaces into the C7 carry-over queue via add_from_result — cut,
    never dropped;
  * the drain revisits Tier 1 first, then Tier 2, Tier 3, unstamped,
    insertion order stable inside a class, and a queue with no tier
    stamps drains in plain insertion order (unchanged behaviour);
  * a tier stamped on a check row flows into its queue item.

Fail-on-pristine: the pre-pass config carries settle 60 / check 90 and
no replay_budget_s (ReplayBudget falls back to 60 + 25 x n, cap 900),
the LensWalk fallbacks are 60/90, and CarryoverQueue has no tier
concept — the config, defaults, replay, and drain-order checks all
fail there.
Run: python3 selftest/test_walk2_numbers.py"""
import json, os, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, ".."))
from concord_walker.carryover import CarryoverQueue
from concord_walker.checks import LensWalk
from concord_walker.runstate import ReplayBudget

FAILS = []
def check(name, cond, detail=""):
    print(("PASS " if cond else "FAIL ") + name + ((" :: " + str(detail)) if (detail and not cond) else ""))
    if not cond:
        FAILS.append(name)

# -- the config of record carries the founder's numbers ----------------------
cfg = json.load(open(os.path.join(HERE, "..", "config.json")))
th = cfg["thresholds"]
check("config thresholds: settle_budget_s is 30", th.get("settle_budget_s") == 30, th.get("settle_budget_s"))
check("config thresholds: check_budget_s is 45", th.get("check_budget_s") == 45, th.get("check_budget_s"))
check("config thresholds: replay_budget_s is 180", th.get("replay_budget_s") == 180, th.get("replay_budget_s"))

# -- replay: the configured 180 s is a per-lens FLOOR (GB-1581 item 5c
# supersedes the flat reading of GB-1566 s4: Walk 2's flat 180 starved 501
# tickets in 94 lenses; a many-ticket lens scales by the formula past the
# floor, capped at 900) ------------------------------------------------------
rb = ReplayBudget.from_config(cfg)
check("replay budget: 180 s floor, scaling past it for many-ticket lenses (n=0, 1, 50)",
      rb.for_lens(0) == 180 and rb.for_lens(1) == 180 and rb.for_lens(50) == 900,
      (rb.for_lens(0), rb.for_lens(1), rb.for_lens(50)))

# -- machinery defaults carry the same numbers --------------------------------
class Rec:
    def evidence_dir(self, slug):
        return tempfile.mkdtemp(prefix="ev-")

bare = {"base_url": "https://concord-os.org",
        "thresholds": {"lens_budget_s": 900, "settle_ms_judgment": 15000},
        "admin_lenses": [], "write_skip_lenses": []}
w = LensWalk(None, bare, Rec(), {"slug": "demo", "url": "https://concord-os.org/lenses/demo"}, None, lambda *a: None)
check("LensWalk default settle budget is 30 s", w.settle_budget_s == 30.0, w.settle_budget_s)
check("LensWalk default per-check budget is 45 s", w.check_budget_for("surface") == 45.0, w.check_budget_for("surface"))

# -- a budget-cut check surfaces into the carry-over queue --------------------
res = {"slug": "demo", "checks": {
    "surface": {"status": "PASS"},
    "tabs": {"status": "NOT_RUN", "reason": "lens time budget exceeded"},
    "keyboard": {"status": "NOT_RUN", "reason": "lens time budget exceeded", "tier": 1}}}
q = CarryoverQueue()
q.add_from_result(res)
pend = {(it["slug"], it["check"]) for it in q.pending()}
check("budget-cut checks are queued, the passed check is not",
      pend == {("demo", "tabs"), ("demo", "keyboard")}, pend)
check("the cut reason rides the queue item",
      any(it["check"] == "tabs" and it["reason"] == "lens time budget exceeded" for it in q.pending()))
check("a tier stamped on the check row flows into the item",
      any(it["check"] == "keyboard" and it.get("tier") == 1 for it in q.pending()))

# -- drain order: Tier 1 first, stable inside a class --------------------------
q2 = CarryoverQueue()
q2.add("demo", "unstamped", "r")
q2.add("demo", "tier2", "r", tier=2)
q2.add("demo", "tier1-a", "r", tier=1)
q2.add("demo", "tier3", "r", tier=3)
q2.add("demo", "tier1-b", "r", tier=1)
order = []
q2.drain(lambda it: (order.append(it["check"]), ("PASS", "ok"))[1])
check("drain order is Tier 1, Tier 2, Tier 3, unstamped (stable within tier)",
      order == ["tier1-a", "tier1-b", "tier2", "tier3", "unstamped"], order)

q3 = CarryoverQueue()
for c in ("alpha", "beta", "gamma"):
    q3.add("demo", c, "r")
order3 = []
q3.drain(lambda it: (order3.append(it["check"]), ("PASS", "ok"))[1])
check("an unstamped queue drains in insertion order (unchanged behaviour)",
      order3 == ["alpha", "beta", "gamma"], order3)

print("\n%d failure(s)" % len(FAILS))
sys.exit(1 if FAILS else 0)
