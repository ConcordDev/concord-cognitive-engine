// food-create-validation.test.js
//
// Food S1 (lens-reviews/food.md F2, split by cross-check #64): every
// dialog create in the Food lens was refused with the bare
// `validation_failed` code — thirteen submissions across Recipe,
// PantryItem, MealPlan and Menu in Product Review 2's 2026-11-01 pass.
// The refusal sits in validateArtifact (lib/domain-logic.js) over the
// merged rule registry: the food rule was authored in a vocabulary the
// real frontend never sends (the stale-vocabulary class fixed before
// for trades/services/security). FoodKitchenWorkbench's ArtifactType
// union is Recipe | MealPlan | ShoppingItem | PantryItem | Menu |
// InventoryItem | Booking | Batch | Shift and its Status union is
// prep | active | 86d | seasonal | archived; the rule knew only
// lowercase macro-era types and draft/tested/published/archived
// statuses, so Recipe/PantryItem/MealPlan failed the STATUS check
// (the form's default is "prep") and Menu/InventoryItem/Booking/
// Batch/Shift failed the TYPE check as well.
//
// This suite builds the registry exactly the way server.js does
// (extended rules fill missing domains, then reconcileArtifactTypes)
// and pins: (1) every create the workbench can send now validates;
// (2) the validator still refuses — with the field named in the
// error — for a type or status outside the vocabulary.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { DOMAIN_RULES, validateArtifact } from "../lib/domain-logic.js";
import { EXTENDED_DOMAIN_RULES } from "../lib/domain-logic-extended.js";
import { reconcileArtifactTypes } from "../lib/lens-artifact-types.js";

// server.js merge order, verbatim.
for (const [k, v] of EXTENDED_DOMAIN_RULES) {
  if (!DOMAIN_RULES.has(k)) DOMAIN_RULES.set(k, v);
}
reconcileArtifactTypes(DOMAIN_RULES);

// The exact payloads FoodKitchenWorkbench.handleSave posts:
// { title, data: { name, type, status, ... }, meta: { status, tags } } —
// lens.create validates validateArtifact(domain, type, data, meta).
const WORKBENCH_CREATES = [
  // The four objects R2's pass exercised, at the form's default status.
  { type: "Recipe", status: "prep" },
  { type: "PantryItem", status: "prep" },
  { type: "MealPlan", status: "prep" },
  { type: "Menu", status: "prep" },
  // The rest of the workbench's type union.
  { type: "ShoppingItem", status: "active" },
  { type: "InventoryItem", status: "active" },
  { type: "Booking", status: "active" },
  { type: "Batch", status: "prep" },
  { type: "Shift", status: "active" },
  // Every status in the workbench's union, on the lens's central object.
  { type: "Recipe", status: "active" },
  { type: "Recipe", status: "86d" },
  { type: "Recipe", status: "seasonal" },
  { type: "Recipe", status: "archived" },
  // The macro-era vocabulary keeps validating (additive fix).
  { type: "recipe", status: "draft" },
  { type: "meal-plan", status: "tested" },
];

describe("food dialog creates validate against the merged registry (F2/S1)", () => {
  for (const { type, status } of WORKBENCH_CREATES) {
    it(`accepts ${type} with status "${status}"`, () => {
      const v = validateArtifact("food", type, { name: "Probe", type, status }, { status, tags: [type] });
      assert.equal(v.ok, true, `expected ok, got errors: ${v.errors.join(" | ")}`);
      assert.deepEqual(v.errors, []);
    });
  }

  it("still refuses an unknown type — and the error names the type", () => {
    const v = validateArtifact("food", "TastingMenu", { name: "Probe" }, { status: "prep" });
    assert.equal(v.ok, false);
    assert.match(v.errors.join(" "), /Invalid type "TastingMenu" for domain "food"/);
  });

  it("still refuses an unknown status — and the error names the status", () => {
    const v = validateArtifact("food", "Recipe", { name: "Probe" }, { status: "plated" });
    assert.equal(v.ok, false);
    assert.match(v.errors.join(" "), /Invalid status "plated" for domain "food"/);
  });

  it("the food schema the list endpoint serves includes the workbench vocabulary", () => {
    const rule = DOMAIN_RULES.get("food");
    for (const t of ["Recipe", "MealPlan", "ShoppingItem", "PantryItem", "Menu", "InventoryItem", "Booking", "Batch", "Shift"]) {
      assert.ok(rule.types.includes(t), `types missing ${t}`);
    }
    for (const s of ["prep", "active", "86d", "seasonal", "archived"]) {
      assert.ok(rule.validStatuses.includes(s), `validStatuses missing ${s}`);
    }
  });
});
