# Foundry Lens (#125) — Capability Map (Frontend Rebuild Program, Wave 3)

> Derived, not asserted. Every number below has a reproduction command; every
> classification is backed by a grep or a full read of the file it's about.

Foundry is Concord's **no-code game / world builder**: compose Concord's
existing systems (terrain, NPCs, combat, economies, size-scaling, status
windows, cross-world travel…) as configurable building blocks into a
worldspec, validate it, compile it, and **publish it as a real, playable
`worlds` row** — then playtest, iterate, discover, and rate published games.

## Two files, two domain namespaces (read this first)

The lens is backed by **two** domain files that register under **five**
distinct domain strings — a structural fact that shapes the whole audit:

```
grep -c 'register("foundry"'  server/domains/foundry.js          # → 38
grep -oE 'register\("[a-z_]+"' server/domains/foundry-systems.js | sort | uniq -c
#   3 register("size"     2 register("skill_affinity")
#   3 register("status")  2 register("reincarnation")   → 10 total
```

1. **`server/domains/foundry.js`** (1,204 lines) — **38 macros**, all under the
   `"foundry"` domain string. This is the **builder surface**: system-registry
   reads, worldspec CRUD, the publish/unpublish/preview lifecycle, templates,
   NL-rule composition, and the seven Phase-8 "Roblox-Studio-parity" builder
   extensions (blueprints, playtest hot-reload, asset library, multiplayer
   config, games marketplace + ratings, analytics, collaborative editing).
2. **`server/domains/foundry-systems.js`** (181 lines) — **10 macros** under
   `"size"` / `"skill_affinity"` / `"status"` / `"reincarnation"`. These are
   **gameplay-runtime** operations, NOT builder operations (the file's own
   header says so). They read a published world's `rule_modulators[key]` config
   — written by the Foundry compiler when the worldspec enables the matching
   system — and apply the per-player, per-world effect at play time (shrink a
   player, compose their status window, reincarnate on death, grow personal
   skill affinity). **They are world-owned runtime, consumed inside the world
   lens at play time — not inside the Foundry builder.** Full judgment below.

Because `foundry-systems.js`'s filename stem still matches `foundry`,
`node scripts/lens-unsurfaced.mjs --lens foundry` scans it too but only
resolves the 38 `"foundry"` macros against the frontend (it keys on the
registered domain string). It reports **0/38 unsurfaced** — every builder
macro is string-referenced. That number is honest for the builder surface but
blind to the 10 runtime macros under the other four domain strings; those are
handled by the judgment call, not the script.

## Backend surface (the real depth being surfaced)

- **System Registry** — `server/lib/foundry/system-registry.js`, **34 composable
  systems** (`grep -cE "^\s{4}id: '" server/lib/foundry/system-registry.js`) in
  6 categories (world / character / combat / npc / economy / social), each with
  a real `configSchema` (enum/number/bool/text/range fields), `dependsOn` /
  `conflictsWith` graph, `worldScope`, and an `activation` kind
  (physics_modulator / rule_modulator / heartbeat_optin / content_seed /
  always_on). **All 34 are `status: 'available'`** — the Phase-7 systems flipped
  from `stub` to available, so the "soon"/"coming soon" stub badges in
  `ComponentPalette`/`ConfigPanel` are now dead-but-harmless branches (0 stubs).
- **Worldspec** — `server/lib/foundry/worldspec.js`: `emptyWorldspec` /
  `normalizeWorldspec` (drops unknown keys, clamps) / `validateWorldspec` (real
  dependency + conflict + config-graph validation via the registry).
- **Compiler** — `server/lib/foundry/compiler.js`: `compileWorldspec` turns a
  validated worldspec into `physics_modulators` + `rule_modulators` +
  `contentSeeds` + a Concord Link anchor, plus a `rule_modulators.foundry`
  provenance marker. This is the "overlay" publish model: a published Foundry
  game IS a first-class `worlds` row.
