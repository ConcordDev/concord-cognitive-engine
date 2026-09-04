# NPC_BRAIN

**Status:** Browser PARTIAL · Unity STALE  
**Authority:** Concord  
**Source:** `src/game/npc-life.ts`; Unity `NpcLife.cs`

## LIVE

TS `NpcBrain`: home, job, need, faction, trust, fear. Hour schedule: sleep / work / eat / scheme / hide / gather. Heat can send NPCs to rival settlement.

Unity jobs: Wander, Stall, Sit, Sweep, Watch. Sweep = 2.4m sine. No needs.

## TARGET

Radiant-style GOAL → CONSTRAINTS → KNOWLEDGE → 2B DECISION → CONCORD VALIDATION → WORLD EFFECT.

LOD L0 decorative … L5 2B+memory. Distance is one factor, not the only.

## Gap

Do not throw `NpcBrain` away. Drive Unity presentation from Concord L1 ticks first.
