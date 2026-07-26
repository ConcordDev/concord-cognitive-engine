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
};
