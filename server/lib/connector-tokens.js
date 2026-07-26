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

// Refresh proactively well before expiry to absorb clock skew + in-flight
// latency (OAuth 2.0 BCP guidance is a conservative buffer; ~5 min).
const EXPIRY_SKEW_S = 300;

// ── Provider-aware refresh (R1-3 hardening) ─────────────────────────────────
// Pre-fix, EVERY connector's refresh attempt was hardcoded to POST Google's
// token endpoint with GOOGLE_CLIENT_ID/SECRET, regardless of which provider
// actually issued the token. That's silently wrong for any non-Google
// connector that legitimately carries a refresh_token (e.g. Slack with token
// rotation enabled sends its refresh_token to Slack's oauth.v2.access
// endpoint, not Google's) — the request would reach Google, get rejected for
// reasons that have nothing to do with the real token's validity, and the
// connector would incorrectly read as broken (or, worse, if Google ever
// returned literally `invalid_grant` for an unrelated reason, a perfectly
// good Slack refresh token would be deleted).
//
// This table maps a connector_id (the key connector_oauth_tokens.connector_id
// is stored under) to its provider's real refresh mechanics. Keep in sync with
// routes/connector-oauth.js's CONNECTOR_TOKEN_KEY/PROVIDERS (that file owns the
// authorize/code-exchange side; this table owns the refresh side reached from
// connectorFetch's 401 retry + getValidAccessToken's proactive refresh).
const REFRESH_PROVIDER_BY_CONNECTOR = {
  google_calendar: "google",
  google_gmail: "google",
  google_sheets: "google",
  slack: "slack",
  // GitHub classic OAuth-app tokens never carry a refresh_token (they don't
  // expire) and Notion integration tokens are non-expiring either — both
  // short-circuit on the `no_refresh_token` guard below and never reach a
  // provider config, so no entry (or a `null` mapping) is honest, not a gap.
};

const PROVIDER_REFRESH_CONFIG = {
  google: {
    tokenUrl: "https://oauth2.googleapis.com/token",
    clientId: () => process.env.GOOGLE_CLIENT_ID,
    clientSecret: () => process.env.GOOGLE_CLIENT_SECRET,
    buildRequest: ({ refreshToken, clientId, clientSecret }) => ({
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }).toString(),
    }),
    // invalid_grant (revoked/expired refresh token, password change, etc.) is
    // TERMINAL — signal re-consent rather than a transient rejection.
    terminalReason: (body) => (body?.error === "invalid_grant" ? "reauth_required" : null),
  },
  slack: {
    tokenUrl: "https://slack.com/api/oauth.v2.access",
    clientId: () => process.env.SLACK_CLIENT_ID,
    clientSecret: () => process.env.SLACK_CLIENT_SECRET,
    buildRequest: ({ refreshToken, clientId, clientSecret }) => ({
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }).toString(),
    }),
    // Slack's Web API returns HTTP 200 even on a logical failure (`ok:false`
    // in the body) — the same footgun connector-client.js's slackBodyOk()
    // guards against on the egress side; the refresh side needs the same care.
    terminalReason: (body) =>
      body && body.ok === false && body.error === "invalid_refresh_token" ? "reauth_required" : null,
    bodyError: (body) => (body && body.ok === false ? body.error || "slack_refresh_error" : null),
  },
};

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
 * Refresh a connector's token using its stored refresh_token, routed to the
 * ISSUING provider's own token endpoint (never assumed to be Google's).
 * `fetchImpl` is injectable for tests. Returns { ok, ... } — never throws on a
 * provider failure; honest reason codes instead.
 */
export async function refreshConnectorToken(db, userId, connectorId, { fetchImpl = fetch } = {}) {
  const row = getConnectorToken(db, userId, connectorId);
  if (!row) return { ok: false, reason: "no_token" };
  if (!row.refresh_token) return { ok: false, reason: "no_refresh_token" };

  const providerName = REFRESH_PROVIDER_BY_CONNECTOR[connectorId] || null;
  const cfg = providerName ? PROVIDER_REFRESH_CONFIG[providerName] : null;
  if (!cfg) {
    // A refresh_token is on file but this connector has no known refresh
    // mechanics wired (shouldn't normally happen — github/notion never store
    // one in the first place, see the guard above). Honest non-guess rather
    // than silently routing it through an unrelated provider's endpoint.
    return { ok: false, reason: "refresh_not_supported" };
  }
  const clientId = cfg.clientId();
  const clientSecret = cfg.clientSecret();
  if (!clientId || !clientSecret) return { ok: false, reason: "connector_not_configured" };

  const reqSpec = cfg.buildRequest({ refreshToken: row.refresh_token, clientId, clientSecret });
  let res;
  try {
    res = await fetchImpl(cfg.tokenUrl, { method: "POST", headers: reqSpec.headers, body: reqSpec.body });
  } catch (e) {
    return { ok: false, reason: "refresh_request_failed", detail: String(e?.message || e) };
  }
  let body = null;
  try { body = await res.json(); } catch { body = null; }

  const terminal = cfg.terminalReason ? cfg.terminalReason(body) : null;
  if (terminal === "reauth_required") {
    // TERMINAL (revoked/expired refresh token, password change, etc.) — do
    // not retry. Drop the dead token and signal re-consent.
    deleteConnectorToken(db, userId, connectorId);
    return { ok: false, reason: "reauth_required" };
  }
  const bodyError = cfg.bodyError ? cfg.bodyError(body) : null;
  if (!res?.ok || bodyError) {
    return { ok: false, reason: bodyError || "refresh_rejected", status: res?.status };
  }
  if (!body?.access_token) {
    return { ok: false, reason: "refresh_rejected", detail: "no access_token in refresh response" };
  }
  // Most providers omit refresh_token on rotation (the old one stays valid).
  const updated = persistConnectorToken(db, userId, connectorId, {
    access_token: body.access_token,
    refresh_token: body.refresh_token || row.refresh_token,
    expires_in: body.expires_in,
    scope: body.scope || (row.scopes || []).join(" "),
    token_type: body.token_type || row.token_type,
  });
  return { ok: true, token: updated };
}

/** @deprecated back-compat alias — prefer refreshConnectorToken (provider-generic). */
export const refreshGoogleToken = refreshConnectorToken;

/**
 * Return a currently-valid access token for (user, connector), auto-refreshing
 * if expired. Returns { ok:true, accessToken } or an honest { ok:false, reason }.
 */
export async function getValidAccessToken(db, userId, connectorId, opts = {}) {
  const row = getConnectorToken(db, userId, connectorId);
  if (!row) return { ok: false, reason: "no_token" };
  if (!isExpired(row)) return { ok: true, accessToken: row.access_token, tokenType: row.token_type };
  const refreshed = await refreshConnectorToken(db, userId, connectorId, opts);
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
