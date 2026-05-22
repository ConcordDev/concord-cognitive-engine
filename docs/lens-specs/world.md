# world — Feature Gap vs a 3D open-world game (Roblox / Genshin Impact)

Category leader (2026): Roblox / Genshin Impact (3D explorable open world). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: extensive — world routes (`/api/worlds/*`), combat/gather/dialogue/quests, Rapier3D physics, NPC simulation, presence, events; the engine's heaviest lens (~6000-line page).

## Has (verified in code)
- 3D scene — `ConcordiaScene` + `AvatarSystem3D` + `BuildingRenderer3D` (Three.js terrain, buildings, avatars with IK).
- Real-time multiplayer presence — spatial chunking, avatar interpolation, remote players, anti-cheat.
- Server-validated combat (reach + damage cap), gathering, NPC click → dialogue, quests.
- Rapier3D authoritative physics — kinematic character controller, jump/glide/swim.
- Environment — weather, day/night, emergent event feed, district activity, soundscape coupling.
- Emote wheels, quest tracker (breadcrumb mode), NPC activity tags, damage billboards, hit-pause juice.
- World events (RSVP, rewards), factions, signs, corpses (Dark Souls-style), mounts.

## Missing — buildable feature backlog
- [x] `[L]` In-world building/placement editor for players (creation is via Forge/blueprints, not in-place).
- [x] `[M]` Inventory / equipment UI parity — visual gear slots, drag-equip, item tooltips.
- [x] `[M]` Party / group play — co-op grouping, shared objectives, party UI.
- [x] `[M]` Minimap + world map with fast-travel points.
- [x] `[S]` Mounts/vehicles UX polish — summon, ride controls surfaced in HUD.
- [x] `[M]` Combat depth — targeting/lock-on, dodge/block, ability cooldpatch bar.
- [x] `[L]` LOD / streaming for large worlds (perf for big scenes).
- [x] `[S]` Photo mode / screenshot sharing.

## Parity
~95% of a 3D open-world game. Real 3D rendering, physics, multiplayer, combat, NPCs, quests, events plus an in-world placement editor, a visual inventory/equipment grid, party management, a projected minimap with fast-travel, mount management, a combat HUD with ability hotbar, performance presets, and a 3D-canvas photo mode all ship front-to-back.

_Full backlog implemented — every item above shipped backend + real UI + tests._
