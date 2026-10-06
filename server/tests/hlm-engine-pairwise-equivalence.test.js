// HLM pairwise passes: the optimized redundancyDetection / clusterAnalysis
// (per-pass features, tag-index candidate pairs, threshold pruning) must give
// exactly what the original all-pairs algorithm gives. The original cost
// minutes of synchronous main-thread time per 20-min pass at a few thousand
// DTUs (160-190s event-loop stalls); see emergent/hlm-engine.js "Per-pass
// features". The reference below is the original algorithm, verbatim in logic.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { redundancyDetection, clusterAnalysis, runHLMPass } from "../emergent/hlm-engine.js";

// ── reference (original all-pairs algorithm) ────────────────────────────────
function refTag(a, b) {
  if (!a?.length || !b?.length) return 0;
  const A = new Set(a.map(t => String(t).toLowerCase().trim()));
  const B = new Set(b.map(t => String(t).toLowerCase().trim()));
  let i = 0; for (const t of A) if (B.has(t)) i++;
  const u = new Set([...A, ...B]).size;
  return u > 0 ? i / u : 0;
}
function refText(a, b) {
  if (!a || !b) return 0;
  const sa = String(a).toLowerCase().trim(); const sb = String(b).toLowerCase().trim();
  if (sa === sb) return 1;
  if (sa.length < 2 || sb.length < 2) return 0;
  const A = new Set(); for (let i = 0; i < sa.length - 1; i++) A.add(sa.slice(i, i + 2));
  const B = new Set(); for (let i = 0; i < sb.length - 1; i++) B.add(sb.slice(i, i + 2));
  let n = 0; for (const g of A) if (B.has(g)) n++;
  const u = new Set([...A, ...B]).size;
  return u > 0 ? n / u : 0;
}
function refSim(a, b) {
  const d = a.domain && b.domain && a.domain === b.domain ? 1 : 0;
  return Math.max(0, Math.min(1, refTag(a.tags, b.tags) * 0.5 + refText(a.human?.summary || "", b.human?.summary || "") * 0.3 + d * 0.2));
}
function refRedundantPairs(dtus) {
  const out = []; const seen = new Set();
  for (let i = 0; i < dtus.length; i++) {
    const a = dtus[i]; if (!a?.id) continue;
    for (let j = i + 1; j < dtus.length; j++) {
      const b = dtus[j]; if (!b?.id) continue;
      const key = [a.id, b.id].sort().join(":"); if (seen.has(key)) continue;
      const s = refSim(a, b);
      if (s >= 0.85) { seen.add(key); out.push([a.id, b.id, Math.round(s * 1000) / 1000]); }
    }
  }
  return out;
}

// ── fixture dense with near-duplicates and edge cases ───────────────────────
function fixture(n) {
  const w = ["alpha", "beta", "gamma", "delta", "lattice", "royalty", "cascade", "world", "music", "law"];
  const out = [];
  for (let i = 0; i < n; i++) {
    const g = i % 40;
    out.push({
      id: `d${i}`,
      tags: i % 13 === 0 ? [] : [w[g % 10], w[(g + 3) % 10], ...(i % 3 ? [w[(g + 5) % 10]] : []), ...(i % 7 === 0 ? ["Alpha "] : [])],
      human: { summary: i % 11 === 0 ? "   " : `${w[g % 10]} summary about ${w[(g * 7) % 10]} item ${g}${i % 5 === 0 ? " extra" : ""}` },
      domain: i % 4 ? w[g % 3] : undefined,
      authority: { score: (i * 37) % 10 },
      parentId: i % 9 === 0 ? `d${i - 1}` : i % 6 === 0 ? "p1" : undefined,
    });
  }
  out.push({ ...out[5] }); // duplicate id
  return out;
}

describe("hlm-engine pairwise passes", () => {
  const dtus = fixture(400);

  it("redundancyDetection finds exactly the reference pairs, in the same order", () => {
    const got = redundancyDetection(dtus).redundancies.map(r => [r.dtuA, r.dtuB, r.similarity]);
    const want = refRedundantPairs(dtus);
    assert.ok(want.length > 100, "fixture should contain many near-duplicates");
    assert.deepEqual(got, want);
  });

  it("clusterAnalysis membership is unchanged", () => {
    const sig = (r) => r.clusters.map(c => [...c.members].sort().join(",")).sort();
    // Same input twice — deterministic membership (cluster ids are random).
    assert.deepEqual(sig(clusterAnalysis(dtus)), sig(clusterAnalysis(fixture(400))));
    assert.ok(clusterAnalysis(dtus).clusters.length > 0);
  });

  it("runHLMPass reuses one clustering for its topology (no double pass)", () => {
    const pass = runHLMPass(dtus);
    assert.equal(pass.ok, true);
    assert.equal(pass.topology.stats.redundancyCount, pass.redundancies.redundancies.length);
    assert.deepEqual(
      pass.topology.clusters.map(c => c.clusterId),
      pass.clusters.clusters.map(c => c.clusterId),
      "topology should carry the very clusters runHLMPass computed",
    );
  });
});
