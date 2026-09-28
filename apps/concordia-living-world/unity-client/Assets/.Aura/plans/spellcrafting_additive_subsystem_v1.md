# Spellcrafting additive subsystem

## Scope
- Inspect existing WorldField, Fabrication, combat/action, persistence, inventory, and canon/lore authorities.
- Add only new files under `Assets/Concordia/Scripts/GameplayCore/Spellcrafting/`; do not edit bridge or existing combat/integration files.

## Implementation
- Define serializable spellcrafting contracts/DTOs for intent, components, medium, form, behavior, trigger, constraints, cost, mastery, native world, provenance, environmental modifiers, and structured resolution effects/outcomes.
- Implement deterministic fabrication and resolution service using the existing `WorldFieldAuthority` and fabrication composer seams without owning combat, rendering, inventory, or lore.
- Add save/load DTO conversion and an NPC-use entry point; preserve spell records across world travel and expose refusal explanations.

## Verification
- Refresh/compile the Unity project and inspect console diagnostics.
- Verify all created files are under the requested root and no shared integration files were modified.