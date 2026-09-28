# Unified Concordia Persistence

## Scope
Create only new files under `Assets/Concordia/Scripts/GameplayCore/Persistence/`.

## Implementation
1. Add stable, Unity-serializable DTOs and a versioned JSON envelope for player, inventory/equipment, NPC, world, vehicles/mounts, world systems, construction/economy, and consequence/event records.
2. Add a static service API that captures/restores canonical runtime state without replacing or duplicating `WorldSystemsHost`.
3. Persist to `Application.persistentDataPath` with guarded file I/O and explicit conversions from canonical types.
4. Verify compilation and inspect the created files.
