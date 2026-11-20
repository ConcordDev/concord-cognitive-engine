"""ULW v3 W3 (GB-1575): sharding for parallel walks.

One walk becomes N walks over a STABLE partition of the inventory, each
with its own run dir, run lock, ledger and account pair, plus a merge step
that folds the shard outputs back into one manifest + one ledger.

  * partition: the inventory's slugs in canonical (sorted) order are dealt
    round-robin — sorted index k goes to shard k % N. The partition is a
    pure function of the inventory: same inventory, same partition, on any
    machine, with no coordination. Shards are disjoint and complete by
    construction, and their sizes differ by at most one lens.
  * run isolation: a sharded sweep's run id gains a -shard<i>of<N> suffix,
    so its run dir (RunRecorder keys dirs by run id) is its own; its run
    lock is run-shard<i>of<N>.lock instead of the shared run.lock; its
    verdict ledger is <run dir>/ledger.jsonl instead of the shared
    records/walker.jsonl. Two shards therefore share NO writable file —
    the no-shared-lock-collisions requirement is met by construction, not
    by locking discipline.
  * accounts: cfg["shard_accounts"] may name a {reader, writer} pair per
    shard index; without one, every shard falls back to the run's default
    pair (reader t1, writer = write_account_key(cfg)) — the GB-1561 ruling
    (t2 the only writer) is whatever the arming config says, never
    hardcoded here.
  * merge: merge_shards() folds the shards' ledgers strictly by ticket ID
    through the C14 machinery (merge.merge_rows — disagreements are
    CONFLICTS, excluded entire and reported) and folds their manifests
    into one (lenses concatenated in shard order, totals summed). Any lens
    walked by two shards is an overlap: reported, and the report's
    activation_blocked is set (the C14 / Gate s.6 contract).

The unsharded path is untouched: no --shard means the plain run id, the
plain run.lock, and the shared records ledger, exactly as before.
"""
import json, os

from .merge import disjoint_lenses, merge_rows, read_jsonl

MAX_SHARDS = 64


def parse_shard(spec):
    """'i/N' -> (i, N), 0-based i. Raises ValueError on any bad shape."""
    try:
        i_s, n_s = str(spec).split("/")
        i, n = int(i_s), int(n_s)
    except Exception:
        raise ValueError("shard must be 'i/N' (0-based i), got %r" % (spec,))
    if n < 1 or n > MAX_SHARDS:
        raise ValueError("shard count N must be 1..%d, got %d" % (MAX_SHARDS, n))
    if i < 0 or i >= n:
        raise ValueError("shard index i must satisfy 0 <= i < N (%d), got %d" % (n, i))
    return i, n


def partition(slugs, n):
    """Deal the canonical (sorted) slug list round-robin into n shards.
    Returns a list of n slug lists: disjoint, complete, sizes within one."""
    ordered = sorted(slugs)
    shards = [[] for _ in range(n)]
    for k, slug in enumerate(ordered):
        shards[k % n].append(slug)
    return shards


def shard_of(slug, slugs, n):
    """The shard index a slug belongs to, under partition()."""
    ordered = sorted(slugs)
    if slug not in ordered:
        raise ValueError("slug %r is not in the inventory" % (slug,))
    return ordered.index(slug) % n


def shard_run_id(rid, i, n):
    return "%s-shard%dof%d" % (rid, i, n)


def shard_lock_name(i, n):
    return "run-shard%dof%d.lock" % (i, n)


def shard_accounts(cfg, i):
    """(reader_key, writer_key) for shard i: cfg['shard_accounts'][i] when
    configured, else the run's default pair (t1, write_account_key(cfg))."""
    pairs = cfg.get("shard_accounts") or []
    if i < len(pairs) and pairs[i]:
        pair = pairs[i]
        return pair.get("reader") or "t1", pair.get("writer")
    from .auth import write_account_key
    return "t1", write_account_key(cfg)


def _read_manifest(run_dir):
    path = os.path.join(run_dir, "walk-manifest.json")
    if not os.path.exists(path):
        return None
    with open(path) as f:
        return json.load(f)


def merge_shards(run_dirs, out_dir):
    """Fold shard run dirs into one manifest + one ledger under out_dir.

    Each run dir contributes its ledger.jsonl rows and its
    walk-manifest.json. Writes out_dir/walker.jsonl (merged rows),
    out_dir/walk-manifest.json (folded manifest) and
    out_dir/merge-report.json (stats, conflicts, lens overlap,
    activation_blocked). Returns the report dict."""
    manifests, lens_sets = [], []
    for d in run_dirs:
        m = _read_manifest(d)
        manifests.append(m)
        lens_sets.append([l["slug"] for l in (m or {}).get("lenses", [])])
    # merge_rows is binary-shaped; fold N shards by merging incrementally.
    # The contested set is carried across folds: an id excluded as a
    # conflict in an early fold must not re-enter from a later shard
    # (merge_rows keeps that memory only within one call).
    merged, conflicts, contested = [], [], set()
    stats = {"input": 0, "kept": 0, "deduped": 0, "conflicts": 0}
    for d in run_dirs:
        rows = read_jsonl(os.path.join(d, "ledger.jsonl"))
        stats["input"] += len(rows)
        clean = []
        for row in rows:
            if row.get("id") in contested:
                conflicts.append({"id": row.get("id"), "reason": "further row for a contested id",
                                  "source": os.path.basename(d.rstrip("/")), "row": row})
            else:
                clean.append(row)
        merged, c2, s2 = merge_rows(merged, clean)
        conflicts.extend(c2)
        contested.update(c["id"] for c in c2 if c.get("id") is not None)
        stats["deduped"] += s2["deduped"]
    stats["kept"] = len(merged)
    stats["conflicts"] = len(conflicts)
    overlap = []
    for a in range(len(lens_sets)):
        for b in range(a + 1, len(lens_sets)):
            overlap.extend(disjoint_lenses(lens_sets[a], lens_sets[b]))
    overlap = sorted(set(overlap))

    os.makedirs(out_dir, exist_ok=True)
    with open(os.path.join(out_dir, "walker.jsonl"), "w") as f:
        for row in merged:
            f.write(json.dumps(row) + "\n")

    present = [m for m in manifests if m]
    base_id = present[0]["run_id"] if present else "merged"
    deploys = {json.dumps(m.get("deploy"), sort_keys=True) for m in present}
    folded = {
        "run_id": base_id + "-merged",
        "schema_version": present[0].get("schema_version") if present else None,
        "deploy": present[0].get("deploy") if len(deploys) == 1 else None,
        "deploy_agrees": len(deploys) <= 1,
        "total": sum(m.get("total", 0) for m in present),
        "state": "merged",
        "shards": [m.get("run_id") for m in present],
        "lenses": [l for m in present for l in m.get("lenses", [])],
        "note": "ULW v3 W3: folded from %d shard manifest(s)" % len(present),
    }
    with open(os.path.join(out_dir, "walk-manifest.json"), "w") as f:
        json.dump(folded, f, indent=1)

    report = {"stats": stats, "conflicts": conflicts, "lens_overlap": overlap,
              "activation_blocked": bool(overlap), "shards": [os.path.basename(d.rstrip("/")) for d in run_dirs]}
    with open(os.path.join(out_dir, "merge-report.json"), "w") as f:
        json.dump(report, f, indent=1)
    return report
