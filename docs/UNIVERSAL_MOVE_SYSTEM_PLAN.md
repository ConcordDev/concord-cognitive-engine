# Universal Move System — Implementation Plan & Handoff

> **Handoff note (for the next session).** This is the approved plan for the Universal Move System
> (the isekai "[System]" where any user/NPC/creature creation → procedural animation + effect, fairly
> leveled & lore-bound). It was researched across 5 deep web/code threads + a lore audit.
>
> **Progress so far (branch `claude/move-system-p1-resolver`, NOT yet merged):** Phase 1 keystone
> STARTED — the pure client resolver + catalog core are built and unit-tested green (11/11):
> - `concord-frontend/lib/concordia/move-catalog/move-types.ts` — MoveDescriptor + ResolvedMove +
>   `SKILL_KIND_MOTION` (7 kinds → archetype/limb/effect/gauge) + `ELEMENT_EFFECT_BIAS` + `clampTier`.
> - `concord-frontend/lib/concordia/move-resolver.ts` — `resolveMove(input)` (never-null, backward-compat
>   derive from skill_kind+element) + `tierForLevel` (Pillar 1: level→tier, saturates at 5).
> - `concord-frontend/tests/concordia/move-resolver.test.ts` — 11 tests, all green; scoped `tsc` clean.
>
> **Next steps (finish Phase 1 → then Phases 2–9):**
> 1. Server `server/lib/move-descriptor.js#deriveMotion(...)` + stamp `meta_json.motion` at
>    `glyph-spells.js#mintSpell` / `skill-evolution.js#applyEvolution` / recipe-create.
> 2. Wire `resolveMove` into `lib/concordia/play-action.ts` + `AvatarSystem3D.handle{Action,Combat}Anim`,
>    replacing the generic `cast` fallback. Behind kill-switch `CONCORD_MOVE_RESOLVER`.
> 3. Live-server probe (register → mint a move → confirm `meta_json.motion` stamped; L1 vs L200 differ).
> 4. Then Phase 2 (the "[System]" builder + the 3 balance pillars), Phase 3 (guns), Phase 4 (movement
>    powers), etc. — see phases below.
>
> Cadence: small PRs per phase, each behind its kill-switch, merged green — same as the destructible-world
> + fluidity work (#786–795). Pure logic unit-tested headless; visual/feel verified in-engine by the user.

---

# Plan — Universal Move System: the isekai "[System]" where any creation → animation + effect, fairly leveled & lore-bound

## Context

Concord lets users, NPCs, factions, creatures, fauna and flora *create* moves — glyph spells, fighting
styles, biopowers, psionics, cyber abilities, guns, **movement powers** (flight/super-speed/ice-slide/
web-swing…), and fused/evolved skills. The vision: an in-game **"[System]"** (webtoon/isekai — Solo
Leveling / The Gamer) that is friendly, fun, and has **no learning curve**, where a player *configures* a
move from constrained options, and the move **levels up through tiers** so power + visual grandeur grow
with invested skill — never with how grand the description sounds — and where every move is **bound to the
lore**: it drains the world-appropriate power gauge, is gated by what each world permits, and **loses
potency when carried to another world** unless the skill is highly leveled.

Five deep research threads + a code audit found the spine **mostly already exists**; the gaps are the
resolver, the builder UI, guns, movement *powers*, and the fairness/lore gates. Production-grade already:
- **Infinite, fair, per-skill progression** (`skill-progression.js`): `level = 1 + √(totalExp/2)`,
  unbounded, mastery tiers Novice(10)→Skilled(50)→Expert(100)→Master(200)→Legendary(500)→Mythic(1000)→
  Transcendent(5000) w/ auras, diminishing returns, **`cross_world_use` 1.5× XP** rate already defined.
- **Tiered evolution every 10 levels** (`skill-evolution.js`): revisions, dmg ×1.15/tier, **anim tier
  caps at 5 (visual ceiling) while power scales** — the "L1 spell weak, same move at L200 = full vision" model.
- **Constrained builder algorithm** (`glyph-spells.js`): compose 2–5 components, element-family coherence,
  deterministic preview — **no player UI**.
- **Skill fusion** (`skill-fusion.js`, WIRED): two-parent hybrids, element fusions, generation decay,
  inbreeding penalty, gen-8 singularity, LLM cap — **no player UI / level+cost gates**.
- **The "[System]" UI substrate**: `LevelUpJuiceBridge`, `GameJuice`, `AchievementSystem`, `SkillsPanel`,
  `EvolutionModal` (already a skill-upgrade modal w/ player input + revision lineage), `HUDOverlay`,
  `SmartNotifications`, toast store.
- **Movement substrate**: `flight-physics.ts` (full banking/stall/thermal aero model + `concordia:flight-
  state`), `traversal-kinematics.ts` (dash/i-frames/momentum/slide), `physics-world.ts` (jump/glide/swim/
  dash, `registerWaterPlane`), pose-broker `traversal` source, action-biomechanics traversal descriptors.
- **Lore + per-world levers**: base-6 glyphs (⟐/⟲/⊚), 9 canonical elements, 7 skill_kinds (each implying a
  power source: spell→mana, biopower→bio, cyber_ability→charge…), the Refusal anti-power class,
  per-world `skill_affinity[domain]` + `magic_level`/`tech_level` `rule_modulators`, `native_world_type`
  stamped on skills, acquisition via mentorship (mig 127), knowledge-trade, marketplace.
- **Animation engine**: 10 archetypes + 51 verbs + tiered pose generators, `element-vfx.ts` (7 elements),
  `world-vfx-bridge.ts` (19 effects), IK (`fabrik-ik`/`hand-ik`/`foot-ik`).

Genuine GAPS: (1) **no universal resolver** — a minted move stores element+damage+glyph but NO animation
archetype, so every custom move plays a generic `cast`; (2) **no player move-builder UI**; (3) **guns are
a stub** (no ammo/reload/recoil/range; a gun user even parries as fast as a swordsman — a real bug);
(4) **movement powers** beyond basic dash/glide are absent (no flight activation, super-speed, ice-slide/
surface-gen, web-swing, blink, double-jump/air-dash/wall-run; no `motionFamily` field); (5) **no
constrained modifier-budget / level-gated config layer**; (6) **no lore-resource-gauge or cross-world-
potency rules**; (7) fusion + creatures lack UI / animation.

**Decisions (locked with user):** resolver+catalog FIRST; creatures = dedicated later phase; rich
per-genre baseline; guns **balanced, not OP**; builder is **constrained config, not free-text**; hybrid/
cross skills; movement powers are **lore-bound sustained drain-buffs**, **acquirable (learn/buy/make)**,
and **level-gated**; the whole thing is the friendly isekai **"[System]"**. Reuse the existing
progression/fusion/UI/flight substrate — extend, don't reinvent.

---

## Three balance pillars (the spine — enforced server-side, apply to EVERY move: combat/spell/gun/movement)

**Pillar 1 — Design ceiling vs. level-gated active tier.** A move's CONFIG defines its *design* (the
aspirational ceiling). The player's SKILL LEVEL gates which *tier* is active — power dealt + visual
grandeur. Power is NEVER a function of the description, only of invested level. A L1 "destroys everything"
fire spell renders + hits as L1 (small flame, modest dmg); the same authored move at L10/20/30… unlocks
its own tiers, power + fidelity scaling together (revisions ×1.15/tier; anim tier 1→5). Infinite levels +
diminishing XP ⇒ a **L15 player with a L200 skill out-specialises a L50 generalist** (narrow-deep vs
broad-shallow both viable via niche + gear). Built on the EXISTING `skill-progression` + `skill-evolution`.

