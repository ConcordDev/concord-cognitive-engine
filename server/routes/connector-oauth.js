// server/routes/connector-oauth.js
//
// @env-config-ok — the notion.authUrl/tokenUrl below are Notion's fixed,
// vendor-published OAuth authorize/token endpoints, not deployment-specific
// config (same shape as the other providers' authUrl/tokenUrl in this file).
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
  "notion": "notion",
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
  github: {
    authUrl: "https://github.com/login/oauth/authorize",
    tokenUrl: "https://github.com/login/oauth/access_token",
    clientId: () => process.env.GITHUB_CLIENT_ID,
    clientSecret: () => process.env.GITHUB_CLIENT_SECRET,
    scopeJoin: " ",
    authParams: {},
    // GitHub OAuth App tokens (classic) don't expire and carry no refresh token.
    // exchangeCodeForToken sends Accept: application/json so GitHub returns JSON
    // rather than its default form-encoded body.
    parseToken: (j) => ({
      access_token: j.access_token,
      refresh_token: j.refresh_token || null,
      expires_in: j.expires_in,
      scope: j.scope,
      token_type: j.token_type || "Bearer",
    }),
  },
  notion: {
    authUrl: "https://api.notion.com/v1/oauth/authorize",
    tokenUrl: "https://api.notion.com/v1/oauth/token",
    clientId: () => process.env.NOTION_CLIENT_ID,
    clientSecret: () => process.env.NOTION_CLIENT_SECRET,
    scopeJoin: " ",
    // Notion capabilities are configured on the integration, not requested
    // per-call; owner=user is required for the user-token flow.
    authParams: { owner: "user" },
    // Notion's token exchange is non-standard: HTTP Basic auth
    // (client_id:client_secret) + a JSON body, not the OAuth2 form-encoded POST.
    buildTokenRequest: ({ code, redirectUri, clientId, clientSecret }) => ({
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: "Basic " + Buffer.from(`${clientId}:${clientSecret}`).toString("base64"),
      },
      body: JSON.stringify({ grant_type: "authorization_code", code, redirect_uri: redirectUri }),
    }),
    parseToken: (j) => ({
      access_token: j.access_token,
      refresh_token: j.refresh_token || null,
      expires_in: j.expires_in,
      scope: Array.isArray(j.scopes) ? j.scopes.join(" ") : j.scope,
      token_type: j.token_type || "Bearer",
    }),
  },
};

// The six marquee connectors ConKay surfaces as honest per-user status badges.
// `provider` keys into PROVIDERS (the operator-config source — env client
// id/secret); `id` keys into CONNECTOR_TOKEN_KEY (the per-user token-store key).
export const MARQUEE_CONNECTORS = [
  { id: "gmail", name: "Gmail", provider: "google" },
  { id: "google-calendar", name: "Google Calendar", provider: "google" },
  { id: "slack", name: "Slack", provider: "slack" },
  { id: "google-sheets", name: "Google Sheets", provider: "google" },
  { id: "github", name: "GitHub", provider: "github" },
  { id: "notion", name: "Notion", provider: "notion" },
];

/**
 * Compute the CALLER's per-connector honest status for the marquee connectors.
 * Pure over (db, userId) — the token query is ALWAYS scoped to the passed
 * userId (WHERE user_id = ?), and there is no parameter that could widen it, so
 * it is structurally impossible to read another user's connector state.
 * Exported for direct unit pinning.
 *
 * The two questions are answered from two DIFFERENT sources, deliberately:
 *   - "operator go-live" is a DEPLOYMENT-wide fact, knowable server-side from
 *     PROVIDERS[provider].clientId()/clientSecret() (env presence) — never
 *     per-user.
 *   - "this user linked" is PER-USER, from a grant row in connector_oauth_tokens
 *     scoped to userId.
 *
 * Per-connector status:
 *   - "needs-go-live" : operator OAuth client absent (provider client id/secret
 *                       not in the deploy env). Whole deployment can't connect
 *                       this connector until an operator supplies credentials.
 *   - "connected"     : operator configured AND this user has a stored OAuth
 *                       grant row. Reflects a stored grant on file — NOT a live
 *                       network probe of the token — but it is a real credential
 *                       row, never a guess or a fabricated success.
 *   - "not-connected" : operator configured, but this user has no grant row —
 *                       they simply haven't completed the connect/OAuth flow.
 *   - "unknown"       : the token store couldn't be read (no db / query threw).
 *                       Honest non-answer — never downgraded to a fake state.
 */
