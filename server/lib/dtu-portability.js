// server/lib/dtu-portability.js
//
// Phase 6b — DTU Portability / Export.
//
// Pack a user's DTU corpus into a single transportable JSON envelope
// they can import into another Concord instance. Sovereign-substrate
// guarantee: nothing about your DTUs requires this Concord — they
// belong to you.
//
// Envelope shape:
//   {
//     spec: "concord-dtu-pack/v1",
//     exported_at: <unix>,
//     creator_id: <userId>,
//     instance_signature: <sha1 of jwt-secret-or-hostname or empty>,
//     dtus: [...],
//     citations: [...],
//     economy_ledger: [...],     // optional, only on full export
//     hashes: { dtus_sha256, citations_sha256 }
//   }
//
// Hashes are computed canonically (sorted keys, deterministic JSON) so
// import can verify integrity end-to-end.

import crypto from "node:crypto";

const SPEC = "concord-dtu-pack/v1";

// ── Canonical stringify (deterministic key order) ───────────────────────────

export function canonicalStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map(k => `${JSON.stringify(k)}:${canonicalStringify(value[k])}`).join(",")}}`;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

// ── Export ──────────────────────────────────────────────────────────────────

/**
 * Pack a user's DTUs (and optionally citations + economy ledger) into a
 * single export envelope.
 *
 * Returns: { ok, envelope, hashes }
 */
export function exportUserCorpus(db, userId, opts = {}) {
  if (!db || !userId) return { ok: false, reason: "missing_inputs" };

  const includeEconomy = opts.includeEconomy !== false;
  const limit = Math.min(50000, Math.max(1, Number(opts.limit) || 10000));

  // DTUs
  let dtus = [];
  try {
    dtus = db.prepare(`
      SELECT id, kind, title, creator_id, meta_json,
             skill_level, total_experience, created_at
      FROM dtus WHERE creator_id = ?
      ORDER BY created_at ASC LIMIT ?
    `).all(userId, limit);
  } catch { return { ok: false, reason: "no_dtus_table" }; }

  // Citations (royalty cascade)
  let citations = [];
  try {
    citations = db.prepare(`
      SELECT * FROM dtu_citations
      WHERE creator_id = ? OR parent_creator_id = ?
      ORDER BY created_at ASC LIMIT ?
    `).all(userId, userId, limit);
  } catch { /* citations table may not be present in minimal builds */ }

  // Economy ledger (optional, scoped to user)
  let ledger = [];
  if (includeEconomy) {
    try {
      ledger = db.prepare(`
        SELECT * FROM economy_ledger
        WHERE buyer_id = ? OR seller_id = ? OR creator_id = ?
        ORDER BY created_at ASC LIMIT ?
      `).all(userId, userId, userId, limit);
    } catch { /* economy_ledger optional */ }
  }

  const dtus_sha256 = sha256(canonicalStringify(dtus));
  const citations_sha256 = sha256(canonicalStringify(citations));

  const instance_signature = computeInstanceSignature();

  const envelope = {
    spec: SPEC,
    exported_at: Math.floor(Date.now() / 1000),
    creator_id: userId,
    instance_signature,
    dtus,
    citations,
    economy_ledger: ledger,
    hashes: { dtus_sha256, citations_sha256 },
    counts: { dtus: dtus.length, citations: citations.length, economy: ledger.length },
  };

  return { ok: true, envelope, hashes: envelope.hashes };
}

function computeInstanceSignature() {
  // Use the JWT secret (env) hashed, or a constant fallback. We don't
  // expose the secret itself.
  const seed = process.env.JWT_SECRET || process.env.HOSTNAME || "concord-instance";
  return sha256(seed).slice(0, 16);
}

// ── Import (validate + persist) ─────────────────────────────────────────────

/**
 * Validate an import envelope's integrity. Pure function. Returns
 * { ok, reason?, dtuCount, citationCount, mismatched? }.
 */
export function validateEnvelope(envelope) {
  if (!envelope || envelope.spec !== SPEC) return { ok: false, reason: "bad_spec" };
  if (!envelope.creator_id) return { ok: false, reason: "no_creator_id" };
  if (!Array.isArray(envelope.dtus)) return { ok: false, reason: "dtus_missing" };

  const expectedDtuHash = envelope.hashes?.dtus_sha256;
  if (expectedDtuHash) {
    const recomputed = sha256(canonicalStringify(envelope.dtus));
    if (recomputed !== expectedDtuHash) return { ok: false, reason: "dtu_hash_mismatch" };
  }
  const expectedCiteHash = envelope.hashes?.citations_sha256;
  if (expectedCiteHash) {
    const recomputed = sha256(canonicalStringify(envelope.citations || []));
    if (recomputed !== expectedCiteHash) return { ok: false, reason: "citation_hash_mismatch" };
  }
  return {
    ok: true,
    dtuCount: envelope.dtus.length,
    citationCount: (envelope.citations || []).length,
    economyCount: (envelope.economy_ledger || []).length,
  };
}

/**
 * Import an envelope into the local DB. Idempotent on dtu.id (skips if
 * a DTU with that id already exists). Citation rows similarly unique.
 *
 * Returns { ok, imported: { dtus, citations, economy }, skipped }.
 */
export function importEnvelope(db, envelope, opts = {}) {
  if (!db) return { ok: false, reason: "no_db" };
  const validation = validateEnvelope(envelope);
  if (!validation.ok) return validation;

  const stats = { dtus: 0, citations: 0, economy: 0, skipped: 0 };

  // @sql-loop-ok: import is idempotent per dtu.id, so the per-row
  // SELECT is the contract (skip-if-exists). Caller-bounded by
  // envelope size + dtu_portability rate limit (4 imports/min).
  for (const dtu of envelope.dtus) {
    try {
      const exists = db.prepare(`SELECT id FROM dtus WHERE id = ?`).get(dtu.id);
      if (exists) { stats.skipped++; continue; }
      db.prepare(`
        INSERT INTO dtus (id, kind, title, creator_id, meta_json,
                          skill_level, total_experience, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        dtu.id, dtu.kind, dtu.title, dtu.creator_id,
        typeof dtu.meta_json === "string" ? dtu.meta_json : JSON.stringify(dtu.meta_json || {}),
        dtu.skill_level || 1, dtu.total_experience || 0,
        dtu.created_at || Math.floor(Date.now() / 1000),
      );
      stats.dtus++;
    } catch { stats.skipped++; }
  }

  if (opts.importCitations !== false) {
    for (const c of (envelope.citations || [])) {
      try {
        const cols = Object.keys(c);
        const placeholders = cols.map(() => "?").join(",");
        db.prepare(`INSERT INTO dtu_citations (${cols.join(",")}) VALUES (${placeholders})`)
          .run(...cols.map(k => c[k]));
        stats.citations++;
      } catch { stats.skipped++; }
    }
  }

  return { ok: true, imported: stats };
}
