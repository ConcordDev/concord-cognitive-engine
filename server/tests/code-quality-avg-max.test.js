// server/tests/code-quality-avg-max.test.js
//
// FIX-code-quality-003: a scan reported AVG COMPLEXITY 5 with MAX
// COMPLEXITY 4 on the same file. The per-file complexity sum started
// at 1 (a phantom base point), so one function of complexity 4
// averaged (4+1)/1 = 5. The average is now the plain mean of the
// functions' complexities (0 for a file with no functions), so
// avg ≤ max holds per file and in the multi-file rollup.

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import registerCodeQualityActions from "../domains/code-quality.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function analyze(files) {
  const fn = ACTIONS.get("code-quality.analyze");
  return fn({ actor: { userId: "u1" }, userId: "u1" }, { id: null, data: {}, meta: {} }, { files });
}

before(() => { registerCodeQualityActions(register); });

// One function, three decision points → complexity 4.
const ONE_FN = `
function pick(x) {
  if (x > 10) return "big";
  if (x > 5) return "mid";
  if (x > 0) return "small";
  return "none";
}
`;

describe("code-quality avg never exceeds max (FIX-code-quality-003)", () => {
  it("the audit case: one function of complexity 4 → avg 4, max 4", () => {
    const r = analyze([{ path: "pick.js", content: ONE_FN }]);
    assert.equal(r.ok, true);
    const m = r.result.files[0].metrics;
    assert.equal(m.maxComplexity, 4);
    assert.equal(m.avgComplexity, 4);
  });

  it("a file with no functions reports avg 0 and max 0", () => {
    const r = analyze([{ path: "plain.js", content: "const a = 1;\nconst b = 2;\n" }]);
    const m = r.result.files[0].metrics;
    assert.equal(m.functionCount, 0);
    assert.equal(m.avgComplexity, 0);
    assert.equal(m.maxComplexity, 0);
  });

  it("the aggregate across files keeps avg ≤ max", () => {
    const r = analyze([
      { path: "pick.js", content: ONE_FN },
      { path: "plain.js", content: "const a = 1;\n" },
      { path: "two.js", content: "function a(x){ return x ? 1 : 2; }\nfunction b(y){ if (y) return 1; return 0; }\n" },
    ]);
    const agg = r.result.metrics;
    assert.ok(agg, "analyze returns an aggregate metrics block");
    assert.ok(agg.avgComplexity <= agg.maxComplexity,
      `avg ${agg.avgComplexity} must not exceed max ${agg.maxComplexity}`);
  });
});
