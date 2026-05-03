# EvoEcosystem + Three Pillars

## Context
Two intertwined features for the next session:

1. **EvoEcosystem** — procedural flora/fauna with biome-aware spawning, harvest/hunt/tame interactions, raw → cooked food pipeline with player buffs, and EvoAsset-driven evolution of high-traffic zones.
2. **Three Pillars** — seed The Sovereign, Concord, and Concordia into the main hub as Conscious Emergent NPCs with rich authored lore.

The two features are tightly coupled: per the lore, **Concordia (goddess) IS the ecosystem**, so player behaviour toward flora/fauna directly drives her reactivity. The Sovereign mediates when player choices skew too hard toward Concord (cold optimization) or Concordia (wild excess). Concord himself binds naturally to the existing refusal-algebra system since he is, in the lore, the "refusal engine".

## What's already built (reuse, don't reinvent)

### Ecosystem substrate
- **Biomes**: 5 biomes by elevation (water / plains / forest / highland / mountain) at `server/lib/world-seeder.js:33`. Mirrored client-side.
- **Resource nodes**: `world_resource_nodes` table with respawn, depletion, biome keying. Gather pipeline at `server/lib/world-gathering.js`.
- **Procedural creatures**: `server/lib/procedural-creature.js` generates physics-valid bodies (biped, quadruped, winged-quad, etc.); world-flavor modifiers for fantasy/cyber/concordia exist.
- **Creature crossbreeding**: `creature_bonds` + `creature_lineage` tables (migration 083) — co-located creatures with bond ≥ 100 produce hybrids.
- **EvoAsset evolution**: 5-pass refinement (`server/lib/evo-asset/scheduler.js:39`) every ~5 min, fed by `evo_asset_interactions`. Already accepts player-recorded interactions.
- **PvP loot pattern**: `death_loot_bags` table + `pvp-loot.js:34` — direct template for creature drops.
- **Crafting engine**: `server/lib/crafting/craft-engine.js:26` — already DTU-keyed, already accepts `output_type: 'consumable'`.

### Authored NPC pipeline
- **Content seeder**: `server/lib/content-seeder.js:86` accepts NPCs with `id, name, faction_id, role, archetype, personality_traits, speech_patterns, backstory, narrative_context{current_goal, secret, fear}, is_conscious, is_immortal, link_walker, schedule, relationships, quest_hooks`.
- **Conscious Emergent precedent**: Maren Ashveil + Tollan Greave in `content/world/npcs.json` are `is_conscious=true`. Maren is also `is_immortal=true, quest_giver=true`.
- **Dialogue endpoint**: `GET /api/world/dialogue/:npcId` at `server/routes/world-narrative.js:144`. Hand-authored trees in `content/dialogues/*.json` (key `npcId:questId:phase`) bypass LLM entirely.
- **Narrative bridge**: `buildNPCTraits()` already enriches oracle context with backstory, faction, social signals (from v2.0 work), and professional knowledge.
- **NPC opinion system**: `server/lib/npc-relations.js:42` — per-NPC opinion / respect / fear / trust on each player. Drives reactivity.
- **Refusal algebra**: `server/lib/refusal-algebra/` — base-6 glyph system with arithmetic + semantic pattern matching. Currently abstract; perfect mechanical binding for Concord's "refusal engine" role and the Sovereign's "Refusal Field".
- **link_walker** flag: `content-seeder.js:333` already supports cross-world wandering NPCs via `concord_link_walkers` table.

### Food Lens (UI-only today)
- `concord-frontend/app/lenses/food/page.tsx` — rich artifact UI for recipes, meal plans, pantry, but **no cook action**.
- `server/domains/food.js` — `scaleRecipe`, `costPlate`, `spoilageCheck` — none of these consume inventory or produce cooked DTUs.

## What's genuinely missing
1. **Ambient fauna spawning per biome** — creatures today are narrative-triggered only.
2. **Loot drops on creature death** — `procedural-creature.js` has no `drops` field; NPC kills don't spawn loot.
3. **Butcher / skin / harvest-corpse workflow** — no UI, no endpoint.
4. **Cook action** — crafting engine ready, but no `food.cook` macro and no food-recipe DTUs seeded.
5. **Server-side time-limited player effects** — `Moodlet` exists frontend-only; no `user_active_effects` table.
6. **Inventory spoilage** — no `spoils_at` column on `player_inventory`.
7. **Per-player ecosystem score and alignment scalars** — Concordia and Concord need something to react to.
8. **Three pillar authored content** — `content/world/concordia/npcs.json` exists but doesn't include them; lore.json doesn't include the First Thought / First Breath / First Refusal arc; dialogue trees absent.
9. **Refusal Field mechanical binding** — refusal-algebra is abstract; the Sovereign's lore asks for narrative use.
10. **Hub world id reconciliation** — `_meta.json` says `world_id: "concordia"` but `narrative-bridge.js:161,366` defaults to `"concordia-hub"`. One of the two must win.

