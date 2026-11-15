import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { authoredTaxonomy } from "../lib/species-taxonomy.js";
import registerCreatures from "../domains/creatures.js";
import registerFitness from "../domains/fitness.js";

const actions = new Map();
function register(domain, name, fn) { actions.set(`${domain}.${name}`, fn); }
function call(domain, name, ctx, params = {}) {
  const fn = actions.get(`${domain}.${name}`);
  assert.ok(fn, `${domain}.${name}`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}
const owner = { actor: { userId: "owner" }, userId: "owner" };
const other = { actor: { userId: "other" }, userId: "other" };

before(() => {
  registerCreatures(register);
  registerFitness(register);
});
beforeEach(() => {
  globalThis._concordSTATE = {};
  globalThis._concordSaveStateDebounced = () => {};
});

describe("highs round", () => {
  it("refuses a species id that is not in the authored catalog", async () => {
    assert.equal(authoredTaxonomy("not-a-real-species"), null);
    assert.equal(authoredTaxonomy("wolf").clade, "mammal");
    const missing = await actions.get("creatures.taxonomy")({}, { species_id: "not-a-real-species" });
    assert.equal(missing.ok, false);
    assert.equal(missing.reason, "unknown_species");
    const wolf = await actions.get("creatures.taxonomy")({}, { species_id: "wolf" });
    assert.equal(wolf.ok, true);
    assert.equal(wolf.taxonomy.topology, "quadruped");
  });

  it("hides beacon coordinates from someone who only holds the share token", () => {
    const start = call("fitness", "beacon-start", owner, { type: "run" });
    assert.ok(start.result.beacon.shareToken.length >= 20);
    const id = start.result.beacon.id;
    call("fitness", "beacon-ping", owner, { id, lat: 48.8, lon: 2.3 });
    const stranger = call("fitness", "beacon-status", other, { shareToken: start.result.beacon.shareToken });
    assert.equal(stranger.ok, true);
    assert.equal(stranger.result.beacon.position, null);
    assert.deepEqual(stranger.result.beacon.track, []);
    const mine = call("fitness", "beacon-status", owner, { id });
    assert.equal(mine.result.beacon.position.lat, 48.8);
  });
});
