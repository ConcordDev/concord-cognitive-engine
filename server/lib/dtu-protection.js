/**
 * DTU Protection — the single, persisted "permanent record" concept.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Before this module, "protected" was three mutually-incompatible ideas:
 *
 *   1. `server/emergent/forgetting-engine.js#PROTECTION_RULES` honored
 *      `dtu._pinned === true` (and tier/tag/source rules) — but nothing else.
 *   2. `server/server.js#demoteToArchive` honored `dtu.protected ||
 *      dtu.immutable || dtu.seedOrigin` — and did NOT honor `_pinned`.
 *   3. `server/server.js` `evolution.dedupe` honored NOTHING AT ALL: it called
 *      `STATE.dtus.delete(b.id)` on any near-duplicate, and because
 *      `STATE.dtus` is a write-through store (`lib/dtu-store.js`) that delete
 *      is a real `DELETE FROM dtu_store` — a permanent, unrecoverable loss.
 *
 * On top of that, `forgetting-engine.js#protectDTU` only mutated the
 * in-memory object; it never called `STATE.dtus.set()`, which is the ONLY
 * code path in `lib/dtu-store.js` that writes SQLite. A pin therefore
 * evaporated on restart.
 *
 * This module makes "protected" ONE thing:
 *   - `stampDtuProtection()` sets BOTH legacy flags (`protected` AND
 *     `_pinned`) so both pre-existing mechanisms above honor it, plus a
 *     structured `dtu.protection` record.
 *   - `protectDtuInStore()` writes through `store.set()` — the real SQLite
 *     path — so the protection survives a restart.
 *   - `isDtuProtected()` is the one predicate every deletion path can call.
 *
 * INTEGRITY
 * ---------
 * The runtime DTU hash (`server.js`: `sha256(title + "\n" + cretiHuman)
 * .slice(0, 16)`) is 64-bit-truncated and covers neither `core`, `machine`,
 * nor `tags` — it cannot back a "byte-verifiable permanent record" claim.
 * At protection time we therefore compute a FULL SHA-256 over a canonical
 * projection of the DTU's semantic payload using the already-audited
 * primitives in `lib/dtu-protocol.js` (`computeContentHash`,
 * `stampProvenance`, `verify`). No new crypto is defined here.
 *
 * WHAT THE HASH COVERS — read this before trusting it. The hash covers
 * exactly the fields in `HASHED_FIELDS` below (the semantic payload:
 * title/human/core/machine/tags/content/…). It deliberately does NOT cover
 * placement + bookkeeping fields (`tier`, `scope`, `lineage`, `meta`,
 * `stats`, `abstraction`, `updatedAt`, `hash`, and any `_`-prefixed runtime
 * scratch), because those are legitimately rewritten by non-tampering
 * system paths — `applyAbstractionPlacement`/`enforceTierBudgets` rewrite
 * `tier` on every commit, and `forgetDTU` reparents a surviving DTU's
 * `lineage`. Including them would produce false tamper alarms and make the
 * signal useless. A change to any covered field is detected; a change to an
 * uncovered field is not, and that is a stated limit, not an oversight.
 */

import { computeContentHash, DTUProtocol } from "./dtu-protocol.js";

const protocol = new DTUProtocol();

/**
 * The exact semantic fields covered by the strong content hash.
 * Present keys only — an absent key is omitted from the hashed payload, so
 * adding a previously-absent field IS a detectable change.
 */
export const HASHED_FIELDS = Object.freeze([
  "id",
  "type",
  "kind",
  "title",
  "createdAt",
  "source",
  "creator",
  "ownerUserId",
  "tags",
  "human",
  "core",
  "machine",
  "content",
  "body",
  "creti",
  "cretiHuman",
]);

/**
 * Tags that mark a DTU as a permanent archive record. A vault/archive lens
 * that tags its records with any of these gets protection even if it never
 * calls `protectDtuInStore()` — belt and braces alongside the flags.
 */
export const PROTECTED_TAGS = Object.freeze(["vault", "permanent_record"]);

