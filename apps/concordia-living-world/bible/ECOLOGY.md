# ECOLOGY

**Status:** MISSING (Unity) · PARTIAL (browser slice ecology number)  
**Authority:** Concord  
**Source:** `src/game/persist.ts` `ecology`; `wild.ts`; `kernel.ts`

## LIVE

Browser: a float `ecology` on world slices.

Unity: `WorldClock.Ecology` + `FaunaLife` (wander / graze / flee / hunt / sleep). Predators hunt nearby non-predator fauna, not only the player. Pack dests sometimes lean toward an authored city so animals cross streets. A kill marks `WorldMemory` dead and drops ecology. Returning to a world with recovered ecology can clear a dead id (a birth). HUD says `ecology thin` below 0.4. `EvoDrift` sine is no longer the live path.

## TARGET

RDR2 lesson: animals belong to an ecosystem. Persistent consequences (hide scarcity → prices → hunter range → settlement safety).

## Gap

Predator/prey between fauna is now a nearby hunt, not a species graph. Price coupling is still the kernel-style float plus shortage events.