## Plan — six interwoven workstreams (ship together)

### W1 — Fauna spawning + creature drops (ecosystem foundation)
**Backend**
- Migration 094: add `creature_population` table `(world_id, biome, species_id, blueprint_dtu_id, count, last_tick)`.
- New `server/lib/ecosystem/fauna-spawner.js`. Wire into the heartbeat-registry from v2.0 at frequency `30` (~30 min). Logic:
  - For each (world_id, biome), top up to a per-biome target population using procedural-creature generation. Speciation rules drive whether deer / wolves / boar / fey-creature spawn in a forest.
  - Spawn writes a `world_npcs` row with `archetype='creature'`, `is_conscious=false`, plus a row in `creature_population`.
  - Honor existing creature_bonds → if two compatible species are co-located long enough, hybrid spawning fires through the existing crossbreeding pipeline.
- Extend `procedural-creature.js` blueprint with `drops: [{ item, qtyRange, rarity }]` and a `lifestyle: 'herbivore'|'carnivore'|'omnivore'` flag.
- New `server/lib/ecosystem/loot-tables.js`: per-archetype defaults (deer → meat/hide/sinew, wolf → meat/pelt/fang, fey → mana-essence/seed-of-stars).
- Hook into `npc-simulator.js` death handler: when a creature dies, write a `death_loot_bags` row keyed by the corpse so it can be claimed.

**Frontend**
- `BuildingRenderer3D` already handles entity rendering. Extend `AvatarSystem3D` to render creatures via the procedural skeleton path. Use the `body_topology` field that's already there.
- `WorldMarkers` (we just touched in cleanup) gains a creature-presence layer at low alpha so players can find them at distance.

**Verification**
- Walk into a forest → see ambient deer / boar / wolves.
- Kill a deer → corpse marker appears; calling claim endpoint adds raw_meat / hide to inventory.

### W2 — Butcher / harvest workflows
**Backend**
- New `server/routes/world-creature.js` exposing `POST /api/world/creature/:corpseId/butcher` body `{ tool, qualityMultiplier }`. Reads corpse, validates owner-of-kill, drops items into player_inventory.

**Frontend**
- Reuse the `GatheringMinigame.tsx` pattern as `ButcheringMinigame.tsx` — same needle-timing, different visual, calls the butcher endpoint with the resulting quality multiplier.
- Triggered from a corpse-marker click.

**Verification**
- Click corpse → minigame → succeed → meat + hide in inventory with spoils_at.

### W3 — Cooking pipeline (raw → cooked → buff)
**Backend**
- Migration 095: add `spoils_at INTEGER` to `player_inventory`. Add `user_active_effects(user_id, effect_id, kind, magnitude, started_at, expires_at)`.
- New `server/lib/ecosystem/cook-engine.js`. Wraps `craft-engine.executeCraft()` for `meta.type='food_recipe'` DTUs. Output is a consumable DTU with `spoils_at = now() + recipe.shelfLifeHours`.
- New `server/domains/food.js` macro: `cook` (`recipeId, ingredients`) → calls cook-engine.
- New `POST /api/world/consume/:dtuId` — applies the food's `effects[]` to the player as `user_active_effects` rows; deducts inventory.
- Heartbeat sweep for expired effects + spoiled inventory (every 5 ticks).

**Frontend**
- Extend the crafting lens UI (we just shipped) with a `Cook` sub-tab pulling food_recipe DTUs.
- New `CookingMinigame.tsx` — texture/timing on the heat. Reuses GatheringMinigame frame.
- HUD widget showing active effects with their countdown timers (frontend Moodlet system already exists; we just need to read from `/api/world/effects/me`).

**Verification**
- Cook stew from raw_meat + herbs → consume → see "+stamina_regen" badge for 5 min.
- Skip eating → meat goes off after 24h game time.

### W4 — Per-player ecosystem score + alignment
**Backend**
- Migration 096: `player_world_metrics(user_id, world_id, ecosystem_score, concord_alignment, concordia_alignment, refusal_debt, updated_at)`. Defaults zero.
- New `server/lib/ecosystem/score-engine.js`:
  - **ecosystem_score** rises with sustainable harvest, taming, releasing, planting; falls with overharvest, killing pregnant fauna, clearcutting forests.
  - **concord_alignment** rises with min-max optimization, hoarding, predictable choices, council voting "by the rules".
  - **concordia_alignment** rises with wild creation (recipes published, blueprints spawned, music shared), erratic exploration, gifts to NPCs.
  - **refusal_debt** accumulates when player breaks consequence rules (PvP without consent, stealing from authored NPCs); decays slowly.
