// FIX-observe-003 — a user can delete their own ingested metric series.
// Pins for observe.metricDelete:
//  1. Ingest points, delete the series: it leaves metricList, with the
//     removed point count reported.
//  2. Another user's series of the same name is untouched — the store
//     is per-user and delete only reaches the caller's own map.
//  3. An unknown metric name is refused.
import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerObserveActions from "../domains/observe.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`observe.${name}`);
  assert.ok(fn, `observe.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerObserveActions(register); });
beforeEach(() => { globalThis._concordSTATE = {}; });

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

describe("observe.metricDelete", () => {
  it("deletes the caller's series and reports the point count", () => {
    call("metricIngest", ctxA, { metric: "qa.metric", value: 1 });
    call("metricIngest", ctxA, { metric: "qa.metric", value: 2 });
    call("metricIngest", ctxA, { metric: "qa.other", value: 9 });
    const del = call("metricDelete", ctxA, { metric: "qa.metric" });
    assert.equal(del.ok, true);
    assert.equal(del.result.points, 2);
    const list = call("metricList", ctxA, {});
    assert.deepEqual(list.result.metrics.map((m) => m.name), ["qa.other"]);
  });

  it("cannot reach another user's series of the same name", () => {
    call("metricIngest", ctxB, { metric: "qa.metric", value: 5 });
    const del = call("metricDelete", ctxA, { metric: "qa.metric" });
    assert.equal(del.ok, false);
    assert.equal(call("metricList", ctxB, {}).result.metrics.length, 1);
  });

  it("refuses an unknown metric name", () => {
    const del = call("metricDelete", ctxA, { metric: "nope" });
    assert.equal(del.ok, false);
    assert.match(del.error, /not found/);
  });
});
