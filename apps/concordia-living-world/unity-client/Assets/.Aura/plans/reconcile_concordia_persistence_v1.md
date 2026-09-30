# Reconcile Concordia persistence layers

## Scope
- Read and preserve existing `WorldMemory`/legacy simulation state, unified persistence contracts, and `WorldSimulationHost` behavior.
- Make `ConcordiaPersistenceService` the canonical versioned boundary for simulation state without changing faction consumer behavior.
- Keep explicit legacy import behavior for `concordia_world_simulation.json` and avoid silent dual writes.

## Implementation
1. Add a versioned `worldSimulation` DTO section to the unified payload, using the existing `WorldSimulationState` contract as the serialized state.
2. Add capture/restore and normalization in `ConcordiaPersistenceService`.
3. Update `WorldSimulationHost` to initialize from the unified envelope first, explicitly import the legacy file only when no unified simulation section exists, and delegate saves to the unified service.
4. Update bridge save callers to use the unified boundary only; preserve the legacy file as an opt-in import source rather than a second save target.
5. Add focused EditMode tests for simulation round-trip and legacy import/compatibility using in-memory service/DTO paths supported by the current NUnit setup.
6. Compile-check and run the focused EditMode tests; report exact files and migration behavior.