// ConKay design: a stated safety factor is a pass/fail requirement with
// margin; the design solver is a real agent tool and lens action; an
// invented run_lens_action name is rejected with the real names.
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  parseSafetyFactor, solveDesignText, safetyCheck, summarizeDesignSolve,
} from "../lib/conkay/nlp-design-intent.js";
import { executeToolCall, parseToolCalls, TOOL_SCHEMA_BLOCK, formatToolResults, closestNames } from "../lib/chat-agent.js";
import registerConkayDesignActions from "../domains/conkay-design.js";

const BEAM = (kn, sf = "") => `Design a steel cantilever beam 2 m long carrying ${kn} kN at the tip${sf}`;

describe("parseSafetyFactor", () => {
  const cases = [
    ["with a safety factor of 2", 2], ["FoS 1.5", 1.5], ["SF=3", 3], ["SF ≥ 2.5", 2.5],
    ["factor of safety of 2.5", 2.5], ["a 2x safety factor", 2], ["safety factor of two", 2],
    ["safety factor: 1.67", 1.67], ["safety factor of at least 2", 2],
  ];
  for (const [t, v] of cases) it(`reads "${t}"`, () => assert.equal(parseSafetyFactor(t).value, v));
  it("ignores text with no safety factor", () => assert.equal(parseSafetyFactor("2 m beam, 10 kN").value, null));
  it("refuses an out-of-range value with a note", () => {
    const r = parseSafetyFactor("sf 50");
    assert.equal(r.value, null);
    assert.match(r.note, /between 1 and 20/);
  });
});

describe("solveDesignText enforces the stated safety factor", () => {
  it("passes with margin when achieved SF exceeds the requirement", () => {
    const r = solveDesignText(BEAM(10, " with a safety factor of 2"));
    assert.equal(r.intent.safetyFactor, 2);
    assert.equal(r.safety.pass, true);
    assert.equal(r.safety.requiredSafetyFactor, 2);
    assert.ok(r.safety.achievedSafetyFactor > 3 && r.safety.achievedSafetyFactor < 3.2);
    assert.ok(Math.abs(r.safety.marginPct - (r.safety.achievedSafetyFactor / 2 - 1) * 100) < 0.2);
    assert.match(r.safety.verdict, /^PASS: achieved SF 3\.1\d? vs required SF 2, margin \+5\d/);
  });

  it("fails a part that clears yield but misses SF 2 (the live-test bug)", () => {
    const withSf = solveDesignText(BEAM(20, " with a safety factor of 2"));
    const noSf = solveDesignText(BEAM(20));
    // Same stress either way: utilization vs yield is below 1.
    assert.ok(noSf.hand.utilization < 1);
    assert.equal(noSf.hand.allPass, true);
    // With SF 2 stated it must fail, everywhere it is reported.
    assert.equal(withSf.safety.pass, false);
    assert.equal(withSf.hand.allPass, false);
    assert.equal(withSf.fea.allPass, false);
    assert.ok(withSf.fea.utilizationAtSF > 1);
    assert.ok(withSf.safety.margin < 0);
    assert.match(withSf.safety.verdict, /^FAIL: achieved SF 1\.5\d? vs required SF 2, margin -2\d/);
  });

  it("with no safety factor, checks against yield and says so", () => {
    const r = solveDesignText(BEAM(10));
    assert.equal(r.intent.safetyFactor, null);
    assert.equal(r.safety.requiredSafetyFactor, 1);
    assert.equal(r.safety.stated, false);
    assert.ok(r.intent.assumptions.some((a) => /No safety factor stated/.test(a)));
  });

  it("does not read the safety factor as a dimension or load", () => {
    const a = solveDesignText(BEAM(10, " with a safety factor of 2"));
    const b = solveDesignText(BEAM(10));
    assert.deepEqual(a.intent.spans, b.intent.spans);
    assert.deepEqual(a.intent.loads, b.intent.loads);
    assert.equal(a.hand.maxStressPa, b.hand.maxStressPa);
  });

  it("safetyCheck with no stress result reports pass:null, never a guess", () => {
    const r = safetyCheck({ safetyFactor: 2, material: "steel-a36" }, { applicable: false }, { ok: false });
    assert.equal(r.pass, null);
    assert.equal(r.achievedSafetyFactor, null);
  });

  it("summary drops mesh arrays and keeps the verdict", () => {
    const s = summarizeDesignSolve(solveDesignText(BEAM(10, ", SF 2")));
    assert.equal(s.ok, true);
    assert.equal(s.mesh, undefined);
    assert.equal(s.pass, true);
    assert.ok(JSON.stringify(s).length < 6000);
  });
});

