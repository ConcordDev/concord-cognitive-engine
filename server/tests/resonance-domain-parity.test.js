// Contract tests for server/domains/resonance.js — cross-domain analogy /
// knowledge-graph resonance macros: proposePair, listPairs, resonanceGraph,
// pairDrilldown, resonanceAlerts, resonanceToInsight, listInsights, pairTrend.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerResonanceActions from "../domains/resonance.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`resonance.${name}`);
  if (!fn) throw new Error(`resonance.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerResonanceActions(register); });

// Fresh per-user store each test run.
beforeEach(() => { globalThis._concordSTATE = {}; });

// Two genuinely analogous sides: high invariant token overlap, low semantic
// (title/description) overlap — should classify as strong resonance.
const STRONG = {
  a: {
    domain: "immunology",
    title: "Adaptive immune memory",
    description: "lymphocyte clonal selection retains exposure",
    invariants: [
      "selective amplification of fit variants",
      "feedback regulation prevents runaway growth",
      "stored state enables faster future response",
    ],
  },
  b: {
    domain: "economics",
    title: "Market price discovery",
    description: "trader bidding settles asset valuation",
    invariants: [
      "selective amplification of fit variants",
      "feedback regulation prevents runaway growth",
      "stored state enables faster future response",
    ],
  },
};

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

describe("resonance.proposePair", () => {
  it("rejects a side missing a domain or title", () => {
    const r = call("proposePair", ctxA, { a: { domain: "x" }, b: { domain: "y", title: "t" } });
    assert.equal(r.ok, false);
  });

  it("creates and analyzes a strong-resonance pair, raising an alert", () => {
    const r = call("proposePair", ctxA, STRONG);
    assert.equal(r.ok, true);
    assert.ok(r.result.pair.id);
    assert.equal(r.result.pair.classification, "strong_resonance");
    assert.equal(r.result.alerted, true);
    assert.equal(r.result.totalPairs, 1);
  });

  it("isolates pairs per user", () => {
    call("proposePair", ctxA, STRONG);
    const rB = call("listPairs", ctxB, {});
    assert.equal(rB.ok, true);
    assert.equal(rB.result.count, 0);
  });
});

describe("resonance.listPairs", () => {
  it("returns pairs with class breakdown and average resonance", () => {
    call("proposePair", ctxA, STRONG);
    const r = call("listPairs", ctxA, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.count, 1);
    assert.ok(r.result.avgResonance > 0);
    assert.equal(r.result.byClass.strong_resonance, 1);
  });

  it("filters by minResonance and domain", () => {
    // A weak pair: shared semantic surface, no aligned invariants -> low resonance.
    call("proposePair", ctxA, {
      a: { domain: "weather", title: "rain forecast", description: "rain rain rain", invariants: ["q"] },
      b: { domain: "ocean", title: "rain tides", description: "rain rain rain", invariants: ["z"] },
    });
    call("proposePair", ctxA, STRONG);
    const all = call("listPairs", ctxA, {});
    assert.equal(all.result.count, 2);
    // STRONG resonates at ~1.0; the weak pair sits well below 0.9.
    const strongOnly = call("listPairs", ctxA, { minResonance: 0.9 });
    assert.equal(strongOnly.result.count, 1);
    assert.equal(call("listPairs", ctxA, { domain: "immunology" }).result.count, 1);
    assert.equal(call("listPairs", ctxA, { domain: "nonexistent" }).result.count, 0);
  });
});

describe("resonance.resonanceGraph", () => {
  it("returns an empty graph for a user with no pairs", () => {
    const r = call("resonanceGraph", ctxA, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.nodes.length, 0);
    assert.equal(r.result.edges.length, 0);
  });

  it("builds a domain network with one edge per cross-domain pair", () => {
    call("proposePair", ctxA, STRONG);
    const r = call("resonanceGraph", ctxA, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.stats.domains, 2);
    assert.equal(r.result.stats.connections, 1);
    assert.ok(r.result.stats.strongestEdge);
    assert.equal(r.result.stats.strongestEdge.classification, "strong_resonance");
  });
});

describe("resonance.pairDrilldown", () => {
  it("returns not-found for an unknown pair id", () => {
    const r = call("pairDrilldown", ctxA, { pairId: "missing" });
    assert.equal(r.ok, false);
  });

  it("maps invariant correspondences for a real pair", () => {
    const created = call("proposePair", ctxA, STRONG);
    const r = call("pairDrilldown", ctxA, { pairId: created.result.pair.id });
    assert.equal(r.ok, true);
    assert.equal(r.result.correspondences.length, 3);
    assert.ok(r.result.alignedCount >= 1);
    assert.ok(typeof r.result.interpretation === "string");
  });
});

describe("resonance.resonanceAlerts", () => {
  it("lists, acknowledges and clears alerts", () => {
    const created = call("proposePair", ctxA, STRONG);
    const alertList = call("resonanceAlerts", ctxA, {});
    assert.equal(alertList.ok, true);
    assert.equal(alertList.result.totalCount, 1);
    assert.equal(alertList.result.unacknowledgedCount, 1);

    const alertId = alertList.result.alerts[0].id;
    assert.equal(alertList.result.alerts[0].pairId, created.result.pair.id);

    const acked = call("resonanceAlerts", ctxA, { acknowledge: alertId });
    assert.equal(acked.result.unacknowledgedCount, 0);

    const cleared = call("resonanceAlerts", ctxA, { clearAcknowledged: true });
    assert.equal(cleared.result.totalCount, 0);
  });
});

describe("resonance.resonanceToInsight / listInsights", () => {
  it("rejects an unknown pair", () => {
    assert.equal(call("resonanceToInsight", ctxA, { pairId: "missing" }).ok, false);
  });

  it("promotes a strong pair to a citable hypothesis DTU", () => {
    const created = call("proposePair", ctxA, STRONG);
    const r = call("resonanceToInsight", ctxA, { pairId: created.result.pair.id });
    assert.equal(r.ok, true);
    assert.equal(r.result.citable, true);
    assert.equal(r.result.insight.kind, "hypothesis");
    assert.ok(r.result.insight.layers.human.length > 0);

    const list = call("listInsights", ctxA, {});
    assert.equal(list.ok, true);
    assert.equal(list.result.count, 1);
  });
});

describe("resonance.pairTrend", () => {
  it("returns not-found for an unknown pair", () => {
    assert.equal(call("pairTrend", ctxA, { pairId: "missing" }).ok, false);
  });

  it("appends a sample on each call and builds a series", () => {
    const created = call("proposePair", ctxA, STRONG);
    const t1 = call("pairTrend", ctxA, { pairId: created.result.pair.id });
    assert.equal(t1.ok, true);
    assert.equal(t1.result.samples, 1);

    const t2 = call("pairTrend", ctxA, { pairId: created.result.pair.id });
    assert.equal(t2.result.samples, 2);
    assert.ok(t2.result.peak >= t2.result.current);
    assert.ok(["rising", "falling", "stable"].includes(t2.result.direction));
  });
});
