/**
 * Plugin signing + signature verification.
 *
 * Plugin packages are signed with the author's Ed25519 keypair. The
 * signature covers the canonical hash of the plugin source. The loader
 * verifies the signature against a registry of trusted public keys
 * before activating an installed plugin.
 *
 * This module is a small wrapper over node:crypto that exposes:
 *   • signPluginSource(source, privateKeyPem)  → signature (base64)
 *   • verifyPluginSignature(source, signature, publicKeyPem)
 *   • computePluginHash(source)                — sha-256 hex of canonicalized source
 *   • registerTrustedKey(authorId, publicKeyPem)
 *   • lookupTrustedKey(authorId)
 *
 * The trusted-key registry is in-memory; the migration adds a
 * `plugin_trusted_keys` table for persistence.
 */

import crypto from "node:crypto";

const _trustedKeys = new Map(); // authorId -> publicKeyPem

export function computePluginHash(source) {
  // Canonicalize: strip CRLF, trim trailing whitespace per line. This way a
  // file that gets reformatted by an editor still verifies if the semantic
  // content is unchanged.
  const canonical = String(source || "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map(l => l.replace(/\s+$/, ""))
    .join("\n");
  return crypto.createHash("sha256").update(canonical, "utf8").digest("hex");
}

export function signPluginSource(source, privateKeyPem) {
  if (!privateKeyPem) throw new Error("privateKeyPem_required");
  const hash = computePluginHash(source);
  const sig = crypto.sign(null, Buffer.from(hash, "hex"), {
    key: privateKeyPem,
    format: "pem",
  });
  return sig.toString("base64");
}

export function verifyPluginSignature(source, signatureB64, publicKeyPem) {
  if (!signatureB64 || !publicKeyPem) return { ok: false, error: "missing_inputs" };
  try {
    const hash = computePluginHash(source);
    const sig = Buffer.from(signatureB64, "base64");
    const ok = crypto.verify(null, Buffer.from(hash, "hex"), {
      key: publicKeyPem,
      format: "pem",
    }, sig);
    return ok ? { ok: true, hash } : { ok: false, error: "signature_invalid" };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}

export function registerTrustedKey(authorId, publicKeyPem, db = null) {
  if (!authorId || !publicKeyPem) return { ok: false, error: "missing_inputs" };
  _trustedKeys.set(authorId, publicKeyPem);
  if (db) {
    try {
      db.prepare(`INSERT OR REPLACE INTO plugin_trusted_keys
                  (author_id, public_key_pem, registered_at)
                  VALUES (?, ?, ?)`)
        .run(authorId, publicKeyPem, Date.now());
    } catch { /* table may not exist on first run */ }
  }
  return { ok: true };
}

export function lookupTrustedKey(authorId, db = null) {
  if (_trustedKeys.has(authorId)) return _trustedKeys.get(authorId);
  if (db) {
    try {
      const row = db.prepare("SELECT public_key_pem FROM plugin_trusted_keys WHERE author_id = ?").get(authorId);
      if (row?.public_key_pem) {
        _trustedKeys.set(authorId, row.public_key_pem);
        return row.public_key_pem;
      }
    } catch { /* table may not exist */ }
  }
  return null;
}

export function generatePluginKeypair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  return {
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  };
}

/**
 * Verify a packaged plugin (source + signature + claimed authorId) against
 * the trusted-key registry. Returns { ok, trusted, hash, reason }.
 */
export function verifyPluginPackage({ source, signature, authorId, db = null }) {
  if (!source || !authorId) return { ok: false, error: "missing_source_or_author" };
  const publicKeyPem = lookupTrustedKey(authorId, db);
  if (!publicKeyPem) {
    return { ok: false, trusted: false, error: "author_not_in_trusted_registry" };
  }
  if (!signature) {
    return { ok: false, trusted: false, error: "signature_required" };
  }
  const r = verifyPluginSignature(source, signature, publicKeyPem);
  if (!r.ok) return { ok: false, trusted: false, error: r.error };
  return { ok: true, trusted: true, hash: r.hash };
}
