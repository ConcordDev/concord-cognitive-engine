# R2 World Memory

Status: PARTIAL / UNVERIFIED
Date: 2026-09-22

## Static evidence

- `WorldEventLog` stores bounded typed records with event id, type, world, actor id, target id, text, timestamp, and day.
- `WorldClock.PushFeed`, `WorldClock.NoteKill`, faction standing changes, and world simulation events write to the causal log.
- `ConcordiaPersistenceService.CaptureWorldState()` serializes the full bounded event log.
- `ConcordiaPersistenceService.RestoreWorldState()` restores the log without reducing it to `WorldClock.LastEvent`.
- Existing Wave 0 proof records a named kill, witness gossip, and retained kill memory across return to Hub.

## Missing acceptance evidence

- Three distinct event types in Fantasy followed by SoftEnter to Hub were not freshly executed in PlayMode.
- Dialogue, quest, crime/theft, gift/aid, and faction gossip consumers were not runtime-verified after restore.
- Unity TCP bridge on port 49382 was unavailable.

No PASS claim is made.
