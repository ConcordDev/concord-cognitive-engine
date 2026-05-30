# Living Society — propertied resources → labor → one sparks-flow graph → bottom-up politics

## Context

The DEPTH_BALANCE_PLAN is complete and verified (32/32 shipped items present, zero stubs;
the CONCORDIA_PLAN T-series is stale-done). The next initiative is the user's north star, in two
joined halves: **(A) a foundational resource & crafting substrate** — "the basis of everything," where
every resource carries properties (potency/affinity/stability/tier) and all UGC (spells/items/powers/
food/buildings) is crafted from them, including procedural food + crossbred materials whose names/effects
inherit and recombine over time; and **(B) society as ONE economic-flow graph** — occupations produce/
transform/move those resources, pay flows along employment edges, **corruption = flow-diversion,
grievance = unpaid flow, governance = flow control, rebellion = the response to flow-capture** — with
taxonomy-complete settlements, seeded families, and bottom-up movements, all surfaced so it's *felt*,
not silent. (A) is the literal foundation under (B): resources are the currency of the labor→economy loop.

Four real-code audits (not docs) confirm this is **mostly assembly**:

- **Labor works but is invisible.** `npc-routines.js` (activity kinds) + `npc-economy.js`
  (`performGather/Craft/Trade/consumePersonalNeeds`, scarcity) write only ledgers
  (`npc_inventory`/`economy_flows`/`regional_scarcity`) — never `world_buildings`/`claim_crops`/
  `claim_entities`. `world_buildings` even has a `'construction'` state with **no progress column
  or labor path**. Roster is combat-shaped (warrior/hunter/scholar/mystic/healer/guard/trader) —
  **no farmer/builder/miner/logger/miller**.
- **Sparks flow one-way down.** `users.sparks`+`sparks_ledger` (players); `world_npcs.wealth_sparks`
  (NPCs accumulate per tick). **No wage/payday/employer edge, no NPC→player flow.** `realms.treasury`
  (1000) + `tax_rate` (0.10) columns exist but are **dead — zero code reads them**. No corruption/skim.
- **Politics blocks exist, the connective layer doesn't.** Grudges (`npc-asymmetry`, player-targeted
  only), NPC↔NPC conversations (mig 118) + player-only mail, schemes+accomplices (NPC-target only),
  12m scheme-overhear counter-intel (player-detect only), faction stances (**no rebellion**),
  `realm_citizens.loyalty`, and load-bearing combat-impact poise (civilian ~5.2 vs enforcer ~17 →
  networking is forced). **The keystone — a cross-tier `movement/cell` membership graph — is entirely
  MISSING.**
- **Per-world reskin is half-built.** tunya (47 professions) + cyber (8 industries + decking) have rich
  `professions.json`/`industries.json` that **`content-seeder` never reads** (dead content); the other
  7 worlds lack them. Authored tyranny (Augmented Children, Iron Rose, House Voss, Vesper Kane, Calla
  Bren) is present in every world's `lore.json` — grievance fuel is waiting.

Intended outcome: a watchable settlement whose labor visibly accretes, a pay graph whose capture
breeds grievance, and bottom-up movements that recruit across power tiers and erupt into uprisings the
ruler reads through symptoms — all composing existing systems, each phase independently shippable +
tested. **The Chronicle is the legibility layer of this initiative, not a separate thing.**

This is a multi-sprint initiative; phases are ordered bottom-up (labor → pay → grievance → movement →
uprising → legibility → reskin) and each leaves the system working.

## Implementation status (live)

- **Phase 0 — substrate + craft-resolve + the wrap: SHIPPED (branch `claude/continue-plan-nkNAQ`).**
  - Migration 278 (`resource_properties` global-scoped table + `player_inventory.properties_json`) and
    `server/lib/resources.js` (canonical `RESOURCE_CATALOG` tiers 1–5 + magical sub-tier, `propsFor`,
    `seedResourceProperties`) committed. `seedResourceProperties` is now seeded at boot by the
    content-seeder.
  - `server/lib/craft-resolve.js#resolveCraft` — the single deterministic resolve (potency = weighted
    input potency + skill + station + magical-fuel; dominant-affinity cascade; conflicting affinities →
    stability drop → seeded-hash backfire; potency floor; soft-fail with debuff, never throws).
  - **Wrap, don't rewrite — ALL 5 systems wired** (kill-switch `CONCORD_CRAFT_RESOLVE=0` on each):
    - `craft-engine.js#executeCraft` ✅ — derives `qualityMultiplier` from input resource properties,
      stamps affinity/potency/stability provenance, applies the soft backfire/fizzle debuff. (Also
      covers `cook-engine.js`, which delegates to `executeCraft`.)
    - `tool-tree.js#craftTool` ✅ — tool quality scales with the consumed materials' properties
      (non-blocking on the basic survival path).
    - `glyph-spells.js#mintSpell` ✅ — optional power-source FUEL (soul gems / mana / aether) amplifies
      the composed spell potency-proportionally (the Fireball I→V gradient) and is consumed from
      inventory; no fuel = byte-identical to the pre-P0 path. Dial `CONCORD_SPELL_FUEL_BOOST`.
    - `skill-evolution.js#applyEvolution` ✅ — optional resource FUEL (player-only, world-scoped,
      consumed) amplifies the evolution's damage/range growth potency-proportionally. Dial
      `CONCORD_EVOLUTION_FUEL_BOOST`.
    - multi-step chain executor (`craft-chains.js`) ✅ — migration 279 added `craft_chains.inputs_json`
      (a resource bill) + `player_craft_jobs.output_quality`; `startChain` verifies + consumes the bill,
      `advanceStep` resolves the finished item's quality from those propertied inputs on completion.
  - Contract tests: `tests/resources.test.js` (11), `tests/craft-resolve.test.js` (9),
    `tests/craft-engine-resolve-wire.test.js` (7), `tests/craft-resolve-wire-extra.test.js` (7),
    `tests/craft-resolve-tail.test.js` (5). Dials in `docs/BALANCE_DIALS.md`. **Phase 0 = 100% complete.**
- **Phase 0.5 — procedural food + crossbreed materials: SHIPPED.** Mig 280 (`material_profiles` table +
  `creature_corpses.lineage_json`/`blueprint_json` + `creature_lineage.material_profile`);
  `lib/ecosystem/material-profiles.js` (authored catalog + `profileFor` + `deriveProfileFromBlueprint` +
  `blendMaterialProfile` with gen-decay clamp + `composeMaterialName` seeded pools + `seedMaterialProfiles`);
  `lib/ecosystem/procedural-meat-composer.js#composeDrops` (FIXES the hybrid empty-loot bug — a hybrid now
  always yields ≥1 named, propertied drop derived from its blueprint/lineage). `rollLoot` accepts an
  optional `{ blueprint, lineage }`; the butcher route detects hybrids + persists `properties_json`; the
  kill path stamps blueprint/lineage onto the corpse; `generateHybrid` blends + persists a material
  profile; `cook-engine.applyConsumable` scales buff magnitude by the resolved quality. Seeded at boot.
  Dial `CONCORD_MATERIAL_MUTATION` (+ reuses `CONCORD_FUSION_GEN_DECAY`). Test
  `tests/material-profiles.test.js` (7). **Phase 0.5 = 100%.**
- **Phase 0.6 — destructible world + hydrology (server substrate): SHIPPED.** Mig 281
  (`world_terrain_deformations` delta-over-seed + `world_water_cells` grid, both per-world write tables);
  `lib/terrain-deformation.js` (canonical `baseElevation` — now the single elevation truth, killing the
  server sin-wave divergence; `applyDeformation` depth-clamped + yields the cell's propertied terrain
  material; `getElevationAt` = base+delta; `deformationsForWorld` replay; `craterAt`); `lib/terrain-water.js`
  (deterministic volume-conserving cellular-automaton flow solver `solveFlowStep` + DB wrappers `setWater`/
  `waterDepthAt`/`tickWaterFlow`); `lib/build-bill.js` (conserved-matter `debitBuildBill` — construction
  debits a real materials bill); `domains/terrain.js` macros (`dig` [yields material + persists delta +
  destabilises buildings dug under via `applyStructuralStress` + emits `concordia:terrain-deformed`],
  `deformations`, `water_depth`, `set_water`, `flow_tick`); `world-gathering.js` now delegates elevation to
  the shared base + reads per-cell water for swim; `water-flow-cycle` heartbeat (freq 4). Dials
  `CONCORD_TERRAIN_CELL_M`, `CONCORD_MAX_DIG_DEPTH`, `CONCORD_DIG_AMOUNT_M`, `CONCORD_WATER_FLOW_RATE`,
  `CONCORD_RESOURCE_GATED_BUILD`. Test `tests/terrain-deformation.test.js` (7). Client heightfield-apply +
  dynamic water surface is the remaining client-render slice (tracked under Phase 9 cross-cutting). **Server
  substrate 100%.**
- **Phase 1 — civilian occupation roster: SHIPPED.** 8 civilian archetypes (farmer/builder/miner/logger/
  miller/fisher/cook/laborer) added to `npc-routines.js` (`ARCHETYPE_ROUTINES` + 7 new `ACTIVITY_SIGNALS`
  production verbs), `npc-economy.js` (`ARCHETYPE_GATHER_TARGETS` + `ARCHETYPE_CRAFT_RECIPES` + grain/fish
  raw + produce/masonry/ingot/lumber/flour goods), and `npc-generator.js` (`FACTION_PROFILES` — civilians
  weighted into the 4 non-martial factions + default). No new tables. Civilians carry no martial archetype
  (poise invariant holds). Test `tests/civilian-roster.test.js` (12). **Phase 1 = 100%.**
- **Phase 2 — labor writes visible world-state: SHIPPED.** Mig 282
  (`world_buildings.construction_progress_pct` + `build_target_state`); `lib/npc-labor-world.js`
  (`performConstruction` raises a building over ticks frame→construction→standing; `performFarming`
  advances the nearest unripe `claim_crops` a stage; `performLogging`/`performMining` DEPLETE
  `world_resource_nodes` — gather no longer mints from thin air — + yield to `npc_inventory`); wired into
  `npc-economy.js#dispatchEconomicAction` (`build`/`farm`/`log`/`mine`), driven by the existing
  `npc-economy-cycle` (now selecting NPC x/z so labor targets the nearest site). All idempotent-per-tick
  (progress/stage capped). Dials `CONCORD_CONSTRUCT_RATE_PCT`, `CONCORD_NPC_LOG_AMOUNT`,
  `CONCORD_NPC_MINE_AMOUNT`. Test `tests/npc-labor-world.test.js` (6). **Phase 2 = 100%.**
- **Phase 3 — sparks-flow (pay/treasury/corruption): SHIPPED.** Mig 283 (`employment_edges` — the pay
  graph: employer→worker edges with pay_form/rate/payday_freq/skim_pct/collector, per-world write table);
  `lib/sparks-flow.js` (`createEmploymentEdge`; `runPayday` moves sparks employer→worker — realm treasury
  debit / NPC wealth_sparks / world funds — diverts `skim_pct` to a collector [corruption = flow diversion],
  and on an unpaid edge deepens a grievance the worker holds vs the employer [grievance = unpaid flow], with
  a repeat-stiffing escalation); `pay-cycle` heartbeat (freq 40); economic-desperation `npcDesperationCrime`
  wired into `dispatchEconomicAction` `rob` (broke+needy NPC → `npcBreakIn` nearest store → owner grudge —
  the villain isn't scripted, they're broke). Dial `CONCORD_PAY_CYCLE`. **Phase 3 = 100%.**
- **Phase 4 — grievance against authority: SHIPPED.** `npc-asymmetry.js#recordAuthorityGrievance`
  (grudges now target a faction/ruler/enforcer, not just the player; `AUTHORITY_IMPACT_SEVERITY` for
  unpaid_wages/harsh_decree/conscripted/kin_killed_by_enforcer/treasury_embezzled/authored_tyranny;
  normalises authority kinds onto the mig-128 CHECK [realm/faction→faction, ruler/enforcer→npc];
  accumulates on one edge rather than spamming rows) + `grievanceAgainstAuthority` query. Wired by Phase 3
  unpaid-flow; combat/decree hooks land with Phase 6. Test `tests/sparks-flow.test.js` (6). **Phase 4 = 100%.**
