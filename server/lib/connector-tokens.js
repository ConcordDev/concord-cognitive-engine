// server/lib/connector-tokens.js
//
// Real OAuth connector-token persistence + refresh rotation (Track C).
// Backs migration 331 `connector_oauth_tokens`. This is the piece the Sci-Fi
// Feasibility Map said was missing: instead of discarding the access/refresh
// tokens after sign-in (identity-only), a connector flow persists them here and
// reads back a VALID access token (auto-refreshing via the provider's token
// endpoint) so Concord can actually act on the user's behalf.
//
// No secrets are required to LOAD this module; calls that need the provider
// client secret degrade to an honest { ok:false, reason:'connector_not_configured' }.

import crypto from "node:crypto";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
// Refresh proactively well before expiry to absorb clock skew + in-flight
// latency (OAuth 2.0 BCP guidance is a conservative buffer; ~5 min).
const EXPIRY_SKEW_S = 300;

function nowS() {
  return Math.floor(Date.now() / 1000);
}

// ── Encryption at rest (RFC 6819 §5.1.4.1.3: tokens are long-term secrets and
// must not be stored in clear text). AES-256-GCM (authenticated) with a key
// derived from the deployment secret. Ciphertext format: enc:v1:<iv>:<tag>:<ct>
// (all hex). If no secret is configured we degrade to plaintext with a one-time
// warning rather than encrypting under a hardcoded (false-security) key. ──
const ENC_PREFIX = "enc:v1:";
let _warnedNoKey = false;

function tokenKey() {
  const raw =
    process.env.CONCORD_CONNECTOR_TOKEN_KEY ||
    process.env.JWT_SECRET ||
    process.env.SESSION_SECRET ||
    "";
  if (!raw) return null;
  return crypto.createHash("sha256").update(String(raw)).digest(); // 32 bytes
}

function encryptSecret(plain) {
  if (plain == null) return null;
  const key = tokenKey();
  if (!key) {
    if (!_warnedNoKey) {
      console.warn("[connector-tokens] no CONCORD_CONNECTOR_TOKEN_KEY/JWT_SECRET/SESSION_SECRET set — OAuth tokens stored UNENCRYPTED. Set a secret to enable AES-256-GCM at rest.");
      _warnedNoKey = true;
    }
    return String(plain);
  }
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(String(plain), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${ENC_PREFIX}${iv.toString("hex")}:${tag.toString("hex")}:${ct.toString("hex")}`;
}

function decryptSecret(stored) {
  if (stored == null) return null;
  const s = String(stored);
  if (!s.startsWith(ENC_PREFIX)) return s; // back-compat: legacy plaintext row
  const key = tokenKey();
  if (!key) return null; // can't decrypt without the key → treat as needs-reauth
  try {
    const [ivHex, tagHex, ctHex] = s.slice(ENC_PREFIX.length).split(":");
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivHex, "hex"));
    decipher.setAuthTag(Buffer.from(tagHex, "hex"));
    return Buffer.concat([decipher.update(Buffer.from(ctHex, "hex")), decipher.final()]).toString("utf8");
  } catch {
    return null; // tampered or wrong key → fail safe
  }
}

/** Persist (upsert) a connector's tokens for a user. Returns the stored row. */
export function persistConnectorToken(db, userId, connectorId, tokens = {}) {
  if (!db || !userId || !connectorId) throw new Error("db, userId, connectorId required");
  if (!tokens.access_token) throw new Error("access_token required");
  const expiresAt =
    typeof tokens.expires_in === "number" ? nowS() + tokens.expires_in
    : typeof tokens.expires_at === "number" ? tokens.expires_at
    : null;
  const scopes = Array.isArray(tokens.scopes)
    ? tokens.scopes
    : typeof tokens.scope === "string"
      ? tokens.scope.split(/\s+/).filter(Boolean)
      : [];
  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO connector_oauth_tokens
       (id, user_id, connector_id, access_token, refresh_token, token_type, expires_at, scopes_json, created_at, last_refreshed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, unixepoch(), unixepoch())
     ON CONFLICT(user_id, connector_id) DO UPDATE SET
       access_token = excluded.access_token,
       -- keep the existing refresh_token if the provider didn't send a new one
       refresh_token = COALESCE(excluded.refresh_token, connector_oauth_tokens.refresh_token),
       token_type = excluded.token_type,
       expires_at = excluded.expires_at,
       scopes_json = excluded.scopes_json,
       last_refreshed_at = unixepoch()`,
  ).run(
    id,
    userId,
    connectorId,
    encryptSecret(tokens.access_token),
    tokens.refresh_token ? encryptSecret(tokens.refresh_token) : null,
    tokens.token_type || "Bearer",
    expiresAt,
    JSON.stringify(scopes),
  );
  return getConnectorToken(db, userId, connectorId);
}

