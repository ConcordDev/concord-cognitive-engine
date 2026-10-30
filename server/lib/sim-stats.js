// Reads for the world-sim digest and analytics routes.
// Counts come from the tables those routes used to ignore. A missing table
// leaves the field null. Playtime and NPC chatter are not recorded here.

import { getCreatorProgression } from "./creator-progression.js";
import { getTrending } from "./cross-lens-discovery.js";

function tableExists(db, name) {
  try {
    return !!db.prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
    ).get(name);
  } catch {
    return false;
  }
}

function columnExists(db, table, column) {
  try {
    return db.prepare(`PRAGMA table_info(${table})`).all().some((row) => row.name === column);
  } catch {
    return false;
  }
}

// grantStarterInventoryToUser writes one dtus row per stack item
// (id mat_<user>_<type>_<time>_<i>, type material). Those are inventory,
// not authored DTUs.
function authoredOnly(db, alias) {
  if (!columnExists(db, "dtus", "type")) return "";
  const p = alias ? `${alias}.` : "";
  return ` AND NOT (${p}type = 'material' AND ${p}id LIKE 'mat_%')`;
}

function creatorRows(db, userId) {
  if (!tableExists(db, "dtus")) return { ok: false, reason: "dtu_tables_missing" };
  const citations = tableExists(db, "dtu_citations");
  const skipStarter = authoredOnly(db, citations ? "d" : "");
  try {
    const rows = citations
      ? db.prepare(`
          SELECT d.id AS id, d.title AS title, COALESCE(c.citation_count, 0) AS citations
            FROM dtus d
            LEFT JOIN dtu_citations c ON c.dtu_id = d.id
           WHERE d.creator_id = ?${skipStarter}
        `).all(userId)
      : db.prepare(`
          SELECT id, title, 0 AS citations FROM dtus WHERE creator_id = ?${skipStarter}
        `).all(userId);
    return { ok: true, rows, citationsRecorded: citations };
  } catch {
    return { ok: false, reason: "dtu_tables_missing" };
  }
}

function royaltyTotal(db, userId) {
  if (!tableExists(db, "economy_ledger")) return { total: null, reason: "no_ledger" };
  try {
    const row = db.prepare(`
      SELECT COALESCE(SUM(net), 0) AS total FROM economy_ledger
       WHERE to_user_id = ? AND type = 'ROYALTY_PAYOUT' AND status = 'complete'
    `).get(userId);
    return { total: Math.round((Number(row?.total) || 0) * 100) / 100, reason: null };
  } catch {
    return { total: null, reason: "no_ledger" };
  }
}

function buildCountFor(db, userId) {
  if (!tableExists(db, "world_buildings")) {
    return { count: null, reason: "no_building_table" };
  }
  const spawned = columnExists(db, "world_buildings", "spawned_by_user_id");
  const owner = columnExists(db, "world_buildings", "owner_id");
  const ownerType = columnExists(db, "world_buildings", "owner_type");
  if (!spawned && !owner) return { count: null, reason: "buildings_not_attributed" };
  const clauses = [];
  const params = [];
  if (spawned) {
    clauses.push("spawned_by_user_id = ?");
    params.push(userId);
  }
  if (owner) {
    clauses.push(ownerType ? "(owner_type = 'player' AND owner_id = ?)" : "owner_id = ?");
    params.push(userId);
  }
  try {
    const row = db.prepare(
      `SELECT COUNT(DISTINCT id) AS n FROM world_buildings WHERE ${clauses.join(" OR ")}`,
    ).get(...params);
    return { count: Number(row?.n) || 0, reason: null };
  } catch {
    return { count: null, reason: "buildings_unreadable" };
  }
}

// The caller's own buildings. Same attribution rule as the build count above.
export function readOwnBuildings(db, userId, limit = 25) {
  if (!userId) return { ok: false, status: 401, error: "sign_in_required" };
  if (!db) return { ok: false, status: 503, error: "no_db" };
  const counted = buildCountFor(db, userId);
  if (counted.count === null) return { ok: false, reason: counted.reason };
  const spawned = columnExists(db, "world_buildings", "spawned_by_user_id");
  const owner = columnExists(db, "world_buildings", "owner_id");
  const ownerType = columnExists(db, "world_buildings", "owner_type");
  const clauses = [];
  const params = [];
  if (spawned) { clauses.push("spawned_by_user_id = ?"); params.push(userId); }
  if (owner) {
    clauses.push(ownerType ? "(owner_type = 'player' AND owner_id = ?)" : "owner_id = ?");
    params.push(userId);
  }
  const want = ["id", "world_id", "name", "building_type", "state", "health_pct"]
    .filter((c) => columnExists(db, "world_buildings", c));
  try {
    const rows = db.prepare(
      `SELECT DISTINCT ${want.join(", ")} FROM world_buildings WHERE ${clauses.join(" OR ")} LIMIT ?`,
    ).all(...params, Math.max(1, Math.min(100, Number(limit) || 25)));
    return { ok: true, count: counted.count, buildings: rows };
  } catch {
    return { ok: false, reason: "buildings_unreadable" };
  }
}