**Pillar 2 — Lore-resource matrix (per world × skill_kind).** A move is a sustained/instant cost on the
**world-appropriate gauge**: spell/fantasy → **mana**; superhero → **biopower gauge**; cyber → **cyber
charge**; **crime → no innate powers/flight at all** (gear/vehicle/parkour only); mundane → stamina.
A world's `skill_affinity[domain]` + `magic_level`/`tech_level` gate **availability** (a world that
lore-forbids a power can't host it) and the gauge it drains matches the world's power source. Movement
powers especially are **sustained drains** (flight sips mana/bio/charge; runs out → you fall).

**Pillar 3 — Cross-world potency falloff.** Every move records its `native_world_type` + that world's
affinity for its domain. Carried to another world, potency =
`targetAffinity(domain) + (1 − targetAffinity) × masteryFactor(skillLevel)` — full in your native/
friendly world; in a foreign world it sags toward that world's affinity, and **skill level claws it back**
(a Master skill travels anywhere; a novice skill collapses toward the foreign affinity → potentially
useless, e.g. a novice fire spell in the no-magic crime world). Forces **adapt or specialise**: level a
skill deep to travel with it, OR learn the local world's skills. Applies to users, NPCs, creatures alike;
the existing `cross_world_use` 1.5× XP rewards pushing through, so adapting IS the grind. Reuses
`native_world_type` + `skill_affinity` — wire them into a `crossWorldPotency()` at resolve/combat time.

