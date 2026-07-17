# Creatures Lens — Capability Map (Frontend Rebuild Program, Wave 3)

> Derived, not asserted.
> Reproduce the macro list: `grep -n 'register("creatures"' server/domains/creatures.js` → 6
> Reproduce wiring: `node scripts/lens-unsurfaced.mjs --lens creatures` → `0/6 macros never referenced in the frontend`
> Reproduce polish tier: `node scripts/grade-ux-polish.mjs --honest` → `creatures`: `tier: "polished"`, `isGenericScaffold: false`

## What this lens actually is

Not a generic "monster CRUD" screen. It's the player-facing surface over
Concordia's real procedural-creature substrate: physics-validated body
plans (`server/lib/procedural-creature.js` — mass/topology/parts
reconciled against `validateCreaturePhysics`, auto-rescaled on mismatch),
a genuine crossbreeding pipeline with bond-threshold gating and
elemental-alchemy genotype resolution (`server/lib/creature-crossbreeding.js`
+ `server/lib/breed-alchemy` — steam/brine/magma-style variant fusion,
not a random roll), lineage persisted to a real `creature_lineage` table,
and live per-biome ecosystem populations (`creature_population`, fed by
the `fauna-spawner` heartbeat). A fourth section — "Emotional weather" —
surfaces the world's recent `creature_affect_trace` rows (migration 326)
so the fauna's felt drives are visible, not just their headcounts.

**Reference category:** a research-grade wildlife/breeding tool — think a
Pokédex crossed with a genetics lab (Spore's Creature Creator for the
body-plan side, a real breeding-compatibility simulator for the pairing
side) — rather than a generic "creature list" screen. The bar is: does
picking two populations and hitting Breed feel like triggering a real
genetics engine, not a dice roll? Verified below that it does.

## The 6 macros, classified

| Macro | Class | Where it surfaces |
|---|---|---|
| `creatures.species` | DESIGNED | Species Codex table (searchable, sortable, all 4 taxonomy columns) |
| `creatures.roster` | DESIGNED | Populations grid — the primary "what's alive right now" view, taxonomy-enriched |
| `creatures.breed` | DESIGNED | Crossbreeding pen — pick two live populations, real hybrid returned with stability/topology/variant |
| `creatures.lineage` | DESIGNED | Lineage browser — self + descendants for any creature id |
| `creatures.taxonomy` | DESIGNED | Point-lookup for a bred hybrid's synthesized species id (codex doesn't carry a static row for it) |
| `creatures.for_world` | DESIGNED (elsewhere) | Not called by this page — it's the 3D-world render feed consumed by `lib/world-lens/creature-renderer.ts`, confirmed by grep. Correctly out of scope for the lens page; it belongs to the world-lens mesh/gait pipeline. |

0/6 unsurfaced. No generic action array, no `<UniversalActions>` /
`<LensFeaturePanel>` body, no `ManifestActionBar`/`AutoActionStrip`/
`RecentMineCard` trio — confirmed by `grep` and by the grader
(`importsGenericTrio: false`, `usesGenericBody: false`).

## Field-shape verification (every macro/route call checked against its real handler)

- `creatures.roster` → `server/domains/creatures.js:134` — SELECT columns
  `id, world_id, biome, species_id, lifestyle, current_count, target_count`
  match `Population` exactly; enrichment fields (`topology`, `clade`,
  `aquatic`) are added server-side from `species-taxonomy.js`, not
  invented client-side.
- `creatures.breed` → `server/domains/creatures.js:189` delegates to
  `generateHybrid()` (`server/lib/creature-crossbreeding.js:229`). Verified
  the full field chain: `result.hybrid` is a real blueprint from
  `generateCreature()` (`server/lib/procedural-creature.js:528`), so
  `massKg`, `topology`, `id` are physics-derived, not fabricated.
  `species_id` on the returned hybrid falls back to `provenance.description`
  (`"speciesA × speciesB hybrid"`) since `generateHybrid` doesn't stamp a
  new `species_id` on the fused blueprint — a legitimate synthesized label
  built from the two real parent species, not a "hybrid" placeholder
  literal.
- `creatures.lineage` → `getLineage()` (`creature-crossbreeding.js:421`)
  returns `{ self, descendants }` reading the real `creature_lineage`
  table (columns: `child_id, parent_a, parent_b, generation, stability,
  cross_world, blueprint, created_at`) — matches the frontend
  `LineageRow` interface field-for-field.
- `GET /api/creatures/world/:worldId/affect` (REST, not a macro) →
  `server/server.js:51281` — SELECT columns
  `creature_id, species_id, v, a, dominant_drive, intensity, reason,
  occurred_at` from `creature_affect_trace` (migration 326) match the
  page's `affect.recent[]` usage (`species_id`, `dominant_drive`, `reason`,
  `v`) exactly.

