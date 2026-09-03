# ECONOMY

**Status:** PARTIAL (kingdom stock / gate cargo) · LIVE platform ledger elsewhere  
**Authority:** Concord  
**Source:** Concord `economy_ledger`; `persist.ts` `prices`; Unity `CrossRing`

## LIVE

`WorldClock.Prices` drifts on day-wrap and away-advance. Each kingdom has a staple (harvest, remnants, census, road, …) derived from its refusal, plus `stock` / `need`. Walking a gate ships surplus; away hours can send staple to the Ring. HUD shows staple + need. No shops that debit the player. Platform CC ledger is a different product surface.

## TARGET

Production, consumption, transport, scarcity chains that touch factions and quests. Visible caravans.

## Gap

Do not fake a market UI. Stock is a slice float, not crates on a road.
