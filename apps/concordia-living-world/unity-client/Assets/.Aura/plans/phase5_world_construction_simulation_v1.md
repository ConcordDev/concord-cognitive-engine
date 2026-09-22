# Phase 5 World Construction and Simulation

## Scope
Create additive contracts and adapters under `Assets/Concordia/Scripts/GameplayCore/WorldSystems/` without editing existing Concordia files. The layer will cover modular construction, functional buildings, ownership, utilities, jobs, production, storefront inventory, supply/demand, infrastructure effects, crime consequences, and composable zone modifiers while preserving `WorldMemory`, `WorldGeography`, `WorldBook`, `BuildingInterior`, `WorldGate`, `HubObjectives`, and existing persistence semantics.

## Implementation
1. Add serializable domain contracts for construction, buildings, ownership, utilities, jobs, production, storefronts, supply/demand, infrastructure, crime, and zone modifiers.
2. Add a deterministic `WorldSystemsSimulation` service that advances systems by simulation time, supports Real/Bulk/Virtual LOD, resolves modifiers, records incidents, and exposes immutable snapshots.
3. Add `WorldSystemsPersistenceAdapter` that stores additive state in existing `WorldSliceRec` fields (`constructionCsv`, `activitiesCsv`, `incidentsCsv`) and delegates all reads/writes through `WorldMemory` / `WorldClock` rather than replacing the save file.
4. Add Unity-facing `WorldSystemsHost` and `WorldSystemsBuildingAdapter` components for composition-root wiring, optional interaction/visual adapters, and building interior compatibility.
5. Add an integration README with explicit wiring requirements and authority boundaries.

## Verification
Compile the new scripts, inspect for dependency/API errors, and report created paths plus remaining integrator wiring. Existing shared files remain untouched.