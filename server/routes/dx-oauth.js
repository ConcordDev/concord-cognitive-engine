/**
 * DX Platform OAuth Flow — IDE plugin sign-in.
 *
 * Replaces the "paste a csk_* key into VS Code" UX with a browser-based
 * consent flow using the loopback-redirect pattern (RFC 8252) so any
 * installed IDE plugin can authenticate without a hosted callback URL.
 *
 * Flow:
 *   1. IDE plugin generates `state` + `port` + opens browser to:
 *        GET /oauth/dx?client=vscode&state=<random>&port=<localhost-port>
 *   2. Server checks the user is signed in (requireAuth). If not, the
 *      page renders a sign-in prompt; once signed in, the user lands
 *      back on the consent page.
 *   3. User clicks Allow on the consent page; the server POSTs to
 *        POST /oauth/dx/grant
 *      which mints a 60-second one-shot auth code.
 *   4. Server redirects browser to http://127.0.0.1:<port>/callback?code=&state=
 *   5. IDE plugin receives code, exchanges via:
 *        POST /api/dx/exchange { code, state }
 *      Server returns { token, expiresAt } where token is a long-lived
 *      csk_* key.
 *   6. IDE plugin stores the token in OS keychain (vscode.SecretStorage
 *      / JetBrains PasswordSafe) — never in plaintext settings.
 *
 * The auth code lives in an in-memory Map with explicit TTL eviction
 * (no SQLite write per code — codes are ephemeral by design).
 */

import express from "express";
import crypto from "crypto";
import { generateKey } from "../lib/api-keys.js";
import { serverError, clientError } from "../lib/http-errors.js";

const CODE_TTL_MS = 60_000; // 60s — RFC 8252 recommendation
const STATE_TTL_MS = 10 * 60 * 1000; // 10m — covers slow user sign-in
const ALLOWED_CLIENTS = new Set(["vscode", "jetbrains", "monaco-web", "cursor"]);

// In-memory state stores. Production single-replica — for multi-replica
// deploys these need to move to Redis (already configured via REDIS_URL
// in .env.example as of phase 2.3).
const _pendingStates = new Map(); // state → { client, port, userId?, expiresAt }
const _activeCodes  = new Map(); // code  → { userId, client, expiresAt }

function pruneExpired(map, now = Date.now()) {
  for (const [k, v] of map.entries()) {
    if (v.expiresAt < now) map.delete(k);
  }
}

function safeRandom(bytes = 32) {
  return crypto.randomBytes(bytes).toString("hex");
}

/**
 * Build the consent HTML. Inlined so the route stays self-contained.
 * Production-grade UX would template via React but for the IDE flow a
 * minimal HTML page is on-protocol.
 */
