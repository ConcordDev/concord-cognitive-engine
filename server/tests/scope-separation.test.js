/**
 * Tests for Scope Separation — Global / Marketplace / Local
 *
 * Coverage:
 *   1. Scope constants & validation
 *   2. Influence matrix (one-way flow enforcement)
 *   3. DTU scope assignment & retrieval
 *   4. Global DTU validation (empirical + philosophical)
 *   5. Marketplace listing validation
 *   6. Promotion pipeline (upward promotion rules)
 *   7. Founder override mechanism
 *   8. Heartbeat scope gates
 *   9. Marketplace analytics gates & recording
 *  10. Global tick
 *  11. Query helpers (list by scope, promotion history, override log)
 *  12. Scope metrics
 *  13. Prohibition enforcement (hard rules)
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  SCOPES, ALL_SCOPES, ALL_DTU_CLASSES,
  HEARTBEAT_CONFIG,
  checkInfluence, isValidScope, isUpwardPromotion,
  ensureScopeState, assignScope, getDtuScope,
  validateGlobalDtu, validateMarketplaceListing,
  promoteDtu,
  gateCreateDtu, gateHeartbeatOp, gateMarketplaceAnalytics,
  recordMarketplaceAnalytics, runGlobalTick,
  listDtusByScope, getPromotionHistory, getOverrideLog,
  getMarketplaceAnalytics, getScopeMetrics,
} from "../emergent/scope-separation.js";

// ── Helpers ─────────────────────────────────────────────────────────────────

function freshState() {
  return {
    dtus: new Map(),
    listings: new Map(),
    entitlements: new Map(),
    transactions: new Map(),
    globalIndex: { byHash: new Map(), byId: new Map() },
  };
}

function makeDtu(overrides = {}) {
  const id = overrides.id || `dtu_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  return {
    id,
    title: overrides.title || "Test DTU",
    tags: overrides.tags || [],
    tier: overrides.tier || "regular",
    scope: overrides.scope || "local",
    lineage: overrides.lineage || [],
    source: overrides.source || "local",
    meta: overrides.meta || {},
    core: overrides.core || {
      definitions: ["A test definition"],
      invariants: ["Must be testable"],
      examples: ["Example 1"],
      claims: ["Claim A"],
      nextActions: [],
    },
    human: overrides.human || { summary: "Test DTU", bullets: [], examples: [] },
    machine: overrides.machine || {},
    cretiHuman: overrides.cretiHuman || "Test CRETI",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    authority: overrides.authority || { model: "council", score: 4, votes: {} },
  };
}

function addDtu(STATE, dtu) {
  STATE.dtus.set(dtu.id, dtu);
  return dtu;
}

// ══════════════════════════════════════════════════════════════════════════════
// 1. Scope Constants & Validation
// ══════════════════════════════════════════════════════════════════════════════

describe("Scope Constants", () => {
  it("defines five scopes", () => {
    assert.equal(ALL_SCOPES.length, 5);
    assert.ok(ALL_SCOPES.includes("local"));
    assert.ok(ALL_SCOPES.includes("marketplace"));
    assert.ok(ALL_SCOPES.includes("global"));
    assert.ok(ALL_SCOPES.includes("creative_global"));
    assert.ok(ALL_SCOPES.includes("shadow"));
  });

  it("scopes are frozen", () => {
    assert.ok(Object.isFrozen(SCOPES));
    assert.ok(Object.isFrozen(ALL_SCOPES));
  });

  it("DTU classes defined", () => {
    assert.equal(ALL_DTU_CLASSES.length, 2);
    assert.ok(ALL_DTU_CLASSES.includes("empirical"));
    assert.ok(ALL_DTU_CLASSES.includes("philosophical"));
  });

  it("isValidScope accepts valid scopes", () => {
    assert.ok(isValidScope("local"));
    assert.ok(isValidScope("marketplace"));
    assert.ok(isValidScope("global"));
  });

  it("isValidScope rejects invalid scopes", () => {
    assert.ok(!isValidScope("unknown"));
    assert.ok(!isValidScope(""));
    assert.ok(!isValidScope(null));
    assert.ok(!isValidScope(undefined));
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 2. Influence Matrix
// ══════════════════════════════════════════════════════════════════════════════

describe("Influence Matrix", () => {
  it("Global → Global: allowed", () => {
    const r = checkInfluence("global", "global");
    assert.ok(r.allowed);
  });

  it("Global → Marketplace: allowed", () => {
    const r = checkInfluence("global", "marketplace");
    assert.ok(r.allowed);
  });

  it("Global → Local: allowed", () => {
    const r = checkInfluence("global", "local");
    assert.ok(r.allowed);
  });

  it("Marketplace → Global: BLOCKED", () => {
    const r = checkInfluence("marketplace", "global");
    assert.ok(!r.allowed);
    assert.match(r.reason, /influence_blocked/);
  });

  it("Marketplace → Marketplace: allowed", () => {
    const r = checkInfluence("marketplace", "marketplace");
    assert.ok(r.allowed);
  });

  it("Marketplace → Local: allowed", () => {
    const r = checkInfluence("marketplace", "local");
    assert.ok(r.allowed);
  });

  it("Local → Global: BLOCKED", () => {
    const r = checkInfluence("local", "global");
    assert.ok(!r.allowed);
    assert.match(r.reason, /influence_blocked/);
  });

  it("Local → Marketplace: BLOCKED", () => {
    const r = checkInfluence("local", "marketplace");
    assert.ok(!r.allowed);
    assert.match(r.reason, /influence_blocked/);
  });

  it("Local → Local: allowed", () => {
    const r = checkInfluence("local", "local");
    assert.ok(r.allowed);
  });

  it("rejects invalid source scope", () => {
    const r = checkInfluence("bogus", "local");
    assert.ok(!r.allowed);
    assert.match(r.reason, /invalid_source_scope/);
  });

  it("rejects invalid target scope", () => {
    const r = checkInfluence("local", "bogus");
    assert.ok(!r.allowed);
    assert.match(r.reason, /invalid_target_scope/);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 3. DTU Scope Assignment & Retrieval
// ══════════════════════════════════════════════════════════════════════════════

describe("DTU Scope Assignment", () => {
  it("assignScope sets scope on DTU", () => {
    const dtu = makeDtu();
    assignScope(dtu, "global");
    assert.equal(dtu.scope, "global");
  });

  it("assignScope defaults to local for invalid scope", () => {
    const dtu = makeDtu();
    assignScope(dtu, "nonsense");
    assert.equal(dtu.scope, "local");
  });

  it("getDtuScope returns scope", () => {
    const dtu = makeDtu({ scope: "marketplace" });
    assert.equal(getDtuScope(dtu), "marketplace");
  });

  it("getDtuScope defaults to local if unset", () => {
    const dtu = makeDtu();
    delete dtu.scope;
    assert.equal(getDtuScope(dtu), "local");
  });

  it("isUpwardPromotion: local → global", () => {
    assert.ok(isUpwardPromotion("local", "global"));
  });

  it("isUpwardPromotion: local → marketplace", () => {
    assert.ok(isUpwardPromotion("local", "marketplace"));
  });

  it("isUpwardPromotion: marketplace → global", () => {
    assert.ok(isUpwardPromotion("marketplace", "global"));
  });

  it("isUpwardPromotion: global → local is NOT upward", () => {
    assert.ok(!isUpwardPromotion("global", "local"));
  });

  it("isUpwardPromotion: same scope is NOT upward", () => {
    assert.ok(!isUpwardPromotion("local", "local"));
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 4. Global DTU Validation
// ══════════════════════════════════════════════════════════════════════════════

describe("Global DTU Validation", () => {
  it("accepts well-formed empirical DTU", () => {
    const dtu = makeDtu({
      source: "research_paper",
      meta: {
        dtuClass: "empirical",
        citations: [{ url: "https://example.com/paper" }],
        confidence: 0.85,
        uncertaintyBounds: [0.80, 0.90],
      },
    });
    const r = validateGlobalDtu(dtu);
    assert.ok(r.ok, `Expected ok but got errors: ${r.errors.join(", ")}`);
    assert.equal(r.dtuClass, "empirical");
  });

  it("rejects empirical DTU without citations", () => {
    const dtu = makeDtu({
      source: "test",
      meta: { dtuClass: "empirical", confidence: 0.85 },
    });
    const r = validateGlobalDtu(dtu);
    assert.ok(!r.ok);
    assert.ok(r.errors.some(e => e.includes("citations")));
  });

  it("rejects empirical DTU without confidence", () => {
    const dtu = makeDtu({
      source: "test",
      meta: { dtuClass: "empirical", citations: [{ url: "x" }] },
    });
    const r = validateGlobalDtu(dtu);
    assert.ok(!r.ok);
    assert.ok(r.errors.some(e => e.includes("confidence")));
  });

  it("rejects DTU without provenance (source=unknown)", () => {
    const dtu = makeDtu({ source: "unknown", meta: { dtuClass: "empirical", citations: ["x"], confidence: 0.5 } });
    const r = validateGlobalDtu(dtu);
    assert.ok(!r.ok);
    assert.ok(r.errors.some(e => e.includes("provenance")));
  });

  it("rejects DTU with insufficient structure (score < 3)", () => {
    const dtu = makeDtu({
      source: "test",
      core: { definitions: ["one"], invariants: [], examples: [], claims: [], nextActions: [] },
      meta: { dtuClass: "empirical", citations: ["x"], confidence: 0.5 },
    });
    const r = validateGlobalDtu(dtu);
    assert.ok(!r.ok);
    assert.ok(r.errors.some(e => e.includes("minimum_structure")));
  });

  it("accepts philosophical DTU with proper labeling", () => {
    const dtu = makeDtu({
      source: "philosophy_dept",
      tags: ["philosophical", "ethics"],
      meta: { dtuClass: "philosophical" },
    });
    const r = validateGlobalDtu(dtu);
    assert.ok(r.ok, `Expected ok but got errors: ${r.errors.join(", ")}`);
    assert.equal(r.dtuClass, "philosophical");
  });

  it("rejects philosophical DTU without label tag", () => {
    const dtu = makeDtu({
      source: "test",
      tags: ["ethics"],
      meta: { dtuClass: "philosophical" },
    });
    const r = validateGlobalDtu(dtu);
    assert.ok(!r.ok);
    assert.ok(r.errors.some(e => e.includes("must_be_labeled")));
  });

  it("rejects philosophical DTU claiming factual authority", () => {
    const dtu = makeDtu({
      source: "test",
      tags: ["philosophical", "fact"],
      meta: { dtuClass: "philosophical" },
    });
    const r = validateGlobalDtu(dtu);
    assert.ok(!r.ok);
    assert.ok(r.errors.some(e => e.includes("no_factual_claims")));
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 5. Marketplace Listing Validation
// ══════════════════════════════════════════════════════════════════════════════

describe("Marketplace Listing Validation", () => {
  it("accepts valid listing", () => {
    const dtu = makeDtu({ title: "Beat Pack Vol.1" });
    const listing = { orgId: "org_1", license: "commercial" };
    const r = validateMarketplaceListing(dtu, listing);
    assert.ok(r.ok);
  });

  it("rejects listing for untitled DTU", () => {
    const dtu = makeDtu({ title: "Untitled DTU" });
    const listing = { orgId: "org_1", license: "commercial" };
    const r = validateMarketplaceListing(dtu, listing);
    assert.ok(!r.ok);
    assert.ok(r.errors.some(e => e.includes("title")));
  });

  it("rejects listing without orgId", () => {
    const dtu = makeDtu({ title: "Beat Pack" });
    const listing = { license: "commercial" };
    const r = validateMarketplaceListing(dtu, listing);
    assert.ok(!r.ok);
    assert.ok(r.errors.some(e => e.includes("attribution")));
  });

  it("rejects listing without license", () => {
    const dtu = makeDtu({ title: "Beat Pack" });
    const listing = { orgId: "org_1" };
    const r = validateMarketplaceListing(dtu, listing);
    assert.ok(!r.ok);
    assert.ok(r.errors.some(e => e.includes("license")));
  });

  it("rejects quarantined DTU", () => {
    const dtu = makeDtu({ title: "Suspicious Pack", tags: ["quarantine:injection-review"] });
    const listing = { orgId: "org_1", license: "commercial" };
    const r = validateMarketplaceListing(dtu, listing);
    assert.ok(!r.ok);
    assert.ok(r.errors.some(e => e.includes("quarantined")));
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 6. Promotion Pipeline
// ══════════════════════════════════════════════════════════════════════════════

describe("Promotion Pipeline", () => {
  let STATE;
  beforeEach(() => {
    STATE = freshState();
  });

  it("promotes local → marketplace with author intent", () => {
    const dtu = addDtu(STATE, makeDtu({ scope: "local", title: "Beat Pack" }));
    const r = promoteDtu(STATE, dtu.id, "marketplace", { actorId: "user_1" });
    assert.ok(r.ok);
    assert.equal(r.promotion.fromScope, "local");
    assert.equal(r.promotion.toScope, "marketplace");
    assert.equal(dtu.scope, "marketplace");
  });

  it("rejects upward promotion without actorId", () => {
    const dtu = addDtu(STATE, makeDtu({ scope: "local" }));
    const r = promoteDtu(STATE, dtu.id, "marketplace", {});
    assert.ok(!r.ok);
    assert.match(r.error, /author_intent/);
  });

  it("rejects local → global without global requirements", () => {
    const dtu = addDtu(STATE, makeDtu({
      scope: "local",
      source: "unknown",
      meta: {},
    }));
    const r = promoteDtu(STATE, dtu.id, "global", { actorId: "user_1" });
    assert.ok(!r.ok);
    assert.match(r.error, /global_council_rejected/);
    assert.ok(r.validationErrors.length > 0);
  });

  it("promotes local → global for well-formed empirical DTU", () => {
    const dtu = addDtu(STATE, makeDtu({
      scope: "local",
      source: "research",
      meta: {
        dtuClass: "empirical",
        citations: [{ url: "https://example.com" }],
        confidence: 0.9,
        uncertaintyBounds: [0.85, 0.95],
      },
    }));
    const r = promoteDtu(STATE, dtu.id, "global", { actorId: "user_1" });
    assert.ok(r.ok, `Expected ok but got: ${r.error}`);
    assert.equal(dtu.scope, "global");
  });

  it("rejects promotion to same scope", () => {
    const dtu = addDtu(STATE, makeDtu({ scope: "local" }));
    const r = promoteDtu(STATE, dtu.id, "local", { actorId: "user_1" });
    assert.ok(!r.ok);
    assert.match(r.error, /already_in_target/);
  });

  it("allows downward movement (global → local)", () => {
    const dtu = addDtu(STATE, makeDtu({ scope: "global" }));
    const r = promoteDtu(STATE, dtu.id, "local", {});
    assert.ok(r.ok);
    assert.equal(dtu.scope, "local");
  });

  it("rejects promotion of non-existent DTU", () => {
    const r = promoteDtu(STATE, "nonexistent", "global", { actorId: "user_1" });
    assert.ok(!r.ok);
    assert.match(r.error, /not_found/);
  });

  it("preserves provenance (scope history)", () => {
    const dtu = addDtu(STATE, makeDtu({ scope: "local", title: "Promo Test" }));
    promoteDtu(STATE, dtu.id, "marketplace", { actorId: "user_1", reason: "listing" });
    assert.ok(dtu.meta.scopeHistory);
    assert.equal(dtu.meta.scopeHistory.length, 1);
    assert.equal(dtu.meta.scopeHistory[0].from, "local");
    assert.equal(dtu.meta.scopeHistory[0].to, "marketplace");
    assert.equal(dtu.meta.scopeHistory[0].by, "user_1");
  });

  it("records promotion in audit log", () => {
    const dtu = addDtu(STATE, makeDtu({ scope: "local", title: "Log Test" }));
    promoteDtu(STATE, dtu.id, "marketplace", { actorId: "user_1" });
    const ss = STATE._scopeSeparation;
    assert.equal(ss.promotionLog.length, 1);
    assert.equal(ss.promotionLog[0].dtuId, dtu.id);
  });

  it("rejects marketplace → global with untitled DTU", () => {
    const dtu = addDtu(STATE, makeDtu({ scope: "local", title: "Untitled DTU" }));
    const r = promoteDtu(STATE, dtu.id, "marketplace", { actorId: "user_1" });
    assert.ok(!r.ok);
    assert.match(r.error, /titled/);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 7. Founder Override
// ══════════════════════════════════════════════════════════════════════════════

describe("Founder Override", () => {
  let STATE;
  beforeEach(() => {
    STATE = freshState();
  });

  it("logs founder override", () => {
    const dtu = addDtu(STATE, makeDtu({ scope: "local" }));
    promoteDtu(STATE, dtu.id, "marketplace", {
      actorId: "founder",
      override: true,
      verified: true,
      reason: "founder_decision",
    });
    const ss = STATE._scopeSeparation;
    assert.equal(ss.overrideLog.length, 1);
    assert.equal(ss.overrideLog[0].reason, "founder_decision");
    assert.equal(ss.metrics.founderOverrides, 1);
  });

  it("override requires both override AND verified flags", () => {
    const dtu = addDtu(STATE, makeDtu({ scope: "local" }));
    promoteDtu(STATE, dtu.id, "marketplace", {
      actorId: "founder",
      override: true,
      verified: false,
    });
    const ss = STATE._scopeSeparation;
    assert.equal(ss.overrideLog.length, 0); // Not logged as override
    assert.equal(ss.metrics.founderOverrides, 0);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 8. Heartbeat Scope Gates
// ══════════════════════════════════════════════════════════════════════════════

describe("Heartbeat Scope Gates", () => {
  it("Local: can generate DTUs", () => {
    const r = gateHeartbeatOp("local", "generate_dtu");
    assert.ok(r.ok);
  });

  it("Local: can mutate lattice", () => {
    const r = gateHeartbeatOp("local", "mutate_lattice");
    assert.ok(r.ok);
  });

  it("Global: can generate DTUs (from Global parents)", () => {
    const r = gateHeartbeatOp("global", "generate_dtu");
    assert.ok(r.ok);
  });

  it("Global: can update resonance", () => {
    const r = gateHeartbeatOp("global", "update_resonance");
    assert.ok(r.ok);
  });

  it("Global: CANNOT ingest local", () => {
    const r = gateHeartbeatOp("global", "ingest_local");
    assert.ok(!r.ok);
    assert.match(r.reason, /global_cannot_ingest_local/);
  });

  it("Global: CANNOT ingest marketplace", () => {
    const r = gateHeartbeatOp("global", "ingest_marketplace");
    assert.ok(!r.ok);
    assert.match(r.reason, /global_cannot_ingest_marketplace/);
  });

  it("Marketplace: heartbeat disabled", () => {
    const r = gateHeartbeatOp("marketplace", "generate_dtu");
    assert.ok(!r.ok);
    assert.match(r.reason, /heartbeat_disabled/);
  });

  it("Marketplace: ALL operations blocked (no heartbeat)", () => {
    for (const op of ["generate_dtu", "mutate_lattice", "ingest_local", "update_resonance"]) {
      const r = gateHeartbeatOp("marketplace", op);
      assert.ok(!r.ok, `Expected ${op} to be blocked in marketplace`);
    }
  });

  it("Heartbeat config: Local interval = 15s", () => {
    assert.equal(HEARTBEAT_CONFIG.local.intervalMs, 15000);
    assert.ok(HEARTBEAT_CONFIG.local.enabled);
  });

  it("Heartbeat config: Global interval = 5min", () => {
    assert.equal(HEARTBEAT_CONFIG.global.intervalMs, 300000);
    assert.ok(HEARTBEAT_CONFIG.global.enabled);
  });

  it("Heartbeat config: Marketplace disabled", () => {
    assert.ok(!HEARTBEAT_CONFIG.marketplace.enabled);
    assert.equal(HEARTBEAT_CONFIG.marketplace.intervalMs, 0);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 9. Marketplace Analytics Gates & Recording
// ══════════════════════════════════════════════════════════════════════════════

describe("Marketplace Analytics", () => {
  it("allows recording sales", () => {
    const r = gateMarketplaceAnalytics("record_sale");
    assert.ok(r.ok);
  });

  it("allows recording usage", () => {
    const r = gateMarketplaceAnalytics("record_usage");
    assert.ok(r.ok);
  });

  it("allows querying analytics", () => {
    const r = gateMarketplaceAnalytics("query_sales");
    assert.ok(r.ok);
  });

  it("BLOCKS create_dtu", () => {
    const r = gateMarketplaceAnalytics("create_dtu");
    assert.ok(!r.ok);
  });

  it("BLOCKS mutate_dtu", () => {
    const r = gateMarketplaceAnalytics("mutate_dtu");
    assert.ok(!r.ok);
  });

  it("BLOCKS promote_dtu", () => {
    const r = gateMarketplaceAnalytics("promote_dtu");
    assert.ok(!r.ok);
  });

  it("BLOCKS influence_global", () => {
    const r = gateMarketplaceAnalytics("influence_global");
    assert.ok(!r.ok);
  });

  it("BLOCKS run_heartbeat", () => {
    const r = gateMarketplaceAnalytics("run_heartbeat");
    assert.ok(!r.ok);
  });

  it("BLOCKS unknown operations (fail-closed)", () => {
    const r = gateMarketplaceAnalytics("something_random");
    assert.ok(!r.ok);
    assert.match(r.reason, /unknown_operation_blocked/);
  });

  it("records sale analytics event", () => {
    const STATE = freshState();
    const r = recordMarketplaceAnalytics(STATE, "sale", { amount: 100, buyer: "org_1" });
    assert.ok(r.ok);
    assert.ok(r.event.id.startsWith("mkt_"));
    const ss = STATE._scopeSeparation;
    assert.equal(ss.analytics.sales.length, 1);
  });

  it("records usage analytics event", () => {
    const STATE = freshState();
    const r = recordMarketplaceAnalytics(STATE, "usage", { dtuId: "dtu_1", action: "view" });
    assert.ok(r.ok);
    assert.equal(STATE._scopeSeparation.analytics.usage.length, 1);
  });

  it("rejects unknown analytics type", () => {
    const STATE = freshState();
    const r = recordMarketplaceAnalytics(STATE, "unknown_type", {});
    assert.ok(!r.ok);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 10. Global Tick
// ══════════════════════════════════════════════════════════════════════════════

describe("Global Tick", () => {
  let STATE;
  beforeEach(() => {
    STATE = freshState();
  });

  it("runs global tick and counts global DTUs", () => {
    addDtu(STATE, makeDtu({ id: "dtu_g1", scope: "global" }));
    addDtu(STATE, makeDtu({ id: "dtu_g2", scope: "global" }));
    addDtu(STATE, makeDtu({ id: "dtu_l1", scope: "local" }));

    const r = runGlobalTick(STATE);
    assert.ok(r.ok);
    assert.equal(r.globalDtuCount, 2);
    assert.equal(r.globalDtuIds.length, 2);
    assert.ok(r.globalDtuIds.includes("dtu_g1"));
    assert.ok(r.globalDtuIds.includes("dtu_g2"));
    assert.ok(!r.globalDtuIds.includes("dtu_l1"));
  });

  it("increments tick count", () => {
    runGlobalTick(STATE);
    runGlobalTick(STATE);
    runGlobalTick(STATE);
    const ss = STATE._scopeSeparation;
    assert.equal(ss.globalTick.tickCount, 3);
    assert.equal(ss.metrics.globalTickCount, 3);
  });

  it("records lastTickAt timestamp", () => {
    const r = runGlobalTick(STATE);
    assert.ok(r.timestamp);
    assert.ok(STATE._scopeSeparation.globalTick.lastTickAt);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 11. Query Helpers
// ══════════════════════════════════════════════════════════════════════════════

describe("Query Helpers", () => {
  let STATE;
  beforeEach(() => {
    STATE = freshState();
    addDtu(STATE, makeDtu({ id: "g1", scope: "global" }));
    addDtu(STATE, makeDtu({ id: "g2", scope: "global" }));
    addDtu(STATE, makeDtu({ id: "m1", scope: "marketplace" }));
    addDtu(STATE, makeDtu({ id: "l1", scope: "local" }));
    addDtu(STATE, makeDtu({ id: "l2", scope: "local" }));
    addDtu(STATE, makeDtu({ id: "l3", scope: "local" }));
  });

  it("listDtusByScope: global", () => {
    const r = listDtusByScope(STATE, "global");
    assert.ok(r.ok);
    assert.equal(r.total, 2);
    assert.equal(r.scope, "global");
  });

  it("listDtusByScope: marketplace", () => {
    const r = listDtusByScope(STATE, "marketplace");
    assert.ok(r.ok);
    assert.equal(r.total, 1);
  });

  it("listDtusByScope: local", () => {
    const r = listDtusByScope(STATE, "local");
    assert.ok(r.ok);
    assert.equal(r.total, 3);
  });

  it("listDtusByScope: respects limit", () => {
    const r = listDtusByScope(STATE, "local", { limit: 2 });
    assert.ok(r.ok);
    assert.equal(r.dtus.length, 2);
    assert.equal(r.total, 3);
  });

  it("listDtusByScope: offset returns the next page and keeps the full total", () => {
    const s = freshState();
    for (const [id, updatedAt] of [["p0", "2020-01-01T00:00:00.000Z"], ["p1", "2021-01-01T00:00:00.000Z"], ["p2", "2022-01-01T00:00:00.000Z"]]) {
      const dtu = makeDtu({ id, scope: "local" });
      dtu.updatedAt = updatedAt;
      addDtu(s, dtu);
    }
    const page = listDtusByScope(s, "local", { limit: 1, offset: 1 });
    assert.equal(page.ok, true);
    assert.equal(page.total, 3);
    assert.equal(page.dtus.length, 1);
    assert.equal(page.dtus[0].id, "p1");
    assert.equal(page.offset, 1);
  });

  it("listDtusByScope: rejects invalid scope", () => {
    const r = listDtusByScope(STATE, "bogus");
    assert.ok(!r.ok);
  });

  it("getPromotionHistory: returns records", () => {
    const _dtu = addDtu(STATE, makeDtu({ id: "promo_test", scope: "local", title: "Promo Test" }));
    promoteDtu(STATE, "promo_test", "marketplace", { actorId: "user_1" });
    const r = getPromotionHistory(STATE, "promo_test");
    assert.ok(r.ok);
    assert.equal(r.promotions.length, 1);
  });

  it("getOverrideLog: returns records", () => {
    const _dtu = addDtu(STATE, makeDtu({ id: "override_test", scope: "local", title: "Override" }));
    promoteDtu(STATE, "override_test", "marketplace", {
      actorId: "founder",
      override: true,
      verified: true,
      reason: "test",
    });
    const r = getOverrideLog(STATE);
    assert.ok(r.ok);
    assert.equal(r.overrides.length, 1);
  });

  it("getMarketplaceAnalytics: returns data", () => {
    recordMarketplaceAnalytics(STATE, "sale", { amount: 50 });
    recordMarketplaceAnalytics(STATE, "usage", { action: "view" });
    const r = getMarketplaceAnalytics(STATE);
    assert.ok(r.ok);
    assert.equal(r.sales.length, 1);
    assert.equal(r.usage.length, 1);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 12. Scope Metrics
// ══════════════════════════════════════════════════════════════════════════════

describe("Scope Metrics", () => {
  it("counts DTUs by scope", () => {
    const STATE = freshState();
    addDtu(STATE, makeDtu({ id: "g1", scope: "global" }));
    addDtu(STATE, makeDtu({ id: "l1", scope: "local" }));
    addDtu(STATE, makeDtu({ id: "l2", scope: "local" }));

    const r = getScopeMetrics(STATE);
    assert.ok(r.ok);
    assert.equal(r.scopeCounts.global, 1);
    assert.equal(r.scopeCounts.local, 2);
    assert.equal(r.scopeCounts.marketplace, 0);
  });

  it("includes influence matrix", () => {
    const STATE = freshState();
    const r = getScopeMetrics(STATE);
    assert.ok(r.influenceMatrix);
    assert.ok(r.influenceMatrix.global);
    assert.ok(r.influenceMatrix.local);
  });

  it("includes heartbeat config", () => {
    const STATE = freshState();
    const r = getScopeMetrics(STATE);
    assert.ok(r.heartbeatConfig);
    assert.ok(r.heartbeatConfig.local);
    assert.ok(r.heartbeatConfig.marketplace);
    assert.ok(r.heartbeatConfig.global);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 13. Prohibition Enforcement (Hard Rules from Spec)
// ══════════════════════════════════════════════════════════════════════════════

describe("Prohibition Enforcement", () => {
  let STATE;
  beforeEach(() => {
    STATE = freshState();
  });

  // Global Prohibitions
  it("Global: No influence from Local (influence matrix)", () => {
    const r = checkInfluence("local", "global");
    assert.ok(!r.allowed);
  });

  it("Global: No influence from Marketplace (influence matrix)", () => {
    const r = checkInfluence("marketplace", "global");
    assert.ok(!r.allowed);
  });

  it("Global: No auto-promotion from lower scope", () => {
    const dtu = addDtu(STATE, makeDtu({ scope: "local" }));
    // Without actorId = no author intent = auto-promotion attempt
    const r = promoteDtu(STATE, dtu.id, "global", {});
    assert.ok(!r.ok);
    assert.match(r.error, /author_intent/);
  });

  it("Global: No fast heartbeat (5-min minimum enforced)", () => {
    assert.ok(HEARTBEAT_CONFIG.global.minMs >= 60000);
  });

  // Marketplace Prohibitions
  it("Marketplace: No DTU auto-generation", () => {
    const r = gateCreateDtu("marketplace");
    assert.ok(!r.ok);
    assert.match(r.reason, /marketplace_cannot_create/);
  });

  it("Marketplace: No heartbeat", () => {
    assert.ok(!HEARTBEAT_CONFIG.marketplace.enabled);
    assert.equal(HEARTBEAT_CONFIG.marketplace.intervalMs, 0);
  });

  it("Marketplace: No influence on Global DTUs", () => {
    const r = checkInfluence("marketplace", "global");
    assert.ok(!r.allowed);
  });

  it("Marketplace: No silent promotion", () => {
    const dtu = addDtu(STATE, makeDtu({ scope: "marketplace", title: "Market Item" }));
    const r = promoteDtu(STATE, dtu.id, "global", {});
    assert.ok(!r.ok);
    assert.match(r.error, /author_intent/);
  });

  // Local Prohibitions
  it("Local: No auto-push upward", () => {
    const dtu = addDtu(STATE, makeDtu({ scope: "local" }));
    const r = promoteDtu(STATE, dtu.id, "marketplace", {});
    assert.ok(!r.ok);
    assert.match(r.error, /author_intent/);
  });

  it("Local: No implicit influence on Global", () => {
    const r = checkInfluence("local", "global");
    assert.ok(!r.allowed);
  });

  it("Local: No silent marketplace posting", () => {
    const r = checkInfluence("local", "marketplace");
    assert.ok(!r.allowed);
  });

  // DTU Creation Scope Gates
  it("gateCreateDtu: local is free", () => {
    const r = gateCreateDtu("local");
    assert.ok(r.ok);
  });

  it("gateCreateDtu: marketplace cannot create", () => {
    const r = gateCreateDtu("marketplace");
    assert.ok(!r.ok);
  });

  it("gateCreateDtu: global autogen requires global parents", () => {
    const r = gateCreateDtu("global", { isAutoGenerated: true, parentDtuIds: [] });
    assert.ok(!r.ok);
    assert.match(r.reason, /requires_global_parents/);
  });

  it("gateCreateDtu: global autogen rejects non-global parents", () => {
    const r = gateCreateDtu("global", {
      isAutoGenerated: true,
      parentDtuIds: ["dtu_1"],
      parentScopes: ["local"],
    });
    assert.ok(!r.ok);
    assert.match(r.reason, /parents_must_be_global/);
  });

  it("gateCreateDtu: global autogen accepts global parents", () => {
    const r = gateCreateDtu("global", {
      isAutoGenerated: true,
      parentDtuIds: ["dtu_g1"],
      parentScopes: ["global"],
    });
    assert.ok(r.ok);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 14. State Initialization
// ══════════════════════════════════════════════════════════════════════════════

describe("State Initialization", () => {
  it("ensureScopeState creates state on fresh object", () => {
    const STATE = freshState();
    const ss = ensureScopeState(STATE);
    assert.ok(ss.initialized);
    assert.ok(ss.initializedAt);
    assert.ok(Array.isArray(ss.promotionLog));
    assert.ok(Array.isArray(ss.overrideLog));
    assert.ok(ss.analytics);
    assert.ok(ss.globalTick);
    assert.ok(ss.metrics);
  });

  it("ensureScopeState is idempotent", () => {
    const STATE = freshState();
    const ss1 = ensureScopeState(STATE);
    ss1.metrics.promotionAttempts = 42;
    const ss2 = ensureScopeState(STATE);
    assert.equal(ss2.metrics.promotionAttempts, 42); // Same object
  });
});