// The caller's own marketplace listings. marketplace_listings is the
// durable store (owner_user_id + visibility draft/published/...). Counts
// cover all of the caller's listings; the sample is newest-first.
export function readOwnListings(db, userId, limit = 5) {
  if (!userId) return { ok: false, status: 401, error: "sign_in_required" };
  if (!db) return { ok: false, status: 503, error: "no_db" };
  if (!tableExists(db, "marketplace_listings")) return { ok: false, reason: "no_listings_table" };
  if (!columnExists(db, "marketplace_listings", "owner_user_id")) {
    return { ok: false, reason: "listings_unattributed" };
  }
  const hasVisibility = columnExists(db, "marketplace_listings", "visibility");
  const want = ["id", "title", "visibility", "price_cents", "currency"]
    .filter((c) => columnExists(db, "marketplace_listings", c));
  try {
    const rows = db.prepare(
      `SELECT ${want.join(", ")} FROM marketplace_listings WHERE owner_user_id = ? ORDER BY rowid DESC LIMIT ?`,
    ).all(userId, Math.max(1, Math.min(25, Number(limit) || 5)));
    const counts = db.prepare(
      hasVisibility
        ? `SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN visibility = 'published' THEN 1 ELSE 0 END), 0) AS published FROM marketplace_listings WHERE owner_user_id = ?`
        : `SELECT COUNT(*) AS total FROM marketplace_listings WHERE owner_user_id = ?`,
    ).get(userId);
    return {
      ok: true,
      listingCount: Number(counts?.total) || 0,
      publishedCount: hasVisibility ? Number(counts?.published) || 0 : null,
      listings: rows,
    };
  } catch {
    return { ok: false, reason: "listings_unreadable" };
  }
}

// The caller's own royalty payouts — the same ledger rule as royaltyTotal
// (completed ROYALTY_PAYOUT rows addressed to the caller), with the count.
export function readOwnRoyalties(db, userId) {
  if (!userId) return { ok: false, status: 401, error: "sign_in_required" };
  if (!db) return { ok: false, status: 503, error: "no_db" };
  const total = royaltyTotal(db, userId);
  if (total.total === null) return { ok: false, reason: total.reason };
  try {
    const row = db.prepare(`
      SELECT COUNT(*) AS n FROM economy_ledger
       WHERE to_user_id = ? AND type = 'ROYALTY_PAYOUT' AND status = 'complete'
    `).get(userId);
    return { ok: true, totalRoyalties: total.total, payoutCount: Number(row?.n) || 0 };
  } catch {
    return { ok: false, reason: "no_ledger" };
  }
}

// The caller's own DTU citation totals and most-cited DTUs. Starter material
// inventory (mat_ rows) is excluded, same as readCreatorSimStats.
export function readOwnCitations(db, userId, limit = 5) {
  if (!userId) return { ok: false, status: 401, error: "sign_in_required" };
  if (!db) return { ok: false, status: 503, error: "no_db" };
  const loaded = creatorRows(db, userId);
  if (!loaded.ok) return { ok: false, reason: loaded.reason };
  if (!loaded.citationsRecorded) return { ok: false, reason: "no_citation_table" };
  const { total } = topCited(loaded.rows);
  const top = loaded.rows
    .filter((r) => Number(r.citations) > 0)
    .sort((x, y) => Number(y.citations) - Number(x.citations))
    .slice(0, Math.max(1, Math.min(25, Number(limit) || 5)))
    .map((r) => ({ id: r.id, name: r.title || null, citations: Number(r.citations) }));
  return { ok: true, totalCitations: total, dtuCount: loaded.rows.length, topCited: top };
}

function topCited(rows) {
  let top = null;
  let total = 0;
  for (const row of rows) {
    const n = Number(row.citations) || 0;
    total += n;
    if (n > 0 && (!top || n > top.citations)) {
      top = { id: row.id, name: row.title || null, citations: n };
    }
  }
  return { total, top };
}

export function readCreatorSimStats(db, userId) {
  if (!userId) return { ok: false, status: 401, error: "Authentication required" };
  if (!db) return { ok: false, status: 503, error: "no_db" };
  const loaded = creatorRows(db, userId);
  if (!loaded.ok) {
    return { ok: false, status: 503, error: "stats_unavailable", reason: loaded.reason };
  }
  const { total, top } = topCited(loaded.rows);
  const royalties = royaltyTotal(db, userId);
  let reputationByDomain = null;
  try {
    const prog = getCreatorProgression(db, userId);
    reputationByDomain = Object.fromEntries(
      (prog.profile?.domains || []).map((d) => [d.domain, d.citations]),
    );
  } catch {
    reputationByDomain = null;
  }
  return {
    ok: true,
    status: 200,
    citations: total,
    citationsRecorded: loaded.citationsRecorded,
    royalties: royalties.total,
    royaltyReason: royalties.reason,
    top,
    dtuCount: loaded.rows.length,
    reputationByDomain,
  };
}

