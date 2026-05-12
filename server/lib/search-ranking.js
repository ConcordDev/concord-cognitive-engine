import { LruMap, LruSet } from "./lru-map.js";
/**
 * Lineage-aware, recency-weighted, scope-filtered search ranking.
 *
 * Wraps the existing semantic / full-text search to add a ranking layer that
 * understands the substrate's structure:
 *
 *   • LINEAGE BOOST     — DTUs cited by many other DTUs rank higher (PageRank-lite).
 *   • RECENCY DECAY     — score multiplier 1.0 -> 0.3 over a 90-day half-life.
 *   • SCOPE FILTER      — only return results within the caller's allowed scopes
 *                         (personal / org / public / federated).
 *   • DOMAIN MATCH      — exact-domain match boost when the query carries a domain.
 *
 * Plus persistence:
 *
 *   • saveSearch(userId, q)        — store the query; returns saved id
 *   • getSavedSearches(userId)
 *   • recordSearchHistory(userId, q)
 *   • getSearchHistory(userId)
 */

const RECENCY_HALFLIFE_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * Re-rank a list of search results.
 *
 * @param {Array} results   - [{ dtuId, title, score, createdAt, ownerId, domain, citations? }]
 * @param {object} STATE
 * @param {object} ctx       - { q, userId, allowedScopes, requestedDomain }
 * @returns ranked results
 */
export function rankResults(results, STATE, ctx = {}) {
  if (!Array.isArray(results)) return [];
  const allowedScopes = new Set(ctx.allowedScopes ?? ["public", "personal", "org", "federated"]);
  const now = Date.now();
  const out = [];

  for (const r of results) {
    const dtu = STATE?.dtus?.get?.(r.dtuId ?? r.id);
    if (!dtu) {
      // Result is from a federation peer — accept it as-is, with no boost.
      out.push({ ...r, finalScore: r.score ?? 0 });
      continue;
    }

    // Scope filter.
    const scope = dtu.scope ?? "public";
    if (!allowedScopes.has(scope)) continue;

    let score = r.score ?? 0;

    // Lineage boost: DTUs cited by many others rank higher.
    const incomingCitations = countIncomingCitations(dtu.id, STATE);
    const lineageBoost = Math.log10(1 + incomingCitations) * 0.4;
    score += lineageBoost;

    // Recency decay: half-life 90 days.
    const ts = parseTime(dtu.createdAt) || now;
    const ageMs = Math.max(0, now - ts);
    const recencyMult = Math.pow(0.5, ageMs / RECENCY_HALFLIFE_MS);
    score *= 0.3 + 0.7 * recencyMult;

    // Domain match boost.
    if (ctx.requestedDomain && dtu.domain === ctx.requestedDomain) {
      score *= 1.2;
    }

    out.push({
      ...r,
      finalScore: score,
      lineageBoost: Math.round(lineageBoost * 100) / 100,
      recencyMult: Math.round(recencyMult * 100) / 100,
      incomingCitations,
    });
  }
  out.sort((a, b) => (b.finalScore ?? 0) - (a.finalScore ?? 0));
  return out;
}

function countIncomingCitations(dtuId, STATE) {
  if (!dtuId || !STATE?.dtus) return 0;
  let count = 0;
  for (const dtu of STATE.dtus.values?.() ?? []) {
    const parents = dtu.lineage?.parents ?? [];
    const cites   = dtu.lineage?.citations ?? [];
    if (parents.includes?.(dtuId)) count++;
    if (cites.some?.(c => (typeof c === "string" ? c : c?.dtuId) === dtuId)) count++;
  }
  return count;
}

function parseTime(t) {
  if (!t) return 0;
  if (typeof t === "number") return t;
  const v = new Date(t).getTime();
  return Number.isFinite(v) ? v : 0;
}

// ── Search history + saved searches ─────────────────────────────────────────
// DB-backed via migration 086. In-memory cache layered on top so reads
// stay cheap. Falls back gracefully when db is null (tests, no-DB mode).

