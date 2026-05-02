/**
 * News Lens Hub — The Window to the World
 *
 * The News lens is special. It's the ONLY lens where all event DTUs are visible
 * in aggregate. But even News is filtered by user preference.
 *
 * You open News and see YOUR subscribed domains. The person who subscribes to
 * science and health sees science and health news. The person who subscribes to
 * economics and governance sees that. Same lens. Different view. Personalized
 * without algorithmic manipulation.
 *
 * No algorithm deciding what you should see. No engagement optimization.
 * No "trending" section designed to keep you scrolling. Just your subscriptions.
 * Your filters. Your thresholds.
 *
 * Compression keeps the News lens manageable over time:
 *   - Yesterday's events compress into daily summaries (Mega DTUs)
 *   - Daily summaries compress into weekly Megas
 *   - Weekly Megas compress into monthly Hypers
 *   - Surface stays clean and current. Depth is preserved.
 */

import {
  EVENT_SCOPE_MAP,
  ensureSubscriptionState,
  getUserSubscription,
  getEventReceivingLenses,
} from "./event-scoping.js";

// ══════════════════════════════════════════════════════════════════════════════
// NEWS LENS — PERSONALIZED VIEWS
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Query the News lens with user-personalized filtering.
 *
 * Returns event DTUs filtered by:
 *   1. User's subscribed domains (from their lens subscriptions)
 *   2. CRETI minimum threshold
 *   3. Confidence minimum threshold
 *   4. Domain whitelist (optional further narrowing)
 *   5. Time range
 *
 * @param {Object} STATE - Global state
 * @param {string} userId - The requesting user
 * @param {Object} opts - Query options
 * @param {number} opts.limit - Max results (default 50)
 * @param {number} opts.offset - Pagination offset
 * @param {string} opts.domain - Filter to specific domain
 * @param {string} opts.stance - Filter by epistemological stance
 * @param {number} opts.minCRETI - Override user's min CRETI
 * @param {string} opts.since - ISO timestamp, only events after this
 * @param {string} opts.until - ISO timestamp, only events before this
 * @param {string} opts.sortBy - Sort: 'newest', 'creti', 'confidence'
 * @param {boolean} opts.includeCompressed - Include Mega/Hyper DTUs
 * @returns {{ ok, events, total, filters }}
 */
