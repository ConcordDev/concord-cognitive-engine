# ECONOMY

**Status:** PARTIAL (kingdom stock / gate cargo) · LIVE platform ledger elsewhere  
**Authority:** Concord  
**Source:** Concord `economy_ledger`; `persist.ts` `prices`; Unity `CrossRing`

## LIVE

`WorldClock.Prices` drifts on day-wrap and away-advance. Each kingdom has a staple (harvest, remnants, census, road, …) derived from its refusal, plus `stock` / `need`. Surplus no longer teleports: `CrossRing.DispatchCaravan` creates a persisted caravan (`caravansCsv`) that travels, stops at the gate, pays `RingTariff` 0.05 into `tariffsCsv`, then credits destination stock/need/imports. HUD shows staple + need + active caravan. No shops that debit the player. Platform CC ledger is a different product surface.

## TARGET

Production, consumption, transport, scarcity chains that touch factions and quests. Server snapshot should eventually carry the same caravan rows.

## Gap

Do not fake a market UI. Qty is still derived from the slice float. Server `kingdom:data` caravans/tariffs stay empty until persist-sync.
