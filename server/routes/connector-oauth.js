// server/routes/connector-oauth.js
//
// Track C — the documented gap: the connector-AUTHORIZE flow (distinct from
// identity sign-in in routes/oauth.js). A connector flow needs the user to
// grant DATA-access scopes (Calendar/Gmail/Sheets/Slack), then persists the
// resulting access/refresh tokens via lib/connector-tokens.js so the egress
// path (lib/connector-client.js) can act on the user's behalf with refresh
// rotation.
//
// This serves exactly the URL domains/ingest.js already advertises:
//   GET /api/oauth/:provider/authorize?connection=<id>&token_key=<k>&scopes=<csv>
//   GET /api/oauth/:provider/authorize/callback
//
// Best practices (Google "OAuth 2.0 for Web Server Applications"): the
// authorization-code flow with access_type=offline + prompt=consent (so a
// refresh token is always returned), a non-guessable `state` validated on
// callback (CSRF), least-privilege scopes, and include_granted_scopes
// (incremental authorization). Provider-generic so Slack/others plug in.

import crypto from "node:crypto";
import { persistConnectorToken } from "../lib/connector-tokens.js";

const STATE_TTL_MS = 10 * 60 * 1000;
const OAUTH_STATES = new Map();
// @resource-leak-ok: process-lifetime — connector oauth state cleanup
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of OAUTH_STATES) {
    if (now - v.createdAt > STATE_TTL_MS) OAUTH_STATES.delete(k);
  }
}, 5 * 60 * 1000).unref();

// Map an ingest catalog connector id → the stable `connector_id` the egress
// path reads the token under (writeGoogleCalendarEvent hardcodes
// "google_calendar"; a Sheets read would key on "google_sheets", etc.). The
// authorize flow MUST persist under the same key or the read finds no token.
export const CONNECTOR_TOKEN_KEY = {
  "google-sheets": "google_sheets",
  "google-calendar": "google_calendar",
  "gmail": "google_gmail",
  "github": "github",
  "slack": "slack",
};

// Per-provider adapter: endpoints, secret resolution, scope delimiter, and the
// token-response normaliser (Slack's shape differs from the OAuth2 norm).
export const PROVIDERS = {
  google: {
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    clientId: () => process.env.GOOGLE_CLIENT_ID,
    clientSecret: () => process.env.GOOGLE_CLIENT_SECRET,
    scopeJoin: " ",
    authParams: { access_type: "offline", prompt: "consent", include_granted_scopes: "true" },
    parseToken: (j) => ({
      access_token: j.access_token,
      refresh_token: j.refresh_token || null,
      expires_in: j.expires_in,
      scope: j.scope,
      token_type: j.token_type || "Bearer",
    }),
  },
  slack: {
    authUrl: "https://slack.com/oauth/v2/authorize",
    tokenUrl: "https://slack.com/api/oauth.v2.access",
    clientId: () => process.env.SLACK_CLIENT_ID,
    clientSecret: () => process.env.SLACK_CLIENT_SECRET,
    scopeJoin: ",",
    authParams: {},
    // Slack returns a bot token at top-level + an optional user token under
    // authed_user. We persist the user token when present (acting as the user),
    // else the bot token. Slack omits expiry unless token rotation is enabled.
    parseToken: (j) => {
      if (j && j.ok === false) return { error: j.error || "slack_oauth_error" };
      const user = j.authed_user || {};
      const access = user.access_token || j.access_token;
      return {
        access_token: access,
        refresh_token: user.refresh_token || j.refresh_token || null,
        expires_in: user.expires_in || j.expires_in,
        scope: user.scope || j.scope,
        token_type: "Bearer",
      };
    },
  },
};

/** Build a provider consent URL (pure — unit-tested). */
export function buildAuthorizeUrl({ provider, clientId, redirectUri, scopes, state }) {
  const p = PROVIDERS[provider];
  if (!p) throw new Error(`unknown provider: ${provider}`);
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: (Array.isArray(scopes) ? scopes : [scopes]).filter(Boolean).join(p.scopeJoin),
    state,
    ...p.authParams,
  });
  return `${p.authUrl}?${params.toString()}`;
}

/** Exchange an authorization code for tokens (injectable fetch for tests). */
export async function exchangeCodeForToken(provider, { code, redirectUri, fetchImpl = fetch } = {}) {
  const p = PROVIDERS[provider];
  if (!p) return { ok: false, reason: "unknown_provider" };
  const clientId = p.clientId();
  const clientSecret = p.clientSecret();
  if (!clientId || !clientSecret) return { ok: false, reason: "connector_not_configured" };
  let res;
  try {
    res = await fetchImpl(p.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }).toString(),
    });
  } catch (e) {
    return { ok: false, reason: "token_request_failed", detail: String(e?.message || e) };
  }
  let body = null;
  try { body = await res.json(); } catch { body = null; }
  if (!res.ok) return { ok: false, reason: "token_exchange_rejected", status: res.status, body };
  const tokens = p.parseToken(body || {});
  if (tokens.error || !tokens.access_token) {
    return { ok: false, reason: tokens.error || "no_access_token", body };
  }
  return { ok: true, tokens };
}

/** Resolve the token connector_id for a request (explicit key wins). */
export function resolveTokenKey({ tokenKey, connectorId, provider }) {
  if (tokenKey) return String(tokenKey);
  if (connectorId && CONNECTOR_TOKEN_KEY[connectorId]) return CONNECTOR_TOKEN_KEY[connectorId];
  return provider;
}