export function queryNewsLens(STATE, userId, opts = {}) {
  const sub = getUserSubscription(STATE, userId);
  const limit = Math.min(Math.max(opts.limit || 50, 1), 200);
  const offset = Math.max(opts.offset || 0, 0);

  // Build effective filters from user subscription + query opts
  const effectiveFilters = {
    domains: opts.domain
      ? [opts.domain]
      : (sub.newsFilters?.domains?.length > 0 ? sub.newsFilters.domains : null),
    subscribedLenses: sub.subscribedLenses,
    minCRETI: opts.minCRETI ?? sub.newsFilters?.minCRETI ?? 0,
    minConfidence: opts.minConfidence ?? sub.newsFilters?.minConfidence ?? 0,
    stance: opts.stance || null,
    since: opts.since || null,
    until: opts.until || null,
    includeCompressed: opts.includeCompressed ?? false,
  };

  // Collect event DTUs from STATE
  const candidates = [];
  for (const dtu of STATE.dtus.values()) {
    // Must be from event bridge
    if (!dtu.meta?.eventOrigin) continue;

    // Tier filter
    if (!effectiveFilters.includeCompressed && (dtu.tier === "mega" || dtu.tier === "hyper")) {
      continue;
    }

    // Scope check — DTU must target at least one of user's subscribed lenses
    // OR if no subscriptions, show all news lens content
    const dtuLenses = dtu.scope?.lenses || [];
    if (effectiveFilters.subscribedLenses.length > 0) {
      const hasOverlap = dtuLenses.some(l => effectiveFilters.subscribedLenses.includes(l));
      // Also always include if DTU targets 'news' lens and user has any subscription
      const targetsNews = dtuLenses.includes("news");
      if (!hasOverlap && !targetsNews) continue;
    }

    // Domain filter
    if (effectiveFilters.domains) {
      const dtuDomain = dtu.domain || dtu.meta?.sourceEventType?.split(":")?.[0] || "";
      const matchesDomain = effectiveFilters.domains.some(d =>
        dtuDomain.includes(d) || d.includes(dtuDomain)
      );
      if (!matchesDomain) continue;
    }

    // CRETI threshold
    const cretiScore = dtu.cretiScore || dtu.meta?.cretiScore || 0;
    if (cretiScore < effectiveFilters.minCRETI) continue;

    // Confidence threshold
    const confidence = dtu.meta?.confidence || 0;
    if (confidence < effectiveFilters.minConfidence) continue;

    // Stance filter
    if (effectiveFilters.stance) {
      if (dtu.meta?.epistemologicalStance !== effectiveFilters.stance) continue;
    }

    // Time range
    const dtuTime = dtu.createdAt || dtu.timestamp;
    if (effectiveFilters.since && dtuTime < effectiveFilters.since) continue;
    if (effectiveFilters.until && dtuTime > effectiveFilters.until) continue;

    candidates.push(dtu);
  }

  // Sort
  const sortBy = opts.sortBy || "newest";
  switch (sortBy) {
    case "creti":
      candidates.sort((a, b) =>
        (b.cretiScore || b.meta?.cretiScore || 0) -
        (a.cretiScore || a.meta?.cretiScore || 0)
      );
      break;
    case "confidence":
      candidates.sort((a, b) =>
        (b.meta?.confidence || 0) - (a.meta?.confidence || 0)
      );
      break;
    case "newest":
    default:
      candidates.sort((a, b) =>
        (b.createdAt || b.timestamp || "").localeCompare(a.createdAt || a.timestamp || "")
      );
  }

  const total = candidates.length;
  const events = candidates.slice(offset, offset + limit).map(dtu => ({
    id: dtu.id,
    title: dtu.title,
    domain: dtu.domain,
    tier: dtu.tier,
    creti: dtu.cretiScore || dtu.meta?.cretiScore || 0,
    confidence: dtu.meta?.confidence || 0,
    stance: dtu.meta?.epistemologicalStance || "unknown",
    lenses: dtu.scope?.lenses || [],
    eventType: dtu.meta?.sourceEventType,
    crossRefCount: dtu.meta?.crossRefCount || 0,
    summary: dtu.human?.summary || dtu.title,
    createdAt: dtu.createdAt || dtu.timestamp,
    isExternal: dtu.meta?.isExternal || false,
    externalSource: dtu.meta?.externalSource,
  }));

  return {
    ok: true,
    events,
    total,
    limit,
    offset,
    filters: effectiveFilters,
  };
}

/**
 * Get a summary of the News lens — domain counts, stance distribution, etc.
 */
export function getNewsLensSummary(STATE, userId) {
  const sub = getUserSubscription(STATE, userId);
  const domainCounts = {};
  const stanceCounts = { observed: 0, reported: 0, corroborated: 0, unknown: 0 };
  let total = 0;
  let avgCreti = 0;

  for (const dtu of STATE.dtus.values()) {
    if (!dtu.meta?.eventOrigin) continue;
    if (dtu.tier === "mega" || dtu.tier === "hyper") continue;

    // Scope check
    const dtuLenses = dtu.scope?.lenses || [];
    if (sub.subscribedLenses.length > 0) {
      const hasOverlap = dtuLenses.some(l => sub.subscribedLenses.includes(l));
      const targetsNews = dtuLenses.includes("news");
      if (!hasOverlap && !targetsNews) continue;
    }

    total++;
    const domain = dtu.domain || "other";
    domainCounts[domain] = (domainCounts[domain] || 0) + 1;
    const stance = dtu.meta?.epistemologicalStance || "unknown";
    stanceCounts[stance] = (stanceCounts[stance] || 0) + 1;
    avgCreti += (dtu.cretiScore || dtu.meta?.cretiScore || 0);
  }

  if (total > 0) avgCreti = Math.round(avgCreti / total);

  return {
    ok: true,
    total,
    avgCreti,
    domainCounts,
    stanceCounts,
    subscribedLenses: sub.subscribedLenses,
    newsFilters: sub.newsFilters,
  };
}

/**
 * Get trending topics in the News lens.
 * Finds event types and domains with the highest activity in the last N hours.
 */
