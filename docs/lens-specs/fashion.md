# fashion — Feature Gap vs Whering / Acloset

Category leader (2026): Whering (digital wardrobe + outfit planning). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `fashion` domain (462 LOC) — vision tag, styleProfile, outfitSuggest, trendAnalysis, costPerWear, item-add + STATE-backed items/outfits/wearLog/packing/lookbooks Maps.

## Has (verified in code)
- Wardrobe — add garments (name, category, color, brand, season, size, cost, photo), archive
- LLaVA vision tagging of a garment photo (`fashion.vision`)
- Outfit builder + suggestions (season-aware, picks tops/bottoms/outerwear)
- Wishlist tab; style-profile analysis (dominant colors/categories)
- Cost-per-wear analytics with value rating (best/worst value)
- Trend analysis by category; wear log, packing lists, lookbooks in state
- FashionClosetSection + FashionFeed components

## Missing — buildable feature backlog
- [ ] `[M]` Auto background-removal on uploaded garment photos (Whering's signature flow)
- [ ] `[M]` Calendar — log/plan what you wore each day, pull from wear log
- [ ] `[M]` Drag-and-drop outfit canvas / collage maker
- [ ] `[S]` Weather-aware outfit suggestion (pull forecast lens data)
- [ ] `[S]` Capsule-wardrobe / "30 wears" sustainability challenges
- [ ] `[M]` Social outfit sharing + community style feed with reactions (FashionFeed exists but inert)
- [ ] `[S]` Wishlist price-watch / resale-marketplace links

## Parity
~55% of Whering. Wardrobe cataloguing, vision tagging, and cost-per-wear analytics are genuinely solid; missing the background-removal upload flow, the wear calendar, and the drag-drop outfit canvas that define the leader's daily-use loop.
