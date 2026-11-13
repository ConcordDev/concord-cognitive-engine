// agriculture-soil-grid-delete.test.js
//
// FIX-agriculture-013: stored soil grids had no delete — neither a
// server action nor a panel control. soil-grid-delete removes the
// caller's own grid only; another user's grid is "not found".

import { test } from "node:test";
import assert from "node:assert/strict";

async function loadActions() {
  globalThis._concordSTATE = {};
  const actions = new Map();
  const { default: registerAgricultureActions } = await import("../domains/agriculture.js");
  registerAgricultureActions((domain, action, fn) => actions.set(`${domain}.${action}`, fn));
  return actions;
}
const ART = { id: null, data: {}, meta: {} };
const asUser = (u) => ({ actor: { userId: u }, userId: u });

test("soil-grid-delete removes the owner's grid and refuses foreign or missing ids", async () => {
  const actions = await loadActions();
  const create = actions.get("agriculture.field-create");
  const generate = actions.get("agriculture.soil-grid-generate");
  const list = actions.get("agriculture.soil-grids-list");
  const del = actions.get("agriculture.soil-grid-delete");

  const f = create(asUser("amy"), ART, { name: "North 40", lat: 41.7, lng: -73.9, acreage: 40 });
  assert.equal(f.ok, true);
  const fieldId = f.result.field.id;
  const g = generate(asUser("amy"), ART, { fieldId, acresPerSample: 10 });
  assert.equal(g.ok, true);
  const gridId = g.result.grid.id;
  assert.equal(list(asUser("amy"), ART, { fieldId }).result.grids.length, 1);

  // Another user cannot delete it (same "not found" as a missing id).
  assert.equal(del(asUser("bob"), ART, { id: gridId }).ok, false);
  assert.equal(list(asUser("amy"), ART, { fieldId }).result.grids.length, 1);

  const gone = del(asUser("amy"), ART, { id: gridId });
  assert.equal(gone.ok, true);
  assert.equal(gone.result.deleted, gridId);
  assert.equal(list(asUser("amy"), ART, { fieldId }).result.grids.length, 0);

  assert.equal(del(asUser("amy"), ART, { id: gridId }).ok, false);
  assert.equal(del(asUser("amy"), ART, {}).ok, false);
});