- **Phase 5 — the Movement/Cell primitive (KEYSTONE): SHIPPED.** The one genuinely-new structure. Mig 284
  (`movements` + `movement_members` [cross-world member_world_id] + `movement_plans` + `movement_visibility`,
  all per-world write tables); `lib/movements.js` (`seedMovementFromGrievance` clusters open grudges vs one
  authority and founds a movement led by the angriest holder, idempotent via a unique seed index; `recruit`
  grows members + raises visibility [secrecy↔discovery tension], supports cross-tier player + cross-world
  membership — a 2-person cross-world coalition is a valid movement; `exposeMovement` counter-intel raises
  visibility → suppress past the line; `tickMovement` flips recruiting→organized→acting at threshold; invariant:
  can't recruit its own target); `movement-recruitment-cycle` heartbeat (freq 50) seeds+recruits+ticks+exposes
  per world. Dials `CONCORD_MOVEMENT_*`. Test `tests/movements.test.js` (7). **Phase 5 = 100%.**
- **Phase 6 — uprising → faction-strategy + quest handoff: SHIPPED.** Mig 285 (`movement_uprisings` +
  `movement_quests`, per-world write tables); `lib/uprising.js` (`eruptUprising` — a movement reaching
  `acting` records a `DECLARE_REBELLION` faction-strategy-log move + flips a faction target's stance to
  `war` vs the movement [the engine has no separate rebellion stance — a rebellion IS war on the authority]
  + fires an `uprising` world event, idempotent on movement_id; `recruitPlayer` enlists a player cross-tier/
  cross-world AND plants the rebellion quest; `spawnMovementRecruitmentQuest` is the movement→player handoff,
  idempotent per (movement, player)); wired into `movement-recruitment-cycle` (erupts on `acted`). Test
  `tests/uprising.test.js` (3). **Phase 6 = 100%.** (Notoriety→boss-pursuer + auto-summon-authority beats
  fold into Phase 9/10 combat surfacing.)
- **Phase 7 — Chronicle legibility + ruler symptoms: SHIPPED (server).** Mig 286 (`world_chronicle` +
  `world_chronicle_cursor`, per-world write tables); `lib/chronicle/compose.js` (deterministic per-kind
  composers — uprising/unpaid_flow/fields_untended/worker_flight/recruitment/building_progress/vacancy/
  decree — that never invent + `scrubSecrets` + a `secret:` canary so secret bodies never leak);
  `lib/chronicle/chronicle.js` (`recordEntry` idempotent on dedupe_key; `weaveWorld` cursor-driven
  exactly-once ingestion across uprising/world_events/recruitment sources; `realmHealth` DERIVED
  labor-symptom surface — fields-untended %, depleted nodes, active movements, open grievance, treasury,
  avg loyalty — NOT a rebellion bar; `mintSaga` writes a `kind='chronicle'` DTU citing the beats);
  `chronicle-weave` heartbeat (freq 30); `domains/chronicle.js` macros (`list_entries`/`world_chronicle`/
  `realm_health`/`compose_saga`/`my_saga`). Test `tests/chronicle.test.js` (7). **Server 100%; the
  `/lenses/chronicle` lens + EmergentEventFeed channel are the frontend slice.**
- **Phase 1.5 — settlement composition + cold-start relationships + vacancy: SHIPPED (core).** Mig 287
  (`settlements` + `settlement_vacancies` + `world_npcs.settlement_id`/`settlement_role`, per-world write
  tables); `lib/settlements.js` (`SETTLEMENT_COMPOSITION` taxonomy [role→min/ideal→building]; `roleForArchetype`;
  `checkCoverage` reports role gaps [under-staffing is itself a symptom]; `openVacancy`; `recruitForVacancy`
  fills from a local same-role candidate OR escalates resentment + a grievance vs the killer; `handleNpcDeathVacancy`
  wired into `npc-legacy.js#onNpcDeath` so every role is load-bearing); `vacancy-recruit-cycle` heartbeat
  (freq 80); `npc-family.js#seedAuthoredRelationships` + `mapAuthoredRelType` ingest authored `relationships[]`
  into `npc_relationships`. Test `tests/settlements.test.js` (5). **Core 100%; taxonomy-fill at spawn +
  per-settlement scarcity are follow-on wiring in the spawner.**
- **Phase 8 — per-world reskin (load-bearing mechanics): SHIPPED (core).** **Mastery-as-passport**:
  `skill-engine.js#computeSkillEffectiveness` now takes `opts.masteryTierIndex` (from
  `skill-mastery.js#masteryForLevel`) and applies a `MASTERY_PASSPORT_FLOOR` at all three nullification
  points — a hostile/no-affinity world nullifies a low-mastery off-affinity skill, but expert/master/
  grandmaster still fire it REDUCED (15/25/35% of native), not nullified — the skill ceiling is a
  cross-world passport. **Authored tyranny → movement**: `npc-asymmetry.js#seedTyrannyGrievances` seeds
  standing grievances from authored injustices (Augmented Children/Iron Rose/Vesper Kane/Calla Bren) so a
  movement auto-seeds from the injustice on the recruitment pass. Test `tests/per-world-reskin.test.js`
  (4). **Core mechanics 100%; the `world_professions` ingestion + per-world pay-form content is the
  data-authoring slice.**
- **Phase 9 — player occupation loop (server): SHIPPED.** `lib/player-occupation.js#workShift` runs the
  SAME `dispatchEconomicAction` labor fns NPCs use (id = userId → world mutation is identical), moves
  extraction yield into `player_inventory` (not an orphan npc_inventory row), pays the Phase-3
  employment-edge wage (or a stipend) through the sparks ledger, and grants ARCHETYPE-specific skill XP (a
  smith shift boosts smithing, not generic crafting) on the skill-evolution ladder. `domains/occupation.js`
  macros (`roles`, `work_shift`). One loop, no parallel player-economy. Test
  `tests/player-occupation.test.js` (4). **Server 100%; the `concordia:action-anim` general
  action-animation framework is the frontend embodiment slice.**
- **Phase 10 — law, crime & jail-as-a-verb: SHIPPED (server).** Mig 288 (`player_wanted` notoriety rung
  extended to players + `player_detentions` — jail as verbs, not a timer). `lib/law.js`: `DEFAULT_LAWS`
  catalog (per-world `laws.json` overrides it); `assessCrime` (sanctuary → PREVENTED/refused [law as
  physics, Refusal Field], lawless → nothing, lawful → reaction); `sentenceFor` (severity × zone ×
  repeat, capped at `CONCORD_SENTENCE_CAP_SPARKS` — punish value/reputation/access, never dead time);
  `commitCrime` (refuses in sanctuary with no record; raises wanted + opens a detention in a lawful zone);
  and jail-as-FOUR-verbs — `bribeOut` (Phase-3 corruption: the dirty guard pockets it), `workOff`
  (Phase-9 occupation loop), `breakOut` (combat, raises heat), `sprungBy` (Phase-5 cross-tier ally).
  Test `tests/law.test.js` (9). **Server 100%; per-world `laws.json` content + graded guard-AI are the
  content/frontend slice.**
- **Phase 11 — governance hierarchy (vassalage/tribute/Emperor): SHIPPED.** Mig 289 (`vassalage` edge —
  one liege per polity; `world_emperors`; `realms.liege_realm_id`). `lib/vassalage.js`: `swearFealty`;
  `runTribute` flows tribute UP each edge into the liege treasury (vassal pays the full amount, skim
  diverts a cut to a collector — Phase-3 corruption with teeth); `recordVassalRaid`/`recordLiegeDefense` +
  `sweepProtectionFailures` (a liege that leaves a raided vassal undefended past the window accrues a
  grievance its citizens hold + the vassal becomes secession-eligible — accountability is load-bearing);
  `recognizeEmperor` (controlling EVERY realm is recognized after the fact, minted as Chronicle lore, no
  menu, idempotent, flagged unstable-by-construction); `onEmperorDeath` (a power-vacuum world event — the
  throne sits EMPTY, no heir, vassals secede). `governance-cycle` heartbeat (freq 60). Test
  `tests/vassalage.test.js` (6). **Phase 11 = 100%.**
- **Phase 12 — emergent ideology (the recruitment attractor): SHIPPED.** Mig 290 (`faction_ideology`
  professed position vectors + `ideology_alerts` political-weather). `lib/ideology.js`: `WORLD_AXES`
  (authored per-world political axes); `setFactionIdeology`/`positionFor`; `ideologicalDistance` (euclidean
  over a world's axes); `npcPosition` (derived from faction + archetype nudge); `recruitAlongPosition` —
  THE ATTRACTOR, ranks grudge-holders by ideological proximity so a movement recruits along SHARED position,
  not at random (wired into `movement-recruitment-cycle`); `detectFactionGoodhart` (professed-vs-revealed-
  strategy hypocrisy gap → alert a rival can expose) + `detectEchoChamber` (near-identical faction positions),
  following the drift-monitor pattern. Test `tests/ideology.test.js` (6). **Phase 12 = 100%.** (The
  `lattice-orchestrator` drift `severity:"high"` filter bug was already unmuted on main — commit 468a4ad9.)
- **Phase 13 — world-creation as the highest-stakes verb: SHIPPED.** Mig 291 (worlds.tier/sanctioned_by/
  founder_grace_until/current_ruler_id/authored). `lib/world-sovereignty.js`: `setWorldTier` (open default;
  canon requires an operator — no self-promote to rule-bending); `grantFoundingGrace`/`isUnderGrace` (a
  protected startup heart); `conquerWorld` (control TRANSFERS to the conqueror, the historical founder
  `created_by` is NEVER overwritten, refused for the hub [Concordant Law] + during grace); `canHardDeleteWorld`
  (the authored-substrate sanctity invariant — a world with authored content/NPCs/visits can NEVER be
  hard-deleted; topple, never `rm`); `conditionalGodTierForce` (canon-tier power as a CONDITION over a
  constant — daylight-amplified / war-ramp / regen, reusing the env-coupled buff substrate). Plus
  `land-claims.js#expandClaim` (grow the safe radius OUTWARD at escalating quadratic cost — risk scales
  with ambition). Test `tests/world-sovereignty.test.js` (7). **Phase 13 = 100%.**

### 🏁 ALL PHASES COMPLETE (0, 0.5, 0.6, 1, 1.5, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13)
Every phase ships migration(s) + lib(s) + heartbeat/domain wiring + a green contract test, on branch
`claude/continue-plan-nkNAQ`. Migrations 278→291 apply clean on a fresh DB (schema v291). The cross-cutting
frontend slices (lens pages, the general action-animation framework, the faction/ideology map overlay) sit
on top of the now-complete server substrate.

## Unifying model (the one substrate)

`occupation (node) ──pay-edge──> worker`, sparks move along edges on a payday tick. A collector/ruler
can **divert** flow (skim/embezzle = corruption). A worker owed-but-unpaid accrues **grievance** against
the diverting authority. Shared grievance against one authority seeds a **movement** that recruits
cross-tier over couriers under secrecy-vs-discovery, and at threshold fires an **uprising** into
faction-strategy. The ruler doesn't see a "rebellion %" — they see **labor symptoms** (fields untended,
workers fleeing, stockpiles dropping, taverns quiet), surfaced by the **Chronicle**.

**The value moving through that graph is propertied resources, not bare strings.** Labor produces
resources with *properties* (Phase 0); crafting/UGC consumes them to make spells/items/powers/food/
buildings; crossbreeding recombines them into new named materials over time (Phase 0.5). So Phase 0 is
the literal basis of everything above it — resources are the currency of the labor→craft→economy loop.

**Conserved-matter loop (the destructible world).** The ultimate *source* of all matter is the world
itself: **everything is a resource node and the world is destructible** — dig dirt and you physically
descend, fell a forest and it's gone, quarry a hillside and the hillside changes (non-blocky,
physics/heightfield deformation, NOT voxels — we already have Rapier physics + structural stress).
Critically, **building expends extracted matter**: when NPCs or users raise a structure or a city/
kingdom expands, they *consume* the propertied resources pulled from the terrain (Phase 0/2) — nothing
is free. So the loop closes: **extract (deform world) → resources → build/craft (expend them) →
settlements grow + world depletes → local scarcity → grievance → politics.** Authored cities are seeds;
they *grow and change through what people do*, paying for every expansion in real, finite, visibly-
extracted matter. This is captured in a new destructible-world phase (0.6, below) + makes Phase 1.5/2
building **resource-gated** (settlement growth consumes a real bill of materials, not free spawns).

---

## Phase 0 — Foundational resource & crafting substrate (THE BASIS OF EVERYTHING)

**Context:** Real-code audit verdict — **resources are bare strings** (`npc-economy.js` RAW_RESOURCES/
FINISHED_GOODS; `player_inventory` has only a `quality` scalar). There are **5 parallel, ad-hoc crafting
pipelines** with **no unified resolve and no property cascade**: user-recipe DTUs (`crafting.js`/
`craft-engine.js`, consumes bare-string resources), glyph-spells (`glyph-spells.js`, consumes glyphs, no
resources), skill-evolution (`skill-evolution.js`, no resources), multi-step chains (mig 180, schema-
only), tool-tree (`tool-tree.js`, hardcoded). `evo-assets` fusion is for 3D *art*, not gameplay
materials. No station-quality, no soul-gem/mana/essence power source. The spec IS the missing unifying
layer — and the audit's recommendation matches: a small `resource_properties` model + one
`craft-resolve` layer that all five systems call, **wrapping, not rewriting** them.

**Goal:** every resource carries Potency (0–100), Affinity (Magic/Tech/Bio/Physical/Chaos), Stability,
Volume/Weight, Rarity Tier (1 Basic → 5 Legendary/Mythic), Source Type. One craft-resolve computes
output quality from input properties with **soft failure** (wasted mats + minor debuff, never a hard
lock). Beginners craft basics immediately; advanced creators reach broken/unique via rare-tier mats +
station + skill + risk. Design principles confirmed by research: scarcity tiers to pace supply,
distinct trade-offs/drawbacks for strategic depth, accessibility-with-depth, soft-fail to reward
experimentation.

**Build:**
- Migration (next number, verify at build): `resource_properties(item_id PK, potency, affinity,
  stability, volume, weight, rarity_tier, source_type)` — **one row per resource KIND** (iron_ore,
  mana_crystal, dragonbone…), seeded with a starter catalog spanning tiers 1–5 + the magical sub-tier
  (soul gems petty→grand→black, mana crystals/aether dust, essence shards life/death/chaos/order).
  Add `properties_json` to `player_inventory` for per-slot overrides (a *specific* dropped hide that's
  hotter than the kind baseline — and the hook crossbreed drops use in Phase 0.5).
- `server/lib/resources.js` (new): `propsFor(itemId)`, tier/affinity helpers, the seeded catalog.
- `server/lib/craft-resolve.js` (new): **the single resolve all five systems call** —
  `resolveCraft({ inputs, recipe, playerSkill, stationQuality, risk }) → { ok, outputPotency, outputAffinity,
  outputStability, failed?, debuff? }`. Output potency = f(input potencies, skill, station, risk);
  dominant affinity cascades; **conflicting affinities lower stability** (the Concordia twist on BotW's
  "mixed effects cancel" — instead of no-effect, low stability → backfire chance); a potency floor gates
  god-tier outputs behind rare-tier mats. Soft-fail returns `{ failed:true, debuff }`, never throws.
- Power sources as potency fuel: soul gems / mana / aether / essence are resources with high potency +
  a specific affinity; consuming them in a craft raises output potency / unlocks higher tiers (the
  "Fireball I vs Fireball V" gradient). Black soul gems = high-risk high-reward (low stability, high
  potency) — forbidden-enchant lane.
- Station quality: extend the building-interaction stations (`building_interiors.js` ROOM_TEMPLATES /
  `world_buildings`) with a `craft_quality` so Forge/Arcane-Enchanter/Fabricator/Refinery tiers feed
  `stationQuality` into the resolve.
- **Wrap, don't rewrite:** `craft-engine.js#executeCraft`, `glyph-spells.js#mintSpell`,
  `skill-evolution.js#applyEvolution`, `tool-tree.js#craftTool`, and the multi-step chain executor each
  call `resolveCraft` for their output's quality/potency instead of their current hardcoded scalar.