export function buildConnectorStatusList(db, userId) {
  return MARQUEE_CONNECTORS.map((c) => {
    const provider = PROVIDERS[c.provider];
    const operatorConfigured = !!(provider && provider.clientId() && provider.clientSecret());
    const tokenKey = CONNECTOR_TOKEN_KEY[c.id] || c.id;
    let hasToken = null; // null === unknown (db unavailable / read failed)
    if (operatorConfigured) {
      try {
        if (db && userId) {
          const row = db
            .prepare("SELECT 1 FROM connector_oauth_tokens WHERE user_id = ? AND connector_id = ? LIMIT 1")
            .get(userId, tokenKey);
          hasToken = !!row;
        }
      } catch { hasToken = null; }
    }
    let status;
    if (!operatorConfigured) status = "needs-go-live";
    else if (hasToken === null) status = "unknown";
    else status = hasToken ? "connected" : "not-connected";
    return { id: c.id, name: c.name, provider: c.provider, tokenKey, operatorConfigured, status };
  });
}

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
  // Provider-specific token request (Notion uses Basic auth + JSON body); the
  // default is the OAuth2 form-encoded POST with credentials in the body.
  const reqSpec = typeof p.buildTokenRequest === "function"
    ? p.buildTokenRequest({ code, redirectUri, clientId, clientSecret })
    : {
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body: new URLSearchParams({
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
          grant_type: "authorization_code",
        }).toString(),
      };
  let res;
  try {
    res = await fetchImpl(p.tokenUrl, {
      method: "POST",
      headers: reqSpec.headers,
      body: reqSpec.body,
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
// SECURITY: the OAuth callback 302s the browser to a caller-supplied
// `?redirect=` value. `frontendDone` resolves it with `new URL(base,
// FRONTEND_URL)`, and an ABSOLUTE `base` overrides the relative base entirely
// — so an unvalidated value turned the callback into an open redirect
// (`?redirect=https://evil.example` sent the user, mid-OAuth, to an attacker
// host with the flow's outcome params appended).
//
// Only same-origin relative paths are accepted. Rejected values fall back to
// the caller's default rather than erroring, so a malformed redirect degrades
// to "land on the normal post-connect page" instead of breaking the flow.
//
// Stricter than the frontend's equivalent guard at
// concord-frontend/app/login/page.tsx (`startsWith('/') && !startsWith('//')`)
// on one point that matters here: a BACKSLASH second character must also be
// rejected. WHATWG URL normalizes `\` to `/`, so `/\evil.example` parses as
// the protocol-relative `//evil.example` and resolves to an absolute
// attacker origin — passing a naive "starts with a single slash" check.
export function safeRelativeRedirect(value) {
  if (typeof value !== "string" || !value) return null;
  // Reject control chars/whitespace outright — they are only ever present to
  // smuggle something past a parser.
  // eslint-disable-next-line no-control-regex
  if (/[\s\u0000-\u001f\u007f]/.test(value)) return null;
  if (value[0] !== "/") return null;          // absolute URLs, scheme-relative, bare paths
  if (value[1] === "/" || value[1] === "\\") return null; // //host and /\host
  return value;
}

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
    // Defence in depth. The only caller-supplied redirect is already validated
    // at intake (see the authorize route), so this re-check should never fire
    // in practice — it exists so that a future call site passing an
    // unvalidated value cannot silently reopen the redirect.
    const base = safeRelativeRedirect(redirect)
      || (FRONTEND_URL ? `${FRONTEND_URL}/lenses/ingest` : "/");
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
    // Validated at INTAKE, not at use: a hostile value then never reaches
    // OAUTH_STATES at all, so all six frontendDone() call sites in the
    // callback are covered by this one check and none of them can be missed
    // by a later edit. An invalid value degrades to null, which frontendDone
    // resolves to the normal post-connect page.
    const redirect = safeRelativeRedirect(req.query.redirect ? String(req.query.redirect) : null);

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

  // GET /api/oauth/connector-status — the CALLER's own honest per-connector
  // state for the six marquee connectors. Read-only; strictly scoped to
  // req.user.id (buildConnectorStatusList only queries WHERE user_id = ?), so
  // it can never leak another user's connector state. Not signed in → 401 (no
  // fabricated state). See buildConnectorStatusList for the status semantics.
  app.get("/api/oauth/connector-status", (req, res) => {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ ok: false, error: "login_required" });
    return res.json({ ok: true, connectors: buildConnectorStatusList(db, userId) });
  });
}

// Exposed for tests.
export const __test = { OAUTH_STATES, markIngestConnectionConfigured };
