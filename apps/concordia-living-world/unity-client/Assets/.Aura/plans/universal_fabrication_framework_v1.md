# Universal Fabrication Framework

## Audit
- Confirmed `WorldSystemsInventoryContract`, `WorldSystemsOwnershipContract`, `WorldSystemsConstructionContract`, and `WorldSystemsEconomyService` are existing economy authorities.
- Confirmed `ConcordiaPersistenceService` owns the unified JSON envelope and `PersistenceModels` contains JSON-safe DTOs.
- Confirmed `WorldFabricProvenance`/world-fabric records exist for world objects.
- Do not edit `GameplayCoreBridge.cs`, existing economy types, or persistence service in this step.

## Implementation
1. Add discipline-neutral fabrication contracts with stable IDs, normalized stage data, ownership flags, containers, provenance chains, durability/wear, quality, explainable stat contributions, and JSON-safe DTOs.
2. Add a pure runtime composition service that validates a recipe and composes material → shape → method → components → properties → quality → wear → final object without owning inventories or economy transactions.
3. Add persistence adapter DTO conversion helpers that serialize/deserialize fabrication objects without references or dictionaries.
4. Add compile-safe tests/validation helpers only within the new Fabrication folder; no meshes or scene objects.
5. Refresh and compile-check the Unity project, then report the created root and file list.
