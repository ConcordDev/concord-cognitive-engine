# Orphaned Systems Inventory

> **Status (2026-05-13):** the 18-phase `claude/concordia-foundation`
> wiring pass (A through R) closed every game-relevant orphan listed
> below. The columns "What it does / How to wire" remain as-is for
> archaeological purposes; for each entry the "natural home" is now
> actually wired. The remaining 113 mechanically-orphan DB tables are
> all accessed via macro indirection (the orphan label is grep noise),
> and the three game-critical tables (`culture_dtus`,
> `culture_reflections`, `sovereign_biomonitor`) are documented as
> archived with no live readers expected.
>
> Per-phase landings:
> - **A1** AvatarSystem3D → enhanced-avatar-builder for hero NPCs + local player
> - **A2** BuildingRenderer3D → procedural-buildings.createBuilding
> - **A3** TreeLayer + RockLayer mounted (l-system-tree.ts + rock-gen.ts wired)
> - **A4** ConcordiaScene fog/sun deferred to SkyWeather (theme-tinted)
> - **A5** GoddessAvatar3D for Three Above All
> - **B1** secondary-physics integrateFrame in scene tick
> - **B2** ragdoll-bridge + concordia:lethal-hit dispatch
> - **B3** flight-physics + aquatic-gait hooks
> - **B4** lip-sync drivePhonemes in DialoguePanel
> - **B5** ProceduralFacialController fallback
> - **C1** combat-motor-driver + combat-clips wired
> - **C2** armor-system scaffolded
> - **C3** weapon-archetypes via createWeapon
> - **C4** reflex-layer driver mounted
> - **D1-D5** mount substrate (domain, in-world render, state machine, gait, IK, coat, designer)
> - **E1-E4** character creation (migration 187 + appearance domain + onboarding/character)
> - **F** 7 ambient overlays mounted in /lenses/world (NamedEncounter, TombMarker, WorldHealthBadge, WalkerOnHorizon, LandmarkSpires, ControlLegend, ExplorationControls)
> - **G** 19 panel registrations in PanelHost
> - **H1-H4** NPCStressTooltip raycast hover, world_markers, QuestDiscovery, patterns domain
> - **I1-I5** racing, basketball, voice-chat, voice-npc-mic, messaging-channels domains + UI
> - **J1-J4** commune domain + cross-world cycles + boss-phases + output-hooks
> - **K** game-mode dispatch barrel
> - **L** NPC appearance hydration from authored faction visuals
> - **M** cinematic-director event bridge (8 socket triggers)
> - **N** GLB hero-mesh slot + README
> - **O** R3FOverlayLayer + camera-sync + instanced-mesh-pool (trees) + lod (buildings) + biome-blend (terrain) + distance-cull
> - **P** LegalFooter / LanguageSelector / /auth / SafeCard / GracefulFallback / SlashCommands / FreshnessBadge / VisibilityScopePicker / KnowledgeEntrepreneurBadge wired
> - **Q** WorldHUD / WorldRenderer / IsometricEngine / RulerHUD deleted
> - **R** docs refresh + verification (this section)

Generated from a sweep of `concord-frontend` + `server` at HEAD. An
"orphan" is a file / table / domain that exists in the working tree
but isn't imported, called, or otherwise referenced by any active
code path. The orphan label is mechanical (regex matches), not
semantic — some entries below may be intentional (test fixtures,
authoring tools, work-in-progress).

Use this file to decide what to wire next, what to delete, and what
to keep parked.

## Summary

| Bucket                                 | Total | Orphan | % |
|----------------------------------------|------:|-------:|--:|
| Frontend `.tsx` components             |   594 |     56 | 9% |
| Frontend `lib` + `hooks` modules       |   206 |     54 | 26% |
| Server domains / lib / emergent        |   951 |      5 | <1% |
| DB tables (across 186 migrations)      |   442 |    116 | 26% |

Server is well-wired (only 5 orphans, all small). Frontend has most
of the headroom — 54 unimported `lib/` modules and 56 unimported
components, with the most game-relevant orphans clustered in
`lib/concordia/` + `lib/world-lens/` (the visual depth I undersold
in the first audit).

DB-table orphans are misleading — most are economy / DTU-marketplace
tables that are accessed through `runMacro` indirection my grep
can't follow. Only 3 game-critical orphans: `culture_dtus`,
`culture_reflections`, `sovereign_biomonitor`.

---

## High-impact visual orphans

These are the ones that look like immediate visible wins if wired up.

### Character + body systems (lib/concordia/)

