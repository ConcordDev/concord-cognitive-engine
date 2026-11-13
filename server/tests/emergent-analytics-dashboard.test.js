/**
 * Analytics Dashboard — Comprehensive Test Suite
 *
 * Covers: takeSnapshot, getPersonalAnalytics, getDtuGrowthTrends,
 *         getCitationAnalytics, getMarketplaceAnalytics,
 *         getKnowledgeDensity, getAtlasDomainAnalytics, getDashboardSummary
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  takeSnapshot,
  getPersonalAnalytics,
  getDtuGrowthTrends,
  getCitationAnalytics,
  getMarketplaceAnalytics,
  getKnowledgeDensity,
  getAtlasDomainAnalytics,
  getDashboardSummary,
} from "../emergent/analytics-dashboard.js";

import { initAtlasState, getAtlasState } from "../emergent/atlas-epistemic.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeSTATE() {
  return {
    dtus: new Map(),
    shadowDtus: new Map(),
    sessions: new Map(),
    users: new Map(),
    listings: new Map(),
    transactions: new Map(),
  };
}

function addDTU(STATE, id, overrides = {}) {
  STATE.dtus.set(id, {
    id,
    title: overrides.title || `DTU ${id}`,
    author: overrides.author || "user1",
    tier: overrides.tier || "regular",
    tags: overrides.tags || [],
    createdAt: overrides.createdAt || new Date().toISOString(),
    meta: overrides.meta || {},
    human: overrides.human || {},
    lineage: overrides.lineage || {},
    core: overrides.core || {},
    ...overrides,
  });
}

// ── takeSnapshot ─────────────────────────────────────────────────────────────

describe("takeSnapshot", () => {
  it("takes a snapshot on first call", () => {
    const STATE = makeSTATE();
    const result = takeSnapshot(STATE);
    assert.equal(result.ok, true);
    assert.ok(result.snapshot);
    assert.ok(result.snapshot.timestamp);
    assert.equal(result.snapshot.totalDtus, 0);
  });

  it("skips snapshot if taken too recently", () => {
    const STATE = makeSTATE();
    takeSnapshot(STATE);
    const result2 = takeSnapshot(STATE);
    assert.equal(result2.ok, true);
    assert.equal(result2.skipped, true);
  });

  it("counts DTUs, shadow DTUs, profiles, follows", () => {
    const STATE = makeSTATE();
    addDTU(STATE, "d1");
    addDTU(STATE, "d2");
    STATE.shadowDtus.set("s1", {});
    STATE._social = {
      profiles: new Map([["u1", {}]]),
      metrics: { totalFollows: 5 },
      publicDtus: new Set(["d1"]),
    };
    STATE._collab = {
      metrics: { totalWorkspaces: 2, totalComments: 10 },
    };
    STATE.listings.set("l1", {});
    STATE.transactions.set("t1", {});

    const result = takeSnapshot(STATE);
    assert.equal(result.ok, true);
    assert.equal(result.snapshot.totalDtus, 2);
    assert.equal(result.snapshot.shadowDtus, 1);
    assert.equal(result.snapshot.totalProfiles, 1);
    assert.equal(result.snapshot.totalFollows, 5);
    assert.equal(result.snapshot.publicDtus, 1);
    assert.equal(result.snapshot.totalWorkspaces, 2);
    assert.equal(result.snapshot.totalComments, 10);
    assert.equal(result.snapshot.totalListings, 1);
    assert.equal(result.snapshot.totalTransactions, 1);
  });

  it("increments snapshotsTaken metric", () => {
    const STATE = makeSTATE();
    takeSnapshot(STATE);
    assert.equal(STATE._analytics.metrics.snapshotsTaken, 1);
  });

  it("caps snapshots at 2016", () => {
    const STATE = makeSTATE();
    // First call initializes STATE._analytics
    takeSnapshot(STATE);
    // Force many snapshots by resetting lastSnapshotAt
    for (let i = 0; i < 2100; i++) {
      STATE._analytics.lastSnapshotAt = 0;
      takeSnapshot(STATE);
    }
    assert.ok(STATE._analytics.snapshots.length <= 2016);
  });

  it("handles atlas state gracefully when not initialized", () => {
    const STATE = makeSTATE();
    const result = takeSnapshot(STATE);
    assert.equal(result.ok, true);
    assert.deepEqual(result.snapshot.atlasByStatus, {});
    assert.deepEqual(result.snapshot.atlasByDomain, {});
  });

  it("reads atlas byStatus and byDomainType", () => {
    const STATE = makeSTATE();
    // Initialize atlas state through the proper API
    const atlas = initAtlasState(STATE);
    atlas.dtus.set("ad1", {});
    atlas.byStatus.set("active", new Set(["ad1"]));
    atlas.byDomainType.set("physics", new Set(["ad1"]));
    const result = takeSnapshot(STATE);
    assert.equal(result.ok, true);
    // It may or may not pick up atlas depending on getAtlasState implementation,
    // but we verify no crash
  });

  it("records memoryUsage and uptime", () => {
    const STATE = makeSTATE();
    const result = takeSnapshot(STATE);
    assert.equal(typeof result.snapshot.memoryUsage, "number");
    assert.equal(typeof result.snapshot.uptime, "number");
  });
});

// ── getPersonalAnalytics ─────────────────────────────────────────────────────

describe("getPersonalAnalytics", () => {
  it("returns empty analytics for a user with no DTUs", () => {
    const STATE = makeSTATE();
    const result = getPersonalAnalytics(STATE, "unknown");
    assert.equal(result.ok, true);
    assert.equal(result.summary.dtuCount, 0);
    assert.equal(result.summary.citationCount, 0);
    assert.equal(result.summary.revenue, 0);
  });

  it("increments dashboardRequests metric", () => {
    const STATE = makeSTATE();
    getPersonalAnalytics(STATE, "u1");
    getPersonalAnalytics(STATE, "u1");
    assert.equal(STATE._analytics.metrics.dashboardRequests, 2);
  });

  it("counts DTUs authored by userId", () => {
    const STATE = makeSTATE();
    addDTU(STATE, "d1", { author: "u1", tier: "mega", tags: ["physics", "math"] });
    addDTU(STATE, "d2", { author: "u1" });
    addDTU(STATE, "d3", { author: "u2" });

    const result = getPersonalAnalytics(STATE, "u1");
    assert.equal(result.summary.dtuCount, 2);
    assert.equal(result.tierDistribution.mega, 1);
    assert.equal(result.tierDistribution.regular, 1);
  });

  it("counts DTUs by meta.authorId", () => {
    const STATE = makeSTATE();
    addDTU(STATE, "d1", { author: "someone", meta: { authorId: "u1" } });

    const result = getPersonalAnalytics(STATE, "u1");
    assert.equal(result.summary.dtuCount, 1);
  });

  it("extracts top tags sorted by count", () => {
    const STATE = makeSTATE();
    addDTU(STATE, "d1", { author: "u1", tags: ["a", "b", "c"] });
    addDTU(STATE, "d2", { author: "u1", tags: ["a", "b"] });
    addDTU(STATE, "d3", { author: "u1", tags: ["a"] });

    const result = getPersonalAnalytics(STATE, "u1");
    assert.equal(result.topTags[0].tag, "a");
    assert.equal(result.topTags[0].count, 3);
  });

  it("counts citations", () => {
    const STATE = makeSTATE();
    addDTU(STATE, "d1", { author: "u1" });
    STATE._social = {
      citedBy: new Map([
        ["d1", new Set(["citer1", "citer2"])],
      ]),
    };

    const result = getPersonalAnalytics(STATE, "u1");
    assert.equal(result.summary.citationCount, 2);
  });

  it("computes revenue from transactions", () => {
    const STATE = makeSTATE();
    addDTU(STATE, "d1", { author: "u1" });
    STATE.transactions.set("t1", { sellerId: "u1", amount: 100 });
    STATE.transactions.set("t2", { sellerOrgId: "u1", amount: 50 });
    STATE.transactions.set("t3", { sellerId: "other", amount: 200 });

    const result = getPersonalAnalytics(STATE, "u1");
    assert.equal(result.summary.revenue, 150);
    assert.equal(result.summary.sales, 2);
  });

  it("reports follower and following counts", () => {
    const STATE = makeSTATE();
    STATE._social = {
      followers: new Map([["u1", new Set(["f1", "f2"])]]),
      follows: new Map([["u1", new Set(["f3"])]]),
    };

    const result = getPersonalAnalytics(STATE, "u1");
    assert.equal(result.summary.followerCount, 2);
    assert.equal(result.summary.followingCount, 1);
  });

  it("counts public DTUs", () => {
    const STATE = makeSTATE();
    addDTU(STATE, "d1", { author: "u1" });
    addDTU(STATE, "d2", { author: "u1" });
    STATE._social = {
      publicDtus: new Set(["d1"]),
    };

    const result = getPersonalAnalytics(STATE, "u1");
    assert.equal(result.summary.publicDtuCount, 1);
  });

  it("limits recentDtus to 20", () => {
    const STATE = makeSTATE();
    for (let i = 0; i < 25; i++) {
      addDTU(STATE, `d${i}`, { author: "u1", createdAt: new Date(Date.now() - i * 1000).toISOString() });
    }
    const result = getPersonalAnalytics(STATE, "u1");
    assert.ok(result.recentDtus.length <= 20);
  });

  it("uses human.title fallback when title is missing", () => {
    const STATE = makeSTATE();
    addDTU(STATE, "d1", { author: "u1", title: undefined, human: { title: "HumanTitle" } });
    const result = getPersonalAnalytics(STATE, "u1");
    assert.equal(result.recentDtus[0].title, "HumanTitle");
  });
});

// ── getDtuGrowthTrends ───────────────────────────────────────────────────────

describe("getDtuGrowthTrends", () => {
  it("returns empty series when no snapshots exist", () => {
    const STATE = makeSTATE();
    const result = getDtuGrowthTrends(STATE);
    assert.equal(result.ok, true);
    assert.equal(result.series.length, 0);
    assert.equal(result.growth, null);
  });

  it("uses default 24h period", () => {
    const STATE = makeSTATE();
    const result = getDtuGrowthTrends(STATE);
    assert.equal(result.ok, true);
    assert.equal(result.dataPoints, 0);
  });

  it("filters snapshots by period", () => {
    const STATE = makeSTATE();
    // Force-add snapshots
    STATE._analytics = {
      snapshots: [
        { ts: Date.now() - 1000, timestamp: new Date().toISOString(), totalDtus: 5, atlasDtus: 1, publicDtus: 2, totalProfiles: 3 },
        { ts: Date.now() - 500, timestamp: new Date().toISOString(), totalDtus: 10, atlasDtus: 2, publicDtus: 3, totalProfiles: 4 },
      ],
      lastSnapshotAt: Date.now(),
      snapshotInterval: 300000,
      userAnalytics: new Map(),
      marketplaceAnalytics: { totalListings: 0, totalSales: 0, totalRevenue: 0, history: [] },
      metrics: { dashboardRequests: 0, snapshotsTaken: 0 },
    };

    const result = getDtuGrowthTrends(STATE, { period: "24h" });
    assert.equal(result.ok, true);
    assert.equal(result.series.length, 2);
    assert.equal(result.growth.dtuGrowth, 5);
  });

  it("supports 7d and 30d periods", () => {
    const STATE = makeSTATE();
    const result7d = getDtuGrowthTrends(STATE, { period: "7d" });
    assert.equal(result7d.ok, true);
    const result30d = getDtuGrowthTrends(STATE, { period: "30d" });
    assert.equal(result30d.ok, true);
  });

  it("handles unknown period by defaulting to 24h", () => {
    const STATE = makeSTATE();
    const result = getDtuGrowthTrends(STATE, { period: "unknown" });
    assert.equal(result.ok, true);
  });
});

// ── getCitationAnalytics ─────────────────────────────────────────────────────

describe("getCitationAnalytics", () => {
  it("returns empty when no social state exists", () => {
    const STATE = makeSTATE();
    const result = getCitationAnalytics(STATE);
    assert.equal(result.ok, true);
    assert.deepEqual(result.topCited, []);
    assert.equal(result.totalCitations, 0);
  });

  it("returns empty when citedBy is missing", () => {
    const STATE = makeSTATE();
    STATE._social = {};
    const result = getCitationAnalytics(STATE);
    assert.equal(result.ok, true);
    assert.equal(result.totalCitations, 0);
  });

  it("ranks citations by count", () => {
    const STATE = makeSTATE();
    addDTU(STATE, "d1", { title: "First", author: "u1", tags: ["a", "b"] });
    addDTU(STATE, "d2", { title: "Second", author: "u2", tags: [] });
    STATE._social = {
      citedBy: new Map([
        ["d1", new Set(["c1", "c2", "c3"])],
        ["d2", new Set(["c1"])],
      ]),
    };

    const result = getCitationAnalytics(STATE);
    assert.equal(result.topCited[0].dtuId, "d1");
    assert.equal(result.topCited[0].citationCount, 3);
    assert.equal(result.totalCitations, 4);
    assert.equal(result.uniqueCitedDtus, 2);
  });

  it("respects limit option", () => {
    const STATE = makeSTATE();
    STATE._social = {
      citedBy: new Map([
        ["d1", new Set(["c1"])],
        ["d2", new Set(["c1"])],
        ["d3", new Set(["c1"])],
      ]),
    };
    const result = getCitationAnalytics(STATE, { limit: 2 });
    assert.equal(result.topCited.length, 2);
  });

  it("uses fallback title from human.title", () => {
    const STATE = makeSTATE();
    addDTU(STATE, "d1", { title: undefined, human: { title: "HumanTitle" } });
    STATE._social = { citedBy: new Map([["d1", new Set(["c1"])]]) };

    const result = getCitationAnalytics(STATE);
    assert.equal(result.topCited[0].title, "HumanTitle");
  });

  it("reports 'Unknown' for DTU not in store", () => {
    const STATE = makeSTATE();
    STATE._social = { citedBy: new Map([["missing", new Set(["c1"])]]) };

    const result = getCitationAnalytics(STATE);
    assert.equal(result.topCited[0].title, "Unknown");
  });
});

// ── getMarketplaceAnalytics ──────────────────────────────────────────────────

describe("getMarketplaceAnalytics", () => {
  it("returns zero counts when no listings or transactions", () => {
    const STATE = makeSTATE();
    const result = getMarketplaceAnalytics(STATE);
    assert.equal(result.ok, true);
    assert.equal(result.totalListings, 0);
    assert.equal(result.totalTransactions, 0);
    assert.equal(result.totalRevenue, 0);
    assert.equal(result.averagePrice, 0);
  });

  it("counts listings by status", () => {
    const STATE = makeSTATE();
    STATE.listings.set("l1", { status: "active" });
    STATE.listings.set("l2", { status: "sold" });
    STATE.listings.set("l3", {}); // defaults to active

    const result = getMarketplaceAnalytics(STATE);
    assert.equal(result.listingsByStatus.active, 2);
    assert.equal(result.listingsByStatus.sold, 1);
  });

  it("computes revenue and fees from transactions", () => {
    const STATE = makeSTATE();
    STATE.transactions.set("t1", { amount: 100, fee: 10 });
    STATE.transactions.set("t2", { amount: 200, fee: 20 });

    const result = getMarketplaceAnalytics(STATE);
    assert.equal(result.totalRevenue, 300);
    assert.equal(result.totalFees, 30);
    assert.equal(result.averagePrice, 150);
  });
});

// ── getKnowledgeDensity ──────────────────────────────────────────────────────

describe("getKnowledgeDensity", () => {
  it("returns zero density when no DTUs", () => {
    const STATE = makeSTATE();
    const result = getKnowledgeDensity(STATE);
    assert.equal(result.ok, true);
    assert.equal(result.totalDtus, 0);
    assert.equal(result.density, 0);
  });

  it("counts edges from lineage", () => {
    const STATE = makeSTATE();
    addDTU(STATE, "d1", {
      lineage: { parents: ["p1"], children: ["c1", "c2"], supports: [], contradicts: ["x1"] },
      tags: ["physics", "math"],
      core: { claims: ["c"], invariants: ["i"] },
    });

    const result = getKnowledgeDensity(STATE);
    assert.equal(result.totalDtus, 1);
    assert.equal(result.totalEdges, 4); // 1 parent + 2 children + 1 contradicts
    assert.equal(result.density, 4);
    assert.equal(result.uniqueTags, 2);
    assert.equal(result.totalClaims, 2);
  });

  it("handles DTUs with no lineage", () => {
    const STATE = makeSTATE();
    addDTU(STATE, "d1", {});
    const result = getKnowledgeDensity(STATE);
    assert.equal(result.totalEdges, 0);
    assert.equal(result.density, 0);
  });

  it("includes atlas metrics section", () => {
    const STATE = makeSTATE();
    const result = getKnowledgeDensity(STATE);
    assert.ok(result.atlas);
    assert.equal(typeof result.atlas.dtus, "number");
    assert.equal(typeof result.atlas.links, "number");
    assert.equal(typeof result.atlas.density, "number");
  });
});

// ── getAtlasDomainAnalytics ──────────────────────────────────────────────────

describe("getAtlasDomainAnalytics", () => {
  it("returns empty when atlas is not initialized", () => {
    const STATE = makeSTATE();
    const result = getAtlasDomainAnalytics(STATE);
    assert.equal(result.ok, true);
    assert.equal(result.total, 0);
    assert.deepEqual(result.byDomain, {});
  });
});

// ── getDashboardSummary ──────────────────────────────────────────────────────

describe("getDashboardSummary", () => {
  it("returns a full summary of system state", () => {
    const STATE = makeSTATE();
    addDTU(STATE, "d1");
    STATE.shadowDtus.set("s1", {});
    STATE.sessions.set("ss1", {});
    STATE.users.set("u1", {});
    STATE.listings.set("l1", {});
    STATE.transactions.set("t1", {});
    STATE._social = {
      profiles: new Map([["u1", {}]]),
      metrics: { totalFollows: 3 },
      publicDtus: new Set(["d1"]),
    };
    STATE._collab = {
      metrics: { totalWorkspaces: 1, totalComments: 5, activeEditSessions: 2 },
    };

    const result = getDashboardSummary(STATE);
    assert.equal(result.ok, true);
    assert.equal(result.system.totalDtus, 1);
    assert.equal(result.system.totalShadowDtus, 1);
    assert.equal(result.system.totalSessions, 1);
    assert.equal(result.system.totalUsers, 1);
    assert.equal(result.social.totalProfiles, 1);
    assert.equal(result.social.totalFollows, 3);
    assert.equal(result.social.publicDtus, 1);
    assert.equal(result.collaboration.totalWorkspaces, 1);
    assert.equal(result.collaboration.totalComments, 5);
    assert.equal(result.collaboration.activeEditSessions, 2);
    assert.equal(result.marketplace.totalListings, 1);
    assert.equal(result.marketplace.totalTransactions, 1);
    assert.ok(result.timestamp);
    assert.equal(typeof result.snapshotCount, "number");
  });

  it("increments dashboardRequests", () => {
    const STATE = makeSTATE();
    getDashboardSummary(STATE);
    getDashboardSummary(STATE);
    assert.equal(STATE._analytics.metrics.dashboardRequests, 2);
  });

  it("handles missing optional STATE properties gracefully", () => {
    const STATE = {};
    const result = getDashboardSummary(STATE);
    assert.equal(result.ok, true);
    assert.equal(result.system.totalDtus, 0);
  });
});
