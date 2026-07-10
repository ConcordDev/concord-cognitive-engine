# Food Lens — Capability Map (Frontend Rebuild Program, Wave 3)

> Derived, not asserted. Every number below has a reproduction command; every
> classification is backed by a grep or a full read of the file it's about.

## Backend surface

```
grep -c 'registerLensAction("food"' server/domains/food.js
```
→ **68** macros in `server/domains/food.js` (2,055 lines).
`grep -n 'registerLensAction("food"' server/server.js` → **0** — no inline
registrations outside the domain file.

The domain is two fused suites, not one:

1. **Kitchen/restaurant-ops computation macros** (10): `vision`,
   `scaleRecipe`, `costPlate`, `generatePo`, `generatePrepList`,
   `menuAnalysis`, `suggestMeals`, `wasteReport`, `spoilageCheck`,
   `pourCost`. These are pure functions over a passed-in artifact's
   `data` (menu items, inventory, waste log, beverages) — real formulas
   (food-cost %, pour-cost %, PO reorder math, FIFO expiry), no
   persistence of their own. They're what `costPlate`/`menuAnalysis`/etc.
   compute against real `Recipe`/`Menu`/`InventoryItem` DTUs stored via
   the generic per-lens artifact CRUD (`useLensData` → `POST
   /api/lens/food`), which is genuinely persisted, not fake.
