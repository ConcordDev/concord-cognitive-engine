// FIX-hypothesis-004 — the Lab's propose/get/list were registered twice
// against two different stores: the monolith block served the local
// STATE.hypothesisEngine engine (summaries without the emergent DTU
// shape; get answered "Hypothesis not found" for emergent records),
// while the Ghost Fleet registrations — landing on a 20s boot timer —
// serve server/emergent/hypothesis-engine.js, the engine the Lab is
// written against. Which store answered depended on boot phase.
// The monolith block now delegates every Lab action to the emergent
// engine through _hypothesisEngineCall (the path metrics/add_test/
// delete already used). Source pin in the FIX-game-001 pattern.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../server.js", import.meta.url), "utf8");
const blockStart = src.indexOf("// ===== HYPOTHESIS ENGINE MACROS =====");
const blockEnd = src.indexOf("// ===== END HYPOTHESIS ENGINE MACROS =====");
const block = src.slice(blockStart, blockEnd);

describe("FIX-hypothesis-004 Lab actions delegate to the one engine", () => {
  it("propose delegates with the emergent signature (statement/domain/priority/force)", () => {
    assert.match(block, /register\("hypothesis", "propose", \(_ctx, input = \{\}\) => _hypothesisEngineCall\("proposeHypothesis", \[\s*input\.statement, input\.domain, input\.priority, \{ force: input\.force === true \}/);
  });

  it("get and list delegate instead of reading STATE.hypothesisEngine", () => {
    assert.match(block, /register\("hypothesis", "get", async/);
    assert.match(block, /hypo\.getHypothesis\(hypothesisId\)/);
    assert.match(block, /register\("hypothesis", "list", async/);
    assert.match(block, /ghostFleetOk\(hypo\.listHypotheses\(input\.status\)\)/);
    // The handlers themselves (from the get registration to the block's
    // end) must not touch the monolith store — the status action's
    // counters earlier in the block are a different surface.
    const handlers = block.slice(block.indexOf('register("hypothesis", "get"'));
    assert.doesNotMatch(handlers, /hypothesisEngine\.hypotheses\.(get|values)/);
    assert.doesNotMatch(handlers, /error: "Hypothesis not found"/);
  });

  it("the lifecycle actions the Lab calls are registered in the block too", () => {
    for (const [action, method] of [
      ["update_test", "updateTestResult"], ["add_prediction", "addPrediction"],
      ["verify_prediction", "verifyPrediction"], ["confirm", "confirmHypothesis"],
      ["reject", "rejectHypothesis"], ["refine", "refineHypothesis"], ["archive", "archiveHypothesis"],
    ]) {
      assert.match(block, new RegExp(`register\\("hypothesis", "${action}", \\(_ctx, input = \\{\\}\\) => _hypothesisEngineCall\\("${method}"`),
        `${action} delegates to ${method}`);
    }
  });
});
