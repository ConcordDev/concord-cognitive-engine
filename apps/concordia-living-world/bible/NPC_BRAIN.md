# NPC_BRAIN

**Status:** Browser PARTIAL · Unity LIVE (2B via `/unity-ws` `dialogue:request`)  
**Authority:** Concord  
**Source:** `src/game/npc-life.ts`; Unity `NpcLife.cs`

## LIVE

TS `NpcBrain`: home, job, need, faction, trust, fear. Hour schedule: sleep / work / eat / scheme / hide / gather. Heat can send NPCs to rival settlement.

Unity `NpcLife` now walks that hour schedule against `WorldClock.Hour`: sleep at home, work at a `BuildingPlace` (or spawn post), eat at midday, gather in the evening, flee nearby steel. Visible activities: merchant `open`, guard `patrol` (post change / leave town), `deliver` with a crate, pair-talk, enter a building (`inside`). Pillars stay `pinned`. Talk (E) pauses the schedule; nearby NPCs can pause each other. REAL / BULK / VIRTUAL LOD. Talk also asks Concord 2B (`ConcordClient.AskTwoB` → `dialogue:request`); Convai uses that same provider. Scheme/hide-from-heat still live only in the TS brain.

## TARGET

Radiant-style GOAL → CONSTRAINTS → KNOWLEDGE → 2B DECISION → CONCORD VALIDATION → WORLD EFFECT.

LOD L0 decorative … L5 2B+memory. Distance is one factor, not the only.

## Gap

Needs / trust / fear / schemes are not yet Unity state. Drive those from Concord L1 ticks when the gateway is up.
