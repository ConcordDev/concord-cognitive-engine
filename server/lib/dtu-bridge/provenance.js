// server/lib/dtu-bridge/provenance.js
//
// DTU bridge — Slice 1 (foundation): provenance chain math.
//
// The bridge reuses Concord's existing integrity semantics; it does
// not invent a new rule (DTU bridge plan, §3). The recipes mirror
// server/lib/dtu-integrity.js exactly:
//   - a DTU's content hash is SHA-256 over its content — objects are
//     JSON.stringify'd first (dtu-integrity's hashContent /
//     generateIntegrity, which hashes `dtu.content`);
//   - a signature is HMAC-SHA256 over the content hash
//     (dtu-integrity's generateSignature).
// And the pack hash uses the canonical (sorted-key) stringify from
// server/lib/dtu-portability.js, re-implemented here so the bridge
// modules stay dependency-light; a test pins the two implementations
// to identical output on a nested fixture.
//
// A bridge "record" is one version of one DTU in one substrate table:
//   { table, id, payload, provenance: { contentHash, parentHash, signature } }
// `payload` is the DTU-shaped object (its `content` field is what gets
// hashed, exactly as generateIntegrity hashes `dtu.content`; a payload
// without a content field is hashed whole). `parentHash` is the
// content hash of the version this one derives from, or null for a
// chain root. A DTU's versions, ordered root → head, form its chain.

import { createHash, createHmac } from "node:crypto";

function sha256Hex(data) {
  return createHash("sha256").update(data).digest("hex");
}

/** Canonical stringify — identical algorithm to dtu-portability.js. */
export function canonicalStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalStringify(value[k])}`).join(",")}}`;
}

/** SHA-256 content hash of a payload, dtu-integrity recipe. */
export function computeContentHash(payload) {
  const content =
    payload && typeof payload === "object" && "content" in payload ? payload.content : payload;
  const data = content && typeof content === "object" ? JSON.stringify(content) : String(content ?? "");
  return sha256Hex(data);
}

/** HMAC-SHA256 signature over a content hash, dtu-integrity recipe. */
export function signContentHash(contentHash, key) {
  return createHmac("sha256", key).update(contentHash).digest("hex");
}

/**
 * Build the provenance block for a new version of a DTU.
 * `parentHash` is the previous version's content hash (null at the
 * root). When `key` is given the version is signed; without a key the
 * signature is null and validity rests on hash linkage alone — the
 * verifier reports that honestly instead of pretending a check ran.
 */
export function makeProvenance(payload, parentHash = null, key = null) {
  const contentHash = computeContentHash(payload);
  return {
    contentHash,
    parentHash: parentHash ?? null,
    signature: key ? signContentHash(contentHash, key) : null,
  };
}

/**
 * Verify one DTU's chain: records ordered root → head.
 * A chain is valid when every record's stored content hash recomputes
 * from its payload, every non-root record's parentHash equals the
 * previous record's content hash, and — when a key is supplied — every
 * present signature verifies. A root's parentHash may be null (a
 * genuine root) or an external anchor hash (a chain segment whose
 * earlier versions live on the other side of the bridge); linkage is
 * only enforced between records present in the array.
 *
 * Returns { valid, failures: [{ index, reason }], signatureChecked }.
 * Reasons: "content_hash_mismatch", "broken_link", "bad_signature".
 */
export function verifyChain(records, { key = null } = {}) {
  const failures = [];
  let signatureChecked = false;
  if (!Array.isArray(records) || records.length === 0) {
    return { valid: false, failures: [{ index: -1, reason: "empty_chain" }], signatureChecked };
  }
  records.forEach((rec, i) => {
    const prov = rec?.provenance || {};
    if (prov.contentHash !== computeContentHash(rec?.payload)) {
      failures.push({ index: i, reason: "content_hash_mismatch" });
    }
    if (i > 0 && prov.parentHash !== records[i - 1]?.provenance?.contentHash) {
      failures.push({ index: i, reason: "broken_link" });
    }
    if (key && prov.signature) {
      signatureChecked = true;
      if (prov.signature !== signContentHash(prov.contentHash, key)) {
        failures.push({ index: i, reason: "bad_signature" });
      }
    }
  });
  return { valid: failures.length === 0, failures, signatureChecked };
}
