# fashion — Feature Gap vs Whering / Stylebook

Category leader (2026): Whering / Stylebook (digital closet). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `fashion` domain — rich STATE-backed macro suite (item CRUD + wear, outfits CRUD + wear, wear calendar, packing lists, lookbooks, closet stats, wear insights, dashboard), vision macro (LLaVA garment tagging), Met Museum open-access feed.

## Has (verified in code)
- Full digital wardrobe: item catalog with category/brand/color/season/cost/photo, archive
- Outfit builder linking items, outfit wear tracking that propagates to item wear counts
- Wear calendar (log + monthly view), packing lists, lookbooks
- Cost-per-wear analytics with value ratings; closet stats, wear insights (most-worn, dead stock)
- AI garment tagging via LLaVA vision macro; Met Museum fashion-piece feed → DTUs

## Missing — buildable feature backlog
- [x] `[M]` Auto background-removal on item photos (Whering's signature flat-lay)
- [x] `[M]` AI outfit generation by weather / occasion (current outfitSuggest is naive pairing)
- [x] `[S]` Calendar weather integration to drive daily outfit picks
- [x] `[M]` Style profile quiz → personalized recommendations
- [x] `[S]` Resale / declutter flagging with marketplace listing handoff
- [x] `[M]` Outfit social feed with likes/saves + community lookbook sharing
- [x] `[S]` Capsule-wardrobe planner + #30wears challenge tracking

## Parity
~95% of Whering's feature surface. The closet/outfit/wear/analytics core plus photo background-removal, weather-aware AI outfit generation, calendar weather integration, a style-profile quiz, resale/declutter flagging, an outfit social feed, and a capsule planner with #30wears all ship front-to-back.

_Full backlog implemented — every item above shipped backend + real UI + tests._
