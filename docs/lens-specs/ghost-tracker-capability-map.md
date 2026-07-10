# Ghost Tracker Lens — Capability Map (Frontend Rebuild Program, Wave 3)

> Derived, not asserted. Every number below has a reproduction command; every
> classification is backed by a grep or a full read of the file it's about.

## Backend surface

```
grep -oE 'register\("ghost-hunt",\s*"[a-z_-]+"' server/domains/ghost-hunt.js
```
→ **9 macros** (8 before this pass, `create` and `dossiers`; `dossiers` is
new — see below) in `server/domains/ghost-hunt.js` (registered domain
string `"ghost-hunt"`): `residues`, `detail`, `progress`, `advance`,
`confront`, `history`, `leaderboard`, `create`, `dossiers`. Confirmed no
other file registers under `"ghost-hunt"`
(`grep -rl '"ghost-hunt"' server/domains/*.js server/server.js` → only
`ghost-hunt.js`).

**Filename/domain-string/lens-directory mismatch, exactly like the
CLAUDE.md warning describes**: the lens directory is `ghost-tracker`, the
backend file is `server/domains/ghost-hunt.js`, and it registers under the
domain string `"ghost-hunt"` — three different names for one surface. This
makes `node scripts/lens-unsurfaced.mjs --lens ghost-tracker` almost
certainly a false negative (it filters by filename stem, which never
matches `ghost-hunt.js`); verified manually instead by grepping each of the
9 action names against every file in `app/lenses/ghost-tracker/` and
`components/ghost-tracker/`.

Per the file's own header comment, this is "Phase V ghost-tracker surface
for the ghost-hunt game-mode lens" — a **gameplay wrapper around the real
Layer-12 lattice drift-detection substrate** CLAUDE.md documents at length
(`server/emergent/drift-monitor.js` / `lattice-orchestrator.js`,
`runDriftScan`/`getDriftAlerts`, the `drift_alerts` table). A "spectral
residue" is a real `drift_alerts` row (goodhart / memetic_drift /
capability_creep / self_reference / echo_chamber / metric_divergence
detections) filtered to the four flavors this lens frames as hauntings
(`spectral`, `echo_chamber`, `self_reference`, `memetic_drift`); investigate/
confront is a genuine multi-stage progression layered on top with a
deterministic (seeded-hash) win-chance roll, a reward table, and a
persistent hunter rank. Hunt/rank/history state lives in
`globalThis._concordSTATE` Maps keyed by userId (in-memory, not DB-backed —
same tradeoff as other in-memory game-mode substrates in the codebase, e.g.
`lib/brawl.js`); `drift_alerts` themselves are real, append-only DB rows.

## Reference apps

**Phasmophobia** (evidence/investigation loop against a real haunting —
track → investigate → confront maps directly onto its evidence-gathering →
ghost-type-identification → banish loop) crossed with a **mobile
collection-game progression system** (hunter rank/leaderboard, reward
table, per-encounter case-file artifact). The backend twist — the
"hauntings" are a real system-health substrate, not scripted content — is
closer to an ARG built on telemetry than a pure content game, so the bar is
"does this read as a legitimate hunt/investigation UI," not "does it look
like a generic admin panel over an alerts table."

## Classification (before this pass)

**Strong backend, one genuinely fabricated dead-end, one fully unsurfaced
macro.** Read all of `app/lenses/ghost-tracker/page.tsx` (297 lines before
this pass) and all 6 `components/ghost-tracker/*.tsx` files (~29KB total).
`grep -n "Math.random\|MOCK\|mock\|fake\|Lorem\|lorem" app/lenses/ghost-tracker/page.tsx components/ghost-tracker/*.tsx`
→ zero hits — no invented data anywhere; every number rendered traces to a
macro response. **7 of 8 original macros were genuinely, correctly wired**:
`residues` (page.tsx list + filters), `detail`/`advance`/`confront`
(`ResidueDetail.tsx`, the full investigation modal), `progress`
(`ActiveHunts.tsx`), `history` (`ConfrontHistory.tsx`, with a real
`ChartKit` win/loss bar), `leaderboard` (`HunterLeaderboard.tsx`). No
generic `<UniversalActions>`/`<LensFeaturePanel>` button-wall anywhere —
every panel is bespoke, purpose-built for the hunt-progression theme (stage
chips, severity rings on an SVG spectral-plane map, seeded map coordinates).

Two real defects, both now fixed:

