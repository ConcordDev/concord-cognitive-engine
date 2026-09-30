# FACTIONS

**Status:** PARTIAL  
**Authority:** Concord  
**Source:** `src/game/bible.ts` `FACTIONS`; `WorldBook.Factions`; `RealmFill.Factions`

## LIVE

Named factions in TS (Glyph Keepers, Court Unburned, Verdant Veil, Sundering Guard, Delgado, Ghost Contracts, Uncounted, Grid, Road Walkers, …). Unity spawns camp + banner + lore stone from JSON motto/goal.

## TARGET

Simulate resources, territory, leaders, heat, secrets, plans. Faction decisions emit world events.

## Gap

`WorldClock.FactionHeat` ticks down and rises on a kill or a carried import. CROSS_PLOTS advance when the player walks a matching pair of doors. No membership roll, no war AI, no faction-owned gate.
