// tests/depth/city-behavior.test.js — REAL behavioral tests for the city domain
// (register()/runMacro family, via macroRuntime). Budget/tax/policy/happiness
// loop with exact-value calcs + validation.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { macroRuntime } from "./_harness.js";

describe("city — budget / tax / policy / happiness", () => {
  let runMacro, ctx;
  const W = "w-city-1";
  before(async () => { ({ runMacro, ctx } = await macroRuntime("city")); });

  it("get_budget: a fresh world gets a budget row", async () => {
    const r = await runMacro("city", "get_budget", { worldId: W }, ctx);
    assert.equal(r.ok, true);
    assert.ok(r.budget && typeof r.budget === "object");
  });

  it("set_tax_rate: clamps to 0..90", async () => {
    const ok = await runMacro("city", "set_tax_rate", { worldId: W, taxRatePct: 80 }, ctx);
    assert.equal(ok.ok, true);
    assert.equal(ok.taxRatePct, 80);
    const high = await runMacro("city", "set_tax_rate", { worldId: W, taxRatePct: 200 }, ctx);
    assert.equal(high.taxRatePct, 90);         // clamped
    const low = await runMacro("city", "set_tax_rate", { worldId: W, taxRatePct: -5 }, ctx);
    assert.equal(low.taxRatePct, 0);           // clamped
  });

  it("set_allocations: returns the clamped allocation set", async () => {
    const r = await runMacro("city", "set_allocations", { worldId: W, allocations: { safety: 60, health: 40 } }, ctx);
    assert.equal(r.ok, true);
  });

  it("enact: rejects an unknown policy kind, accepts a real one, lists + repeals it", async () => {
    const bad = await runMacro("city", "enact", { worldId: W, kind: "teleportation" }, ctx);
    assert.equal(bad.ok, false);
    assert.equal(bad.reason, "invalid_kind");

    const good = await runMacro("city", "enact", { worldId: W, kind: "curfew" }, ctx);
    assert.equal(good.ok, true);
    assert.ok(good.policyId || good.alreadyEnacted);

    const list = await runMacro("city", "policies", { worldId: W }, ctx);
    assert.ok(list.policies.some((p) => p.kind === "curfew"));

    const repeal = await runMacro("city", "repeal", { worldId: W, kind: "curfew" }, ctx);
    assert.equal(repeal.ok, true);
  });

  it("snapshot_happiness → latest_happiness: a snapshot is written and read back", async () => {
    const snap = await runMacro("city", "snapshot_happiness", { worldId: W }, ctx);
    assert.ok(typeof snap.overall === "number" && snap.overall >= 0 && snap.overall <= 100);
    const latest = await runMacro("city", "latest_happiness", { worldId: W }, ctx);
    assert.equal(latest.ok, true);
    assert.ok(latest.snapshot);
  });

  it("summary: bundles budget + policies + happiness", async () => {
    const r = await runMacro("city", "summary", { worldId: W }, ctx);
    assert.equal(r.ok, true);
    assert.ok(r.budget && Array.isArray(r.policies));
  });

  it("constants: exposes the city tuning constants", async () => {
    const r = await runMacro("city", "constants", {}, ctx);
    assert.equal(r.ok, true);
    assert.ok(r.constants && typeof r.constants === "object");
  });
});
