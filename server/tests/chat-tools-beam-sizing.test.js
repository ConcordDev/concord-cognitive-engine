// Brief D item 1: conkay_design sizes a beam section instead of assuming one.
// Footbridge case: 4 m simply supported, 10 kN at midspan, 60 mm wide, SF 2,
// deflection span/360, R10 depths. Strength alone gives 100 mm; deflection
// governs at 125 mm (A36) and 160 mm (6061-T6).
import test from "node:test";
import assert from "node:assert/strict";
import { executeToolCall } from "../lib/chat-agent.js";
import { parseChatBrief } from "../lib/conkay/chat/brief-parser.js";
import { solveBeam } from "../lib/conkay/chat/structures.js";

const text = (mat) => `simply supported ${mat} beam, 4 m span, 10 kN at midspan, 60 mm wide, safety factor 2, deflection limit span/360, find depth using R10 preferred sizes`;
const run = (t) => executeToolCall({}, () => null, new Map(), { tool: "conkay_design", params: { text: t } });

test("parser reads span/360 as a deflection limit", () => {
  for (const t of ["deflection limit span/360", "check L/360", "span / 360"]) {
    const p = parseChatBrief(`simply supported steel beam 4 m, 10 kN at midspan, 60 mm wide, ${t}`);
    assert.equal(p.ir.deflectionLimit, 360, t);
  }
  assert.equal(parseChatBrief("simply supported steel beam 4 m, 10 kN at midspan, 60 mm wide").ir.deflectionLimit, null);
});

test("strength only: 100 mm, strength governs", () => {
  const p = parseChatBrief("simply supported A36 steel beam, 4 m span, 10 kN at midspan, 60 mm wide, safety factor 2");
  const b = solveBeam(p.ir);
  assert.equal(b.section.depthM, 0.1);
  assert.ok(Math.abs(b.hand.sigmaPa - 100e6) < 1e3);
  assert.ok(Math.abs(b.maxMoment.value - 10000) < 1e-6);
});

test("chat tool sizes A36 to 125 mm with deflection governing", async () => {
  const r = await run(text("A36 steel"));
  assert.equal(r.ok, true);
  assert.equal(r.key, "conkay_design.beam-size");
  assert.equal(r.result.depthMm, 125);
  assert.equal(r.result.governs, "deflection");
  assert.equal(r.result.sizing.strengthDepthM, 0.1);
  assert.equal(r.result.pass, true);
  assert.equal(r.result.fe.agrees.delta, true);
  assert.ok(!/assumed/i.test(JSON.stringify(r.result)), "no assumed section");
});

test("chat tool sizes 6061-T6 to 160 mm with deflection governing", async () => {
  const r = await run(text("6061-T6 aluminium"));
  assert.equal(r.ok, true);
  assert.equal(r.result.depthMm, 160);
  assert.equal(r.result.governs, "deflection");
});

test("a given depth is checked, not resized: 100 mm fails span/360", () => {
  const p = parseChatBrief("simply supported A36 steel beam, 4 m span, 10 kN at midspan, 60 mm wide, 100 mm deep, safety factor 2, deflection limit span/360");
  const b = solveBeam(p.ir);
  assert.equal(b.deflectionCheck.pass, false);
  assert.equal(b.pass, false);
  assert.equal(b.governs, "deflection");
});

test("a part with no width still falls through to the legacy solver", async () => {
  const r = await run("steel cantilever beam 2 m long, 10 kN at the tip, safety factor of 2");
  assert.equal(r.ok, true);
  assert.notEqual(r.key, "conkay_design.beam-size");
});

test("a beam ask with no span, load or section asks for inputs instead of designing (live harness case edge.missing-inputs)", async () => {
  const r = await run("Size the beam.");
  assert.equal(r.ok, false);
  assert.equal(r.key, "conkay_design.needs-inputs");
  assert.ok(r.result.missing.length >= 3);
  const some = await run("size a steel beam, 4 m span");
  assert.notEqual(some.key, "conkay_design.needs-inputs", "any real input keeps the existing path");
});

test("a footbridge beam brief is a beam, not a truss (live harness case normal.beam-footbridge)", async () => {
  const { detectDomain } = await import("../lib/conkay/chat/brief-parser.js");
  const t = "Size a simply supported A36 steel footbridge beam: 4 m span, 10 kN at midspan, 60 mm wide, safety factor 2, deflection limit span/360, use R10 preferred depths.";
  assert.equal(detectDomain(t), "beam");
  assert.equal(detectDomain("a bridge girder 12 m long"), "beam");
  assert.equal(detectDomain("design a footbridge 12 m long"), "truss", "a plain footbridge stays a truss");
  assert.equal(detectDomain("pratt truss footbridge, simply supported beam ends"), "truss", "an explicit truss stays a truss");
  const p = parseChatBrief(t);
  const { solveBeam } = await import("../lib/conkay/chat/structures.js");
  const beam = solveBeam(p.ir);
  assert.equal(Math.round(beam.section.depthM * 1000), 125);
  assert.equal(beam.governs, "deflection");
});
