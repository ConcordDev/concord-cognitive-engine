# Cooking Lens — Capability Map (Frontend Rebuild Program, Wave 3)

> Derived, not asserted. Reproduce the macro list:
> `grep -c 'registerLensAction("cooking"' server/domains/cooking.js` → 39
> Two more macros are registered for the `cooking` domain from a shared
> free-API file (not `domains/cooking.js`): `grep -rn '"cooking", "live_food_search"\|"cooking", "live_breweries"' server/domains/free-api-live.js server/domains/civic-data-apis.js` → both shared with the `food` domain. Total surface: **41**.
> `node scripts/lens-unsurfaced.mjs --lens cooking` → `0/39 macros never referenced in the frontend` (post-rebuild; see "What this rebuild fixed").

## Reference apps + parity target

- **Paprika Recipe Manager 3** — recipe box, recipe import (URL parsing),
  recipe scaling, meal-plan calendar, auto-generated aisle-grouped
  grocery list, pantry.
- **Samsung Food / Plan to Eat** — AI-assisted meal planning, multi-store
  shopping consolidation, recipe folders/collections.
- **MyFitnessPal / Cronometer** — authoritative nutrition search + per-food
  macro/micronutrient breakdown for the nutrition-tracking side.
- **Parity target** (owner's framing): the only difference between the
  cooking lens and Paprika + a USDA-grade nutrition tracker combined
  should be recipe-catalog size and polish depth — every recipe, plan
  entry, shopping item, and nutrition figure should trace to a real
  macro/USDA lookup, never a client-invented placeholder.

## Checklist — reference-app features vs. Concord cooking

| Feature | Bucket | Disposition |
|---|---|---|
| Recipe box (create/edit/delete, ingredients, steps, tags, photo) | ALREADY REAL | `RecipeBoxSection` Recipes tab → `recipes-create/update/delete/list` |
| Recipe import from a URL (schema.org/Recipe JSON-LD parsing) | ALREADY REAL | `RecipeImportBar` → `import-from-url` |
| Recipe capture from a cookbook photo (vision OCR) | ALREADY REAL | `RecipeImportBar` → `import-from-photo` (LLaVA/Qwen2.5-VL) |
| Recipe scaling (serving-count reflow) | ALREADY REAL | `RecipeBoxSection` scale modal + `CookingActionPanel` → `recipes-scale` / `scaleRecipe` |
| Full-screen step-by-step cook mode with per-step timer | ALREADY REAL | `CookMode` (real steps/ingredients from `recipes-get`, no mock data) |
| Ratings + "I made it" cook log + history | ALREADY REAL | `RecipeKitchen` rating/made-it forms + History panel → `recipe-rate` / `recipe-log-cooked` / `recipe-history` |
| Recipe collections / folders | **was BACKEND-CAPABLE-BUT-UNSURFACED** | `collections-list/create/delete` had a real Collections tab; `collections-toggle-recipe` (add/remove a recipe from a folder) had **no UI at all** — **fixed this rebuild** |
| Week meal-plan calendar (breakfast/lunch/dinner/snack × 7 days) | ALREADY REAL | `RecipeBoxSection` Meal plan tab → `meal-plan-get/set/clear` |
| AI-assisted meal plan fill | ALREADY REAL | `RecipeBoxSection` "AI meal plan" button → `ai-meal-plan` |
| Auto-generated, aisle-grouped shopping list from the meal plan | ALREADY REAL | `RecipeBoxSection` Shopping tab → `shopping-list-generate/get/toggle/clear` |
| Manual "add one item not tied to a recipe" to the shopping list | **was BACKEND-CAPABLE-BUT-UNSURFACED** | `shopping-list-add` existed with zero UI — every shopping list was 100% meal-plan-derived, with no way to add e.g. "paper towels" — **fixed this rebuild** |
| Multi-store shopping consolidation + unit normalization | ALREADY REAL | `RecipeKitchen` "Shop by store" → `shopping-list-by-store` |
| Pantry inventory + "what can I cook?" coverage ranking | ALREADY REAL | `RecipeBoxSection` Pantry tab → `pantry-list/add/delete` + `pantry-cook-suggestions` |
| Printable / exportable recipe card | ALREADY REAL | `RecipeKitchen` → `recipe-export-card` (plain-text card + print-ready HTML, print + download) |
| USDA-linked per-recipe nutrition (real ingredient-to-FDC resolution) | ALREADY REAL | `RecipeKitchen` "Compute USDA nutrition" + bar chart → `recipe-nutrition-compute` |
| Ad-hoc food search across 600K+ USDA foods with full nutrient detail | ALREADY REAL | `NutritionExplorer` (3-tier collapsible card, Save-as-DTU) + `UsdaFoodSearch` → `usda-search` / `usda-nutrition` / `live_food_search` |
| Ingredient substitutions | ALREADY REAL | `CookingActionPanel` → `substitution` |
| Kitchen dashboard / at-a-glance stats (recipe count, planned meals, shopping progress, pantry size) | **was a client-computed fabrication** | Removed — see "What this rebuild fixed" |
| Standalone kitchen timer (independent of a recipe step) | ALREADY REAL | `CookingTimer` on the page — a general-purpose timer distinct from `CookMode`'s per-step timer |
| Live recipe discovery feed (public catalog ingestion) | ALREADY REAL | `LensFeedButton` → `feed` (TheMealDB ingestion into visible DTUs) |
| Static budget-per-day meal-plan calculator (legacy, distinct from the real week-plan calendar) | GENERIC-STRIP-ONLY | `mealPlan` — a pure-compute demo generator (given `days`/`budgetPerDay`, returns a placeholder grid with `planned:false` for every slot; no persistence, no real recipes). Superseded in practice by `meal-plan-get/set` + `ai-meal-plan`, which are the real, recipe-backed weekly planner. Left reachable only via `AutoActionStrip`'s generic per-macro fallback — an honest, explicit disposition, not a fabrication (it returns a real, correctly-computed budget breakdown on call, just with no bespoke UI home). Not worth a dedicated panel: it duplicates a feature the real planner already covers better. |
| Brewery/beverage lookup (Open Brewery DB) | GENUINELY OUT OF CATEGORY (honest relabel) | `live_breweries` is registered on **both** `food` and `cooking` domains (shared handler) but its designed home is the `food` lens's `BreweryPanel` — a brewery finder isn't a Paprika/MyFitnessPal feature, and duplicating the same panel into `cooking` would be scope creep, not coverage. Correctly not mounted here. |

**Coverage: 39/41 macros (95%) are DESIGNED features with bespoke UI in
this lens; 1 (`mealPlan`) is an honest GENERIC-STRIP-ONLY legacy utility
superseded by the real planner; 1 (`live_breweries`) correctly lives in
its sibling `food` lens instead. No GENUINELY MISSING items remain
against the Paprika/Samsung-Food/MyFitnessPal checklist above.**

## What this rebuild fixed

The page (`app/lenses/cooking/page.tsx`) previously ran **two competing
recipe systems side by side**: the real one (`RecipeBoxSection` +
`RecipeKitchen`, both already fully wired to the domain's macros) sat
directly above a second, fully client-side "recipe" CRUD built on the
generic `useLensData('cooking', 'recipe', …)` store — its own separate
in-browser list with fields (`difficulty: 'easy'|'medium'|'hard'`,
`rating`, `instructions`) that **no backend macro produces or
consumes**. That fake layer:

1. Rendered its own recipe cards, its own "New Recipe" form, its own
   serving-multiplier math, and its own ingredient checklist — entirely
   disconnected from the real recipe box directly above it.
2. Computed a 4-tile stat strip (`stats.total` / `stats.cuisines` /
   `stats.avgTime` / `stats.topRated`) from that same fake client-side
   list — a fabricated-looking dashboard that had nothing to do with
   the user's actual recipes, meal plan, shopping list, or pantry.
3. Ran a "Recipe Actions" quick-button row (`scaleRecipe` /
   `nutritionEstimate` / `mealPlan` / `substitution`) against
   `items[0]?.id` from that same fake list — i.e. real macros wired to
   a fake artifact id, so the buttons were mostly disabled/pointless in
   practice (`CookingActionPanel` below already covers the same four
   macros against real, user-entered ingredients).

**Fixed:** removed the entire fake recipe CRUD (`useLensData`/
`useRunArtifact` recipe store, the duplicate recipe grid, the duplicate
create form, the fabricated stat tiles, the disabled quick-action row)
and replaced the stat strip with a **real** `KitchenDashboardStrip`
wired to `cooking.cooking-dashboard-summary` — recipe count, collection
count, meals planned this week, shopping-list progress, and pantry item
count, all computed server-side from the user's actual state. Also
wired the two other previously-unsurfaced macros with real, designed
controls rather than generic buttons:

- **`collections-toggle-recipe`** — `RecipeBoxSection` gained a full
  Collections tab: create/delete folders, drill into a folder, and a
  per-recipe checkbox row that toggles membership (a real save/unsave
  interaction, not a raw macro-name button).
- **`shopping-list-add`** — the Shopping tab gained an inline
  name/qty/unit row + "Add" button for items that aren't tied to any
  recipe (e.g. "paper towels"), sitting next to the existing
  meal-plan-derived auto-generation flow.

Finally, `<UniversalActions>` (the generic AI analyze/generate/suggest
action bar) and `<LensFeaturePanel>` (the generic capabilities list)
were dropped from the page. With `RecipeBoxSection`, `RecipeKitchen`,
`NutritionExplorer`, `UsdaFoodSearch`, and `CookingActionPanel` already
giving every real workflow a designed home, these two generic bodies
were redundant scaffolding rather than added capability — their removal
is what took the lens from `grade-ux-polish.mjs --honest`'s
`isGenericScaffold: true` (capped at `functional`, because the page's
own LOC had shrunk under 700 and no single bespoke component crossed
the 1000-LOC flagship threshold once the fake CRUD was deleted) to
`isGenericScaffold: false` / `tier: "polished"`.

## Left alone (already real, no changes)

- `RecipeKitchen` — cook mode, ratings/made-it log + history, USDA-linked
  per-recipe nutrition with chart, multi-store shopping, printable
  export card (print + download).
- `RecipeImportBar` — URL import (schema.org/Recipe JSON-LD) and photo
  OCR import, both writing real recipes into the box.
- `CookMode` — full-screen step view with a per-step timer that
  pre-fills its suggested duration by parsing "X minutes" out of the
  step text.
- `NutritionExplorer` — debounced USDA typeahead, 3-tier collapsible
  nutrition card (macros → %DV bars → full micronutrient grid),
  Save-as-DTU.
- `UsdaFoodSearch` — the `live_food_search` real USDA search surface
  (distinct code path from `usda-search`/`usda-nutrition`, shared with
  the `food` domain).
- `CookingActionPanel` — the structured-ingredient "kitchen bench":
  USDA lookup → promote-to-ingredient, scale, nutrition estimate,
  substitution, plus mint/DM/publish/agent-tips actions with pipe
  publish and recallable-action undo windows.
- `CookingTimer` — a small standalone timer, deliberately independent of
  `CookMode`'s per-step timer (documented in-code so it doesn't read as
  a duplicate).

**Minor, non-blocking observation (not fixed, not a defect):**
`pantry-add` in `RecipeBoxSection` uses a native `window.prompt()`
rather than an inline form — it's a real, working call against a real
macro, just a plainer interaction than the rest of the tab's polish
level. Left as-is per "fix only what's actually wrong," not gold-plated.

## Verification

- `npx eslint app/lenses/cooking/page.tsx components/cooking/*.tsx` — clean, 0 errors / 0 warnings.
- `npx tsc --noEmit -p .` — 0 errors attributable to cooking files (project-wide run surfaced pre-existing, unrelated errors in `app/lenses/council/page.tsx` from a concurrent sibling edit in the shared working tree — not touched by this rebuild).
- `node scripts/verify-lens-backends.mjs` — cooking stays `WIRED` (258 WIRED / 2 by-design NO-BACKEND-CALL, unchanged).
- `node scripts/grade-ux-polish.mjs --honest` — cooking: `tier: "polished"`, `isGenericScaffold: false` (was `tier: "functional"`, `isGenericScaffold: true` immediately before the `<UniversalActions>`/`<LensFeaturePanel>` removal in this same rebuild).
- `node scripts/lens-unsurfaced.mjs --lens cooking` — `0/39 macros never referenced in the frontend`.