/** Read a connector token row (tokens decrypted), or null. */
export function getConnectorToken(db, userId, connectorId) {
  if (!db) return null;
  const row = db
    .prepare("SELECT * FROM connector_oauth_tokens WHERE user_id = ? AND connector_id = ?")
    .get(userId, connectorId);
  if (!row) return null;
  return {
    ...row,
    access_token: decryptSecret(row.access_token),
    refresh_token: decryptSecret(row.refresh_token),
    scopes: safeParseArray(row.scopes_json),
  };
}

/** Remove a connector's tokens (disconnect). */
export function deleteConnectorToken(db, userId, connectorId) {
  if (!db) return false;
  const r = db
    .prepare("DELETE FROM connector_oauth_tokens WHERE user_id = ? AND connector_id = ?")
    .run(userId, connectorId);
  return r.changes > 0;
}

function isExpired(row) {
  return typeof row.expires_at === "number" && row.expires_at <= nowS() + EXPIRY_SKEW_S;
}

/**
 * Refresh a Google connector token using its stored refresh_token.
 * `fetchImpl` is injectable for tests. Returns { ok, ... } — never throws on a
 * provider failure; honest reason codes instead.
 */
export async function refreshGoogleToken(db, userId, connectorId, { fetchImpl = fetch } = {}) {
  const row = getConnectorToken(db, userId, connectorId);
  if (!row) return { ok: false, reason: "no_token" };
  if (!row.refresh_token) return { ok: false, reason: "no_refresh_token" };
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return { ok: false, reason: "connector_not_configured" };

  let res;
  try {
    res = await fetchImpl(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: row.refresh_token,
        grant_type: "refresh_token",
      }).toString(),
    });
  } catch (e) {
    return { ok: false, reason: "refresh_request_failed", detail: String(e?.message || e) };
  }
  if (!res?.ok) {
    // invalid_grant (revoked/expired refresh token, password change, etc.) is
    // TERMINAL — do not retry. Drop the dead token and signal re-consent.
    let body = null;
    try { body = await res.json(); } catch { body = null; }
    if (body?.error === "invalid_grant") {
      deleteConnectorToken(db, userId, connectorId);
      return { ok: false, reason: "reauth_required" };
    }
    return { ok: false, reason: "refresh_rejected", status: res?.status };
  }
  const tokens = await res.json();
  // Google refresh responses omit refresh_token (the old one stays valid).
  const updated = persistConnectorToken(db, userId, connectorId, {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token || row.refresh_token,
    expires_in: tokens.expires_in,
    scope: tokens.scope || (row.scopes || []).join(" "),
    token_type: tokens.token_type || row.token_type,
  });
  return { ok: true, token: updated };
}

/**
 * Return a currently-valid access token for (user, connector), auto-refreshing
 * if expired. Returns { ok:true, accessToken } or an honest { ok:false, reason }.
 */
export async function getValidAccessToken(db, userId, connectorId, opts = {}) {
  const row = getConnectorToken(db, userId, connectorId);
  if (!row) return { ok: false, reason: "no_token" };
  if (!isExpired(row)) return { ok: true, accessToken: row.access_token, tokenType: row.token_type };
  const refreshed = await refreshGoogleToken(db, userId, connectorId, opts);
  if (!refreshed.ok) return refreshed;
  return { ok: true, accessToken: refreshed.token.access_token, tokenType: refreshed.token.token_type };
}

function safeParseArray(s) {
  try {
    const v = JSON.parse(s || "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
