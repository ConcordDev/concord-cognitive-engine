# Premap (Wave 0): ledger → registry diff → run diff → packets

Everything here runs on the **box** against the walker selftest fixture or a read-only walk. Nothing runs on the Mac.
Nothing in this folder writes ledger statuses or files tickets.

## 1. Walk with the premap sweep (MST-W0-02/03 + upgrades)

```
walker.py --config <cfg> sweep --premap [--premap-budget-s 240] [--expect-sha <sha>] [--two-account] [--resume <run>]
```

Each lens record (schema v2, see `../SCHEMA-LENS-V2.md`) then holds:

- `controls[]`: every control the walk touched, with its stable id `sid`. A control that was skipped carries the reason.
- The control's calls: method, templated path, status, ms, req/resp bytes, write flag and initiator. A UI-only control is recorded as `no_call`.
- Per-control errors (JS exceptions, React error boundaries, unhandled rejections, failed assets), slow calls (> 3 s), long tasks and freezes (> 1 s), and `broken[]` reasons.
- `endpoints[]`, `actions[]` (POST /api/lens/run {domain, action}) and `premap_findings[]` (fake_success, ownership, js_error, asset_fail, http_5xx/4xx, request_failed, slow_call, freeze).
- `screenshots[]` (failure screenshots only for the sweep).
- `deploy`: backend build sha, frontend build id and walk timestamp. Every row carries `build_sha` and `walked_at`.

The `--two-account` option is opt-in. It replays up to 12 object reads and writes as t2 against t1's object ids, using t2's saved session. It never deletes. Any 2xx it gets is an `ownership` finding.

## 2. Registry snapshot and observed-vs-registered diff (MST-W0-04)

```
tools/action_registry.py (--src <git archive dir> | --repo <checkout>) --sha <full sha> --out <dir>   # actions-<sha12>.json.gz, <=200 KB
tools/unused_actions.py --registry actions-<sha12>.json.gz (--run RUN | --runs DIR) [--out DIR]       # registry-diff.json/.md
```

What the registry covers:

- Every route is scanned from `server/server.js`, `server/routes/**`, `server/domains/**` and every file reachable from server.js by import.
- Lens actions come from `registerLensAction` (including helper wrappers).
- FE callers come from `lensRun`.
- Next.js pages and route handlers are included, with groups, slots and intercepts stripped.

How calls are matched and classed:

- Both sides are normalised (`:id`, `[id]`, `[...slug]`, `{x}`, numeric/uuid/hex segments) and matched by pattern.
- Routers mounted at runtime match by suffix, but only when the route has at least one literal segment.
- Each call gets one class:
  - `real_missing`: no route, and the call got a non-2xx.
  - `matched_failing`: a declared route answered non-2xx.
  - `unmatched_but_ok`: no route, but 2xx. This is noise, never a bug.
  - `matched_ok`: a declared route answered 2xx.
  - `unused_route`: declared but never observed.
- Only `real_missing` and `matched_failing` are defects.

## 3. Run-to-run diff (upgrade 6)

```
tools/run_diff.py --prev RUN_DIR --cur RUN_DIR [--out DIR]     # run-diff.json/.md
```

Each control is keyed by its `sid` and lands in one of: new_broken / fixed / unchanged_broken / unchanged_ok / disappeared.

- A lens that was not walked this time is `lens_not_walked`. It is never counted as "fixed".
- Both runs' build shas are pinned. A missing build sha is flagged.
- The headline `N fixed, N new broken, N still broken` is the progress number.

## 4. Packets (MST-W0-05)

```
tools/pack.py --index /workspace/walker-runs/index/<date>/ (--run RUN | --runs DIR)
              [--registry actions-<sha12>.json.gz] [--fix-tickets audit/fix_tickets.jsonl] [--fold canonical.jsonl]
              [--root-causes audit/root_causes.md] [--prev-run RUN | --prev-runs DIR]
              [--repo <checkout> --fix-commit MST-…=<sha>] [--check-live [--base-url URL]]
              --out /workspace/walker-runs/<run>/packets/ (--ticket ID … | --lens SLUG … | --all) [--link-latest]
```

