/**
 * ConKay K1 — dtu.create honest stage-beats.
 *
 * dtu.create runs a real three-phase pipeline inline in server.js
 * (validate/consent → persist → cite). Because the logic is inline (not an
 * extracted lib), this test boots the server once via the depth harness and
 * invokes the macro through the real `runMacro` dispatch with a spy
 * `emitMacroStage` attached to the ctx — exactly the ctx the /api/lens/run
 * handler builds. It asserts the real phases fire and that "citing" only fires
 * when there is real lineage to register.
 *
 * The commit pipeline (pipelineCommitDTU → pipeVerify + pipeCouncil) is fully
 * DETERMINISTIC — no brain — so this test runs offline. It just needs a DTU
 * that clears the council value gate (core with ≥2 structured items, minScore 2
 * at server.js:10483), which is how a real substantive DTU commits.
 *
 * MUST run under the standard no-egress preload (as `npm test` does:
 * `--import=./tests/preload/no-egress.mjs`) — a bare boot without it can leave a
 * keep-alive fetch socket hanging. Kept separate from conkay-k1-stage-beats.test.js
 * so that file stays a fast boot-free unit; this one pays the one-time server boot.
 *
 * Run: node --test --import=./tests/preload/no-egress.mjs server/tests/conkay-k1-dtu-create-stage-beats.test.js
 */

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";

import { macroRuntime } from "./depth/_harness.js";
import { validateEvent } from "../lib/event-shapes.js";

// A DTU substantive enough to clear the deterministic council value gate
// (core score = definitions + claims + … ≥ minScore 2). `n` keeps titles unique
// so the pipeline dedup gate never collides across the cases in this file.
function richDtu(n, extra = {}) {
  return {
    title: `K1 beat probe ${n}`,
    source: "user",
    core: {
      definitions: [`ConKay stage-beat ${n}: a macro:stage emitted at a real sub-step.`],
      claims: [
        "Every animated element is a pure function of a real backend event.",
        "K1 wires emitMacroStage into six macros at their true internal boundaries.",
      ],
    },
    human: { summary: `K1 dtu.create beat probe ${n}.` },
    ...extra,
  };
}

describe("K1 — dtu.create emits real validating/persisting/citing beats", () => {
  let runMacro, ctx;
  before(async () => {
    ({ runMacro, ctx } = await macroRuntime("k1-dtu"));
  });

  // Attach a fresh spy to the shared ctx for each call and return the captured beats.
  function withSpy() {
    const stages = [];
    ctx.emitMacroStage = (s) => stages.push(s);
    return stages;
  }

  it("a lineage-free create fires validating → persisting, but NOT citing", async () => {
    const stages = withSpy();
    const r = await runMacro("dtu", "create", richDtu("lineage-free"), ctx);
    assert.equal(r.ok, true, `create should succeed: ${JSON.stringify(r)}`);
    assert.deepEqual(stages, ["validating", "persisting"], `only the two pre-commit beats fire without lineage: ${JSON.stringify(stages)}`);
    for (const s of stages) {
      assert.equal(validateEvent("macro:stage", { runId: "r-1", stage: s }).ok, true, `beat ${s} validates`);
    }
  });

  it("a create with lineage fires the citing beat too", async () => {
    // Parent first (owned by this same actor → own-DTU, no consent barrier).
    const parent = await runMacro("dtu", "create", richDtu("parent", { visibility: "public" }), ctx);
    assert.equal(parent.ok, true, `parent create should succeed: ${JSON.stringify(parent)}`);
    const parentId = parent.dtu?.id || parent.id;
    assert.ok(parentId, `parent id present: ${JSON.stringify(parent)}`);

    const stages = withSpy();
    const child = await runMacro("dtu", "create", richDtu("derivative", { lineage: [parentId] }), ctx);
    assert.equal(child.ok, true, `child create should succeed: ${JSON.stringify(child)}`);
    assert.deepEqual(stages, ["validating", "persisting", "citing"], `all three beats fire in order on a derivative: ${JSON.stringify(stages)}`);
  });

  it("a throwing emitMacroStage never breaks dtu.create", async () => {
    ctx.emitMacroStage = () => { throw new Error("boom"); };
    const r = await runMacro("dtu", "create", richDtu("throw-safe"), ctx);
    assert.equal(r.ok, true, `create survives a throwing hook: ${JSON.stringify(r)}`);
  });
});
