# Gunsmithing Fabrication Domain

## Scope
- Add a self-contained `Concordia.GameplayCore.Gunsmithing` subsystem under `Assets/Concordia/Scripts/GameplayCore/Gunsmithing/`.
- Reuse existing Fabrication contracts/composer, Combat action contracts, and WorldField authority without editing shared integration files.

## Implementation
1. Inspect existing fabrication, combat, persistence, materials, and world-field authorities.
2. Add serializable weapon configuration/component DTOs covering receiver, barrel, chamber/caliber, action, magazine, ammunition, optic, stock, grip, muzzle device, attachments, quality, wear, reliability, and provenance.
3. Add a deterministic composer/resolver that produces canonical weapon IDs, stable provenance chains, explainable resolved ballistics/handling stats, environmental modifiers, and structured fire eligibility/why data.
4. Add JSON-safe persistence DTOs and conversion helpers for composed weapons and mutable wear/maintenance state.
5. Validate compilation and verify files are present; do not wire bridge/combat integration in this step.
