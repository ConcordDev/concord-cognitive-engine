# R1 Persistence Truth

Status: PARTIAL / UNVERIFIED
Date: 2026-09-22

## Static evidence

- `Assets/Concordia/Scripts/GameplayCore/Persistence/ConcordiaPersistenceService.cs`
  - Versioned unified envelope: `concordia-unified-v1.json`.
  - Captures world slices, player state, NPC state, quests, skills, event log, faction standings, economy, world systems, world simulation, world fabric, fabrication, gunsmithing, spellcrafting, containers, vehicles, plots, and consequences.
  - Restores `WorldEventLog` and `FactionStandingBook` from the unified world record.
  - Retains `TryImportLegacyWorldMemory` and legacy path compatibility for `concordia-living-v1.json`.
- `WorldClock.Leave()` calls the unified save boundary after the legacy-compatible WorldMemory snapshot update.

## Fixes made

- Removed a duplicate `RecordedEvents` property that would block compilation.
- Confirmed no merge conflict markers remain in `WorldBook.cs` or `ConcordiaPersistenceService.cs`.

## Missing acceptance evidence

- No PlayMode change → SoftEnter → return → save/load round trip was completed in this run.
- No domain-reload or quit/re-enter persistence proof was completed in this run.
- Unity TCP bridge on port 49382 was unavailable, so compile and runtime state are unverified.

No PASS claim is made.