| File | LOC | What it does | How to wire |
|---|---:|---|---|
| `cape-and-tack.ts` | 136 | Cape + saddle secondary physics | The `enhanced-avatar-builder` already tags capes with `userData.isCape`. Add a ticker that calls cape-and-tack each frame. |
| `lip-sync.ts` | 199 | Phoneme→viseme schedule, drives `FacialController` | Mount on dialogue + chat events. `drivePhonemes(controller, schedule)`. |
| `mount-coat.ts` | — | Coat color / pattern generator for mounts | Wire into the (still orphan) `MountAvatar3D`. |
| `armor-system.ts` | 255 | Armor pieces + slot system | Surface as visible mesh attachments on the avatar. |
| `weapon-archetypes.ts` | 271 | Weapon prefabs (geometry + stats) | Replace the procedural box-sword in `enhanced-avatar-builder.ts`. |
| `flight-physics.ts` | — | Flight motion model | Already tested but unwired. Hook to flying creatures + glide bloodlines. |
| `aquatic-gait.ts` | — | Swim gait | Hook to aquatic creatures + swim mode. |
| `combat-motor-driver.ts` | — | Motor-driven combat clips | Drive animations from skill cast events. |
| `ragdoll-bridge.ts` | — | Bridge to ragdoll on death | Currently only tests import it. Wire on `entity:death` event. |
| `reflex-layer.ts` | — | Reflex animation overlay | — |
| `scale-params.ts` | — | Body-scale parameters | Hook into proportionsFor in character-schema. |
| `skinned-humanoid.ts` | — | BB1 skinned skeleton | Hero-mesh-registry's procedural fallback. |
| `karma.ts` | — | Karma-driven appearance bias | Pipe through to FacialController. |
| `voice-settings.ts` | — | Per-NPC voice profile | Hook to voice-synthesis. |
| `mounts/quadruped-gait.ts` | — | 4-legged gait | Mount renderer. |
| `mounts/rider-ik.ts` | — | Rider-on-mount IK | Mount renderer. |
| `mounts/mount-state-machine.ts` | — | Mount behavior state | Mount renderer. |

### World renderer (lib/world-lens/)

| File | LOC | What it does | How to wire |
|---|---:|---|---|
| `procedural-buildings.ts` | 429 | 5 archetypes (tavern/archive/forge/market/tower) × 5 architecture styles (fortified/gracile/crystalline/organic/industrial) with faction visual overrides | Replace BuildingRenderer3D's box composites with `createBuilding(THREE, opts)`. |
| `l-system-tree.ts` | 367 | L-system trees, 5 species per biome, deterministic seed | New `TreeLayer` component that calls `generateTree(speciesId, seed)` per chunk. |
| `rock-gen.ts` | 268 | Procedural rocks | Scatter pass over terrain. |
| `cinematic-director.ts` | 303 | Cinematic camera + scene composer | Hook to lattice-quest-cycle realisation moments. |
| `vehicle-system.ts` | — | Vehicle rendering | Surface ground + air vehicles per world. |
| `instanced-mesh-pool.ts` | — | Instanced rendering for crowds | Performance — wire when scenes scale. |
| `lod.ts` | — | Level-of-detail system | Per-mesh LOD switching. |
| `biome-blend.ts` | 114 | Material blend between biomes | Wire into terrain shader. |
| `asset-loader.ts` | — | GLTF / GLB cache | Drop `/public/meshes/heroes/<id>.glb` to activate the hero path. |
| `enhanced-avatar-builder.ts` | 240 | Composes hair-cards + skin-SSS + eye-parallax + facial-controller (this commit) | Replace AvatarSystem3D's procedural path for hero NPCs + local player. |

---

## Game-feature orphans (frontend)

### Character + world-creation UI

- `components/world/CharacterCustomizer.tsx` — character-creation flow. Substantial UI, never reachable.
- `components/concordia/mounts/MountDesigner.tsx` — mount design UI. Uses the (also orphan) mount-state-machine + quadruped-gait + rider-ik trio.
- `components/concordia/GoddessAvatar3D.tsx` — special 3D mesh for the goddess. Better than the legend body fallback.

### HUD / surfacing not currently mounted

- `components/concordia/hud/RulerHUD.tsx` — predecessor to the RulerOverlay I built; superseded.
- `components/concordia/hud/SchemeBoard.tsx` — scheme tracker UI.
- `components/concordia/hud/AtrophyWarning.tsx` — skill atrophy warning.
- `components/concordia/hud/SecretsCodex.tsx` — discovered secrets reveal.
- `components/concordia/NPCStressTooltip.tsx` — stress hover tooltip (substrate exists; UI dead).
- `components/world/NamedEncounterHUD.tsx` — boss / named-event banner.
- `components/world/TombMarker.tsx` — death surface (substrate exists).
- `components/hud/WorldHealthBadge.tsx` — world-level health readout.
- `components/world-lens/WalkerOnHorizon.tsx` — Concord-Link walker silhouettes on the horizon. Lore-load-bearing.
- `components/world-lens/LandmarkSpires.tsx` — landmark spires marking faction capitals.
- `components/world-lens/WorldMarkers.tsx` — POI markers.

