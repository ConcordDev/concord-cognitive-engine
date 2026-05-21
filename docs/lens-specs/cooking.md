# cooking — Feature Gap vs Paprika / Samsung Food

Category leader (2026): Paprika 3 + Samsung Food. Content fills via free public APIs (USDA FDC, TheMealDB) + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `cooking` domain macros — pure-compute (scaleRecipe, nutritionEstimate, mealPlan, substitution), real USDA FoodData Central (usda-search/usda-nutrition), and full STATE-backed substrate (recipes, collections, meal-plan calendar, aisle-grouped shopping list, pantry, ai-meal-plan, TheMealDB feed).

## Has (verified in code)
- Recipe CRUD with ingredients, steps, prep/cook time, servings, photo/source URL, tags, cuisine
- Recipe collections (recipe books) with toggle-membership
- Meal-plan calendar (date|slot keyed: breakfast/lunch/dinner/snack)
- Auto shopping list — aggregates planned recipes, scales by servings, aisle-classifies, subtracts pantry
- Pantry tracking + "what can I cook" pantry-coverage ranking
- AI meal planner (deterministic round-robin from recipe box with preference filter)
- USDA FDC ingredient search + full nutrient profile; nutrition estimator; recipe scaler with live serving multiplier
- Kitchen timer (SVG ring), ingredient checklist, difficulty filters, TheMealDB recipe feed

## Missing — buildable feature backlog
- [ ] `[M]` Recipe import from URL — parse schema.org/Recipe JSON-LD from any cooking site
- [ ] `[S]` Cook mode — full-screen step-by-step view with per-step timers
- [ ] `[M]` Photo-based recipe capture (OCR a cookbook page) — vision brain is available
- [ ] `[S]` Recipe rating, notes history, and "made it" log with dates
- [ ] `[M]` Per-recipe nutrition auto-computed from USDA-linked ingredients (not just rough estimate)
- [ ] `[S]` Shopping list multi-store grouping and quantity-unit normalization
- [ ] `[S]` Recipe export to PDF / printable card

## Parity
~75% of Paprika+Samsung Food. One of the deepest lenses — full meal-plan/shopping/pantry loop already works. Main gaps are URL/photo import and a dedicated cook-mode.
