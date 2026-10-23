// Pins the 2026-10-22 consolidation fix: slow clustering (wall time spent
// waiting on a busy event loop) must not consume the promotion budget. Live,
// the old shape logged consolidation_defer_remaining done:0 every cycle.
import { test } from "node:test";
import assert from "node:assert/strict";
import { runConsolidationCycle } from "../lib/consolidation-cycle.js";

// Deterministic clock: each call advances by what the fakes "spend".
function clock() {
  let t = 1_000_000;
  return { now: () => t, spend: (ms) => { t += ms; } };
}

// A promoter that behaves like _promoteClusterBatch: checks the budget before
// each cluster and stops once exceeded.
function promoter(c, { perPromotionMs, budgetMs }) {
  const calls = [];
  const fn = async (clusters, tier, startedAt) => {
    let done = 0;
    for (const _cl of clusters) {
      if (c.now() - startedAt > budgetMs) break;
      c.spend(perPromotionMs);
      done++;
    }
    calls.push({ tier, done });
    return done;
  };
  return { fn, calls };
}

test("clustering that takes 87 s of wall time no longer starves promotion", async () => {
  const c = clock();
  const p = promoter(c, { perPromotionMs: 300, budgetMs: 4000 });
  const r = await runConsolidationCycle({
    budgetMs: 4000,
    now: c.now,
    clusterRegular: async () => { c.spend(87_000); return { clusters: new Array(8).fill({}) }; },
    clusterMega: async () => ({ clusters: [] }),
    promoteBatch: p.fn,
    megaPopulation: () => 0,
    hyperMinPopulation: 15,
  });
  assert.equal(r.megaPromoted, 8, "all 8 clusters promoted (old shape: 0)");
  assert.equal(r.clusterMs, 87_000);
  assert.equal(r.promoteMs, 2400);
});

test("the budget still bounds promotion work", async () => {
  const c = clock();
  const p = promoter(c, { perPromotionMs: 1500, budgetMs: 4000 });
  const r = await runConsolidationCycle({
    budgetMs: 4000,
    now: c.now,
    clusterRegular: async () => ({ clusters: new Array(10).fill({}) }),
    clusterMega: async () => { throw new Error("must not run: budget spent"); },
    promoteBatch: p.fn,
    megaPopulation: () => 100,
    hyperMinPopulation: 15,
  });
  // 0, 1500, 3000 elapsed → 3 promotions; at 4500 > 4000 it stops.
  assert.equal(r.megaPromoted, 3);
  assert.equal(r.hyperPromoted, 0);
});

test("hyper promotion gets the remaining budget, not a fresh one", async () => {
  const c = clock();
  const p = promoter(c, { perPromotionMs: 1000, budgetMs: 4000 });
  const r = await runConsolidationCycle({
    budgetMs: 4000,
    now: c.now,
    clusterRegular: async () => ({ clusters: new Array(2).fill({}) }),   // 2000 ms of promotion
    clusterMega: async () => { c.spend(30_000); return { clusters: new Array(10).fill({}) }; }, // slow cluster: not charged
    promoteBatch: p.fn,
    megaPopulation: () => 20,
    hyperMinPopulation: 15,
  });
  assert.equal(r.megaPromoted, 2);
  // Remaining 2000 ms: promotions start at 2000, 3000, 4000 (<= 4000) → 3.
  assert.equal(r.hyperPromoted, 3);
  assert.deepEqual(p.calls.map((x) => x.tier), ["mega", "hyper"]);
});

test("a clustering error is reported and does not abort the cycle", async () => {
  const errs = [];
  const r = await runConsolidationCycle({
    clusterRegular: async () => { throw new Error("boom"); },
    clusterMega: async () => ({ clusters: [{}] }),
    promoteBatch: async () => 1,
    megaPopulation: () => 20,
    hyperMinPopulation: 15,
    onError: (e) => errs.push(e.message),
  });
  assert.deepEqual(errs, ["boom"]);
  assert.equal(r.megaPromoted, 0);
  assert.equal(r.hyperPromoted, 1);
});
