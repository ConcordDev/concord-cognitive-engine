import test from "node:test";
import assert from "node:assert/strict";
import { recordHLMPass, getHLMMetrics, HLM_MAX_STORED_PASSES } from "../emergent/hlm-engine.js";

const fakePass = (i) => ({
  ok: true, passId: `p${i}`, completedAt: new Date().toISOString(),
  clusters: { clusters: [] }, orphans: { orphans: [] }, gaps: { gaps: [] }, redundancies: { redundancies: [] },
  recommendations: { recommendations: [] },
});

test("recorded passes are bounded to the latest few (a full pass is tens of MB on a big store)", () => {
  for (let i = 0; i < 40; i++) recordHLMPass(fakePass(i));
  const m = getHLMMetrics();
  assert.equal(m.storedPasses, HLM_MAX_STORED_PASSES);
  assert.equal(m.totalPasses >= 40, true, "history counters keep counting");
  assert.equal(m.lastPassId, "p39");
});