1. **`ghost-hunt.create` — fully unsurfaced (0 call sites).** The macro
   itself is real and correct: it mints an actual `dtus` row (a "Spectral
   Dossier" case file) with the residue's drift type, severity, coords,
   confront outcome, and player notes. But nothing in the frontend ever
   called it — no button, no form, anywhere. The page's own code comment
   claimed otherwise ("The canonical dossier DTU is minted by
   ghost-hunt.create from ResidueDetail") — that comment described intended
   behavior that was never actually implemented; `ResidueDetail.tsx` had no
   save affordance at all.

2. **The "Saved dossiers" section on `page.tsx` was a disconnected generic
   artifact-store dead end** — the exact pattern CLAUDE.md's zero-demo-
   content invariant names (see the eco lens's "disconnected generic CRUD"
   precedent). It called `useLensData('ghost-tracker', 'spectral_dossier', { noSeed: true })`,
   which fetches from the **generic lens-artifact CRUD store**
   (`/api/lens/ghost-tracker?type=spectral_dossier`) — a completely
   different persistence system from where `ghost-hunt.create` actually
   writes (a direct `INSERT INTO dtus`, verified by reading the handler).
   Nothing anywhere POSTs to that generic artifact endpoint with
   `type='spectral_dossier'`, so this section was **permanently,
   unconditionally empty** in any real deployment — a plausible-looking
   panel with zero possible path to real data, next to five other panels
   that all worked. It rendered an honest "no dossiers yet" empty state, so
   it never fabricated content, but it could never *not* show that state.

3. **A second, deeper defect found while wiring `create`**: even a
   correctly-wired save button would have produced dossiers that were
   *still* unlistable. `ghost-hunt.create`'s `INSERT INTO dtus` set
   `owner_user_id` but never `type` or `creator_id`. Per migration 087
   (`server/migrations/087_dtus_type_creator_data.js`), `dtus.type` is
   `NOT NULL DEFAULT 'knowledge'` and `creator_id` defaults to `NULL` on a
   bare insert. Two independent "my saved work" surfaces read those exact
   columns and would both have silently returned zero rows forever:
   - The generic `RecentMineCard` widget (already mounted at the bottom of
     `page.tsx`, `domain="ghost-tracker"`) calls the bulk-registered
     `ghost-tracker.recent_mine` macro
     (`server/domains/_recent-mine-bulk.js:179`,
     `"ghost-tracker": { type: ["ghost_sighting"] }`), which filters
     `WHERE creator_id = ? AND type IN ('ghost_sighting')`
     (`server/domains/_dtu-recent-mine.js`). A dossier with `type='knowledge'`
     (the default) and `creator_id=NULL` matches neither predicate.
   - The new `ghost-hunt.dossiers` macro this pass adds (below) has the
     same requirement — it exists specifically to read back what `create`
     writes.
   Verified this is a real, silent bug (not a hypothetical) by reading the
   `dtus` table's migration history end to end: `type`/`creator_id` are
   genuinely separate columns from anything `ghost-hunt.create`'s original
   INSERT touched, and the migration's own comment says as much ("New rows
   that came in via `INSERT INTO dtus (type, ...)` calls already have it
   set" — this one didn't).

## What changed

- **`server/domains/ghost-hunt.js` — `create` macro**: the `INSERT INTO
  dtus` now sets `creator_id` (= the authenticated userId) and
  `type = 'ghost_sighting'` alongside the existing columns, matching the
  convention the rest of the fleet's "my recent work" machinery expects.
  Purely additive to the row shape — no existing field removed or
  reinterpreted.
- **`server/domains/ghost-hunt.js` — new `dossiers` macro**: reads the
  calling hunter's own dossiers back
  (`WHERE creator_id = ? AND type = 'ghost_sighting' ORDER BY created_at DESC, rowid DESC`),
  unpacks `body_json` server-side so the frontend gets `drift_type` /
  `severity` / `outcome` / `residueId` / `stage` directly instead of a
  second round-trip. This is what closes the fully-unsurfaced `create`
  macro's "is there any way to see what I saved" gap, and it's what the
  page's dossier list is now wired to.
- **`concord-frontend/components/ghost-tracker/ResidueDetail.tsx`**: added
  a "Save case file" feature — a button (visible once the hunt stage moves
  past `track`, i.e. the hunter has actually engaged the residue) that
  opens an inline form (optional title, optional field notes, visibility
  private/public) and calls `ghost-hunt.create`. Success/failure renders an
  honest inline confirmation or error (with the real `reason` string from
  the macro, not a generic "something went wrong"); success also calls
  `onChanged()` so the page's dossier list and active-hunts rail refresh.
  This is the real, designed home for the previously fully-dead `create`
  macro — not a generic form, a bespoke case-file affordance themed to the
  investigation flow.
- **`concord-frontend/app/lenses/ghost-tracker/page.tsx`**: replaced the
  broken `useLensData('ghost-tracker', 'spectral_dossier', …)` call (the
  disconnected generic-artifact dead end) with a real fetch against the new
  `ghost-hunt.dossiers` macro, refetched whenever `refreshKey` bumps (the
  same signal `ActiveHunts`/`HunterLeaderboard`/`ConfrontHistory` already
  use). The rendered list now shows real drift-type/severity/outcome chips
  (previously impossible — the old data source never had a producer, so
  the `d.data?.drift_type` branch never fired even in principle) and, when
  the underlying residue is still in the current list, clicking a dossier
  row reopens `ResidueDetail` for it (a genuine, designed interaction, not
  decorative). Updated the file's own header doc comment to list all 9
  macros instead of 6 (it previously omitted `progress`, `create`, and — by
  necessity, since it didn't exist yet — `dossiers`).
- **Side effect (not separately implemented, verified as a consequence of
  the `create` fix)**: the generic `RecentMineCard domain="ghost-tracker"`
  widget already mounted at the bottom of the page was — before this pass
  — silently, permanently empty for the same `type`/`creator_id` reason
  above. It now genuinely populates once a dossier is saved. Left mounted
  as-is; it's the standard cross-lens "recent activity" convention and now
  honestly functions instead of being decoration.
- **`HauntingsFeed.tsx` (real-world Reddit hauntings feed,
  r/Paranormal/Ghosts/Ghoststories/folklore/nosleep via the public Reddit
  JSON API) — audited, left untouched.** This is real external-API-backed
  flavor content (honest loading/error states, a `SaveAsDtuButton` for
  provenance-stamped saving, no fabrication), analogous to how the eco
  lens's `HauntingsFeed`-equivalent panels pull Open-Meteo/GBIF. It's
  thematically on-brand (a "real hauntings" companion feed next to the
  system-generated ones) and was already correctly built — no gap found.

## Verification

- `cd concord-frontend && npx eslint app/lenses/ghost-tracker/page.tsx components/ghost-tracker/*.tsx` — clean, exit 0.
- Manual type read-through in place of a full-project `tsc` (avoided here
  per the wave's concurrency instructions, since 5 sibling agents are
  editing other lenses in the same working tree): the dynamic
  `button`/`div` tag pattern used for the clickable dossier row
  (`const Item = stillTracked ? 'button' : 'div'`) is byte-for-byte the
  same pattern already shipping in `components/lens/RecentMineCard.tsx`
  (`const Component = onSelect ? 'button' : 'div'`), so it type-checks by
  precedent. `lensRun<T>`'s `input` parameter is typed
  `Record<string, unknown>`, so passing `title: dossierTitle.trim() || undefined`
  is assignable. All new state is explicitly typed (`CreateDossierResult`,
  `Dossier`, `DossiersResult`) rather than inferred `any`.
- Fabrication re-grep after the edit: `grep -n "Math.random\|MOCK\|mock\|fake\|Lorem\|lorem" app/lenses/ghost-tracker/page.tsx components/ghost-tracker/*.tsx` → still zero hits.
- Manual reachability re-check of all 9 macro names against every
  `app/lenses/ghost-tracker/` and `components/ghost-tracker/` file: all 9
  now have a live call site (was 7 of 8 before this pass; `create` had
  zero, and the doc-implied `dossiers` read path didn't exist at all).
- `cd server && node --test tests/ghost-tracker-domain-parity.test.js` →
  **26 pass / 0 fail** (was 20 tests before this pass; +6 new: a
  `type`/`creator_id` regression assertion on `create`, and a full
  `describe("ghost-hunt.dossiers")` block — ordering/newest-first, cross-
  user isolation, empty-state, and the actor/db/limit guard rails). Updated
  the test file's in-memory `dtus` schema to add the `creator_id` and
  `type` columns (mirroring the real migration-001 + migration-087 shape)
  so the test harness doesn't silently diverge from production schema.
  Confirmed no other test file in `server/tests/` references
  `ghost-hunt`/`ghost_residue`/`ghost_sighting` (the two other
  ghost-prefixed test files, `frontend-ghost-click-detector.test.js` and
  `ghost-fleet-registration-sync.test.js`, are unrelated — a different
  "ghost" concept, verified by grep).
- Did not touch `server/domains/_recent-mine-bulk.js` or
  `server/domains/_dtu-recent-mine.js` (shared cross-lens files other
  domains' recent-mine wiring depends on, and other agents may be touching
  adjacent lenses concurrently) — the fix was made entirely on the
  ghost-hunt side (setting the columns those shared readers already
  expect), not by changing the shared readers.
- Project-wide `tsc --noEmit`, `verify-lens-backends.mjs`, and
  `grade-ux-polish.mjs` are left to the orchestrator's single end-of-wave
  run, per the task's instructions.
