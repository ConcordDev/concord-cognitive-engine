// Arrangement Sketch backing (CB-0056 / F14): section markers carry an optional length and can be
// updated in place, so a sketch can be re-ordered and resized without delete+recreate.
import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerActions from "../domains/studio.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`studio.${name}`);
  if (!fn) throw new Error(`studio.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}
before(() => { registerActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});
const ctxA = { actor: { userId: "u" }, userId: "u" };
const ctxB = { actor: { userId: "v" }, userId: "v" };

function project(ctx = ctxA) { return call("project-create", ctx, { name: "Arr", bpm: 120 }).result.project; }

describe("studio.markers-add lengthBeats", () => {
  it("stores a section's length; absent length stays absent (open-ended)", () => {
    const p = project();
    const a = call("markers-add", ctxA, { projectId: p.id, name: "Verse", kind: "section", timeBeats: 16, lengthBeats: 32 });
    const b = call("markers-add", ctxA, { projectId: p.id, name: "Chorus", kind: "section", timeBeats: 48 });
    assert.equal(a.result.marker.lengthBeats, 32);
    assert.equal("lengthBeats" in b.result.marker, false);
    const list = call("markers-list", ctxA, { projectId: p.id }).result.markers;
    assert.equal(list.find((m) => m.name === "Verse").lengthBeats, 32);
  });
  it("a negative or junk length clamps to 0, never NaN", () => {
    const p = project();
    assert.equal(call("markers-add", ctxA, { projectId: p.id, name: "x", timeBeats: 0, lengthBeats: -5 }).result.marker.lengthBeats, 0);
    assert.equal(call("markers-add", ctxA, { projectId: p.id, name: "y", timeBeats: 0, lengthBeats: "abc" }).result.marker.lengthBeats, 0);
  });
});

describe("studio.markers-update", () => {
  it("moves and resizes a marker in place and keeps list order by time", () => {
    const p = project();
    const intro = call("markers-add", ctxA, { projectId: p.id, name: "Intro", timeBeats: 0, lengthBeats: 16 }).result.marker;
    const verse = call("markers-add", ctxA, { projectId: p.id, name: "Verse", timeBeats: 16, lengthBeats: 32 }).result.marker;
    // swap: verse first
    assert.equal(call("markers-update", ctxA, { id: verse.id, timeBeats: 0, lengthBeats: 32 }).ok, true);
    assert.equal(call("markers-update", ctxA, { id: intro.id, timeBeats: 32 }).ok, true);
    const list = call("markers-list", ctxA, { projectId: p.id }).result.markers;
    assert.deepEqual(list.map((m) => m.name), ["Verse", "Intro"]);
    assert.equal(list[1].lengthBeats, 16, "fields not passed are untouched");
  });
  it("renames, recolours; refuses an empty name; clamps negatives", () => {
    const p = project();
    const m = call("markers-add", ctxA, { projectId: p.id, name: "Drop", timeBeats: 8 }).result.marker;
    const r = call("markers-update", ctxA, { id: m.id, name: "  Big Drop ", colour: "#ff0000", timeBeats: -3 });
    assert.equal(r.result.marker.name, "Big Drop");
    assert.equal(r.result.marker.colour, "#ff0000");
    assert.equal(r.result.marker.timeBeats, 0);
    const bad = call("markers-update", ctxA, { id: m.id, name: "   " });
    assert.equal(bad.ok, false);
  });
  it("unknown id, and another user's marker, are refused (owner-scoped)", () => {
    const p = project();
    const m = call("markers-add", ctxA, { projectId: p.id, name: "Mine", timeBeats: 0 }).result.marker;
    assert.equal(call("markers-update", ctxA, { id: "nope", name: "x" }).ok, false);
    const other = call("markers-update", ctxB, { id: m.id, name: "hijack" });
    assert.equal(other.ok, false);
    assert.equal(call("markers-list", ctxA, { projectId: p.id }).result.markers[0].name, "Mine");
  });
});
