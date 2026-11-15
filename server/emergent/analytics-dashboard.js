/**
 * Concord — Analytics Dashboard System
 *
 * Personal analytics, marketplace performance, DTU growth trends,
 * citation graph views, knowledge density metrics.
 */

import { getAtlasState } from "./atlas-epistemic.js";
import logger from '../logger.js';

// ── Analytics State ──────────────────────────────────────────────────────

function getAnalyticsState(STATE) {
  if (!STATE._analytics) {
    STATE._analytics = {
      snapshots: [],           // periodic state snapshots
      lastSnapshotAt: 0,
      snapshotInterval: 300000, // 5 minutes
      userAnalytics: new Map(), // userId → analytics cache
      marketplaceAnalytics: {
        totalListings: 0,
        totalSales: 0,
        totalRevenue: 0,
        history: [],
      },
      metrics: {
        dashboardRequests: 0,
        snapshotsTaken: 0,
      },
    };
  }
  return STATE._analytics;
}

// ── Snapshot System ──────────────────────────────────────────────────────

/**
 * Take a periodic snapshot of system state for trend analysis.
 */
export function takeSnapshot(STATE) {
  const analytics = getAnalyticsState(STATE);
  const now = Date.now();

  // Don't snapshot too frequently
  if (now - analytics.lastSnapshotAt < analytics.snapshotInterval) {
    return { ok: true, skipped: true };
  }

  const snapshot = {
    ts: now,
    timestamp: new Date().toISOString(),

    // DTU counts
    totalDtus: STATE.dtus?.size || 0,
    shadowDtus: STATE.shadowDtus?.size || 0,

    // Atlas counts
    atlasDtus: 0,
    atlasByStatus: {},
    atlasByDomain: {},

    // Social metrics
    totalProfiles: STATE._social?.profiles?.size || 0,
    totalFollows: STATE._social?.metrics?.totalFollows || 0,
    publicDtus: STATE._social?.publicDtus?.size || 0,

    // Collaboration metrics
    totalWorkspaces: STATE._collab?.metrics?.totalWorkspaces || 0,
    totalComments: STATE._collab?.metrics?.totalComments || 0,

    // Marketplace
    totalListings: STATE.listings?.size || 0,
    totalTransactions: STATE.transactions?.size || 0,

    // System health
    memoryUsage: process.memoryUsage?.()?.heapUsed || 0,
    uptime: process.uptime?.() || 0,
  };

  // Atlas-specific data
  try {
    const atlas = getAtlasState(STATE);
    snapshot.atlasDtus = atlas.dtus?.size || 0;
    for (const [status, ids] of (atlas.byStatus || new Map())) {
      snapshot.atlasByStatus[status] = ids.size;
    }
    for (const [domain, ids] of (atlas.byDomainType || new Map())) {
      snapshot.atlasByDomain[domain] = ids.size;
    }
  } catch (_e) { logger.debug('emergent:analytics-dashboard', 'atlas may not be initialized', { error: _e?.message }); }

  analytics.snapshots.push(snapshot);
  analytics.lastSnapshotAt = now;
  analytics.metrics.snapshotsTaken++;

  // Keep last 2016 snapshots (7 days at 5-min intervals). The growth
  // view offers 7d/30d/90d ranges; the old 288 cap (24 hours) meant
  // anything past a day was structurally empty. Longer ranges show
  // the retained window.
  if (analytics.snapshots.length > 2016) {
    analytics.snapshots = analytics.snapshots.slice(-2016);
  }

  return { ok: true, snapshot };
}

// ── Personal Analytics ───────────────────────────────────────────────────

/**
 * Get personal analytics for a user.
 */
export function getPersonalAnalytics(STATE, userId) {
  const analytics = getAnalyticsState(STATE);
  analytics.metrics.dashboardRequests++;

  let dtuCount = 0;
  let citationCount = 0;
  const tagDistribution = new Map();
  const tierDistribution = { regular: 0, mega: 0, hyper: 0, shadow: 0 };
  const recentDtus = [];

  // Count DTUs by this user
  if (STATE.dtus) {
    for (const dtu of STATE.dtus.values()) {
      const isAuthor = dtu.author === userId || dtu.meta?.authorId === userId;
      if (!isAuthor) continue;

      dtuCount++;
      tierDistribution[dtu.tier || "regular"]++;

      for (const tag of (dtu.tags || [])) {
        tagDistribution.set(tag, (tagDistribution.get(tag) || 0) + 1);
      }

      recentDtus.push({
        id: dtu.id,
        title: dtu.title || dtu.human?.title || "Untitled",
        tier: dtu.tier || "regular",
        createdAt: dtu.createdAt || dtu.meta?.createdAt,
      });
    }
  }

  // Citations
  const social = STATE._social;
  if (social?.citedBy) {
    for (const [dtuId, citers] of social.citedBy) {
      const dtu = STATE.dtus?.get(dtuId);
      if (dtu && (dtu.author === userId || dtu.meta?.authorId === userId)) {
        citationCount += citers.size;
      }
    }
  }

  // Sort recent DTUs by date
  recentDtus.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());

  // Top tags
  const topTags = Array.from(tagDistribution.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([tag, count]) => ({ tag, count }));

  // Marketplace revenue
  let revenue = 0;
  let sales = 0;
  if (STATE.transactions) {
    for (const tx of STATE.transactions.values()) {
      if (tx.sellerOrgId === userId || tx.sellerId === userId) {
        revenue += tx.amount || 0;
        sales++;
      }
    }
  }

  return {
    ok: true,
    userId,
    summary: {
      dtuCount,
      citationCount,
      followerCount: (social?.followers?.get(userId) || new Set()).size,
      followingCount: (social?.follows?.get(userId) || new Set()).size,
      publicDtuCount: social?.publicDtus ? Array.from(STATE.dtus?.values() || []).filter(d => (d.author === userId || d.meta?.authorId === userId) && social.publicDtus.has(d.id)).length : 0,
      revenue,
      sales,
    },
    tierDistribution,
    topTags,
    recentDtus: recentDtus.slice(0, 20),
  };
}

