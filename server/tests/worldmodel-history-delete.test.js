// FIX-entity-010 — registry snapshots and simulation history runs can
// be deleted. The worldmodel actions the Entity lens uses live inline
// in server.js, which boots the whole server on import, so — mirroring
// macro-acl-human-gate.test.js — wiring is asserted from source: both
// delete actions must be registered non-public (same posture as the
// snapshot/simulate creates), look the record up by id, refuse unknown
// ids, mutate the real store, and persist.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const source = readFileSync(path.resolve(import.meta.dirname, "../server.js"), "utf-8");

function actionBlock(name) {
  const start = source.indexOf(`register("worldmodel", "${name}"`);
  assert.ok(start >= 0, `worldmodel.${name} is registered`);
  return source.slice(start, start + 900);
}

describe("worldmodel history deletes (FIX-entity-010)", () => {
  it("delete_snapshot splices the caller's snapshot out of the store", () => {
    const block = actionBlock("delete_snapshot");
    assert.match(block, /snapshots\.findIndex/);
    assert.match(block, /snapshots\.splice\(idx, 1\)/);
    assert.match(block, /Snapshot not found/);
    assert.match(block, /saveStateDebounced\(\)/);
    assert.match(block, /\{ public: false \}/);
  });

  it("delete_simulation removes the run from the simulations map", () => {
    const block = actionBlock("delete_simulation");
    assert.match(block, /simulations\.has\(simId\)/);
    assert.match(block, /simulations\.delete\(simId\)/);
    assert.match(block, /Simulation not found/);
    assert.match(block, /saveStateDebounced\(\)/);
    assert.match(block, /\{ public: false \}/);
  });
});