2. **MyFitnessPal/Paprika/Yelp-parity macros** (58): a real personal
   nutrition + recipe + pantry system (`pantry-*`, `recipe-*`,
   `nutrition-*`, `meal-plan-*`, `barcode-lookup`,
   `shopping-list-grouped`, `store-layout-*`) fused with a real Yelp-shape
   restaurant directory (`biz-*`, `review-*`, `photo-*`, `tip-*`,
   `checkin*`, `collection-*`, `reservation-*`, `waitlist-*`,
   `top-restaurants`, `cuisine-facets`, `food-discover-dashboard`,
   `biz-map`, `feed`). This half is keyed per-user in an in-memory
   `STATE.foodLens` `Map` structure (not SQLite — the same pattern as
   several other lenses' lightweight substrates), backfilled
   append-only so old persisted STATE upgrades cleanly.

**This is NOT the in-world `restaurant` gameplay minigame** (Diner-Dash
service loop, tables, tips — `server/lib/restaurant.js`, driven from
Concordia's `StationInteractionRouter`). `food` is a standalone personal
productivity + local-business-discovery app. The lens's own legacy
"Bookings/Batches/Shifts" B2B-ops tabs (see below) blur this line visually
but are backed by the generic DTU-artifact CRUD, not by any `food.js`
macro — see "Known residual issue" below.

## Reference apps

**MyFitnessPal/Cronometer** (barcode scan → nutrition log, daily macro
goal rings, day summary) + **Paprika/NYT Cooking** (recipe library with
photos, ratings, cook-again history, URL import, pantry-aware
auto-planning, aisle-grouped shopping) + **Yelp** (business directory,
search/filter/facets, reviews with helpful/funny/cool votes, tips,
check-ins, curated lists, reservations + waitlist, Bayesian-ranked Top
100, geo map with directions). Parity target: the food lens should do all
four of these without the seams showing — nutrition tracking, recipe
management, and restaurant discovery should feel like one integrated app,
not three demos bolted together.

## Classification (before this pass)

Read `app/lenses/food/page.tsx` (2,862 lines) and all 19 files in
`components/food/` (3,461 lines) in full, plus
`server/domains/food.js` end to end.
`grep -n "Math.random|MOCK|mock|fake|Lorem|lorem|TODO"
components/food/*.tsx` → **zero hits** — the dedicated MyFitnessPal/
Yelp-parity component layer (`FoodParityPanel`, `FoodYelpSection`,
`RecipeLibrary`, `MacroGoalRings`, `BarcodeScanner`, `MealPlanAuto`,
`RestaurantMap`, `PantryTracker`, `PlateScan`, `YelpDiscoverPanel`,
`YelpTopPanel`, `YelpCollectionsPanel`, `YelpBookingsPanel`) is real,
designed, and clean — every panel calls `lensRun('food', …)` against a
real macro and renders the real response shape, with honest empty/error
states throughout (e.g. `MealPlanAuto`: "recipes in the plan have no
ingredient data yet" instead of inventing quantities).

`node scripts/lens-unsurfaced.mjs --lens food` (before) → **6/68**
unreferenced: `biz-delete`, `checkin-history`, `food-discover-dashboard`,
`nutrition-goal-get`, `recipe-substitute`, `tip-list`.

**62 of 68 macros (91%) were already wired** through designed UI. Of the
6 originally unsurfaced, all were checked by hand (not just grep) against
the actual rendered components:

- **4 were genuine, real gaps** — real backend capability with no UI
  path: `biz-delete` (a business owner had no way to remove their own
  directory listing), `checkin-history` (a user's own check-in log was
  computed server-side but never displayed anywhere), `recipe-substitute`
  (an LLM-backed allergen/ingredient-swap tool with no frontend surface
  at all), `food-discover-dashboard` (a real aggregate — business count,
  cuisine count, my reviews/check-ins/collections, upcoming
  reservations, active waitlists — computed but never rendered).
- **2 are genuinely, correctly redundant** (not defects — a mounted panel
  already renders a strict superset): `nutrition-goal-get` is subsumed by
  `nutrition-day-summary`, which returns the goal alongside the day's
  progress (`MacroGoalRings` reads the goal from there, one round trip
  instead of two); `tip-list` is subsumed by `biz-detail`, which already
  returns a business's tips array alongside reviews/photos
  (`YelpDiscoverPanel`'s detail view renders from that).

Separately — not a macro-coverage gap, but two confirmed **honesty/dead-
path defects** found by reading the code, not by the unsurfaced scanner:

1. **Silent data loss in the Recipe editor** — `app/lenses/food/page.tsx`
   rendered four "Nutrition per Serving" inputs (Calories/Protein/Carbs/
   Fat) with no `value`/`onChange` at all — pure decoration. Whatever a
   user typed vanished on save. The one field that did persist,
   `calories`, did so through a bizarre regex scrape of the free-text
   Notes field (`formNotes.match(/cal:(\d+)/)`) — an undiscoverable
   "type `cal:350` in your notes" convention nobody would find.
   Protein/carbs/fat were **never saved under any path**.
2. **`RecipeImporter` was a dead end** — `recipe-import-url` (JSON-LD
   first, LLM fallback) genuinely extracts a full recipe (title,
   servings, ingredients, steps, nutrition) from a URL and displays it,
   but the component never called `recipe-add` to save it anywhere, and
   its `onImported` callback prop was declared but never passed by the
   page that mounts it. Import → look at it → gone on next render. This
   also explains why `RecipeLibrary`-authored recipes always have empty
   `ingredients: []` (its own add form never collected them either) —
   the one macro pathway (`recipe-import-url`) that produces structured
   ingredient data had no way to reach the recipe library that
   `meal-plan-auto`'s pantry scoring and `shopping-list-grouped`'s
   aisle-grouping depend on.

## What changed

- **`concord-frontend/app/lenses/food/page.tsx`** — added
  `formCalories`/`formProtein`/`formCarbs`/`formFat` state, wired all
  four to the previously-decorative Recipe-editor nutrition inputs, reset
  them in `openCreate`/populate them in `openEdit`, and replaced the
  regex-scrape calorie hack in `handleSave` with real field writes for
  all four macros. Also added a small `"— session only, not saved to
  your account"` disclosure to the Waste Log, Prep List, and Floor Plan
  & Tables sub-view headers (see "Known residual issue" below) so the
  UI stops silently implying persistence it doesn't have.
- **`concord-frontend/components/food/RecipeImporter.tsx`** — added a
  slot picker + "Save to Recipe Library" button that calls `recipe-add`
  with the imported title/servings/nutrition/ingredients, an `onSaved`
  callback, and an honest post-save note that step-by-step instructions
  are reference-only (`recipe-add` has no steps field — a real backend
  limitation, not something faked client-side to look saved).
- **`concord-frontend/components/food/FoodYelpSection.tsx`** — added a
  live stats strip in the section header sourced from
  `food-discover-dashboard` (businesses, cuisines, my reviews, my
  check-ins, upcoming reservations, active waitlists), refreshed on tab
  switch.
- **`concord-frontend/components/food/YelpBookingsPanel.tsx`** — added a
  "Check-in history" section (`checkin-history`) below Reservations, with
  a show-5/show-all toggle.
- **`concord-frontend/components/food/YelpDiscoverPanel.tsx`** — added a
  "Delete listing" action to the business detail view, calling
  `biz-delete`. Deliberately not owner-gated client-side (the frontend
  has no reliable way to know the current user's id at that call site);
  the backend's real `only the owner can delete this business` rejection
  surfaces honestly as the error message instead of being pre-empted by
  a fabricated permission check.
- **`concord-frontend/components/food/IngredientSubstitute.tsx`** (new,
  132 lines) — an ingredient/allergen substitute finder for
  `recipe-substitute` (4 modes: allergen swap, simpler, healthier,
  surprise-me), rendering the macro's ranked substitutes with ratio +
  confidence + caveat, and always showing its mandatory
  cross-contamination disclaimer. Honest failure state ("the reasoning
  brain may be offline") when the LLM call fails — no fabricated
  substitutes.
- **`concord-frontend/components/food/FoodParityPanel.tsx`** — mounted
  `IngredientSubstitute` under the existing "Recipes" tab, alongside
  `RecipeLibrary`.

No backend changes — this pass was frontend-only; all 68 macros already
existed and were already correct.

## Known residual issue (documented, not fixed this pass)

The legacy "Bookings/Batches/Shifts" restaurant-ops tabs in
`app/lenses/food/page.tsx` (a pre-existing B2B kitchen-management layer,
separate from the MyFitnessPal/Yelp-parity component set above) mix two
different honesty tiers:

- The primary entities (Recipe/Menu/InventoryItem/Booking/Batch/Shift
  cards) **are real** — persisted via the generic per-lens artifact CRUD
  (`useLensData`), not fabricated.
- Three sub-tools nested inside those tabs are **not**: "Floor Plan &
  Tables" (`generateTables()` — 20 hardcoded tables + a walk-in waitlist)
  and "Waste Log" are pure `useState` that resets every page load, never
  touching any macro or persisted artifact. "Prep List" is worse — its
  checklist array is never populated by anything (the "Auto-Generate"
  button calls the real `generatePrepList` macro, but the result lands
  in a generic `actionResult` display, not in the checklist state), so
  the feature is permanently empty.

None of these three correspond to a `food.js` macro — there's no
table-seating, waste-ledger, or prep-checklist persistence macro to wire
them to, so this isn't a "macro real, UI dead-path" case like the ones
fixed above; it would need new backend capability, which is out of scope
for a macro-surfacing pass. This pass added the honest
`"— session only, not saved to your account"` disclosure (see above) as
a low-risk stopgap rather than leaving the UI to silently imply
persistence. A full fix (either building real backend state for
table/waste/prep tracking, or removing the sub-tools) is future work.

## Verification

- `cd concord-frontend && npx eslint app/lenses/food/page.tsx components/food/RecipeImporter.tsx components/food/FoodYelpSection.tsx components/food/YelpBookingsPanel.tsx components/food/YelpDiscoverPanel.tsx components/food/IngredientSubstitute.tsx components/food/FoodParityPanel.tsx` — clean, exit 0.
- `cd concord-frontend && npx tsc --noEmit -p .` — 0 errors attributable to any touched file (`grep -ic food /tmp/tsc_out.txt` → 0; the 51 pre-existing errors in the full run are all in `app/lenses/game/page.tsx`, `components/ethics/DecisionToolkit.tsx`, and `components/events/EventOps.tsx` — unrelated lenses, untouched by this pass).
- `node scripts/lens-unsurfaced.mjs --lens food` (after) → **2/68** unreferenced: `nutrition-goal-get`, `tip-list` — both documented above as correctly redundant, not gaps.
- `cd server && node --test tests/ecosystem-food-web.test.js tests/food-domain-parity.test.js tests/food-behavior.test.js` → **56 pass / 0 fail** (backend untouched this pass; re-run to confirm no regression from the frontend-only change).
- Did not touch `components/food/BarcodeScanner.tsx`, `BreweryPanel.tsx`,
  `CookMode.tsx`, `MacroGoalRings.tsx`, `MealPlanAuto.tsx`,
  `MealPlanner.tsx`, `OpenFoodFactsSearch.tsx`, `PantryTracker.tsx`,
  `PlateScan.tsx`, `RecipeLibrary.tsx`, `RecipeScaler.tsx`,
  `RestaurantMap.tsx`, `YelpCollectionsPanel.tsx`, `YelpTopPanel.tsx` —
  each was read in full and found already correctly wired with no fake
  data (confirmed via the `Math.random|MOCK|mock|fake|Lorem|lorem|TODO`
  grep above plus a manual read), so no changes were made to them.
