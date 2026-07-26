// server/tests/reasoning-ongoing-shadow.test.js
//
// Contract test for lib/reasoning/ongoing-shadow.js#createCrystallizer.
// No prior test file existed for this module. Written alongside the
// unused-destructured-param fix that wires the agent-loop-supplied `steps`
// array into the shadow DTU's machine.stepCount field (was previously
// destructured and silently discarded — a `steps` array the caller
// (lib/inference/agent-loop.js:113) genuinely computes and passes on every
// crystallization).

import { test } from "node:test";
import assert from "node:assert/strict";
import { createCrystallizer, getReasoningSession } from "../lib/reasoning/ongoing-shadow.js";

function makeInferFn(finalText) {
  return async () => ({ finalText });
}

test("onCrystallize persists the real step count into the shadow DTU, not a discarded value", async () => {
  const committed = [];
  const crystallizer = createCrystallizer({
    inferFn: makeInferFn("SUMMARY: made progress\nINSIGHTS:\n- learned X\nPENDING:\n- resolve Y"),
    commitShadowDTU: async (dtu) => { committed.push(dtu); },
    userId: "u1",
    originalIntent: "do the thing",
  });

  const steps = [
    { type: "tool_call", name: "search" },
    { type: "tool_call", name: "read_file" },
    { type: "inference" },
  ];
  const result = await crystallizer.onCrystallize({ steps, workingMessages: [{ role: "user", content: "hi" }] });

  assert.ok(result, "onCrystallize should return a result on the first generation");
  assert.equal(committed.length, 1, "commitShadowDTU must be called exactly once");
  assert.equal(committed[0].machine.stepCount, steps.length,
    "the caller-supplied steps array length must land in machine.stepCount, not be dropped");
});

test("onCrystallize defaults stepCount to 0 when steps is omitted", async () => {
  const committed = [];
  const crystallizer = createCrystallizer({
    inferFn: makeInferFn("SUMMARY: ok\nINSIGHTS:\n- a"),
    commitShadowDTU: async (dtu) => { committed.push(dtu); },
    userId: "u2",
    originalIntent: "another task",
  });

  await crystallizer.onCrystallize({ workingMessages: [] });
  assert.equal(committed.length, 1);
  assert.equal(committed[0].machine.stepCount, 0);
});

test("getSessionId/getShadowLineage track the crystallizer's own session", async () => {
  const crystallizer = createCrystallizer({
    inferFn: makeInferFn("SUMMARY: s\nINSIGHTS:\n- i"),
    commitShadowDTU: async () => {},
    userId: "u3",
    originalIntent: "track lineage",
  });

  assert.equal(crystallizer.getShadowLineage().length, 0);
  const r = await crystallizer.onCrystallize({ steps: [{ type: "x" }], workingMessages: [] });
  assert.equal(crystallizer.getShadowLineage().length, 1);
  assert.equal(crystallizer.getShadowLineage()[0], r.shadowId);

  const session = getReasoningSession(crystallizer.getSessionId());
  assert.ok(session, "the session must be registered in the in-memory registry");
  assert.equal(session.shadowCount, 1);
});
