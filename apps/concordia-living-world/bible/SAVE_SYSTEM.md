# SAVE_SYSTEM

**Status:** MISSING (world) · LIVE (appearance)  
**Authority:** Concord  
**Source:** Unity `AppearanceStore.cs`; browser `persist.ts` `concordia-living-v1`

## LIVE

Unity: `concordia_appearance.json` + PlayerPrefs. Browser: world slices (ecology, heat, prices, day, hour, dead, births, quest, reputation).

## TARGET

Concord DB is the save. Unity may cache presentation. Walking away a week must not freeze the world.

## Gap

No Unity load of slices. Two save keys, not one truth.
