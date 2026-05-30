# Plan — Concordia renders EVERYTHING in 3D (animation for every verb + every system visible & cool)

## Context

Concordia is a **3D world game** (Three.js), not a textbook/text-box. The Living Society backend (all 14
phases) is complete and tested, but most of it is **invisible** — it lives in server tables + 2D panels and
**does not render in the 3D world**. The ask: make *everything* render in-world and **look cool** — every
player verb embodies the avatar, and every system (terrain, water, crops, nodes, buildings, settlements,
crowds/uprisings, labor, law, governance, chronicle, economy, ideology) has a real 3D representation with VFX/juice.

This is a precise, multi-workstream rendering initiative on top of the existing renderers. Below is grounded
in a full audit of both pipelines (animation + world-rendering).

### What already renders (reuse, don't rebuild)
- **Scene graph**: `components/world-lens/ConcordiaScene.tsx` composes layers: `terrain` (`TerrainRenderer`),
  `buildings` (`BuildingRenderer3D`), `avatars` (`AvatarSystem3D`), `weather` (`SkyWeatherRenderer`),
  `water` (static planes y=2.0), `particles` (`EmbodiedParticlesBridge`), `ui` (projector overlays),
  **`infrastructure` (reserved + EMPTY — the home for new world-state renderers)**.
- **Animation core (all live)**: `lib/concordia/pose-broker.ts` (priority blend
  `reflex>combat>ik>gait>idle>facial`), `gait-synthesis.ts` (worker), `combat-biomechanics.ts` (557 LOC,
  tier-scaled procedural strikes — the **procedural template**), `reflex-layer.ts`, `fabrik-ik`/`foot-ik`/
  `hand-ik`, `secondary-physics.ts`. Combat path: `concordia:combat-anim` → `AvatarSystem3D.handleCombatAnim`
  (line ~1335) → `buildBiomechClipMap` → mixer.
- **Dead/dormant (revive or mirror)**: `joint-motors.ts` + `combat-motor-driver.ts` (motor path, superseded
  by baked clips), `AnimationManager.tsx` (near-stub, retire). NPC occupation clips exist
  (`NPCOccupationAnimation`: hammer/read/tend-crops/patrol/count-coins/construct/sweep/lecture) but **don't
  blend with gait** and **players can't play them**.
- **VFX/juice hooks**: `lib/concordia/juice.ts` (`juice()`→`concordia:game-juice`, `sfx()`→
  `concordia:soundscape-command`), `EmbodiedParticlesBridge` (footstep dust/breath), `BuildingCollapseVFX`,
  `concordia:camera-punch`, damage billboards. **A general `concordia:particle-effect {type,position,
  duration,intensity}` event exists but has NO consumer** — wiring one unlocks world VFX everywhere.
- **Data→scene sync patterns**: (A) REST poll, (B) socket `subscribe(event)`, (C) `window` CustomEvent,
  (D) projector (3D→screen for HTML overlays). `world:building-state`, `combat:*`, `world:action` already flow.

### The gaps (the work)
- **~70 of ~120 player verbs trigger no avatar animation** (all labor, all 11 stations, social/NPC, world-
  interaction). Stations are 2D panels; the player stands frozen.
- **Terrain deformation is cosmetic-only** ("the biggest lie") — `userData` flags, heightfield/collider
  never mutated, a dug crater is fake/walkable. Water = static planes, no flow. (Phase 0.6 client gap.)
- **Resource nodes render as NOTHING** (no meshes); **crops** have no 3D growth; **node depletion** invisible;
  **building construction progress** invisible (only damage/collapse render).
- **Settlements/land-claims**, **crowds/uprisings** (individual NPCs only, cap 50, no instancing/formation),
  **law/jail, governance/vassalage, chronicle, economy/market, ideology** — **zero 3D representation**.
- Skill elemental VFX, buff/debuff auras, healing, loot-drop meshes — missing (the "be cool" layer).

### Confirmed decisions (from review)
1. **Animation coverage = breadth then depth** — every verb resolves to a motion (archetype + fallback, no
   silent action) first; hand-tune the top ~15 after.
2. **Motion source = procedural + reuse clips** — procedural joint-pose descriptors on the biomechanics
   engine, AND reuse the NPC occupation baked clips for players where they exist.
3. **Parity = yes** — server broadcasts `world:action`; other players + NPCs animate from the same table.
4. **Everything renders in 3D + looks cool** (this rewrite) — not just animation; all systems get world renderers + VFX.

---

## WORKSTREAM 0 — Make the NPCs WALK (the first playtester's bug report) ⟵ JUMPS THE QUEUE

