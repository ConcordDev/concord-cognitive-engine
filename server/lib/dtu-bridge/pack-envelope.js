// server/lib/dtu-bridge/pack-envelope.js
//
// DTU bridge — Slice 1: the bridge pack envelope.
//
// DTUs cross the bridge inside the platform's existing pack format,
// concord-dtu-pack/v1 (server/lib/dtu-portability.js) — the bridge
// adds a record-level pack on top of it: each record is one version of
// one DTU from one substrate table, carrying its full provenance block
// (see provenance.js). The envelope's own pack hash is computed over
// the canonical stringify of the records, so any tampering with a
// payload or a provenance field after packing is detectable on the
// receiving side before anything is applied.
//
// Two integrity promises, both enforced here:
//   - buildPack refuses a record whose stored content hash does not
//     recompute from its payload — a pack never carries a record that
//     lies about what it contains;
//   - parsePack refuses an envelope whose pack hash does not recompute
//     — a tampered pack is rejected whole, never partially applied.
// Scope is enforced through the Slice 0 registry: a record naming a
// non-substrate table cannot be packed at all.

import { createHash } from "node:crypto";

import { assertSubstrateTable } from "./substrate-registry.js";
import { canonicalStringify, computeContentHash } from "./provenance.js";

export const BRIDGE_PACK_KIND = "dtu-bridge-pack";
export const BRIDGE_PACK_SPEC = "concord-dtu-pack/v1";

function packHashOf(records) {
  return createHash("sha256").update(canonicalStringify({ spec: BRIDGE_PACK_SPEC, records })).digest("hex");
}

function checkRecordShape(rec, i) {
  if (!rec || typeof rec !== "object") throw new TypeError(`record ${i}: not an object`);
  assertSubstrateTable(rec.table);
  if (typeof rec.id !== "string" || rec.id.length === 0) {
    throw new TypeError(`record ${i}: id must be a non-empty string`);
  }
  if (!rec.payload || typeof rec.payload !== "object") {
    throw new TypeError(`record ${i}: payload must be an object`);
  }
  const prov = rec.provenance;
  if (!prov || typeof prov.contentHash !== "string" || prov.contentHash.length === 0) {
    throw new TypeError(`record ${i}: provenance.contentHash is required`);
  }
  if (prov.parentHash !== null && typeof prov.parentHash !== "string") {
    throw new TypeError(`record ${i}: provenance.parentHash must be a string or null`);
  }
  if (prov.contentHash !== computeContentHash(rec.payload)) {
    const err = new Error(
      `record ${i} (${rec.table}/${rec.id}): provenance.contentHash does not match the payload — refusing to pack a record that misstates its content`
    );
    err.code = "DTU_BRIDGE_HASH_MISMATCH";
    throw err;
  }
}

/**
 * Pack bridge records into a concord-dtu-pack/v1 envelope.
 * Throws (coded) on an out-of-scope table or a hash-lying record.
 * Returns the envelope object; serialize with JSON.stringify.
 */
export function buildPack({ sourceNode = "unknown", records, exportedAt = null } = {}) {
  if (!Array.isArray(records) || records.length === 0) {
    throw new TypeError("buildPack: records must be a non-empty array");
  }
  records.forEach(checkRecordShape);
  return {
    spec: BRIDGE_PACK_SPEC,
    kind: BRIDGE_PACK_KIND,
    bridge: 1,
    sourceNode,
    exportedAt: exportedAt ?? new Date().toISOString(),
    records,
    packHash: packHashOf(records),
  };
}

/**
 * Parse and verify a pack (object or JSON string). Never throws on
 * bad input — returns { ok: false, reason } so receivers can refuse
 * cleanly. Reasons: "not_a_pack", "wrong_spec", "bad_shape",
 * "pack_hash_mismatch", or a record-level code from the shape check.
 */
export function parsePack(input) {
  let pack = input;
  if (typeof input === "string") {
    try {
      pack = JSON.parse(input);
    } catch {
      return { ok: false, reason: "not_a_pack" };
    }
  }
  if (!pack || typeof pack !== "object" || Array.isArray(pack)) {
    return { ok: false, reason: "not_a_pack" };
  }
  if (pack.spec !== BRIDGE_PACK_SPEC || pack.kind !== BRIDGE_PACK_KIND) {
    return { ok: false, reason: "wrong_spec" };
  }
  if (!Array.isArray(pack.records) || pack.records.length === 0 || typeof pack.packHash !== "string") {
    return { ok: false, reason: "bad_shape" };
  }
  try {
    pack.records.forEach(checkRecordShape);
  } catch (e) {
    return { ok: false, reason: e.code || "bad_shape", detail: e.message };
  }
  if (pack.packHash !== packHashOf(pack.records)) {
    return { ok: false, reason: "pack_hash_mismatch" };
  }
  return { ok: true, pack };
}

/** The records of a verified pack (call parsePack first). */
export function unpackRecords(pack) {
  return pack.records;
}
