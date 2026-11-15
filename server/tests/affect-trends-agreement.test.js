// affect-trends-agreement.test.js
//
// FIX-affect-003 premise check: after one saved check-in the walk saw
// history total 1 + streak + export, but Trends 'No mood data yet' and
// Activities empty. At branch state the three reads agree — in-process
// AND across the lens-state snapshot round-trip (serialize -> JSON ->
// hydrate). The prod divergence does not reproduce from branch code;
// this pin guards the agreement.
import { test } from "node:test";
import assert from "node:assert/strict";

globalThis._concordSTATE = {};
const { default: registerAffectActions } = await import("../domains/affect.js");
const actions = new Map();
registerAffectActions((domain, action, fn) => actions.set(`${domain}.${action}`, fn));
const ctx = { userId: "u1", actor: { userId: "u1" } };
const call = (name, params = {}) => actions.get(`affect.${name}`)(ctx, { id: null, data: {}, meta: {} }, params);

test("checkin -> trends/activities/history agree in-process", () => {
  const c = call("checkin", { mood: 4, activities: ["run"], note: "ok" });
  assert.equal(c.ok, true, JSON.stringify(c));
  const hist = call("checkinHistory", { limit: 60 });
  assert.equal(hist.result.totalCheckins, 1);
  const tr = call("trends", { granularity: "week" });
  const ac = call("activityCorrelation", { minSamples: 1 });
  assert.equal(tr.result.hasData, true);
  assert.equal(ac.result.hasData, true);
});

test("agreement survives the lens-state snapshot round-trip", async () => {
  const { serializeLensState, hydrateLensState } = await import("../lib/lens-state-persistence.js");
  const snapshot = serializeLensState(globalThis._concordSTATE);
  const wire = JSON.parse(JSON.stringify(snapshot));
  globalThis._concordSTATE = {};
  hydrateLensState(globalThis._concordSTATE, wire);
  const hist = call("checkinHistory", { limit: 60 });
  const tr = call("trends", { granularity: "week" });
  const ac = call("activityCorrelation", { minSamples: 1 });
  assert.equal(hist.result.totalCheckins, 1);
  assert.equal(tr.result.hasData, true);
  assert.equal(ac.result.hasData, true);
});
