# Detector debt — triage ledger

Phase-1/2 output of the detector-debt sweep design recorded in the live plan:
**enumerate + document (read-only) → cluster by root cause → fix per cluster**,
never per raw finding. Each entry records what the detector flags, the real
shape of the flagged code, and — critically — **whether the detector's own
source comments already name the pattern as a known false-positive class**.
That check exists because a prior batch burned a whole pass rediscovering,
per-finding, that 6 of 7 `money_txn_untransacted_writes` hits were one class
the detector already documented inline.

**Hard rule, unchanged:** `server/lib/detectors/*`, `audit/detectors/BASELINE.json`,
and `audit/detectors/BUDGET.json` are `guard.mjs`-PROTECTed. A genuine
false positive is resolved by a sanctioned per-file/per-call-site annotation
(`@sync-fs-ok:`, `@sql-loop-ok:`, `@select-star-ok:`) or by a deliberate,
reviewed baseline refresh — **never** by softening a detector.

---

## HIGH tier — 2026-07-24 (V1.5 pre-Wave-4 pass)

Driven by one run of `cd server && node scripts/run-detectors.js --diff --ci`,
which reported **17 new high findings** vs the `2026-07-19` baseline (416
fingerprints). Attribution: **none originate in the V1.5 Frontier-Engine
files** — all 17 sit in code shipped earlier in this session (V1.1 R7, V1.4)
or in long-standing `server.js` helpers. Result after this pass: **17 → 3**.

### Cluster A — `perf_sync_fs_in_handler` × 14 → RESOLVED

One root cause: synchronous `fs` calls inside function bodies. Triaged per
site rather than blanket-annotated, because the honest answer differed:

| Site | Real shape | Disposition |
|---|---|---|
| `server/lib/audit-export.js` ×5 | Reached from a **live HTTP handler** (`GET /api/admin/audit-export`, `server.js:61107`) and reads multi-megabyte artifacts (`audit/macro-depth.json`) — a genuine event-loop stall for every other request while an admin downloads an evidence pack. | **Real fix.** `readJsonArtifact`/`fileFreshness` converted to `fs/promises`; the four section builders and `buildAuditExport` await them (`Promise.all`, so the pack assembles no slower). Awaiting `ENOENT` also replaced the `existsSync`-then-read pair, closing its TOCTOU window. Pinned green by `tests/audit-export.test.js` (8/8). |
| `server/lib/world-calendar.js` ×2 | Lazy, memoized per-world `calendar.json` load (`_calendarCache`) — one small read per world per process, explicitly modeled on `world-flavor.js`'s loops.json load, which already carries the same annotation. | **Annotate** `@sync-fs-ok`. |
| `server/lib/foundry/promote.js` ×1 | `writePromotedContent` writes meta/npcs/factions/lore as one coherent set for a low-frequency, admin-initiated promotion — same shape as the annotated `foundry-publisher.js` publish write. | **Annotate** `@sync-fs-ok`. |
| `server/lib/world-template-pack.js` ×4 | One-shot operator-initiated pack export/import (also a CLI, `scripts/world-template-pack.mjs`); the import path **depends on ordered writes for its rollback** — it tracks each written file so a mid-loop failure unlinks exactly what it created. Same class as the annotated `dtu-portability.js#exportUserCorpus`. | **Annotate** `@sync-fs-ok`. |
| `server/plugins/loader.js` ×2 | `loadPluginsFromDisk` is the boot-time `installed/` scan — single caller on `server.js`'s startup path, and its documented contract is a **synchronous return** (only per-plugin activation is async). Boot ordering, not per-request work. | **Annotate** `@sync-fs-ok`. |

### Cluster B — `money_txn_untransacted_writes` × 2 → documented false positive, NOT fixable in code

`server.js#creditWallet` (74192) and `#debitWallet` (74252) are **named
verbatim** in `money-txn-hygiene-detector.js`'s own header as members of its
documented noise class:

> *"Known precision limit — no control-flow awareness… two write call sites
> that are actually MUTUALLY EXCLUSIVE — an if/else branch, a switch-case, or
> a try/catch fallback pattern ('attempt with ref_id column, catch → retry
> without it')… Real examples found scanning this repo: … `server.js#creditWallet`/
> `debitWallet` (same fallback shape) … Accept these as a known noise class
> rather than a detector bug."*

Confirmed by reading the code: the two writes are the primary
`INSERT … ref_id` and its `catch`-branch fallback for pre-migration DBs —
never sequential. Separately, wrapping them in `db.transaction(...)` **cannot
work** and the source already says why: the wallet balance lives in an
in-memory `Map`, so a SQL transaction could not roll it back. The existing
fix (from the earlier money-txn atomicity pass) is a compensating in-memory
reversal on a genuine ledger-write failure — the correct construction here.

No annotation mechanism exists for this detector. **Disposition: baseline.**

### Cluster C — `authz-coverage` × 1 → reviewed intentional bypass, NOT fixable in code

`/api/welding/portal/` in `WRITE_AUTH_PUBLIC_PATHS` (`server.js:7331`). The
detector's own message states the resolution mechanism: *"intentional bypasses
are baselined; a NEW one needs review."* The review is already written inline
above the array and at the route handlers: an anonymous customer using an
unguessable single-purpose portal token, no Concord account to authenticate
against, the token itself is the access control, scoped server-side to exactly
one estimate/invoice — and it is security-tested end-to-end in
`server/tests/e2e/welding-portal-routes.test.js` (verified present; covers
cross-tenant isolation, invalid-token rejection, and no fabricated payment
success).

It reads as "new" only because the baseline predates the route.
**Disposition: baseline.**

### Residual ratchet state — honest

`--diff --ci` still reports **`new_high_or_critical: 3`** (Clusters B + C). That
is not a hidden failure and not a code defect: all three are triaged above as
documented-false-positive / reviewed-intentional, and for all three the
sanctioned resolution is a **deliberate baseline refresh**, which is its own
reviewed step (tracked as the detector-debt wave's "refresh BASELINE.json"
task) and is a PROTECTed-file edit that must not happen silently as a side
effect of an unrelated commit. Refreshing the baseline is what closes these
three; softening a detector is never the answer.

---

## MEDIUM / LOW tiers — not yet enumerated

The medium (~189–200) and low (~7–8) tiers are the detector-debt wave's own
scope and are deliberately **not** triaged here yet. Note the live counts
diverge sharply from `CLAUDE.md`'s cited `218 total / 27 medium / 15 low` —
that doc claim is stale and needs a rewrite driven by a live run, not by
memory. The largest visible medium cluster is `stale-lying-test` (tests that
regex-match source text instead of exercising behavior), which is a single
root cause and should be dispatched as one cluster, not N findings.