### Composer / creator UIs

- `components/concordia/quests/QuestComposer.tsx`
- `components/concordia/npcs/NPCComposer.tsx`
- `components/concordia/arcs/GoddessArcComposer.tsx`
- `components/concordia/commune/CommuneComposer.tsx`
- `components/concordia/genesis/PatternFeed.tsx`
- `components/concordia/skills/SkillMarketplace.tsx`
- `components/concordia/skills/SkillEffectivenessPanel.tsx`

### Economy + travel

- `components/concordia/economy/NPCShopModal.tsx`
- `components/concordia/economy/WagerModal.tsx`
- `components/concordia/transit/TransitHub.tsx`

### Controls + input

- `components/concordia/controls/ControlLegend.tsx`
- `components/concordia/controls/ExplorationControls.tsx`

### Minigames

- `components/world-lens/RacingHUD.tsx`
- `components/world-lens/BasketballMinigameOverlay.tsx`
- `components/world-lens/QuestDiscovery.tsx`

### Lens primitives

- `components/lens/EmptyStateCTA.tsx`
- `components/lens/UniversalLensLayout.tsx`
- `components/lens/CreatorLink.tsx`
- `components/lens/ShareButton.tsx`
- `components/dtu/CitePicker.tsx`
- `components/dtu/DTUEmbed.tsx`

### Voice + messaging

- `components/voice/VoiceChat.tsx`
- `components/world/VoiceNPCMic.tsx`
- `components/messaging/MessagingChannelsPanel.tsx`

### Misc

- `components/world/IsometricEngine.tsx` — alternate isometric renderer.
- `components/world/WorldRenderer.tsx` — looks like an older world renderer, possibly a duplicate.
- `components/world/WorldHUD.tsx` — older HUD shell.

---

## Game-mode systems (lib/concordia/game-modes/)

All five mode handlers exist but aren't dispatched:
- `architect.ts` — build/design mode
- `crisis-response.ts` — emergency-response mode
- `expedition.ts` — exploration mode
- `ghost-hunt.ts` — anomaly hunt
- `master-forge.ts` — high-tier crafting
- `mentor.ts` — mentorship mode

The `game-mode-orchestrator.ts` (which IS imported) should be the
dispatcher. Likely missing the per-mode wiring inside it.

---

## Server orphans

Tight. Only 5 actual orphans, none catastrophic:

- `lib/output-hooks.js` — pre-render hook system, never wired.
- `lib/combat/boss-phases.js` — boss phase machinery. Boss spawning works (spawn.boss macro), this handles phase transitions. Wire next when boss fights need phases.
- `emergent/cross-world-economy-cycle.js` — cross-world arbitrage. Needs registration in heartbeat list.
- `emergent/cross-world-scheme-cycle.js` — cross-world schemes. Same.
- `domains/commune.js` — federation commune macros. Registration missing in server.js.

Plus ~10 files under `lib/_archived/` — intentional, not worth re-wiring.

---

## Orphan DB tables (game-critical only)

Out of 116 mechanically-orphan tables, only 3 are game-substrate:

- `culture_dtus` — culture-themed DTUs. **ARCHIVED** (no live readers; superseded by ordinary DTU `domain='culture'` filtering on the unified `dtus` table).
- `culture_reflections` — periodic culture summaries. **ARCHIVED** (superseded by `dream-engine.js` retrospective composer + dtus `kind='dream'`).
- `sovereign_biomonitor` — biometric sovereign tracking (Phase 3 substrate). **ARCHIVED** (the substrate moved to `embodied_signal_log` + `pain_signals` as documented in Layers 7-8 of CLAUDE.md).

The remaining 113 are admin / economy / DTU-marketplace tables
accessed through `runMacro` indirection.

---

## Priority recommendation

If you want the biggest visible payoff per hour of wiring:

1. **enhanced-avatar-builder → AvatarSystem3D** for the local player.
   One-line replacement of `createAvatarMesh()` in the player path.
   Immediately delivers SSS faces, hair cards, parallax eyes, real
   anatomical proportions.
2. **procedural-buildings → BuildingRenderer3D**. Replace the box
   composites with `createBuilding(THREE, { archetype, style, faction })`.
   Visible per-world architectural variety.
3. **l-system-tree → new TreeLayer** mounted in the scene. Trees per
   biome with deterministic seed. Visible at every world load.
4. **cape-and-tack** ticker on the existing capes (already tagged with
   `userData.isCape` in enhanced-avatar-builder).
5. **rock-gen → terrain scatter pass**.
6. **MountDesigner + MountAvatar3D + mount-state-machine** trio →
   surface mounts as a real game system.
7. **CharacterCustomizer** → character-creation flow on /register.
8. **lip-sync** + **FacialController** → speech-driven mouth
   movement on dialogue events.