// ── DTU Growth Trends ────────────────────────────────────────────────────

export function getDtuGrowthTrends(STATE, options = {}) {
  const analytics = getAnalyticsState(STATE);
  const period = options.period || "24h";

  let snapshots = analytics.snapshots;

  // Filter by period. FIX-analytics-007: "90d" used to fall through to
  // the 24h window, so the 90d view silently queried a single day.
  const now = Date.now();
  const PERIOD_MS = { "24h": 86400000, "7d": 604800000, "30d": 2592000000, "90d": 7776000000 };
  const periodMs = PERIOD_MS[period] || 86400000;
  snapshots = snapshots.filter(s => now - s.ts < periodMs);

  // Build growth series. FIX-analytics-007: the Platform growth panel
  // reads { ts, users, dtus } points and a totals block; this function
  // returned only { timestamp, totalDtus, totalProfiles } and no
  // totals at all, so every cell rendered a dash and the chart had no
  // plottable time or values — under a "Live" page label. The panel's
  // field names now ride alongside the native ones (users = profiles,
  // dtus = total DTUs), and totals come from the latest snapshot in
  // range. activeUsers / revenueUsd are not captured by snapshots and
  // are reported as null (the panel renders those two as dashes,
  // honestly) rather than invented.
  const series = snapshots.map(s => ({
    timestamp: s.timestamp,
    ts: s.timestamp,
    totalDtus: s.totalDtus,
    dtus: s.totalDtus || 0,
    atlasDtus: s.atlasDtus || 0,
    publicDtus: s.publicDtus || 0,
    totalProfiles: s.totalProfiles || 0,
    users: s.totalProfiles || 0,
  }));
  const totals = series.length > 0 ? {
    users: series[series.length - 1].totalProfiles,
    dtus: series[series.length - 1].totalDtus,
    activeUsers: null,
    revenueUsd: null,
  } : null;

  // Calculate growth rate
  const first = series[0];
  const last = series[series.length - 1];
  const growth = first && last ? {
    dtuGrowth: last.totalDtus - first.totalDtus,
    atlasGrowth: last.atlasDtus - (first.atlasDtus || 0),
    profileGrowth: last.totalProfiles - (first.totalProfiles || 0),
    period,
  } : null;

  return { ok: true, series, growth, totals, dataPoints: series.length };
}

// ── Citation Analytics ───────────────────────────────────────────────────

export function getCitationAnalytics(STATE, options = {}) {
  const social = STATE._social;
  if (!social?.citedBy) return { ok: true, topCited: [], totalCitations: 0 };

  const citations = [];
  for (const [dtuId, citers] of social.citedBy) {
    const dtu = STATE.dtus?.get(dtuId);
    citations.push({
      dtuId,
      title: dtu?.title || dtu?.human?.title || "Unknown",
      authorId: dtu?.author || dtu?.meta?.authorId,
      citationCount: citers.size,
      tags: (dtu?.tags || []).slice(0, 5),
    });
  }

  citations.sort((a, b) => b.citationCount - a.citationCount);

  const totalCitations = citations.reduce((s, c) => s + c.citationCount, 0);

  return {
    ok: true,
    topCited: citations.slice(0, options.limit || 20),
    totalCitations,
    uniqueCitedDtus: citations.length,
  };
}

// ── Marketplace Analytics ────────────────────────────────────────────────

