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
- [ ] `[L]` In-world building/placement editor for players (creation is via Forge/blueprints, not in-place).
- [ ] `[M]` Inventory / equipment UI parity — visual gear slots, drag-equip, item tooltips.
- [ ] `[M]` Party / group play — co-op grouping, shared objectives, party UI.
- [ ] `[M]` Minimap + world map with fast-travel points.
- [ ] `[S]` Mounts/vehicles UX polish — summon, ride controls surfaced in HUD.
- [ ] `[M]` Combat depth — targeting/lock-on, dodge/block, ability cooldpatch bar.
- [ ] `[L]` LOD / streaming for large worlds (perf for big scenes).
- [ ] `[S]` Photo mode / screenshot sharing.

## Parity
~65% of a 3D open-world game. Genuinely the deepest lens — real 3D rendering, physics, multiplayer, combat, NPCs, quests, events — but it lacks an in-world editor, polished inventory/party/minimap UX, and combat depth that AAA open worlds ship.
