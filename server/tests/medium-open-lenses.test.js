import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerPersonas from "../domains/personas.js";
import registerEco from "../domains/eco.js";
import registerConstruction from "../domains/construction.js";

const actions = new Map();
function register(domain, name, fn) { actions.set(`${domain}.${name}`, fn); }
const ctx = { actor: { userId: "ada" }, userId: "ada" };
function call(domain, name, params) {
  return actions.get(`${domain}.${name}`)(ctx, { id: null, data: params, meta: {} }, params);
}

before(() => {
  registerPersonas(register);
  registerEco(register);
  registerConstruction(register);
});
beforeEach(() => {
  globalThis._concordSTATE = {};
  globalThis._concordSaveStateDebounced = () => {};
});

describe("open-lens mediums refuse bad input", () => {
  it("refuses an over-long persona field and a short tag", () => {
    const long = call("personas", "create", { name: "Ada", tagline: "x".repeat(141) });
    assert.equal(long.ok, false);
    assert.match(long.message, /140/);
    const tag = call("personas", "create", { name: "Ada", tags: "a, maps" });
    assert.equal(tag.ok, false);
    assert.match(tag.message, /2 to 24/);
    const ok = call("personas", "create", { name: "Ada", tagline: "cartographer", tags: "maps, guide" });
    assert.equal(ok.ok, true);
    assert.deepEqual(ok.result.persona.tags, ["maps", "guide"]);
  });

  it("refuses a location outside the map and a long label", () => {
    const bad = call("eco", "locations-save", { label: "Site", lat: 999, lng: 0 });
    assert.equal(bad.ok, false);
    assert.match(bad.message, /Latitude/);
    const huge = call("eco", "locations-save", { label: "x".repeat(81), lat: 40, lng: -70 });
    assert.equal(huge.ok, false);
    assert.match(huge.message, /80/);
    const ok = call("eco", "locations-save", { label: "Site", lat: 40, lng: -70 });
    assert.equal(ok.ok, true);
  });

  it("refuses an ESG score outside 0 to 100", () => {
    const r = call("eco", "sustainabilityScore", { indicators: { environmental: { emissions: -1 } } });
    assert.equal(r.ok, false);
    assert.match(r.message, /0 to 100/);
  });

  it("refuses a negative change order, budget, and crew count", () => {
    const co = call("construction", "changeorder-create", { title: "Credit", amount: -5 });
    assert.equal(co.ok, false);
    assert.match(co.message, /Amount/);
    const budget = call("construction", "budget-add", { costCode: "03", description: "Concrete", budgetAmount: -1 });
    assert.equal(budget.ok, false);
    const crew = call("construction", "dailylog-create", { date: "2026-11-10", manpower: [{ workers: -1, hours: 8 }] });
    assert.equal(crew.ok, false);
    assert.match(crew.message, /Workers/);
  });
});
