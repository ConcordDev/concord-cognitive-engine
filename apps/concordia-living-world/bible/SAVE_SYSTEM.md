# SAVE_SYSTEM

**Status:** PARTIAL (world slices) · LIVE (appearance)  
**Authority:** Concord  
**Source:** Unity `AppearanceStore.cs`; Unity `WorldMemory` → `concordia-living-v1.json`; browser `persist.ts` `concordia-living-v1`

## LIVE

Unity: `concordia_appearance.json` + PlayerPrefs. Unity also writes `concordia-living-v1.json` (hour, day, ecology, prices, dead ids, births, lastEvent, staple/stock/need/imports/population, plus plots/travelers/cross CSVs) on gate leave. Returning advances away hours — production, Ring shipments, traveler stages — so the kingdom did not freeze. Authored world events rewrite `lastEvent` in the live clock. Browser persist.ts is the same family, not yet the same file.

## TARGET

Concord DB is the save. Unity may cache presentation. Walking away a week must not freeze the world.

## Gap

Two save keys, not one truth. Quest/reputation still browser-only.