function consentPage({ client, state, signedIn, userEmail }) {
  const safeClient = String(client || "unknown").replace(/[^a-z0-9-]/gi, "");
  const safeState  = String(state).replace(/[^a-zA-Z0-9-]/g, "");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Concord — Authorize ${safeClient}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    body { font: 16px/1.5 -apple-system, system-ui, sans-serif; max-width: 480px; margin: 8vh auto; padding: 24px; background: #0c0c0c; color: #ddd; }
    h1 { font-size: 22px; margin: 0 0 16px; }
    .card { background: #161616; border: 1px solid #2a2a2a; border-radius: 8px; padding: 24px; }
    .scope { background: #1f1f1f; padding: 12px; margin: 12px 0; border-left: 3px solid #f0a020; border-radius: 4px; font-size: 14px; }
    button { width: 100%; padding: 12px; font: inherit; border: 0; border-radius: 4px; cursor: pointer; }
    .allow { background: #f0a020; color: #0c0c0c; font-weight: 600; }
    .allow:hover { background: #fab040; }
    .deny { background: transparent; color: #888; margin-top: 8px; }
    .deny:hover { color: #ddd; }
    .signin { background: transparent; color: #f0a020; text-decoration: underline; padding: 0; cursor: pointer; }
    code { background: #1a1a1a; padding: 2px 6px; border-radius: 3px; font-size: 13px; }
  </style>
</head>
<body>
  <h1>Authorize ${safeClient}</h1>
  <div class="card">
    ${signedIn ? `
      <p>The <strong>${safeClient}</strong> client wants to access your Concord account.</p>
      <p>Signed in as <code>${userEmail || "unknown"}</code></p>
      <div class="scope">
        <strong>Permissions requested</strong><br/>
        Read your detector findings · Read repair-cortex output · Spend Concord Coin from your wallet on macro calls · Read your usage / quota / billing
      </div>
      <form method="POST" action="/oauth/dx/grant">
        <input type="hidden" name="state" value="${safeState}" />
        <button type="submit" class="allow">Allow</button>
        <button type="button" class="deny" onclick="window.close()">Cancel</button>
      </form>
    ` : `
      <p>To authorize <strong>${safeClient}</strong>, sign in to Concord first.</p>
      <p><a href="/login?return=${encodeURIComponent(`/oauth/dx?client=${safeClient}&state=${safeState}`)}" class="allow" style="display:inline-block;text-decoration:none;text-align:center;">Sign in</a></p>
    `}
  </div>
</body>
</html>`;
}

/**
 * Mount the DX OAuth routes on the given Express app.
 *
 * @param {object} app - Express app instance
 * @param {object} deps
 * @param {Function} deps.requireAuth - factory that returns a middleware (or a middleware itself)
 * @param {object}   [deps.db]        - DB handle, currently unused (codes are ephemeral)
 * @param {Function} [deps.getUserById] - userId → { id, email } lookup for the consent page
 */
export function mountDxOAuth(app, { requireAuth, getUserById } = {}) {
  if (!app || typeof app.get !== "function") {
    throw new Error("mountDxOAuth: Express app required");
  }

  const auth = typeof requireAuth === "function" ? requireAuth() : null;

  // GET /oauth/dx?client=vscode&state=<random>&port=<lh>
  // AUTH: soft-auth — we run the auth middleware so req.user is
  // populated for signed-in operators, but render a sign-in prompt
  // (rather than 401) when it isn't.
  const softAuth = (req, _res, next) => {
    if (!auth) return next();
    auth(req, _res, (err) => next()); // ignore auth errors → render prompt
  };
  app.get("/oauth/dx", softAuth, (req, res, next) => {
    pruneExpired(_pendingStates);
    pruneExpired(_activeCodes);

    const client = String(req.query.client || "");
    const state  = String(req.query.state || "");
    const port   = String(req.query.port || "");

    if (!ALLOWED_CLIENTS.has(client)) {
      return clientError(res, `unsupported_client: ${client}. Allowed: ${[...ALLOWED_CLIENTS].join(", ")}`, 400);
    }
    if (!/^[a-zA-Z0-9-]{16,}$/.test(state)) {
      return clientError(res, "state must be a random token of ≥ 16 alphanumeric chars (RFC 8252)", 400);
    }
    if (port && !/^\d{2,5}$/.test(port)) {
      return clientError(res, "port must be a TCP port number when supplied", 400);
    }

    // Record the state so the grant step can validate it.
    _pendingStates.set(state, {
      client,
      port: port || null,
      userId: req.user?.id || null,
      expiresAt: Date.now() + STATE_TTL_MS,
    });

    let user = null;
    if (req.user?.id && typeof getUserById === "function") {
      try { user = getUserById(req.user.id); } catch { /* best-effort */ }
    }

    res.set("Content-Type", "text/html; charset=utf-8");
    res.send(consentPage({
      client,
      state,
      signedIn: Boolean(req.user?.id),
      userEmail: user?.email || null,
    }));
  });

  // POST /oauth/dx/grant — user clicked Allow on the consent page.
  // AUTH: requireAuth gates this — only signed-in users can grant.
  const grantHandlers = auth ? [auth, grantHandler] : [grantHandler];
  app.post("/oauth/dx/grant", express.urlencoded({ extended: false }), ...grantHandlers);

  function grantHandler(req, res) {
    try {
      pruneExpired(_pendingStates);
      pruneExpired(_activeCodes);

      const state = String(req.body?.state || req.query?.state || "");
      const pending = _pendingStates.get(state);
      if (!pending) {
        return clientError(res, "state_unknown_or_expired", 400);
      }
      // Bind state to the user who granted.
      pending.userId = req.user?.id || pending.userId;
      if (!pending.userId) {
        return clientError(res, "must_be_signed_in_to_grant", 401);
      }

      // Mint a one-shot auth code (60s TTL).
      const code = "dx_" + safeRandom(24);
      _activeCodes.set(code, {
        userId: pending.userId,
        client: pending.client,
        state,
        expiresAt: Date.now() + CODE_TTL_MS,
      });
      _pendingStates.delete(state);

      // Loopback redirect — RFC 8252.
      if (pending.port) {
        // @env-config-ok: RFC 8252 oauth loopback redirect — MUST be 127.0.0.1 by spec
        const url = `http://127.0.0.1:${pending.port}/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`;
        return res.redirect(302, url);
      }

      // No loopback port (older clients) → render a copyable code page.
      res.set("Content-Type", "text/html; charset=utf-8");
      res.send(`<!doctype html><body style="font:16px/1.5 system-ui;max-width:480px;margin:8vh auto;padding:24px;background:#0c0c0c;color:#ddd"><h1>Authorization Granted</h1><p>Copy this one-time code into your IDE plugin:</p><code style="display:block;background:#161616;padding:12px;border-radius:4px;word-break:break-all">${code}</code><p style="color:#888;font-size:14px">This code expires in 60 seconds.</p></body>`);
    } catch (e) {
      return serverError(res, e);
    }
  }

  // POST /api/dx/exchange — IDE plugin trades the auth code for a
  // long-lived csk_* token.
  // AUTH: public — the auth code IS the proof; no other auth required.
  app.post("/api/dx/exchange", express.json(), (req, res) => {
    try {
      pruneExpired(_activeCodes);

      const code  = String(req.body?.code || "");
      const state = String(req.body?.state || "");
      if (!code || !state) {
        return clientError(res, "code and state required", 400);
      }
      const entry = _activeCodes.get(code);
      if (!entry) {
        return clientError(res, "code_unknown_or_expired", 400);
      }
      if (entry.state !== state) {
        return clientError(res, "state_mismatch", 400);
      }

      // One-shot: consume the code immediately.
      _activeCodes.delete(code);

      const result = generateKey(entry.userId, ["dx-platform"], {
        requestsPerMinute: 120,
        requestsPerDay: 50_000,
      });
      if (!result.ok) {
        return serverError(res, new Error(`token_mint_failed: ${result.error}`));
      }

      return res.json({
        ok: true,
        token: result.rawKey,
        token_id: result.key.id,
        client: entry.client,
        expires_at: null, // csk_* keys don't auto-expire; user can revoke via /api/keys
      });
    } catch (e) {
      return serverError(res, e);
    }
  });

  // GET /api/dx/sessions — list pending (un-consumed) codes for a user.
  // Useful for IDE plugins that want to show "n pending sign-ins".
  // AUTH: gated by requireAuth.
  const sessionsHandlers = auth ? [auth, sessionsHandler] : [sessionsHandler];
  app.get("/api/dx/sessions", ...sessionsHandlers);
  function sessionsHandler(req, res) {
    if (!req.user?.id) return clientError(res, "auth_required", 401);
    pruneExpired(_activeCodes);
    pruneExpired(_pendingStates);
    const codes = [..._activeCodes.values()].filter(c => c.userId === req.user.id);
    const states = [..._pendingStates.values()].filter(s => s.userId === req.user.id);
    res.json({
      ok: true,
      pending_codes: codes.length,
      pending_consents: states.length,
    });
  }

  return app;
}

// Test-only: clear all in-memory state so tests can isolate.
export function _resetDxOauthState() {
  _pendingStates.clear();
  _activeCodes.clear();
}