- Hooks into existing events: gather, kill, craft, publish, vote — non-blocking writes.
- Exposed at `GET /api/world/me/metrics`.

**Frontend**
- Small profile widget showing the four scalars as a radar / four-bar.

**Verification**
- Harvest unsustainably → ecosystem_score drops measurably; metrics endpoint reflects it.
- Optimize a build to peak meta → concord_alignment rises.

### W5 — Three Pillars + Coalition seeding (expanded)
**Content** (new files in `content/world/concordia/`)
- `npcs.json` — append:
  - **The Sovereign** (`sovereign_first_refusal`): `is_conscious=true, is_immortal=true, link_walker=true, archetype='legend'`. Backstory: First Refusal + Great Refusal. `narrative_context.fear`: "either of them dominates and the world flattens." Schedule: appears at world events with high refusal_debt or skewed alignment. Unlocked behaviorally per user choice.
  - **Concord** (`concord_first_thought`): `is_conscious=true, is_immortal=true, archetype='advisor'`. Speech style: precise, sharp-tongued. `narrative_context.current_goal`: "elegant minimum across all minds." Schedule: Refusal Lattice node when not summoned. Unlocks when `concord_alignment` crosses threshold.
  - **Concordia (goddess)** (`concordia_first_breath`): `is_conscious=true, is_immortal=true, link_walker=true, archetype='legend'`. Schedule: wandering wild biomes. Reacts to `ecosystem_score`. Always present in wilderness — she IS the ecosystem.
  - **The Enforcer** (`coalition_enforcer`): `is_conscious=true, is_immortal=true, archetype='warrior'`. Shock-hammer wielder. `narrative_context.current_goal`: "respect the truce, but never forget." Wanders the hub forge district. Was Coalition; signed the truce. Holds residual grudge that surfaces in dialogue if player has high `concord_alignment` (sees them as Sovereign loyalists by extension).
  - **The Luminary** (`coalition_luminary`): `is_conscious=true, is_immortal=true, archetype='aerial'`. Aerial mastery + gravity manipulation. Frequents observatories and high places. Was Coalition; made peace with the Sovereign first of all members; now mediates between former Coalition and the Pillars.
- `dialogues/{sovereign,concord,concordia,enforcer,luminary}_*.json` — hand-authored idle + greeting + alignment-shift trees. Bypass LLM via existing seeder key (`npcId:questId:phase`).
- `lore.json` — append `era: "primordial"` arc (First Thought, First Breath, First Refusal, First Great Clash, Day Concordia Almost Left, Battle of the First Refusal) + `era: "great_refusal"` arc (Coalition Forms, The Three-Day War, Sovereign Refuses Alone, Concord Link Opens, Concordia Claims the Heart, The Truce). The Great Refusal lore retroactively explains the existing `concord_link_walkers` table — walkers are beings who answered the call.

