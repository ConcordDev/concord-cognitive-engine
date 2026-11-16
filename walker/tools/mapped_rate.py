#!/usr/bin/env python3
"""Mapped-step rate of the repro_steps mapper on a fixed, seeded random sample of tickets.

  python3 tools/mapped_rate.py --repo .. --sha 272e62f41 --n 200 --seed 20261116

Reports steps mapped / steps total and tickets with ALL steps mapped / tickets, plus (for the
fully-mapped tickets) how many are blocked by an `expected` clause with no machine-checkable
predicate. Uses repro.expand_step when present (breadcrumb mapper) else the legacy repro.map_step,
so the same script measures BEFORE and AFTER."""
import argparse, json, os, random, sys

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)
from concord_walker import repro
from concord_walker.fold import extract_from_git


def step_mapped(raw, lens):
    fn = getattr(repro, "expand_step", None)
    if fn:
        return bool(fn(raw, lens)["mapped"])
    return bool(repro.map_step(raw, lens)["mapped"])


def measure(tickets, with_reasons=False):
    steps = mapped = full = 0
    blocked_expected = 0
    unmapped = {}
    for t in tickets:
        raws = repro.split_steps(t)
        ok = [step_mapped(r, t.get("lens")) for r in raws]
        steps += len(ok)
        mapped += sum(ok)
        if ok and all(ok):
            full += 1
            exp = repro.check_expected(t.get("expected"), {"controls": [], "texts": [], "dialogs": [], "errors": 0})
            if exp["state"] == "unchecked":
                blocked_expected += 1
        for r, o in zip(raws, ok):
            if not o and with_reasons:
                unmapped[r] = t.get("id")
    return {"tickets": len(tickets), "steps": steps, "steps_mapped": mapped,
            "step_rate": round(mapped / steps, 4) if steps else 0.0,
            "tickets_all_mapped": full, "ticket_rate": round(full / len(tickets), 4) if tickets else 0.0,
            "all_mapped_but_expected_unchecked": blocked_expected, "unmapped_examples": unmapped}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo", default="..")
    ap.add_argument("--sha", default="272e62f41")
    ap.add_argument("--n", type=int, default=200)
    ap.add_argument("--seed", type=int, default=20261116)
    ap.add_argument("--show-unmapped", type=int, default=0)
    a = ap.parse_args()
    fold = extract_from_git(a.repo, a.sha)
    pool = sorted((t for t in fold.base.values() if repro.split_steps(t)), key=lambda t: t["id"])
    sample = random.Random(a.seed).sample(pool, min(a.n, len(pool)))
    print("seed=%d sha=%s pool=%d sample=%d mapper=%s" % (a.seed, a.sha, len(pool), len(sample),
                                                         "expand_step" if hasattr(repro, "expand_step") else "map_step"))
    r = measure(sample, with_reasons=bool(a.show_unmapped))
    ex = r.pop("unmapped_examples")
    print(json.dumps(r, indent=1))
    for raw, tid in list(ex.items())[:a.show_unmapped]:
        print("  UNMAPPED %s: %s" % (tid, raw[:140]))


if __name__ == "__main__":
    main()
