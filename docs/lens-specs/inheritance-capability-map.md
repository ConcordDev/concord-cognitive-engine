# Inheritance — capability map (Wave 3, Frontend Rebuild Program)

Audited 2026-07-10. **Two real, both-wired surfaces share one lens**, and
this is the load-bearing shape of the audit (called out in the domain
file's own header comment):

1. **Estate-planning macros — `server/domains/inheritance.js` (24
   `registerLensAction("inheritance", ...)` handlers).** Beneficiary
   designation, will/directive versioning, asset inventory, executor
   multi-party consent, locked-heir-slot bookkeeping, probate timeline,
   and the heir notification/acceptance loop. In-memory per-user state on
   `globalThis._concordSTATE` (documented in the file header — estate
   planning is inherently per-user, no migration owns these Maps).
2. **Death-derivatives heir-slot market — 3 inline macros in `server.js`
   (`inheritance.open_listing` / `claim_slot` / `list_open`, registered
   at `server.js:76411/76434/76454`).** DB-backed
   (`inheritance_market_listings`): a mentor lists a dying NPC's heir
   slot, a buyer locks it, resolution happens on the NPC's death.

Both are wired into `app/lenses/inheritance/page.tsx`. Repro:
`grep -c 'registerLensAction("inheritance"' server/domains/inheritance.js`
→ `24`; `grep -n 'register("inheritance"' server/server.js` → the 3 inline
market macros. **No macro-shadowing:** the 3 inline `register()` calls use
distinct action names (`open_listing`/`claim_slot`/`list_open`) that do not
collide with any of the 24 `registerLensAction` names, so nothing is
silently overridden at boot.

**Category benchmark.** This lens is judged against **Trust & Will /
FreeWill** (consumer estate-planning apps: beneficiary designation with
share-balancing, versioned will authoring, asset inventory, executor
appointment + acceptance, a probate/settlement timeline) — with a
Concordia-native twist the reference apps have no analog for: the
death-derivatives heir-slot futures market. The bar is "would this hold up
as a standalone estate planner," not "good enough for a game lens."

## Backend surface

**Estate macros (24, all real, in `server/domains/inheritance.js`):**
- Overview + beneficiaries (5): `estate_overview`, `add_beneficiary`,
  `update_beneficiary`, `remove_beneficiary`, `list_beneficiaries`
  (returns `remainderPct` + `balanced` share-total math).
- Wills/directives, versioned (4): `author_will` (supersedes prior active),
  `list_will_versions`, `get_will_version`, `restore_will_version`.
- Asset inventory (3): `add_asset` (fail-closed CC guard `badCc`),
  `remove_asset`, `list_assets` (by-category rollup).
- Executor consent workflow (4): `assign_executor` (pushes an
  `executor_invite` notice when `executorUserId` is given),
  `respond_executor_consent`, `list_executors`, `remove_executor`.
- Heir-slot lock bookkeeping (4): `track_lock`, `amend_lock`, `revoke_lock`
  (returns `refundedCc`), `list_locks` (`escrowedCc` rollup).
- Probate + notices (4): `probate_timeline` (merges will/executor/lock
  events, tone-graded), `notify_heir`, `list_notices`, `respond_notice`.

**Market macros (3, inline in `server.js`, DB-backed):**
`open_listing` (mentor lists a dying NPC's heir slot; fail-closed price
guard `0 ≤ heirSlotPriceCc ≤ 1e6`), `claim_slot` (buyer locks; rejects
self-claim + already-claimed), `list_open`.

**Calling convention (verified against `server.js` dispatch):**
`registerLensAction` handlers receive `(ctx, virtualArtifact, params)` and
return `{ ok, result? , error? }`; `/api/lens/run` applies
`_unwrapLensEnvelope` (strips exactly one `{ok,result}` layer). The
frontend `lensRun` helper then unwraps to the real payload **and correctly
surfaces the wrapped macro's own `ok:false`** — so this lens does **not**
have the fabricated-success envelope bug (the `callX` helper here is the
shared `lensRun`, which reads the terminal `{ok:false, error}` node, not
only the transport envelope). Cross-checked at
`concord-frontend/lib/api/client.ts` (`while ('ok' in node && 'result' in
node)` unwrap + terminal `node.ok === false` check).

Tests (all pre-existing, backend untouched this pass): `node --test
server/tests/inheritance-domain-parity.test.js
server/tests/inheritance-lens-macros.test.js
server/tests/depth/inheritance-behavior.test.js
server/tests/temperament-inheritance.test.js` → **47/47 pass, 0 fail**
(16 + 25 + 1 + 5).

## What was already real/wired (DESIGNED)

- **`app/lenses/inheritance/page.tsx`** — an 8-tab estate workbench
  (Overview / Beneficiaries / Will & Directives / Asset Inventory /
  Executors / Probate Timeline / My Notices / Heir-Slot Market) with real
  loading/error/empty/populated states, a share-balance validator, a
  by-category asset value bar chart (`ChartKit`), a versioned will reader
  with restore, an executor consent workflow, a `TimelineView` probate
  ledger, and the heir-slot market claim flow. 20 of the 24 estate macros
  + `claim_slot`/`list_open` were already surfaced with bespoke forms (not
  a generic button wall) and correct field shapes.
- **`components/inheritance/EstateChatter.tsx`** — DESIGNED. Real Reddit
  REST pulls (`r/EstatePlanning`, `r/inheritance`, `r/estatesales`,
  `r/AskaLawyer`, top day/week/month) with honest loading/error/empty
  states + Save-as-DTU export. No fabrication.

## The defect found + what changed (frontend only)

Two **UNSURFACED** real macros — a designed capability sitting dark, the
program's second-most-common defect class after fabricated data. Both were
wired with bespoke UI this pass (no backend change):

1. **`inheritance.notify_heir` was never called from the frontend**
   (`node scripts/lens-unsurfaced.mjs --lens inheritance` → 1/24 dark:
   `notify_heir`). This is the **sending half of the heir-notification /
   acceptance loop**: the "My Notices" tab + `respond_notice` (the
   *receiving* half) were fully built, and the beneficiary card even
   rendered `designation {acceptanceStatus}` — but nothing ever *sent* a
   designation notice, so `acceptanceStatus` could never populate and the
   whole receiving surface was dead for anyone using the lens as intended.
   **Fix:** added an optional "Heir user ID" field to the beneficiary
   designation form (passed to `add_beneficiary`, which already accepts
   `heirUserId`), plus a per-beneficiary **Notify heir** action. When a
   beneficiary carries an `heirUserId`, one click sends the notice; when it
   doesn't, an inline bespoke input (not `window.prompt`) collects the heir
   id and sends. Optimistic busy state + honest failure surfacing on the
   macro's own `error`. The card now honestly shows "designation not yet
   sent" until a notice goes out.
2. **`inheritance.open_listing` was never called from the frontend** — the
   **mentor side of the death-derivatives market was entirely absent.** The
   Market tab let a player `claim_slot`/`list_open` (buyer side) but there
   was no way to *create* a listing, so the market could only ever be
   populated by another actor. **Fix:** added a "List a dying NPC (mentor)"
   bespoke form to the Market tab (`dyingNpcId` + `heirSlotPriceCc`, CC
   currency, optimistic busy state, honest failure on
   `error`/`reason`), wired to `open_listing`. On success it surfaces the
   real returned `listingId` and reloads.

**Fluidity (fifth invariant):** added discoverable keyboard navigation via
`useLensCommand` — `1`–`8` jump tabs, `R` reloads — advertised by a `kbd`
chip row under the tab bar (previously the grader reported
`hasKeyboardHandlers: false`; now `true`). Non-global commands correctly do
not fire while typing in the lens's many text inputs
(`enableOnFormTags: false` in `useLensCommand`, verified).

The `Beneficiary` TS interface gained `heirUserId?: string | null` so the
notify action can one-click a pre-linked heir.

## Investigated and honestly deferred

| Item | Real capability | Disposition |
|---|---|---|
| Real-world probate/estate reference data (statutory intestacy shares, per-state probate timelines) | Would let the lens rival Trust & Will's jurisdiction-aware guidance. No such feed is wired today; the probate timeline is derived purely from the user's own estate events. | **Genuinely missing — DATA-SOURCING.** A future Wave-4 pass could ingest a real open source (e.g. published state intestacy statutes) rather than fabricate share tables. Not faked here; the timeline honestly shows only real user-entered events. |
| `estate_overview` / `list_beneficiaries` share-balance math surfaced elsewhere | Already surfaced (Overview banner + Beneficiaries remainder line). | No gap. |
| Heir-slot market **resolution on NPC death** | Server-side: `claim_slot` locks, resolution fires on the NPC's death via the death/legacy engine, not a player action. | Not surfaced as a player action — correctly server-internal (matches the CK3-shaped "you don't manually settle, death settles it" design). No UI gap. |

No capability was faked to fill a gap. The one genuinely-missing item
(jurisdiction reference data) is honestly labelled DATA-SOURCING for Wave 4
rather than papered over with an invented statute table.

## Verification

- `node --test server/tests/inheritance-domain-parity.test.js
  server/tests/inheritance-lens-macros.test.js
  server/tests/depth/inheritance-behavior.test.js
  server/tests/temperament-inheritance.test.js` → **47/47 pass, 0 fail**
  (backend untouched this pass; all pre-existing and re-verified green).
- `cd concord-frontend && npx eslint app/lenses/inheritance/page.tsx
  components/inheritance/*.tsx` → clean, 0 errors/warnings.
- `node scripts/verify-lens-backends.mjs` → `{"WIRED":258,"NO-BACKEND-CALL":2}`
  total 260 — inheritance reports WIRED.
- `node scripts/grade-ux-polish.mjs --honest` → inheritance entry:
  `tier: "polished"`, `isGenericScaffold: false`, `honestCapped: false`,
  `pillarsPresent: 5`, `antiPatterns: 0`, `hasKeyboardHandlers: true`.
  `audit/` reverted after the run.
- Did **not** run `npx tsc --noEmit` (shared box; centralized tsc runs once
  after all lenses commit, per the Wave-3 memory-safety rule).

## Left alone, with reason

- `server/domains/inheritance.js` + the 3 inline `server.js` market macros
  — no changes. All 27 macros were already correct with real behavioral
  test coverage; the defect was entirely two unsurfaced-in-frontend
  capabilities, never the backend.
- `components/inheritance/EstateChatter.tsx` — untouched. Already DESIGNED,
  real external feed, no fabrication.
- The rest of `page.tsx` (wills, assets, executors, probate, locks, notices,
  claim flow) — field names cross-checked against
  `server/domains/inheritance.js` and found correct with zero shape
  defects; left as-is.
