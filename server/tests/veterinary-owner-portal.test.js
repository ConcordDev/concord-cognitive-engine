// FIX-veterinary-011 — the Owner Portal search must find a patient
// by the patient's name, not only by the owner's name. The macro
// matched owners by exact equality, so the natural front-desk lookup
// (the pet's name, which is also what the ticket's expected state
// allows: "Patient/owner match") returned an empty portal — and the
// result even echoed the pet's name back as the portal "owner".
// Pins: owner match unchanged, patient-name match resolves to the
// patient's owner's full portal (all their pets + records), the
// returned owner is the stored owner name, unknown names stay empty.
import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerActions from "../domains/veterinary.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`veterinary.${name}`);
  if (!fn) throw new Error(`veterinary.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = {};
  globalThis._concordSaveStateDebounced = () => {};
});

const ctx = { actor: { userId: "vet-1" }, userId: "vet-1" };

function seed() {
  call("patient-add", ctx, { name: "Biscuit", owner: "Jamie Smith", species: "dog", breed: "Corgi", ageYears: 4, weightLbs: 28 });
  call("patient-add", ctx, { name: "Waffles", owner: "Jamie Smith", species: "cat", breed: "Tabby", ageYears: 2, weightLbs: 9 });
  call("patient-add", ctx, { name: "Rex", owner: "Pat Lee", species: "dog", breed: "Lab", ageYears: 6, weightLbs: 70 });
}

describe("FIX-veterinary-011 owner portal search", () => {
  it("owner-name search is unchanged", () => {
    seed();
    const r = call("owner-portal", ctx, { owner: "Jamie Smith" });
    assert.equal(r.ok, true);
    assert.equal(r.result.owner, "Jamie Smith");
    assert.equal(r.result.petCount, 2);
  });

  it("PATIENT-name search opens the patient's owner's portal in full", () => {
    seed();
    const r = call("owner-portal", ctx, { owner: "Biscuit" });
    assert.equal(r.ok, true);
    assert.equal(r.result.owner, "Jamie Smith");
    assert.equal(r.result.petCount, 2);
    assert.deepEqual(r.result.pets.map((p) => p.name).sort(), ["Biscuit", "Waffles"]);
  });

  it("patient-name search is case-insensitive and never labels the pet as the owner", () => {
    seed();
    const r = call("owner-portal", ctx, { owner: "rex" });
    assert.equal(r.ok, true);
    assert.equal(r.result.owner, "Pat Lee");
    assert.equal(r.result.petCount, 1);
    assert.equal(r.result.pets[0].name, "Rex");
  });

  it("an unknown name still returns an empty portal for that name", () => {
    seed();
    const r = call("owner-portal", ctx, { owner: "Nobody Here" });
    assert.equal(r.ok, true);
    assert.equal(r.result.petCount, 0);
    assert.equal(r.result.owner, "Nobody Here");
  });

  it("portal data stays scoped to the calling user", () => {
    seed();
    const other = { actor: { userId: "vet-2" }, userId: "vet-2" };
    const r = call("owner-portal", other, { owner: "Biscuit" });
    assert.equal(r.ok, true);
    assert.equal(r.result.petCount, 0);
  });
});
