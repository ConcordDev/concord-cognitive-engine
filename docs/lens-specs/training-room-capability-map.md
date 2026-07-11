# Training Room lens — capability map (Wave 3, Frontend Rebuild Program)

Audited 2026-07-10. Backend: `server/domains/training-room.js` (4 macros, no
shadowing re-registration in `server.js` — confirmed by
`grep -n 'register("training-room"' server/server.js`, which returns nothing).
This lens is the frontend surface CLAUDE.md calls out by name — "Training-room
frame data is derived, not stored" (`server/lib/combat-frame-data.js`) — and
it already exists and is already wired.

## Backend surface

Reproduce: `grep -n 'register("training-room"' server/domains/training-room.js | wc -l` → 4.

| Macro | Kind | Notes |
|---|---|---|
| `frame_data` | pure derivation | `{ skillId }` → resolves a persisted `type='skill'` DTU row OR falls through to a built-in weapon kind so it never 404s on a default skill (documented `PLAYTEST #21` fix in the source comment) |
| `kind_frame_data` | pure derivation, no DB | `{ kind }` → canonical frame envelope for one built-in weapon kind |
| `list_kinds` | pure derivation, no DB | every built-in weapon kind (`sword`/`axe`/`spear`/`bow`/`staff`/`fist`/`dagger`/`hammer`) with its frame envelope, always trainable regardless of acquired skills |
| `list_skills` | per-user read | the caller's persisted `type='skill'` DTU rows (id + title), for the dojo's skill picker |

All four macros delegate to `server/lib/combat-frame-data.js` (`getFrameDataForSkillId`,
`getFrameDataForKind`, `BUILTIN_SKILL_KINDS`) — no frame-timing math is
duplicated in the domain file, matching the CLAUDE.md invariant "Training-room
frame data is derived, not stored." The separate REST route
`GET /api/combat/frame-data/:skillId` (`server.js:32990`) is a second, legitimate
access path to the same derivation (for non-lens callers, e.g. a future combat
HUD) — the lens itself uses the macro path exclusively via `lensRun`, which is
correct and doesn't need to also hit the REST route.

## What's real / already-wired (unchanged)

`concord-frontend/app/lenses/training-room/page.tsx` (288 LOC, single file —
this lens has no separate `components/training-room/` directory, everything
bespoke lives in the page) is already a complete, honest, bespoke build:

- **Skill/weapon picker** (`list_skills` + `list_kinds` merged into one list)
  — real per-user skills plus the eight always-trainable built-in kinds,
  with a `weapon` badge distinguishing built-ins from acquired skills.
- **Frame-data panel** (`frame_data`) — startup/active/recovery timing tiles,
  parry-window tile (explicitly rendered as "none" for zero-parry ranged
  kinds like bow/staff, not a fabricated number), dodge-window tile, and a
  conditional combo-followups strip that only renders when the derived data
  actually contains followups (currently always empty in practice since no
  skill-authoring path writes `combo_followups` metadata yet — this is an
  honestly-empty derived field, not a fake one; the UI's `.length > 0 &&`
  guard already handles it correctly).
  - **Replay scrubber** — a client-side `setTimeout` sequence that visualizes
  the derived startup→active→recovery envelope using the *server-returned*
  millisecond values (`frameData.startup_ms` etc.) as the actual timer
  durations, not invented numbers — a legitimate visualization of real data,
  not a fake progress bar (the CLAUDE.md `setInterval`/fake-progress ban is
  about substituting for a real backend event; here the "event" being
  visualized already fully happened server-side and the timer plays back the
  real derived numbers).
- **Four honest UX states**: idle (nothing selected) / loading (skeleton) /
  error (`AlertTriangle` + retry button, for both the skills-list fetch and
  the frame-data fetch) / ready. Verified directly against the four-state
  vitest suite below.

## Defects found

None. Direct read of the page against the domain file and the derivation
library turned up no field-shape mismatches, no fabricated data, no
`Math.random`/mock/hardcoded content, no generic-CRUD shadow system, and no
unsurfaced macro — all four backend macros are called, with correct field
shapes (`{ skillId }` for `frame_data`, `{ kind }` implicitly handled
server-side via `kind_frame_data`/`list_kinds`, `{}` for `list_skills`
defaulting to `ctx.actor.userId`).

`node scripts/lens-unsurfaced.mjs --lens training-room` independently
confirms: `training-room: 0/4 macros never referenced in the frontend`.

## Investigated and left alone (no gap to triage)

- `getFrameDataBatch` and `withProfileOverride` (exported from
  `combat-frame-data.js` but not called by this lens or any macro) are
  general-purpose helpers intended for a future HUD/hotbar consumer (batch
  frame lookups; combat-profile parry/dodge overrides), not gaps in the
  training-room lens itself — the dojo's job is single-skill inspection, and
  it does that completely. Not a defect; nothing to triage.
- `combo_followups` renders empty in practice today because no skill-authoring
  path in the codebase currently writes that metadata field onto a skill DTU.
  This is a **CURATION**-class gap in the *skill-authoring* system (not in
  training-room, which correctly derives and renders whatever's there) —
  out of scope for this lens's rebuild pass.

## Verification

- `node --check server/domains/training-room.js` — no changes made, not
  re-verified via check since the file was untouched; syntax was already
  valid (it registers cleanly, exercised by the domain-macros test below).
- `cd server && node --test tests/training-room-domain-macros.test.js tests/combat-frame-data.test.js`
  → **19/19 passing** (10 in the domain-macros suite against a real migrated
  DB, 9 in the pure-derivation library suite).
- `cd concord-frontend && npx vitest run tests/lenses/training-room.test.tsx`
  → **6/6 passing** (the four-UX-state suite: empty, populated+ready,
  loading, error, plus skill-switch and replay-scrubber cases).
- `cd concord-frontend && npx eslint app/lenses/training-room/page.tsx` → clean, 0 errors/warnings.
- `node scripts/verify-lens-backends.mjs` → `{"WIRED":258,"NO-BACKEND-CALL":2}` total 260,
  0 broken. `training-room` is in the WIRED set (only `narrative-walk` and
  `ux-suite` are the by-design `NO-BACKEND-CALL` pair).
- `node scripts/grade-ux-polish.mjs --honest` → `audit/ux-polish-honest.json`
  entry for `training-room`: `"tier":"polished"`, `"isGenericScaffold":false`,
  `"antiPatterns":0`, `"pillarsPresent":5`. `audit/` reverted after the run
  (`git checkout -- audit/`) per the program's noise-avoidance rule.

## Left alone, with reason

The entire lens is left alone — it is a genuine, complete, honest,
category-appropriate build (fighting-game-style frame-data trainer with a
real replay scrubber) that was already through a prior rebuild pass (source
comments cite "Phase AF"). No commit was needed beyond this capability-map
document.
