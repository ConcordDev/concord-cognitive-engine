// The HLM slow pass runs off the main thread (7-13 s+ event-loop freezes every 20 min; fix-it #68).
// Pins: same result as the in-process pass, the main loop stays responsive while it runs, the result is
// recorded in hlm-engine's state, failures are reported (never a silent synchronous fallback), the slim
// projection yields, and server.js's timer uses the off-thread runner.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { computeHLMPass, getHLMMetrics } from "../emergent/hlm-engine.js";
import { runHLMPassOffThread, projectDtus, slimDtu } from "../emergent/hlm-offthread.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const doms = ["math", "physics", "code", "bio", "econ", "law", "art", "music"];
const tiers = ["regular", "regular", "regular", "mega", "hyper", "shadow"];
const fixture = (n) => Array.from({ length: n }, (_, i) => ({
  id: "dtu_" + i, title: "t" + i, tier: tiers[i % 6], domain: doms[i % 8],
  tags: [doms[i % 8], "t" + (i % 50), "x" + (i % 300)],
  parentId: i > 10 && i % 4 === 0 ? "dtu_" + (i - 7) : undefined,
  createdAt: new Date(1.7e12 + i * 60000).toISOString(),
  authority: { score: (i % 10) / 10 }, human: { summary: "summary text about " + doms[i % 8] + " item " + (i % 331) },
  // fields the analysis never reads (must not matter):
  lineage: { parents: [], children: [] }, core: { claims: ["c"] }, machine: { blob: "x".repeat(200) },
}));
const norm = (p) => ({
  summary: p.summary,
  clusters: p.clusters.clusters.map((c) => c.members.slice().sort()).sort((a, b) => a[0].localeCompare(b[0])),
  unassigned: p.clusters.unassigned.slice().sort(),
  gaps: p.gaps.gaps.length, reds: p.redundancies.redundancies.length, orphans: p.orphans.orphans.length,
});

describe("runHLMPassOffThread", () => {
  it("produces the same analysis as the in-process pass (the slim projection loses nothing the pass reads)", async () => {
    const dtus = fixture(300);
    const inProc = computeHLMPass(dtus);
    const off = await runHLMPassOffThread(dtus);
    assert.equal(off.ok, true);
    assert.deepEqual(norm(off), norm(inProc));
    assert.ok(inProc.summary.clusterCount > 0 && inProc.summary.redundancyCount >= 0, "fixture actually exercises clustering");
  });

  it("records the pass, its recommendations and the metrics on the main thread", async () => {
    const before = getHLMMetrics();
    const off = await runHLMPassOffThread(fixture(400));
    const after = getHLMMetrics();
    assert.equal(after.totalPasses, before.totalPasses + 1);
    assert.equal(after.lastPassId, off.passId);
    assert.equal(after.totalClusters, before.totalClusters + off.clusters.clusters.length);
    const recs = off.recommendations.recommendations.length;
    assert.equal(after.totalRecommendations, before.totalRecommendations + recs);
    assert.ok(after.storedRecommendations >= recs);
    assert.ok(after.storedPasses >= 1);
  });

  it("does not block the main event loop while a heavy pass runs (the regression this fixes)", async () => {
    const dtus = fixture(3500);
    // How long the in-process version freezes the loop for this fixture (measured, not assumed).
    const t0 = performance.now(); computeHLMPass(dtus); const syncMs = performance.now() - t0;
    assert.ok(syncMs > 500, `fixture is heavy enough to show the freeze (sync pass took ${syncMs.toFixed(0)} ms)`);
    let last = performance.now(); let maxGap = 0; let ticks = 0;
    const timer = setInterval(() => { const n = performance.now(); maxGap = Math.max(maxGap, n - last); last = n; ticks++; }, 5);
    const off = await runHLMPassOffThread(dtus);
    clearInterval(timer);
    assert.equal(off.ok, true);
    assert.ok(ticks > 20, `the loop kept ticking during the pass (${ticks} ticks)`);
    assert.ok(maxGap < 250, `longest main-thread stall ${maxGap.toFixed(0)} ms (in-process stall was ~${syncMs.toFixed(0)} ms)`);
    assert.ok(maxGap < syncMs / 3);
  });

  it("sends the input in chunks (result identical to the single-message result; every chunk reaches the worker)", async () => {
    const dtus = fixture(900);
    const inProc = computeHLMPass(dtus);
    const chunked = await runHLMPassOffThread(dtus, { postChunk: 70 }); // 13 messages
    assert.equal(chunked.ok, true);
    assert.deepEqual(norm(chunked), norm(inProc));
    assert.equal(chunked.summary.totalDtus, 900, "no DTU lost across chunk boundaries");
  });

  it("projection yields to the event loop between chunks", async () => {
    // A competing setImmediate chain can only advance when projectDtus hands the loop back.
    let running = true; let interleaved = 0;
    const spin = () => { interleaved++; if (running) setImmediate(spin); };
    setImmediate(spin);
    const out = await projectDtus(fixture(1500), { chunk: 100 });
    running = false;
    assert.equal(out.length, 1500);
    assert.ok(interleaved >= 10, `other work ran between projection chunks (${interleaved})`);
    // control: a single huge chunk never yields
    running = true; interleaved = 0; setImmediate(spin);
    await projectDtus(fixture(1500), { chunk: 1_000_000 });
    running = false;
    assert.ok(interleaved <= 2, `no yielding with one chunk (${interleaved})`);
  });

  it("slimDtu keeps exactly the fields the analysis reads", () => {
    const s = slimDtu(fixture(1)[0]);
    assert.deepEqual(Object.keys(s).sort(), ["authority", "createdAt", "domain", "human", "id", "parentId", "tags", "tier"]);
    assert.deepEqual(s.authority, { score: 0 });
    assert.deepEqual(Object.keys(s.human), ["summary"]);
  });

  it("reports failures instead of falling back to the synchronous pass", async () => {
    assert.deepEqual(await runHLMPassOffThread([]), { ok: true, skipped: "no_dtus" });
    const bad = await runHLMPassOffThread(fixture(10), { workerPath: path.join(here, "does-not-exist.js") });
    assert.equal(bad.ok, false);
    assert.match(bad.error, /hlm_worker_(error|exit|spawn_failed)/);
    const slow = await runHLMPassOffThread(fixture(3000), { timeoutMs: 30 });
    assert.deepEqual(slow, { ok: false, error: "hlm_pass_timeout" });
  });

  it("server.js: the 20-minute HLM timer runs the pass off-thread under a loopJobs job, not runHLMPass inline", () => {
    const src = fs.readFileSync(path.join(here, "..", "server.js"), "utf8");
    const i = src.indexOf("HLM slow interval: every 20 minutes");
    const block = src.slice(i, i + 2500);
    assert.match(block, /runHLMPassOffThread\(/);
    assert.match(block, /loopJobs\.withJob\("hlm_pass"/);
    assert.ok(!/hlm\.runHLMPass\(dtus\)/.test(block), "no synchronous pass in the timer");
  });
});
