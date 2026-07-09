# Crafting Lens — Capability Map (Frontend Rebuild Program, Wave 3)

> Derived, not asserted. Reproduce the macro count:
> `grep -c 'registerLensAction("crafting"' server/domains/crafting.js` → 21
> No inline `server.js` registrations for the `crafting` domain (confirmed:
> `grep -n 'register("crafting"\|registerLensAction("crafting"' server/server.js`
> returns nothing) — all 21 macros live in the dedicated domain file. The
> lens also calls a dedicated REST surface (`server/routes/crafting.js`,
> mounted at `/api/crafting/*`) that is a separate, non-macro path for
> recipe design/execution/skills/resource-bars/character-progress — both
> surfaces are real and this lens correctly uses both.

## Reference apps

This is an MMO crafting/profession system. The parity target:

1. **WoW professions / FFXIV crafting** — recipe collection, a "can I craft
   this right now" gate against live inventory, tiered output quality/crit
   crafting, batch crafting, a marketplace to buy/sell recipes and goods,
   skill leveling tied to crafting actions.
2. **Minecraft's crafting + enchanting** — visual grid-based assembly,
   recipe discovery/experimentation (combine unknown materials to discover
   a new recipe), a materials-gathering loop that feeds back into what you
   can build.

Parity target, stated explicitly: the only difference between this lens and
WoW/FFXIV-professions-plus-Minecraft-discovery should be catalog size and
world-specific flavor — the assembly grid, discovery, batch queue,
craftable-now gate, quality/rarity tiers, gather planning, and
favorites/history should all be real mechanics backed by real state, not a
UI approximation.

## Capability checklist

| Capability | Disposition | Notes |
|---|---|---|
| Personal recipe locker (food / fighting style / spell / blueprint), search + type filter | ALREADY REAL | `app/lenses/crafting/page.tsx` `MineTab` → `/api/personal-locker/dtus` |
| Recipe favoriting | ALREADY REAL | `MineTab` → `crafting.favorite_toggle`/`favorite_list` |
| Cook/execute a food recipe from the locker | ALREADY REAL | `MineTab` → `/api/world/cook` |
| List a recipe on the marketplace (flat or 3-tier usage/remix/commercial pricing) | ALREADY REAL | `ListingModal` → `/api/personal-locker/dtus/:id/list-on-marketplace` |
| Forge — execute a recipe against live `player_inventory` with skill/resource gates shown inline | ALREADY REAL | `ForgeTab` → `/api/crafting/recipes` + `/api/crafting/execute`, live requirement-vs-inventory comparison |
| Browse marketplace (search/type filter/sort by price), buy through the royalty-cascade purchase path | ALREADY REAL | `BrowseTab` → `/api/marketplace/artifacts` + `/api/marketplace/purchaseWithRoyalties` |
| Character progression (level, upgrade points), resource bars (hp/mana/stamina/etc.) with spend-a-point upgrade | ALREADY REAL | header `ResourceBars` → `/api/crafting/character/:worldId`, `/api/crafting/resource-bars/:worldId`, `/api/crafting/upgrade-bar` |
| Crafting skill levels + manual training, plus the separate lived/practiced-skill progression (mastery badges) | ALREADY REAL | `SkillsTab` → `/api/crafting/skills`, `/api/crafting/skills/train`, `/api/worlds/skills/mine` + `ProgressionPanel` |
| Recipe authoring | ALREADY REAL | `RecipeAuthorPanel` (Author tab) |
| Visual 3×3 assembly-grid pattern builder (drag/drop or type-and-click), save/load/delete named patterns | ALREADY REAL | `CraftingWorkbench` → Assembly Grid tab → `crafting.grid_save`/`grid_list`/`grid_delete` |
| Recipe discovery/experimentation (combine materials → discover a new recipe, repeat attempts tracked) | ALREADY REAL | `CraftingWorkbench` → Discovery tab → `crafting.discovery_combine`/`discovery_list` |
| Craft queue with batch "craft all" | ALREADY REAL | `CraftingWorkbench` → Craft Queue tab → `crafting.queue_add`/`queue_list`/`queue_remove`/`queue_craft_all` |
| "Craftable now" live filter against every recipe vs. current world inventory | ALREADY REAL | `CraftingWorkbench` → Craftable Now tab → `crafting.craftable_now` |
| Quality/rarity tier ladder + crit-craft roll simulator (skill + focus biased) | ALREADY REAL | `CraftingWorkbench` → Quality Tiers tab → `crafting.quality_tiers`/`quality_roll` |
| Material gather planner (consolidated shopping list across every recipe, netted against inventory, with world gather-node hints) | ALREADY REAL | `CraftingWorkbench` → Gather Plan tab → `crafting.gather_plan` |
| Crafting history log + tier distribution stats + favorites list | ALREADY REAL | `CraftingWorkbench` → Favorites & Log tab → `crafting.history_list`/`history_clear`/`favorite_list`/`favorite_toggle` |
| Compact read-only recipe + skill ledger (save-as-DTU) | ALREADY REAL (fixed this pass — was silently reading the wrong field names) | `RecipeLedger` → `/api/crafting/recipes` + `/api/crafting/skills` |
| Recipe listing/counting via the macro layer (`crafting.list`/`crafting.counts`) | GENUINELY-UNSURFACED, no action needed | superseded by `/api/personal-locker/dtus` (already used by `MineTab`/header stat strip), which returns richer DTU metadata than these macros would; wiring them would only add a worse duplicate, not new capability |
| Marketplace browse via the macro layer (`crafting.marketplace_browse`) | GENUINELY-UNSURFACED, no action needed | superseded by `/api/marketplace/artifacts` (already used by `BrowseTab`), the shared marketplace surface every other lens's browse view also uses — wiring the macro variant would fork marketplace browsing onto a second, inconsistent code path |
| Recipe preflight check via the macro layer (`crafting.forge_preflight`) | GENUINELY-UNSURFACED, no action needed | on inspection this macro only reports `feasible` when a recipe has **zero** requirements at all (`skillReqs.length === 0 && resourceReqs.length === 0`) — it never compares against actual inventory quantities, so it is strictly weaker than `ForgeTab`'s existing `RequirementsRow`, which does the real `have >= need` comparison per resource. Wiring it would present users with a *less* accurate readiness check next to a more accurate one already on screen. |

