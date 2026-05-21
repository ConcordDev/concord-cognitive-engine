# crafting — Feature Gap vs game crafting systems (Minecraft / WoW professions)

Category leader (2026): no direct consumer rival — closest analog is an MMO crafting/profession system. Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: REST routes `/api/crafting/{execute,recipes,skills,character,resource-bars,upgrade-bar}`, `/api/world/cook`, `/api/personal-locker/dtus`, `/api/marketplace/purchaseWithRoyalties`; domain macros (`crafting.list/counts/marketplace_browse/forge_preflight`).

## Has (verified in code)
- 4 tabs: Mine (my recipes), Forge (execute against inventory), Browse Marketplace, Author
- Recipe execution against player_inventory; cook recipes via `/api/world/cook`
- Character progress, resource bars with upgrade path, economy balance header
- Recipe authoring panel; list personal DTU recipes on marketplace with tier pricing + royalties
- Recipe types with counts, type filter, search; recipe detail view; recipe ledger

## Missing — buildable feature backlog
- [ ] `[M]` Visual crafting grid / drag-drop assembly — interactive recipe construction UI
- [ ] `[M]` Recipe discovery / experimentation — combine materials to unlock unknown recipes
- [ ] `[S]` Crafting queue + batch crafting — queue multiple crafts, craft-all
- [ ] `[M]` Skill tree progression view — visualize crafting skill unlocks and prerequisites
- [ ] `[S]` Quality/rarity tiers on crafted output — crit-craft for higher-grade results
- [ ] `[M]` Material gathering integration — link gather nodes to needed recipe inputs
- [ ] `[S]` Recipe favorites + "craftable now" filter — surface what inventory currently allows

## Parity
~55% of an MMO profession system. Real inventory execution, marketplace, and authoring are strong; missing the visual grid, experimentation/discovery, and queue/batch UX that make game crafting feel tactile.