/**
 * The one predicate every destructive path should call.
 *
 * It deliberately unions BOTH pre-existing flag vocabularies (the
 * forgetting-engine's `_pinned` and demoteToArchive's
 * `protected`/`immutable`/`seedOrigin`) plus the structured record and the
 * archive tags, so a DTU protected through any of them is protected in all
 * of them.
 *
 * NOTE: this is intentionally NARROWER than
 * `forgetting-engine.js#isProtected`, which additionally treats whole
 * CATEGORIES as protected (tier core/mega, source user/sovereign,
 * constitutional/breakthrough tags, >5 children). Those are retention
 * heuristics for a scoring cycle; this is an explicit "this record is
 * permanent" assertion. Deletion paths that want the broader retention
 * policy should call the forgetting-engine's predicate instead.
 *
 * @param {object} dtu
 * @returns {boolean}
 */
export function isDtuProtected(dtu) {
  if (!dtu || typeof dtu !== "object") return false;
  if (dtu.protected === true) return true;
  if (dtu._pinned === true) return true;
  if (dtu.immutable === true) return true;
  if (dtu.seedOrigin) return true;
  if (dtu.protection && dtu.protection.protected === true) return true;
  if (Array.isArray(dtu.tags)) {
    for (const t of PROTECTED_TAGS) if (dtu.tags.includes(t)) return true;
  }
  return false;
}

/**
 * Canonical projection of a DTU's semantic payload — the exact object the
 * strong content hash is computed over. Pure; never mutates its input.
 * @param {object} dtu
 * @returns {object}
 */
export function protectionPayload(dtu) {
  const payload = {};
  if (!dtu || typeof dtu !== "object") return payload;
  for (const key of HASHED_FIELDS) {
    if (dtu[key] !== undefined) payload[key] = dtu[key];
  }
  return payload;
}

/**
 * Full-payload SHA-256 (64 hex chars) over `protectionPayload(dtu)`, using
 * `dtu-protocol.js#computeContentHash`'s canonical (recursively key-sorted)
 * stringify. Contrast with the runtime `dtu.hash`, which is a 16-hex
 * truncation of a hash over `title + "\n" + cretiHuman` only.
 * @param {object} dtu
 * @returns {string} hex sha256
 */
export function computeDtuContentHash(dtu) {
  return computeContentHash(protectionPayload(dtu));
}

/**
 * Build the throwaway protocol envelope the dtu-protocol primitives expect
 * (`{ content, metadata }`). Runtime DTUs are a different shape than protocol
 * DTUs, so we adapt rather than duplicate the protocol's logic.
 */
function protectionEnvelope(dtu, storedHash) {
  const content = protectionPayload(dtu);
  return {
    content,
    metadata: { contentHash: storedHash ?? computeContentHash(content) },
  };
}

/**
 * Mark a DTU as a permanent record IN MEMORY and stamp its integrity anchor.
 *
 * Sets BOTH legacy flags so both pre-existing protection mechanisms honor it,
 * and records a `dtu.protection` block carrying the full-payload hash + a
 * C2PA-style provenance assertion produced by `dtu-protocol.js#stampProvenance`.
 *
 * Does NOT persist — callers that want durability must go through
 * `protectDtuInStore()` (or otherwise call `STATE.dtus.set()`).
 *
 * @param {object} dtu
 * @param {object} [opts]
 * @param {string} [opts.reason]   why this record is permanent
 * @param {string} [opts.source]   which subsystem asserted it (e.g. "vault")
 * @param {string} [opts.signer]   signing identity, if any
 * @param {string} [opts.sourceUrl]
 * @param {string} [opts.sourceId]
 * @returns {object} the same dtu, mutated
 */
export function stampDtuProtection(dtu, opts = {}) {
  if (!dtu || typeof dtu !== "object") throw new Error("stampDtuProtection: dtu must be an object");

  // Compute over the payload BEFORE the flags/record are written — the
  // protection record itself is not in HASHED_FIELDS, and the boolean flags
  // aren't either, so stamping is idempotent w.r.t. the hash.
  const env = protectionEnvelope(dtu);
  protocol.stampProvenance(env, {
    sourceUrl: opts.sourceUrl ?? null,
    sourceId: opts.sourceId ?? dtu.id ?? null,
    signer: opts.signer ?? null,
  });

  dtu.protected = true;   // honored by server.js#demoteToArchive
  dtu._pinned = true;     // honored by forgetting-engine.js#PROTECTION_RULES

  dtu.protection = {
    protected: true,
    reason: opts.reason || "permanent_record",
    source: opts.source || "dtu-protection",
    protectedAt: new Date().toISOString(),
    algo: "sha256",
    hashedFields: [...HASHED_FIELDS],
    contentSha256: env.metadata.contentHash,
    provenance: env.metadata.provenance,
  };

  return dtu;
}