const _history = new LruMap();        // userId -> [{ q, ts }]   (cache)
const _saved   = new LruMap();        // userId -> [{ id, q, name, createdAt }]
const HISTORY_MAX = 100;
let _dbRef = null;

export function setSearchPersistenceDb(db) { _dbRef = db; }

export function recordSearchHistory(userId, q) {
  if (!userId || !q) return;
  const cleaned = String(q).slice(0, 500);
  if (!_history.has(userId)) _history.set(userId, []);
  const arr = _history.get(userId);
  arr.unshift({ q: cleaned, ts: Date.now() });
  if (arr.length > HISTORY_MAX) arr.length = HISTORY_MAX;

  if (_dbRef) {
    try {
      _dbRef.prepare("INSERT INTO search_history (user_id, q, ts) VALUES (?, ?, ?)")
            .run(userId, cleaned, Math.floor(Date.now() / 1000));
      // Bound table size: trim per-user to last 200 rows.
      _dbRef.prepare(`DELETE FROM search_history
                      WHERE id IN (
                        SELECT id FROM search_history
                        WHERE user_id = ?
                        ORDER BY ts DESC
                        LIMIT -1 OFFSET 200
                      )`).run(userId);
    } catch { /* table may not exist if migration didn't run */ }
  }
}

export function getSearchHistory(userId, limit = 50) {
  if (!userId) return { ok: true, history: [] };
  if (_dbRef) {
    try {
      const rows = _dbRef.prepare("SELECT q, ts FROM search_history WHERE user_id = ? ORDER BY ts DESC LIMIT ?")
                         .all(userId, limit);
      if (rows?.length) {
        return { ok: true, history: rows.map(r => ({ q: r.q, ts: r.ts * 1000 })) };
      }
    } catch { /* fall back to cache */ }
  }
  const arr = _history.get(userId) ?? [];
  return { ok: true, history: arr.slice(0, limit) };
}

export function saveSearch(userId, q, name) {
  if (!userId || !q) return { ok: false, error: "missing_user_or_query" };
  const id = `saved_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const entry = {
    id,
    q: String(q).slice(0, 500),
    name: String(name || q).slice(0, 100),
    createdAt: new Date().toISOString(),
  };
  if (!_saved.has(userId)) _saved.set(userId, []);
  const list = _saved.get(userId);
  list.unshift(entry);
  if (list.length > 50) list.length = 50;

  if (_dbRef) {
    try {
      _dbRef.prepare("INSERT INTO saved_searches (id, user_id, q, name, created_at) VALUES (?, ?, ?, ?, ?)")
            .run(entry.id, userId, entry.q, entry.name, entry.createdAt);
    } catch { /* table may not exist */ }
  }
  return { ok: true, saved: entry };
}

export function getSavedSearches(userId) {
  if (!userId) return { ok: true, saved: [] };
  if (_dbRef) {
    try {
      const rows = _dbRef.prepare("SELECT id, q, name, created_at FROM saved_searches WHERE user_id = ? ORDER BY created_at DESC")
                         .all(userId);
      if (rows) {
        return { ok: true, saved: rows.map(r => ({ id: r.id, q: r.q, name: r.name, createdAt: r.created_at })) };
      }
    } catch { /* fall back */ }
  }
  return { ok: true, saved: _saved.get(userId) ?? [] };
}

export function deleteSavedSearch(userId, id) {
  if (!userId || !id) return { ok: false, error: "missing_user_or_id" };
  const list = _saved.get(userId) ?? [];
  const next = list.filter(s => s.id !== id);
  _saved.set(userId, next);

  let dbDeleted = 0;
  if (_dbRef) {
    try {
      const r = _dbRef.prepare("DELETE FROM saved_searches WHERE user_id = ? AND id = ?").run(userId, id);
      dbDeleted = r.changes;
    } catch { /* fall back */ }
  }
  return { ok: true, deleted: Math.max(list.length - next.length, dbDeleted) };
}
