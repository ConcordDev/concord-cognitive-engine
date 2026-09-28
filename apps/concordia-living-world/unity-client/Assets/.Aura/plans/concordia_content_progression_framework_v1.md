# Content and progression framework

## Scope
Build new shared data-driven runtime contracts under `Assets/Concordia/Scripts/GameplayCore/Content/` without modifying existing Concordia scripts.

## Implementation
1. Add serializable definitions and runtime state for weapon families, firearms, magic, abilities, statuses, equipment modifiers, activity skills, perks, relationships, factions, reputation, inventory, crafting, exploration discoveries, and creature ecology.
2. Add a catalog/registry that can ingest Canon/WorldBook authored data and expose lookup/registration seams for `CharacterGear`, `CombatKernelContracts`, `HubObjectives`, `CreatureCompiler`, `EvoSpawner`, and `ConcordClient` integrations.
3. Add progression runtime services for use-based skills, perk unlocks, reputation/relationship updates, inventory and crafting transactions, exploration discovery state, ecology observations, and serializable snapshots.
4. Verify new files by reading them back and checking for compile errors; do not edit existing shared files.

## Verification
- Confirm all new paths exist and contain the intended code.
- Run project compile/error checks.
- Report integration points and any remaining wiring that requires edits to existing runtime authority or gateway code.