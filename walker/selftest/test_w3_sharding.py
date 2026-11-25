#!/usr/bin/env python3
"""ULW v3 W3 selftest (B2): sharding for parallel walks (GB-1575).

Covers, without a browser:
  * parse_shard: 'i/N' shapes, bounds, and refusals;
  * partition: determinism (same inventory -> same partition), disjoint,
    complete, balanced within one lens, N=1 identity, and shard_of
    agreeing with partition for every slug;
  * naming: shard run ids and lock names differ per shard and never
    collide with the unsharded run.lock;
  * shard_accounts: configured pair wins, default pair falls back to
    (t1, write_account_key(cfg));
  * merge_shards over synthetic shard run dirs: rows fold by ticket ID,
    an identical duplicate dedupes, a disagreement is EXCLUDED and
    reported as a conflict, manifests fold (totals sum, lenses
    concatenate in shard order, run_id gains -merged), and a lens walked
    by two shards is an overlap with activation_blocked set.

Fail-on-pristine: concord_walker.shard does not exist pre-W3 (ImportError).
"""
import json, os, sys, tempfile

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from concord_walker.shard import (parse_shard, partition, shard_of, shard_run_id,
                                  shard_lock_name, shard_accounts, merge_shards)

FAILS = []
def check(name, cond, detail=""):
    print(("PASS " if cond else "FAIL ") + name + ((" :: " + str(detail)) if (detail and not cond) else ""))
    if not cond:
        FAILS.append(name)

# --- parse_shard ---------------------------------------------------------
check("parse 0/1", parse_shard("0/1") == (0, 1))
check("parse 2/3", parse_shard("2/3") == (2, 3))
for bad in ("3/3", "0/0", "-1/2", "x/y", "1", "1/2/3", "0/65"):
    try:
        parse_shard(bad)
        check("parse refuses %r" % bad, False)
    except ValueError:
        check("parse refuses %r" % bad, True)

# --- partition ------------------------------------------------------------
SLUGS = ["lens-%02d" % k for k in range(23)]  # deliberately unsorted input order below
SHUFFLED = [SLUGS[k] for k in (5, 0, 22, 3, 9, 1, 7, 2, 4, 6, 8, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21)]
for n in (1, 2, 3, 6, 8, 23, 30):
    parts = partition(SHUFFLED, n)
    flat = [s for p in parts for s in p]
    check("n=%d complete" % n, sorted(flat) == SLUGS)
    check("n=%d disjoint" % n, len(flat) == len(set(flat)))
    sizes = [len(p) for p in parts]
    check("n=%d balanced within one" % n, max(sizes) - min(sizes) <= 1, sizes)
    check("n=%d deterministic" % n, partition(list(reversed(SHUFFLED)), n) == parts)
    ok = all(shard_of(s, SHUFFLED, n) == i for i, p in enumerate(parts) for s in p)
    check("n=%d shard_of agrees" % n, ok)
check("n=1 identity", partition(SHUFFLED, 1)[0] == SLUGS)
try:
    shard_of("nope", SLUGS, 2)
    check("shard_of unknown slug raises", False)
except ValueError:
    check("shard_of unknown slug raises", True)

# --- naming ---------------------------------------------------------------
check("run id suffix", shard_run_id("20261120-010203", 1, 3) == "20261120-010203-shard1of3")
locks = {shard_lock_name(i, 3) for i in range(3)}
check("lock names distinct + not run.lock", len(locks) == 3 and "run.lock" not in locks)

# --- accounts ---------------------------------------------------------------
cfg_default = {"accounts": {"t1": {}, "t2": {}}, "write_account": "t2"}
check("accounts default pair", shard_accounts(cfg_default, 0) == ("t1", "t2"))
cfg_pairs = dict(cfg_default, shard_accounts=[{"reader": "t1", "writer": "t2"}, {"reader": "t2", "writer": "t2"}])
check("accounts configured pair wins", shard_accounts(cfg_pairs, 1) == ("t2", "t2"))
check("accounts beyond config falls back", shard_accounts(cfg_pairs, 5) == ("t1", "t2"))