export function readPersonalAnalytics(db, userId) {
  const base = readCreatorSimStats(db, userId);
  if (!base.ok) return base;
  const builds = buildCountFor(db, userId);
  return {
    ok: true,
    status: 200,
    stats: {
      totalCitations: base.citationsRecorded ? base.citations : null,
      totalCitationsReason: base.citationsRecorded ? null : "no_citation_table",
      totalRoyalties: base.royalties,
      royaltyReason: base.royaltyReason,
      mostCitedDTU: base.top,
      mostUsedMaterial: null,
      mostUsedMaterialReason: "not_recorded",
      reputationByDomain: base.reputationByDomain,
      dtuCount: base.dtuCount,
      buildCount: builds.count,
      buildCountReason: builds.reason,
      playtime: null,
      playtimeReason: "not_recorded",
      loginStreak: null,
      loginStreakReason: "not_recorded",
    },
  };
}

export function readDailyDigest(db, userId) {
  const base = readCreatorSimStats(db, userId);
  if (!base.ok) return base;
  return {
    ok: true,
    status: 200,
    digest: {
      date: new Date().toISOString().slice(0, 10),
      newCitations: null,
      newCitationsReason: "not_windowed",
      citations: base.citationsRecorded ? base.citations : null,
      royaltiesEarned: base.royalties,
      royaltyReason: base.royaltyReason,
      worldEvents: [],
      worldEventsReason: "no_event_feed",
      topCreation: base.top,
      npcSummary: null,
      npcSummaryReason: "not_recorded",
    },
  };
}

function scalar(db, sql, params = []) {
  try {
    const row = db.prepare(sql).get(...params);
    return row ? row.n : null;
  } catch {
    return null;
  }
}

export function readWorldAnalytics(db, worldId) {
  if (!db) return { ok: false, status: 503, error: "no_db" };
  if (!worldId) return { ok: false, status: 400, error: "worldId required" };
  if (!tableExists(db, "worlds")) {
    return { ok: false, status: 503, error: "stats_unavailable", reason: "no_worlds_table" };
  }
  let world = null;
  try {
    world = db.prepare(
      "SELECT population, total_visits FROM worlds WHERE id = ?",
    ).get(worldId);
  } catch {
    return { ok: false, status: 503, error: "stats_unavailable", reason: "worlds_unreadable" };
  }
  if (!world) return { ok: false, status: 404, error: "world not found" };
  const buildings = tableExists(db, "world_buildings")
    ? scalar(db, "SELECT COUNT(*) AS n FROM world_buildings WHERE world_id = ?", [worldId])
    : null;
  return {
    ok: true,
    status: 200,
    stats: {
      population: Number(world.population) || 0,
      buildingCount: buildings,
      buildingReason: buildings == null ? "no_building_table" : null,
      visitorCount: Number(world.total_visits) || 0,
      infraCoverage: null,
      envScore: null,
      economicActivity: null,
      timeseries: null,
      unmeasured: ["infraCoverage", "envScore", "economicActivity", "timeseries"],
    },
  };
}

export function readGlobalAnalytics(db) {
  if (!db) return { ok: false, status: 503, error: "no_db" };
  const worlds = tableExists(db, "worlds")
    ? scalar(db, "SELECT COUNT(*) AS n FROM worlds")
    : null;
  const buildings = tableExists(db, "world_buildings")
    ? scalar(db, "SELECT COUNT(*) AS n FROM world_buildings")
    : null;
  const citations = tableExists(db, "dtu_citations")
    ? scalar(db, "SELECT COALESCE(SUM(citation_count), 0) AS n FROM dtu_citations")
    : null;
  let topCreators = [];
  if (tableExists(db, "dtus") && tableExists(db, "dtu_citations")) {
    try {
      topCreators = db.prepare(`
        SELECT d.creator_id AS userId, SUM(c.citation_count) AS citations
          FROM dtus d
          JOIN dtu_citations c ON c.dtu_id = d.id
         WHERE d.creator_id IS NOT NULL
         GROUP BY d.creator_id
         ORDER BY citations DESC
         LIMIT 5
      `).all().map((row, i) => ({
        userId: row.userId,
        name: null,
        citations: Number(row.citations) || 0,
        rank: i + 1,
      }));
    } catch {
      topCreators = [];
    }
  }
  const trending = getTrending(db, { limit: 5 }).map((row) => ({
    id: row.id,
    name: row.title || null,
    creatorId: row.creator_id || null,
    citations: Number(row.citations) || 0,
  }));
  return {
    ok: true,
    status: 200,
    stats: {
      totalWorlds: worlds,
      totalBuildings: buildings,
      totalCitations: citations,
      activeUsers: null,
      activeUsersReason: "not_recorded",
      trendingComponents: trending,
      topCreators,
    },
  };
}