### Per-lens packet `lens-<slug>.md` (+ `.json`), fixed order

1. **Inputs.** The sha256 (first 8 characters) of each input, plus the LENS-INDEX stub.
2. **Master tickets.** The master tickets touching the lens, plus the `*` cross-cutting ids.
3. **Steps.** **Every** MASTER-V1-FULL step tagged to the lens, plus the `*` step ids.
4. **Root causes.** The root causes touching the lens, as `root_causes.md#signature` pointers.
5. **Walk:**
   - **Build line.** `ran against build X (… CONTAINS / does NOT contain / containment UNKNOWN for fix commit Y)`, plus the run, walked time and schema. ⚠ flags cover a missing or mismatched build stamp, a registry ≠ build mismatch, and `STALE` (from `--check-live`).
   - **Coverage.** Each check's status, which checks did not run, and whether the budget ran out.
   - **Findings** (≤ 15, highest severity first): the open fix tickets and v2 findings, each with a signature and one evidence path.
   - **Premap findings.** Counts by class, plus the rows.
   - **Controls → endpoints → actions** (≤ 25, broken controls first). A v1 record reads `v1 record: no endpoint data`.
   - **Endpoints** (≤ 30).
   - **Registry diff.** Defects only (≤ 30). Noise is shown as a count, and actions with no FE caller are listed.
   - **Run diff** (when `--prev-run*` is given).
   - **Screenshots** (≤ 6). Paths only, failures first.
   - **Open fix tickets.**
6. **Not in this packet.** What was cut, and the full record path.

### Per-ticket packet `packet-<id>.md`

- **Header:** id, title, wave, gate, gate reason, `depends_on` (the wave and gate of each), the fix commit, and input hashes.
- **Sources:** pointers only. Child-map `plan#orig_id`, plus `plan#step` for its V1 steps.
- **Done criteria, recipe hook and backend.**
- **The V1 steps under the ticket.**
- **Per lens:** the same slots as the lens packet.
  - Findings are ★ when their id or signature is in `source_ids`.
  - Controls are narrowed to calls that hit a path or action named in `ticket.backend`, matched by route pattern. If none match, the top controls by request count are shown, and the packet says so.
- **More than 4 lenses:** each lens becomes one row (walked, build, findings, premap counts, registry defects, open tickets) that points to `lens-<slug>.md`.
- **A `*` ticket** gets a shell summary instead of every lens.

### Rules

- **Caps:** 12 KB per ticket packet and 24 KB per lens packet.
  - The lowest sections are trimmed first, each with `+N more (see <path>)`. The trim is also listed under "Not in this packet".
  - If a packet is still over its cap after trimming, the tool exits 3 and records it in `INDEX.json.over_cap`.
- **Determinism:** the output is sorted, with no wall-clock fields. The same inputs give byte-identical md, json and `INDEX.json`.
- **`INDEX.json`:** maps each packet to its byte size, its own sha256 and the hash of every input.
- **Exit codes:**
  - 2: a lens slug is not under `app/lenses` at the registry sha (`hub` is an app route), or a ticket id is unknown. With `--all`, the packets are still written and the slugs are listed.
  - 3: a packet is over its cap.
- **Content:** packets never copy request or response bodies, field values, header values, screenshots or plan prose.

## Selftests (box only)

```
python3 selftest/test_w0_netledger.py   # ledger units (templating, attribution, polling, stable ids)
python3 selftest/test_w0_schema.py      # build stamp states, fix containment, manifest, auth retry, sweep safety
python3 selftest/test_w0_walk.py        # fixture walks: v2 record, ledger, premap sweep, retries, WALK ABORTED/--resume
python3 selftest/test_w0_upgrades.py    # errors, fake_success, two-account ownership, slow/freeze, failure screenshots
python3 selftest/test_w0_registry.py    # normalisation + false-positive control + registry scan
python3 selftest/test_w0_rundiff.py     # run-to-run diff
python3 selftest/test_w0_pack.py        # packer: determinism, caps/trim/exit 3, exit 2, v1, STALE, containment
```
