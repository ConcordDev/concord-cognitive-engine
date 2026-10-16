// server/tests/conkay-chat-orchestrator.test.js
//
// The orchestrator core (lib/conkay/chat/orchestrator.js) against a synthetic evaluator whose physics is a closed
// form, so every decision can be checked by hand:
//   a rectangular cantilever of width b, depth h, length L under tip load P: σ = 6 P L / (b h²) (Roark, beam table:
//   M = P L at the root, c = h/2, I = b h³/12), deflection δ = 4 P L³ / (E b h³) (= P L³ / 3 E I).
//   Checks: stress σ ≤ 100 MPa, deflection δ ≤ 5 mm; mass m = ρ b h L.
// Then the car adapter end to end (OCC kernel, long) is in tests/conkay-chat-orchestrator-car.test.js.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { orchestrate } from "../lib/conkay/chat/orchestrator.js";
import { sha256 } from "../lib/conkay/iterate/receipt.js";

const P = 1000, L = 0.5, b = 0.04, E = 70e9, RHO = 2700;
const sigma = (h) => (6 * P * L) / (b * h * h);
const delta = (h) => (4 * P * L ** 3) / (E * b * h ** 3);
const envelope = (runId, demand, capacity) => ({ runId, status: demand <= capacity ? "PASS" : "FAIL", margins: [{ check: runId, demand, capacity, utilization: demand / capacity }], provenance: { inputHash: sha256([runId, demand]) } });

function evaluator({ sMax = 100e6, dMax = 0.005, req = "r1", extraFail = null } = {}) {
  let calls = 0;
  const fn = async (state) => {
    calls++;
    const envs = new Map([
      ["stress@ARM", envelope("stress@ARM", sigma(state.h), sMax)],
      ["deflection@ARM", envelope("deflection@ARM", delta(state.h), dMax)],
    ]);
    if (extraFail && extraFail(state)) envs.set("clearance@ARM", { runId: "clearance@ARM", status: "FAIL", margins: [{ utilization: 1.2 }], provenance: { inputHash: "x" } });
    else envs.set("clearance@ARM", { runId: "clearance@ARM", status: "PASS", margins: [{ utilization: 0.5 }], provenance: { inputHash: "x" } });
    return { envelopes: envs, report: {}, massKg: RHO * b * state.h * L, requirementsHash: sha256(req), designHash: sha256(state) };
  };
  fn.calls = () => calls;
  return fn;
}

const depthRule = (max = 0.06) => ({
  id: "arm.depth", checks: ["stress@ARM", "deflection@ARM"], variable: "h", cite: "test rule: deepen the section 5 mm at a time",
  applies: (ctx) => ["stress@ARM", "deflection@ARM"].some((id) => ctx.envelopes.get(id)?.status === "FAIL"),
  candidates: (ctx) => { const out = []; for (let v = ctx.state.h + 0.005; v <= max + 1e-9; v += 0.005) out.push({ value: Math.round(v * 1e6) / 1e6, label: `h -> ${Math.round(v * 1e3)} mm` }); return out; },
  atBound: () => `the section is at its ${max * 1000} mm bound`,
});

describe("orchestrate: the smallest change that clears the failing checks", () => {
  it("deepens the arm to the first 5 mm step that passes both checks (deflection governs: h ≥ 32.9 mm)", async () => {
    // σ(h) = 6 P L / (b h²) ≤ 100 MPa -> h ≥ sqrt(6·1000·0.5 / (0.04·1e8)) = 27.4 mm
    // δ(h) = 4 P L³ / (E b h³) ≤ 5 mm -> h ≥ cbrt(4·1000·0.125 / (70e9·0.04·0.005)) = 32.9 mm  (governs)
    const ev = evaluator();
    const r = await orchestrate({ evaluate: ev, rules: [depthRule()], initialState: { h: 0.015 } });
    assert.equal(r.outcome.kind, "all-pass");
    assert.equal(r.state.h, 0.035);
    assert.ok(delta(0.035) <= 0.005 && delta(0.03) > 0.005 && sigma(0.03) <= 100e6, "30 mm passes stress (83.3 MPa) but deflects 6.6 mm");
    assert.equal(r.log.length, 1);
    const it1 = r.log[0];
    assert.deepEqual(it1.failing, ["deflection@ARM", "stress@ARM"]);
    assert.deepEqual(it1.chosen.value, 0.035);
    assert.match(it1.chosen.reason, /clears deflection@ARM, stress@ARM/);
    // each tried value was a real rerun; the sensitivity is d(util)/dh from those runs
    assert.deepEqual(it1.candidates.map((c) => c.value), [0.02, 0.025, 0.03, 0.035]);
    for (const c of it1.candidates) assert.ok(c.sensitivity > 0 && Number.isFinite(c.dMassKg));
  });
  it("is deterministic: the same inputs give the same receipt hash", async () => {
    const a = await orchestrate({ evaluate: evaluator(), rules: [depthRule()], initialState: { h: 0.015 } });
    const b2 = await orchestrate({ evaluate: evaluator(), rules: [depthRule()], initialState: { h: 0.015 } });
    assert.equal(a.receiptSha256, b2.receiptSha256);
  });
});