**Reuse:** the recipe-DTU pipeline + `meta_json.resource_requirements`, `player_inventory` FIFO deduct,
glyph-spell mint, the marketplace/royalty path (a crafted item is a DTU → already shareable + earns
royalties — the UGC economy is already there).
**Invariants:** soft-fail only (no hard lock); base resources always farmable (no one blocked);
constitutional marketplace-fee/royalty constants untouched; resource catalog is data (a new tier/mat
never needs new code); the resolve is deterministic given inputs (risk is a seeded roll, testable).
**Verify:** `node --test` — `resolveCraft` math (potency/affinity/stability cascade, conflict→
instability, potency-floor gate, soft-fail debuff); each wrapped system still produces a valid output
DTU with potency now derived from inputs; a tier-5 + grand-soul-gem recipe beats a tier-1 recipe on the
same skill. Existing crafting/glyph/skill regression green.

## Phase 0.5 — Procedural food + crossbreed materials (effects that stay accurate as life recombines)

**Context (audit verdict):** Crossbreeding is **WIRED** — `creature-crossbreeding.js#generateHybrid`
blends topology/mass, unions+fuses skills, computes a `stability` (0.05–1.0), generates a name
(`"{A.desc} × {B.desc} hybrid"`), and persists the blueprint to `creature_lineage.blueprint`. But the
material side is broken/flat: `loot-tables.js#rollLoot(species_id)` is a **hardcoded table** so a
hybrid's id isn't a key → **a hybrid drops NOTHING** (real bug); every deer drops the same `"raw meat"`
(`world-creature.js` butcher sets `item_name = drop.item` — not derived from the creature); and food
effects are **hardcoded in the recipe DTU `body_json.effects[]`** (`cook-engine.js`), never on the
material/ingredient. Plants/herbs are static node kinds. So the gap is precise: **materials don't carry
inheritable effects, and drops aren't derived from the (possibly hybrid) creature.**

**Goal:** species/plants carry a structured **material profile** (effect tags + Phase-0 properties); a
drop's name+effects are **derived from the source creature's blueprint/lineage** (fixing the hybrid
no-drop bug); crossbreeding blends parent material profiles into a new, coherently-named material with
inherited+mutated effects that stays bounded across generations; cooking resolves a meal's buff from
ingredient profiles (BotW point-threshold: same-affinity stacks potency; conflicting affinities → lower
stability → Phase-0 backfire, the Concordia twist), not a fixed recipe table.
**Build:**
- Material profiles: extend `bestiary.json`/`species.json` (+ a content-seeder pass) and/or a
  `material_profiles(material_id → effect tags + Phase-0 props)` table; authored species get profiles,
  procedural creatures derive theirs from blueprint traits.
- **Fix + extend `rollLoot`:** accept the corpse's blueprint/lineage; if the species_id has no table
  entry (hybrids) OR the corpse is a hybrid, compose drops from the blueprint instead of returning `[]`.
  New `server/lib/ecosystem/procedural-meat-composer.js`: `composeDrops(blueprint|lineage)` → named,
  propertied items written to `player_inventory.properties_json` (Phase 0). Add `lineage_json`/blueprint
  ref to `creature_corpses` so the butcher route can detect hybrids.
- Crossbreed material blend (reuse the existing hybrid path): in/alongside `generateHybrid`, also
  `blendMaterialProfile(parentA, parentB, stability, generation)` — deterministic average + bounded
  mutation, clamped by the **evo-asset fusion gen-decay dials** (`CONCORD_FUSION_GEN_DECAY` etc.) so
  potency can't explode across generations; `composeMaterialName(A, B)` via the seeded-pool pattern
  (`npc-generator` / `composeLastWords`) so the meat reads coherently (e.g., "Ember-Marrow Loin"),
  reusing the hybrid's existing `× ` description as a fallback.
- Cooking through the unifier: route `cook-engine.js#cookRecipe`/`applyConsumable` through Phase-0
  `resolveCraft` so the meal's buff = resolved from ingredient material profiles (point-threshold +
  affinity-conflict instability), not the hardcoded `body_json` table. Authored recipes still work
  (their `body_json.effects` become a profile).
**Reuse:** `generateHybrid` + `creature_lineage.blueprint` (crossbreed already done), `rollLoot`/butcher
route (`world-creature.js`), `cook-engine.js` + `user_active_effects`, evo-asset fusion gen-decay clamp,
`procedural-creature.js` traits, Phase-0 `resolveCraft` + `resources.js`, seeded-name pools.
**Invariants:** a hybrid MUST drop something (fixes the empty-loot bug); drop name/effects derived from
the creature (never a stale generic "meat"); blend deterministic + **bounded** (gen-decay clamp — no
runaway potency); effects live on the material profile, never hardcoded per-item; authored recipes/loot
remain valid (profile is additive).
**Verify:** `node --test` — a hybrid corpse now yields named, propertied drops (regression for the
empty-loot bug); the same parents blend the same profile + name; generational breeding stays within the
gen-decay bound; a cooked meal's buff matches the resolved ingredient profiles; authored food recipes
still apply their effects.

## Phase 0.6 — Destructible world: terrain-as-resource + dig-to-descend + resource-gated building

**Context (audit verdict):** terrain is **procedural-only, NOT persisted** — `TerrainRenderer.tsx`
generates a Simplex heightmap from `TERRAIN_SEED` into client memory each load; the Rapier heightfield
collider (`physics-world.ts:168`) is built **once, immutable** (but Rapier supports `setHeightmapData`,
so runtime mutation is feasible). The client **already has** `world-deformation.ts` (`DeformationStore`
+ a `DeformationType` enum incl. `terrain_excavated`/`crater`) — but it's **cosmetic** (sets `userData`
flags), never touches the heightfield/collider, has **no server table, no API, no persistence** (a dug
pit vanishes on reload). Resource nodes (`world_resource_nodes`, mig 063) are **discrete props** with
wired gather/deplete but **no terrain deformation** on depletion. Geo-Mod-light (`applyStructuralStress`)
persists building state but is **building-only, no terrain crater + no support-loss collapse**. Also a
latent bug to fix: the **server's** `world-gathering.js#getElevation` uses a hardcoded sin-wave that
**diverges from the client Simplex** — the deformation layer should make the heightmap the shared truth.
The agent's MVP estimate: deformation table + gather/collapse excavation hook + Rapier heightfield update
+ client replay (~1500 server / ~400 client LOC, 1–2 migrations).

**Goal:** the world is the matter source — everything is a resource node, terrain physically deforms
(dig dirt → descend; fell/quarry → gone), deformation **persists** per-world, structural support
couples (dig under a building → it destabilizes via the existing stress), and **building/expansion
expends a real bill of extracted materials**. Non-blocky — heightfield-delta deformation on the existing
Rapier + Simplex terrain, not voxels.
**Build:**
- **Persistence (delta over seed):** migration `world_terrain_deformations(id, world_id, cell_x, cell_z,
  height_delta, kind[excavate|crater|raise], material_id, created_at)` — store only the **diffs** layered
  on the seed-regenerated base (keeps the world cheap/procedural; only pits/craters persist). Server lib
  `server/lib/terrain-deformation.js`: `applyDeformation`, `deformationsForWorld(worldId, region)`, GC.
  Per-world table → `PER_WORLD_WRITE_TABLES`.
- **Dig/excavate action + yield:** a `dig` action lowers the cell `height_delta`, yields that cell's
  **terrain material as a Phase-0 propertied resource** (dirt/stone/clay by depth+biome), and records the
  delta. Route `POST /api/worlds/:worldId/terrain/dig` + a `terrain.dig` macro.
- **Heightfield + collider sync:** apply deltas to the client heightmap on load (replay) and on the live
  `concordia:terrain-deformed` event; **batch** Rapier `setHeightmapData` rebuilds (not per-frame) so the
  avatar actually descends. Reuse the existing `DeformationStore` (promote it from cosmetic to
  heightfield-applying). Make `getElevationAt` read base+delta; fix the server sin-wave divergence by
  sampling the same source (or applying deltas server-side for NPC pathing).
- **Structural-support coupling (both directions):** excavating under/near a `world_buildings` footprint
  drains support → `applyStructuralStress` → standing→damaged→collapsed; conversely a building collapse
  writes a **crater** deformation (material-scaled depth) — reuse the Geo-Mod-light math.
- **Resource-gated building (conserved matter):** Phase 1.5/2 construction **debits a materials bill**
  from the builder's inventory / settlement stores (the extracted resources) instead of free spawns; a
  felled-tree / quarried node leaves a persisted depression. Insufficient materials → no build.
- **Client-server sync:** `GET /api/worlds/:worldId/deformations` (load replay) + `concordia:terrain-
  deformed` realtime; feed + Chronicle beat.
