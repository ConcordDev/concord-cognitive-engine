# CRAFTING

**Status:** PARTIAL (cook station) · MISSING (full craft-resolve)  
**Authority:** Concord  
**Source:** Platform craft-resolve exists on server (`lib/craft-resolve.js`) — **not** Concordia-hold crafting

## LIVE

`CookStation` on tavern `kitchenStove` (hub dress + building interiors). E cooks only if `QuestLog` is holding a gathered item. Otherwise the stove stays honestly cold.

## TARGET

Resources × skill × tool × world law. Discovery of new materials must be verified, not LLM-named.

## Gap

Cook is a walk-to station, not craft-resolve. No recipe graph, no station skill, no output DTU.