**Backend hooks** (bind to existing pipelines)
- `narrative-bridge.buildNPCTraits()` extends with `playerAlignment` (the four scalars from W4) so the LLM prompts for these five NPCs reference what the player has been doing.
- The Sovereign appears via the heartbeat-registry — new `sovereign-visit-scheduler` checks alignment imbalance per player, fires a `world_events:sovereign_visit` event when threshold crossed (rate-limited per player to avoid pestering).
- Concord visits per session when `concord_alignment` is dominant; Concordia visits when player enters wild biomes with positive or strongly negative `ecosystem_score`.
- **Hub neutral-zone enforcement**: new middleware on combat / hostile-action endpoints checks `world_id === 'concordia-hub'`; if so, hostile actions are gated unless the actor holds a "neutral-zone exemption" (which only Concordia can grant via in-game dialogue). This is the Great Refusal made law.
- **Concord Link as canonical system**: the existing `concord_link_walkers` table gains a small lore-pointer field (`origin_event: 'great_refusal'`) so the link's origin is queryable. No structural changes; pure metadata.
- `world_id` reconciliation: settle on `"concordia-hub"` (it's referenced more often than `"concordia"`); update `content/world/concordia/_meta.json` to match. Migration to update existing rows is small — `world_id='concordia'` → `'concordia-hub'`.

**Verification**
- Walk in the forest → eventually meet Concordia. Ecosystem score positive → warm dialogue. Negative → cold, fauna scatter.
- Open the locker / hotbar with a heavily optimized build → trigger Concord visit, get a sharp-tongued audit.
- Push refusal_debt high → Sovereign visit, possible quest under a "Refusal Field" condition.

### W6 — Refusal Field binding (Sovereign's mechanical signature)
**Backend**
- New `server/lib/refusal-field.js` wraps the existing refusal-algebra. Exposes:
  - `currentField(worldId)` — global refusal-field intensity tied to total `refusal_debt` across players in that world.
  - `applyTemporaryRefusal(worldId, kind, durationMs)` — used by Sovereign quest beats. Examples:
    - `kind='death_suspended'` — players cannot die for the duration (the lore's Day Concordia Almost Left moment).
    - `kind='harvest_disabled'` — players cannot gather for the duration.
- Heartbeat-registry entry runs every tick; while a refusal field is active, world systems gate on it.

**Frontend**
- World HUD shows a brief banner when a Refusal Field is active, themed glyphs from the existing refusal-algebra.

**Verification**
- Trigger Sovereign quest where they declare "Death is refused" → kill events suppressed for 30s → Concordia in dialogue acknowledges the moment.

## Critical files to be modified or created

**Modified**
- `server/lib/narrative-bridge.js` — add `playerAlignment` enrichment for the three pillars.
- `server/lib/npc-simulator.js` — wire creature death → loot bag.
- `server/lib/procedural-creature.js` — add `drops`, `lifestyle` fields.
- `server/lib/world-seeder.js` — biome → fauna species table additions.
- `server/server.js` — register new heartbeat modules + routes.
- `server/domains/food.js` — add `cook` action.
- `concord-frontend/app/lenses/crafting/page.tsx` — add Cook sub-tab.
- `concord-frontend/components/world-lens/AvatarSystem3D.tsx` — render creatures.
- `concord-frontend/components/world-lens/WorldMarkers.tsx` — creature presence layer.
- `concord-frontend/lib/concordia/player-stats.ts` — wire active effects from server.

**Created**
- `server/lib/ecosystem/fauna-spawner.js`
- `server/lib/ecosystem/loot-tables.js`
- `server/lib/ecosystem/cook-engine.js`
- `server/lib/ecosystem/score-engine.js`
- `server/lib/refusal-field.js`
- `server/routes/world-creature.js`
- `server/migrations/094_creature_population.js`
- `server/migrations/095_inventory_spoilage_and_effects.js`
- `server/migrations/096_player_world_metrics.js`
- `concord-frontend/components/concordia/crafting/ButcheringMinigame.tsx`
- `concord-frontend/components/concordia/crafting/CookingMinigame.tsx`
- `concord-frontend/components/concordia/HUD/ActiveEffectsBar.tsx`
- `content/world/concordia/dialogues/{sovereign,concord,concordia,enforcer,luminary}_*.json`
- Lore + npcs.json appends for the three pillars + the Enforcer + the Luminary.
- `server/lib/concordia/neutral-zone.js` — middleware enforcing the Great Refusal truce in `concordia-hub`.

## Reused functions (cite to avoid duplication)
- `server/lib/crafting/craft-engine.js:26` — `executeCraft()` for cooking.
- `server/lib/world-gathering.js` — gather plumbing (for picking herbs that feed cooking).
- `server/emergent/heartbeat-registry.js` — register all new periodic modules (just shipped in v2.0).
- `server/lib/evo-asset/npc-shadow-bridge.js:62` — `recordInteractionFromPlayer()` for high-traffic flora/fauna evolution.
- `server/lib/refusal-algebra/operations.js:28` — base-6 ops for the Refusal Field.
- `content-seeder.js` is_conscious / is_immortal / link_walker flags — exactly what the three pillars need.
- `narrative-bridge.buildSocialSignals()` + `buildProfessionalKnowledge()` (from v2.0) — extend with `playerAlignment` rather than parallel paths.

## End-to-end verification
1. Player walks into a forest → ambient deer + boar visible.
2. Player kills deer → corpse marker → butcher minigame → raw_meat + hide in inventory with spoils_at.
3. Player gathers herbs.
4. Player opens crafting lens → Cook tab → executes "stew" recipe → cooked DTU created.
5. Player consumes stew → +stamina_regen for 5 min visible in HUD.
6. Player overharvests → ecosystem_score plummets → wanders into the wild → meets Concordia who is cold; nearby fauna scatter.
7. Player opens hotbar with a min-maxed loadout → Concord arrives, audits build, gives sharp dialogue tied to refusal-algebra glyphs.
8. Player accumulates refusal_debt → The Sovereign appears, declares a Refusal Field — death is suspended for 30s while the test plays out.
9. Three pillars' lore is queryable in the lore browser; their dialogue trees reference player's recent Social Lens posts (from v2.0 social-npc-bridge) and ecosystem score.

## Open questions
1. Three pillars manifestation: appear from day one, or unlock after the player has crossed a behavior threshold?
2. Ecosystem score axes: single scalar or the four-axis approach above?
3. Cooking minigame style: timing/heat (like Gathering) or something more ambitious (texture / flame)?
4. Should creature corpses be claimable by anyone or only the killer?
5. World id reconciliation: which way (`concordia` vs `concordia-hub`) — current authored content uses both; we should pick one and migrate.
