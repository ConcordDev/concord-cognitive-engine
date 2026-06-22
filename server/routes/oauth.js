/**
 * OAuth routes — Google & Apple Sign-In
 *
 * Provides one-click sign-up/sign-in alongside existing email/password auth.
 * Mounted directly on app (not a sub-router) because callbacks need exact paths.
 *
 * Routes:
 *   GET  /api/auth/google           — Redirect to Google OAuth consent screen
 *   GET  /api/auth/google/callback   — Handle Google callback
 *   GET  /api/auth/apple            — Redirect to Apple Sign In
 *   POST /api/auth/apple/callback    — Handle Apple callback (Apple POSTs)
 *   GET  /api/auth/providers        — List available OAuth providers
 *   POST /api/auth/link/:provider   — Link OAuth to existing account
 *   DELETE /api/auth/link/:provider — Unlink OAuth from account
 */

import crypto from "crypto";
import { asyncHandler } from "../lib/async-handler.js";
import {
  getAvailableProviders,
  generateOAuthState,
  getGoogleAuthUrl,
  getAppleAuthUrl,
  exchangeGoogleCode,
  exchangeAppleCode,
} from "../lib/oauth-providers.js";
import logger from '../logger.js';
import { ageFromDob, MIN_AGE } from "../lib/age-gate.js";

// In-memory store for OAuth state tokens (CSRF protection)
// State tokens expire after 10 minutes
const OAUTH_STATES = new Map();
const STATE_TTL_MS = 10 * 60 * 1000;

// Periodic cleanup of expired states (every 5 minutes)
// @resource-leak-ok: process-lifetime — oauth token cleanup
setInterval(() => {
  const now = Date.now();
  for (const [state, entry] of OAUTH_STATES) {
    if (now - entry.createdAt > STATE_TTL_MS) {
      OAUTH_STATES.delete(state);
    }
  }
}, 5 * 60 * 1000).unref();

/**
 * Register OAuth routes on the Express app.
 *
 * @param {import('express').Application} app
 * @param {object} deps - Dependencies from server.js
 */
