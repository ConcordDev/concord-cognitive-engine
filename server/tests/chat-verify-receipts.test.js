// Brief E §3: verify against reality. Every recipe answer is recomputed independently and, where the inputs
// match a textbook case, compared with the known answer; the receipt carries the evidence.
import test from "node:test";
import assert from "node:assert/strict";
import { runRecipe } from "../lib/chat/tool-recipes/index.js";
import { independentRecompute, referenceMatch, REFERENCE_CORPUS } from "../lib/chat/tool-recipes/verify.js";
import { executeToolCall } from "../lib/chat-agent.js";
import { guardNumericTrace } from "../lib/chat/numeric-trace.js";

test("every reference-corpus case runs through its recipe, matches the textbook answer and is verified", () => {
  assert.ok(REFERENCE_CORPUS.cases.length >= 9);
  for (const c of REFERENCE_CORPUS.cases) {
    const r = runRecipe(c.recipe, c.inputs);
    assert.equal(r.ok, true, `${c.id}: ${r.error}`);
    const ref = r.receipt.verification.reference;
    assert.equal(ref.matched, true, c.id);
    assert.equal(ref.pass, true, `${c.id}: ${JSON.stringify(ref.mismatches)}`);
    assert.equal(r.verified, true, `${c.id}: ${JSON.stringify(r.checks.filter((k) => !k.pass))}`);
    assert.equal(r.passed, true, `${c.id}: ${r.note}`);
  }
});

test("the independent recompute catches a wrong answer", () => {
  const r = runRecipe("column_buckling", { lengthM: 2.5, modulusPa: 200e9, widthM: 0.06, heightM: 0.1, loadN: 80000 });
  const tampered = { ...r.result, criticalLoadN: r.result.criticalLoadN * 1.2 };
  const checks = independentRecompute("column_buckling", r.receipt.inputs, tampered);
  assert.equal(checks.find((c) => c.name === "Pcr_pi2EI/(KL)2").pass, false);
});

test("a result that disagrees with the textbook case is reported, not passed", () => {
  const inputs = { spanM: 4, loadN: 10000, widthM: 0.06, material: "steel-a36", safetyFactor: 2, deflectionLimit: 360 };
  const good = runRecipe("beam_sizing", inputs).result;
  const m = referenceMatch("beam_sizing", inputs, { ...good, depthM: 0.1 });
  assert.equal(m.matched, true);
  assert.equal(m.pass, false);
  assert.equal(m.mismatches[0].path, "depthM");
});

test("inputs with no matching textbook case are still independently checked", () => {
  const r = runRecipe("beam_sizing", { spanM: 6, loadN: 20000, widthM: 0.08, material: "steel-a36", safetyFactor: 1.5, deflectionLimit: 300 });
  assert.equal(r.receipt.verification.reference.matched, false);
  assert.equal(r.verified, true);
  assert.equal(r.passed, true);
});

test("a failing design is failed and not verified-as-fine", () => {
  const r = runRecipe("pressure_vessel", { pressurePa: 6e6, radiusM: 0.5, thicknessM: 0.01, yieldPa: 250e6 });
  assert.equal(r.passed, false);
  assert.match(r.note, /Failed checks: yield/);
});

test("the receipt carries inputs, steps, checks, verification and a stable digest", () => {
  const inputs = { lengthM: 2.5, modulusPa: 200e9, widthM: 0.06, heightM: 0.1, loadN: 80000 };
  const a = runRecipe("column_buckling", inputs).receipt;
  const b = runRecipe("column_buckling", inputs).receipt;
  assert.match(a.digest, /^sha256:[0-9a-f]{64}$/);
  assert.equal(a.digest, b.digest);
  for (const k of ["inputs", "steps", "checks", "verification", "result", "passed"]) assert.ok(k in a, k);
  assert.notEqual(a.digest, runRecipe("column_buckling", { ...inputs, loadN: 90000 }).receipt.digest);
});

test("end to end through the chat tools, no LLM: footbridge beam + column, then the reply is checked against the receipts", async () => {
  const call = (tool, params) => executeToolCall({}, () => null, new Map(), { tool, params });
  const beam = await call("run_recipe", { recipe: "beam_sizing", inputs: { spanM: 4, loadN: 10000, widthM: "60 mm", material: "steel-a36", safetyFactor: 2 } });
  const col = await call("run_recipe", { recipe: "column_buckling", inputs: { lengthM: 2.5, modulusPa: "200 GPa", widthM: "60 mm", heightM: "100 mm", loadN: "80 kN" } });
  assert.equal(beam.verified, true);
  assert.equal(col.verified, true);
  assert.equal(beam.result.depthM, 0.125);
  assert.ok(Math.abs(col.result.criticalLoadN / 1e3 - 568.5) < 0.6);

  const honest = "Use a 125 mm deep section; deflection governs. The column buckles at 568.5 kN, so 80 kN gives a factor of safety of 7.11.";
  assert.deepEqual(guardNumericTrace(honest, [beam, col], { prompt: "4 m span, 10 kN, 60 mm wide, 2.5 m column, 80 kN" }).untraced, []);
  const wrong = "The bending stress is 111 MPa at 125 mm.";
  assert.deepEqual(guardNumericTrace(wrong, [beam, col], { prompt: "" }).untraced, ["111 MPa"]);
});

test("a unit outside the independent table is NOT reported as independently verified", () => {
  const r = runRecipe("unit_conversion", { value: 3, from: "mm2", to: "m2" });
  assert.equal(r.ok, true);
  assert.equal(r.passed, true); // the converter's own declared checks still pass
  assert.equal(r.verified, false);
  assert.equal(r.receipt.verification.verified, false);
  assert.deepEqual(r.receipt.verification.independent, []);
  assert.ok(!r.checks.some((c) => c.name === "independent:independent_factor" && c.pass));
  assert.match(r.note, /no independent recomputation exists/);
  assert.doesNotMatch(r.note, /independent recomputation agrees/);
});

test("an in-table unit conversion is still independently verified", () => {
  const r = runRecipe("unit_conversion", { value: 3, from: "psi", to: "mpa" });
  assert.equal(r.verified, true);
  assert.ok(r.checks.some((c) => c.name === "independent:conversion_factor" && c.pass));
});