---

## Architecture (one descriptor, one catalog, one resolver, one builder, one progression spine)

- **Move Descriptor** (`meta_json.motion`, resolved client-side; derive-on-the-fly when absent):
  `motionFamily` (combat-melee/ranged/**firearm**/magic/**movement**/social/labor/creature…),
  `motionArchetype` (biomech pose family + new flight/surface-ride/swing/speed-trail), `effectArchetype`
  (15: projectile/beam/nova/aura/melee-imbue/…), `element`, `powerCategory?`, **`resourceGauge`**
  (mana/bio/charge/stamina/none), **`nativeWorld` + per-domain affinity**, `designCeiling`,
  `leadingLimb/emissionPoint`, `targetShape`, `phases`, plus `traversalParams?` (archetypeType flight/
  speed/surface/blink/mobility, tier, speedMs, durationMs, cooldownS, elementalDependency). Resolver
  derives the *active* clip/vfx/sfx from descriptor × current tier × Pillar-2 gauge × Pillar-3 potency.
- **Reference Catalog** (shared modules): `elements` (7→~18–24), `effectArchetypes` (15), `skillKindMotion`
  (7 kinds → archetype+limb+gauge), `powerCategories` (17 + Refusal), `glyphShape` (chain → archetype),
  `gunArchetypes` (pistol…sniper/energy), `movementArchetypes` (flight/super-speed/surface-traversal/
  blink/mobility-mods), `creature/flora actions` (later).
- **Resolver** — client `move-resolver.ts`; server `move-descriptor.js#deriveMotion` (stamps at mint/
  evolve/fuse). Wired into `play-action.ts` + `AvatarSystem3D.handle{Action,Combat}Anim`.
- **The "[System]" Move Builder** — isekai UI on the existing modal/HUD/juice pipeline.
- **Progression spine** — REUSE `skill-progression` + `skill-evolution`; add modifier-budget + per-level
  modifier-slot unlocks (1@L10→4@L50).

---

## Phases (each ships in tested slices behind a kill-switch; pure logic unit-tested headless, live-server probe, in-engine feel by user)

**Phase 1 — Descriptor + Catalog + Resolver (keystone).** Move Descriptor (incl. motionFamily/resourceGauge/
nativeWorld), catalog modules, client resolver + server `deriveMotion` stamping, wired into playAction/
combat so **every created humanoid move animates per element + archetype + current tier** (not generic
`cast`); backward-compat derive. Kill-switch `CONCORD_MOVE_RESOLVER`. **[client resolver + catalog DONE
on branch `claude/move-system-p1-resolver`; server stamping + wiring REMAIN]**