export default function registerOAuthRoutes(app, {
  db,
  AuthDB,
  uid,
  createToken,
  createRefreshToken,
  setAuthCookie,
  setRefreshCookie,
  auditLog,
  structuredLog,
  jwt,
  _REFRESH_FAMILIES,
}) {
  // Resolve the frontend URL OAuth redirects against. In production we
  // require an explicit FRONTEND_URL — silently sending OAuth callbacks
  // to localhost would either fail (browser refuses cross-origin redirect)
  // or worse, redirect production users to a dev box. Dev only falls back
  // when NODE_ENV !== "production".
  const _isProd = process.env.NODE_ENV === "production";
  const FRONTEND_URL = process.env.FRONTEND_URL
    || process.env.NEXT_PUBLIC_FRONTEND_URL
    || (_isProd ? null : "http://localhost:3000");
  if (_isProd && !FRONTEND_URL) {
    throw new Error("FRONTEND_URL or NEXT_PUBLIC_FRONTEND_URL must be set in production (oauth routes)");
  }

  // ── Helpers ─────────────────────────────────────────────────────────────

  /**
   * Create or retrieve an OAuth connection record.
   */
  function getOAuthConnection(provider, providerUserId) {
    if (!db) return null;
    try {
      const stmt = db.prepare(
        "SELECT * FROM oauth_connections WHERE provider = ? AND provider_user_id = ?"
      );
      return stmt.get(provider, providerUserId) || null;
    } catch {
      return null;
    }
  }

  function getOAuthConnectionsByUserId(userId) {
    if (!db) return [];
    try {
      const stmt = db.prepare("SELECT * FROM oauth_connections WHERE user_id = ?");
      return stmt.all(userId);
    } catch {
      return [];
    }
  }

  function createOAuthConnection({ userId, provider, providerUserId, email, name, avatarUrl }) {
    if (!db) return null;
    const now = new Date().toISOString();
    const id = uid("oauth");
    try {
      const stmt = db.prepare(`
        INSERT INTO oauth_connections (id, user_id, provider, provider_user_id, email, name, avatar_url, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      stmt.run(id, userId, provider, providerUserId, email || null, name || null, avatarUrl || null, now, now);
      return { id, userId, provider, providerUserId, email, name, avatarUrl, createdAt: now, updatedAt: now };
    } catch (err) {
      structuredLog("error", "oauth_connection_create_failed", { error: err.message, provider, providerUserId });
      return null;
    }
  }

  function deleteOAuthConnection(userId, provider) {
    if (!db) return false;
    try {
      const stmt = db.prepare("DELETE FROM oauth_connections WHERE user_id = ? AND provider = ?");
      const result = stmt.run(userId, provider);
      return result.changes > 0;
    } catch {
      return false;
    }
  }

  /**
   * Create a new user account for OAuth sign-up.
   * Generates a unique username from the user's name or email.
   */
  function createOAuthUser({ email, name, avatarUrl }) {
    // Generate a username from name or email prefix
    const baseName = (name || email.split("@")[0] || "user").toLowerCase().replace(/[^a-z0-9_-]/g, "");
    let username = baseName;
    let attempt = 0;

    // Ensure username is unique
    while (AuthDB.getUserByUsername(username)) {
      attempt++;
      username = `${baseName}${attempt}`;
    }

    const userId = crypto.randomUUID();
    const userCount = AuthDB.getUserCount();
    const user = {
      id: userId,
      username,
      email,
      passwordHash: "OAUTH_NO_PASSWORD", // Sentinel value — OAuth-only account, no password login
      role: userCount === 0 ? "owner" : "member",
      scopes: userCount === 0 ? ["*"] : ["read", "write"],
      createdAt: new Date().toISOString(),
      lastLoginAt: new Date().toISOString(),
    };

    AuthDB.createUser(user);
    return user;
  }

  /**
   * Complete the OAuth login: set JWT cookies and redirect to frontend.
   */
  function completeOAuthLogin(req, res, user, provider, isNewAccount) {
    // Update last login
    AuthDB.updateUserLogin(user.id);

    // Create JWT tokens
    const token = createToken(user.id);
    const refreshToken = createRefreshToken(user.id);

    // Set httpOnly cookies
    if (token) setAuthCookie(res, token);
    if (refreshToken) setRefreshCookie(res, refreshToken);

    // Track refresh token family
    if (refreshToken && jwt) {
      try {
        const decoded = jwt.decode(refreshToken);
        if (decoded?.family) {
          _REFRESH_FAMILIES.set(decoded.family, {
            userId: user.id,
            currentJti: decoded.jti,
            rotatedAt: Date.now(),
          });
        }
      } catch (_e) { logger.debug('oauth', 'silent catch', { error: _e?.message }); }
    }

    // Audit log
    auditLog("auth", isNewAccount ? "oauth_register" : "oauth_login", {
      userId: user.id,
      username: user.username,
      provider,
      ip: req.ip,
      userAgent: req.headers["user-agent"],
    });

    structuredLog("info", isNewAccount ? "oauth_register" : "oauth_login", {
      userId: user.id,
      provider,
    });

    // ── Age gate (18+) ──────────────────────────────────────────────
    // OAuth providers don't return a date of birth, so a sign-up lands with
    // date_of_birth = NULL. Concordia carries mature/violent content, so the
    // account isn't usable until the user confirms an adult DOB. Route any
    // DOB-less user (a fresh OAuth account, or one created before this gate
    // existed) to the one-time confirm-age step instead of the dashboard.
    let _needsDob = false;
    try { _needsDob = !AuthDB.getUserDateOfBirth(user.id); } catch (_e) { _needsDob = false; }

    const redirectUrl = new URL(FRONTEND_URL);
    if (_needsDob) {
      redirectUrl.pathname = "/onboarding/confirm-age";
      redirectUrl.searchParams.set("provider", provider);
      res.redirect(302, redirectUrl.toString());
      return;
    }

    // Redirect to frontend dashboard
    redirectUrl.pathname = "/";
    redirectUrl.searchParams.set("auth", "success");
    redirectUrl.searchParams.set("provider", provider);
    if (isNewAccount) redirectUrl.searchParams.set("new", "1");

    res.redirect(302, redirectUrl.toString());
  }

  /**
   * Validate the OAuth state parameter against our store.
   * Returns the state entry (including linkUserId if present) or null.
   *
   * SECURITY: delete-before-check is essential. Two concurrent callbacks
   * with the same state token would both see the entry via .get() and
   * both delete it afterwards, giving the attacker a replay window.
   * Map.delete() returns true only for the caller that actually removed
   * the entry, so we use that as an atomic "claim" — losing callers
   * get null.
   */
  function validateState(state) {
    if (!state) return null;
    const entry = OAUTH_STATES.get(state);
    if (!entry) return null;
    // Atomic one-time use: whoever successfully deletes owns the token.
    if (!OAUTH_STATES.delete(state)) return null;
    if (Date.now() - entry.createdAt > STATE_TTL_MS) return null;
    return entry;
  }

  // ── Routes ──────────────────────────────────────────────────────────────

  // GET /api/auth/providers — List available OAuth providers
  app.get("/api/auth/providers", (req, res) => {
    const providers = getAvailableProviders();
    res.json({
      ok: true,
      providers: Object.entries(providers)
        .filter(([, enabled]) => enabled)
        .map(([name]) => name),
    });
  });

  // GET /api/auth/google — Redirect to Google OAuth consent screen
  app.get("/api/auth/google", (req, res) => {
    const providers = getAvailableProviders();
    if (!providers.google) {
      return res.status(501).json({ ok: false, error: "Google OAuth not configured" });
    }

    const state = generateOAuthState();
    OAUTH_STATES.set(state, { createdAt: Date.now() });

    const authUrl = getGoogleAuthUrl(state);
    res.redirect(302, authUrl);
  });

  // GET /api/auth/google/callback — Handle Google OAuth callback
  app.get("/api/auth/google/callback", asyncHandler(async (req, res) => {
    const { code, state, error } = req.query;

    // Handle user denial or errors from Google
    if (error) {
      structuredLog("warn", "google_oauth_error", { error });
      return res.redirect(302, `${FRONTEND_URL}/auth?error=${encodeURIComponent(error)}`);
    }

    // Validate state parameter (CSRF protection)
    const stateEntry = validateState(state);
    if (!stateEntry) {
      structuredLog("warn", "google_oauth_invalid_state", { ip: req.ip });
      return res.redirect(302, `${FRONTEND_URL}/auth?error=invalid_state`);
    }

    if (!code) {
      return res.redirect(302, `${FRONTEND_URL}/auth?error=no_code`);
    }

    try {
      // Exchange code for user info
      const googleUser = await exchangeGoogleCode(code);

      if (!googleUser.email) {
        return res.redirect(302, `${FRONTEND_URL}/auth?error=no_email`);
      }

      // Check for existing OAuth connection
      const existingConnection = getOAuthConnection("google", googleUser.sub);

      // ── Account linking flow ─────────────────────────────────────────
      if (stateEntry.linkUserId) {
        if (existingConnection) {
          // This Google account is already linked to another user
          return res.redirect(302, `${FRONTEND_URL}/auth?error=provider_already_linked`);
        }
        const linkUser = AuthDB.getUser(stateEntry.linkUserId);
        if (!linkUser) {
          return res.redirect(302, `${FRONTEND_URL}/auth?error=user_not_found`);
        }
        createOAuthConnection({
          userId: linkUser.id,
          provider: "google",
          providerUserId: googleUser.sub,
          email: googleUser.email,
          name: googleUser.name,
          avatarUrl: googleUser.picture,
        });
        auditLog("auth", "oauth_link", { userId: linkUser.id, provider: "google", ip: req.ip });
        const linkRedirect = new URL(FRONTEND_URL);
        linkRedirect.pathname = "/";
        linkRedirect.searchParams.set("linked", "google");
        return res.redirect(302, linkRedirect.toString());
      }

      // ── Standard login/register flow ─────────────────────────────────
      if (existingConnection) {
        // Existing OAuth link — log in the connected user
        const user = AuthDB.getUser(existingConnection.user_id);
        if (!user) {
          return res.redirect(302, `${FRONTEND_URL}/auth?error=user_not_found`);
        }
        return completeOAuthLogin(req, res, user, "google", false);
      }

      // No existing OAuth connection — check if user exists by email
      let user = AuthDB.getUserByEmail(googleUser.email);
      let isNewAccount = false;

      if (!user) {
        // Create a new account
        user = createOAuthUser({
          email: googleUser.email,
          name: googleUser.name,
          avatarUrl: googleUser.picture,
        });
        isNewAccount = true;
      }

      // Create OAuth connection
      createOAuthConnection({
        userId: user.id,
        provider: "google",
        providerUserId: googleUser.sub,
        email: googleUser.email,
        name: googleUser.name,
        avatarUrl: googleUser.picture,
      });

      return completeOAuthLogin(req, res, user, "google", isNewAccount);
    } catch (err) {
      structuredLog("error", "google_oauth_callback_failed", { error: err.message, stack: err.stack });
      return res.redirect(302, `${FRONTEND_URL}/auth?error=oauth_failed`);
    }
  }));

  // GET /api/auth/apple — Redirect to Apple Sign In
  app.get("/api/auth/apple", (req, res) => {
    const providers = getAvailableProviders();
    if (!providers.apple) {
      return res.status(501).json({ ok: false, error: "Apple Sign In not configured" });
    }

    const state = generateOAuthState();
    OAUTH_STATES.set(state, { createdAt: Date.now() });

    const authUrl = getAppleAuthUrl(state);
    res.redirect(302, authUrl);
  });

  // POST /api/auth/apple/callback — Handle Apple Sign In callback
  // Apple sends a form POST (response_mode=form_post)
  app.post("/api/auth/apple/callback", asyncHandler(async (req, res) => {
    const { code, state, error: appleError } = req.body || {};

    if (appleError) {
      structuredLog("warn", "apple_oauth_error", { error: appleError });
      return res.redirect(302, `${FRONTEND_URL}/auth?error=${encodeURIComponent(appleError)}`);
    }

    // Validate state parameter
    const stateEntry = validateState(state);
    if (!stateEntry) {
      structuredLog("warn", "apple_oauth_invalid_state", { ip: req.ip });
      return res.redirect(302, `${FRONTEND_URL}/auth?error=invalid_state`);
    }

    if (!code) {
      return res.redirect(302, `${FRONTEND_URL}/auth?error=no_code`);
    }

    try {
      const appleUser = await exchangeAppleCode(code);

      // Apple sends user info (name) only on first authorization, as form data
      let userName = appleUser.name;
      if (req.body?.user) {
        try {
          const userFormData = typeof req.body.user === "string" ? JSON.parse(req.body.user) : req.body.user;
          if (userFormData.name) {
            const { firstName, lastName } = userFormData.name;
            userName = [firstName, lastName].filter(Boolean).join(" ");
          }
        } catch (_e) { logger.debug('oauth', 'silent catch', { error: _e?.message }); }
      }

      if (!appleUser.email && !appleUser.sub) {
        return res.redirect(302, `${FRONTEND_URL}/auth?error=no_identity`);
      }

      // Check for existing OAuth connection
      const existingConnection = getOAuthConnection("apple", appleUser.sub);

      // ── Account linking flow ─────────────────────────────────────────
      if (stateEntry.linkUserId) {
        if (existingConnection) {
          return res.redirect(302, `${FRONTEND_URL}/auth?error=provider_already_linked`);
        }
        const linkUser = AuthDB.getUser(stateEntry.linkUserId);
        if (!linkUser) {
          return res.redirect(302, `${FRONTEND_URL}/auth?error=user_not_found`);
        }
        createOAuthConnection({
          userId: linkUser.id,
          provider: "apple",
          providerUserId: appleUser.sub,
          email: appleUser.email,
          name: userName,
          avatarUrl: null,
        });
        auditLog("auth", "oauth_link", { userId: linkUser.id, provider: "apple", ip: req.ip });
        const linkRedirect = new URL(FRONTEND_URL);
        linkRedirect.pathname = "/";
        linkRedirect.searchParams.set("linked", "apple");
        return res.redirect(302, linkRedirect.toString());
      }

      // ── Standard login/register flow ─────────────────────────────────
      if (existingConnection) {
        const user = AuthDB.getUser(existingConnection.user_id);
        if (!user) {
          return res.redirect(302, `${FRONTEND_URL}/auth?error=user_not_found`);
        }
        return completeOAuthLogin(req, res, user, "apple", false);
      }

      // No existing OAuth connection
      let user = appleUser.email ? AuthDB.getUserByEmail(appleUser.email) : null;
      let isNewAccount = false;

      if (!user) {
        if (!appleUser.email) {
          // Apple can hide email — we need at least the sub to create an account
          // Generate a placeholder email using the sub
          appleUser.email = `apple_${appleUser.sub.slice(0, 16)}@privaterelay.appleid.com`;
        }
        user = createOAuthUser({
          email: appleUser.email,
          name: userName,
          avatarUrl: null,
        });
        isNewAccount = true;
      }

      // Create OAuth connection
      createOAuthConnection({
        userId: user.id,
        provider: "apple",
        providerUserId: appleUser.sub,
        email: appleUser.email,
        name: userName,
        avatarUrl: null,
      });

      return completeOAuthLogin(req, res, user, "apple", isNewAccount);
    } catch (err) {
      structuredLog("error", "apple_oauth_callback_failed", { error: err.message, stack: err.stack });
      return res.redirect(302, `${FRONTEND_URL}/auth?error=oauth_failed`);
    }
  }));

  // POST /api/auth/link/:provider — Link an OAuth provider to the current account
  app.post("/api/auth/link/:provider", asyncHandler(async (req, res) => {
    if (!req.user) {
      return res.status(401).json({ ok: false, error: "Authentication required" });
    }

    const { provider } = req.params;
    if (!["google", "apple"].includes(provider)) {
      return res.status(400).json({ ok: false, error: "Invalid provider. Must be 'google' or 'apple'." });
    }

    const providers = getAvailableProviders();
    if (!providers[provider]) {
      return res.status(501).json({ ok: false, error: `${provider} OAuth not configured` });
    }

    // Check if already linked
    const connections = getOAuthConnectionsByUserId(req.user.id);
    if (connections.some(c => c.provider === provider)) {
      return res.status(409).json({ ok: false, error: `${provider} account already linked` });
    }

    // Generate state with user ID embedded for linking flow
    const state = generateOAuthState();
    OAUTH_STATES.set(state, { createdAt: Date.now(), linkUserId: req.user.id });

    const authUrl = provider === "google"
      ? getGoogleAuthUrl(state)
      : getAppleAuthUrl(state);

    res.json({ ok: true, authUrl });
  }));

  // DELETE /api/auth/link/:provider — Unlink an OAuth provider from current account
  app.delete("/api/auth/link/:provider", (req, res) => {
    if (!req.user) {
      return res.status(401).json({ ok: false, error: "Authentication required" });
    }

    const { provider } = req.params;
    if (!["google", "apple"].includes(provider)) {
      return res.status(400).json({ ok: false, error: "Invalid provider" });
    }

    // Prevent unlinking if it would leave the account with no login method
    const user = AuthDB.getUser(req.user.id);
    const connections = getOAuthConnectionsByUserId(req.user.id);
    const hasPassword = user && user.passwordHash && user.passwordHash !== "OAUTH_NO_PASSWORD";
    const otherConnections = connections.filter(c => c.provider !== provider);

    if (!hasPassword && otherConnections.length === 0) {
      return res.status(400).json({
        ok: false,
        error: "Cannot unlink — this is your only sign-in method. Set a password first or link another provider.",
      });
    }

    const deleted = deleteOAuthConnection(req.user.id, provider);
    if (!deleted) {
      return res.status(404).json({ ok: false, error: `No ${provider} connection found` });
    }

    auditLog("auth", "oauth_unlink", {
      userId: req.user.id,
      provider,
      ip: req.ip,
    });

    res.json({ ok: true, message: `${provider} account unlinked` });
  });

  // GET /api/auth/me — Get current user profile with OAuth connections
  // NOTE: This enhances the existing /api/auth/me by adding oauth_connections.
  // The existing auth router also has /me, but this one adds OAuth data.
  // It is registered on a different path to avoid conflict.
  app.get("/api/auth/me/connections", (req, res) => {
    if (!req.user) {
      return res.status(401).json({ ok: false, error: "Not authenticated" });
    }

    const connections = getOAuthConnectionsByUserId(req.user.id);
    res.json({
      ok: true,
      user: {
        id: req.user.id,
        username: req.user.username,
        email: req.user.email,
        role: req.user.role,
        scopes: req.user.scopes,
      },
      oauthConnections: connections.map(c => ({
        provider: c.provider,
        email: c.email,
        name: c.name,
        avatarUrl: c.avatar_url,
        linkedAt: c.created_at,
      })),
    });
  });

  // ── Age gate completion (OAuth sign-ups) ──────────────────────────────
  // OAuth providers never return a date of birth, so an OAuth account lands
  // with date_of_birth = NULL. These two endpoints let the authenticated user
  // confirm an adult DOB (the post-callback "confirm your age" step) and let
  // the frontend guard discover whether that step is still pending.

  // GET /api/auth/age-status — does the signed-in user still owe a DOB?
  app.get("/api/auth/age-status", (req, res) => {
    if (!req.user) return res.status(401).json({ ok: false, error: "Not authenticated" });
    let needsDob = false;
    try { needsDob = !AuthDB.getUserDateOfBirth(req.user.id); } catch (_e) { needsDob = false; }
    res.json({ ok: true, needsDob });
  });

  // POST /api/auth/confirm-age — one-time DOB confirmation for OAuth accounts.
  // 18+ → stores the DOB and the account becomes usable. Under-18 → the
  // just-created account is deactivated and the session cleared (parity with
  // the password-register age gate, which rejects under-18 before creation).
  app.post("/api/auth/confirm-age", (req, res) => {
    if (!req.user) return res.status(401).json({ ok: false, error: "Not authenticated" });

    const dateOfBirth = (req.body && req.body.dateOfBirth) || "";
    const age = ageFromDob(dateOfBirth);
    if (age === null) {
      return res.status(400).json({ ok: false, error: "A valid date of birth is required." });
    }

    // Idempotency / tamper-guard: if a DOB is already on file, don't let it be
    // overwritten through this endpoint — it's a one-time onboarding step.
    let existing = null;
    try { existing = AuthDB.getUserDateOfBirth(req.user.id); } catch (_e) { existing = null; }
    if (existing) {
      return res.json({ ok: true, alreadyConfirmed: true });
    }

    if (age < MIN_AGE) {
      // Bar the account. is_active = 0 makes the existing token useless
      // (getUser filters is_active = 1); cookie clear is best-effort cleanup.
      try { AuthDB.deactivateUser(req.user.id); } catch (_e) { /* best-effort */ }
      try {
        res.clearCookie("concord_auth", { path: "/" });
        res.clearCookie("concord_refresh", { path: "/" });
      } catch (_e) { /* best-effort */ }
      auditLog("auth", "oauth_age_rejected", { userId: req.user.id, ip: req.ip });
      return res.status(403).json({
        ok: false,
        error: `You must be at least ${MIN_AGE} years old to use Concord.`,
        code: "AGE_RESTRICTED",
      });
    }

    try { AuthDB.setUserDateOfBirth(req.user.id, dateOfBirth); } catch (_e) {
      return res.status(500).json({ ok: false, error: "Could not save date of birth." });
    }
    auditLog("auth", "oauth_age_confirmed", { userId: req.user.id, ip: req.ip });
    structuredLog("info", "oauth_age_confirmed", { userId: req.user.id });
    res.json({ ok: true });
  });

  structuredLog("info", "oauth_routes_registered", {
    providers: getAvailableProviders(),
  });
}
