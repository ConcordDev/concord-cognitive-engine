// Contract tests for the shared lens records substrate
// (server/lib/lens-substrate.js) and its wiring into the audit
// THIN-tier domains deepened in the depth pass.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { registerLensSubstrate } from "../lib/lens-substrate.js";
import registerOps from "../domains/ops.js";
import registerObserve from "../domains/observe.js";
import registerSettings from "../domains/settings.js";
import registerAll from "../domains/all.js";
import registerSupplychain from "../domains/supplychain.js";
import registerUrbanplanning from "../domains/urbanplanning.js";
import registerLawEnforcement from "../domains/lawenforcement.js";

beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

function registryFor(domain, registerFn) {
  const actions = new Map();
  registerFn((d, n, fn) => actions.set(`${d}.${n}`, fn));
  return (name, ctx, params = {}) => {
    const fn = actions.get(`${domain}.${name}`);
    assert.ok(fn, `${domain}.${name} not registered`);
    return fn(ctx, { id: null, data: {}, meta: {} }, params);
  };
}

describe("registerLensSubstrate — core contract", () => {
  it("adds / lists / updates / deletes records scoped per user", () => {
    const actions = new Map();
    registerLensSubstrate((d, n, fn) => actions.set(`${d}.${n}`, fn), "demo", {
      noun: "task", kinds: ["a", "b"], statuses: ["open", "done"],
    });
    const call = (n, ctx, p = {}) => actions.get(`demo.${n}`)(ctx, { data: {} }, p);
    const ua = { actor: { userId: "ua" } };
    const ub = { actor: { userId: "ub" } };

    const rec = call("record-add", ua, { title: "First", kind: "b", notes: "hello" }).result.record;
    assert.equal(rec.kind, "b");
    assert.equal(rec.status, "open");
    assert.equal(call("record-list", ua).result.count, 1);
    assert.equal(call("record-list", ub).result.count, 0);

    call("record-update", ua, { id: rec.id, status: "done" });
    assert.equal(call("record-list", ua, { status: "done" }).result.count, 1);
    assert.equal(call("record-list", ua, { status: "open" }).result.count, 0);

    const dash = call("record-dashboard", ua).result;
    assert.equal(dash.total, 1);
    assert.equal(dash.byStatus.done, 1);

    call("record-delete", ua, { id: rec.id });
    assert.equal(call("record-list", ua).result.count, 0);
  });

  it("rejects a titleless record and an unknown kind falls back", () => {
    const actions = new Map();
    registerLensSubstrate((d, n, fn) => actions.set(`${d}.${n}`, fn), "demo2", {
      noun: "item", kinds: ["x", "y"],
    });
    const call = (n, ctx, p = {}) => actions.get(`demo2.${n}`)(ctx, { data: {} }, p);
    const ua = { actor: { userId: "ua" } };
    assert.equal(call("record-add", ua, {}).ok, false);
    assert.equal(call("record-add", ua, { title: "T", kind: "zzz" }).result.record.kind, "x");
  });
});

describe("THIN-tier domains gained the substrate", () => {
  for (const [domain, registerFn] of [
    ["ops", registerOps],
    ["observe", registerObserve],
    ["settings", registerSettings],
    ["all", registerAll],
    ["supplychain", registerSupplychain],
    ["urban-planning", registerUrbanplanning],
    ["law-enforcement", registerLawEnforcement],
  ]) {
    it(`${domain} — record substrate is wired and round-trips`, () => {
      const call = registryFor(domain, registerFn);
      const ctx = { actor: { userId: "u1" } };
      const rec = call("record-add", ctx, { title: `${domain} entry` }).result.record;
      assert.ok(rec.id);
      assert.equal(call("record-list", ctx).result.count, 1);
      assert.equal(call("record-dashboard", ctx).result.total, 1);
      call("record-delete", ctx, { id: rec.id });
      assert.equal(call("record-list", ctx).result.count, 0);
    });
  }
});