**Context (a real playthrough, not a theory).** The first playtester booted bare, stood in concordia-hub's
Unburned Court, and watched the heretic priest **stand frozen in a dying city**. Three seams, all now traced:

- **Seam 1 — frozen even when "working" (root cause, confirmed):** `lib/npc-routines.js#advanceRoutine`
  walks an NPC toward its activity-block target, but once `arrived` (within `ARRIVAL_RADIUS_M = 4`) it
  **pins the NPC to the EXACT `target_x/target_z` every tick** (lines ~455–460) for the whole block. A
  priest communing at the temple = a statue for hours of game-time. There is **no idle motion when
  arrived** — that is the "standing still."
- **Seam 2 — frozen for the first minute (bare-boot warmup):** the heartbeat dispatcher starts at
  **boot+50s** and `npc-routine-cycle` runs at **frequency 5 (~75s)** — so on a fresh boot *nothing moves
  for the first ~50–125s*. Authored NPCs are also seeded with `spawn_location` but a NULL `current_location`,
  so the first nudge computes from `{0,0}` (the `|| {x:0,z:0}` fallback) — a far/garbage first step.
- **Seam 3 — sermon behind an offline brain + a position read that throws on null:** the priest's
  ambient speech/sermon is LLM-gated (Ollama is offline on a bare boot) and a position read throws on a
  null `current_location`. (Exact sites being pinpointed by a code trace; fixes below are by approach.)

**The fix — "let him pace."** Make NPCs visibly alive on a bare boot, deterministically, no LLM, no crash:

**0.1 Idle ambient motion (the core fix).** In `advanceRoutine`, when `arrived`, do NOT pin to the exact
target. Instead drift toward a **gentle pacing target** within `IDLE_WANDER_RADIUS_M` (~2.5m) of the
station, derived deterministically (seeded by `npc.id` + a ~20s time-bucket so it's testable and
network-cheap), and nudge toward it each tick. A communing priest now paces his temple; a guard shifts at
his post. Tunable via env. Keep the embodied-signal write tied to "at station," not to "perfectly still."

**0.2 Prompt the first motion (no dead first minute).** (a) At content-seed, set authored NPCs'
`current_location = spawn_location` so it's never NULL and the first step is sane (`content-seeder.js`
`seedNPCs`/`persistGeneratedNpc`). (b) Run **one immediate routine pass** shortly after the seed completes
(an early `runNpcRoutineCycle` call, or shrink the warmup for this cycle) so the world breathes within
seconds, not after 2 minutes.

