# QUESTS

**Status:** PARTIAL  
**Authority:** Concord  
**Source:** `WorldBook.Quests`; `RealmFill.Quests`; `src/game/quests.ts`; `content.ts` OBJECTIVES

## LIVE

JSON quests become `LoreStone` boards. Browser has five Hub objectives (lamp, ring, scheme, arena, gate) in localStorage `done`. Unity HUD does not show them.

## TARGET

Stateful consequence graphs. Generate situations from world state (merchant gone → kidnapped/defected/debt…), not fetch templates.

## Gap

No accept/complete. No provenance. Hub tutorial not in Unity.