/**
 * Recompute the strong hash and compare it against the one stamped at
 * protection time, via `dtu-protocol.js#verify` (which also independently
 * checks the provenance assertion's own `contentSha256`).
 *
 * @param {object} dtu
 * @returns {{ok:boolean, verified:boolean, reason?:string, expected?:string, actual?:string, provenance?:object}}
 */
export function verifyDtuIntegrity(dtu) {
  const rec = dtu && dtu.protection;
  if (!rec || typeof rec.contentSha256 !== "string") {
    return { ok: false, verified: false, reason: "not_protected" };
  }
  const env = protectionEnvelope(dtu, rec.contentSha256);
  if (rec.provenance) env.metadata.provenance = rec.provenance;
  const r = protocol.verify(env);
  return {
    ok: true,
    verified: r.verified,
    expected: r.expected,
    actual: r.actual,
    ...(r.provenance ? { provenance: r.provenance } : {}),
  };
}

function isStoreLike(store) {
  return !!store && typeof store.get === "function" && typeof store.set === "function";
}

/**
 * Protect a DTU **durably**.
 *
 * `store.set()` is the ONLY path in `lib/dtu-store.js` that writes SQLite, so
 * this is what makes a pin survive a restart. Callers pass the live store
 * (`STATE.dtus`) — which is a write-through store object at runtime, and a
 * plain `Map` in unit tests; both satisfy the get/set contract.
 *
 * @param {object|Map} store  STATE.dtus (write-through store or Map)
 * @param {string} dtuId
 * @param {object} [opts]     forwarded to stampDtuProtection
 * @returns {{ok:boolean, dtuId?:string, protected?:boolean, contentSha256?:string, reason?:string}}
 */
export function protectDtuInStore(store, dtuId, opts = {}) {
  if (!isStoreLike(store)) return { ok: false, reason: "store_unavailable" };
  const dtu = store.get(dtuId);
  if (!dtu) return { ok: false, reason: "dtu_not_found", dtuId };
  stampDtuProtection(dtu, opts);
  store.set(dtuId, dtu); // write-through: SQLite first, then the memory cache
  return {
    ok: true,
    dtuId,
    protected: true,
    contentSha256: dtu.protection.contentSha256,
    protectedAt: dtu.protection.protectedAt,
  };
}

/**
 * Release an explicit protection, durably.
 *
 * Clears only the flags this module sets (`protected`, `_pinned`, and
 * `protection.protected`). It deliberately does NOT clear `immutable` or
 * `seedOrigin` — those assert a different thing (a seed/immutable DTU), and
 * `isDtuProtected` will keep returning true for them. The integrity record is
 * retained (with `protected: false`) rather than deleted, so the audit trail
 * of "this was once a permanent record, and here is the hash it carried"
 * survives the release.
 *
 * @param {object|Map} store
 * @param {string} dtuId
 * @returns {{ok:boolean, dtuId?:string, protected?:boolean, reason?:string}}
 */
export function unprotectDtuInStore(store, dtuId) {
  if (!isStoreLike(store)) return { ok: false, reason: "store_unavailable" };
  const dtu = store.get(dtuId);
  if (!dtu) return { ok: false, reason: "dtu_not_found", dtuId };
  dtu.protected = false;
  dtu._pinned = false;
  if (dtu.protection && typeof dtu.protection === "object") {
    dtu.protection.protected = false;
    dtu.protection.releasedAt = new Date().toISOString();
  }
  store.set(dtuId, dtu);
  return { ok: true, dtuId, protected: isDtuProtected(dtu) };
}

