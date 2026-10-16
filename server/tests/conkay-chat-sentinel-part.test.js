// server/tests/conkay-chat-sentinel-part.test.js
//
// A Sentinel M1 part via chat (conversational-loop item 7, stretch): "design the knee actuator bracket for M1 at the
// gait-cycle peak torque". The load is computed through the chain (the M1 loop's accepted design -> its mass budget
// -> the quasi-static gait -> the knee's conservative peak), never typed; the part is the design's own actuator side
// plates; the check is the in-plane bending of a plate with an end moment (σ = 6 M / (t h²), Roark Table 8.1), here
// derived by hand; the frame FE agrees; the deep-plate validity limit is flagged; the stall case is listed; armor
// stays off M1.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ChatSession } from "../lib/conkay/chat/session.js";
import { sentinelJointLoad, sentinelMountPlates, solveSentinelBracket } from "../lib/conkay/chat/sentinel-part.js";
import { quasiStaticGait } from "../lib/conkay/sentinel/gait.js";
import { getMaterial } from "../lib/conkay/materials/index.js";

const near = (a, b, rel = 1e-9, msg = "") => assert.ok(Math.abs(a - b) <= rel * Math.abs(b), `${msg} ${a} vs ${b}`);

describe("the load is computed from the M1 design, never typed", () => {
  it("the M1 loop's accepted design (13S5P, 1\" bracket tube) -> mass 60.68 kg -> the knee's conservative gait peak", () => {
    const l = sentinelJointLoad("knee");
    assert.equal(l.ok, true);
    assert.deepEqual(l.receipt.m1.design, { batteryParallel: 5, bracket: "sq-1x0.065" });
    near(l.receipt.m1.massKg, 60.68183650402279, 1e-12, "mass");
    // the same gait call on that mass: the load is that solver's output
    const g = quasiStaticGait({ massKg: l.receipt.m1.massKg, massLowKg: l.receipt.m1.massLowKg, massHighKg: l.receipt.m1.massHighKg });
    assert.equal(l.torqueNm, g.margins.knee.peak.demandNm.high);
    assert.ok(l.torqueNm > 75 && l.torqueNm < 77);
    assert.equal(sentinelJointLoad("elbow").ok, false);
  });
});

describe("the knee actuator bracket via chat (one turn)", () => {
  const s = new ChatSession();
  const r = s.ask("design the knee actuator bracket for M1 at the gait-cycle peak torque");
  const a = r.answer;
  it("answers in one turn on the design's side plates, unchanged: they hold with margin", () => {
    assert.equal(r.kind, "answer");
    assert.equal(r.turn, 1);
    const p = sentinelMountPlates("knee");
    assert.deepEqual(p.ids, ["mount-knee-la", "mount-knee-lb"]);
    assert.equal(a.thicknessM, 0.006);
    assert.equal(a.changed, false);
  });
  it("σ = 6 (T/2) / (t h²), by hand, and the frame FE agrees", () => {
    const T = a.load.torqueNm, t = 0.006, h = 0.1;
    near(a.hand.sigmaPa, (6 * (T / 2)) / (t * h * h), 1e-9, "σ");
    const Fy = getMaterial("aluminum-6061-t6-b221").yieldPa;
    near(a.hand.allowablePa, Fy / 2, 1e-12, "allowable at M1's factor of 2");
    assert.match(a.hand.safetyFactorSource, /M1's stated rule/);
    assert.deepEqual(a.fe.agrees, { sigma: true, delta: true });
  });
  it("the deep plate is flagged screening-only; the stall case is listed; what is not checked is named; armor off", () => {
    assert.equal(a.validity.valid, false);
    assert.match(a.validity.note, /beam theory is not a model of it/);
    assert.equal(a.stall.torqueNm, 120);
    near(a.stall.sigmaPa, (6 * 60) / (0.006 * 0.01), 1e-9, "stall σ");
    assert.ok(a.notChecked.some((x) => /bolt bearing/.test(x)) && a.notChecked.some((x) => /fatigue/.test(x)));
    assert.match(a.armor, /off/);
  });
});

describe("iteration and refusals", () => {
  it("when the design's plate fails, the thickness steps up R10 until it holds (never down)", () => {
    // at a safety factor of 80 the allowable is F_y / 80 = 3.016 MPa; σ = 6 (T/2) / (t h²):
    // 6 mm -> 3.79 MPa (fails), 6.3 mm (the next R10) -> 3.61 MPa (fails), 8 mm -> 2.845 MPa (holds)
    const r = solveSentinelBracket({ joint: "knee", safetyFactor: 80 });
    const T = r.load.torqueNm;
    const sigma = (t) => (6 * (T / 2)) / (t * 0.01);
    assert.ok(sigma(0.006) > r.hand.allowablePa && sigma(0.0063) > r.hand.allowablePa && sigma(0.008) <= r.hand.allowablePa);
    assert.deepEqual(r.iterations.map((i) => i.thicknessM), [0.006, 0.0063, 0.008]);
    assert.equal(r.thicknessM, 0.008);
    assert.equal(r.changed, true);
    assert.deepEqual(r.iterations.map((i) => i.thicknessM), r.iterations.map((i) => i.thicknessM).sort((x, y) => x - y), "only up");
    assert.equal(r.iterations[0].thicknessM, 0.006);
    assert.equal(r.iterations[0].result, "over the allowable");
    assert.ok(sigma(r.thicknessM) <= r.hand.allowablePa);
    assert.ok(r.iterations.slice(0, -1).every((i) => i.utilization > 1));
  });
  it("armor is refused; no joint is a question", () => {
    const armor = new ChatSession().ask("add armor to the M1 knee actuator bracket at the gait peak");
    assert.equal(armor.kind, "refused");
    assert.match(armor.errors[0].error, /armor stays off Sentinel M1/);
    const q = new ChatSession().ask("a bracket for Sentinel M1");
    assert.equal(q.kind, "questions");
    assert.ok(q.questions.some((x) => x.field === "joint"));
  });
});