**Phase 2 — The "[System]" Move Builder + the 3 balance pillars.** The isekai builder (`SystemMoveBuilder`
on `EvolutionModal`+`SkillsPanel`+`HUDOverlay`): base move + constrained **modifier-budget**, live
deterministic preview, friendly "[System]" windows ("[New Skill: Fireball Lv.1]", "[Evolve to Lv.11?]",
"[Reached Master]"). Enforce server-side: per-level modifier slots (1@L10→4@L50), **Pillar 1** (design
ceiling vs active tier), **Pillar 2** (`resourceGauge` drain + per-world availability), **Pillar 3**
(`crossWorldPotency()` at resolve/combat). Kill-switch `CONCORD_MOVE_BUILDER`.

**Phase 3 — Guns, balanced.** `server/lib/firearms.js` + `domains/guns.js`: ammo/magazine + reload,
recoil/spread bloom, range-falloff (`dmg×max(0,1−(d/maxRange)²)`), archetypes (pistol/SMG/rifle/shotgun/
sniper/energy), Draw→Aim→Fire→Recover→Reload grammar (new `firearm` archetype + `combat-frame-data` rows).
Anti-OP levers: **ranged parry-window=0** (fixes the bug), ammo scarcity + reload recovery, range-vs-power,
per-world `skill_affinity.gun`, the same level ladder. Kill-switch `CONCORD_FIREARMS`.

**Phase 4 — Movement powers (lore-bound, acquirable, level-gated).** New archetypes (`flight-hover/
sustained`, `surface-ride` for ice-slide/fire-flight/water-spout, `web-swing` pendulum, `speed-trail`,
`blink`, mobility-mods: double-jump/air-dash/wall-run/mantle) reusing `flight-physics.ts` + `traversal-
kinematics.ts` + new activation events + anti-cheat (`_validateFlightReach`/`_validateSpeedMultiplier`).
Each is a **sustained drain on the Pillar-2 gauge** (flight sips mana/bio/charge; crime world = none),
**level-gated** (L1 ice-slide short/slow/thirsty → L200 freeway that sips), **cross-world-potency'd**
(Pillar 3), and **acquirable** via mentorship/marketplace/glyph-authoring (add `wind/speed/phase` glyph
components). Tier ladder mapped onto existing `mastery.milestones`. Kill-switch `CONCORD_MOVEMENT_POWERS`.

**Phase 5 — Hybrid / cross / fusion skills.** Expose `skill-fusion.js` via the builder: preview + commit
routes, **level + cost gates**, element-fusion table, "[Fusion complete]" notifications. Gun+magic +
movement hybrids (e.g. fire-flight = fire ⊕ flight). Kill-switch `CONCORD_SKILL_FUSION_UI`.

**Phase 6 — Effect VFX rendering.** Extend `element-vfx.ts` to the full catalog; render the 15 effect
archetypes through `world-vfx-bridge.ts` (projectile/beam/nova/ground-zone/aura/melee-imbue/dash-afterimage/
shield…), keyed to element color + cast→delivery→impact grammar + tier-scaled.

**Phase 7 — Lore grammar + powers + rich per-genre baseline.** Glyph-shape → archetype; the 17 power
categories for biopower/psionic/cyber/body-weapon + Refusal; **per-genre starter spell/power/gun/movement
sets** (fantasy/superhero/cyber/sovereign/lattice) so each faction reads distinct out of the box.

**Phase 8 — Procedural depth.** IK reach, layered blend (cast-while-moving, fly-while-casting), physics-
ragdoll impact blend, 12-principles polish over resolver output.

**Phase 9 — Creatures / fauna / flora (the void).** Shape-agnostic rig + retargeting (humanoid→quadruped→
flying→exotic), creature action vocab (bite/claw/breath/roar/tail-swipe…) + flora (entangle/spore/root) +
creature movement (flap/slither/swim). Descriptor is shape-agnostic from Phase 1 so they slot in.

