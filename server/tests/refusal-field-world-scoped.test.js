// Phase K invariant pin — refusal-field entries are world-scoped.
//
// applyTemporaryRefusal(state, worldId, kind, opts) writes into a Map keyed
// by worldId. Two worlds with the same kind must not leak strength or
// time-bounded blocks into each other.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { applyTemporaryRefusal, computeFieldComposition, isRefused } from "../lib/refusal-field.js";

describe("refusal-field world scoping invariant", () => {
  it("applying death_suspended in world A does not refuse in world B", () => {
    const state = { refusalFields: new Map() };
    applyTemporaryRefusal(state, "world-a", "death_suspended", { durationMs: 60_000 });
    assert.equal(isRefused(state, "world-a", "death_suspended"), true);
    assert.equal(isRefused(state, "world-b", "death_suspended"), false);
  });

  it("compound-refusal strength in world A does not raise world B's strength", () => {
    const state = { refusalFields: new Map() };
    applyTemporaryRefusal(state, "world-a", "death_suspended", { durationMs: 60_000 });
    applyTemporaryRefusal(state, "world-a", "harvest_disabled", { durationMs: 60_000 });
    applyTemporaryRefusal(state, "world-a", "hostility_blocked", { durationMs: 60_000 });
    const compA = computeFieldComposition(state, "world-a");
    const compB = computeFieldComposition(state, "world-b");
    assert.ok(compA.strength > compB.strength, "world-a should have higher strength than world-b");
    assert.equal(compB.strength, 0);
  });

  it("entries in different worlds maintain independent expiry buckets", () => {
    const state = { refusalFields: new Map() };
    applyTemporaryRefusal(state, "world-a", "death_suspended", { durationMs: 60_000 });
    applyTemporaryRefusal(state, "world-b", "death_suspended", { durationMs: 60_000 });
    // The two worlds are tracked in different Map keys — modifying one
    // (e.g. clearing world-a) leaves world-b intact. Re-using the Map
    // keys for both worlds would have broken the per-world ledger.
    state.refusalFields.set("world-a", []);
    assert.equal(isRefused(state, "world-a", "death_suspended"), false);
    assert.equal(isRefused(state, "world-b", "death_suspended"), true);
  });
});
