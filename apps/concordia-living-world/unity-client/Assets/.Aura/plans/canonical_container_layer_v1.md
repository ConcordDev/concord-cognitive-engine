# Canonical Universal Container Layer

## Findings
- WorldFabric owns canonical semantic objects, provenance, object condition, owners, and consequences, but its existing `WorldFabricContainer` is a scene-only list helper and its runtime mutation verbs are limited.
- WorldSystems owns `WorldSystemsInventoryContract` resources and `WorldSystemsEconomyService` inventory mutations; these must remain authoritative.
- Vehicles own inventory/storage through `VehicleEntity` and `IVehicleInventory`/`IVehicleStorage`; vehicle persistence already captures those lists.
- Persistence uses versioned scalar DTOs in `ConcordiaPersistenceService` and must be extended additively without editing the shared integration files in this step.

## Implementation
1. Add container contracts and deterministic refusal/result types under `Assets/Concordia/Scripts/GameplayCore/Containers/`.
2. Add a canonical in-memory container service with stable records, access rules, capacity, physical location, condition, contents, provenance, persistence state, and consequence event emission.
3. Add adapters that observe/delegate to existing WorldSystems inventories and VehicleEntity inventories/storage rather than replacing them.
4. Add persistence DTOs and conversion helpers for container state and consequence-ready mutation records.
5. Add an optional scene adapter component that only binds identity/location metadata and routes operations through the canonical service; it will not hold a second contents authority.
6. Add edit-mode tests for deterministic refusal reasons, ownership/access, capacity, and adapter delegation.

## Verification
- Refresh/compile scripts.
- Run `check_compile_errors`.
- Run container-focused edit-mode tests if available, otherwise run the existing EditMode suite.
- Inspect the created files and report the root path and file list.