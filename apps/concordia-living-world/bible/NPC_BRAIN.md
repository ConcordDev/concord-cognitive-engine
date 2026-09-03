# NPC_BRAIN

**Status:** Browser PARTIAL · Unity STALE  
**Authority:** Concord  
**Source:** `src/game/npc-life.ts`; Unity `NpcLife.cs`

## LIVE

TS `NpcBrain`: home, job, need, faction, trust, fear. Hour schedule: sleep / work / eat / scheme / hide / gather. Heat can send NPCs to rival settlement.

Unity `NpcLife` now walks that hour schedule against `WorldClock.Hour`: sleep at home, work at a `BuildingPlace` (or spawn post), eat at midday, gather in the evening, flee nearby steel. Pillars stay `pinned`. Talk (E) pauses the schedule. REAL / BULK / VIRTUAL LOD. Scheme/hide-from-heat still live only in the TS brain.

## TARGET

Radiant-style GOAL → CONSTRAINTS → KNOWLEDGE → 2B DECISION → CONCORD VALIDATION → WORLD EFFECT.

LOD L0 decorative … L5 2B+memory. Distance is one factor, not the only.

## Gap

Needs / trust / fear / schemes are not yet Unity state. Drive those from Concord L1 ticks when the gateway is up.
