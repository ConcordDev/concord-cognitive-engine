# SAVE_SYSTEM

**Status:** PARTIAL (world slices) · LIVE (appearance)  
**Authority:** Concord  
**Source:** Unity `AppearanceStore.cs`; Unity `WorldMemory` → `concordia-living-v1.json`; browser `persist.ts` `concordia-living-v1`

## LIVE

Unity: `concordia_appearance.json` + PlayerPrefs. Unity also writes `concordia-living-v1.json` (hour, day, ecology, prices, dead ids, births) on gate leave. Returning advances away hours so the kingdom did not freeze. Browser persist.ts is the same shape, not yet the same file.

## TARGET

Concord DB is the save. Unity may cache presentation. Walking away a week must not freeze the world.

## Gap

Two save keys, not one truth. Quest/reputation still browser-only.
