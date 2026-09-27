// server/tests/engineering-question-extract.test.js
//
// Written beam questions → physics.beamDeflection inputs. Expected deflections
// are textbook formulas (PL³/48EI simple, PL³/3EI cantilever, PL³/192EI fixed).

import { test } from "node:test";
import assert from "node:assert/strict";
import { extractBeamQuestion, formatDeflection } from "../lib/engineering-question-extract.js";
import { beamDeflection } from "../lib/compute/physics-compute.js";

const QA = "A simply supported steel beam 20 ft long carries a 1000 lb point load at midspan. E = 29,000,000 psi, I = 200 in^4. What is the maximum deflection?";

test("the QA question extracts exactly and computes the textbook PL³/48EI", () => {
  const q = extractBeamQuestion(QA);
  assert.deepEqual({ ...q, assumed: undefined }, { supportType: "simple", loadLbs: 1000, lengthFt: 20, modulusE: 29e6, momentI: 200, assumed: undefined });
  const r = beamDeflection(q);
  assert.ok(Math.abs(r.value - (1000 * 240 ** 3) / (48 * 29e6 * 200)) < 1e-12);
  assert.match(formatDeflection(r.value, r.formula), /δ = 0\.04966 in \(1\.261 mm\)/);
});

test("SI units convert (kN, m, GPa, mm⁴) and cantilever is recognised", () => {
  const q = extractBeamQuestion("How much does a cantilever beam 2 m long deflect under a 5 kN tip load? E = 200 GPa, I = 8.33e6 mm^4");
  assert.equal(q.supportType, "cantilever");
  const r = beamDeflection(q);
  const exactM = (5000 * 2 ** 3) / (3 * 200e9 * 8.33e6 * 1e-12);
  assert.ok(Math.abs(r.value * 0.0254 - exactM) / exactM < 1e-4, `${r.value * 0.0254} vs ${exactM}`);
});

test("steel supplies E when not given, and the assumption is disclosed", () => {
  const q = extractBeamQuestion("Deflection of a simply supported steel beam, span 16 ft, 2 kips at midspan, I = 150 in4?");
  assert.equal(q.modulusE, 29e6);
  assert.equal(q.loadLbs, 2000);
  assert.equal(q.assumed.length, 1);
});

test("never guesses: missing I, missing support, distributed loads, or non-beam text → null", () => {
  assert.equal(extractBeamQuestion("A simply supported steel beam 20 ft long carries 1000 lb at midspan. Deflection?"), null, "no I");
  assert.equal(extractBeamQuestion("A steel beam 20 ft long carries 1000 lb, I = 200 in^4. Deflection?"), null, "no support type");
  assert.equal(extractBeamQuestion("A simply supported beam 20 ft long carries 50 lb/ft uniformly, I = 200 in^4, E = 29000 ksi. Deflection?"), null, "distributed");
  assert.equal(extractBeamQuestion("What is the deflection of public opinion?"), null);
});

test("chat.respond computes the beam answer before any brain path and enforces it", async () => {
  const fs = await import("node:fs");
  const src = fs.readFileSync(new URL("../server.js", import.meta.url), "utf8");
  const extractAt = src.indexOf("const _beamQ = _extractBeamQuestion(prompt);");
  const llmBranchAt = src.indexOf("if (llm && ctx.llm.enabled) {");
  assert.ok(extractAt > 0 && llmBranchAt > 0 && extractAt < llmBranchAt, "beam extraction must precede every brain branch");
  assert.match(src, /if \(!finalReply\.includes\(_v4\) && !finalReply\.includes\(_v3\)\) finalReply = _deterministicAnswer\.text;/);
});
