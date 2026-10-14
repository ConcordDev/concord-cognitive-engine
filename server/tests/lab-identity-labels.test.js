// INC-SWEEP lab F9 — lab wire bodies use public actor labels, not raw uuids.
// Storage keys stay raw; restart rehydrate still scopes by user id.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerLabActions from "../domains/lab.js";
import { serializeLensState, hydrateLensState } from "../lib/lens-state-persistence.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  return ACTIONS.get(`lab.${name}`)(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerLabActions(register); });
beforeEach(() => { globalThis._concordSTATE = {}; });

const UUID = "906f92c4-a991-4ea5-ac07-2fb210e2ef85";
const ctx = {
  actor: { userId: UUID, displayName: "QA Lab User", role: "member" },
  userId: UUID,
};

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;

describe("lab F9 identity labels", () => {
  it("notebook / inventory / protocol / label wire bodies scrub author uuid", () => {
    const nb = call("notebook-create", ctx, { title: "NB lab-f9", body: "note" });
    assert.equal(nb.ok, true);
    assert.equal(nb.result.entry.author, "QA Lab User");
    assert.ok(!UUID_RE.test(JSON.stringify(nb.result.entry)));

    const inv = call("inventory-add", ctx, { name: "Reagent lab-f9", quantity: 1 });
    assert.equal(inv.ok, true);
    assert.equal(inv.result.item.addedBy, "QA Lab User");

    const proto = call("protocol-create", ctx, { name: "Protocol lab-f9", steps: ["one"] });
    assert.equal(proto.ok, true);
    assert.equal(proto.result.protocol.author, "QA Lab User");

    const lbl = call("label-generate", ctx, { recordType: "reagent", id: inv.result.item.id });
    assert.equal(lbl.ok, true);
    assert.equal(lbl.result.label.generatedBy, "QA Lab User");

    const list = call("notebook-list", ctx, {});
    assert.ok(list.result.entries.every((e) => e.author === "QA Lab User"));
  });

  it("storage stays keyed by raw uuid through labLens rehydrate", () => {
    call("notebook-create", ctx, { title: "NB lab-f9 persist", body: "x" });
    const snap = serializeLensState(globalThis._concordSTATE);
    const persisted = JSON.parse(JSON.stringify(snap));
    // Stored map key is the raw uuid
    const mapEntry = persisted.labLens?.notebook;
    assert.ok(mapEntry, "notebook map persisted");
    const blob = JSON.stringify(mapEntry);
    assert.ok(blob.includes(UUID), "storage key remains raw uuid");

    const next = {};
    hydrateLensState(next, persisted);
    globalThis._concordSTATE = next;
    const list = call("notebook-list", ctx, {});
    assert.equal(list.result.total, 1);
    assert.equal(list.result.entries[0].author, "QA Lab User");
  });
});