---

## Critical files
- **New:** `lib/concordia/move-catalog/{elements,effect-archetypes,skill-kind-motion,power-categories,
  glyph-shape,gun-archetypes,movement-archetypes}.ts`, `lib/concordia/move-resolver.ts`,
  `components/world/SystemMoveBuilder.tsx`, `server/lib/move-descriptor.js`, `server/lib/firearms.js` +
  `server/domains/guns.js`, `server/lib/ammunition.js`, `server/domains/movement-powers.js`,
  `server/lib/cross-world-potency.js`.
- **Edit (resolver + gauges + potency wiring):** `lib/concordia/play-action.ts`, `AvatarSystem3D.tsx`
  (`handleActionAnim`/`handleCombatAnim`/flight activation), `skill-motion.ts`, `element-vfx.ts`,
  `world-vfx-bridge.ts`, `lib/concordia/skill-descriptors.ts` (add `motionFamily`/`traversalParams`),
  `flight-physics.ts`/`traversal-kinematics.ts` (activation hooks).
- **Edit (server):** `glyph-spells.js#mintSpell` (+ wind/speed/phase components), `skill-evolution.js`,
  `skill-fusion.js` (+ routes), `combat-frame-data.js` (firearm/ranged frames), `routes/worlds.js`
  combat/attack (ammo + range tiers + falloff + `crossWorldPotency` + gauge drain). **Reuse**
  `skill-progression.js`, `skill-domains.js` (`skill_affinity`), `mentorship.js`, marketplace,
  `refusal-field.js`, world `rule_modulators`/`native_world_type`.
- **Edit (UI reuse):** `EvolutionModal.tsx`, `SkillsPanel.tsx`, `HUDOverlay.tsx`, `LevelUpJuiceBridge.tsx`,
  `GameJuice.tsx`, `SmartNotifications.tsx`, `FlightHUD`, toast store.
- **Phase 9 new:** `lib/concordia/creature-rig.ts`, `move-catalog/{creature-actions,flora-actions}.ts`.

## Verification
- **Headless (every slice):** pure catalog/resolver/builder-math/falloff/ammo/gate/potency logic
  unit-tested (resolver never-null + backward-compat; modifier-budget + per-level slots; range-falloff;
  ammo consume+shortage; fusion level/cost gate; element coherence; **Pillar-2 gauge drain**; **Pillar-3
  cross-world potency curve** — native=full, foreign-novice≈floor, foreign-master≈full); scoped `tsc`;
  full `concord-frontend` vitest; `node --test`; `node --check`. **Live-server probe** (the dev-server
  playtest that caught the hydrology bug): register → build a move → confirm `meta_json.motion` stamped;
  L1 vs simulated-L200 resolve differ in tier/power; fire a gun → ammo decrements + reload gate; activate
  flight → mana/bio gauge drains, crime-world rejects it; same skill resolved in native vs foreign world →
  potency differs by level.
- **In-engine (user):** the "[System]" windows read friendly (no learning curve); L1 vs leveled moves
  visibly differ; fire/ice/gun/flight/fused hybrid each animate + emit distinct, element-correct effects;
  guns viable-not-OP; flight/ice-slide/web-swing feel right + drain the right gauge + lore-gated per world.
  Kill-switch off → today's behaviour.
- Small PRs per phase behind kill-switches, merged green — same cadence as the destructible-world +
  fluidity work this session (#786–795).

NOTE: Large multi-PR initiative; the plan is the roadmap. **Phase 1 (descriptor+catalog+resolver) is the
keystone**; Phase 2 (builder + 3 balance pillars) is the central ask; guns + movement + hybrids are the
named must-haves. Most of the progression/fusion/UI/flight substrate exists — this exposes, unifies,
balances (Pillars 1–3), and renders it. Supersedes the completed destructible-world + fluidity plan (#786–795).
