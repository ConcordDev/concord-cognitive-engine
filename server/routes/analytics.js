// server/routes/analytics.js
//
// Analytics aggregator for the AnalyticsDashboard surface
// (/lenses/system Analytics tab).
//
// One endpoint that returns all three slices the frontend wants:
//   - personalStats: per-user citations, royalties, build count,
//     reputation by domain, etc.
//   - worldStats: a single world's population, buildings, visitor
//     count, plus a 7-point time series.
//   - globalStats: site-wide totals + trending + top creators.
//
// Each slice is computed via try/wrap so a missing table doesn't
// break the others — analytics is best-effort, not load-bearing.
// A count from a real query can be 0. A missing table or an
// unmeasured field is null, with a reason. The no-user envelope
// stays numeric zeros: that caller has no personal rows to read.
//
// GET /api/analytics?worldId=<id>  (worldId optional)

import { worldEcosystemPercent } from "../lib/ecosystem/score-engine.js";

const REPUTATION_DOMAINS = [
  "structural", "materials", "infrastructure", "energy",
  "architecture", "mentorship", "governance", "exploration",
];

function _userId(req) {
  return req?.user?.id || req?.user?.userId || req?.session?.user?.id || null;
}

function _safe(fn, fallback) {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

function _columns(db, table) {
  try {
    const rows = db.prepare(`PRAGMA table_info(${table})`).all();
    if (!rows.length) return null;
    return new Set(rows.map((c) => c.name));
  } catch {
    return null;
  }
}

function _personalStats(db, userId) {
  if (!userId) return _emptyPersonal();

  // Royalties + citations from economy_ledger. No table is not a zero balance.
  let totalCitations = null;
  let totalRoyalties = null;
  let royaltyReason = "no_ledger_table";
  if (_columns(db, "economy_ledger")) {
    const royaltyRow = _safe(
      () =>
        db
          .prepare(
            `SELECT
               COALESCE(SUM(net), 0) AS totalRoyalties,
               COUNT(*) AS totalCitations
             FROM economy_ledger
             WHERE to_user_id = ?
               AND status = 'complete'
               AND (type = 'citation_royalty' OR type = 'royalty')`,
          )
          .get(userId),
      null,
    );
    if (!royaltyRow) royaltyReason = "ledger_unreadable";
    else {
      totalCitations = royaltyRow.totalCitations;
      totalRoyalties = Math.round(royaltyRow.totalRoyalties * 100) / 100;
      royaltyReason = null;
    }
  }

  // Most-cited DTU (creator-keyed) — count citations from economy_ledger
  // grouped by metadata_json.dtuId; fall back to DTU title from dtus.
  const mostCited = _safe(() => {
    const r = db
      .prepare(
        `SELECT d.id AS id, json_extract(d.data, '$.human_summary') AS name, COUNT(*) AS citations
         FROM economy_ledger el
         JOIN dtus d
           ON json_extract(el.metadata_json, '$.dtuId') = d.id
         WHERE el.to_user_id = ?
           AND el.type = 'citation_royalty'
         GROUP BY d.id
         ORDER BY citations DESC
         LIMIT 1`,
      )
      .get(userId);
    return r ? { name: r.name || r.id, citations: r.citations } : { name: '', citations: 0 };
  }, { name: '', citations: 0 });

  // Build count: world_buildings the caller placed. No owner column is not zero builds.
  let buildCount = null;
  let buildReason = "no_building_table";
  const buildingCols = _columns(db, "world_buildings");
  if (buildingCols?.has("spawned_by_user_id")) {
    const counted = _safe(
      () => db.prepare(`SELECT COUNT(*) AS c FROM world_buildings WHERE spawned_by_user_id = ?`).get(userId)?.c ?? 0,
      null,
    );
    if (counted == null) buildReason = "buildings_unreadable";
    else {
      buildCount = counted;
      buildReason = null;
    }
  } else if (buildingCols) {
    buildReason = "buildings_not_attributed";
  }

  // A missing reputation row is not a score of 0.
  const reputationByDomain = {};
  let reputationReason = "no_reputation_table";
  if (_columns(db, "user_reputation")) {
    const rows = _safe(
      () => db.prepare(`SELECT domain, score FROM user_reputation WHERE user_id = ?`).all(userId),
      null,
    );
    if (!rows) reputationReason = "reputation_unreadable";
    else {
      const byDomain = new Map(rows.map((r) => [r.domain, r.score]));
      let any = false;
      for (const domain of REPUTATION_DOMAINS) {
        if (byDomain.has(domain)) {
          const score = Number(byDomain.get(domain));
          reputationByDomain[domain] = Number.isFinite(score) ? score : null;
          any = true;
        } else reputationByDomain[domain] = null;
      }
      reputationReason = any ? null : "no_reputation_row";
    }
  }
  if (reputationReason) {
    for (const domain of REPUTATION_DOMAINS) reputationByDomain[domain] = null;
  }

  let playtime = null;
  let playtimeReason = "no_visit_table";
  if (_columns(db, "world_visits")) {
    const hours = _safe(
      () => db
        .prepare(
          `SELECT COALESCE(SUM(
             (julianday(COALESCE(departed_at, datetime('now'))) - julianday(arrived_at)) * 24
           ), 0) AS hours
           FROM world_visits
           WHERE user_id = ?`,
        )
        .get(userId)?.hours,
      null,
    );
    if (hours == null) playtimeReason = "visits_unreadable";
    else {
      playtime = Math.round(Number(hours) * 10) / 10;
      playtimeReason = null;
    }
  }

  let loginStreak = null;
  let loginStreakReason = "no_streak_table";
  if (_columns(db, "user_login_streak")?.has("streak")) {
    const row = _safe(
      () => db.prepare(`SELECT streak FROM user_login_streak WHERE user_id = ?`).get(userId),
      undefined,
    );
    if (row === undefined) loginStreakReason = "streak_unreadable";
    else if (!row) loginStreakReason = "no_streak_row";
    else {
      const streak = Number(row.streak);
      loginStreak = Number.isFinite(streak) ? streak : null;
      loginStreakReason = loginStreak == null ? "streak_unreadable" : null;
    }
  }

  return {
    totalCitations,
    totalRoyalties,
    royaltyReason,
    mostCitedDTU: mostCited,
    mostUsedMaterial: null,
    mostUsedMaterialReason: "not_recorded",
    reputationByDomain,
    reputationReason,
    buildCount,
    buildReason,
    playtime,
    playtimeReason,
    loginStreak,
    loginStreakReason,
  };
}

function _emptyPersonal() {
  return {
    totalCitations: 0,
    totalRoyalties: 0,
    mostCitedDTU: { name: '', citations: 0 },
    mostUsedMaterial: { name: '', uses: 0 },
    reputationByDomain: {
      structural: 0, materials: 0, infrastructure: 0, energy: 0,
      architecture: 0, mentorship: 0, governance: 0, exploration: 0,
    },
    buildCount: 0,
    playtime: 0,
    loginStreak: 0,
  };
}

function _worldStats(db, worldId) {
  if (!worldId) return null;

  const buildingCount = _safe(
    () => db.prepare(`SELECT COUNT(*) AS c FROM world_buildings WHERE world_id = ?`).get(worldId)?.c ?? 0,
    0,
  );

  const population = _safe(
    () => db
      .prepare(
        `SELECT COUNT(DISTINCT user_id) AS c FROM world_visits
         WHERE world_id = ? AND departed_at IS NULL`,
      )
      .get(worldId)?.c ?? 0,
    0,
  );

  const visitorCount = _safe(
    () => db
      .prepare(`SELECT COUNT(DISTINCT user_id) AS c FROM world_visits WHERE world_id = ?`)
      .get(worldId)?.c ?? 0,
    0,
  );

  const economicActivity = _safe(
    () => db
      .prepare(
        `SELECT COALESCE(SUM(amount), 0) AS total FROM economy_ledger
         WHERE json_extract(metadata_json, '$.worldId') = ?
           AND status = 'complete'`,
      )
      .get(worldId)?.total ?? 0,
    0,
  );

  // 7-day visitor + building timeseries.
  const timeseries = _safe(
    () =>
      db
        .prepare(
          `WITH days AS (
             SELECT date('now', '-' || (n || ' days')) AS d
             FROM (
               SELECT 0 AS n UNION SELECT 1 UNION SELECT 2 UNION SELECT 3
               UNION SELECT 4 UNION SELECT 5 UNION SELECT 6
             )
           )
           SELECT
             days.d AS date,
             (SELECT COUNT(DISTINCT user_id) FROM world_visits
              WHERE world_id = ? AND date(arrived_at) = days.d) AS visitors,
             (SELECT COUNT(*) FROM world_buildings
              WHERE world_id = ? AND date(created_at) <= days.d) AS buildings
           FROM days
           ORDER BY days.d ASC`,
        )
        .all(worldId, worldId)
        .map((r) => ({ date: r.date, visitors: r.visitors, buildings: r.buildings })),
    [],
  );

  // Standing share of this world's buildings. No buildings is not 0% covered.
  const buildingCols = _columns(db, "world_buildings");
  let infraCoverage = null;
  let infraReason = "no_building_table";
  if (!buildingCols) {
    infraReason = "no_building_table";
  } else if (!buildingCols.has("state")) {
    infraReason = "no_building_state";
  } else if (!buildingCount) {
    infraReason = "no_buildings";
  } else {
    const standing = _safe(
      () => db.prepare(
        `SELECT COUNT(*) AS c FROM world_buildings WHERE world_id = ? AND state = 'standing'`,
      ).get(worldId)?.c,
      null,
    );
    if (standing == null || !Number.isFinite(Number(standing))) infraReason = "buildings_unreadable";
    else {
      infraCoverage = Math.round((Number(standing) / buildingCount) * 100);
      infraReason = null;
    }
  }

  // Environment gauge: mean stored ecosystem score on the 0-100 display scale
  // (see ecosystemScoreToPercent). An empty sample is not a score of 0.
  const { envScore, envReason } = worldEcosystemPercent(db, worldId);

  return {
    worldId,
    population,
    buildingCount,
    infraCoverage,
    infraReason,
    envScore,
    envScale: "0-100",
    envReason,
    economicActivity: Math.round(economicActivity * 100) / 100,
    visitorCount,
    timeseries,
  };
}

function _globalStats(db) {
  const totalWorlds = _safe(() => db.prepare(`SELECT COUNT(*) AS c FROM worlds`).get()?.c ?? 0, 0);
  const totalBuildings = _safe(() => db.prepare(`SELECT COUNT(*) AS c FROM world_buildings`).get()?.c ?? 0, 0);
  const activeDistricts = _safe(
    () => db.prepare(`SELECT COUNT(DISTINCT world_id) AS c FROM world_buildings`).get()?.c ?? 0,
    0,
  );
  const totalCitations = _safe(
    () => db
      .prepare(
        `SELECT COUNT(*) AS c FROM economy_ledger WHERE type = 'citation_royalty' AND status = 'complete'`,
      )
      .get()?.c ?? 0,
    0,
  );
  const activeUsers = _safe(
    () => db
      .prepare(
        `SELECT COUNT(DISTINCT user_id) AS c FROM world_visits WHERE arrived_at >= datetime('now', '-7 days')`,
      )
      .get()?.c ?? 0,
    0,
  );

  const trendingComponents = _safe(
    () =>
      db
        .prepare(
          `SELECT d.id AS id, json_extract(d.data, '$.human_summary') AS name, d.creator_id AS creator,
                  COUNT(*) AS citationsThisWeek
           FROM economy_ledger el
           JOIN dtus d ON json_extract(el.metadata_json, '$.dtuId') = d.id
           WHERE el.type = 'citation_royalty'
             AND el.created_at >= datetime('now', '-7 days')
           GROUP BY d.id
           ORDER BY citationsThisWeek DESC
           LIMIT 5`,
        )
        .all()
        .map((r) => ({ name: r.name || r.id, creator: r.creator || '', citationsThisWeek: r.citationsThisWeek })),
    [],
  );

  const topCreators = _safe(
    () =>
      db
        .prepare(
          `SELECT to_user_id AS userId, COUNT(*) AS citations
           FROM economy_ledger
           WHERE type = 'citation_royalty' AND status = 'complete'
           GROUP BY to_user_id
           ORDER BY citations DESC
           LIMIT 10`,
        )
        .all()
        .map((r, i) => ({ userId: r.userId, name: r.userId, citations: r.citations, rank: i + 1 })),
    [],
  );

  return {
    activeDistricts,
    totalBuildings,
    totalCitations,
    activeUsers,
    totalWorlds,
    trendingComponents,
    topCreators,
  };
}

export function registerAnalyticsRoutes(app, deps) {
  const { db, asyncHandler } = deps;

  app.get("/api/analytics", asyncHandler(async (req, res) => {
    const userId = _userId(req);
    const worldId = (req.query.worldId || '').toString() || null;

    res.json({
      ok: true,
      personalStats: _personalStats(db, userId),
      worldStats: _worldStats(db, worldId),
      globalStats: _globalStats(db),
    });
  }));
}
