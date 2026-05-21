# cooking — Feature Gap vs Paprika / NYT Cooking

Category leader (2026): Paprika 3 (recipe manager) + NYT Cooking. Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: domain macros (`cooking.scaleRecipe/nutritionEstimate/mealPlan/substitution/feed`); 690-line domain; USDA FoodData Central panel; generic `/api/lens` recipe store.

## Has (verified in code)
- Recipe box CRUD (name, cuisine, difficulty, prep/cook time, servings) with difficulty filter
- Recipe scaling with serving multipliers (per-recipe scaled ingredient amounts)
- Nutrition estimate action + bespoke USDA FDC nutrition explorer (3-tier card, save-as-DTU)
- Cook-mode timer (minutes/seconds, running state) and checkable ingredient list
- AI actions: scale recipe, nutrition estimate, meal plan, ingredient substitution
- Realtime data panel + DTU export + lens feed

## Missing — buildable feature backlog
- [ ] `[M]` Recipe import from URL — paste any recipe site link, parse into structured recipe
- [ ] `[M]` Grocery list generator — aggregate ingredients across a meal plan into a shopping list
- [ ] `[M]` Step-by-step cook mode — full-screen sequential instruction view with per-step timers
- [ ] `[S]` Pantry / inventory tracking — what you have, what a recipe needs
- [ ] `[M]` Weekly meal planner calendar — drag recipes onto days, auto-build grocery list
- [ ] `[S]` Recipe categories, tags, and ratings — organize and rank your collection
- [ ] `[S]` Photo per recipe + per step — visual recipe cards

## Parity
~50% of Paprika's feature surface. Strong scaling, nutrition, and timer; missing the URL-import, grocery-list, and meal-planner trio that makes Paprika a daily-driver.
