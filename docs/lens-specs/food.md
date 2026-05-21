# food — Feature Gap vs Paprika / Yelp / MyFitnessPal

Category leader (2026): Paprika (recipes) + Yelp (discovery) + MyFitnessPal (nutrition) — a combined food lens. Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `food` domain — very deep: recipe scale/substitute, cost-per-plate, PO/prep-list generation, menu analysis, waste/spoilage, pour cost, pantry, nutrition log, meal plans, grocery list, recipe import-url, restaurant biz CRUD + reviews/photos/tips/checkins/collections/reservations/waitlist, top-restaurants. USDA + OpenFoodFacts + Yelp + Brewery panels, LLaVA plate scan.

## Has (verified in code)
- Recipe management, scaling, ingredient substitution, URL import, cook mode
- Meal planner + grocery list builder; pantry tracker with spoilage check; nutrition logging
- AI plate scan (LLaVA vision) for food identification; USDA + OpenFoodFacts nutrition search
- Restaurant discovery: business CRUD, reviews, photos, tips, check-ins, collections, reservations, waitlist
- Commercial kitchen ops: menu engineering quadrants, waste reports, pour cost, prep lists, POs, batches, shifts

## Missing — buildable feature backlog
- [ ] `[M]` Barcode scanner for pantry / nutrition logging (OpenFoodFacts has the data)
- [ ] `[S]` Recipe photo + step-photo capture and gallery
- [ ] `[M]` Macro/calorie goal tracking with daily progress rings (logging exists; goals shallow)
- [ ] `[S]` Recipe rating + cook-it-again history
- [ ] `[M]` Meal-plan auto-generation from dietary prefs + pantry-aware suggestions
- [ ] `[S]` Shopping-list aisle grouping + store-aware ordering
- [ ] `[M]` Restaurant map view with filters + directions

## Parity
~75% of the combined Paprika+Yelp+MyFitnessPal surface. This is one of the deepest lenses — recipes, nutrition, discovery, and pro kitchen ops all real and wired. Main gaps are barcode scanning, calorie-goal tracking, and a map-based restaurant view.
