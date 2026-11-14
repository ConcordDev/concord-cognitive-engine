// server/lib/connector-api-keys.js
//
// FIX-integrations-003 — per-user API-key store for api_key connectors
// (Airtable, Stripe), the credential path connectApp always lacked.
//
// Encryption is the platform's existing scheme, imported from
// connector-tokens.js: AES-256-GCM, enc:v1:<iv>:<tag>:<ct>, key =
// SHA-256 of CONCORD_CONNECTOR_TOKEN_KEY || JWT_SECRET || SESSION_SECRET
// (plaintext degrade + warning when no secret is configured — never a
// hardcoded key). One scheme platform-wide.
//
// Rules of the store:
//  - the full key is NEVER returned by any read here except
//    getConnectorApiKey, which exists for server-side egress use only
//    and must never be wired to an action result;
//  - a stored row whose ciphertext no longer decrypts (secret rotated
//    away, tampering) reads as NOT stored — fail closed, mirroring the
//    OAuth side's needs-reauth honesty;
//  - rotation is re-entry: persist upserts, overwriting ciphertext +
//    hint; there is no key history;
//  - revocation is deletion of the row.
// Key material is never logged here.

import crypto from "node:crypto";
import { encryptSecret, decryptSecret } from "./connector-tokens.js";

function tableMissing(e) {
  return /no such table/i.test(String(e?.message || e));
}

/** Store (or replace) a user's API key for a connector. Returns { hint }. */
export function persistConnectorApiKey(db, userId, connectorId, apiKey) {
  if (!db || !userId || !connectorId) throw new Error("db, userId, connectorId required");
  const key = String(apiKey ?? "").trim();
  if (!key) throw new Error("apiKey required");
  const hint = key.slice(-4);
  db.prepare(
    `INSERT INTO connector_api_keys (id, user_id, connector_id, encrypted_key, key_hint, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, unixepoch(), unixepoch())
     ON CONFLICT(user_id, connector_id) DO UPDATE SET
       encrypted_key = excluded.encrypted_key,
       key_hint = excluded.key_hint,
       updated_at = unixepoch()`,
  ).run(crypto.randomUUID(), userId, connectorId, encryptSecret(key), hint);
  return { hint };
}

/**
 * The decrypted key for server-side egress ONLY — never surface this in
 * an action result. Null when no row exists or the row no longer
 * decrypts (fail closed).
 */
export function getConnectorApiKey(db, userId, connectorId) {
  if (!db || !userId || !connectorId) return null;
  let row;
  try {
    row = db
      .prepare("SELECT encrypted_key FROM connector_api_keys WHERE user_id = ? AND connector_id = ?")
      .get(userId, connectorId);
  } catch (e) {
    if (tableMissing(e)) return null;
    throw e;
  }
  if (!row) return null;
  return decryptSecret(row.encrypted_key);
}

/** True only when a key is stored AND still decrypts. */
export function hasConnectorApiKey(db, userId, connectorId) {
  return getConnectorApiKey(db, userId, connectorId) != null;
}

/** Display-safe status: { stored, hint, updatedAt } — never the key. */
export function connectorApiKeyInfo(db, userId, connectorId) {
  if (!db || !userId || !connectorId) return { stored: false, hint: null, updatedAt: null };
  let row;
  try {
    row = db
      .prepare("SELECT key_hint, updated_at FROM connector_api_keys WHERE user_id = ? AND connector_id = ?")
      .get(userId, connectorId);
  } catch (e) {
    if (tableMissing(e)) return { stored: false, hint: null, updatedAt: null };
    throw e;
  }
  if (!row) return { stored: false, hint: null, updatedAt: null };
  return {
    stored: hasConnectorApiKey(db, userId, connectorId),
    hint: row.key_hint ?? null,
    updatedAt: row.updated_at ?? null,
  };
}

/** Revoke: delete the stored key. Returns true when a row was removed. */
export function deleteConnectorApiKey(db, userId, connectorId) {
  if (!db || !userId || !connectorId) return false;
  try {
    const r = db
      .prepare("DELETE FROM connector_api_keys WHERE user_id = ? AND connector_id = ?")
      .run(userId, connectorId);
    return r.changes > 0;
  } catch (e) {
    if (tableMissing(e)) return false;
    throw e;
  }
}
