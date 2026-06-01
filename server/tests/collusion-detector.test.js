// F3 contract — multi-account collusion detection + its E2-cycle wire.

import { test } from "node:test";
import assert from "node:assert/strict";
import { detectCollusionRings } from "../lib/collusion-detector.js";
import { runEconomyAnomalyCycle } from "../emergent/economy-anomaly-cycle.js";

function hist(pairs) {
  // pairs: { "a:b": count }  → Map<"a:b",[{ts}]>
  const m = new Map();
  const now = Date.now();
  for (const [k, n] of Object.entries(pairs)) m.set(k, Array.from({ length: n }, () => ({ ts: now })));
  return m;
}

test("detects a 3-account ring A→B→C→A", () => {
  const r = detectCollusionRings(hist({ "A:B": 4, "B:C": 5, "C:A": 3 }), { minEdgeTrades: 3, minRingSize: 3 });
  assert.equal(r.ok, true);
  assert.equal(r.rings.length, 1);
  assert.deepEqual(r.rings[0].accounts, ["A", "B", "C"]);
  assert.equal(r.rings[0].totalTrades, 12);
});

test("ignores edges below the min-trade threshold (no ring)", () => {
  const r = detectCollusionRings(hist({ "A:B": 2, "B:C": 2, "C:A": 2 }), { minEdgeTrades: 3, minRingSize: 3 });
  assert.equal(r.rings.length, 0);
});

test("a linear chain (no cycle) is not a ring", () => {
  const r = detectCollusionRings(hist({ "A:B": 5, "B:C": 5 }), { minEdgeTrades: 3, minRingSize: 3 });
  assert.equal(r.rings.length, 0);
});

test("reciprocal 2-account pair is reported (and not a 3-ring)", () => {
  const r = detectCollusionRings(hist({ "A:B": 5, "B:A": 4 }), { minEdgeTrades: 3, minRingSize: 3 });
  assert.equal(r.rings.length, 0);
  assert.equal(r.reciprocalPairs.length, 1);
  assert.equal(r.reciprocalPairs[0].trades, 9);
});

test("accepts a plain-object count map and never throws on junk", () => {
  assert.equal(detectCollusionRings({ "A:B": 9, "B:C": 9, "C:A": 9 }).rings.length, 1);
  assert.equal(detectCollusionRings(null).ok, true);
  assert.equal(detectCollusionRings(undefined).rings.length, 0);
});

test("E2 cycle counts + pages an injected collusion ring (advisory, observe-only)", async () => {
  const counter = [];
  const alerts = [];
  const r = await runEconomyAnomalyCycle({
    db: { /* detectPathologies tolerates a stub; no economy findings */ prepare: () => ({ all: () => [], get: () => ({}) }) },
    incCounter: (kind) => counter.push(kind),
    alert: async (p) => alerts.push(p),
    washTradeCount: 0,
    collusionRings: [{ accounts: ["A", "B", "C"], size: 3, totalTrades: 12 }],
  });
  assert.equal(r.ok, true);
  assert.ok(counter.includes("collusion_ring"), "ring counted");
  assert.ok(alerts.some((a) => a.fields?.kind === "collusion_ring"), "ring paged as Critical");
  assert.equal(r.byKind.collusion_ring, 1);
});