// ═══════════════════════════════════════════════════════════════════════════
// THE `dtus` TABLE PATH — the OTHER substrate
// ═══════════════════════════════════════════════════════════════════════════
//
// Everything above operates on runtime DTU OBJECTS living in `STATE.dtus` —
// the write-through store (`lib/dtu-store.js`) whose durable half is the
// `dtu_store` table. That is not the only place a DTU can live, and treating
// it as though it were is a real integration hole:
//
//   `server/domains/vault.js#admit` mints an archive record with a raw
//   `INSERT INTO dtus (id, type, title, creator_id, data, world_id, …)`.
//   It never writes `dtu_store` and never touches `STATE.dtus`. So
//   `protectDtuInStore(store, id)` — which begins with `store.get(id)` —
//   misses on 100% of Vault records and honestly reports `dtu_not_found`.
//   The archive whose entire product promise is permanence was the one
//   record class the permanence system could not reach.
//
// The functions below are the SAME protection concept applied to that other
// substrate. They reuse `stampDtuProtection` / `computeDtuContentHash` /
// `verifyDtuIntegrity` verbatim — there is no second hash, no second flag
// vocabulary, and no new crypto. What differs is only WHERE the record is
// read from and written back to: a `dtus` row's JSON payload column
// (`data`, falling back to migration 001's `body_json`) instead of
// `store.set()`.
//
// ── WHAT THE ROW PROJECTION HASHES, AND THE ONE DELIBERATE OMISSION ────────
//
// `dtuRowToRecord` maps table columns onto the runtime field names in
// `HASHED_FIELDS` (`type`/`title`/`creator_id`/`created_at` from columns,
// `human`/`core`/`machine`/`content`/… from the JSON payload). It
// deliberately does NOT populate `ownerUserId`, even though that field IS in
// `HASHED_FIELDS` and IS a real column, for exactly the reason the
// module header gives for excluding `tier` and `lineage`: a legitimate,
// non-tampering system path rewrites it. Two of them, in fact —
// `lib/account-lifecycle.js#executeAccountDeletion` anonymizes a retained
// record's attribution on account closure, and migration 001 declares
// `owner_user_id … ON DELETE SET NULL`. Hashing it would make a lawful GDPR
// erasure look identical to tampering, which would make the signal useless.
// `creator` (the `creator_id` column) IS hashed and IS stable: the
// anonymization path explicitly leaves it alone ("not the actual creator
// field — needed for wallet routing", `lib/consent.js#anonymizeAttribution`).
//
// This asymmetry with the store path is principled, not accidental: a
// `STATE.dtus` object's `ownerUserId` is not rewritten by any of those paths,
// so it stays inside that path's hash.

/** Columns this path reads when present. Absent ones are simply not selected. */
const DTU_ROW_COLUMNS = Object.freeze([
  "id", "type", "title", "creator_id", "owner_user_id",
  "data", "body_json", "tags_json", "created_at",
]);

function parseJsonObject(str) {
  if (!str || typeof str !== "string") return null;
  try {
    const v = JSON.parse(str);
    return v && typeof v === "object" && !Array.isArray(v) ? v : null;
  } catch { return null; }
}

function parseJsonArray(str) {
  if (!str || typeof str !== "string") return null;
  try {
    const v = JSON.parse(str);
    return Array.isArray(v) ? v : null;
  } catch { return null; }
}

// Column set per-db handle. Migrations run at boot, before any protection
// call, so a cached set cannot go stale in production; a test that ALTERs
// `dtus` after a protection call on the same handle would need a fresh handle.
const _dtuColumnCache = new WeakMap();

/** Available `dtus` columns, or null when the table is absent/unreadable. */
function dtuTableColumns(db) {
  if (!db || typeof db.prepare !== "function") return null;
  const cached = _dtuColumnCache.get(db);
  if (cached) return cached;
  let cols;
  try {
    cols = new Set(db.prepare("PRAGMA table_info(dtus)").all().map((r) => r.name));
  } catch { return null; }
  if (!cols.size) return null;
  _dtuColumnCache.set(db, cols);
  return cols;
}

function availableRowColumns(cols) {
  return DTU_ROW_COLUMNS.filter((c) => cols.has(c));
}

/** Read one `dtus` row with whatever of DTU_ROW_COLUMNS this schema has. */
function selectDtuRow(db, dtuId) {
  const cols = dtuTableColumns(db);
  if (!cols || !cols.has("id")) return null;
  const list = availableRowColumns(cols);
  try {
    return db.prepare(`SELECT ${list.join(", ")} FROM dtus WHERE id = ?`).get(String(dtuId)) || null;
  } catch { return null; }
}

