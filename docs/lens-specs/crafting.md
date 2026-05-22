# crafting — Feature Gap vs MMO crafting systems

Category leader (2026): no direct consumer rival — closest analog is an MMO crafting/profession system (Minecraft / WoW professions). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: REST routes `/api/crafting/{execute,recipes,skills,character}`, `/api/world/cook`, `/api/personal-locker/dtus`, `/api/marketplace/purchaseWithRoyalties`; `crafting` domain macros (list, counts, marketplace_browse, forge_preflight).

## Has (verified in code)
- 5 tabs: Mine (my recipes), Forge (execute against inventory), Browse Marketplace, Skills, Author
- 4 recipe types: food_recipe, spell_recipe, fighting_style_recipe, blueprint — each typed/iconed
- Recipe execution against player_inventory; cook recipes via `/api/world/cook`
- forge_preflight macro (checks craftability before executing)
- Character progress, resource bars with upgrade path, economy balance header
- Recipe authoring; list personal DTU recipes on marketplace with tier pricing + royalty cascade
- Recipe counts by type, type filter, search, recipe detail view, recipe ledger

## Missing — buildable feature backlog
- [x] `[M]` Visual crafting grid / drag-drop assembly — interactive recipe construction UI
- [x] `[M]` Recipe discovery / experimentation — combine materials to unlock unknown recipes
- [x] `[S]` Crafting queue + batch crafting — queue multiple crafts, craft-all
- [x] `[S]` "Craftable now" filter — surface what current inventory allows
- [x] `[S]` Quality/rarity tiers on crafted output — crit-craft for higher-grade results
- [x] `[M]` Material gathering integration — link gather nodes to needed recipe inputs
- [x] `[S]` Recipe favorites and crafting history log

## Parity
~95% of an MMO profession system. Inventory execution, preflight, marketplace, and royalty-bearing authoring plus a visual crafting grid, recipe discovery/experimentation, a crafting queue + batch crafting, a craftable-now filter, quality/rarity tiers, gathering integration, and recipe favorites + history all ship front-to-back.

_Full backlog implemented — every item above shipped backend + real UI + tests._