describe("conkay_design is a real tool and lens action", () => {
  it("is in the agent tool schema with a worked example", () => {
    assert.match(TOOL_SCHEMA_BLOCK, /- conkay_design: /);
    const calls = parseToolCalls('[TOOL_CALL: {"tool": "conkay_design", "params": {"text": "steel cantilever 2 m, 10 kN tip, safety factor of 2"}}]');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].tool, "conkay_design");
  });

  it("executeToolCall runs the solver and returns the safety verdict", async () => {
    const r = await executeToolCall({}, async () => { throw new Error("no macro"); }, new Map(), {
      tool: "conkay_design", params: { text: BEAM(20, " with a safety factor of 2") },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.pass, false);
    const text = formatToolResults([r]);
    assert.match(text, /\[TOOL_RESULT: conkay_design\] FAIL: achieved SF/);
  });

  it("executeToolCall rejects empty text", async () => {
    const r = await executeToolCall({}, async () => null, new Map(), { tool: "conkay_design", params: {} });
    assert.equal(r.ok, false);
  });

  it("conkay_design.solve is registered and returns the same check", async () => {
    const reg = new Map();
    registerConkayDesignActions((d, n, fn) => reg.set(`${d}.${n}`, fn));
    assert.ok(reg.has("conkay_design.solve"));
    const r = await reg.get("conkay_design.solve")({}, null, { text: BEAM(10, ", FoS 2") });
    assert.equal(r.ok, true);
    assert.equal(r.result.safety.requiredSafetyFactor, 2);
    assert.equal(r.result.pass, true);
  });
});

describe("run_lens_action rejects unknown names with the real ones", () => {
  const lensActions = new Map([
    ["engineering.partMesh", () => ({})],
    ["engineering.beamCheck", () => ({})],
    ["engineering.columnBuckling", () => ({})],
    ["conkay_design.solve", () => ({})],
    ["dtu.search", () => ({})],
  ]);
  const noMacro = async () => { throw new Error("macro not found"); };
  // Production always has the live register() map; strict resolution needs it.
  let saved;
  before(() => { saved = globalThis._concordMACROS; globalThis._concordMACROS = new Map([["engineering", new Map([["columnBuckling", {}]])]]); });
  after(() => { globalThis._concordMACROS = saved; });

  it("lists valid engineering actions and points design guesses at conkay_design", async () => {
    const r = await executeToolCall({}, noMacro, lensActions, {
      tool: "run_lens_action", params: { domain: "engineering", action: "cantilever_bending_design", params: {} },
    });
    assert.equal(r.ok, false);
    assert.match(r.error, /unknown lens action "engineering\.cantilever_bending_design"/);
    assert.ok(r.validActions.includes("partMesh"));
    assert.ok(r.validActions.includes("beamCheck"));
    assert.match(r.error, /Valid engineering actions: /);
    assert.match(r.error, /conkay_design/);
    // The model reads the formatted text, so the names must reach it.
    assert.match(formatToolResults([r]), /partMesh/);
  });

  it("an unknown domain lists known domains", async () => {
    const r = await executeToolCall({}, noMacro, lensActions, {
      tool: "run_lens_action", params: { domain: "enginering", action: "x", params: {} },
    });
    assert.equal(r.ok, false);
    assert.match(r.error, /unknown lens domain "enginering"/);
    assert.ok(r.validDomains.includes("engineering"));
  });

  it("a registered action still dispatches", async () => {
    const la = new Map([["dtu.search", async () => ({ ok: true, hits: [] })]]);
    const r = await executeToolCall({}, noMacro, la, { tool: "run_lens_action", params: { domain: "dtu", action: "search", params: {} } });
    assert.equal(r.ok, true);
  });

  it("list_lens_actions still lists both registries' names", async () => {
    const r = await executeToolCall({}, noMacro, lensActions, { tool: "list_lens_actions", params: { domain: "engineering" } });
    assert.equal(r.ok, true);
    assert.deepEqual(r.actions.map((a) => a.action).sort(), ["beamCheck", "columnBuckling", "partMesh"]);
  });

  it("closestNames ranks shared stems first", () => {
    assert.equal(closestNames("cantilever_bending_design", ["list", "bendingStress", "open"])[0], "bendingStress");
  });
});
