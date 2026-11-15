// Audit sweep CB-0447, cluster E — FIX-agriculture-006, scout leg.
// scout-add refuses a pin whose field is not the caller's own, but
// field-delete used to remove only the field record: the pins stayed
// in the caller's store, orphaned, and still surfaced on an unfiltered
// scout-list. field-delete now cascades to the field's pins.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerAgricultureActions from "../domains/agriculture.js";

function makeRegistry() {
  const actions = new Map();
  return {
    actions,
    register(domain, name, fn) { actions.set(`${domain}.${name}`, fn); },
    call(key, ctx, input = {}) {
      const fn = actions.get(key);
      if (!fn) throw new Error(`${key} not registered`);
      const [domain] = key.split(".");
      return fn(ctx, { id: null, domain, type: "domain_action", data: input || {}, meta: {} }, input || {});
    },
  };
}

const R = makeRegistry();
before(() => { registerAgricultureActions(R.register); });
beforeEach(() => { globalThis._concordSTATE = {}; });

const ctxA = { actor: { userId: "user_a" } };
const ctxB = { actor: { userId: "user_b" } };

describe("agriculture field-delete cascades to scout pins (FIX-agriculture-006)", () => {
  it("deleting a field removes its pins, keeps other fields' pins, and reports the count", () => {
    const f1 = R.call("agriculture.field-create", ctxA, { name: "North 40", acreage: 40 }).result.field;
    const f2 = R.call("agriculture.field-create", ctxA, { name: "South 10", acreage: 10 }).result.field;
    R.call("agriculture.scout-add", ctxA, { fieldId: f1.id, note: "Aphids on the north edge", category: "pest", severity: "medium" });
    R.call("agriculture.scout-add", ctxA, { fieldId: f1.id, note: "Standing water", category: "irrigation", severity: "low" });
    R.call("agriculture.scout-add", ctxA, { fieldId: f2.id, note: "Bindweed patch", category: "weed", severity: "high" });
    assert.equal(R.call("agriculture.scout-list", ctxA, {}).result.pins.length, 3);

    const del = R.call("agriculture.field-delete", ctxA, { id: f1.id });
    assert.equal(del.ok, true);
    assert.equal(del.result.scoutPinsRemoved, 2);

    const remaining = R.call("agriculture.scout-list", ctxA, {}).result.pins;
    assert.equal(remaining.length, 1);
    assert.equal(remaining[0].fieldId, f2.id);
    // The deleted field's own filtered list is empty too — no orphans.
    assert.equal(R.call("agriculture.scout-list", ctxA, { fieldId: f1.id }).result.pins.length, 0);
    // Deleting again is an honest not-found; another user never had the field.
    assert.equal(R.call("agriculture.field-delete", ctxA, { id: f1.id }).ok, false);
    assert.equal(R.call("agriculture.field-delete", ctxB, { id: f2.id }).ok, false);
  });

  it("scout-delete still removes a single pin on its own", () => {
    const f1 = R.call("agriculture.field-create", ctxA, { name: "North 40", acreage: 40 }).result.field;
    const pin = R.call("agriculture.scout-add", ctxA, { fieldId: f1.id, note: "Aphids", category: "pest", severity: "low" }).result.pin;
    const del = R.call("agriculture.scout-delete", ctxA, { id: pin.id });
    assert.equal(del.ok, true);
    assert.equal(R.call("agriculture.scout-list", ctxA, {}).result.pins.length, 0);
    assert.equal(R.call("agriculture.field-delete", ctxA, { id: f1.id }).result.scoutPinsRemoved, 0);
  });
});