- **Load-bearing hydrology (real flow — the user wants this rendered, not cosmetic).** Water audit:
  today water is **static planes at Y=2.0**, swim/drown keys off a flat plane, moisture is signal-
  diffusion (not volumetric) — zero terrain↔water coupling. Add a **per-cell water-height grid**
  (`water_y[cell]`, the diff over base terrain, persisted alongside the deformation deltas) + a **flow
  solver** (cellular-automaton / gradient fill over the heightfield each tick: water moves to the lowest
  adjacent cell, conserves volume, pools in low ground). So **dig a ditch to the ocean → water flows in,
  fills it, floods/irrigates** (Minecraft-but-continuous). Render it: a **dynamic water surface** that
  follows the grid (and the terrain mesh rebuild from the deform step shows the ditch). Couple: swim/
  drown read **per-cell** water height (not the global plane); crop cells with standing/flowing water get
  the existing `terrainResourceBoost water+spring` yield + bias `propagateMoisture`; lose the
  `canal_cleaner` (tunya's authored water profession) or silt the canal → fields dry → local food
  scarcity → grievance. Drainage, moats, terracing, reservoirs all fall out of the same
  heightfield-deform + water-grid pair.
**Reuse:** `physics-world.ts` (Rapier heightfield + moveCharacter), the terrain heightfield + simplex
noise, `applyStructuralStress`/Geo-Mod-light, `world_resource_nodes`/`gatherFromNode`,
`terrainResourceBoost` (incl. `water+spring`), `signal-propagation.js#propagateMoisture` (the moisture
signal to route), Phase-0 `resources.js`/`resolveCraft`, Phase-2 `npc-labor-world.js`.
**Invariants:** deformation persists (no reload-revert); collider stays in sync with the heightfield
(no fall-through); digging under support collapses per the existing stress rules; building consumes a
real materials bill (conserved matter — no free construction); terrain materials are Phase-0 propertied.
**Invariants:** deformation persists (no reload-revert — deltas replay); collider stays in sync with the
heightmap (batched rebuild, no fall-through); the heightmap is the single elevation truth (kill the
server sin-wave divergence); digging under support collapses per existing stress rules; building debits a
real materials bill (conserved matter — no free construction); terrain materials are Phase-0 propertied;
**water conserves volume + reads per-cell height** (no global-plane shortcut), flows to the lowest
adjacent cell, and pools — deterministic per tick so the flow solver is testable.
**Verify:** `node --test` — `applyDeformation`/`deformationsForWorld` persist + replay a cell delta;
`dig` yields the depth/biome-correct material + records the delta; excavating under a building drops its
support→state; construction blocks without the materials bill, debits inventory with it; **the flow
solver fills a dug channel from a source cell to the low cell + conserves volume + pools (dig-to-flow)**.
Frontend (`DeformationStore` heightfield-apply + collider rebuild + dynamic water surface) via **scoped
`tsc`** + `vitest run` + a dev-server probe of the deformation/water endpoints (full `tsc` OOMs).

---

## Phase 1 — Civilian occupation roster (foundation)

**Goal:** first-class civilian jobs so there's a labor floor under the heroes.
**Build:** add `farmer, builder, miner, logger, miller, fisher, cook, laborer` to:
- `server/lib/npc-generator.js` `FACTION_PROFILES[*].archetypes` (weight civilian-heavy for non-martial factions).
- `server/lib/npc-routines.js` `ARCHETYPE_ROUTINES` — give each a routine activity (`farm`/`build`/`log`/`mine`/`mill`/`fish`/`cook`) + `ACTIVITY_SIGNALS` entries.
- `server/lib/npc-economy.js` `ARCHETYPE_GATHER_TARGETS` + `ARCHETYPE_CRAFT_RECIPES` for the new archetypes.
**Reuse:** existing archetype tables + `samplePersonality`. No new tables.
**Invariant:** a civilian archetype with no martial skills must lose 1v1 to an enforcer (combat-impact poise already enforces this — don't give them combat archetypes).
**Verify:** `node --test` on npc-generator (roster present) + npc-routines (each civilian archetype yields a routine block). Existing npc-generator/routine regression green.

## Phase 1.5 — Settlement composition + cold-start relationships + role vacancy

**Context (audit verdict):** population is **NOT taxonomy-aware** — `procedural-npc-spawner.js` fills
`FACTION_TARGET` (8/faction/world) with archetype-random NPCs; `procgen-settlements.js` spawns 3–5 random
archetypes per region. No "this settlement needs a blacksmith/farmer/healer/guard/merchant." Role↔building
is **decorative** (`building-interiors.js` gives a `forge` a Smithy room) with **no formal role↔building
metadata and no procgen city layout**. The `npc_relationships` table (mig 062) + `npc-family.js` API are
**WIRED**, but authored `npcs.json` `relationships[]` are **never ingested** (only read in-memory for LLM
prompts via `narrative-bridge.js#buildRelationshipWeb`), and procedural NPCs spawn **atomized**. Death
(`npc-consequences.js`) triggers a grief cascade but there is **zero vacancy→recruit→resentment** loop;
economy scarcity is **world-level only** (a town losing its only farmer doesn't spike local food).

**Goal:** every city/faction/kingdom contains the **full occupation taxonomy** to actually operate;
NPCs start with **seeded families/relationships** (so the engine has something to build from); and every
role is **load-bearing** — kill the blacksmith and the settlement detects the vacancy, recruits a
replacement, and bears resentment toward the killer. This makes labor real, feeds trade/diplomacy, and
gives the movement engine (Phase 5) its recruitment graph.

**Build:**
- **1.5a Taxonomy-complete composition.** A `settlement_composition` template (data: `required_roles`
  + `min/ideal_per_role` + `role → building_type` map, e.g. blacksmith→forge, farmer→farm_plot,
  healer→clinic, miller→mill). Add a `settlements` notion (a settlement = a cluster of `world_buildings`
  + its `world_npcs`); enforce coverage: extend `procedural-npc-spawner` / `procgen-settlements` to
  **fill role gaps first** (spawn the missing blacksmith before another random guard), and place the
  role's building if absent (procgen city layout: ensure forge+market+inn+farm per settlement). Reuse
  `BUILDING_ROOM_BLUEPRINTS`/`ROOM_TEMPLATES` (role→room already implied) + the civilian roster (Phase 1).
- **1.5b Cold-start relationship/family seeding.** New `content-seeder` pass `seedAuthoredRelationships`:
  read `npcs.json[i].relationships[]` → `npc_relationships` rows (map authored `type`→`rel_type`),
  idempotent. Seed procedural NPCs with families/relationships at spawn (a deterministic fraction get a
  spouse/parent/child/sibling + a couple of friend/rival edges within their settlement) — reuse
  `npc-family.js#addFamilyBond`/`seedFamilyUnit` + the procedural-spawner's existing
  `seedNPCAsymmetry`/secret-fraction pattern. So nobody starts blank-slate.
- **1.5c Role-vacancy → recruit → resentment.** On `onNpcDeath`, detect the deceased's role+building →
  mark a `settlement_vacancy(settlement_id, role, building_id, opened_at)`; a `vacancy-recruit-cycle`
  heartbeat (scope:'world') fills it from a candidate pool (relocate/spawn a same-role NPC) or, if
  unfilled, accrues **settlement resentment + a grievance against the killer** (ties to Phase 4 — the
  killer is the authority the grievance targets; feeds Phase 5 movements). Role succession extends
  `npc-legacy.js` (heir already inherits wealth/grudges; now also the role/post when apt).
- **1.5d Settlement-level economy (trade hook).** Track scarcity per-settlement (not just per-world) so a
  vacant farmer spikes *local* food scarcity → trade/diplomacy pressure (feeds the Phase 3 flow + the
  Chronicle "fields untended" symptom). Reuse `computeRegionalScarcity` keyed by settlement.
**Reuse:** `npc_relationships` + `npc-family.js`, `narrative-bridge.js#buildRelationshipWeb` (the authored
relationship shape to ingest), `content-seeder` discovery walk, `procedural-npc-spawner` deficit-fill loop,
`building-interiors.js` role-room map, `npc-legacy.js` heir succession, `npc-asymmetry` (grievance target),
`computeRegionalScarcity`.
**Invariants:** every operational settlement covers `required_roles` (or is visibly under-staffed —
itself a symptom); cold-start seeding is idempotent (re-seed safe); a killed critical role MUST register a
vacancy + resentment (every NPC load-bearing); seeding deterministic (testable).
**Verify:** `node --test` — a fresh world's settlement satisfies the taxonomy (or reports the gap); authored
`relationships[]` land in `npc_relationships`; procedural NPCs spawn with ≥1 family/relationship edge;
killing the only blacksmith opens a vacancy, recruits/relocates a replacement OR accrues resentment +
grievance vs the killer; local food scarcity rises when the farmer is gone.

## Phase 2 — Labor writes visible world-state (the Medieval Dynasty primitive)

**Goal:** occupation → durable, walkable world mutation (not ledger rows).
**Build:**
- Migration (next number **278**, verify at build time): add `construction_progress_pct REAL DEFAULT 0` (+ `build_target_state`) to `world_buildings`, OR a `world_construction_sites` table; ensure `world_resource_nodes` has depletion + respawn.
- `server/lib/npc-labor-world.js` (new): `performConstruction(db, npc, buildingId)` raises `state` frame→`construction`→`standing` as progress accrues; `performFarming(db, npc, claimId)` advances `claim_crops` (plant/water/grow) via the existing `farming.js` helpers; `performLogging`/`performMining` deplete `world_resource_nodes` + drop a `claim_entities` lumber/ore tile.
- Wire `server/lib/npc-economy.js#dispatchEconomicAction` cases `build`/`farm`/`log`/`mine`; called from `npc-economy-cycle`.
- Emit `world:building-progress` / `world:crop-advanced` / `world:node-depleted` (best-effort) for the feed + Chronicle.
**Reuse:** `farming.js` (`plantSeed/advanceGrowth/harvestCrop`), `world-buildings-repair.js` (health write pattern), `applyStructuralStress` (state-transition pattern), `claim_entities` placement.
**Invariants:** labor mutation is idempotent per tick (progress capped); resource gather now *depletes* a node instead of minting from thin air; per-world tables → writes happen in `scope:'world'` heartbeat (add any new per-world table to `world-shard-protocol.js#PER_WORLD_WRITE_TABLES`).
**Verify:** `node --test` — an NPC `build` activity raises a building over N ticks then flips to `standing`; a `farm` activity advances a crop; a `log` activity depletes a node. Idempotent on re-run.

## Phase 3 — Sparks-flow: pay edges, treasury, corruption

**Goal:** make the flow graph real — pay moves along edges, can be captured, unpaid = grievance.
**Build:**
- Migration: `employment_edges(id, world_id, employer_kind, employer_id, worker_kind, worker_id, pay_form[day_wage|piece|in_kind|tribute|stipend], rate_sparks, payday_freq, skim_pct, last_paid_at)`.
- `server/lib/sparks-flow.js` (new): `runPayday(db, worldId, now)` — for each due edge, move `rate` from employer balance/treasury → worker (`currency.js#awardSparks` for players, `world_npcs.wealth_sparks` for NPCs); apply `skim_pct` to a collector (petty corruption); if employer can't pay (empty treasury / grand embezzlement) → **record unpaid-flow → grievance** (Phase 4 hook).
- Make `realms.treasury` + `realm_decrees` load-bearing: `tax_change`/`conscription` decrees mint/debit treasury; a `corruption` parameter lets a ruler divert treasury to loyalists (`patronage`).
- New `pay-cycle` heartbeat (`scope:'world'`, low freq) calls `runPayday`.
- **Economic desperation → autonomous crime (acceptance beat 2).** `world-crime.js#npcBreakIn` (steal
  from a building) **already exists but is never called**; `consumePersonalNeeds` already returns
  `no_food`. Wire it: when an NPC is broke/needy, `dispatchEconomicAction` gets a `case 'rob'` →
  `npcBreakIn(nearest vulnerable store)` → the theft records a grudge on the owner (beat 3, existing
  asymmetry) + an unpaid-flow/loss grievance. The villain isn't scripted — they're broke.
**Reuse:** `currency.js#awardSparks/spendSparks/sparks_ledger`, `npc-gear.js#accumulateWealth` (NPC balance), `realms`/`realm_decrees` (mig 158), `priceModulator` (already reaches player via `npc-shop`).
**Invariants:** never touch constitutional marketplace-fee/royalty constants; sparks ledger is the audit trail; corruption is *diversion of an existing edge*, not new minting. Pay forms are per-world configurable (Phase 8 reskin).
**Verify:** `node --test` — a payday moves sparks employer→worker; a skim diverts the right fraction; an empty treasury emits an unpaid-flow grievance event; idempotent per payday window.

## Phase 4 — Grievance against authority

**Goal:** grudges accrue against rulers/factions/Enforcers (not just the player) from cruelty, decrees, kin-loss, and **unpaid flow**.
**Build:** extend `server/lib/npc-asymmetry.js#recordPlayerImpactEvent` to accept `{ targetKind, targetId }` (or add `recordNpcAgainstAuthorityEvent`), so `npc_grudges` rows target a faction/ruler. Wire the unpaid-flow event (Phase 3), kin-death-by-enforcer (combat path), and harsh-decree events into it. Authored tyranny (lore.json) seeds initial standing grudges.
**Reuse:** `IMPACT_SEVERITY`, `insertGrudge`, `npc_grudges` (mig 128 — schema already permits arbitrary `target_kind`).
**Invariant:** grievance is the *measurable* unpaid/abused flow, queryable per (authority, world).
**Verify:** `node --test` — unpaid-flow + kin-loss + harsh-decree each raise a grudge against the named authority with the right severity.

## Phase 5 — The Movement/Cell primitive (KEYSTONE — the one genuinely-new system)

**Goal:** a grievance-seeded coalition that recruits cross-tier under secrecy-vs-discovery.
**Build:**
- Migration: `movements(id, world_id, founded_by_kind, founded_by_id, target_kind, target_id, status[recruiting|organized|acting|completed|suppressed], visibility_level, action_threshold, narrative_json, updated_at)`, `movement_members(movement_id, member_kind[npc|player], member_id, role[founder|recruiter|soldier|informant|supplier], secrecy_level, loyalty, joined_at, left_at, PK(movement_id,member_kind,member_id))`, `movement_plans(id, movement_id, phase, description, required_members, completion_predicate_json)`, `movement_visibility(movement_id, discovered_by_kind, discovered_by_id, method, discovered_at)`.
- `server/lib/movements.js` (new): `seedMovementFromGrievance(db, worldId)` (cluster shared grudges vs one authority → found a movement led by the angriest civilian); `recruit(db, movementId, candidateId)` (sends a recruitment courier — growth); `tickMovement` (advance plan phase when `members ≥ required`); `exposeMovement` (counter-intel hit → `visibility_level` up, may suppress).
- Recruitment over couriers: extend messaging to **NPC→player** (new `npc_messages` or extend `npc_conversations` recipient_kind='player'); point `scheme-overhear`/an enforcer-patrol routine at the ruler's loyalists so recruitment couriers risk interception (**growth vs exposure tension**).
- New `movement-recruitment-cycle` heartbeat (`scope:'world'`): seed + recruit + tick + decay visibility.
- **N=2 + cross-world (acceptance beat 4).** The primitive must work at the smallest scale — a 2-person
  coalition (a grudge-holder recruiting one ally is just a movement with `action_threshold=1`) — and
  **cross-world**: a shopkeeper in crime world enlisting a fantasy adventurer. Cross-world messaging
  (`concord-link`), travel (`world-invites` + `npc-spawning.js#recruitFromWorld`), and the correspondent
  pattern (`cross-world-schemes.js`) already exist — `movement_members` allows a cross-world member +
  recruitment uses those channels. So "reach across worlds to recruit an ally into my fight" = this
  primitive, not a separate system.
**Reuse:** `npc-asymmetry` (grievance source), `scheme-overhear.js#recordOverhear` (counter-intel, point at loyalists), `npc-schemes` accomplice pattern, `combat-impact` (why networking is forced).
**Invariants:** cross-tier membership is the point (civilian↔authored↔player); secrecy-vs-discovery is a real tension (recruit fast → exposed → suppressed; slow → ruler consolidates); a `founder/player` can't also be a loyalist informant against itself.
**Verify:** `node --test` — grievance cluster seeds a movement; recruitment grows members + raises visibility; counter-intel overhear exposes/suppresses; threshold flips status to `acting`. Deterministic seeding.

## Phase 6 — Uprising → faction-strategy + quest handoff

**Goal:** a movement at threshold erupts, and reaching a player becomes an emergent quest.
**Build:**
- Add a `rebellion` stance + `DECLARE_REBELLION` move to `server/lib/embodied/faction-strategy.js`, triggered when a movement hits `acting` (or `avg(realm_citizens.loyalty) < threshold`). The uprising fires a faction war / decree consequence / world event.
- `spawnMovementRecruitmentQuest(db, movementId, playerId)` — when a recruitment courier reaches a player, plant an emergent rebellion quest via `lattice-quest-composer`/the quest engine.
- **Kill → escalation → boss-tier pursuer (acceptance beat 7).** The combat-kill path already records
  grudges on the **kin/faction** of a slain NPC + `nemesis-cycle`/`faction-strategy` escalate — so
  retaliation is a faction move, not a script. The wire is **surfacing + escalation-to-apex**: a notoriety
  rung (`criminal_rep`/`is_wanted`) that, past a threshold, dispatches a **named authority/boss pursuer**
  (faction apex / world-boss) after the killer, surfaced via the Chronicle (Phase 7).
- **Big destructive fight → auto-summon the authority (acceptance beat 8).** A reactive world-event
  trigger: when combat intensity / structural destruction (Layer 7.5 collapse, Phase-0.6 terrain) /
  notoriety crosses a threshold in a non-safe `world_zone`, spawn/summon the authored Enforcer (faction
  figure) → escalated brawl. Reuse the world-event-scheduler / world-crisis reactive pattern.
**Reuse:** `faction-strategy.js#applyMove`, `lattice-quest-composer.js#spawnQuestFromAlert` (handoff pattern), `realm_citizens.loyalty`, the combat-kill kin/faction grudge cascade, `world_zones` (mig 262), world-event-scheduler/world-crisis (reactive triggers), `criminal_rep`/`is_wanted`/world-boss (escalation rungs).
**Invariant:** the ruler responds to *symptoms*, not a bar (Phase 7); crackdown raises grievance (more flee), concede lowers it (looks weak), hunt-the-cell is the counter-intel loop.
**Verify:** `node --test` — a movement reaching `acting` produces a rebellion faction move; a player-reached recruitment spawns a quest row.

## Phase 7 — Legibility: The Chronicle + ruler symptoms

**Goal:** turn the deep-but-silent sim into a felt, shareable saga; let rulers read the uprising through labor.
**Build (per the validated Chronicle design):**
- Migration: `world_chronicle` (+ `world_chronicle_cursor`), both in `PER_WORLD_WRITE_TABLES`.
- `server/lib/chronicle/compose.js` — per-kind deterministic composers + `CONCORD_CHRONICLE_LLM` opt-in overlay (8s `Promise.race`, deterministic fallback); **never invent, never leak secret bodies** (query-level omission + canary scan, mirroring `narrative-bridge`).
- `chronicle-weave` heartbeat (`scope:'world'`, freq ~30) — cursor+`dedupe_key` ingestion across record sources **including the new labor/pay/grievance/movement beats** (fields untended, workers fleeing, unpaid flow, recruitment, uprising).
- `server/lib/chronicle/saga.js` — `mintSaga` as a `kind='chronicle'` DTU (default scope `personal`) that cites event-DTUs via `royalty-cascade.js#registerCitation` (saga earns royalties when cited) — **mint only on the parent (global tables), never in the heartbeat**.
- `server/domains/chronicle.js` macros (`list_entries`/`my_saga`/`compose_saga`/`publish_saga`/`world_chronicle`) + `/lenses/chronicle` lens + `EmergentEventFeed` `chronicle:entry` channel + a **"Realm Health"** ruler surface (derived: fields untended %, worker flight, stockpile delta, treasury, avg loyalty) instead of a rebellion bar.
**Reuse:** `dream-engine.js` (composer + mint + LLM-opt-in template — copy verbatim incl. fallback insert), `registerCitation`, `EmergentEventFeed`, lens-page pattern, `registerHeartbeat`.
**Invariants:** `scope:'world'` ingestion; mint on parent; never throw; never leak secrets; constitutional constants untouched; new `register*` import after `LENS_ACTIONS`/`register` (TDZ).
**Verify:** `node --test` chronicle-compose (determinism + no-invent + no-secret-leak canary), chronicle-ingest (idempotent cursor), chronicle-saga (mint + citation cascade). Frontend via **scoped `tsc`** (extend tsconfig, narrow `include`, `--skipLibCheck` + mem cap) + targeted `vitest run`.

## Phase 8 — Per-world reskin (the flow graph, reskinned)

**Goal:** same universal spine, world-flavored nodes/pay/tyranny.
**Build:**
- `content-seeder.js`: **read** `professions.json`/`industries.json` (tunya/cyber today) into a `world_professions`/`world_industries` table that drives per-world archetype distribution + pay forms; author the 7 missing worlds (content, low-risk, parallelizable).
- Pay-form per world (in-kind: tunya/fantasy; wage/corporate: cyber/superhero; tribute/racket: crime; scrip: lattice-crucible's `drift_marks`).
- **Mastery-as-passport (acceptance beat 5).** Worlds damp off-affinity skills (superhero magic ≈ none) via
  the per-world modifier in `elementalEnvBoost`/`computeSkillEffectiveness`. Add the tuning rule: **high
  skill mastery (`skill-mastery.js` tiers) overcomes a hostile world's damping** — a grandmaster spell
  still fires in a no-magic world (reduced, not nullified). The skill ceiling becomes a cross-world
  passport — a genuinely novel mechanic on substrate that already exists (per-world affinity + mastery
  tiers); just wire mastery into the world-damping floor.
- Seed movements from authored tyranny: Augmented Children (cyber) → parents' cell; Iron Rose (crime) → neighborhood; Vesper Kane (superhero) → destabilized district; Calla Bren (sovereign-ruins) → the already-authored fourth uprising.
**Reuse:** `content-seeder` discovery walk, the authored `lore.json` injustices (grievance fuel).
**Verify:** seeder ingests professions for tunya/cyber (no longer dead); a movement auto-seeds from an authored injustice in at least one world.

## Phase 9 — Player actionability: occupation-as-verbs + general action-animation (cross-cutting)

**Why (research + audit):** worlds fail when there's "nothing but click+fight." Research is unanimous —
players want worlds that change because of them, NPCs that remember (no "NPC amnesia"), and **daily
activity that carries combat's weight** (Stardew field/fence/craft; The Guild 2, where running a tavern
or ruining a rival outweighs swordplay). **Audit nuance: the verb *inventory* is already large** (11
station minigames, gather/craft/tool/farm/build/fish, 6 run-modes, combat, 7 NPC verbs, emotes/signs/
photo/mounts/trade, the whole creative-DTU/music substrate) — it's NOT "only click+fight" at the surface.
The two **precise** gaps are: (1) occupations aren't player-playable *as occupations*, and (2) verbs
aren't *embodied* (no general action-animation).
**Goal & build (grounded):**
- **Player occupation door + identity (extend, don't parallel).** A player job system already exists —
  `tunyan-jobs.js#applyForJob`/`complete-shift` — but it's a **static wage+cooldown entitlement**, not an
  occupation loop. Extend it (+ generalize beyond tunya) so a shift actually **runs the same action fns
  the NPCs use** (`npc-economy.js#dispatchEconomicAction` → `performGather/Craft/Construction`, today
  NPC-only), gated by resources+skill, paid the Phase-3 employment-edge wage, granting **archetype-
  specific** skill XP (a smith shift boosts smithing, not generic crafting), with apprentice→journeyman→
  master progression on the **skill-evolution** ladder, and able to **fill a Phase-1.5c settlement
  vacancy**. One loop for NPCs and players — no parallel player-economy.
- **General action-animation framework (the embodiment gap — the real surface gap).** The verb
  *inventory* is already large (12 stations, 6 run-modes, 7 NPC verbs, gather/farm/craft) — but only
  **combat** is embodied; stations are 2D panels (plant → HTTP → inventory, no avatar motion). Two
  reusable assets exist: the PD-motor `JointMotorSystem` (general in principle; combat-only today via
  `concordia:combat-anim`/`buildBiomechClipMap`) and **NPC occupation idle clips already authored**
  (`AvatarSystem3D` `NPCOccupationAnimation`: hammer/read/tend-crops/patrol/construct/sweep/lecture/
  count-coins) that **only NPCs play**. Add a `concordia:action-anim` / `playAction(verb)` dispatch that
  (a) plays the matching existing occupation clip for players, and (b) drives procedural motions via
  per-verb joint-target tables (dig/chop/mine/fish/stir) on the motor engine — with the already-general
  `juice.ts`/`SoundscapeEngine` feedback. **Adding a verb = pick a clip OR a joint-target descriptor +
  a juice id — not a bespoke system.** Retire the near-stub `AnimationManager` (T2.6).
- **Cross-cutting:** every earlier phase ships its player entry point + embodied animation as it lands.
**Reuse:** `tunyan-jobs.js` (the player-job door to extend), `StationInteractionRouter`/`NPCActionMenu`
(verb routing), the gather/craft/farming/dig endpoints (server effects exist), `dispatchEconomicAction`
(the NPC loop to open to players), `AvatarSystem3D` NPC occupation idle clips (reuse for player playback),
`combat-motor-driver`/`JointMotorSystem`/gait/IK (the general motor engine), `skill-evolution` (the
master ladder), `juice.ts`/`SoundscapeEngine` (general feedback), Phase-3 employment edges (the wage).
**Invariants:** a player runs the *same* action fns NPCs do (one loop, no parallel player-economy);
adding a verb is data (joint-target table + juice id); occupations pay via the Phase-3 wage (conserved
matter/flow); no bespoke per-verb animation system.
**Verify:** a player takes a blacksmith shift → crafts via the NPC loop → is paid the edge wage → gains
occupation progression; a `dig`/`plant` action drives a visible avatar motion + juice via the general
dispatch; adding a second verb needs only a descriptor. Frontend via scoped `tsc` + `vitest` +
dev-server probe.

---

## Phase 10 — Law, crime & jail-as-a-verb (F2P-safe consequence)

**Principle (the crux):** in a free, shared, persistent world **never punish time — punish value,
reputation, and access.** Time-box jail = the player quits forever. The survivors (EVE sec-status/CONCORD,
GTA wanted/bad-sport, RuneScape/Albion flagging+full-loot) all use **spatial law-tiers + wanted/reputation
status + asset/access cost**, never a jail timer. Concordia already has both halves: `world_zones`
(safe/sanctuary/pvp/lawless/hazard) = the law-tiers, and faction reputation + refusal_debt + four-axis
metrics = the status layer.

**Two enforcement modes (both half-built):**
1. **Prevention (unique to Concordia): the Refusal Field.** In a sanctuary the act is *refused*, not
   punished after — you literally can't land a killing blow in the Hub (`FIELD_KINDS` death gate already
   exists). Law-as-physics; no other game has it. Safe/sanctuary zones → Refusal Field prevents the crime.
2. **Reaction (lawful-but-not-sanctuary):** the act is possible but triggers witness → wanted status →
   graded enforcement → consequence. Lawless zones (crime's North Market, frontier, sovereign-ruins) →
   nothing happens.

**Build (the loop — most beats already exist):**
- **Law definition (the one genuinely new piece):** per-world `content/world/*/laws.json` (what's a crime
  here + severity tier + which zone-lawfulness it applies in). Seeded by content-seeder.
- **Detection:** ✅ `world-crime.js` already emits evidence on force-entry/lockpick + the `scheme-overhear`
  witness pattern; **extend witness detection to high-magnitude combat / structural destruction** (beat 8).
- **Wanted status + graded guard response:** ✅ every world has an authored enforcement faction (Concordant
  Watch, Lattice Patrol, 14th Precinct, Civic Task Force, Paladins). 🔧 wire the graded guard-AI response +
  a player wanted/notoriety rung (reuse `criminal_rep`/`is_wanted`, today NPC-only — extend to players).
- **Adjudication → proportional penalty (F2P-safe, capped):** `consequence = severity_tier ×
  zone_lawfulness × repeat_multiplier`, **time-capped and weighted toward value/reputation/access** (lose
  loot, sec-status, safe-zone access — not dead time).
- **Record:** ✅ `arrest_records` (from detective lock-in) + `crime_bounties` already exist.
- **Jail-as-a-VERB, not a timeout (the Concordia move — turns the penalty into content):** a short detain
  you can **bribe out of** (→ Phase-3 corruption: a dirty guard takes sparks → becomes a grievance someone
  else holds), **work off via prison labor** (→ Phase-9 occupation/sparks economy: mundane work as penalty),
  **break out of** (→ combat/heist verbs), or **get sprung from by a friend** (→ Phase-5 cross-tier
  recruitment — your fantasy adventurer busts you out). Jail becomes four new things to do.
**Per-world law flavor (grounded in lore + zones):** hub — Concordant Law (Refusal prevents violence; crime
is social: blackmail/concealment); tunya — 14 kingdoms, 14 codes (jurisdiction is the mechanic; legal in
Sandrun ≠ legal in Nil); crime — corrupt selective enforcement (14th Precinct serves whoever paid; Fed
Task Force is the only clean law); cyber — corpo law + Grid Authority 12% even on gray markets (crime vs
corp ≠ crime vs citizen); superhero — Registration Act looming + Luminary private security; fantasy — noble
law + Paladins, Thieves' Guild in shadow, goblin raids = war; sovereign-ruins — near-lawless vacuum;
frontier — weak/contested, frontier justice; lattice-crucible — the Charter Question (stabilize, not judge).
**Reuse:** Refusal Field (`refusal-field.js` `FIELD_KINDS` death gate — prevention), `world_zones` (mig 262),
`world-crime.js` (detection/evidence/`_detectWitnesses`/`_alertGuards`), `arrest_records`/`crime_bounties`,
authored enforcement factions, Phase-3 corruption (bribe), Phase-9 occupation (prison labor), Phase-5
coalition (sprung-by-friend), `criminal_rep`/`is_wanted` (wanted rung).
**Invariants:** **no dead-time jail** (penalty is value/reputation/access + a playable verb); sanctuary law
is prevention (Refusal Field), not after-the-fact punishment; lawless zones impose nothing; sentencing is
capped + repeat-weighted; per-world `laws.json` is data (new law needs no code).
**Verify:** `node --test` — a crime in a sanctuary is refused (no effect); in a lawful zone it raises
wanted + a graded guard response + an `arrest_records` row; sentencing math (severity×zone×repeat, capped);
each jail verb works (bribe debits sparks + records a grievance; work-off runs the occupation loop;
break-out/sprung change detain state). Per-world `laws.json` seeds.

---

## Phase 11 — Governance hierarchy: vassalage, tribute/protection, Emperor, Sovereign

**Why:** political nesting is cosmetic in most games (a town is "in" a kingdom on a map; nothing follows).
Here it's **load-bearing because responsibility flows UP**: a liege owes its vassals protection, and
failing that is a **grievance** — which plugs straight into the grievance→rebellion stack (Phases 4–5).
A liege that takes the tribute but doesn't send guards when its town is raided is the Phase-2 store-robbery
scenario at kingdom scale → the town has grounds to secede/rebel. The hierarchy polices itself through
systems already built. (Implementation also documents this in a new `docs/LIVING_WORLD.md` governance
section next to law + grievance — same machine.)

**Build:**
- **Vassalage edge (the one new primitive):** add `parent_id` (+ `tier`) to the polity tables so they
  form a tree: `land_claim` (town, mig 135) → settlement (Phase 1.5) → `realm` (kingdom, mig 158) →
  empire. A `vassalage(liege_kind, liege_id, vassal_kind, vassal_id, tribute_rate, tribute_cadence,
  protection_owed, last_tribute_at, last_defense_at)` edge table.
- **Tribute up + protection down (ride each edge):** tribute = a Phase-3 **pay-edge** flowing sparks up
  on a cadence (into `realm.treasury`); protection = a defense obligation flowing down (when a vassal is
  raided/attacked, the liege must respond). Corruption (Phase-3 skim) on a tribute edge has real teeth.
- **Accountability → secession/rebellion:** a liege that collects tribute but fails `protection_owed`
  (no guard response to a vassal raid) accrues a **grievance against the liege** (Phase 4) → the vassal's
  citizens can seed a secession/rebellion movement (Phase 5). Law/enforcement (Phase 10) **reaches down**
  the tree — a kingdom's enforcement faction + zones inherit to its member towns.
- **Emperor class (per-world, earned by conquest):** controlling **every kingdom-tier polity in a world**
  (via faction-strategy conquest) is **recognized AFTER the fact** — not a menu/quest — and minted as a
  **lore DTU** by the Chronicle (Phase 7). **Non-transferable, non-sellable.** Inherently **UNSTABLE by
  construction:** every conquered vassal carries a grievance, so the rebellion stack **runs against the
  emperor automatically** — bigger empire = more fronts + more sparks to garrison = uneasy head; **the
  emperor becomes the world's emergent raid boss** (the grand-rebellion endgame unites everyone else
  against them). **Death = a power-vacuum WORLD EVENT**, not inheritance: the empire shatters into the
  ruler-shuffle and the throne sits **EMPTY** (no heir, not transferable) until someone reconquers
  everything — a named historical moment the lattice records as lore.
- **Sovereign cap (cross-world, mythic):** uniting *multiple worlds* is near-impossible — a legend the
  shared universe orbits, maybe never achieved. Tied to Concordia's authored three-pillars cosmology
  (Sovereign / Concord / Concordia) + Concordant Law ("none may conquer the hub") as the literal ceiling.
**Guardrail (anti-winner-locks-server — EVE's "blue donut" problem):** the apex is **a target with a
crown, not a stable throne.** Winning is the easy part; *holding* is the hard part (CK3). The empire wants
to fall apart by construction, so one entity "winning" creates endgame content for the whole server rather
than stagnation.
**Reuse:** `realms`/`realm_territories`/`realm_citizens` (mig 158), `land_claims` (mig 135),
`faction-strategy` (conquest/war/alliance + the Phase-6 rebellion stance), `world-organizations` (org
graph), Phase-3 pay-edges+corruption (tribute/skim), Phase-4/5 grievance→rebellion (polices the tree),
Phase-10 law (reaches down), Phase-7 Chronicle (emperor rise/fall minted as lore).
**Invariants:** tribute-up + protection-down on every edge; **failed protection = a real grievance**
(accountability is load-bearing, never cosmetic); Emperor is per-world, non-transferable,
hidden-until-earned, **shatters-on-death into an empty throne** (no inheritance); the empire is **unstable
by construction** (no winner-locks-server); Sovereign is a cross-world mythic cap, never a grind/menu.
**Verify:** `node --test` — a town joins a kingdom (parent_id edge); tribute flows up on the pay-cycle;
a liege failing to defend a raided vassal accrues a grievance + unlocks secede/rebel; controlling all
kingdom-tier polities recognizes an Emperor (lore DTU minted) with no menu; emperor death shatters the
empire + empties the throne (no heir) + auto-seeds rebellion from the conquered-vassal grievances.

---

## Phase 12 — Emergent ideology & NPCs-first politics (the cold-start fix + the recruitment attractor)

**Why (the Dual Universe death + the new-primitive framing):** the grievance→movement stack (Phases 4–5)
seeds coalitions from *who-wronged-whom*, but a player landing on day one finds a **politically inert**
world until enough harm accrues. Dual Universe died because politics waited on players. The fix: **NPCs
run politics from the cold start** — factions already hold *positions*, demagogues already court the
discontented, schisms already brew — so the world is alive before the player does anything, and the
player joins an argument already in motion. The new primitive **isn't "invent ideology"** — it's making
**ideology a structured POSITION that recruits**: a faction's stance on its world's authored axes becomes
the **attractor** the Phase-5 movement engine recruits along (a grudge-holder doesn't recruit at random —
they recruit people who *share the position*). This turns the existing grievance graph into an ideological
one.

**Audit verdict (verified against real code — the framing needed two honest corrections):**
- **Ideology axes + position vectors are NET-NEW.** Factions carry `values[]`/`fears[]`/`motto`/`goal`/
  `dialogue_style`/`stance` (`content/world/*/factions.json`) — there is **no axis/position field**, and
  per-world political axes are **not authored** (tunya's `diplomatic_graph.json` is relationship *edge-
  dimensions* — trade/hostility/secrets/mobility/cultural-exchange — and is **dead content, never read**).
  Worse: authored `values/fears` live **in-memory only** (`content-seeder` → `_authoredFactions` Map →
  `narrative-bridge` LLM prompts), **never persisted to a DB table**. So the prose exists; the *structured
  position* and its *persistence* don't. This phase authors the axes + a `faction_ideology` table.
- **`drift-monitor.js` is knowledge-substrate-only — reuse the PATTERN, not the module.** `DRIFT_TYPES`
  (`goodhart`/`memetic_drift`/`capability_creep`/`self_reference`/`echo_chamber`/`metric_divergence`,
  `server/emergent/drift-monitor.js:29`) + `DRIFT_SEVERITY` (`info/warning/alert/critical`, `:42`) are
  exactly as claimed, but `takeSnapshot` reads **only** DTUs/evidence/edges/outcomes — it **cannot be
  repointed** at faction data. "Political weather" = a **parallel detector suite** over faction state
  (`detectFactionEchoChamber`, `detectFactionGoodhart` = the hypocrisy gap, `detectMemeticDrift` = a
  position sweeping the world) following the same snapshot→detectors→alerts→HLR-constraint-check shape and
  reusing the `world:drift-alert` socket channel + `EmergentEventFeed`. **Latent bug to fix while
  adjacent:** `lattice-orchestrator.js:71` filters `getDriftAlerts(..., { severity: "high" })` but the
  enum has no `"high"` → it currently matches **nothing** (drift HIGH/CRITICAL never reaches HLR).
- **The hypocrisy/Goodhart guardrail is a net-new comparison.** `faction_strategy_state` (mig 117) has
  `stance/momentum/target/phase` — **no professed-vs-actual split**. Hypocrisy = authored ideology
  (professed) vs the faction's actual `faction_strategy_log` moves (revealed) → a Goodhart gap a rival
  exposes. Net-new but cheap (both sides already persist).
- **Reusable as-is:** `npc_grudges.target_kind` **already allows `'faction'`** (mig 128 CHECK) — only the
  recording path is player-only today, so grievance-vs-authority is a one-function extension. `pickMove`
  (`faction-strategy.js:192`) is a **pure deterministic state machine, no LLM** — populism/wedge/co-opt
  slot in as new move types; `oracle-brain` is flavor-only (opt-in text). **NPC defection/schism does NOT
  exist** (`attemptCivilianRecruitment` only flips neutral/hero NPCs) — net-new, but rides the ideology
  attractor (an NPC defects toward the faction whose position best matches its own).

**Goal:** every world has a small set of **authored political axes**; every faction holds a **position
vector** on them (professed) plus its revealed strategy (actual); NPCs carry a lightweight personal
position (derived from faction + grudges + archetype); ideology is the **recruitment attractor** for the
Phase-5 movement engine (you recruit along shared position, not at random); leaders run **demagogue
verbs** (populism / wedge issues / co-optation) as new faction-strategy moves; a **faction-political-
weather** detector suite (drift-monitor pattern) surfaces echo-chambers / sweeping positions / hypocrisy
gaps; and the whole thing is **legible** (a readable faction/ideology map) or it's invisible sim again.

**Build:**
- **12a — Authored axes + position vectors (the net-new structure).** `content/world/*/ideology.json`:
  2–4 named axes per world with pole labels + a short narrative (cyber: *AI-governance* sovereign-AI↔
  human-control; superhero: *Registration Act* registration↔autonomy; frontier: *centralization*
  mesh-federation↔isolation; fantasy: *bloodline-purity* purity↔open-blood; tunya: *sovereignty* unity↔
  fourteen-codes; crime: *order-vs-liberty* syndicate-order↔free-hustle; hub: *openness* archive-
  transparency↔need-to-know). Migration `faction_ideology(faction_id, world_id, axis_positions_json
  [{axis: -1..+1}], conviction, populism, last_shift_at)` — **persists** the professed position the
  authored prose never had a home for. `content-seeder` reads `ideology.json` + each faction's authored
  position into the table (idempotent). `server/lib/ideology.js`: `positionFor(factionId)`,
  `axisDistance(a,b)` (the attractor metric), `personalPositionFor(npc)` (faction position nudged by
  grudges/archetype/secrets — derived, not stored per-NPC).
- **12b — Ideology as the Phase-5 recruitment attractor (the keystone wire).** `movements.js#recruit`
  (Phase 5) ranks candidates by `axisDistance(movement.position, candidate.personalPosition)` — a movement
  is *seeded with the founder's position* and recruits the ideologically-near first. Cross-tier still
  holds (a civilian and an authored zealot who share a position co-organize). This is what makes the
  movement graph an **ideological** graph, and it's a small change to a Phase-5 fn, not a new system.
- **12c — Demagogue verbs (new faction-strategy moves, deterministic).** Extend `pickMove` with
  `ADOPT_GRIEVANCE` (a faction whose leader/citizens hold severe unresolved grudges pivots its position
  toward the grievance — opportunistic populism), `WEDGE_ISSUE` (push an axis where a rival is internally
  split → raise the rival's hypocrisy gap / seed a schism), `CO_OPT` (absorb a small movement by shifting
  position to match it → defuse a rebellion by stealing its plank). Each shifts `faction_ideology` and
  logs to `faction_strategy_log`. Opt-in LLM flavor text via `CONCORD_FACTION_POLITICS_LLM` (oracle-brain,
  deterministic fallback) — the *decision* stays deterministic.
- **12d — NPC defection/schism along the attractor (net-new, cold-start engine).** A
  `faction-defection-cycle` heartbeat (`scope:'world'`, low freq): an NPC whose `personalPosition` drifts
  far from its faction's *actual* position (revealed by `faction_strategy_log`, not the professed one) and
  who holds a matching grudge **defects** toward the nearest-position faction/movement (extend the
  membership write; reuse `recruitFromWorld`'s reassignment for the same-world case). This is the cold-
  start motor: positions + grudges produce churn before any player acts.
- **12e — Faction political weather (drift-monitor PATTERN, parallel suite).** New
  `server/emergent/faction-drift-monitor.js` mirroring the snapshot→detectors→alerts shape over faction
  state: `detectFactionEchoChamber` (a world collapsing toward one position — no adversarial faction),
  `detectFactionGoodhart` = **the hypocrisy detector** (professed `faction_ideology` vs actual
  `faction_strategy_log` divergence → the exploitable gap), `detectPositionSweep` (a memetic_drift analog
  — a position rapidly gaining factions). Register a `faction-drift-scan` heartbeat (`scope:'world'`),
  route ALERT/CRITICAL into the HLR constraint-check path **and** into `WEDGE_ISSUE` opportunities for
  rivals, reuse the `world:drift-alert` socket + `EmergentEventFeed`. **Also fix `lattice-
  orchestrator.js:71`** `severity:"high"` → `["alert","critical"]` so the *existing* drift→HLR wire works.
- **12f — Hypocrisy guardrail (the Goodhart gap, made exploitable).** The 12e hypocrisy detector's output
  is consumable: a rival's `WEDGE_ISSUE` move (12c) targets the gap; exposing it (via Phase-5 counter-
  intel / a Chronicle beat) raises grievance inside the hypocritical faction → **defection/schism** (12d).
  Professing "we protect the weak" while the strategy log shows tribute-skimming raids is a lever, not a
  cosmetic label.
- **12g — Legibility (or it's invisible sim again).** A **faction/ideology map** surface: per-world axes
  with each faction plotted by professed position (+ a ghost marker for revealed/actual = the visible
  hypocrisy gap), movement positions overlaid, and the political-weather alerts as a banner. Ship it as a
  Chronicle (Phase 7) tab / a `/lenses/world` overlay reading `faction_ideology` + `movements` +
  `faction-drift` alerts; `EmergentEventFeed` gets ideology beats (position shift, schism, wedge,
  co-optation). Without this surface the deepest part of the sim is unreadable.

**Reuse:** `content/world/*/factions.json` authored `values/fears/goal` (seed the initial professed
position), `content-seeder` discovery walk, `npc_grudges` (mig 128, `target_kind='faction'` already legal),
`faction-strategy.js#pickMove`/`applyMove` + `faction_strategy_log` (revealed behavior + new moves),
`drift-monitor.js` (the snapshot→detector→alert→HLR **pattern** + `DRIFT_SEVERITY` + `world:drift-alert`
channel + `EmergentEventFeed`), `lattice-orchestrator.js` (the HLR route to fix + extend),
`movements.js`/`movement_members` (Phase 5 — the attractor consumer), `recruitFromWorld` (membership
reassignment for defection), `oracle-brain` (opt-in flavor only), `narrative-bridge` (already reads
faction prose for prompts — now also reads the structured position).

**Invariants:** ideology is a **structured position on authored axes** (data — a new axis/world needs no
code), **persisted** in `faction_ideology` (not in-memory-only like today's prose); the **professed vs
actual** split is real and the divergence is the exploitable Goodhart gap (never a cosmetic label);
recruitment ranks by **position distance** (ideology is an attractor, not decoration); demagogue moves +
defection are **deterministic** (no RNG in resolution; LLM is opt-in flavor with a deterministic
fallback); NPCs run politics from **cold start** (the world is alive pre-player); the political-weather
detector is a **parallel suite** (never repoints the knowledge drift-monitor) + heartbeats `scope:'world'`
+ never throw; the whole thing is **legible** (the map surface ships with the phase) or it doesn't count;
constitutional constants untouched.

**Verify:** `node --test` — `ideology.json` seeds into `faction_ideology` (idempotent); `axisDistance`
ranks a position-near candidate above a far one so `recruit` prefers the aligned NPC; `ADOPT_GRIEVANCE`/
`WEDGE_ISSUE`/`CO_OPT` shift the professed position + log to `faction_strategy_log` deterministically;
`detectFactionGoodhart` flags a faction whose professed position diverges from its revealed moves;
`detectFactionEchoChamber` flags a one-position world; the defection cycle moves a position-drifted,
grudge-holding NPC to the nearest faction; the `lattice-orchestrator` `severity` fix routes a CRITICAL
drift alert into HLR (regression for the dead `"high"` filter). Frontend ideology map via **scoped `tsc`**
+ `vitest run` + a dev-server probe of the faction/ideology + drift-alert endpoints.

---

## Phase 13 — World-creation as the highest-stakes verb (two-tier worlds · founding grace · conquerable-not-deletable · conditional god-tier forces)

**The through-line (the constitutional rule, now applied to creation itself):** power is **earned
in-world — never bought, never inherited, never granted by status, money, or authorship.** Same rule
as Emperor (earned by conquest, Phase 11) and law/jail (fair by crime, not status, Phase 10): **founding
a world grants ZERO power.** A creator god-mode is the easiest way to wreck the multiverse (every world a
pay-to-win vanity power-fantasy), so it's closed by construction. **Founding a world isn't a safe sandbox —
it's planting a flag in a hostile multiverse:** your world becomes a polity (raidable, robbable,
contestable) and you its founding ruler = a target. *Uneasy lies the head*, applied to creation — and for
the right creators that IS the appeal, making world-creation the highest-stakes verb in the game.

**Audit verdict (verified against real code):**
- **Founder identity exists; founder power doesn't.** `worlds.created_by` (mig 042) is set by both
  `POST /api/worlds` (`routes/worlds.js:172`) and Foundry publish (`domains/foundry.js:359`) — a bare TEXT
  field, **zero permissions guard**; both paths already make a **first-class, fully-raidable** world (live
  `rule_modulators`/`physics_modulators`, no god-mode). "No creator god-mode" is already true — this phase
  makes it *intentional* + adds the two-tier gate.
- **No delete-world HTTP route exists**; `foundry.unpublish` already refuses to delete a world with
  `total_visits > 0` (`foundry.js:435`). BUT there's **no CASCADE** and authored NPCs **don't re-hydrate**
  (the `_seeded` boot flag fires once) — so a deleted/orphaned world's authored `world_npcs` rows are lost
  with no recovery. **That orphan/no-rehydrate gap is the real risk** to the "never deletable" guarantee.
- **Founding-grace substrate already ships.** `world-zones.js#seedDefaultZones` (boot, from
  `content-seeder.js:590`) already seeds a **sanctuary core per world** (hub "The Three's Domain" 400m;
  every other world a 60m "Spawn Sanctuary" — `kind:'sanctuary'`, `noAggro:true`, `regenPerTick`); `zoneAt`
  is smallest-radius-first (sanctuary nests in hazard). Refusal Fields (mig 097) are all **time-bounded**
  (no permanent lane yet). **Net-new: a claim/zone EXPAND mechanic** — `land_claims` radius is **fixed at
  founding** (`land-claims.js`, MIN 5/MAX 200, no grow API).
- **Topple-not-delete is wired for realms.** `kingdom-takeover.js#takeoverByConquest` reassigns `ruler_id`
  on capital-capture+ruler-kill proof; `deposeRuler` drops a realm to `interregnum` (legitimacy 20, decrees
  suspended) — toppled, never deleted; `war-campaign.js#declareWar` gates conquest; hub is unconquerable
  (`concordant_law_refusal`). Realms are **never hard-deleted.** The gap: lift this from realm-level up to
  world-level + add the authored-substrate sanctity invariant.
- **Conditional power already runs on the engine** (situational beats absolute): `elementalEnvBoost`
  (`skill-environment.js`) modulates power by environment and **energy follows sunlight**;
  `embodied_signal_log` already tracks `sight_os.illumination` as a queryable channel; `user_active_effects`
  already supports **stacking buffs** (a fight-duration ramp) + **heal-over-time** (regen). So conditional
  god-tier forces (daylight-buffed, ramp-the-longer-they-fight, regen) reuse the **exact** substrate already
  shipped for frost-in-cold bending — MORE implementable than flat numbers, with no global constant to
  balance or arms-race.

**Build:**
- **13a — Two world tiers (data flag, operator-gated canon).** Add `tier TEXT DEFAULT 'open'`
  (`'open'|'canon'`) + `sanctioned_by` to `worlds`. **Open moons:** any user, founder level 1, fully
  contestable — the fair, earned multiverse. **Canon worlds:** operator-greenlit only (admin flag on the
  existing create/publish path — no new creation route), authored + scaled to lore, *may* bend rules (host
  god-tier forces). Gate the existing `POST /api/worlds` + `foundry.publish` to stamp `tier` (default open).
- **13b — Founding grace (a safe heart you grow at your own risk).** A level-1 founder on an instant-target
  world gets griefed to dust → nobody creates. Fix (substrate present): seed a **founder sanctuary core**
  via `seedDefaultZones` (reuse), optionally backed by a **perpetual-renewal `consequence_held` Refusal
  Field** during a startup window (the net-new permanent-lane: a heartbeat re-applies it, or an
  `expires_at IS NULL` row). **Net-new `expandClaim`** in `land-claims.js` — grow the safe radius **outward
  at real escalating cost** (bond scales with radius). **Risk scales with ambition, not with existing.**
- **13c — Conquerable, never deletable (protect months of authored soul).** A raider must be able to
  **topple the power structure, strip wealth, occupy, even take the world from its founder** (losing the
  world you founded = a wild, fair stake) — reuse `takeoverByConquest` + `deposeRuler→interregnum`, lifted
  to world/polity level (control changes; `created_by` stays the **historical founder**). But a raider must
  **NEVER erase the authored substrate** — lore, NPC backstories, the world's existence. **Empires conquer
  nations; they don't make the land vanish.** "Dismantle" = topple/seize/occupy, **never `rm`.** Net-new:
  an **authored-substrate sanctity invariant** — no gameplay path hard-deletes a world (or its authored
  `world_npcs`/lore) that has authored content or `visits > 0`; extend `foundry.unpublish`'s visits-guard to
  user-created worlds; **close the no-CASCADE/no-rehydrate orphan gap**. The creator can lose the crown; the
  world persists.
- **13d — Conditional god-tier forces (canon only — NPC forces & raid bosses, NOT player ladders).** The
  honest fork: a god-tier entity in an earned-power constitution is a **force, not a playable ladder.**
  Canon worlds may host god-tier **NPC forces / raid-tier bosses** (the everyone-vs-the-emperor endgame with
  a god in the middle, a coalition to even scratch it) — **never player-attainable** (you fight alongside or
  against one; you can't *become* one by logging into a canon world; that's what keeps the constitution
  intact). Build on **conditional** power, not flat constants: reuse `elementalEnvBoost` (sun-powered force =
  energy follows sunlight, same system as frost-in-cold), `embodied_signal_log#sight_os.illumination` as the
  env channel, a **stacking `user_active_effects` buff that grows with fight duration** (the ramp), and a
  **heal-over-time** effect (regen). **Conditions over constants** — situational matchups (stronger in
  daylight, weaker at night; weaker at the opening, ramping past it) mean **no fixed global number** to
  balance or arms-race; the answer is always "depends where, when, and how long." Spend absolute numbers
  sparingly; spend conditional rules everywhere. **Author NO real-world IP** (no Marvel/DC names/characters)
  — these are generic conditional-force primitives; the IP dream is downstream of shipping the federated
  world engine, not a thing to author now.

**Reuse:** `worlds.created_by` + `POST /api/worlds` + `foundry.publish`; `world-zones.js#seedDefaultZones`/
`zoneAt`/`ZONE_DEFAULTS.sanctuary`; `refusal-field.js` (perpetual-renewal grace window); `land-claims.js`
(extend with `expandClaim`); `kingdom-takeover.js#takeoverByConquest`/`deposeRuler` +
`war-campaign.js#declareWar` (topple-not-delete, lifted world-level); `elementalEnvBoost`
(`skill-environment.js`) + `embodied_signal_log` + `user_active_effects` (conditional-force power);
`content-seeder.js` authored persistence (+ the no-rehydrate orphan gap to close); Concordant Law hub
hardcode (the existing constitutional ceiling).
**Invariants:** **power earned in-world** — authoring/money/status grant ZERO power (the through-line, same
as Emperor/law/creation); **open worlds fully contestable from level 1**; a founder gets a **grace
sanctuary core they EXPAND at real escalating cost** (risk scales with ambition, not existence); a world is
**toppleable/seizable/occupy-able — even takeable from its founder** — but the **authored substrate (lore,
NPC backstories, world existence) is NEVER deletable by gameplay** (topple ≠ `rm`; `created_by` persists as
historical founder); **god-tier = conditional NPC forces / raid bosses, never a player ladder**;
**conditions over constants** (situational power, no flat global numbers); **canon tier is operator-greenlit
only**; **NO real-world IP authored**; constitutional marketplace/royalty constants untouched.
**Verify:** `node --test` — creating a world defaults `tier='open'` + seeds a founder sanctuary core;
`expandClaim` grows radius at a scaled bond cost (rejects without the bond); conquest changes the ruler
while `created_by` + all authored `world_npcs`/lore rows persist (regression: a *toppled* world keeps every
authored row); **no gameplay path hard-deletes a world with authored content or `visits > 0`** (the sanctity
invariant); a conditional force's effectiveness **rises with the `sight_os.illumination` signal /
fight-duration buff stack and falls without** (reuse the `elementalEnvBoost` test pattern); canon tier
requires the operator flag. Frontend (founder-grace HUD / world-tier badge) via **scoped `tsc`** +
`vitest run` + a dev-server probe.

---

## Appendix A — Per-world occupation taxonomy (user-authored source content)

The **universal spine** every settlement needs to operate (Phase 1.5a `required_roles`):
**Healer · Builder · Food/Extraction · Courier · Enforcer · Scholar · Merchant · Clergy/Mystic ·
Service/Labor · Leadership.** Phase 8 reskins the same spine per world; the user supplied the full
title rosters + archetype sets for all 9 (tunya already had `professions.json` with 47; the other 8 are
now authored here → ingest into per-world composition templates / `professions.json`):

- **concordia-hub** (fantasy soft-power): Concordant Infirmary Healer, Foundry Master Engineer,
  Crosswind Courier, Watch Captain, Archive Curator, Bazaar Master, Refusal-Field Oracle / Preacher,
  Seven-Spokes Innkeeper/Bard + Verge Stablemaster/Ranger + Plaza Urchin + Brawling-Pit Master, elected
  Assembly+Speaker. Archetypes: trader, scholar, mystic, healer, guard, hunter, warrior.
- **tunya** (template — `professions.json`/`industries.json`): nurse/midwife/Medici-healer; furniture_maker/
  miner/stevedore/High-Mason; horticulturalist/herbalist/fisherman/cook/captain/**sealie_hunter**/
  fuel_gatherer; delivery/operator/link-walker; warrior/guard/Sanguire Warlord; registrar/clerk/author/
  print_press/time_keeper/Asbir Curator; vendor/Fluxom Matriarch; hazard-labor (waste_handler/
  canal_cleaner/fuller/laundress/cactem_keeper/cephalopod_inker); governor/council/High-Chancellor/Queen-
  Mother. Archetypes: scholar, trader, warrior, healer, noble, guard, hunter, mystic.
- **sovereign-ruins** (post-collapse archive): Refused Healer; Court Smith; farmer; courier; guard/
  Court-Champion/**Rebel-Captain (Calla Bren)**; Archivist (THE vocation)/Court-Scribe/Spell-reader;
  Sun-Bleached Trader; Spell-spirit/Pilgrim-Leader/Cascade-Denier/Memorial-Caretaker. Archetypes: mystic,
  scholar, guard, spell_spirit, healer, hunter, rogue_leader, ascetic_leader, demagogue.
- **concord-link-frontier** (peer-mesh frontier): Frontier Healer; Frontier Smith/tinker; farmer;
  **Long Rider/Postmaster/Senior Courier/Autonomous Walker/Field-Relay** (the spine vocation); Frontier
  Captain/guard; Federation Liaison/archivist; Frontier Trader; Mesh-Cult Prophet; Pioneer-Elder/
  Councillor/Isolationist-Elder. Archetypes: scholar, hunter, trader, guard, artisan, villager, diplomat,
  rogue_captain, religious_prophet.
- **crime** (noir, guns): City Coroner (medical surface = the dead); numbers-runner/link-walker;
  enforcer/bagman/driver/lookout/Precinct-Captain/Detective/Pier-Boss; Lead Accountant (launderer)/Lower-
  Court Judge; fence/forger/Wharf-Fence; Streetcorner Informant; Federal Agent/Lead-PI/Defense-Attorney;
  Sunken-Anchor Barkeep/Wharf-Urchin. Archetypes: trader, healer, villager, shadow_assassin,
  silent_fixer, syndicate_matriarch, corrupt_administrator, federal_agent, gang_leader_principled.
- **cyber** (template — `industries.json`): ripperdoc/wetwork/aug_surgeon; ice_architect/chromer/
  calibrator/drone-tech; courier/hardlink-courier; corp_enforcer/sec_drone/muscle/Lattice-Patrol;
  data_diver/**decker** (top pay+mortality of all worlds)/appraiser/Identity-Broker; fence/fixer/Cordon-
  Guildmaster; gig-courier/clerk/Quarter-Urchin; ArasaCorp-VP/Polysteel-President. Archetypes: trader,
  mystic, scholar, guard, hunter, uploaded_intelligence, augmented_resistance_leader, corporate_executive,
  post_human_socialite, fixer_guildmaster.
- **superhero** (bio-powers): Genetic-Researcher/Biokinetics-Dean; artisan/Mechanical-Anarchist; ex-
  messenger link-walker; beat-cop/Police-Captain/Task-Force-Commander/Enforcers'-Apex/Skyline-Champion;
  analyst/Investigative-Reporter; power-broker/**Luminary CEO (Vesper Kane)**; Crimson-Spire Apex; Civil-
  Rights-Lead/Baseline-Resistance/Bronx-mutual-aid; Fresh-Emergence (novice). Archetypes: guard, trader,
  villager, scholar, mystic, vigilante, community_organizer, industrialist_villain, civil_rights_advocate,
  novice_apex_potential.
- **fantasy** (abundant magic): Apothecary/Hedge-Witch; rune-carver Smith; rural villagers; Wildwood
  link-walker/pilgrim/familiar; sellsword/Thornwood-Sworn/Moonleaf-Hunter/Paladin-Commander/Goblin-
  Warchief; loremaster/Archmage-Chair/Bard; trader; High-Priestess/Moonleaf-Priest/Wildwood-druid;
  Obsidian-Queen/**Vampire-noble (Seraphine Voss)**/Lady-of-Thornwood; Thieves'-Guildmaster; beast-tamer.
  Archetypes: scholar, mystic, hunter, healer, trader, shadow_druid, vampire_noble, monarch_dragon_blooded,
  warchief_raider, paladin_commander, thieves_guildmaster, high_priestess.
- **lattice-crucible** (self-writing, unstable magic): Crucible Healer; Crucible Smith/tinker; Patch-
  Runner courier; guard/Cohort-Leader/Verge-Scout; **Witness/Meta-Witness/Crucible-Sage/Drift-Researcher**
  (the vocation); Verge Trader; Drift-Cult High-Priestess; Lattice-Engineers Chief; Drift-Refugee Elder;
  **First Voice (self-aware procgen NPC)**/autonomous-walker/free-apprentice. Archetypes: scholar, hunter,
  mystic, healer, trader, priest, engineer_administrator, elder_survivor, self_aware_emergent,
  fourth_wall_diplomat.

**Use:** Phase 1.5a enforces spine coverage per settlement using each world's roster here; Phase 1
adds the civilian-labor archetypes (farmer/builder/miner/logger/miller/fisher/cook) to the world
archetype sets above; Phase 8 ingests these into `professions.json`/composition templates for the 8
non-tunya worlds; the **bolded** signature/authority roles (sealie_hunter, decker, Vesper Kane, Voss,
Calla Bren, First Voice) are the per-world apex/tyranny anchors that seed grievance + movements
(Phases 4–5) and saga beats (Phase 7).

## Appendix B — Vision acceptance scenario (the broke-villain chain) — the north-star test

No quest designer authors a single frame: economics → crime → grudge → cross-world favor → faction war →
city-leveling brawl, seeded by **one NPC's empty wallet**. The plan must make all 8 beats emergent. Audit
status (verified against code) + which phase closes each gap:

1. **NPC/user runs a store** — owner-gated buildings exist (restaurant/housing `owner_type`/`owner_id`); the labor+sparks economy is **Phase 3**. ✅/🔧
2. **Broke villain robs it** — `world-crime.js#npcBreakIn` (steal from a building) **already exists but is NEVER called**, and `npc-economy.js#consumePersonalNeeds` returns `no_food`. **Precise new wire (Phase 3):** desperation (broke / `no_food`) → `npcBreakIn(nearest vulnerable store)` in `npc-economy-cycle` (a `case 'rob'` in `dispatchEconomicAction`). The villain isn't scripted — they're broke. 🔧 small wire on existing fns.
3. **Shopkeeper forms a grudge** — fully real: `npc-asymmetry` grudges + nemesis graph; a robbed NPC holding a grudge is the system working. ✅
4. **Reaches cross-world to recruit an adventurer ally** — cross-world messaging (`concord-link`), travel (`world-invites` + `npc-spawning.js#recruitFromWorld`), and even `cross-world-schemes.js` exist; the **only** gap is the 2-person ally coalition = the **Phase-5 movement/cell primitive at N=2, cross-world** (reuse the cross-world-scheme correspondent pattern). 🔧 = Phase 5.
5. **Spells still work because the friend's mastery is high enough** (hostile-world magic damping) — audit: `elementalEnvBoost` (env→skill potency) is WIRED into the combat path (`routes/worlds.js:2143`) but **`worlds.rule_modulators.magic_level` is read and never applied**, and `skill-mastery.js` does NOT exist as a file. **New wire (Phase 8):** apply a `rule_modulators.magic_level` downscale to `elementalEnvBoost`, then let high mastery (the mastery tiers used for HUD at `server.js:24408`) **bypass the downscale** (reduced, not nullified) — *skill ceiling = cross-world passport.* 🔧
6. **Adventurer kills the villain** — combat real (NPC path server-authoritative; the PvP `combat:impact` fix makes PvP feel like a fight). ✅
7. **Chain reaction → villain's death reported to a supervillain → adventurer hunted** — audit: the kill path's kin/faction **grudge+opinion cascade is WIRED** (`routes/worlds.js:2346`, `npc-asymmetry.js:40`); but faction-stance-shift-on-kill and a boss pursuer are **MISSING** (`faction-strategy` war picker exists at `:281` but kills don't bump it; `world-bosses.js` is calendar-only). **New wires (Phase 6):** `escalateOnPlayerKill` bumps `faction_strategy_state.momentum`; a player notoriety rung past threshold spawns a `world_boss_active` vendetta pursuer; surfaced via the Chronicle. 🔧
8. **Enforcer arrives → city-destruction-level fight** — audit: structural destruction is **WIRED** (`routes/worlds.js:2528` `applyStructuralStress`); but witness-on-combat, enforcer auto-summon, and crisis-escalation are **MISSING** (`world-crime._detectWitnesses` only fires on lockpick/theft; `world-crisis` has no destruction trigger). **New wires (Phase 6/10):** detect witnesses on high-magnitude combat → `spawnEnforcer` + `world:authority-summoned` realtime when destruction/notoriety crosses a non-safe-zone threshold; optional catastrophic-destruction → `world-crisis`. 🔧

**Tally:** 5 beats run today (1 partial), 2 are the in-flight integration/visibility work (Phases 5/6/7),
1 is a tuning rule on existing substrate (beat 5). The new wires (beat 2 crime-on-need; beat 4 N=2
cross-world coalition; beat 5 mastery-passport; beats 7/8 escalation/auto-summon triggers) are folded
into the phases above. This chain is the acceptance test for "done."

## Critical files (representative, not exhaustive)
- Resource/craft foundation (P0): new `server/lib/resources.js` + `server/lib/craft-resolve.js` + migration (`resource_properties`, `player_inventory.properties_json`); wrap `server/lib/crafting/craft-engine.js`, `server/lib/glyph-spells.js`, `server/lib/skill-evolution.js`, `server/lib/tool-tree.js`; station-quality on `building-interiors.js`/`world_buildings`.
- Food/crossbreed (P0.5): `server/lib/ecosystem/loot-tables.js` (fix `rollLoot` empty-on-hybrid) + new `server/lib/ecosystem/procedural-meat-composer.js`, `server/routes/world-creature.js` (butcher), `server/lib/creature-crossbreeding.js` (`generateHybrid` blend), `server/lib/ecosystem/cook-engine.js`, `content/world/*/bestiary.json|species.json`.
- Destructible world (P0.6): new `world_terrain_deformations` migration + `server/lib/terrain-deformation.js`, `server/routes/worlds.js` (dig + deformations endpoints), `concord-frontend/lib/world-lens/world-deformation.ts` (promote `DeformationStore` to heightfield-applying), `concord-frontend/components/world-lens/TerrainRenderer.tsx` (`getElevationAt` base+delta + replay), `concord-frontend/lib/world-lens/physics-world.ts` (batched `setHeightmapData`), `server/lib/world-gathering.js` (fix sin-wave divergence), `applyStructuralStress` coupling.
- Settlement/relationships (P1.5): `server/lib/content-seeder.js` (ingest `relationships[]`), `server/emergent/procedural-npc-spawner.js` + `server/lib/procgen-settlements.js` (taxonomy fill), `server/lib/npc-family.js`, `server/lib/npc-consequences.js` + `server/lib/npc-legacy.js` (vacancy/succession), `server/lib/building-interiors.js` (role↔building), new `settlement_composition`/`settlement_vacancy` migration.
- Labor/world (P2): `server/lib/npc-routines.js`, `server/lib/npc-economy.js`, `server/lib/farming.js`, `server/lib/world-buildings-repair.js`, new `server/lib/npc-labor-world.js`, new migration.
- Pay/flow: `server/lib/currency.js`, `server/lib/npc-gear.js`, `realms`/`realm_decrees` (mig 158), new `server/lib/sparks-flow.js` + migration.
- Politics: `server/lib/npc-asymmetry.js`, `server/lib/scheme-overhear.js`, `server/lib/embodied/faction-strategy.js`, `server/lib/lattice-quest-composer.js`, new `server/lib/movements.js` + migration.
- Legibility: `server/lib/embodied/dream-engine.js` (template), `server/economy/royalty-cascade.js`, `server/lib/world-shard-protocol.js`, new `server/lib/chronicle/*`, `server/domains/chronicle.js`, `concord-frontend/components/world/EmergentEventFeed.tsx`, new `/lenses/chronicle`.
- Reskin/content: `server/lib/content-seeder.js`, `content/world/*/professions.json|industries.json|lore.json`.
- Player actionability (P9): `server/lib/tunyan-jobs.js` (extend → general occupation loop), `server/lib/npc-economy.js#dispatchEconomicAction` (open to players), `server/lib/skill-evolution.js` (master ladder), new `concordia:action-anim`/`playAction` in `concord-frontend/components/world-lens/AvatarSystem3D.tsx` (+ reuse its NPC occupation clips) + `combat-motor-driver.ts`/`JointMotorSystem`, retire `AnimationManager.tsx`, `lib/concordia/juice.ts` feedback.

## Cross-cutting invariants
- Per-world tables written only by `scope:'world'` heartbeats; global tables (dtus/ledger/citations) only on the parent — register every new per-world table in `world-shard-protocol.js#PER_WORLD_WRITE_TABLES`.
- Heartbeats never throw (try/catch); deterministic resolution paths (no RNG); composers never invent / never leak secret bodies.
- Constitutional marketplace-fee + royalty constants are untouched; corruption diverts existing flow, never mints.
- Migrations append-only; new `register*` imports sit after `LENS_ACTIONS`/`register` (TDZ hazard).
- **Crafting is soft-fail** (wasted mats + minor debuff, never a hard lock); base resources always farmable so no one is blocked; resource/material catalog is **data** (new tier/mat/profile needs no new code).
- **Crossbreed blending is deterministic + gen-decay-clamped** (no runaway potency across generations); a hybrid MUST drop something; drop/food effects live on material profiles, never hardcoded per-item.
- **Cold-start seeding is idempotent**; every operational settlement covers its required-role taxonomy (or is visibly under-staffed = a symptom); a killed critical role MUST register a vacancy + resentment (every NPC load-bearing).
- **Immersion / abundant verbs (cross-cutting, Phase 9):** every system must expose a PLAYER verb rendered with the procedural-animation engine, not just NPC simulation — the world must always have lots to *do* (occupations are playable, terraforming is hands-on, daily activity carries weight like combat). Adding a verb should be data + an animation descriptor, not a bespoke system.
- **Hydrology is load-bearing, not cosmetic:** water reads per-cell height + conserves volume + flows over the deformed heightfield (dig-to-flow), and the terrain/water meshes rebuild so it's *rendered*.
- Each phase ships with a contract test and leaves the system working.

## Verification (whole initiative)
- Backend: `node --test` per phase (deterministic composers, idempotent cycles, flow math, movement state machine) + the touched-area regression suites. Boot the **dev server** to confirm new endpoints/heartbeats wire (the OOM-safe probe: `PORT=… node server.js` + curl).
- Frontend (full `tsc` OOMs this container): **scoped `tsc`** (extend real tsconfig, narrow `include`, `--skipLibCheck` + `--max-old-space-size=1536`) + targeted `vitest run <file>` — both proven this session.
- Branch: continue on `claude/audit-findings-remaining-BkcKy` (or a fresh `claude/living-society-*`), commit per phase, push.

## Sequencing
**0 (resource/craft foundation) → 0.5 (food/crossbreed) → 0.6 (destructible world / terrain-as-resource)
→ 1 (civilian roster) → 1.5 (settlement composition + cold-start relationships + vacancy) → 2
(labor→visible world) → 3 (sparks-flow/pay + corruption) → 4 (grievance vs authority) → 5 (movement/cell
KEYSTONE) → 6 (uprising→faction + quest) → 7 (Chronicle legibility) → 8 (per-world reskin) → 10 (law/
crime/jail) → 11 (governance hierarchy: vassalage/Emperor/Sovereign) → 12 (emergent ideology / NPCs-first
politics) → 13 (world-creation as the highest-stakes verb: two-tier worlds + founding grace +
conquerable-not-deletable + conditional god-tier forces). 9 (player actionability) runs cross-cutting
throughout.**

**Phase 13** is the capstone of the constitutional through-line (power earned in-world, never granted by
authorship) — it applies the Emperor/law rule to *creation itself*. It sits on Phase 11's
conquest/deposition (lifted realm→world level), the already-shipped `world-zones` sanctuary core +
`land_claims` (extended with `expandClaim`), and the `elementalEnvBoost`/`embodied_signal_log`/
`user_active_effects` conditional-power substrate (god-tier forces = conditions over constants, reusing the
bending-combat engine). Its **authoring half** (two-tier flag, founder-grace seeding) is low-risk and can
land early; its **conquest/sanctity half** depends on Phase 11.

**Phase 12 (emergent ideology / NPCs-first politics)** sits on top of the grievance→movement stack
(Phases 4–5) and the per-world reskin (Phase 8) — it makes ideology a *structured position on authored
axes* that becomes the recruitment **attractor** for the Phase-5 movement engine, so politics runs from
the cold start (the Dual-Universe fix) rather than waiting on players. It can begin its **authoring half**
(`ideology.json` axes + `faction_ideology` seeding + the legibility map) early in parallel (low-risk
content), but its **mechanical half** (recruit-by-position, demagogue moves, defection, faction political-
weather) lands after Phases 4–5 exist to consume it. It also forward-fixes the dead
`lattice-orchestrator.js` `severity:"high"` drift→HLR filter while building the parallel faction-drift
suite.

Phase 0.6 depends on Phase 0 (terrain materials are propertied) and tightens Phase 1.5/2 (building
becomes resource-gated; labor deforms the world). It's the **conserved-matter floor** — extraction
(deform world) → resources → build/craft (expend) → growth + depletion → scarcity → grievance.
**Phase 9 (player actionability) is cross-cutting**, not last — each phase ships its player verb +
animation as it lands, so there's always abundant, rendered things to do; Phase 9 also delivers the
general action-animation framework + makes the occupation taxonomy player-playable.
**Phase 10 (law/crime/jail)** sits on Phases 3/4/5/9 (corruption-bribe, grievance, coalition-springs,
prison-labor) + the Refusal Field; **Phase 11 (governance hierarchy)** is the spine the whole thing
hangs on — it composes realms + faction-strategy + Phases 3/4/5/10 into a vassalage tree whose
tribute/protection edges the grievance→rebellion engine constantly polices, topped by the Emperor
(per-world, shatters-on-death) and the mythic Sovereign cap.

Phase 0 is the literal basis — resources are the currency of every layer above. Parallelizable: 0.5 can
follow 0 independently; 1 + 1.5b (relationship seeding) are low-risk early wins; 8-content is authorable
in parallel throughout. The **movement/cell primitive (5) is the one genuinely-new keystone**, with **Phase 12's structured
ideology axes + `faction_ideology` persistence** the second net-new structure (and the cold-start motor
that makes the movement graph ideological) — almost everything else is *assembly + wiring* of
audited-present systems (labor loop, grudges with `target_kind='faction'` already legal, schemes,
overhear, deterministic `pickMove` faction-strategy, the drift-monitor snapshot→detector→alert pattern,
combat-poise, crossbreed, npc_relationships, royalty/DTU). Each phase ships
a contract test and leaves the system working; this is a multi-sprint initiative, not one PR.