describe("orchestrate: stopping honestly", () => {
  it("proven infeasible when the variable runs out: names the binding variable and offers (never applies) a requirement change", async () => {
    const r = await orchestrate({ evaluate: evaluator({ sMax: 10e6 }), rules: [depthRule(0.04)], initialState: { h: 0.015 } });
    // with σ ≤ 10 MPa, h ≥ 86.6 mm, past the 40 mm bound: the best it can do is 40 mm, still failing
    assert.equal(r.outcome.kind, "proven-infeasible");
    assert.ok(r.outcome.binding.some((x) => x.variable === "h" && /40 mm bound/.test(x.why)));
    assert.equal(r.state.h, 0.04);
  });
  it("a candidate that newly fails another check is never taken", async () => {
    const r = await orchestrate({ evaluate: evaluator({ extraFail: (s) => s.h > 0.022 }), rules: [depthRule()], initialState: { h: 0.015 } });
    // 20 mm improves but does not clear; every deeper step breaks the clearance check
    assert.equal(r.state.h, 0.02);
    assert.equal(r.outcome.kind, "proven-infeasible");
    assert.ok(r.outcome.binding.some((x) => /would newly fail clearance@ARM/.test(x.why)));
  });
  it("the iteration budget stops it and says so", async () => {
    const stepRule = { ...depthRule(), candidates: (ctx) => [{ value: Math.round((ctx.state.h + 0.002) * 1e6) / 1e6, label: "h + 2 mm" }] };
    const r = await orchestrate({ evaluate: evaluator(), rules: [stepRule], initialState: { h: 0.015 }, budget: { iterations: 2 } });
    assert.equal(r.outcome.kind, "iteration-budget");
    assert.equal(r.log.length, 2);
  });
  it("a changed requirement aborts the run", async () => {
    let n = 0;
    const ev = async (s) => ({ ...(await evaluator()(s)), requirementsHash: sha256(n++ === 0 ? "r1" : "r2") });
    await assert.rejects(orchestrate({ evaluate: ev, rules: [depthRule()], initialState: { h: 0.015 } }), /changed a requirement/);
  });
});

describe("orchestrate: the language model may only pick among the top computed candidates", () => {
  const twoRules = [
    depthRule(),
    { id: "arm.width", checks: ["stress@ARM"], variable: "h", cite: "test", applies: () => true, candidates: (ctx) => [{ value: Math.round((ctx.state.h + 0.02) * 1e6) / 1e6, label: "h + 20 mm (heavier)" }], atBound: () => "" },
  ];
  it("a pick among the top three is taken, with its explanation", async () => {
    const r = await orchestrate({ evaluate: evaluator(), rules: twoRules, initialState: { h: 0.015 }, pick: (top) => ({ rule: top[top.length - 1].rule, value: top[top.length - 1].value, why: "the user prefers margin" }) });
    assert.equal(r.log[0].chosen.pickNote, "the user prefers margin");
  });
  it("a pick that is not a computed candidate (an invented value) is ignored", async () => {
    const r = await orchestrate({ evaluate: evaluator(), rules: twoRules, initialState: { h: 0.015 }, pick: () => ({ rule: "arm.depth", value: 0.0275, why: "looks right" }) });
    assert.equal(r.log[0].chosen.value, 0.035);
    assert.match(r.log[0].chosen.pickNote, /not one of the top computed candidates/);
  });
});
