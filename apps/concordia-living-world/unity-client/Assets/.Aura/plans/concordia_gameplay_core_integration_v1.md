# Concordia gameplay-core integration plan

## Read/authority constraints
- Preserve ConcordiaGame, ConcordiaPlayer, ConcordClient, WorldBuilder, ContinentStream, WorldBook, NpcLife, ModularPerson, and existing canon as authorities.
- Integrate additively through a single composition bridge in the existing ConcordiaHub boot path; do not create parallel movement/combat/world/network/persistence systems.
- Use existing authored/generated content first; no primitive final player/NPC content.

## Implementation
1. Read Phase 0 genome, presentation plan, all supplied GameplayCore package scripts, existing Concordia composition scripts, Hub scene/prefab assets, Canon quest/NPC data, and existing authored Rocketbox/CX assets.
2. Add one GameplayCore integration component that resolves the existing player/camera, exposes movement snapshots through the new locomotion contracts, registers existing combatants with the new contracts without replacing combat authority, hosts WorldSystemsSimulation/building/store adapters, and uses the existing persistence authority.
3. Add the presentation manifest/director and feedback hooks described by the presentation plan, keeping them additive and asset-backed.
4. Modify only the minimum existing composition point (ConcordiaGame) to install the bridge after the existing boot objects are created, preserving all existing systems and canon.
5. Author functional Hub interaction points using existing real-world/generated assets: authored Rocketbox/CX player/NPC, a store/building, a combat target with defense, quest progression, and a world gate/transition hook.
6. Add/complete gameplay state persistence through the existing WorldMemory-compatible adapter, including quest/store/bridge state where supported.
7. Refresh, compile-check, inspect diagnostics, and run a PlayMode smoke verification if editor permits; report every modified path and entry points with any unverified gateway limitations.