/**
 * Which JSON payload column this schema stores a DTU's body in. `data` is the
 * modern convention (migration 087, what `vault.js` and
 * `cross-lens-discovery.js` use); `body_json` is migration 001's original.
 */
function payloadColumn(cols) {
  if (cols.has("data")) return "data";
  if (cols.has("body_json")) return "body_json";
  return null;
}

/**
 * Project a `dtus` table row into the runtime-DTU shape the hashing +
 * predicate functions above already understand. Pure; never touches the DB.
 *
 * Both JSON columns are merged (`body_json` first, `data` last so it wins) so
 * a row that carries its payload in either — or splits protection into one
 * and content into the other — projects to the same complete record.
 *
 * @param {object} row
 * @returns {object|null}
 */
export function dtuRowToRecord(row) {
  if (!row || typeof row !== "object") return null;
  const rec = { ...(parseJsonObject(row.body_json) || {}), ...(parseJsonObject(row.data) || {}) };

  rec.id = row.id;
  if (row.type != null) rec.type = row.type;
  if (row.title != null) rec.title = row.title;
  if (row.creator_id != null) rec.creator = row.creator_id;
  if (row.created_at != null) rec.createdAt = row.created_at;
  // NOTE: ownerUserId is deliberately NOT projected — see the section header.

  // Tags may live at the payload root, under `machine.tags` (the shape
  // `vault.js#admit` writes), or in the `tags_json` column. First one that is
  // really an array wins, so `PROTECTED_TAGS` and the hash see the same list.
  const candidates = [rec.tags, rec.machine && rec.machine.tags, parseJsonArray(row.tags_json)];
  const tags = candidates.find((t) => Array.isArray(t));
  if (tags) rec.tags = tags;

  return rec;
}

/**
 * Protect a DTU that lives in the `dtus` TABLE, durably.
 *
 * Reads the row, stamps it with the same `stampDtuProtection` used by the
 * store path, and writes ONLY the protection keys back into the row's JSON
 * payload column — the content is never rewritten, so the hash the stamp just
 * computed stays valid. `updated_at` is deliberately left alone: protecting a
 * record is not an edit to it.
 *
 * @param {object} db  better-sqlite3 handle
 * @param {string} dtuId
 * @param {object} [opts] forwarded to stampDtuProtection
 * @returns {{ok:boolean, dtuId?:string, protected?:boolean, column?:string, contentSha256?:string, protectedAt?:string, reason?:string, detail?:string}}
 */
export function protectDtuRow(db, dtuId, opts = {}) {
  if (!db || typeof db.prepare !== "function") return { ok: false, reason: "no_db" };
  if (!dtuId) return { ok: false, reason: "missing_dtu_id" };
  const cols = dtuTableColumns(db);
  if (!cols) return { ok: false, reason: "dtus_table_unavailable" };
  const jsonCol = payloadColumn(cols);
  if (!jsonCol) return { ok: false, reason: "no_payload_column" };

  const row = selectDtuRow(db, dtuId);
  if (!row) return { ok: false, reason: "dtu_not_found", dtuId: String(dtuId) };

  const record = dtuRowToRecord(row);
  stampDtuProtection(record, { source: "dtu-protection:row", ...opts });

  const payload = parseJsonObject(row[jsonCol]) || {};
  payload.protected = true;   // honored by server.js#demoteToArchive
  payload._pinned = true;     // honored by forgetting-engine.js#PROTECTION_RULES
  payload.protection = record.protection;

  try {
    db.prepare(`UPDATE dtus SET ${jsonCol} = ? WHERE id = ?`).run(JSON.stringify(payload), String(dtuId));
  } catch (e) {
    return { ok: false, reason: "persist_failed", detail: String(e?.message || e) };
  }

  return {
    ok: true,
    dtuId: String(dtuId),
    protected: true,
    column: jsonCol,
    contentSha256: record.protection.contentSha256,
    protectedAt: record.protection.protectedAt,
  };
}