- **Templates** — `server/lib/foundry/templates.js`, file-driven from
  `content/foundry-templates/` (**4 on disk**: arena-clash, social-hub,
  starter-rpg, survival-frontier).
- **NL Rules** — `server/lib/foundry/rules.js`: LLM-first with a deterministic
  keyword-parse fallback (brain-offline is not an error — same posture as
  dream/forward-sim engines).
- **Builder extras** — `server/lib/foundry/builder-extras.js`: blueprint
  validate/normalize, asset validation, multiplayer normalization, analytics
  rollup (real day-1 retention + 7-day sparkline math), collab roster/presence.
- **Migrations** — 191 (`foundry_worlds`), 192 (`foundry_phase7`).

## Reference apps + parity target

**Roblox Studio** (compose systems/scripts, playtest hot-reload, asset library,
publish a live multiplayer place, games discovery + ratings, creator analytics,
Team Create collaboration) + **Core / Manticore** (select and configure
prebuilt game systems into a publishable world). The visual-scripting tab tracks
**Unreal Blueprints**; the NL-rules composer tracks a **Twine/rules-engine**
authoring flow.

> Parity target, owner's framing: **the only difference between Foundry and
> Roblox Studio should be the *primitive set* (Concord's substrate systems vs.
> Roblox parts/Lua) — not the builder feature surface.** Select → configure →
> validate → preview in-engine → publish → playtest hot-reload → discover →
> rate → analyze → co-edit all have to be real, designed flows.

## Classification (audit result)

Read in full: `page.tsx` (114→116 lines), and all of
`components/foundry/` — `BuilderStudio.tsx` (883), `FoundryCanvas.tsx` (545),
`FoundryActionPanel.tsx` (311, **deleted this pass**), `FoundryWorldsPanel.tsx`
(239), `ConfigPanel.tsx` (182), `ComponentPalette.tsx` (143),
`FoundryRulesPanel.tsx` (115), `FoundryPreview.tsx` (108),
`WorldBuilderRepos.tsx` (73), plus `lib/foundry/api.ts` (218).
`grep -n "Math.random\|MOCK\|mock\|fake\|Lorem\|lorem\|TODO"` across
`components/foundry/` → zero hits.

**The builder is genuinely strong and mostly already-real — the defect was one
broken generic duplicate sitting beside it, not a scaffold-over-nothing lens.**

### ALREADY REAL — designed, correctly-wired (kept as-is)

| Surface | Component | Macros (designed) |
|---|---|---|
| Front-door worlds loop (4-state: loading/error/empty/populated, a11y) | `FoundryWorldsPanel` | `list` / `create` / `delete` (+ Open→published world) |
| Full 3-pane builder (palette · canvas · schema-driven config) | `FoundryCanvas` + `ComponentPalette` + `ConfigPanel` | `systems` / `create` / `update` / `get` / `list` / `validate` (debounced live) / `publish` / `unpublish` / `preview` / `templates` |
| NL-rule composer (LLM/keyword badge, persists to worldspec) | `FoundryRulesPanel` | `compose_rule` |
| Live 3D preview (real ConcordiaScene against a transient `worlds` row) | `FoundryPreview` | `preview` / `preview_end` |
| Roblox-parity studio (7 tabs) | `BuilderStudio` | `blueprint_kinds/get/save`, `playtest_start/reload/end`, `asset_kinds/import/list/remove`, `matchmaking_modes`, `multiplayer_get/set`, `marketplace`, `rate`, `ratings`, `analytics`, `track_play`, `collab_roles/add/remove/list/ping` |
| Real live external reference (GitHub world-building repos) | `WorldBuilderRepos` | — (live GitHub API + Save-as-DTU) |

That covers **36 of the 38** `"foundry"` macros as designed features, each wired
to the correct macro return shape.

### BACKEND-CAPABLE-BUT-UNSURFACED (2 macros — redundant/superseded by design, no new UI)