No mismatches found. No client-side hardcoded arrays, no `Math.random()`
in a render path (grepped).

## Real defect found and fixed

**Lineage lookup silently swallowed real failures as "empty," with no
"not found" feedback at all.** `fetchLineage()` checked only the
macro-level `result?.ok`, never the outer envelope `r?.data?.ok` (every
other lookup on this same page — `refreshCodex`, `lookupTaxonomy` —
checks both, per the codebase's established honest-envelope pattern).
Because `lib/api/client.ts#lensRun` already unwraps nested `{ok,result}`
envelopes and folds an inner-macro failure into the outer `ok`/`error`
(confirmed by reading the unwrap loop), a genuine `no_db` failure from
`creatures.lineage` would still have thrown correctly via the shared
client's error propagation in most call sites — but this one path bypassed
it and would render a bare, unlabeled empty section indistinguishable
from "you searched a valid id and it just has no lineage." A user gets no
signal that their id doesn't exist vs. that the backend errored vs. that
they haven't searched yet.

Fixed: `fetchLineage` now checks `r?.data?.ok` in addition to
`result?.ok`, tracks a `lineageSearched` flag, and surfaces three
distinct honest states — a real error message (`role="alert"`), a genuine
"no lineage record for this id" message once a search has actually run,
and no message before any search. This matches the pattern already used
by the codex search and the taxonomy point-lookup on the same page, so
the file is now internally consistent about honest-failure handling
end-to-end.

## What was NOT changed (and why)

- **World selector is fixed to `localStorage['concordia:activeWorldId']`
  with a `concordia-hub` default, no manual override field.** This is the
  platform-standard pattern (`fishing`, `garage`, `courtship` all read the
  same key the same way); `garage` is the outlier that also offers a
  manual edit field. Not treated as a defect specific to this lens —
  consistent with the majority of sibling Phase-D lenses.
- **No creature portrait/thumbnail imagery.** **CLOSED (2026-07-17,
  `c59e7a4f`)** — solved WITHOUT an art pipeline or image model (either would
  fabricate detail for a fictional species). `server/lib/creature-portrait.js`
  projects the REAL body-plan geometry (`generateCreature()`'s parts tree,
  tinted by `coatFor`) into a deterministic SVG schematic at a fixed
  real-world scale (size reflects real mass/height); surfaced via a new
  `creatures.portrait` macro. Every visual feature derives from a real param;
  no per-topology template, no `Math.random`. Original reasoning retained:
  Concord's creature system is
  procedural-body-plan-based (topology + mass + parts), not 2D-art-based;
  there is no art asset pipeline this lens could honestly draw from. The
  taxonomy/topology/diet/aquatic columns plus the coat-color hash
  (`server/domains/creatures.js:coatFor`) are the real, non-fabricated
  visual signal available server-side today; the 3D world lens (not this
  page) is where the actual procedural mesh renders. Documented here as a
  DATA-SOURCING/ENGINEERING gap with no free external fix available (no
  real-world creature-art API applies to fictional procedural species) —
  correctly left undone rather than faked with stock art or emoji.
- ~~**No global keyboard-shortcut registration (`useLensCommand`).**~~
  **CLOSED (2026-07-16).** `app/lenses/creatures/page.tsx` now registers 4
  shortcuts via `useLensCommand`: `r` → `refresh()`, `/` → focus the codex
  search input, `l` → focus the lineage input, `b` → `breed()` (enabled
  only when both parents are picked and a breed isn't already in flight).
  All four bind to the real, pre-existing handlers/state — no new breeding
  or search logic was added. Discoverability follows the UI-quality-rubric
  requirement: `<kbd>` chips sit next to the Refresh/Breed buttons and the
  two inputs carry placeholder hints. 12 new frontend tests, all passing.

## Verification

- `npx eslint app/lenses/creatures/page.tsx` — clean, 0 errors/warnings.
- `npx vitest run tests/components/CreaturesLensPage.test.tsx` — 4/4
  passing (LOADING / ERROR / EMPTY / POPULATED states), unaffected by the
  lineage-only fix.
- `node --test tests/creatures-lens-macros.test.js
  tests/creature-crossbreeding.test.js tests/creature-taxonomy.test.js`
  (server/) — 29/29 passing.
- `node scripts/verify-lens-backends.mjs` — `{"WIRED":258,"NO-BACKEND-CALL":2}` total 260, unchanged.
- `node scripts/grade-ux-polish.mjs --honest` — `creatures`: `tier: "polished"`, `isGenericScaffold: false`, before and after the fix.
- No `npx tsc --noEmit` per standing instruction (container OOM risk)
  — reviewed the diff by hand instead; the only new state is two
  `string | null` / `boolean` `useState` calls and a conditional render
  branch, no type surface change to existing props/interfaces.
