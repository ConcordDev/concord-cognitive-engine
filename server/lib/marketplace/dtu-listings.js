// server/lib/marketplace/dtu-listings.js
//
// Smoking-gun cleanup — durable CRUD for the marketplace listings
// table (migration 230). Replaces the STATE.marketplaceListings Map
// pattern. Each in-memory listing object round-trips losslessly via
// rowToListing / listingToRow.

function _now() { return Math.floor(Date.now() / 1000); }
function _safeJson(s, fb) { if (s == null) return fb; try { return JSON.parse(s); } catch { return fb; } }
function _toIso(sec) { return new Date((sec || 0) * 1000).toISOString(); }
function _toSec(iso) {
  if (!iso) return _now();
  if (typeof iso === "number") return iso;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? Math.floor(t / 1000) : _now();
}

export function rowToListing(r) {
  if (!r) return null;
  return {
    id: r.id,
    sourceDtuId: r.source_dtu_id,
    sellerId: r.seller_id,
    scope: r.scope,
    title: r.title,
    domain: r.domain,
    description: r.description,
    artifact: _safeJson(r.artifact_json, null),
    qualityTier: r.quality_tier,
    qualityScore: r.quality_score,
    price: r.price,
    currency: r.currency,
    listedAt: _toIso(r.listed_at),
    downloads: r.downloads,
    ratings: _safeJson(r.ratings_json, []),
    status: r.status,
    repairScore: r.repair_score,
    repairFlags: _safeJson(r.repair_flags_json, []),
  };
}

export function listingToRow(l) {
  return {
    id: l.id,
    source_dtu_id: l.sourceDtuId,
    seller_id: l.sellerId,
    scope: l.scope || "marketplace",
    title: l.title,
    domain: l.domain || null,
    description: l.description || "",
    artifact_json: l.artifact ? JSON.stringify(l.artifact) : null,
    quality_tier: l.qualityTier || null,
    quality_score: l.qualityScore || null,
    price: Number(l.price) || 0,
    currency: l.currency || "concord_coin",
    listed_at: _toSec(l.listedAt),
    downloads: Number(l.downloads) || 0,
    ratings_json: JSON.stringify(l.ratings || []),
    status: l.status || "active",
    repair_score: l.repairScore ?? null,
    repair_flags_json: l.repairFlags ? JSON.stringify(l.repairFlags) : null,
  };
}

export function createListing(db, listing) {
  if (!db || !listing?.id) return { ok: false, reason: "missing_args" };
  const row = listingToRow(listing);
  try {
    db.prepare(`
      INSERT INTO marketplace_dtu_listings (
        id, source_dtu_id, seller_id, scope, title, domain, description,
        artifact_json, quality_tier, quality_score, price, currency,
        listed_at, downloads, ratings_json, status, repair_score, repair_flags_json, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      row.id, row.source_dtu_id, row.seller_id, row.scope, row.title, row.domain,
      row.description, row.artifact_json, row.quality_tier, row.quality_score,
      row.price, row.currency, row.listed_at, row.downloads, row.ratings_json,
      row.status, row.repair_score, row.repair_flags_json, _now(),
    );
    return { ok: true, id: row.id };
  } catch (err) {
    return { ok: false, reason: "insert_failed", error: err?.message };
  }
}

export function getListing(db, id) {
  if (!db || !id) return null;
  const r = db.prepare(`SELECT * FROM marketplace_dtu_listings WHERE id = ?`).get(id);
  return rowToListing(r);
}

export function listAllListings(db, { status = null, limit = 1000 } = {}) {
  if (!db) return [];
  try {
    const sql = status
      ? `SELECT * FROM marketplace_dtu_listings WHERE status = ? ORDER BY listed_at DESC LIMIT ?`
      : `SELECT * FROM marketplace_dtu_listings ORDER BY listed_at DESC LIMIT ?`;
    const rows = status ? db.prepare(sql).all(status, limit) : db.prepare(sql).all(limit);
    return rows.map(rowToListing);
  } catch {
    return [];
  }
}

export function countListings(db, { status = null } = {}) {
  if (!db) return 0;
  try {
    const sql = status
      ? `SELECT COUNT(*) AS n FROM marketplace_dtu_listings WHERE status = ?`
      : `SELECT COUNT(*) AS n FROM marketplace_dtu_listings`;
    const r = status ? db.prepare(sql).get(status) : db.prepare(sql).get();
    return r?.n || 0;
  } catch {
    return 0;
  }
}

export function updateDownloads(db, id, delta = 1) {
  if (!db || !id) return false;
  try {
    const r = db.prepare(`UPDATE marketplace_dtu_listings SET downloads = downloads + ?, updated_at = ? WHERE id = ?`).run(delta, _now(), id);
    return r.changes > 0;
  } catch {
    return false;
  }
}

export function setStatus(db, id, status) {
  if (!db || !id || !["active","removed","sold_out","draft"].includes(status)) return false;
  try {
    const r = db.prepare(`UPDATE marketplace_dtu_listings SET status = ?, updated_at = ? WHERE id = ?`).run(status, _now(), id);
    return r.changes > 0;
  } catch {
    return false;
  }
}