No GENUINELY MISSING items surfaced against the WoW/FFXIV + Minecraft
checklist — assembly, discovery, batch crafting, craftability gating,
quality tiers, gathering, and marketplace are all real, backed by real
macros or real REST routes, each with its own designed (non-generic) panel.

## What was genuinely wrong (confirmed by reading the code, not assumed)

This lens, like `council`, is not a scaffold — 6 tabs across the top-level
page plus 7 sub-tabs inside `CraftingWorkbench`, all bespoke, all wired to
real macros/routes. One real, confirmed defect class was found:

**`components/crafting/RecipeLedger.tsx` read field names the backend never
returns**, so it silently rendered near-empty despite real data existing:

1. The skills query expected `response.data.skills` — but
   `GET /api/crafting/skills` returns `{ ok, skillLevels, skillDTUs }` (see
   `server/routes/crafting.js`). `response.data.skills` is always
   `undefined`, so the fallback `|| []` fired every time — the Skills panel
   permanently showed "No skills tracked," even for a player with real
   skill levels (confirmed correctly read elsewhere on the same page: the
   top-level `SkillsTab` already reads `skillLevels` correctly).
2. The recipes query typed each row as `{ name, kind, tier, ingredients,
   output, difficulty, xpReward, author }` — but `GET /api/crafting/recipes`
   returns raw `dtus` table rows (`id`, `title`, `data` — a parsed JSON blob
   whose real shape is `{ spec: { output, skill_requirements,
   resource_requirements } }`, matching exactly what `ForgeTab` on the same
   page already parses correctly). Every recipe row rendered with `x.name`
   falling back to the raw id, and `kind`/`tier`/`difficulty`/`xpReward`/
   `output` all silently blank, because none of those top-level fields
   exist on a real row.
3. A secondary, smaller instance of the same defect class: the top-level
   page's `SkillsTab` read `s.worldType` — the real `player_skill_levels`
   column is `native_world_type` — so the per-skill world-type suffix
   silently never rendered (a soft omission, not a crash, but still wrong
   data being read).

None of this was fabricated data (no `Math.random()`, no hardcoded arrays) —
it was a field-name mismatch between the frontend's guessed shape and the
backend's real shape, the same defect class the Wave-2 audit found in
`metalearning` ("frontend read `type`/`successRate` fields the backend
doesn't return").

## What changed

- **`concord-frontend/components/crafting/RecipeLedger.tsx`** — `Recipe`/
  `Skill` interfaces replaced with `Recipe`/`SkillLevel` interfaces that
  mirror the real REST response shapes; the skills query now reads
  `data.skillLevels`; the recipes query reads `data.recipes` and a new
  `recipeSpec()` helper extracts `data.spec` (parsing `data` when the API
  returns it as a JSON string, same as `ForgeTab` already does); both render
  blocks and the `SaveAsDtuButton` content string were updated to the real
  fields (`title`, `spec.output.type/name/quality`, `spec.skill_requirements`/
  `resource_requirements` counts; `skill_type`, `level`, `xp`/`xp_to_next`,
  `native_world_type`).
- **`concord-frontend/app/lenses/crafting/page.tsx`** — `SkillRow` interface
  corrected from `worldType`/`experience`/`total_experience` to the real
  `native_world_type`/`xp`/`xp_to_next`; the two render sites updated to
  match.
- No backend changes were needed — `server/routes/crafting.js` and
  `server/domains/crafting.js` were already correct; the bug was entirely in
  which fields the frontend read off an already-correct response.

## Verification

- `npx eslint app/lenses/crafting/page.tsx components/crafting/RecipeLedger.tsx components/crafting/CraftingWorkbench.tsx` — clean (0 errors, 0 warnings).
- `node scripts/verify-lens-backends.mjs` — `crafting` still WIRED.
- `node scripts/grade-ux-polish.mjs --honest` — `crafting`: `tier: "polished"`,
  `isGenericScaffold: false`.
- No existing crafting-lens frontend test file (confirmed by grep) — nothing
  to update; the corrected field reads are exercised by the existing
  `server/tests/behavior/lens-behavior-smoke.behavior.js` auto-derived shape
  coverage for the `crafting.*` macro family and by the `/api/crafting/*`
  route tests already in `server/tests/`.