**0.3 Deterministic sermon (speech without a brain).** Give the priest's sermon/ambient-speech path a
deterministic composer (extend the existing `lib/npc-dialogue-fallback.js#composeDeterministicDialogue`
pattern with grounded authored lines from the priest's `narrative_context`, or a small `composeSermon`),
so he **preaches** from authored material when the brain is offline. Never silent. (Exact LLM-gated
path: from the trace — `oracle-brain` / `npc-conversation-initiator` / the `/dialogue` sermon branch.)

**0.4 Guard the null position read.** Wrap the unguarded `current_location`/`spawn_location` parse (the
throw the playtester hit) in the existing safe-parse pattern (`parseLocation` already returns null-safe;
apply it / a try-guard at the throwing site). (Exact file:line: from the trace.)

**0.5 Render the walk (ties to WS1).** Server motion is invisible unless the client animates it: ensure
the NPC path in `AvatarSystem3D` blends the **gait** (already worker-driven) for a moving NPC and an
**idle breath/sway** for a paused one, and plays the NPC occupation clip for the current `activity_kind`
(reuse the WS1 `ACTION_DESCRIPTORS` table — one table for players + NPCs). So a pacing priest *reads* as
pacing, and a communing one breathes instead of T-posing.

**Reuse:** `advanceRoutine`/`parseLocation` (`npc-routines.js`), `npc-routine-cycle.js`,
`composeDeterministicDialogue` (`npc-dialogue-fallback.js`), `content-seeder.js#seedNPCs`, the WS1 action
table + `AvatarSystem3D` NPC gait path.
**Verify:** `node --test` — the idle-wander producing motion (arrived NPC's position CHANGES across ticks,
stays within the radius, deterministic for a seed); the deterministic sermon returns grounded text with no
LLM. Then the **real bar**: boot bare (no Ollama), stand in the Unburned Court, watch the priest **pace
within seconds** + speak a sermon line + zero position-null throws in the log.

---

## WORKSTREAM 1 — Animate every verb (avatar embodiment)

**1.1 Generalise the engine.** New `lib/concordia/action-biomechanics.ts` mirroring `combat-biomechanics.ts`:
`ActionDescriptor = { archetype, leadingLimb, phases:[windupMs,actionMs,followMs], loop?, clipId?, juiceId,
sfxId, vfx? }` + `buildActionClip(descriptor, body, tier)` reusing the same `Pose`/bones shape + phase math.
Ship the **10 motion archetypes** (swing_down / thrust / crouch_reach_pluck / cast_channel /
manipulate_in_place / cast_and_wait / lean_reach / social_gesture / mount / locomotion_modal — see Appendix)
and `ACTION_DESCRIPTORS` (the verb→descriptor table, ~40–50 rows).

**1.2 Pose-broker source.** Add `'action'` priority to `pose-broker.ts` between `combat` and `ik`
(`reflex>combat>action>ik>gait>idle>facial`) so an action layers over gait but yields to combat/reflex.

**1.3 Dispatch + bridge.** `lib/concordia/play-action.ts#playAction(verb,{tier,targetPos,loop})` dispatches
`concordia:action-anim`. New live `ActionAnimBridge` (or a `handleActionAnim` listener inside
`AvatarSystem3D`, mirroring `handleCombatAnim`): resolves the descriptor → if `clipId` present, plays the
baked occupation clip via the mixer; else drives the procedural archetype clip; blends over gait via the
broker; fires `juice.ts` + `concordia:particle-effect`. **Fix the occupation/gait blend** so a worker can
walk-then-act.

**1.4 Coverage guarantee.** A category fallback (labor→swing_down, craft→manipulate_in_place, social→
social_gesture, world→thrust) so **no verb is ever silent**. A vitest asserts every verb id from the master
inventory (Appendix) resolves to a descriptor.

**1.5 Trigger sites.** Fire `playAction` from: the 11 station overlays (plant/serve/hack-step/etc.), the
occupation/gather/dig/build/farm/fish/mine/log handlers, `NPCActionMenu` (talk/court/mentor/trade/hire),
emotes/mount/sign/photo/commune, and revive combat through the same path. Map NPC `activity_kind` → the same
`ACTION_DESCRIPTORS` (one table for players + NPCs).

**1.6 Parity.** Server emits `world:action {actorId, verb, pos}` from the occupation/station/terrain routes
(reuse `req.app.locals.io.to('world:'+worldId)`); other clients play the descriptor on that avatar.

**1.7 Retire** `AnimationManager.tsx` + the dead motor bridges (or repoint them at the live path).

---

## WORKSTREAM 2 — Render every world-state system in 3D (the `infrastructure` layer)

New renderers mounted in `ConcordiaScene`'s reserved `infrastructure` layer, each following sync pattern A/B.

**2.1 Resource nodes** (`ResourceNodeRenderer`): instanced meshes for `world_resource_nodes` (tree/ore_vein/
stone/crystal/herb/spring) at their x/z; **visibly deplete** (scale/shrink + material change as
`quantity_remaining` drops; vanish + stump/hole on depletion; respawn fade-in). Poll `/api/worlds/:id/nodes`
+ react to `world:node-depleted`.

**2.2 Crops growth** (`CropFieldRenderer`): render `claim_crops` per tile as 3D plants that step through
growth_stage 0→3 (sprout→ripe mesh swap); harvest pop. The farm becomes a visible field, not a grid panel.

**2.3 Construction progress** (extend `BuildingRenderer3D`): drive a scaffold→partial→full visual from
`world_buildings.construction_progress_pct` (frame at 0%, rising mesh/clip-plane reveal toward 100%), so a
builder NPC/player visibly raises a building. (Damage/collapse already render.)

**2.4 Terrain deformation = REAL** (Phase 0.6 client — the load-bearing fix): promote `world-deformation.ts`
`DeformationStore` from cosmetic to **heightfield-applying** — on load replay `GET /api/worlds/:id/
deformations` and on `concordia:terrain-deformed`, apply per-cell `height_delta` to the `TerrainRenderer`
mesh AND rebuild the Rapier heightfield collider (batched, not per-frame; Rapier needs collider
recreate-on-edit — do it on a debounce). Result: a dug pit is a real, walk-into-able hole.

**2.5 Hydrology = REAL** (Phase 0.6 client): replace static water planes with a **dynamic water surface** that
follows the `world_water_cells` grid (per-cell height → displaced/shader water mesh); a dug ditch visibly
fills as the flow solver runs; swim/drown already read per-cell server-side — render splash particles on
entry + depth gradient.

**2.6 Settlements / land-claims** (`ClaimBoundaryRenderer`): render `land_claims` as world boundary rings/
fences + a settlement nameplate/banner at the center; ownership/secession state tints it.

**2.7 Crowds & uprisings** (`CrowdRenderer` + instancing): replace the 50-NPC cap with **instanced rendering**
for far/background NPCs so a market is busy and an **uprising is a visible crowd** (banners, torches,
formation toward the target) when a `movements`/`movement_uprisings` row goes `acting` (`world:action` /
`world:uprising`). This is the payoff of the Phase 5/6 keystone.

**2.8 The "felt" society markers** (projector + light meshes): **law/jail** (a visible stockade/cage + a
"wanted" marker over a flagged player), **governance** (a faction banner/heraldry on controlled buildings;
an Emperor's standard; vassalage tint), **chronicle** (in-world historical markers/monuments at notable
event sites), **economy/labor** (market stalls + crowd density that tracks scarcity; "fields untended" =
visibly wilted crops), **ideology** (faction color/architecture already in `BuildingRenderer3D` heraldry —
drive it from `faction_ideology`). EmergentEventFeed/DistrictActivityFeed stay as HUD but get world-anchored
beacons via the projector.

---

## WORKSTREAM 3 — VFX & juice for everything (the "be cool" layer)

**3.1 Wire the orphan `concordia:particle-effect` consumer** (a `WorldVFXBridge` in the `particles` layer):
spawn pooled particle bursts at a world position by `type` (impact/dust/sparkle/smoke/splash/heal/cast). This
becomes the single hook every system calls.
**3.2 Skill/element VFX**: fire/ice/lightning/bio/energy bursts on cast + the existing combat element fields
(`combat:chain`, element bursts) get real particles.
**3.3 Auras**: buff/debuff visual stacks on avatars from `user_active_effects` (incl. the Phase-0 craft
backfire debuff, Phase-13 conditional god-tier `daylight_avatar`/`war_ramp`/`eternal_regen` glow).
**3.4 Loot/drop meshes**: butchered drops + corpses render as pickup-able 3D objects (Phase 0.5 propertied
drops), not just inventory rows.
**3.5 Per-verb juice**: every `playAction` carries a `juiceId`+`sfxId` (impact_wood, soft_pluck, whoosh,
forge_ring…) so doing anything has hitstop/sound/particle feedback (Swink "polish" pillar).

---

## Appendix — Immersive-verb taxonomy (research deliverable)

Synthesized from web research (David Rosen/Overgrowth GDC "build actions from a few key poses + IK + physics,
not long baked clips"; the 12 principles — anticipation→action→follow-through, weight via slow-in/out,
secondary motion; Swink *Game Feel* — real-time response + simulated space + **polish/juice**; BotW
"multiplicative verbs"; Bellwright/Medieval Dynasty visible labor; immersive-sim non-combat verbs). Sources at end.

**What makes a verb feel weighty/alive:** wind-up → commit → follow-through phasing; a clear leading limb +
full-body involvement; impact feedback (hitstop/SFX/particle/camera). Verbs that feel like "menu with extra
steps" = instant, body-less state changes (today's stations).

**10 motion archetypes (most verbs are one):**
1. swing_down (chop/mine/hammer/scythe/till) — arms+spine raise → arc down through target → recoil.
2. thrust (dig/spear-fish/jab) — dominant arm cocks → drives to point → pull back.
3. crouch_reach_pluck (gather/forage/harvest/plant/pet) — squat+torso fold, hand to ground → close → rise.
4. cast_channel (glyph/spell/commune/sign) — arms sweep up/out → hold channel → release.
5. manipulate_in_place (cook/craft/forge/mill/trade/repair) — lean to workspace, small repetitive hand loop.
6. cast_and_wait (fishing) — overhead cast → idle line-tension hold → reel loop.
7. lean_reach (lean/peek/pickpocket/lockpick/hack) — torso off-axis, one hand extended, low/slow.
8. social_gesture (greet/converse/emote/court/mentor/intimidate/applaud) — head turn + arm beats, no locomotion.
9. mount (mount/dismount/ride/vehicle) — mount swing → seated idle → steer.
10. locomotion_modal (climb/swim/glide/sneak/jump/dodge/roll) — extend gait + combat modes.

**Per-verb descriptor row (the data the engine consumes):**
`verb → { archetype, leadingLimb, phases[ms], loop?, clipId?, juiceId, sfxId, vfx? }`. Seed rows:
`chop→{swing_down,"both_arms+spine",[180,120,260],juice:impact_wood,sfx:axe_chop,vfx:woodchips}`;
`forage→{crouch_reach_pluck,"spine+right_arm",[220,140,200],juice:soft_pluck,sfx:rustle}`;
`fish→{cast_and_wait,"right_arm",[200,160,0],loop:line_tension,juice:whoosh}`;
`forge→{manipulate_in_place,"both_arms",[140,90,160],loop:hammer_tap,sfx:forge_ring,vfx:sparks,clipId:hammer}`.

**Master verb inventory (coverage target, ~120; ~70 currently unanimated):** combat (light/heavy/parry/
grab/kick/dodge + aerial/mounted/aquatic variants); labor (farm/build/mine/log/fish/mill/cook/gather/dig);
stations (plant/water/harvest/cook-order/serve/sing/discard/answer/type-command/write-code/place-entity/
breed/compose-spell/ride-attraction); social/NPC (talk/court/mentor/trade/hire/inspect); world (place-sign/
take-photo/claim-land/expand-claim/commune/emote×6/mount/dismount); locomotion (walk/run/jump/glide/climb/
swim/dive); consumption (eat/drink). Each maps to an archetype or category fallback.

---

## Critical files
- **New (animation)**: `lib/concordia/action-biomechanics.ts`, `lib/concordia/play-action.ts`,
  `components/world-lens/ActionAnimBridge.tsx` (or a `handleActionAnim` in `AvatarSystem3D.tsx`).
- **New (world renderers, in `infrastructure` layer)**: `ResourceNodeRenderer`, `CropFieldRenderer`,
  `ClaimBoundaryRenderer`, `CrowdRenderer`, `WorldVFXBridge` (+ jail/banner/chronicle marker renderers).
- **Edit**: `pose-broker.ts` (add `action` source), `AvatarSystem3D.tsx` (action listener + occupation/gait
  blend + instancing), `BuildingRenderer3D.tsx` (construction progress), `TerrainRenderer.tsx` +
  `world-deformation.ts` + `physics-world.ts` (real heightfield deform + collider rebuild), `ConcordiaScene.tsx`
  (mount new renderers + dynamic water), the 11 station overlays + occupation/gather handlers (call `playAction`).
- **Server emit**: `routes/worlds.js` + station/occupation/terrain routes → `world:action` / `world:node-depleted`
  / `world:uprising`; NPC `activity_kind`→descriptor map.
- **Reuse**: `combat-biomechanics.ts`, `pose-broker.ts`, `juice.ts`, `EmbodiedParticlesBridge`, the projector,
  NPC occupation clips, `BuildingCollapseVFX` pattern, the Phase 0.6 server `terrain.deformations`/`water_depth` macros.
- **Retire**: `AnimationManager.tsx`, dead motor bridges.

## Recommended sequencing (max "it's a real 3D world" payoff per step)
1. **WS1 action-animation framework** (1.1–1.4) + breadth coverage — *doing* embodies the avatar everywhere.
2. **WS1.5–1.7** trigger sites + parity + retire dead code.
3. **WS2.1–2.3** nodes + crops + construction — the world visibly responds to labor (Medieval-Dynasty payoff).
4. **WS2.4–2.5** terrain deform + hydrology real (the destructible-world becomes true, not a lie).
5. **WS3** VFX/juice layer (skill VFX, auras, loot, per-verb juice) — the "be cool" pass across everything.
6. **WS2.6–2.8** settlements + crowds/uprisings instancing + the felt society markers (law/gov/chronicle/economy).

## Verification
- **vitest** (scoped): `action-biomechanics` builds a valid pose sequence per archetype; coverage test (every
  verb resolves); renderer unit tests where logic is pure (depletion scale, growth-stage mesh pick, deform delta apply).
- **scoped `tsc`** (narrow include, `--skipLibCheck`, mem-capped — full tsc OOMs).
- **Dev-server + browser/screenshot probe** (the real bar — it's a 3D game): boot, drive verbs (chop/forage/
  forge), confirm the avatar moves + particles fire; dig a hole and walk into it (real heightfield); set water
  and watch a ditch fill; deplete a node and watch it shrink/vanish; trigger an uprising and see a crowd. Use
  the `run`/`verify` skills for app-launch + screenshots.
- **No-silent check**: log any verb that fell to fallback (ok) vs errored (not).

NOTE: This is a large, multi-PR initiative; the plan is the roadmap. I'll land it in the sequenced slices
above, each shippable + verified in-engine, so the world becomes progressively more alive and rendered.
