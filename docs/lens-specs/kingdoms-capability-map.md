# Kingdoms — capability map (Wave 3, Frontend Rebuild Program)

Audited 2026-07-10. **Two parallel, both-real kingdom-ish substrates
coexist** — this is the load-bearing finding of this audit, called out in
advance by `CLAUDE.md`'s migration history note ("`realm_*` prefixed to
avoid colliding with the older `kingdoms` territory-polygon schema"):

1. **REST surface — `server/routes/kingdoms.js` → `server/lib/kingdom.js`
   → the `kingdoms` table (migration 105).** Player-founded kingdoms with
   a region polygon, decrees, siege/subversion/annexation *contests*,
   residents. Mounted at `app.use("/api/kingdoms", createKingdomsRouter(...))`
   (`server.js:32271-32272`). This is a real, separate REST API — not the
   macro system.
2. **Macro surface — `kingdoms.*` (36 macros registered via
   `registerKingdomsMacros` in `server/domains/kingdoms.js`, imported +
   called once at `server.js:25604-25605`, no shadowing re-registration:
   `grep -n '"kingdoms"' server/server.js` → only the import + the one
   `register()` call site) → the `realms` / `realm_decrees` /
   `realm_citizens` / `realm_territories` tables (migration 158).**
   NPC-ruled, faction-seeded realms with a CK3-parity layer (dynasty,
   council, diplomacy, war, economy, intrigue, law) that lives on
   `globalThis._concordSTATE.kingdomsLens` per-player Maps rather than a
   dedicated migration (documented in the domain file's own header
   comment — "the kingdoms lens did not own a migration for these
   layers, and CK-style realm play is per-player anyway").

Both are real and both are wired into the frontend — `app/lenses/kingdoms/page.tsx`
drives the REST surface directly (list/detail/create/decree/contest/join),
and `RealmActionPanel` + `DynastyRealmManager` drive the 36 macros. Repro:
`grep -n 'register("kingdoms"' server/domains/kingdoms.js | wc -l` → `36`.

## Backend surface

**REST (`server/routes/kingdoms.js`, 8 routes)** — `GET /`, `POST /`,
`GET /:id`, `POST /:id/decree`, `POST /:id/contest`,
`POST /contests/:contestId/contribute`, `POST /contests/:contestId/resolve`,
`POST /:id/join`, `GET /at/lookup`, `GET /_meta/decree-kinds`.

**Macros (`server/domains/kingdoms.js`, 36, all real):**
- Realm read/status (6): `list` (requires `worldId`), `get`, `kingdom_status`,
  `my_realm` (ruler-scoped, used by the in-world RulerHUD), `decrees_for_region`,
  `revoke_decree`.
- Decree + loyalty + takeover (6): `propose_decree` (8 valid `kind`s —
  `tax_change`/`conscription`/`trade_embargo`/`recipe_grant`/`pardon`/
  `exile`/`construction`/`festival`, `server/lib/kingdom-decrees.js`
  `KIND_DEFAULTS`), `recompute_loyalty`, `takeover_conquest`,
  `takeover_inheritance`, `takeover_election`, `depose_ruler`.
- CK3-parity layer (24, per-player state): dynasty/succession
  (`char_create`, `dynasty_tree`, `char_marry`, `char_death`), law
  (`law_get`, `law_set`), council (`council_list`, `council_appoint`,
  `council_dismiss`), diplomacy (`diplomacy_list`, `treaty_propose`,
  `treaty_resolve`, `claim_fabricate`), war (`war_list`, `war_declare`,
  `war_battle`, `war_end`), economy (`economy_get`, `economy_set_tax`,
  `economy_build`, `economy_collect`), intrigue (`scheme_list`,
  `scheme_start`, `scheme_advance`).

All 36 pass `node --test server/tests/kingdoms-lens.test.js
server/tests/kingdom-seeder.test.js server/tests/realm-overview.test.js
server/tests/depth/kingdoms-behavior.test.js
server/tests/viability/realm-control.test.js server/tests/kingdoms-rule.test.js
server/tests/kingdoms-domain-parity.test.js server/tests/realm-access.test.js
server/tests/kingdoms.test.js` → **119/119 pass, 0 fail** (verified this pass).

## What was already real/wired

- **`app/lenses/kingdoms/page.tsx`** — DESIGNED. Browse/Found/Detail views
  over the REST kingdoms API: real loading/error/empty/populated states
  (pinned by `tests/kingdoms-lens-states.test.tsx`, 6/6), decree composer,
  contest UI (siege/subversion/annexation), resident list, join action.
- **`components/kingdoms/DynastyRealmManager.tsx`** (958 LOC) — DESIGNED.
  A genuinely CK3-shaped tabbed workbench (Dynasty/Council/Diplomacy/War/
  Economy/Intrigue/Law) wired to all 24 CK3-parity macros with correct
  field shapes throughout — every macro call, response field, and error
  path cross-checked against `server/domains/kingdoms.js` during this
  audit and found correct with zero defects. Notably includes a real
  dynasty-tree visualization (`TreeDiagram`) built from live `char_create`/
  `char_marry`/`char_death` state.
- **`components/kingdoms/HistoryExplorer.tsx`** — DESIGNED. Real Wikipedia
  REST API pulls (`en.wikipedia.org/api/rest_v1/page/summary/...`) for 9
  historical empires, honest loading/error states, Save-as-DTU export.
- **`components/kingdoms/WarCampaignSession.tsx`** — DESIGNED. Real
  cross-session war-campaign planning journal on the `sessions.*` macro
  substrate (`declare → muster → engage → resolve` step graph via
  `useLensSession`), no fake state.

## The defect found + what changed

**`components/kingdoms/RealmActionPanel.tsx`** (the CK3-shaped realm/
decree/loyalty/takeover action panel wired to a subset of the same 36
macros `DynastyRealmManager` uses correctly) had the exact opposite
problem: **every action reported fake success on real backend failure** —
the single most serious defect class this program watches for, worse than
a silent no-op because it *actively misinforms* the player. Root cause was
a chain of field-shape + response-unwrap bugs:

1. **`callKingdoms()` never checked the macro's own `ok`.**
   `POST /api/lens/run` wraps every macro's return as
   `{ ok: true, result: <macro's own {ok, ...} object> }` — the outer
   `ok` is a transport flag (confirmed by reading `server.js`'s
   `/api/lens/run` handler and cross-checked against
   `HUDContextProvider.tsx#macroCall`'s own comment: "the outer `ok` is a
   transport flag, not the macro's own success/failure"). The panel's
   local helper returned `d as { ok: boolean; result?: T }` straight off
   the *outer* envelope without ever inspecting `d.result.ok`. Since the
   outer envelope is `ok:true` for almost any non-5xx response, a macro
   failure like `{ok:false, reason:'invalid_kind'}` was returned as
   `{ok:true, result:{ok:false, reason:'invalid_kind'}}` and every call
   site's `if (r.ok && r.result) { ...toast success... }` fired the
   success toast anyway.
2. **`kingdoms.list` requires `worldId`** (`server/domains/kingdoms.js:50-51`,
   `if (!worldId) return { ok:false, reason:"no_world" }`) — the panel
   called it with `{}`. Compounded by bug 1, this always silently
   "succeeded" with 0 realms.
3. **`kingdoms.list`'s real field is `kingdoms`, not `realms`** — the panel
   read `r.result?.realms`, which is `undefined` even had bug 2 not
   existed.
4. **`propose_decree` needs `{kingdomId, kind, body}`**; the panel sent
   `{region, kind: <'tax'|'levy'|'mercy'|'crackdown'|'border-watch'>,
   magnitude}`. None of those 5 kind strings are in the macro's real
   8-entry `KIND_DEFAULTS` enum (`tax_change`/`conscription`/
   `trade_embargo`/`recipe_grant`/`pardon`/`exile`/`construction`/
   `festival`) — every decree would fail `invalid_kind`, and there was no
   `kingdomId` at all — `missing_inputs`.
5. **`recompute_loyalty` and all three `takeover_*` macros need
   `{kingdomId}`**; the panel sent `{realmId}` — wrong key, always
   `missing_inputs`.
6. **Response-shape mismatches on every result the panel did manage to
   receive**: `recompute_loyalty` only returns `{refreshed, count}` — no
   `loyalty`/`delta` fields the panel displayed; `takeoverBy*` return
   `{legitimacy, path}` — no `newRulerUserId` the panel displayed;
   `Realm` rows are `SELECT * FROM realms` (snake_case:
   `capital_settlement_id`, no `loyalty`/`size` columns at all) but the
   panel's `Realm` interface declared camelCase `rulerUserId`/`capital`/
   `loyalty`/`size`, none of which exist on the real row (verified
   against `components/world/concordia-hud/HUDContextProvider.tsx`, which
   reads the exact same `kingdoms.my_realm` macro with the correct
   field names — a working reference implementation sitting right next
   to the broken one).

**Net effect before the fix**: every button in the panel except "My
realm" appeared to work — toasts said "Decree proposed", "Loyalty 5",
"conquest: success" — while the backend had rejected every single call.
This is a direct instance of the "honest by construction" invariant's
core failure mode: fabricated success on real failure.

**Fix** (`concord-frontend/components/kingdoms/RealmActionPanel.tsx` only):
- Rewrote `callKingdoms()` to unwrap exactly one level and check the
  inner macro's `ok`, surfacing its real `error`/`reason` on failure —
  the same unwrap `HUDContextProvider.tsx#macroCall` already does
  correctly, now applied here too.
- Added a `worldId` state seeded from the same `localStorage
  'concordia:activeWorldId'` hint the rest of the world lens uses
  (`DriftAlertToast.tsx`, `HUDContextProvider.tsx`), passed to `list`.
- Fixed the `Realm` interface to the real snake_case row shape
  (`capital_settlement_id`, `legitimacy`, `treasury`, `tax_rate`, no
  `loyalty`/`size`) and every render site that read the old fake fields.
- Replaced the 5-entry fake decree-kind enum with the real 8-entry
  `KIND_DEFAULTS` set, added conditional per-kind fields (a "new tax
  rate" input for `tax_change` → `body.new_rate`, a "target NPC id"
  input for `pardon`/`exile` → `body.target_npc_id`), and now sends
  `{kingdomId, kind, body}`.
- Fixed `recompute_loyalty` and all three `takeover_*` calls to send
  `{kingdomId}` (was `{realmId}`).
- `actLoyalty()` now composes `recompute_loyalty` (real refresh count)
  with `kingdom_status` (real `{avg, low, high, count}` loyalty summary
  **and** `rebellionRisk.{score, threshold}` — the CK3-flavor rebellion
  gauge this action was missing entirely) rather than assuming a
  fabricated shape.
- `actTakeover()` now reports the real `{legitimacy, path}` on success
  and a genuinely honest failure card (e.g. conquest without
  `proof.rulerKilledAt`/`capitalHeldSince` correctly fails
  `reason:'ruler_not_killed'` — this is the *correct* backend behaviour,
  not a bug the fix should paper over; the panel deliberately does not
  fabricate a `proof.bypass` shortcut, which would let a player skip the
  real "kill the ruler + hold the capital 6h" requirement).
- Surfaced two previously-real-but-invisible macro results: `my_realm`'s
  `activeDecrees` field was being fetched and silently dropped — added a
  "My realm's active decrees" list with a working **revoke** button wired
  to `kingdoms.revoke_decree` (a real, tested macro that had zero UI
  anywhere in the lens before this pass).

## Investigated and honestly deferred

| Macro | Real capability | Disposition |
|---|---|---|
| `kingdoms.decrees_for_region` | Region-scoped active-decree lookup — the domain file's own comment says it's a "lookup helper for dialogue/quest engines," i.e. a server-internal consumer (NPC dialogue prompt context), not a player-facing action. | Not surfaced — correctly internal, no UI gap. |
| `kingdoms.depose_ruler` | Forces a realm to `interregnum` — per its own comment, "used by D4 rebellion path when player ruler is assassinated," i.e. system-triggered by the rebellion engine, not a direct player action. | Not surfaced — correctly internal, no UI gap. |
| Founding a **realm** (macro-system CK3 kingdom, distinct from the REST `kingdoms` table's "Found kingdom" button which already exists) | No `kingdoms.found` macro exists — realms are seeded server-side from authored factions (`seedKingdomsFromFactions`), not player-founded. Player rule is acquired only via the three takeover paths. | **By design, not a gap.** This is the correct CK3 shape (you don't found a kingdom from nothing — you take one that exists). Confirmed no macro was silently missing here; the REST surface already covers the "found your own territory" use case via a different, older mechanic. |

No capability was faked to fill a gap — both deferred items are
legitimately server-internal macros with no player-facing UI need, not
missing frontend work.

## Verification

- `node --test server/tests/kingdoms-lens.test.js server/tests/kingdom-seeder.test.js
  server/tests/realm-overview.test.js server/tests/depth/kingdoms-behavior.test.js
  server/tests/viability/realm-control.test.js server/tests/kingdoms-rule.test.js
  server/tests/kingdoms-domain-parity.test.js server/tests/realm-access.test.js
  server/tests/kingdoms.test.js` → **119/119 pass, 0 fail** (45 suites; backend
  untouched by this pass, all pre-existing and re-verified green).
- `cd concord-frontend && npx eslint app/lenses/kingdoms/page.tsx
  components/kingdoms/*.tsx` → clean, 0 errors/warnings.
- `npx vitest run tests/kingdoms-lens-states.test.tsx` → **6/6 pass**
  (the REST-surface four-UX-state contract; unaffected by this pass since
  it stubs `RealmActionPanel` inert, but re-verified green).
- `node scripts/verify-lens-backends.mjs` → `{"WIRED":258,"NO-BACKEND-CALL":2}`
  total 260 — kingdoms reports WIRED; the two by-design
  NO-BACKEND-CALL lenses (`narrative-walk`, `ux-suite`) unchanged.
- `node scripts/grade-ux-polish.mjs --honest` → kingdoms entry:
  `tier: "polished"`, `isGenericScaffold: false`, `pillarsPresent: 5`,
  `antiPatterns: 0` (`fileCount: 5`, `totalLoc: 2361`). `audit/`
  reverted after the run (`git checkout -- audit/ux-polish-honest.json
  audit/ux-polish-honest-gaps.md`).
- `node --check server/domains/kingdoms.js` → passes (backend untouched
  this pass; run anyway per the verification checklist).

## Left alone, with reason

- `app/lenses/kingdoms/page.tsx` — untouched. Already DESIGNED, drives the
  REST surface correctly with real loading/error/empty/populated states;
  no defects found on read-through (field names cross-checked against
  `server/routes/kingdoms.js` and `server/lib/kingdom.js`).
- `DynastyRealmManager.tsx` — untouched. Already DESIGNED; every one of
  its 24 macro calls, response-field reads, and error paths cross-checked
  against `server/domains/kingdoms.js` during this audit and found
  correct — the CK3-parity layer's reference implementation, and the
  component `RealmActionPanel`'s fix was brought in line with.
- `HistoryExplorer.tsx`, `WarCampaignSession.tsx` — untouched. Already
  DESIGNED, no fabrication found, no field-shape defects.
- `server/domains/kingdoms.js`, `server/lib/kingdom*.js` — no changes.
  All 36 macros were already correct with real behavioral test coverage
  before this pass; the defect was entirely in one frontend component's
  call shapes, never the backend.
- `server/lib/kingdom-decrees.js#revokeDecree` has no ruler-authorization
  check (any caller with a valid `decreeId` can revoke it, unlike
  `proposeDecree` which does check `issuedByKind`/`issuedById` against
  the realm's `ruler_kind`/`ruler_id`). This is a pre-existing backend gap,
  not introduced by wiring the revoke button — flagged here for a future
  pass rather than touched now, since backend authz changes are outside
  this frontend-rebuild pass's scope and the six hard invariants reserve
  auth-invariant changes for explicit human authorization.