# --- merge_shards -----------------------------------------------------------
def write_shard(dirpath, rid, total, lenses, rows):
    os.makedirs(dirpath)
    with open(os.path.join(dirpath, "ledger.jsonl"), "w") as f:
        for r in rows:
            f.write(json.dumps(r) + "\n")
    manifest = {"run_id": rid, "schema_version": 2, "deploy": {"backend_sha": "abc"}, "total": total,
                "state": "finished", "lenses": [{"slug": s, "status": "walked", "reason": None, "checks_not_run": []} for s in lenses]}
    with open(os.path.join(dirpath, "walk-manifest.json"), "w") as f:
        json.dump(manifest, f)

ROW = lambda i, st="VERIFIED": {"id": i, "status": st, "live_sha": "abc", "recipe": "repro-steps", "evidence_path": "e/" + i, "account": "t2"}
with tempfile.TemporaryDirectory() as td:
    d0, d1, d2 = (os.path.join(td, "r-shard%dof3" % k) for k in range(3))
    write_shard(d0, "r-shard0of3", 2, ["a", "b"], [ROW("T-1"), ROW("T-2")])
    write_shard(d1, "r-shard1of3", 2, ["c", "d"], [ROW("T-3"), ROW("T-2")])            # T-2 identical duplicate -> deduped
    write_shard(d2, "r-shard2of3", 2, ["e", "f"], [ROW("T-4"), ROW("T-1", "OPEN")])    # T-1 disagrees -> conflict, excluded
    out = os.path.join(td, "merged")
    rep = merge_shards([d0, d1, d2], out)
    merged_rows = [json.loads(l) for l in open(os.path.join(out, "walker.jsonl")) if l.strip()]
    ids = sorted(r["id"] for r in merged_rows)
    check("merge keeps uncontested ids once", ids == ["T-2", "T-3", "T-4"], ids)
    check("merge stats", rep["stats"]["input"] == 6 and rep["stats"]["deduped"] == 1 and rep["stats"]["kept"] == 3, rep["stats"])
    check("merge conflict reported", len(rep["conflicts"]) == 1 and rep["conflicts"][0]["id"] == "T-1")
    check("merge no overlap -> not blocked", rep["lens_overlap"] == [] and rep["activation_blocked"] is False)
    folded = json.load(open(os.path.join(out, "walk-manifest.json")))
    check("manifest totals sum", folded["total"] == 6)
    check("manifest lenses concat in shard order", [l["slug"] for l in folded["lenses"]] == ["a", "b", "c", "d", "e", "f"])
    check("manifest run id + deploy", folded["run_id"].endswith("-merged") and folded["deploy_agrees"] is True)

    # overlapping partition (misuse): lens c walked by two shards
    d3 = os.path.join(td, "r-shardX")
    write_shard(d3, "r-shardX", 1, ["c"], [ROW("T-9")])
    out2 = os.path.join(td, "merged2")
    rep2 = merge_shards([d1, d3], out2)
    check("overlap flagged + activation blocked", rep2["lens_overlap"] == ["c"] and rep2["activation_blocked"] is True)

    # a contested id must not re-enter from a later shard
    d4 = os.path.join(td, "r-shardY")
    write_shard(d4, "r-shardY", 1, ["g"], [ROW("T-1")])
    out3 = os.path.join(td, "merged3")
    rep3 = merge_shards([d0, d2, d4], out3)
    ids3 = sorted(json.loads(l)["id"] for l in open(os.path.join(out3, "walker.jsonl")) if l.strip())
    check("contested id stays excluded across folds", "T-1" not in ids3 and rep3["stats"]["conflicts"] == 2, (ids3, rep3["stats"]))

print()
if FAILS:
    print("W3 SHARDING: %d FAILURES: %s" % (len(FAILS), FAILS))
    sys.exit(1)
print("W3 SHARDING: ALL PASS")
