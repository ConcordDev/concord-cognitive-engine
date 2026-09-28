# Phase 1 Combat Kernel

## Scope
Create a new, non-conflicting, data-driven combat foundation under `Assets/Concordia/Scripts/GameplayCore/Combat/` without modifying existing Concordia runtime files.

## Implementation
1. Define shared combat enums, immutable-ish value contracts, action phase windows, intent, defense, collision, damage, poise, impulse, reaction, and event records.
2. Add ScriptableObject action definitions/catalog for melee, ranged, magic, creature, mounted, aerial, and vehicle actions.
3. Add input buffering, action selection, defense evaluation, event recording, and a deterministic kernel state machine covering anticipation → startup → active/collision → recovery/stagger.
4. Add Unity adapters for Physics and existing Concordia concepts (`ConcordiaPlayer`, `AgentMotor`, `Hostile`, `TrainingDummy`, `CombatFeel`, `ConcordClient`) while keeping authority/presentation optional and explicit.
5. Add a runtime probe/diagnostic test surface and integration documentation.
6. Compile/validate new scripts and report created paths and later integration points.

## Verification
- Read the Phase 0 genome and existing combat scripts before writing.
- Refresh/compile and inspect Unity errors.
- Run deterministic probe checks for input expiry, phase progression, directional defense, perfect guard/parry, dodge i-frames, damage/poise/stagger, and event ordering.