// Best-effort: flip an ingest connection's status to "configured" once its
// connector OAuth completes. The ingest pipeline state is global, so we reach
// it directly rather than importing the domain closure.
function markIngestConnectionConfigured(userId, connectionId, tokenKey) {
  try {
    const conns = globalThis?._concordSTATE?.ingestLens?.connections;
    const userConns = conns?.get?.(userId);
    const conn = userConns?.get?.(connectionId);
    if (conn) {
      conn.status = "configured";
      conn.tokenKey = tokenKey;
      conn.connectedAt = Date.now();
      if (typeof globalThis._concordSaveStateDebounced === "function") {
        try { globalThis._concordSaveStateDebounced(); } catch { /* best effort */ }
      }
      return true;
    }
  } catch { /* best effort */ }
  return false;
}

/**
 * Register the connector-OAuth authorize + callback routes.
 * @param {import('express').Application} app
 * @param {object} deps - { db, structuredLog?, fetchImpl? }
 */
export default function registerConnectorOAuthRoutes(app, { db, structuredLog, fetchImpl = fetch } = {}) {
  const log = typeof structuredLog === "function" ? structuredLog : () => {};
  const _isProd = process.env.NODE_ENV === "production";
  const FRONTEND_URL = process.env.FRONTEND_URL
    || process.env.NEXT_PUBLIC_FRONTEND_URL
    || (_isProd ? null : "http://localhost:3000");

  function redirectBase(req) {
    return process.env.CONNECTOR_OAUTH_REDIRECT_BASE
      || `${req.protocol}://${req.get("host")}`;
  }
  function callbackUri(req, provider) {
    return `${redirectBase(req)}/api/oauth/${provider}/authorize/callback`;
  }
  function frontendDone(redirect, params) {
    const base = redirect || (FRONTEND_URL ? `${FRONTEND_URL}/lenses/ingest` : "/");
    try {
      const u = new URL(base, FRONTEND_URL || "http://localhost");
      for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
      return u.toString();
    } catch {
      return base;
    }
  }

  // GET /api/oauth/:provider/authorize — start the connector consent flow.
  app.get("/api/oauth/:provider/authorize", (req, res) => {
    const provider = String(req.params.provider || "").toLowerCase();
    const p = PROVIDERS[provider];
    if (!p) return res.status(404).json({ ok: false, error: `unknown provider: ${provider}` });
    if (!p.clientId() || !p.clientSecret()) {
      return res.status(501).json({ ok: false, error: `${provider} connector not configured (missing client id/secret)` });
    }
    const userId = req.user?.id;
    if (!userId) {
      // Must be signed in — we persist tokens against the user. Send to sign-in.
      const dest = FRONTEND_URL ? `${FRONTEND_URL}/auth?error=login_required` : "/auth?error=login_required";
      return res.redirect(302, dest);
    }
    const connectionId = req.query.connection ? String(req.query.connection) : null;
    const connectorId = req.query.connector ? String(req.query.connector) : null;
    const tokenKey = resolveTokenKey({ tokenKey: req.query.token_key, connectorId, provider });
    const scopes = String(req.query.scopes || "")
      .split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
    if (!scopes.length) return res.status(400).json({ ok: false, error: "scopes required" });
    const redirect = req.query.redirect ? String(req.query.redirect) : null;

    const state = crypto.randomBytes(24).toString("hex");
    OAUTH_STATES.set(state, { userId, provider, tokenKey, connectionId, scopes, redirect, createdAt: Date.now() });

    const url = buildAuthorizeUrl({
      provider,
      clientId: p.clientId(),
      redirectUri: callbackUri(req, provider),
      scopes,
      state,
    });
    return res.redirect(302, url);
  });

  // GET /api/oauth/:provider/authorize/callback — finish the flow + persist.
  app.get("/api/oauth/:provider/authorize/callback", async (req, res) => {
    const provider = String(req.params.provider || "").toLowerCase();
    const { code, state, error } = req.query;

    // Atomic one-time-use state claim (CSRF + replay protection).
    const entry = state ? OAUTH_STATES.get(String(state)) : null;
    const claimed = state ? OAUTH_STATES.delete(String(state)) : false;
    if (!entry || !claimed || Date.now() - entry.createdAt > STATE_TTL_MS) {
      log("warn", "connector_oauth_invalid_state", { ip: req.ip, provider });
      return res.redirect(302, frontendDone(null, { connector: "error", reason: "invalid_state" }));
    }
    if (error) {
      return res.redirect(302, frontendDone(entry.redirect, { connector: "denied", reason: String(error) }));
    }
    if (!code) {
      return res.redirect(302, frontendDone(entry.redirect, { connector: "error", reason: "no_code" }));
    }

    const exchanged = await exchangeCodeForToken(provider, {
      code: String(code),
      redirectUri: callbackUri(req, provider),
      fetchImpl,
    });
    if (!exchanged.ok) {
      log("error", "connector_oauth_exchange_failed", { provider, reason: exchanged.reason });
      return res.redirect(302, frontendDone(entry.redirect, { connector: "error", reason: exchanged.reason }));
    }

    try {
      persistConnectorToken(db, entry.userId, entry.tokenKey, {
        ...exchanged.tokens,
        scopes: entry.scopes,
      });
    } catch (e) {
      log("error", "connector_oauth_persist_failed", { provider, error: String(e?.message || e) });
      return res.redirect(302, frontendDone(entry.redirect, { connector: "error", reason: "persist_failed" }));
    }

    if (entry.connectionId) markIngestConnectionConfigured(entry.userId, entry.connectionId, entry.tokenKey);
    log("info", "connector_oauth_connected", { userId: entry.userId, provider, tokenKey: entry.tokenKey });
    return res.redirect(302, frontendDone(entry.redirect, { connector: "connected", key: entry.tokenKey }));
  });
}

// Exposed for tests.
export const __test = { OAUTH_STATES, markIngestConnectionConfigured };