export function getMarketplaceAnalytics(STATE) {
  const _analytics = getAnalyticsState(STATE);

  const listingCount = STATE.listings?.size || 0;
  const transactionCount = STATE.transactions?.size || 0;
  let totalRevenue = 0;
  let totalFees = 0;

  // Listings by status
  const byStatus = { active: 0, sold: 0, withdrawn: 0 };
  if (STATE.listings) {
    for (const listing of STATE.listings.values()) {
      byStatus[listing.status || "active"]++;
    }
  }

  // Transaction totals
  if (STATE.transactions) {
    for (const tx of STATE.transactions.values()) {
      totalRevenue += tx.amount || 0;
      totalFees += tx.fee || 0;
    }
  }

  return {
    ok: true,
    totalListings: listingCount,
    listingsByStatus: byStatus,
    totalTransactions: transactionCount,
    totalRevenue,
    totalFees,
    averagePrice: transactionCount > 0 ? Math.round(totalRevenue / transactionCount * 100) / 100 : 0,
  };
}

// ── Knowledge Density Metrics ────────────────────────────────────────────

export function getKnowledgeDensity(STATE) {
  const totalDtus = STATE.dtus?.size || 0;
  let totalEdges = 0;
  const totalTags = new Set();
  let totalClaims = 0;

  // Count edges/relationships
  if (STATE.dtus) {
    for (const dtu of STATE.dtus.values()) {
      const lineage = dtu.lineage || {};
      totalEdges += (lineage.parents?.length || 0) + (lineage.children?.length || 0) +
                    (lineage.supports?.length || 0) + (lineage.contradicts?.length || 0);
      for (const tag of (dtu.tags || [])) totalTags.add(tag);
      totalClaims += (dtu.core?.claims?.length || 0) + (dtu.core?.invariants?.length || 0);
    }
  }

  // Atlas metrics
  let atlasDtus = 0;
  let atlasLinks = 0;
  let atlasEntities = 0;
  try {
    const atlas = getAtlasState(STATE);
    atlasDtus = atlas.dtus?.size || 0;
    atlasLinks = atlas.links?.length || 0;
    atlasEntities = atlas.entities?.size || 0;
  } catch (_e) { logger.debug('emergent:analytics-dashboard', 'ok', { error: _e?.message }); }

  // Density = edges per DTU (higher = more interconnected)
  const density = totalDtus > 0 ? Math.round((totalEdges / totalDtus) * 100) / 100 : 0;
  const atlasDensity = atlasDtus > 0 ? Math.round((atlasLinks / atlasDtus) * 100) / 100 : 0;

  return {
    ok: true,
    totalDtus,
    totalEdges,
    density,
    uniqueTags: totalTags.size,
    totalClaims,
    atlas: {
      dtus: atlasDtus,
      links: atlasLinks,
      entities: atlasEntities,
      density: atlasDensity,
    },
  };
}

// ── Atlas Domain Distribution ────────────────────────────────────────────

export function getAtlasDomainAnalytics(STATE) {
  try {
    const atlas = getAtlasState(STATE);
    const byDomain = {};
    const byClass = {};
    const byStatus = {};
    const confidenceDistribution = { high: 0, medium: 0, low: 0 };

    for (const dtu of atlas.dtus.values()) {
      byDomain[dtu.domainType] = (byDomain[dtu.domainType] || 0) + 1;
      byClass[dtu.epistemicClass] = (byClass[dtu.epistemicClass] || 0) + 1;
      byStatus[dtu.status] = (byStatus[dtu.status] || 0) + 1;

      if (dtu.scores.confidence_overall >= 0.7) confidenceDistribution.high++;
      else if (dtu.scores.confidence_overall >= 0.4) confidenceDistribution.medium++;
      else confidenceDistribution.low++;
    }

    return { ok: true, byDomain, byClass, byStatus, confidenceDistribution, total: atlas.dtus.size };
  } catch {
    return { ok: true, byDomain: {}, byClass: {}, byStatus: {}, confidenceDistribution: {}, total: 0 };
  }
}

// ── Dashboard Summary ────────────────────────────────────────────────────

export function getDashboardSummary(STATE) {
  const analytics = getAnalyticsState(STATE);
  analytics.metrics.dashboardRequests++;

  return {
    ok: true,
    system: {
      totalDtus: STATE.dtus?.size || 0,
      totalShadowDtus: STATE.shadowDtus?.size || 0,
      totalSessions: STATE.sessions?.size || 0,
      totalUsers: STATE.users?.size || 0,
    },
    social: {
      totalProfiles: STATE._social?.profiles?.size || 0,
      totalFollows: STATE._social?.metrics?.totalFollows || 0,
      publicDtus: STATE._social?.publicDtus?.size || 0,
    },
    collaboration: {
      totalWorkspaces: STATE._collab?.metrics?.totalWorkspaces || 0,
      totalComments: STATE._collab?.metrics?.totalComments || 0,
      activeEditSessions: STATE._collab?.metrics?.activeEditSessions || 0,
    },
    marketplace: {
      totalListings: STATE.listings?.size || 0,
      totalTransactions: STATE.transactions?.size || 0,
    },
    analytics: analytics.metrics,
    snapshotCount: analytics.snapshots.length,
    timestamp: new Date().toISOString(),
  };
}
