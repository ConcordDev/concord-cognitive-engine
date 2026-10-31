// server/tests/pets-delete-cascade.test.js
//
// Q20 (E-87): pet-delete must cascade to EVERY petId-keyed collection.
// It missed photos, appointments, and lostProfiles — orphaning the
// first two and leaving the deleted pet's lost-pet card resolvable by
// its public token. Pins: all twelve collections cleared for the
// deleted pet, a second pet's data untouched, access grants for the
// deleted pet removed while grants for surviving pets remain, and the
// public token lookup dead after delete.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerPetsActions from "../domains/pets.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, userId, params = {}) {
  const fn = ACTIONS.get(`pets.${name}`);
  if (!fn) throw new Error(`pets.${name} not registered`);
  return fn({ actor: { userId } }, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerPetsActions(register); });
beforeEach(() => { globalThis._concordSTATE = {}; });

const PET_KEYED = ["vaccines", "medications", "vetVisits", "weights", "careActivities", "symptoms", "reminders", "documents", "expenses", "photos", "appointments", "lostProfiles"];

function seedPet(userId, name) {
  const pet = call("pet-add", userId, { name, species: "dog" }).result.pet;
  call("vaccine-record", userId, { petId: pet.id, name: "Rabies" });
  call("photo-add", userId, { petId: pet.id, url: "https://img.example/p.jpg" });
  call("appointment-book", userId, { petId: pet.id, date: "2026-11-05", reason: "checkup" });
  const lost = call("lost-card-create", userId, { petId: pet.id, contactName: "Sam", contactPhone: "555-0100" });
  assert.equal(lost.ok, true, JSON.stringify(lost));
  return { pet, lostToken: lost.result.card.publicToken };
}

describe("pets delete cascade (Q20)", () => {
  it("clears every petId-keyed collection, including photos, appointments, and the lost-pet card", () => {
    const { pet, lostToken } = seedPet("owner-1", "Rex");
    const s = globalThis._concordSTATE.petsLens;
    for (const k of ["vaccines", "photos", "appointments", "lostProfiles"]) {
      assert.ok(s[k].has(pet.id), `seeded: ${k} holds the pet's data before delete`);
    }
    const r = call("pet-delete", "owner-1", { id: pet.id });
    assert.equal(r.ok, true);
    for (const k of PET_KEYED) {
      assert.ok(!s[k].has(pet.id), `${k} no longer holds the deleted pet's data`);
    }
    const byToken = call("lost-card-get", "anyone", { publicToken: lostToken });
    assert.equal(byToken.ok, false, "the deleted pet's lost card is no longer publicly resolvable");
  });

  it("another pet's records and grants are untouched; the deleted pet's grants are gone", () => {
    const a = seedPet("owner-1", "Rex");
    const b = seedPet("owner-1", "Fido");
    call("access-grant", "owner-1", { petId: a.pet.id, userId: "friend-1", role: "caregiver" });
    call("access-grant", "owner-1", { petId: b.pet.id, userId: "friend-1", role: "caregiver" });
    call("pet-delete", "owner-1", { id: a.pet.id });
    const s = globalThis._concordSTATE.petsLens;
    assert.ok(s.photos.has(b.pet.id) && s.appointments.has(b.pet.id), "the surviving pet keeps its photos/appointments");
    const grants = s.petAccess.get("owner-1") || [];
    assert.deepEqual(grants.map((g) => g.petId), [b.pet.id], "only the surviving pet's grant remains");
    const shared = call("access-list", "friend-1", {});
    assert.equal(shared.ok, true);
    assert.deepEqual(shared.result.sharedWithMe.map((x) => x.pet.id), [b.pet.id]);
  });
});