- **`foundry.system_schema`** — returns one system's `configSchema` +
  metadata. **Redundant:** the bulk `foundry.systems` catalog response already
  inlines `configSchema` for every system, and `ConfigPanel` renders straight
  off that inlined schema. A per-system round-trip would be strictly more work
  for identical data. It stays as a lower-level API primitive (a caller that has
  only an id and no catalog can still fetch a schema). `lib/foundry/api.ts`
  exports `fetchSystemSchema` for that use; no component needs it today.
- **`foundry.validate_systems`** — validates a bare system *selection*
  (dependency/conflict/config) with no worldspec envelope. **Superseded** by
  `foundry.validate`, which validates the whole worldspec *including* the same
  system graph — and that fuller call is what `FoundryCanvas`'s live debounced
  validation uses. `validate_systems` remains the reusable inner primitive
  (`api.ts` exports `validateSystems`); surfacing it separately would duplicate
  the validation badge users already see.

Both are honestly redundant, not gaps — confirmed by reading the handler pairs
side-by-side. Neither warrants a bespoke panel.

### GENUINELY MISSING / broken — fixed this pass

- **`FoundryActionPanel` (311 lines) — a broken, generic, fabricated-contract
  duplicate. Deleted.** It was a `UniversalActions`-style 9-button grid
  ("List / Create / Validate / Preview / Foundry publish / Mint / DM / Public
  DTU / Next edits") built on a **guessed data contract that never matched the
  real `foundry.*` macros**, and on a fabricated **"item" / `kind`
  (scene/prefab/system)** concept that does not exist in the foundry domain
  (foundry builds *worlds*, which have no `kind`). Concretely, every read was
  wrong (verified against the handler returns):
  - `list` read `result.items` — real `foundry.list` returns `{ worlds }`
    (`server/domains/foundry.js:275`), so the existing-item dropdown was
    **always empty**.
  - `create` read `result.id` / `result.item.id` — real `foundry.create`
    returns `{ world }` (`:189`), so it **always reported "No id returned"**
    while silently minting an **orphan empty world** on the server (the panel's
    `kind`/`systemId` fields are dropped by `normalizeWorldspec`), and never
    captured an id — so its whole downstream Validate/Preview/Publish flow was
    dead.
  - `validate` read `result.issues` — real returns `errors` (`:331`), so issue
    details **never rendered**.
  - `preview` read `result.url` — real returns `previewWorldId` (`:570`), so it
    **always showed "No URL available."**
  This is the exact zero-generic-tendencies + zero-demo-content violation the
  program targets: a generic action array with fabricated success/labels
  duplicating a real designed surface. The real create → validate → preview →
  publish loop is fully and correctly covered by `FoundryWorldsPanel` +
  `FoundryCanvas` + `BuilderStudio` + `FoundryPreview`, so **nothing real was
  lost** by removing it.
- **`ManifestActionBar` (auto-generated ~22-button manifest wall) — removed
  from the page.** The generic-action-array the hard invariant forbids; the
  flagship proof unit (`app/lenses/music/page.tsx`) omits it too, and every
  action it auto-lists is already a designed control in the builder.

## The `foundry-systems.js` judgment (the load-bearing scope call)

**Verdict: the 10 macros are correctly WORLD-OWNED runtime, out of scope for the
Foundry *builder* lens. Left alone by design — not an unsurfaced builder gap.**

Reasoning, grounded in the code:

- **The author-side of these systems is already fully surfaced in the builder.**
  Each Phase-7 system is a first-class entry in the System Registry with
  `status: 'available'` and a real `configSchema`
  (`system-registry.js`: `size-scaling` → min/max scale, scale-change cost;
  `status-window` → style, hidden stats, titles; `skill-affinity-player` →
  learn rate, decay, cross-world carry; `isekai-reincarnation` → enabled,
  inherited fraction, reroll appearance). A builder **selects** them in
  `ComponentPalette` and **configures** them in `ConfigPanel`; the compiler
  writes each config into `rule_modulators.{size_scaling, status_window,
  skill_affinity, reincarnation}` at publish (`compiler.js`). That is exactly
  the builder's job, and it is done.
- **The runtime-side reads that same `rule_modulators[key]` config back at play
  time.** `foundry-systems.js`'s `worldSystemConfig(db, worldId, key)` pulls the
  compiled config out of the published `worlds` row and applies a per-player,
  per-world effect (`size.set` resizes a player; `status.window` composes their
  panel; `reincarnation.reincarnate` runs on their death handler). These need a
  live world + a player — a context that only exists *inside a published/preview
  world*, not at author time. This is directly analogous to how CLAUDE.md frames
  `fishing` / `garage` as world-owned features whose home is `/lenses/world`.
- **Building a runtime-systems panel *into the builder* would be the wrong home
  and would violate the invariants.** It would either need a fake player/world
  context (fabrication) or just echo the config the `ConfigPanel` already shows
  (generic redundancy). The builder already has the correct place to *experience*
  these systems: the real 3D **Preview** (`FoundryPreview` → `ConcordiaScene`
  against the compiled preview world) and the **Playtest** hot-reload tab
  (`BuilderStudio`), where the author enters the actual world as a player.

**Honest residual (a world-lens gap, not a foundry-builder gap):** these 10
runtime macros currently have **zero frontend callers anywhere** —
`grep -rn "lensRun('size'\|'reincarnation'\|'skill_affinity'\|name: 'window'"`
over `concord-frontend/` is empty, and there is no Status-Window HUD / Size
control / reincarnation-on-death prompt in the world lens yet. That is a
**scoped future build in `/lenses/world`** (player-facing HUDs for the four
Phase-7 systems, reading the same macros), explicitly deferred and named here
rather than papered over inside the wrong lens.

## What changed (files)

- **`concord-frontend/app/lenses/foundry/page.tsx`** — removed the
  `ManifestActionBar` mount, the broken `FoundryActionPanel` section, and the
  now-unused `PipingProvider` wrapper + imports; documented the retirement in
  the file header. Kept the real builder stack and the hide-when-empty
  cross-lens tail (`SessionRail` / `RecentMineCard` / `AutoActionStrip` /
  `CrossLensRecentsPanel`), matching the flagship music page's convention.
- **`concord-frontend/components/foundry/FoundryActionPanel.tsx`** — **deleted**
  (broken generic-contract duplicate; no other importer —
  `grep -rln FoundryActionPanel` → only itself + the page).
- **`docs/lens-specs/foundry-capability-map.md`** — this file.

No backend files were changed — the macro/compiler layer is real and correct;
the defect was entirely in one fabricated frontend duplicate.

## Verification

- `cd concord-frontend && npx eslint app/lenses/foundry/page.tsx` → clean, exit 0.
- `cd concord-frontend && npx vitest run components/foundry/FoundryWorldsPanel.test.tsx`
  → **5 pass / 0 fail** (tests the real front-door panel directly; unaffected).
- `cd server && node --test tests/foundry-domain-macros.test.js tests/foundry-domain-parity.test.js tests/foundry-phase7-systems.test.js tests/foundry-publish.test.js tests/foundry-preview.test.js`
  → **82 pass / 0 fail** (builder macros, domain parity, the 4 Phase-7 runtime
  systems, publish + preview lifecycle).
- `node scripts/lens-unsurfaced.mjs --lens foundry` → **0/38** builder macros
  unsurfaced (unchanged — the deleted panel's macros are all also referenced by
  the real components).
- Left untouched (no gap found on read): `FoundryCanvas`, `ComponentPalette`,
  `ConfigPanel`, `FoundryRulesPanel`, `FoundryPreview`, `BuilderStudio`,
  `WorldBuilderRepos`, `FoundryWorldsPanel`, `lib/foundry/api.ts`, and all of
  `server/domains/foundry*.js` + `server/lib/foundry/*.js`.
