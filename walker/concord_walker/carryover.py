"""ULW C7: NOT_RUN carry-over queue with automatic revisit at run end.

Every check a lens walk marks NOT_RUN enters this queue (deduped by
(slug, check)); at run end the queue drains through a revisit callback —
one fresh attempt per queued check — and whatever is still NOT_RUN stays
queued with its revisit outcome recorded. Nothing is dropped silently:
the queue's full state is written to the run dir as carryover.json, and
every item carries its first reason, its revisit count, and its last
status/reason. The revisit itself is the caller's (walker.py re-walks the
lens with the single phase selected); this module owns the queue, the
dedup, the drain discipline (exactly one revisit per item per drain),
and the record.

Drain order (walk-2 gate receipt §4, founder's numbers, 2026-11-19):
Tier 1 items are revisited FIRST, then Tier 2, then Tier 3, then items
carrying no tier stamp; insertion order is preserved inside each class,
so a queue with no tier stamps drains exactly as it always has. An
item's tier arrives with the check row (add_from_result reads the row's
"tier" key when a producer stamps one; recipes carry tiers per Gate §8).
"""
import json, os


class CarryoverQueue:
    def __init__(self):
        self.items = {}  # (slug, check) -> item dict

    def add(self, slug, check, reason=None, tier=None):
        key = (slug, check)
        if key not in self.items:
            self.items[key] = {"slug": slug, "check": check, "reason": reason, "tier": tier,
                               "revisits": 0, "last_status": "NOT_RUN", "last_reason": reason}
        elif tier is not None and self.items[key].get("tier") is None:
            self.items[key]["tier"] = tier
        return self.items[key]

    def add_from_result(self, res):
        """Queue every NOT_RUN check of one finished LensWalk result."""
        for check, d in (res.get("checks") or {}).items():
            if isinstance(d, dict) and d.get("status") == "NOT_RUN":
                self.add(res.get("slug"), check, d.get("reason"), tier=d.get("tier"))

    def pending(self):
        return [it for it in self.items.values() if it["last_status"] == "NOT_RUN"]

    @staticmethod
    def _tier_rank(item):
        # Tier 1 first (receipt §4); unstamped items last. The sort is
        # stable, so insertion order holds inside each class.
        t = item.get("tier")
        return {1: 0, 2: 1, 3: 2}.get(t, 3) if isinstance(t, int) else 3

    def drain(self, revisit):
        """revisit(item) -> (status, reason). Exactly one revisit per
        pending item, Tier 1 first; an exception in the callback is
        recorded as the item's outcome (ERROR), never propagated and
        never dropped."""
        outcomes = []
        for it in sorted(self.pending(), key=self._tier_rank):
            it["revisits"] += 1
            try:
                status, reason = revisit(it)
            except Exception as e:
                status, reason = "ERROR", "%s: %s" % (type(e).__name__, e)
            it["last_status"], it["last_reason"] = status, reason
            outcomes.append(dict(it))
        return outcomes

    def remaining(self):
        return self.pending()

    def write(self, run_dir):
        path = os.path.join(run_dir, "carryover.json")
        rows = [self.items[k] for k in sorted(self.items)]
        with open(path, "w") as f:
            json.dump({"items": rows, "remaining": len(self.remaining())}, f, indent=1)
        return path
