// server/lib/realm-overview.js
//
// Concord Link L3 — the Realm Overview: the realm's political web in one read.
// The faction-relations graph (who's at war/allied with whom), each faction's
// current stance + momentum (consolidate/expand/war/alliance — the Layer-11
// emergent strategy), and the recent-moves log. Pairs with the per-NPC dossier
// (the zoom-in) as the political-map zoom-out. Read-only, table-guarded.

function safe(fn, fallback) { try { return fn(); } catch { return fallback; } }

/**
 * @param {import('better-sqlite3').Database} db
 * @param {object} [opts] { factionId?: filter to one faction's neighbourhood, limit }
 * @returns {{ok:boolean, factions:object[], relations:object[], recentMoves:object[]}}
 */
export function buildRealmOverview(db, { factionId = null, limit = 30 } = {}) {
  if (!db) return { ok: false, reason: "no_db", factions: [], relations: [], recentMoves: [] };
  const lim = Math.max(1, Math.min(100, Number(limit) || 30));

  const factions = safe(() => {
    const where = factionId ? "WHERE faction_id = ? OR target_id = ?" : "";
    const args = factionId ? [String(factionId), String(factionId)] : [];
    return db.prepare(
      `SELECT faction_id AS factionId, stance, target_id AS target,
              ROUND(momentum, 3) AS momentum, phase
         FROM faction_strategy_state ${where}
        ORDER BY ABS(momentum) DESC LIMIT ?`
    ).all(...args, lim);
  }, []);

  const relations = safe(() => {
    const where = factionId ? "WHERE faction_a = ? OR faction_b = ?" : "WHERE kind != 'neutral'";
    const args = factionId ? [String(factionId), String(factionId)] : [];
    return db.prepare(
      `SELECT faction_a AS a, faction_b AS b, ROUND(score, 3) AS score, kind
         FROM faction_relations ${where}
        ORDER BY ABS(score) DESC LIMIT ?`
    ).all(...args, lim);
  }, []);

  // Recent moves — order by a timestamp if present, else insertion order.
  const recentMoves = safe(() => {
    const cols = db.prepare(`PRAGMA table_info(faction_strategy_log)`).all().map((c) => c.name);
    const tsCol = ["at", "created_at", "executed_at", "moved_at"].find((c) => cols.includes(c));
    const order = tsCol ? `${tsCol} DESC` : "rowid DESC";
    const where = factionId ? "WHERE faction_id = ?" : "";
    const args = factionId ? [String(factionId)] : [];
    return db.prepare(
      `SELECT faction_id AS factionId, move, target_id AS target
         FROM faction_strategy_log ${where} ORDER BY ${order} LIMIT ?`
    ).all(...args, lim);
  }, []);

  return { ok: true, factions, relations, recentMoves };
}

export default buildRealmOverview;
