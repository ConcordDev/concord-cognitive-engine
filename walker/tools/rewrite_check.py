#!/usr/bin/env python3
"""Validate a rewrite batch: schema, recomputed orig_hash, rewrites.agree() on every `rewritten` ticket.

  python3 tools/rewrite_check.py --batch 001 [--repo ..] [--sha 272e62f41] [--labels PATH]
  python3 tools/rewrite_check.py --all

Exit 1 on any disagreement among status:"rewritten" (fix the record or downgrade it) or on a batch that is not
exactly the 50 pool tickets (pool = tickets with repro_steps, ordered by id, at the pinned fold sha)."""
import argparse, json, os, sys

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)
from concord_walker import repro, rewrites as R
from concord_walker.fold import extract_from_git

BATCH = 50
DEFAULT_LABELS = os.path.expanduser("~/.zuko/cursor-runs/ulw-rewrite/live_labels_index.json")


def pool_of(repo, sha):
    fold = extract_from_git(repo, sha)
    return sorted((t for t in fold.base.values() if repro.split_steps(t)), key=lambda t: t["id"])


def load_labels(path):
    if not path or not os.path.exists(path):
        return None
    return R.load_live_index(path)[0]


def batch_tickets(pool, n):
    return pool[(n - 1) * BATCH: n * BATCH]


def check_batch(n, pool, labels, rdir=None):
    rdir = rdir or R.DEFAULT_DIR
    path = os.path.join(rdir, "batch-%03d.jsonl" % n)
    want = {t["id"]: t for t in batch_tickets(pool, n)}
    recs = [json.loads(l) for l in open(path, encoding="utf-8") if l.strip()]
    out = {"batch": n, "tickets": len(want), "records": len(recs), "rewritten": 0, "original_sufficient": 0, "human_only": 0, "steps_by_hand": 0, "clauses_by_hand": 0, "needs_human_step": 0, "needs_human_clause": 0, "human_other_notes": 0, "disagreements": [], "problems": [], "human_by_reason": {}}
    seen = set()
    for rw in recs:
        tid = rw.get("ticket_id")
        if tid in seen:
            out["problems"].append("duplicate record %s" % tid)
        seen.add(tid)
        t = want.get(tid)
        if t is None:
            out["problems"].append("%s is not in batch %03d's pool slice" % (tid, n))
            continue
        bad = R.check_schema(rw)
        if bad:
            out["disagreements"].append((tid, [bad]))
            continue
        if rw["orig_hash"] != R.orig_hash(t):
            out["disagreements"].append((tid, ["stale: orig_hash"]))
            continue
        if rw["status"] == "human_only":
            out["human_only"] += 1
            out["human_by_reason"][rw["human_only_reason"]] = out["human_by_reason"].get(rw["human_only_reason"], 0) + 1
            if rw["human_only_reason"] == "other_with_note":
                out["human_other_notes"] += 1
            continue
        ok, why = R.agree(t, rw, labels)
        if ok:
            out["rewritten" if rw["status"] == "rewritten" else "original_sufficient"] += 1
            out["steps_by_hand"] += sum(1 for x in rw["steps"] if x["op"] not in ("keep", "needs_human_step"))
            out["clauses_by_hand"] += sum(1 for c in rw["expected"] if c["kind"] not in ("keep", "needs_human"))
            out["needs_human_step"] += sum(1 for x in rw["steps"] if x["op"] == "needs_human_step")
            out["needs_human_clause"] += sum(1 for c in rw["expected"] if c["kind"] == "needs_human")
        else:
            out["disagreements"].append((tid, why))
    for tid in want:
        if tid not in seen:
            out["problems"].append("no record for %s" % tid)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--batch", type=int)
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--repo", default="..")
    ap.add_argument("--sha", default=R.FOLD_SHA)
    ap.add_argument("--labels", default=DEFAULT_LABELS)
    ap.add_argument("--dir", default=None)
    a = ap.parse_args()
    pool = pool_of(a.repo, a.sha)
    labels = load_labels(a.labels)
    ns = range(1, (len(pool) + BATCH - 1) // BATCH + 1) if a.all else [a.batch]
    bad = 0
    for n in ns:
        r = check_batch(n, pool, labels, a.dir)
        print(json.dumps({k: v for k, v in r.items() if k not in ("disagreements",)}))
        for tid, why in r["disagreements"][:20]:
            print("  DISAGREE %s: %s" % (tid, "; ".join(why)[:300]))
        bad += len(r["disagreements"]) + len(r["problems"])
    print("labels:", "loaded" if labels else "absent (src membership not checked)", "pool=%d" % len(pool))
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
