# ULW v3 W3 — sharding for parallel walks (GB-1575)

**Module:** `concord_walker/shard.py` · **Wiring:** `walker.py` (`sweep --shard`, `merge-shards`) · **Selftest:** `selftest/test_w3_sharding.py` · **Machinery it builds on:** ULW C14 (`concord_walker/merge.py`)

## Running a sharded walk

```sh
# three shards of the same inventory, three processes (or machines):
python3 walker.py sweep --shard 0/3 --from-repo <checkout> --deploy-sha <sha> --expect-sha <sha>
python3 walker.py sweep --shard 1/3 --from-repo <checkout> --deploy-sha <sha> --expect-sha <sha>
python3 walker.py sweep --shard 2/3 --from-repo <checkout> --deploy-sha <sha> --expect-sha <sha>

# afterwards, fold the shard outputs into one manifest + one ledger:
python3 walker.py merge-shards --runs <run>-shard0of3,<run>-shard1of3,<run>-shard2of3 --out <dir>
```

## The partition

The inventory's slugs in canonical (sorted) order are dealt round-robin:
sorted index *k* goes to shard *k % N*. The partition is a pure function
of the inventory — same inventory, same partition, on any machine, with
no coordination between shard processes. Shards are disjoint and complete
by construction, and their sizes differ by at most one lens. (Adding a
lens can re-deal later lenses; a walk's shards are always launched from
the same inventory, so a single walk is never affected.)

## Isolation — no shared writable file

A sharded sweep differs from a plain sweep in exactly four places:

| surface | plain sweep | sharded sweep |
|---|---|---|
| run id / run dir | `<rid>` | `<rid>-shard<i>of<N>` (its own dir) |
| run lock | `runs/run.lock` | `runs/run-shard<i>of<N>.lock` |
| verdict ledger | shared `records/walker.jsonl` | `<run dir>/ledger.jsonl` |
| accounts | reader `t1`, writer `write_account` | `shard_accounts[i]` when configured, else the same default pair |

Two shards therefore share no writable file; the no-shared-lock-collisions
requirement holds by construction rather than by locking discipline. The
unsharded path is byte-for-byte the old behaviour.

## Accounts

`config.json` may carry `shard_accounts`: a list of `{reader, writer}`
pairs by shard index (empty in the shipped config). A shard without a
configured pair falls back to the default pair — reader `t1`, writer =
`write_account_key(cfg)`. Which account is the writer is the arming
config's ruling (GB-1561: t2), never hardcoded here. Targets from the work
order: 2–3 shards on the Mac, 6–8 remote — remote shards need their
account pairs configured (or the fallback pair's sessions saved) on the
host that runs them.

## The merge step

`merge-shards` folds each shard run dir's `ledger.jsonl` strictly by
ticket ID through the C14 machinery and folds the manifests:

- an ID seen once passes through; an identical duplicate dedupes;
- an ID whose rows **disagree** on a deciding field is a CONFLICT —
  excluded from the merged ledger entire and listed in
  `merge-report.json` (a contested ID cannot re-enter from a later
  shard; the fold carries the contested set across shards);
- the folded `walk-manifest.json` concatenates lenses in shard order,
  sums totals, and records whether the shards agree on the deploy stamp
  (`deploy_agrees`; the stamp itself is kept only when they agree);
- a lens walked by two shards is an **overlap** — reported, with
  `activation_blocked: true` in the report (the C14 / Gate §6 contract).

Outputs land in `--out`: `walker.jsonl`, `walk-manifest.json`,
`merge-report.json`.

## Limits

- Sharding splits the *sweep*; `reverify` keeps the single shared lock
  and ledger, as before.
- `--resume` with `--shard` resumes the run id as given (the caller names
  the shard's run id, suffix included).
- Cross-shard lens overlap cannot happen from the partition itself; the
  merge's overlap report exists for hand-assembled or misconfigured runs.
