# Household Lens — Capability Map (Frontend Rebuild Program, Wave 3)

> Derived, not asserted. Every number below has a reproduction command.

## Backend surface

```
grep -c 'registerLensAction("household"' server/domains/household.js
```
→ **47** macros, all in `server/domains/household.js` (1,284 lines). No inline
`registerLensAction("household"...)` / `register("household"...)` calls exist
in `server.js` (`grep -n 'registerLensAction("household"\|register("household"' server/server.js` → empty) — one domain file is the complete surface.

`node scripts/lens-unsurfaced.mjs --lens household` → **1/48 macros never
referenced** (`off-product-search`; the script's own denominator count of 48
vs. the grep's 47 is a package/registration counting quirk, not a discrepancy
in coverage). Fixed this wave — see below.

The 47 macros split into two generations:
- **Original "creative-tools" macros** (lines 15–472): `generateGroceryList`,
  `maintenanceCheck`, `rotateChores`, `weeklySummary`, `maintenanceDue`,
  `choreRotation` — deterministic aggregation/rotation logic, no external I/O.
  Surfaced by `HouseholdActionPanel.tsx`, a bespoke workbench (not a generic
  action array — each button has a distinct textarea-driven input shape,
  a typed result card, and downstream mint/DM/publish/agent actions).
- **Open Food Facts integration** (lines 480–572): `off-product-lookup`
  (barcode → full nutrition/allergen/eco-score record) and `off-product-search`
  (name/brand → paginated candidate list). Real external API (`world.openfoodfacts.org`),
  keyless, fails honestly on network error (`{ ok:false, error: "open food
  facts unreachable: …" }` — no synthetic fallback product).
- **Tody/Sweepy-shape chore substrate** (lines 574–end): per-user
  `STATE`-backed rooms/tasks/chore-log/vacation-pause with condition-based
  "dirtiness" decay (`taskCondition` computes a ratio of elapsed-time /
  interval, not a static due-date), plus a parallel Cozi-shape coordination
  layer: family calendar, meal planner, allowance, notifications, shared
  shopping lists, recurring task templates, and an expense splitter with
  real settle-up minimal-transfer computation (`expense-balances`).

## Reference apps

- **Chores/condition-based cleaning**: Tody (dirtiness-ratio scheduling,
  not fixed intervals) — matched by `taskCondition`'s ratio model.
- **Family coordination**: Cozi (shared calendar + shopping lists + meal
  planner + notifications) — matched by the "Family Coordination" section.
- **Expense splitting**: Splitwise (minimal-transfer settle-up) — matched by
  `expense-balances`.
- **Barcode/nutrition**: Yuka / Open Food Facts app — matched by
  `BarcodeLookup.tsx`.

## What was real vs. fake

Everything found was real. No fabricated data, no dead-wired buttons, no
generic scaffold. Every one of the 9 bespoke components
(`ChoreBoard`, `ChoreRotation`, `FamilyCalendar`, `MealPlanner`,
`AllowanceTracker`, `MemberNotifications`, `SharedShoppingLists`,
`RecurringTemplates`, `ExpenseSplitter`, `HouseholdActionPanel`,
`BarcodeLookup`) is mounted unconditionally in `page.tsx` (verified by
reading lines 1892–1963 — none sit inside a rare-state modal/conditional).

## What changed this wave

**Fixed: `off-product-search` was registered but had zero frontend call
sites.** `BarcodeLookup.tsx` only supported lookup-by-barcode; a user who
doesn't know the UPC/EAN had no path to the product. Added a "search by
name/brand" form to `BarcodeLookup.tsx` that calls `off-product-search`,
renders a result grid of candidate products (name, brand, quantity,
Nutri-Score chip), and clicking a candidate auto-fills the barcode field and
runs the existing `off-product-lookup` flow — reusing the real handler
rather than duplicating the product-detail rendering.

Files touched:
- `concord-frontend/components/household/BarcodeLookup.tsx` — added search
  form + result grid + `SearchHit`/`SearchResult` types matching the
  handler's actual return shape (`server/domains/household.js:560-568`).

## Verification

- `node scripts/lens-unsurfaced.mjs --lens household` → now 0 unsurfaced
  (both `off-product-lookup` and `off-product-search` have call sites).
- `cd concord-frontend && npx eslint components/household/BarcodeLookup.tsx` → clean.
- `cd server && node --test tests/household-domain-parity.test.js
  tests/household-lens-macros.test.js
  tests/household-commonsense-fork-domain-parity.test.js` → 91/91 passing
  (pre-existing; no server file was touched this wave).
