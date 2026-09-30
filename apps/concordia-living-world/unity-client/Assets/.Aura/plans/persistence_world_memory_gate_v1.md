# Persistence/world-memory gate

## Audit
- `ConcordiaPersistenceService` already captures/restores runtime world slices, event log, and faction standings in `concordia-unified-v1.json`.
- `WorldMemory.Write` in `WorldBook.cs` still writes `concordia-living-v1.json`, while `WorldClock.Leave` and `CrossRing.Walk` reach it directly.
- Appearance and stream-cell stores are separate and must remain untouched.
- Existing faction consumers are dialogue, quest acceptance, market trade/pricing, and guard reaction; verify coverage and preserve contracts.

## Changes
1. Make `WorldMemory` an in-memory canonical cache with explicit legacy-file read/import only; remove its direct legacy write.
2. Add a persistence-service runtime-world commit method and route `WorldMemory.Write` through it without recursive capture; keep `Put` for in-memory mutation and let unified save callers persist all sections.
3. Ensure legacy living JSON is imported into the cache when the unified world section is absent, without overwriting the legacy file.
4. Add focused EditMode tests for legacy living import, unified capture of cross-world memory/event/faction state, and consumer coverage where contracts already exist.
5. Compile and run focused EditMode tests; inspect logs.

## Boundaries
- Do not touch L0, HubKit, benchmark assets, appearance storage, or stream-cell storage.
- Do not remove legacy import compatibility or WorldEventLog/FactionStandingBook round trips.
