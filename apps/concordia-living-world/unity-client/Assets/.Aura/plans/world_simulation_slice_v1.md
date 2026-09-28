# World Simulation Slice

## Goal
Add a compile-safe, additive social, quest, and ecology simulation layer under `Assets/Concordia/Scripts/GameplayCore/WorldSimulation/` without becoming a second NPC/quest authority.

## Existing integration constraints
- Existing NPC authority is `NpcLife`/`GuestNpc` and authored content is exposed by `WorldBook`.
- Existing geography authority is `WorldGeography`; creature presentation authority is `CreatureGenome`/`CreatureCompiler`/`FaunaLife`.
- New code will use stable string IDs and adapter/event records; no Unity object references will be serialized.

## Implementation steps
1. Add stable DTOs/enums and deterministic ID/time helpers for social, quest, and ecology state.
2. Add a runtime simulation service with indexed state, save/load JSON, tick processing, and event records for social consequences, quest opportunities/contracts/investigations/world events, and creature ecology.
3. Add opt-in adapters for existing NPC, creature, and geography systems without modifying their authority or storing Unity references.
4. Add a host component that owns the new service only when explicitly placed, with persistent save support.
5. Refresh/compile-check and inspect the resulting files; report APIs and any unsafe bindings.
