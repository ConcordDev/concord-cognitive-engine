// server/tests/travel-saved-places.test.js
//
// Q17 (E-81): Travel "saved" is a per-user relation. The old place-save
// flipped a global boolean on the SHARED place record while readers
// filtered `saved && addedBy === caller` — so a non-contributor's save
// never appeared in their own list, and any user could silently unsave
// the contributor's place. These tests pin the two-user matrix against
// the real domain registration.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerTravelActions from "../domains/travel.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, userId, params = {}) {
  const fn = ACTIONS.get(`travel.${name}`);
  if (!fn) throw new Error(`travel.${name} not registered`);
  return fn({ actor: { userId } }, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerTravelActions(register); });
beforeEach(() => { globalThis._concordSTATE = {}; });

function addPlace(userId, extra = {}) {
  const r = call("place-add", userId, { name: "Hidden Beach", kind: "beach", ...extra });
  assert.equal(r.ok, true);
  return r.result.place;
}
const savedIds = (userId) => call("place-list", userId, { savedOnly: true }).result.places.map((p) => p.id);
const viewSaved = (userId, id) => call("place-detail", userId, { id }).result.place.saved;

describe("travel saved places (Q17)", () => {
  it("a non-contributor's save lands in THEIR list — and only theirs", () => {
    const place = addPlace("user-a");
    const r = call("place-save", "user-b", { id: place.id });
    assert.equal(r.result.saved, true);
    assert.deepEqual(savedIds("user-b"), [place.id], "B's saved list has the place B saved");
    assert.deepEqual(savedIds("user-a"), [], "A never saved it — A's list stays empty");
    assert.equal(viewSaved("user-b", place.id), true);
    assert.equal(viewSaved("user-a", place.id), false);
  });

  it("a stranger cannot unsave someone else's place", () => {
    const place = addPlace("user-a");
    call("place-save", "user-b", { id: place.id });
    call("place-save", "user-c", { id: place.id, unsave: true });
    assert.deepEqual(savedIds("user-b"), [place.id], "B's save survives C's unsave");
    assert.equal(viewSaved("user-b", place.id), true);
    // and B's own unsave still works
    call("place-save", "user-b", { id: place.id, unsave: true });
    assert.deepEqual(savedIds("user-b"), []);
  });

  it("legacy contributor rows (added with saved:true) read as the contributor's save only", () => {
    const place = addPlace("user-a", { saved: true });
    assert.deepEqual(savedIds("user-a"), [place.id]);
    assert.deepEqual(savedIds("user-b"), [], "the legacy flag never leaks to other users");
    call("place-save", "user-a", { id: place.id, unsave: true });
    assert.deepEqual(savedIds("user-a"), [], "the contributor can still unsave a legacy row");
  });

  it("deleting a place purges it from every user's save relation", () => {
    const place = addPlace("user-a");
    call("place-save", "user-b", { id: place.id });
    call("place-delete", "user-a", { id: place.id });
    assert.deepEqual(savedIds("user-b"), []);
    const rel = globalThis._concordSTATE.travelLens.savedPlaces.get("user-b") || [];
    assert.ok(!rel.includes(place.id), "no dangling id left in the relation");
  });
});