/**
 * Release an explicit protection on a `dtus`-table record, durably. Mirrors
 * `unprotectDtuInStore`: the integrity record is retained (with
 * `protected:false` + a `releasedAt` stamp) rather than deleted, and
 * `immutable`/`seedOrigin`/archive tags are deliberately NOT cleared.
 */
export function unprotectDtuRow(db, dtuId) {
  if (!db || typeof db.prepare !== "function") return { ok: false, reason: "no_db" };
  const cols = dtuTableColumns(db);
  if (!cols) return { ok: false, reason: "dtus_table_unavailable" };
  const jsonCol = payloadColumn(cols);
  if (!jsonCol) return { ok: false, reason: "no_payload_column" };

  const row = selectDtuRow(db, dtuId);
  if (!row) return { ok: false, reason: "dtu_not_found", dtuId: String(dtuId) };

  const payload = parseJsonObject(row[jsonCol]) || {};
  payload.protected = false;
  payload._pinned = false;
  if (payload.protection && typeof payload.protection === "object") {
    payload.protection.protected = false;
    payload.protection.releasedAt = new Date().toISOString();
  }
  try {
    db.prepare(`UPDATE dtus SET ${jsonCol} = ? WHERE id = ?`).run(JSON.stringify(payload), String(dtuId));
  } catch (e) {
    return { ok: false, reason: "persist_failed", detail: String(e?.message || e) };
  }
  return { ok: true, dtuId: String(dtuId), protected: isDtuRowProtected(db, dtuId) };
}

/** `isDtuProtected` for a record that lives in the `dtus` table. */
export function isDtuRowProtected(db, dtuId) {
  const row = selectDtuRow(db, dtuId);
  if (!row) return false;
  return isDtuProtected(dtuRowToRecord(row));
}

/** `verifyDtuIntegrity` for a record that lives in the `dtus` table. */
export function verifyDtuRowIntegrity(db, dtuId) {
  const row = selectDtuRow(db, dtuId);
  if (!row) return { ok: false, verified: false, reason: "dtu_not_found", dtuId: String(dtuId) };
  return verifyDtuIntegrity(dtuRowToRecord(row));
}

/**
 * Every `dtus`-table record owned by `userId` that `isDtuProtected` calls
 * permanent. This is what a deletion path asks before it deletes.
 *
 * Deliberately a full scan of that ONE user's rows (index `idx_dtus_owner`)
 * with the JS predicate as the sole authority, rather than a SQL predicate
 * over `json_extract`/`LIKE`. A SQL approximation that drifts even slightly
 * from `isDtuProtected` — a new flag, a new entry in `PROTECTED_TAGS` — fails
 * in the direction of permanently destroying a record that claimed to be
 * permanent. Rows are streamed with `.iterate()`, so a prolific creator's
 * payloads are never all resident at once, and this runs once per account
 * closure. Correctness over a micro-optimization, on purpose.
 *
 * @returns {string[]} dtu ids (empty when the schema has no owner column)
 */
export function listProtectedDtuIdsForOwner(db, userId) {
  if (!db || typeof db.prepare !== "function" || !userId) return [];
  const cols = dtuTableColumns(db);
  if (!cols || !cols.has("owner_user_id") || !cols.has("id")) return [];
  const list = availableRowColumns(cols);
  const out = [];
  try {
    const stmt = db.prepare(`SELECT ${list.join(", ")} FROM dtus WHERE owner_user_id = ?`);
    for (const row of stmt.iterate(String(userId))) {
      if (isDtuProtected(dtuRowToRecord(row))) out.push(row.id);
    }
  } catch {
    // An unreadable `dtus` table yields no retention claims — the caller's
    // existing behaviour is unchanged rather than silently made stricter.
    return out;
  }
  return out;
}

export default {
  HASHED_FIELDS,
  PROTECTED_TAGS,
  isDtuProtected,
  protectionPayload,
  computeDtuContentHash,
  stampDtuProtection,
  verifyDtuIntegrity,
  protectDtuInStore,
  unprotectDtuInStore,
  // `dtus` table path
  dtuRowToRecord,
  protectDtuRow,
  unprotectDtuRow,
  isDtuRowProtected,
  verifyDtuRowIntegrity,
  listProtectedDtuIdsForOwner,
};
