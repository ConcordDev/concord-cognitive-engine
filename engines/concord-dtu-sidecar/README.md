# concord-dtu-sidecar  (Rust)

Read-only reader for the Concord DTU substrate. Serves `dtu.get` / `dtu.list`
(the visibility-filtered locker list) over a Unix socket so that work runs off
the Node event loop.

Concurrency Refactor **Phase 3** — LIVE (opt-in).

## Why

`dtu.list` (reached via `GET /api/dtus`) runs `userVisibleDTUs()` + a
scope/visibility/tier filter over the **entire in-memory DTU set** on every
locker page load — synchronous CPU on the event loop. Under concurrent load (many
users opening the locker) those calls serialise there and stall everything else.
This sidecar does that filter on its own threads.

## What landed

- **Migration `442_dtu_store_visibility_columns.js`** — `dtu_store` gained
  `owner_user_id / visibility / privacy / federation_tier / location_regional /
  location_national / kind` columns + indexes (`idx_dtu_store_owner`,
  `idx_dtu_store_visibility`, `idx_dtu_store_list`). Backfilled from full-object
  `data` blobs.
- **`server/lib/dtu-store.js`** — `persistToSQLite` now always writes `data =
  JSON.stringify(dtu)` (it used to sometimes store only `dtu.body`, which
  `rehydrateFromSQLite` then silently dropped for lack of an `id` — a latent data
  bug this fixes) and populates the 7 columns from the DTU object with the same
  dual camelCase/snake_case reads as `userVisibleDTUs`.
- **`engines/concord-dtu-sidecar/`** (this) — Rust, `rusqlite` (bundled SQLite),
  hand-rolled HTTP over `UnixListener`, N worker threads. Opens the DB
  `SQLITE_OPEN_READ_ONLY` + `PRAGMA query_only(1)` — Node stays the only writer.
- **`server/lib/sidecars/dtu-sidecar-client.js`** + wiring in the `dtu.get` /
  `dtu.list` macros — sidecar first when `CONCORD_DTU_SIDECAR=1` and it's up,
  **fail-soft** to the in-memory path on any transport error.

## Cache

The list filter runs against an in-memory parsed cache, not the DB — that's the
event-loop win (parity with the JS macro filtering `STATE.dtus.values()`). The
refresher is **incremental** (`updated_at >` the newest cached row; in-place
upsert by id so an edited DTU keeps its slot ~ `Map.set`), with a full reconcile
every ~60s and on any row-count drop. Readers take a **pointer-swap snapshot** —
they lock only to clone an `Arc`, never while filtering — so a slow refresh
never stalls a reader. Staleness is bounded by `CONCORD_DTU_SIDECAR_REFRESH_MS`
(default 2500). `dtu.get` reads the DB directly, so it is never stale.

Rows whose `data` isn't a full DTU object with an `id` are skipped — mirrors
`rehydrateFromSQLite`, so the sidecar's corpus is exactly the one Node holds in
memory (old body-only rows are dead weight for both).

## Correctness gate

`proof/run-proof.mjs` boots the real server, seeds a **privacy-filter scenario
matrix** through the real write-through store, then diffs the Rust `list`/`get`
output (id-set **and order**) against the LIVE `dtu.list` / `dtu.get` macro. Matrix
covers system source, private, internal visibility, system scope, shadow
tier/tag, internal `machine.kind`, federation local/global, published/public,
draft, local scope, `mine`, `q`. **9/9 scenarios + 4/4 get-checks match.** Re-run
this on any change to the Rust filter or the DTU schema.

Perf metric that matters: max Node event-loop lag under 60 concurrent list calls
— JS macro filters on the loop (~130–460ms lag depending on box load); the
sidecar filters off-thread (single-digit ms on a quiet box, never worse than the
in-loop path under heavy load). Wall time is dominated by this box's background
load and is noise.

## API (read-only)

| Method | Path | Returns |
|---|---|---|
| GET | `/v1/health` | `{ok, dtuStoreRows, cachedDtus, queryOnly, served}` |
| GET | `/v1/dtu?id=` | `{ok, dtu}` / 404 |
| GET | `/v1/dtus/list?viewer=&scope=&tier=&q=&mine=&limit=&offset=&viewerRegional=&viewerNational=` | `{ok, dtus, total, limit, offset}` |
| GET | `/v1/dtus/recent?limit=&scope=&tier=&source=` | `{ok, count, dtus}` |
| GET | `/v1/wallet/balance?user=` | `{ok, userId, balance, totalCredits, totalDebits}` |
| GET | `/v1/session?tokenHash=` | `{ok, session}` / 404 |

## Build

```sh
cd engines/concord-dtu-sidecar
~/.cargo/bin/cargo build --release   # → target/release/concord-dtu-sidecar
```

Rust 1.98 (rustup, minimal). **Do not add `strip = true`** to the release
profile — on macOS arm64 it removes the ad-hoc code signature and the binary
hangs in dyld (state `UE`, socket never created). If you strip manually, re-sign:
`codesign -s - --force bin/concord-dtu-sidecar`.

## Run (macOS, launchd)

```sh
cp engines/concord-dtu-sidecar/com.concord.dtu-sidecar.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.concord.dtu-sidecar.plist
# then enable the wire on the backend:
#   add  CONCORD_DTU_SIDECAR=1  to com.concord.backend's EnvironmentVariables
#   launchctl bootout + bootstrap com.concord.backend
```

Kill-switch: unset `CONCORD_DTU_SIDECAR` (or set `0`) and restart the backend —
the macros go straight back to the in-memory filter.


## Phase 3b — generalized hot reads (wallet + session)

Same binary / socket. Node opt-in (independent of `CONCORD_DTU_SIDECAR`):

| Env | Effect |
|---|---|
| `CONCORD_WALLET_SIDECAR=1` | `/api/economy/balance` prefers Rust ledger sums (`getBalancePreferSidecar`) |
| `CONCORD_SESSION_SIDECAR=1` | reserved for auth session lookup client (`sessionByTokenHash`) |

Fail-soft: any UDS/JSON error → sync SQLite / in-process path. Proof:
`engines/concord-dtu-sidecar/proof/run-wallet-session-proof.mjs` →
`~/.zuko/remaining-work/concord-wallet-session-sidecar-proof.json`.
