// Heap creep round 2: after #1965 (keep 2 passes) the heap still climbed because each pass carried every tag-pair "gap"
// three times (topology.gaps, gaps.gaps, one fill_gap recommendation each) — 34k gaps ≈ 32 MB on a 3k-DTU store.
import test from "node:test";
import assert from "node:assert/strict";
import { computeHLMPass, boundHLMPass, recordHLMPass, getHLMMetrics } from "../emergent/hlm-engine.js";

const tags = Array.from({ length: 400 }, (_, i) => `t${i}`);
const dtus = Array.from({ length: 3000 }, (_, i) => ({
  id: `d${i}`, tags: [tags[i % 400], tags[(i * 7) % 400], tags[(i * 13) % 400]], parentId: i % 5 === 0 ? `d${i >> 1}` : undefined,
  domain: `dom${i % 9}`, tier: ["regular", "mega"][i % 2], createdAt: new Date(Date.now() - i * 1000 * 3600 * 5).toISOString(),
  authority: { score: 0.5 }, human: { summary: `summary text number ${i}` },
}));

test("gaps, fill_gap recommendations and stale list are bounded; counts stay exact", () => {
  const raw = computeHLMPass(dtus);
  assert.equal(raw.ok, true);
  const total = raw.gaps.gaps.length;
  assert.ok(total > 300, `fixture should produce many gaps (got ${total})`);

  const b = boundHLMPass(raw, 100);
  assert.equal(b.gaps.gaps.length, 100);
  assert.equal(b.gaps.total, total);
  assert.equal(b.topology.gaps.length, 100);
  assert.equal(b.recommendations.recommendations.filter((r) => r.type === "fill_gap").length, 100);
  // strongest-supported pairs are the ones kept
  const minKept = Math.min(...b.gaps.gaps.map((g) => g.tagACount + g.tagBCount));
  const dropped = raw.gaps.gaps.filter((g) => !b.gaps.gaps.some((k) => k.gapId === g.gapId));
  assert.ok(dropped.every((g) => g.tagACount + g.tagBCount <= minKept));
  if (raw.freshness.stale.length > 100) assert.equal(b.freshness.staleTotal, raw.freshness.stale.length);

  const before = getHLMMetrics().totalGaps;
  recordHLMPass(b);
  assert.equal(getHLMMetrics().totalGaps - before, total, "metrics count the true gap total, not the kept slice");
  assert.ok(JSON.stringify(b).length < JSON.stringify(raw).length / 3, "bounded pass is much smaller");
});

test("a pass already under the bound is returned untouched", () => {
  const raw = computeHLMPass(dtus.slice(0, 30));
  assert.equal(boundHLMPass(raw, 100000), raw);
});
