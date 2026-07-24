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

### Cluster D — the 4 already-baselined `money-txn-hygiene` highs → audited, all class (a)

The three clusters above cover only the findings that were NEW versus the
baseline. A full (non-diff) run reports **7 high findings total** — the 3 above
plus 4 that were already baselined but had never been audited as real (BUDGET
v13's own rationale described them as "the pre-existing 4 real net-new deferred
to a later audit"). That audit has now run. **All four are class (a): the writes
cannot both execute on one path, and every delegate owns its own transaction.**
No code changed.

| Finding | Why it cannot be a sequential-composition bug |
|---|---|
| `economy/ledger.js:51` `recordTransaction()` | The two INSERTs are a try/catch column-fallback: the `catch` re-attempts without `ref_id` **only** when the error message names that column, and re-throws otherwise. SQLite wraps a lone statement in an implicit transaction, so a failed first attempt writes zero rows. `tests/ledger.test.js` already exercises both the fallback and the re-throw path. |
| `economy/stripe.js:188` `handleWebhook()` | The two `economy_withdrawals` writes sit in different `switch` cases (`transfer.paid` vs `transfer.failed`); `event.type` selects exactly one per delivery. The delegate `_reverseFailedWithdrawal` already wraps its status-revert + REVERSAL ledger insert in its own `db.transaction(...)`. |
| `lib/account-lifecycle.js:41` `requestAccountDeletion()` | `if (balance > 0.01)` schedules deletion; the `else` delegates to `executeAccountDeletion`, which wraps all 18 of its steps in one transaction. Strictly either/or. |
| `routes/wagers.js:12` `createWagersRouter()` | The 5 "delegated" writes are spread across 5 **separate Express route handler closures** registered by the factory — they only ever run on distinct HTTP requests, so they are as mutually exclusive as an if/else, just gated by which route fired. The one handler with two delegate calls (`accept`) picks between them with an early `return`. Independently verified: all four delegates (`_executeProposal`, `_executeAcceptance`, `_executeResolution`, `_cancelAndRefund`, `routes/wagers.js:190–222`) wrap their balance mutation + status write in `db.transaction(...)`. |

Verification: the four cited atomicity/fault-injection test files
(`tests/wagers-atomicity.test.js`, `tests/economy/stripe-webhook-atomicity.test.js`,
`tests/account-lifecycle-deletion.test.js`, `tests/ledger.test.js`) were re-run
by the conductor without `--test-force-exit` — **108 pass / 0 fail**.

One optional hardening note, deliberately NOT acted on: `recordTransaction`'s
test asserts the inserted row's `amount` but never `COUNT(*) = 1` after the
fallback path. Mutual exclusivity there is structurally guaranteed by SQLite's
implicit-transaction-per-statement behavior rather than by the test, so this is
a nice-to-have assertion, not a gap covering a suspected bug.

### Residual ratchet state — resolved by authorized baseline refresh

Every one of the **7** high findings is now audited and none is a code defect:
3 new (Clusters B + C) and 4 pre-existing (Cluster D), all documented false
positives or reviewed-intentional bypasses, none with an annotation mechanism
available. The sanctioned resolution for exactly this situation is a
**deliberate baseline refresh**.

**That refresh is authorized** — the repo owner reviewed this triage on
2026-07-24 and directed that the false positives be allowed. Recording it here
because `audit/detectors/BASELINE.json` is `guard.mjs`-PROTECTed: a future
reader finding 7 high findings sitting in the baseline should be able to see
*why* they were accepted and by whose decision, rather than discovering them
silently absorbed. The refresh is still its own scoped commit, never a side
effect of unrelated work, and softening a detector remains not an option.

---

## MEDIUM / LOW tiers — not yet enumerated

The medium (~189–200) and low (~7–8) tiers are the detector-debt wave's own
scope and are deliberately **not** triaged here yet. Note the live counts
diverge sharply from `CLAUDE.md`'s cited `218 total / 27 medium / 15 low` —
that doc claim is stale and needs a rewrite driven by a live run, not by
memory. The largest visible medium cluster is `stale-lying-test` (tests that
regex-match source text instead of exercising behavior), which is a single
root cause and should be dispatched as one cluster, not N findings.
