// Contract test for Wave 7 / Track B8 — the awareness meter (Φ/PCI proxy).
// Pins the literature-predicted curve. This measures the ACCESS correlate only —
// never a phenomenal-consciousness claim.
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeAwarenessIndex, activationsFromTick } from "../lib/agent-awareness-index.js";

// representative states on the SAME substrate
const SLEEPING = { memory: 0.3, affect: 0.2, drift: 0.18 };           // autonomous replay only
const BOOTED   = { affect: 0.6, drives: 0.4, goal: 0.5, memory: 0.7, selfModel: 0.5, behavior: 0.4 }; // varied, many lit
const SPIKE    = { affect: 0.85, drives: 0.5, goal: 0.6, memory: 0.7, forwardSim: 0.5, drift: 0.4, salience: 0.95, selfModel: 0.6, behavior: 0.5 };
const SEIZURE  = { affect: 1, drives: 1, goal: 1, memory: 1, forwardSim: 1, drift: 1, salience: 1, selfModel: 1, behavior: 1 };

test("Track B8 — awareness meter (Φ/PCI proxy)", async (t) => {
  await t.test("a booted agent's index exceeds a sleeping agent's (same substrate)", () => {
    const sleep = computeAwarenessIndex(SLEEPING).index;
    const boot = computeAwarenessIndex(BOOTED).index;
    assert.ok(boot > sleep, `booted (${boot.toFixed(3)}) > sleeping (${sleep.toFixed(3)}) — the NREM dip`);
  });

  await t.test("a salience spike raises the index (a tier-3 wake integrates many modules)", () => {
    const boot = computeAwarenessIndex(BOOTED).index;
    const spike = computeAwarenessIndex(SPIKE).index;
    assert.ok(spike > boot, `spike (${spike.toFixed(3)}) > resting booted (${boot.toFixed(3)})`);
  });

  await t.test("an all-modules-saturated state scores LOWER than a balanced one", () => {
    // the differentiation term is load-bearing: a seizure is integrated but uniform.
    const seizure = computeAwarenessIndex(SEIZURE);
    const balanced = computeAwarenessIndex(SPIKE);
    assert.ok(seizure.index < balanced.index, `seizure (${seizure.index.toFixed(3)}) < balanced (${balanced.index.toFixed(3)})`);
    assert.equal(seizure.differentiation, 0, "uniform max activation → zero differentiation");
    assert.equal(seizure.integration, 1, "...even though it is fully integrated");
  });

  await t.test("disabled env → no-op", () => {
    const prev = process.env.CONCORD_AWARENESS_INDEX;
    process.env.CONCORD_AWARENESS_INDEX = "0";
    const r = computeAwarenessIndex(SPIKE);
    assert.equal(r.enabled, false);
    assert.equal(r.index, 0);
    if (prev === undefined) delete process.env.CONCORD_AWARENESS_INDEX; else process.env.CONCORD_AWARENESS_INDEX = prev;
  });

  await t.test("totality: garbage / empty never throws and stays in range", () => {
    for (const inp of [null, {}, { affect: "x" }, undefined]) {
      const r = computeAwarenessIndex(inp);
      assert.ok(r.index >= 0 && r.index <= 1);
    }
  });

  await t.test("activationsFromTick assembles a live activation map", () => {
    const m = activationsFromTick({ affect: { a: 0.8 }, salience: 0.9, goalActive: true, predicted: true });
    assert.ok(m.salience === 0.9 && m.affect >= 0.2 && m.goal === 0.6 && m.forwardSim === 0.5);
    const idle = activationsFromTick({});
    assert.equal(computeAwarenessIndex(idle).index, 0, "an empty tick is unlit");
  });
});