export function getNewsTrending(STATE, opts = {}) {
  const hoursBack = opts.hours || 24;
  const cutoff = new Date(Date.now() - hoursBack * 3600_000).toISOString();
  const topN = opts.limit || 10;

  const typeCounts = {};
  const domainCounts = {};

  for (const dtu of STATE.dtus.values()) {
    if (!dtu.meta?.eventOrigin) continue;
    const dtuTime = dtu.createdAt || dtu.timestamp;
    if (dtuTime < cutoff) continue;

    const eventType = dtu.meta?.sourceEventType || "unknown";
    const domain = dtu.domain || "other";
    typeCounts[eventType] = (typeCounts[eventType] || 0) + 1;
    domainCounts[domain] = (domainCounts[domain] || 0) + 1;
  }

  const topTypes = Object.entries(typeCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([type, count]) => ({ type, count }));

  const topDomains = Object.entries(domainCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([domain, count]) => ({ domain, count }));

  return {
    ok: true,
    hoursBack,
    topTypes,
    topDomains,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// NEWS DTU COMPRESSION — Temporal Aggregation
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Compress old event DTUs into time-scoped Mega DTUs.
 *
 * Yesterday's event DTUs → daily summary Mega
 * Last week's daily Megas → weekly Mega
 * Last month's weekly Megas → monthly Hyper
 *
 * The surface stays clean and current. The depth is preserved.
 * You can drill into any Mega/Hyper and see the individual events.
 *
 * @param {Object} STATE - Global state
 * @param {Object} opts
 * @param {number} opts.dailyAgeHours - Compress events older than N hours into daily Mega (default 24)
 * @param {number} opts.weeklyAgeDays - Compress daily Megas older than N days into weekly (default 7)
 * @param {number} opts.monthlyAgeDays - Compress weekly Megas older than N days into monthly Hyper (default 30)
 * @param {number} opts.minClusterSize - Minimum events to form a Mega (default 3)
 * @returns {{ ok, dailyMegas, weeklyMegas, monthlyHypers }}
 */
export function compressNewsEvents(STATE, opts = {}) {
  const dailyAgeMs = (opts.dailyAgeHours || 24) * 3600_000;
  const weeklyAgeMs = (opts.weeklyAgeDays || 7) * 86_400_000;
  const monthlyAgeMs = (opts.monthlyAgeDays || 30) * 86_400_000;
  const minClusterSize = opts.minClusterSize || 3;
  const now = Date.now();

  const es = ensureSubscriptionState(STATE);
  const results = { dailyMegas: 0, weeklyMegas: 0, monthlyHypers: 0 };

  // ── Daily compression: group old regular event DTUs by date + domain ──
  const dailyClusters = new Map(); // "YYYY-MM-DD:domain" → [dtu, ...]
  const dailyCutoff = new Date(now - dailyAgeMs).toISOString();

  for (const dtu of STATE.dtus.values()) {
    if (!dtu.meta?.eventOrigin) continue;
    if (dtu.tier !== "regular") continue;
    if (dtu.meta?.compressed) continue; // already compressed

    const dtuTime = dtu.createdAt || dtu.timestamp;
    if (!dtuTime || dtuTime > dailyCutoff) continue;

    const date = dtuTime.slice(0, 10); // YYYY-MM-DD
    const domain = dtu.domain || "general";
    const key = `${date}:${domain}`;

    if (!dailyClusters.has(key)) dailyClusters.set(key, []);
    dailyClusters.get(key).push(dtu);
  }

  // Create daily Mega DTUs from clusters
  for (const [key, cluster] of dailyClusters) {
    if (cluster.length < minClusterSize) continue;

    const [date, domain] = key.split(":");
    const megaId = `mega_daily_${date}_${domain}_${randomHex(6)}`;

    // Compute aggregate CRETI
    const avgCreti = Math.round(
      cluster.reduce((s, d) => s + (d.cretiScore || d.meta?.cretiScore || 0), 0) / cluster.length
    );

    const mega = {
      id: megaId,
      title: `Daily ${domain} events — ${date}`,
      tier: "mega",
      source: "event_bridge_compression",
      domain,
      human: {
        summary: `${cluster.length} ${domain} events from ${date}. ` +
          `Top: ${cluster.slice(0, 3).map(d => d.title?.split("—")?.[1]?.trim() || d.title).join("; ")}`,
      },
      core: {
        definitions: [],
        invariants: [],
        claims: cluster.slice(0, 10).map(d =>
          d.core?.claims?.[0] || `Event: ${d.meta?.sourceEventType || "unknown"}`
        ),
        examples: [],
        nextActions: [],
      },
      tags: ["auto_event", "compressed", "daily_mega", domain],
      scope: {
        lenses: [...new Set(cluster.flatMap(d => d.scope?.lenses || []))],
        global: false,
        newsVisible: true,
        localPush: false,
        localPull: true,
      },
      meta: {
        eventOrigin: true,
        compressed: true,
        compressionType: "daily",
        compressionDate: date,
        childCount: cluster.length,
        childIds: cluster.map(d => d.id),
        cretiScore: Math.min(avgCreti + 5, 100), // Mega gets slight CRETI boost
        bridgeVersion: "1.0",
      },
      cretiScore: Math.min(avgCreti + 5, 100),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    STATE.dtus.set(megaId, mega);

    // Mark children as compressed (don't delete — depth is preserved)
    for (const child of cluster) {
      child.meta = child.meta || {};
      child.meta.compressed = true;
      child.meta.compressedInto = megaId;
      child.meta.compressedAt = new Date().toISOString();
    }

    results.dailyMegas++;
  }

  // ── Weekly compression: group daily Megas into weekly Megas ──
  const weeklyClusters = new Map(); // "YYYY-WW:domain" → [mega, ...]
  const weeklyCutoff = new Date(now - weeklyAgeMs).toISOString();

  for (const dtu of STATE.dtus.values()) {
    if (!dtu.meta?.eventOrigin) continue;
    if (dtu.tier !== "mega") continue;
    if (dtu.meta?.compressionType !== "daily") continue;
    if (dtu.meta?.compressedIntoWeekly) continue;

    const dtuTime = dtu.createdAt || dtu.timestamp;
    if (!dtuTime || dtuTime > weeklyCutoff) continue;

    const date = new Date(dtuTime);
    const weekNum = getWeekNumber(date);
    const domain = dtu.domain || "general";
    const key = `${date.getFullYear()}-W${String(weekNum).padStart(2, "0")}:${domain}`;

    if (!weeklyClusters.has(key)) weeklyClusters.set(key, []);
    weeklyClusters.get(key).push(dtu);
  }

  for (const [key, cluster] of weeklyClusters) {
    if (cluster.length < 2) continue; // need at least 2 daily megas

    const [weekId, domain] = key.split(":");
    const megaId = `mega_weekly_${weekId}_${domain}_${randomHex(6)}`;

    const totalChildren = cluster.reduce((s, m) => s + (m.meta?.childCount || 0), 0);
    const avgCreti = Math.round(
      cluster.reduce((s, d) => s + (d.cretiScore || d.meta?.cretiScore || 0), 0) / cluster.length
    );

    const weeklyMega = {
      id: megaId,
      title: `Weekly ${domain} summary — ${weekId}`,
      tier: "mega",
      source: "event_bridge_compression",
      domain,
      human: {
        summary: `${totalChildren} ${domain} events across ${cluster.length} days in ${weekId}.`,
      },
      core: {
        definitions: [],
        invariants: [],
        claims: cluster.flatMap(d => d.core?.claims || []).slice(0, 15),
        examples: [],
        nextActions: [],
      },
      tags: ["auto_event", "compressed", "weekly_mega", domain],
      scope: {
        lenses: [...new Set(cluster.flatMap(d => d.scope?.lenses || []))],
        global: false,
        newsVisible: true,
        localPush: false,
        localPull: true,
      },
      meta: {
        eventOrigin: true,
        compressed: true,
        compressionType: "weekly",
        compressionWeek: weekId,
        childCount: cluster.length,
        totalEventCount: totalChildren,
        childIds: cluster.map(d => d.id),
        cretiScore: Math.min(avgCreti + 8, 100),
        bridgeVersion: "1.0",
      },
      cretiScore: Math.min(avgCreti + 8, 100),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    STATE.dtus.set(megaId, weeklyMega);

    for (const child of cluster) {
      child.meta.compressedIntoWeekly = megaId;
    }

    results.weeklyMegas++;
  }

  // ── Monthly compression: group weekly Megas into monthly Hypers ──
  const monthlyClusters = new Map(); // "YYYY-MM:domain" → [mega, ...]
  const monthlyCutoff = new Date(now - monthlyAgeMs).toISOString();

  for (const dtu of STATE.dtus.values()) {
    if (!dtu.meta?.eventOrigin) continue;
    if (dtu.tier !== "mega") continue;
    if (dtu.meta?.compressionType !== "weekly") continue;
    if (dtu.meta?.compressedIntoMonthly) continue;

    const dtuTime = dtu.createdAt || dtu.timestamp;
    if (!dtuTime || dtuTime > monthlyCutoff) continue;

    const date = new Date(dtuTime);
    const monthId = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    const domain = dtu.domain || "general";
    const key = `${monthId}:${domain}`;

    if (!monthlyClusters.has(key)) monthlyClusters.set(key, []);
    monthlyClusters.get(key).push(dtu);
  }

  for (const [key, cluster] of monthlyClusters) {
    if (cluster.length < 2) continue;

    const [monthId, domain] = key.split(":");
    const hyperId = `hyp_monthly_${monthId}_${domain}_${randomHex(6)}`;

    const totalEvents = cluster.reduce((s, m) => s + (m.meta?.totalEventCount || m.meta?.childCount || 0), 0);
    const avgCreti = Math.round(
      cluster.reduce((s, d) => s + (d.cretiScore || d.meta?.cretiScore || 0), 0) / cluster.length
    );

    const hyper = {
      id: hyperId,
      title: `Monthly ${domain} digest — ${monthId}`,
      tier: "hyper",
      source: "event_bridge_compression",
      domain,
      human: {
        summary: `${totalEvents} ${domain} events across ${cluster.length} weeks in ${monthId}.`,
      },
      core: {
        definitions: [],
        invariants: [],
        claims: cluster.flatMap(d => d.core?.claims || []).slice(0, 20),
        examples: [],
        nextActions: [],
      },
      tags: ["auto_event", "compressed", "monthly_hyper", domain],
      scope: {
        lenses: [...new Set(cluster.flatMap(d => d.scope?.lenses || []))],
        global: false,
        newsVisible: true,
        localPush: false,
        localPull: true,
      },
      meta: {
        eventOrigin: true,
        compressed: true,
        compressionType: "monthly",
        compressionMonth: monthId,
        childCount: cluster.length,
        totalEventCount: totalEvents,
        childIds: cluster.map(d => d.id),
        cretiScore: Math.min(avgCreti + 10, 100),
        bridgeVersion: "1.0",
      },
      cretiScore: Math.min(avgCreti + 10, 100),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    STATE.dtus.set(hyperId, hyper);

    for (const child of cluster) {
      child.meta.compressedIntoMonthly = hyperId;
    }

    results.monthlyHypers++;
  }

  es.metrics.compressionRuns++;

  return {
    ok: true,
    ...results,
    total: results.dailyMegas + results.weeklyMegas + results.monthlyHypers,
  };
}

/**
 * Decompress a Mega/Hyper DTU — retrieve its children.
 * Drill into last month's Hyper and see weekly Megas, then daily events.
 *
 * @param {Object} STATE - Global state
 * @param {string} dtuId - The Mega or Hyper DTU ID
 * @returns {{ ok, parent, children, depth }}
 */
export function decompressNewsDTU(STATE, dtuId) {
  const dtu = STATE.dtus.get(dtuId);
  if (!dtu) return { ok: false, error: "dtu_not_found" };
  if (!dtu.meta?.compressed) return { ok: false, error: "not_compressed" };

  const childIds = dtu.meta?.childIds || [];
  const children = childIds
    .map(id => STATE.dtus.get(id))
    .filter(Boolean)
    .map(child => ({
      id: child.id,
      title: child.title,
      tier: child.tier,
      domain: child.domain,
      creti: child.cretiScore || child.meta?.cretiScore || 0,
      eventType: child.meta?.sourceEventType,
      compressionType: child.meta?.compressionType,
      childCount: child.meta?.childCount,
      createdAt: child.createdAt || child.timestamp,
      summary: child.human?.summary || child.title,
      canDecompress: !!child.meta?.childIds?.length,
    }));

  // Determine depth
  let depth = 0;
  if (dtu.tier === "hyper") depth = 3; // monthly → weekly → daily → events
  else if (dtu.meta?.compressionType === "weekly") depth = 2; // weekly → daily → events
  else if (dtu.meta?.compressionType === "daily") depth = 1; // daily → events

  return {
    ok: true,
    parent: {
      id: dtu.id,
      title: dtu.title,
      tier: dtu.tier,
      compressionType: dtu.meta?.compressionType,
      childCount: childIds.length,
      totalEventCount: dtu.meta?.totalEventCount || childIds.length,
    },
    children,
    depth,
  };
}

/**
 * Auto-pull from world_events_log into the News lens.
 *
 * world_events_log is the append-only audit log emitted by world-mechanics
 * (chunk crossings, combat outcomes, referendum resolutions from Phase A,
 * etc). This function selects rows fired since `sinceUnixSec` and turns
 * each into a regular event DTU on STATE.dtus, where the existing
 * compressNewsEvents pipeline can roll them up into Megas and Hypers.
 *
 * Idempotent across overlapping windows because each row's id becomes the
 * dtu id, and STATE.dtus is a Map so duplicates are overwritten in-place.
 *
 * Caller is responsible for tracking and advancing `sinceUnixSec` between
 * polls (typically STATE._lastNewsLogPoll). Returns the new high-water
 * mark so callers can store it without scanning the full result.
 *
 * @param {Object} STATE
 * @param {import('better-sqlite3').Database} db
 * @param {number} sinceUnixSec - rows with fired_at strictly greater are pulled
 * @param {Object} [opts]
 * @param {number} [opts.limit=50] - hard cap per call to keep tick latency bounded
 * @returns {{ ok: boolean, ingested: number, highWaterMark: number }}
 */
export function pullWorldEventsIntoNews(STATE, db, sinceUnixSec, opts = {}) {
  const limit = Math.max(1, Math.min(opts.limit || 50, 500));
  if (!STATE?.dtus || !db) return { ok: false, ingested: 0, highWaterMark: sinceUnixSec || 0 };

  let rows = [];
  try {
    rows = db.prepare(`
      SELECT id, city_id, user_id, trigger_id, mechanic_id, action,
             reward, context_json, fired_at
        FROM world_events_log
       WHERE strftime('%s', fired_at) > ?
       ORDER BY fired_at ASC
       LIMIT ?
    `).all(String(sinceUnixSec || 0), limit);
  } catch {
    // Table may not exist on older deploys; bail without throwing.
    return { ok: false, ingested: 0, highWaterMark: sinceUnixSec || 0 };
  }

  let ingested = 0;
  let highWater = sinceUnixSec || 0;

  for (const row of rows) {
    try {
      const firedAtSec = Math.floor(new Date(row.fired_at).getTime() / 1000);
      if (firedAtSec > highWater) highWater = firedAtSec;

      // Skip if already ingested
      if (STATE.dtus.has(row.id)) continue;

      let context = {};
      try { context = JSON.parse(row.context_json || "{}"); } catch { /* default {} */ }

      const dtu = {
        id:        row.id,
        title:     `${row.trigger_id}${row.action ? `:${row.action}` : ""}${row.city_id ? ` · ${row.city_id}` : ""}`,
        tier:      "regular",
        source:    "world_events_log",
        domain:    inferDomainFromTrigger(row.trigger_id),
        human:     {
          summary: `Event ${row.trigger_id}${row.user_id ? ` by ${row.user_id}` : ""} in ${row.city_id || "concordia"}.`,
        },
        core:      {
          definitions: [],
          invariants:  [],
          claims:      [`trigger=${row.trigger_id}`],
        },
        meta: {
          eventOrigin:     true,
          sourceEventType: row.trigger_id,
          cityId:          row.city_id,
          userId:          row.user_id,
          mechanicId:      row.mechanic_id || null,
          context,
        },
        createdAt: row.fired_at,
        timestamp: row.fired_at,
      };

      STATE.dtus.set(row.id, dtu);
      ingested++;
    } catch { /* per-row failures are silent — heartbeat invariant */ }
  }

  return { ok: true, ingested, highWaterMark: highWater };
}

function inferDomainFromTrigger(triggerId) {
  if (!triggerId) return "general";
  const t = String(triggerId).toLowerCase();
  if (t.includes("combat") || t.includes("hit") || t.includes("kill"))     return "combat";
  if (t.includes("referendum") || t.includes("council") || t.includes("vote")) return "governance";
  if (t.includes("market") || t.includes("trade") || t.includes("listing"))  return "economy";
  if (t.includes("walker") || t.includes("link") || t.includes("message"))   return "communication";
  if (t.includes("zone") || t.includes("travel") || t.includes("portal"))    return "travel";
  return "general";
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function getWeekNumber(d) {
  const date = new Date(d);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + 3 - (date.getDay() + 6) % 7);
  const week1 = new Date(date.getFullYear(), 0, 4);
  return 1 + Math.round(((date - week1) / 86_400_000 - 3 + (week1.getDay() + 6) % 7) / 7);
}

function randomHex(bytes) {
  const arr = new Uint8Array(bytes);
  for (let i = 0; i < bytes; i++) {
    arr[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(arr, b => b.toString(16).padStart(2, "0")).join("");
}
