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

## MEDIUM / LOW tiers — 2026-07-24

Driven by the SAME single detector run as the high tier above (one
`cd server && node scripts/run-detectors.js`, JSON captured once and analysed
offline — the point of this phase is that fix-dispatches start from computed
context instead of re-running and re-deriving per finding).

**Real totals from that run: 0 critical / 7 high / 196 medium / 8 low / 51 info.**
Ten detectors account for all 204 medium+low; five account for 184 of the 196
medium. `info` is excluded by design — it is dominated by `macro-usage` runtime
telemetry, which is not a defect signal and varies run-to-run.

| Count | Sev | Detector | Bucket |
|---:|---|---|---|
| 47 | medium | `stale-lying-test` | (b) one root cause |
| 41 | medium | `ux-a11y-button-no-label` | (b) one root cause |
| 35 | medium | `frontend-fake-data` | (a)+(c) split — see below |
| 34 | medium | `dead-event-listener` | (b)+(c) split |
| 27 | medium | `frontend-unsafe-chain` | (b) one root cause |
| 8 | medium | `env-config-drift` | (c) mixed, small |
| 6 | low | `performance-hotspot` (`SELECT *`) | (a) annotation available |
| 3 | medium | `stale-code` | (a) likely migration artifacts |
| 2 | low | `fake-data` (TODO markers) | (c) trivial |
| 1 | medium | `command-injection` | (c) real, but PROTECTED path |

### (b) One root cause each — dispatch as a single unit, not N findings

- **`stale-lying-test` (47).** Tests that regex/substring-match source text
  instead of exercising behavior, so they cannot fail when the behavior breaks.
  Prior batches (DET-A, DET-B) established the conversion pattern: import the
  real function and invoke it with spies, or render + `fireEvent` + assert.
  Never rename a title to dodge the detector.
- **`ux-a11y-button-no-label` (41).** Icon-only `<button>`s with no accessible
  name. Mechanical, and a real accessibility win rather than lint appeasement.
  Heaviest: `custom/DataUtilities.tsx` (6), `privacy/DpoStudioPanel.tsx` (5),
  `bio/BioResearchPanel.tsx` (3), `meta/DevPortal.tsx` (3).
- **`frontend-unsafe-chain` (27).** Nested access 2+ levels deep with no guard.
  The detector's own message names the precedent: the 2026-07-05 `/api/lens/run`
  envelope audit, 48+ real instances fixed in `db1a0a75`/`61122eef`. Same fix
  pattern applies. Heaviest: `mentorship/MentorshipSessionsPanel.tsx` (4).

### (a)/(c) split — `frontend-fake-data` (35), needs per-finding judgment

The detector flags "hardcoded array literal rendered via `.map()` with no
data-fetching call in the enclosing scope." That heuristic cannot distinguish
two very different things, and both are present:

- **Static UI configuration** — `TABS` (3 objects), `DESTINATIONS` (3–4),
  `GROUPS` (4). A hardcoded tab strip or nav group is not fabricated data
  presented as live; it is the component's own structure. False-positive class.
- **Real fallback datasets** — e.g. `ANSWERS_FALLBACK` (30 objects, 8 fields).
  A 30-row hand-authored dataset rendered where real data belongs is exactly
  the zero-demo-content violation the detector exists to catch.

`audit/detectors/BUDGET.json` v13's rationale already records a disposition for
this cluster: these are "real per-file hardcoded-array-rendered-as-live-data
flags the Frontend Rebuild Program's per-lens passes are the sanctioned venue
to close, not a one-off fix here." That remains right — a lens's fabricated
data should be replaced during that lens's rebuild, where the real backend
capability is in view. Recommended handling: split the 35 by size/shape, close
the genuine ones through the rebuild program, and leave the static-config ones
documented as the known FP class.

### (b)/(c) split — `dead-event-listener` (34)

Ghost listeners: `addEventListener`/`useEventListener` subscribing to an event
nothing dispatches, so the listener is a no-op. Examples: `anim:active-frame`,
`conkay:dismiss`, `concordia:open-curtain`, `concordia:link-scan-toggle`,
`concordia:open-roguelite-shop`, `concordia:open-size-scaling`. This is the
DET-C class, and the standing rule is honest either way: **wire a real trigger
or retire the listener** — never leave a no-op that implies a feature exists.
Per-item judgment is required (several are "open-panel" HUD listeners whose
trigger was never built), so this is one dispatch with N decisions, not one
mechanical sweep. Use the runtime detector, not raw grep — the shared-const and
subscribe-over-array idioms in this codebase defeat grep, and that has produced
false "dead" conclusions before.

### (a) Low-effort / already-dispositioned

- **`performance-hotspot` `SELECT *` (6, low)** — `domains/admin.js` (3),
  `domains/education.js` (3). The detector supports a sanctioned
  `@select-star-ok: <reason>` per-call-site annotation and deliberately does
  NOT flag pinpoint `WHERE id = ?` lookups; these 6 are full-scan/JOIN shapes.
  Either project explicit columns or annotate with a real reason.
- **`stale-code` (3)** — tables created in migrations but never read outside
  them (`economy_ledger_new` in `379_agent_marathon_governance.js` ×2,
  `372_ledger_staking_types.js` ×1). The `_new` suffix is the signature of a
  table-rebuild migration's temp table, which is correctly never read at
  runtime. Verify and document rather than "fix."
- **`fake-data` (2, low)** — TODO markers in `ui/Skeleton.tsx` and
  `domains/foundry.js`. Trivial: resolve or delete the marker.

### (c) The one that needs a human decision — `command-injection` (1)

`scripts/autoloop/lib.mjs:21` — `run(cmd)` passes a non-literal string to
`execSync`, i.e. a shell-injection sink. Traced: most callers pass literals,
but `scripts/autoloop/guard.mjs:62,64` interpolate a file path taken from
`git diff --name-only`. The path is wrapped with `JSON.stringify`, which
handles spaces — but `$(...)` and backticks **still expand inside double
quotes in bash**, so a file committed with a name like `$(...)` would execute
on the next guard run. Narrow (requires a maliciously-named file to reach the
repo, and this is dev tooling, not production) but genuinely the same class the
detector was added for after a real `execSync` sink reached merge.

**Not fixed, deliberately.** `guard.mjs`'s own PROTECTED list contains
`/^scripts\/autoloop\//` — the entire directory, including both the sink and
its callers. Editing it is the same explicitly-authorized-only action as a
baseline refresh, not something to slip into a sweep. The fix itself is small
when authorized: use `execFileSync` with an argv array at those two call sites
(and read the file with `readFileSync` instead of shelling out to `cat`).

### Recommended fix order

1. `ux-a11y-button-no-label` (41) — unambiguous, mechanical, real user benefit.
2. `frontend-unsafe-chain` (27) — unambiguous, with a documented precedent fix.
3. `stale-lying-test` (47) — largest, established pattern, but each conversion
   is real work; these tests are currently providing false assurance, which is
   worse than no test.
4. `dead-event-listener` (34) — per-item judgment.
5. The small buckets, then `frontend-fake-data` through the rebuild program.
