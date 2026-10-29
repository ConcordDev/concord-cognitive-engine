// Brief E §3: numbers in the reply must trace to a tool result (footbridge: reply said 111 MPa, tool said 25 MPa).
import test from "node:test";
import assert from "node:assert/strict";
import { guardNumericTrace } from "../lib/chat/numeric-trace.js";

const beam = [{ tool: "conkay_design", ok: true, result: { depthMm: 125, sigmaMPa: 25, deltaMm: 10.7, maxMomentNm: 10000, spanM: 4 } }];

test("the footbridge failure: 111 MPa against a tool that said 25 MPa is flagged", () => {
  const g = guardNumericTrace("The bending stress is 111 MPa at a depth of 125 mm.", beam, { prompt: "4 m span, 10 kN" });
  assert.deepEqual(g.untraced, ["111 MPa"]);
  assert.match(g.text, /Unverified figures: 111 MPa/);
});

test("numbers that come from the tool, the prompt, a rescale or a derivation pass", () => {
  const g = guardNumericTrace("Depth 125 mm (0.125 m), stress 25 MPa (25,000,000 Pa), moment 10 kN·m, span 4 m, load 10 kN, midspan 2 m.", beam, { prompt: "10 kN midspan, 4 m span" });
  assert.deepEqual(g.untraced, []);
  assert.equal(g.text.includes("Unverified"), false);
});

test("rounding within 0.5% still traces; 5% off does not", () => {
  assert.deepEqual(guardNumericTrace("deflection 10.73 mm", beam).untraced, []);
  assert.deepEqual(guardNumericTrace("deflection 11.5 mm", beam).untraced, ["11.5 mm"]);
});

test("a ratio of two tool numbers is a derivation, not an invention", () => {
  const g = guardNumericTrace("The stress is 25 MPa, which is 4 times lower than 100 MPa.", [{ tool: "run_compute", ok: true, result: { a: 25, b: 100 } }]);
  assert.deepEqual(g.untraced, []);
});

test("no calculation tool ran: nothing to trace against, reply untouched", () => {
  const g = guardNumericTrace("Steel yields near 250 MPa.", [{ tool: "web_search", ok: true, result: "x" }]);
  assert.deepEqual(g, { text: "Steel yields near 250 MPa.", untraced: [], checked: 0 });
});

test("failed tools and fenced echoes are ignored", () => {
  assert.equal(guardNumericTrace("999 MPa", [{ tool: "run_compute", ok: false, result: { x: 1 } }]).untraced.length, 0);
  assert.deepEqual(guardNumericTrace("```\nsigma = 111 MPa\n```\nDone, 25 MPa.", beam).untraced, []);
});
