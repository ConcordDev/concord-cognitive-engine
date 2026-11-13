// FIX-aviation-007 — the Dashboard's Flight Summary quick action targets
// a single flight record (hobbs start/end + fuel burn in its data), not a
// logbook artifact carrying a flights array. flightSummary read only
// data.flights, so the quick action always came back "no data" — and its
// no-data result lacked the fields the Action Result panel renders, so
// the panel opened empty. These tests pin the one-flight summary and
// the complete zero-state field set.
import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerAviationActions from "../domains/aviation.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }

function run(name, data = {}, { title } = {}) {
  const fn = ACTIONS.get(`aviation.${name}`);
  if (!fn) throw new Error(`aviation.${name} not registered`);
  const artifact = { id: "art_1", domain: "aviation", title: title ?? null, data, meta: {} };
  return fn({ actor: { userId: "u1" }, userId: "u1" }, artifact, {});
}

before(() => { registerAviationActions(register); });

beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
  globalThis.fetch = async () => { throw new Error("network disabled"); };
});

describe("aviation.flightSummary — bench targets (FIX-aviation-007)", () => {
  it("a single flight record summarizes as a one-flight summary", () => {
    const r = run("flightSummary", {
      date: "2026-11-02", departure: "KPOU", arrival: "KALB",
      hobbsStart: 1200.0, hobbsEnd: 1201.5, fuelBurn: 14,
    }, { title: "KPOU → KALB" });
    assert.equal(r.ok, true);
    assert.equal(r.result.totalFlights, 1);
    assert.equal(r.result.totalHours, 1.5);
    assert.equal(r.result.averageDuration, 1.5);
    assert.equal(r.result.longestFlight, 1.5);
    assert.equal(r.result.totalFuelConsumed, 14);
    assert.equal(typeof r.result.avgFuelPerHour, "number");
  });

  it("the no-data result carries every field the panel renders, plus its message", () => {
    const r = run("flightSummary", {});
    assert.equal(r.ok, true);
    assert.equal(r.result.totalFlights, 0);
    assert.equal(r.result.totalHours, 0);
    assert.equal(r.result.averageDuration, 0);
    assert.equal(r.result.longestFlight, 0);
    assert.equal(r.result.totalFuelConsumed, 0);
    assert.equal(r.result.avgFuelPerHour, 0);
    assert.equal(r.result.message, "No flight data available.");
  });

  it("the logbook shape still aggregates (control)", () => {
    const r = run("flightSummary", {
      flights: [
        { hobbsTime: 1.4, fuelUsed: 12 },
        { hobbsTime: 2.0, fuelUsed: 17 },
      ],
    }, { title: "J. Pilot" });
    assert.equal(r.result.totalFlights, 2);
    assert.equal(r.result.totalHours, 3.4);
    assert.equal(r.result.totalFuelConsumed, 29);
  });
});
