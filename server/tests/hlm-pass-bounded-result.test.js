// The pass returned by the HLM worker is deserialised on the MAIN thread. Its redundancy list is quadratic in
// near-duplicates and appeared three times (redundancies, topology, merge_redundant recs): 207 MB / 2.3 s of
// main-thread deserialise at 5k DTUs, worse quadratically, which is what froze the live loop 6-33 s every 20 min
// right as the worker's message landed. boundHLMPass keeps the strongest pairs; counts stay exact.
process.env.CONCORD_HLM_MAX_REDUNDANCIES = "40";

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import v8 from "node:v8";
import { computeHLMPass, boundHLMPass, getHLMMetrics } from "../emergent/hlm-engine.js";
import { runHLMPassOffThread } from "../emergent/hlm-offthread.js";

const words = ["alpha", "beta", "gamma", "delta", "eps", "zeta", "eta", "theta"];
// Heavily tag-overlapping store: many near-duplicate pairs.
const dup = (n) => Array.from({ length: n }, (_, i) => ({
  id: "d" + i, domain: "a", tier: "regular",
  tags: [0, 1, 2, 3].map((k) => words[(i + k * 3 + (i >> 3)) % words.length]),
  createdAt: new Date(1.7e12 + i * 1e5).toISOString(),
  authority: { score: (i % 10) / 10 }, human: { summary: "summary " + (i % 7) },
}));

describe("boundHLMPass", () => {
  const pass = computeHLMPass(dup(220));
  const total = pass.redundancies.redundancies.length;

  it("fixture really is over the cap", () => assert.ok(total > 100, `redundancies=${total}`));

  it("keeps the top pairs by similarity, exact total, and re-derives recommendations from the kept pairs only", () => {
    const b = boundHLMPass(pass, 40);
    assert.equal(b.redundancies.redundancies.length, 40);
    assert.equal(b.redundancies.total, total);
    assert.equal(b.redundancies.truncated, true);
    assert.equal(b.topology.redundancies.length, 40);
    assert.equal(b.summary.redundancyCount, total, "summary keeps the true count");
    const minKept = Math.min(...b.redundancies.redundancies.map((r) => r.similarity));
    const maxDropped = Math.max(...pass.redundancies.redundancies.filter((r) => !b.redundancies.redundancies.includes(r)).map((r) => r.similarity));
    assert.ok(minKept >= maxDropped, "only the weakest pairs are dropped");
    const merges = b.recommendations.recommendations.filter((r) => r.type === "merge_redundant");
    assert.equal(merges.length, 40);
    assert.ok(v8.serialize(b).length < v8.serialize(pass).length / 2, "the pass that crosses the thread is much smaller");
  });

  it("a pass at or under the cap is returned untouched (same object, output unchanged)", () => {
    assert.equal(boundHLMPass(pass, total), pass);
    assert.equal(boundHLMPass(pass, total + 1), pass);
    const failed = { ok: false, error: "x" };
    assert.equal(boundHLMPass(failed), failed);
  });
});

describe("worker applies the bound", () => {
  it("off-thread pass over a duplicate-heavy store is capped, recorded with the true redundancy total", async () => {
    const before = getHLMMetrics().totalRedundancies;
    const dtus = dup(220);
    const off = await runHLMPassOffThread(dtus);
    assert.equal(off.ok, true);
    assert.equal(off.redundancies.redundancies.length, 40, "CONCORD_HLM_MAX_REDUNDANCIES reaches the worker");
    assert.ok(off.redundancies.total > 40);
    assert.equal(getHLMMetrics().totalRedundancies - before, off.redundancies.total, "metrics count the true total, not the kept slice");
  });

  it("source pin: the worker bounds before it posts", () => {
    const src = fs.readFileSync(new URL("../workers/hlm-pass-worker.js", import.meta.url), "utf8");
    assert.match(src, /boundHLMPass\(computeHLMPass\(dtus\)\)/);
  });
});
