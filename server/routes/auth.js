/**
 * Auth routes — extracted from server.js
 * Mounted at /api/auth
 */
import express from "express";
import crypto from "crypto";
import logger from '../logger.js';
import { isEmailBanned, scanUsername as scanUsernameGuard } from "../lib/content-guard.js";
import { deriveLockerKey, generateLockerSalt } from "../lib/personal-locker/crypto.js";

// ── Auth rate limiters (defense-in-depth) ────────────────────────────────────
// Two independent buckets:
//   • Per-IP (_loginAttempts)     — stops a single attacker from spraying.
//   • Per-account (_accountAttempts) — stops a distributed attacker from
//     brute-forcing one account across many IPs. NAT/carrier-grade NAT
//     share IPs among legitimate users, so the per-IP bucket alone is
//     easy to evade with a botnet. Per-account lockout closes that gap.
const _loginAttempts = new Map();     // ip -> { count, resetAt }
const _accountAttempts = new Map();   // username|email -> { count, resetAt }
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_PER_IP = 20;       // was 10 — NAT/CGNAT carriers share IPs
const LOGIN_MAX_PER_ACCOUNT = 10;  // was 6 — legitimate users typo passwords

function checkLoginRateLimit(ip) {
  const now = Date.now();
  const entry = _loginAttempts.get(ip);
  if (!entry || now > entry.resetAt) {
    _loginAttempts.set(ip, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
    return true;
  }
  entry.count++;
  if (entry.count > LOGIN_MAX_PER_IP) return false;
  return true;
}

function checkAccountRateLimit(identifier) {
  if (!identifier) return true;
  const key = String(identifier).toLowerCase();
  const now = Date.now();
  const entry = _accountAttempts.get(key);
  if (!entry || now > entry.resetAt) {
    _accountAttempts.set(key, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
    return true;
  }
  entry.count++;
  if (entry.count > LOGIN_MAX_PER_ACCOUNT) return false;
  return true;
}

function clearAccountRateLimit(identifier) {
  if (!identifier) return;
  _accountAttempts.delete(String(identifier).toLowerCase());
}

// Cleanup stale entries every 30 minutes to prevent memory leak
// @resource-leak-ok: process-lifetime — auth-attempt rate-limit cleanup
const _loginRateLimitCleanup = setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of _loginAttempts) {
    if (now > entry.resetAt) _loginAttempts.delete(ip);
  }
  for (const [k, entry] of _accountAttempts) {
    if (now > entry.resetAt) _accountAttempts.delete(k);
  }
}, 30 * 60 * 1000);
_loginRateLimitCleanup.unref();

export default function createAuthRouter({
  AuthDB,
  AuditDB,
  db,
  jwt,
  authRateLimiter,
  _TOKEN_BLACKLIST,
  _REFRESH_FAMILIES,
  REFRESH_TOKEN_COOKIE,
  NODE_ENV,
  validate,
  hashPassword,
  verifyPassword,
  createToken,
  createRefreshToken,
  verifyToken,
  setAuthCookie,
  setRefreshCookie,
  clearAuthCookie,
  auditLog,
  generateApiKey,
  hashApiKey,
  requireRole,
  generateCsrfToken,
  uid,
  structuredLog,
  saveAuthData,
  invalidateViewerLocation,
  setLockerKey,
  clearLockerKey,
}) {
  const router = express.Router();

  // Apply stricter rate limiting to auth endpoints
  const authRateLimitMiddleware = authRateLimiter || ((req, res, next) => next());

  // ── Bot Prevention: per-IP daily registration cap ──────────────────
  const _regIpDaily = new Map(); // ip → { count, day }
  const MAX_REGISTRATIONS_PER_IP_PER_DAY = 3;
  // CI / e2e jobs register many fresh test users from one runner IP and
  // would exhaust the daily cap mid-suite (the Phase Z playthrough's
  // beforeAll registers a user per run). CONCORD_RATE_LIMIT_BYPASS=1 is
  // the same flag ci.yml already sets to relax the unauth throttle
  // (server.js:6590) — the registration cap is a rate limit, so it
  // honors the same flag. Unit tests don't set it; production never does.
  const _REG_CAP_BYPASS = process.env.CONCORD_RATE_LIMIT_BYPASS === "1";

  // Cleanup stale entries from _regIpDaily every hour to prevent memory leak
  // @resource-leak-ok: process-lifetime — auth-attempt rate-limit cleanup
  const _regIpCleanupInterval = setInterval(() => {
    const today = new Date().toISOString().slice(0, 10);
    for (const [ip, entry] of _regIpDaily) {
      if (entry.day !== today) _regIpDaily.delete(ip);
    }
  }, 60 * 60 * 1000);
  _regIpCleanupInterval.unref();

  // AUTH: prod-write-mw — productionWriteAuthMiddleware (server.js:5808) enforces req.user for all writes in production
  router.post("/register", authRateLimitMiddleware, validate("userRegister"), (req, res) => {
    const { username, email, password, dateOfBirth } = req.validated || req.body;

    // ── Age gate (18+) ──────────────────────────────────────────────
    // Concordia contains mature/violent content, so registration requires the
    // user to attest to a date of birth and be at least 18. We compute the age
    // precisely (accounting for whether this year's birthday has passed) and
    // reject under-18 (and absurd/future dates). The DOB is stored as the
    // legal-defensibility record that the user attested to being an adult.
    const MIN_AGE = 18;
    const dob = new Date(`${dateOfBirth}T00:00:00Z`);
    if (Number.isNaN(dob.getTime())) {
      return res.status(400).json({ ok: false, error: "A valid date of birth is required." });
    }
    const _now = new Date();
    let _age = _now.getUTCFullYear() - dob.getUTCFullYear();
    const _mDiff = _now.getUTCMonth() - dob.getUTCMonth();
    if (_mDiff < 0 || (_mDiff === 0 && _now.getUTCDate() < dob.getUTCDate())) _age--;
    if (dob.getTime() > _now.getTime() || _age > 120) {
      return res.status(400).json({ ok: false, error: "A valid date of birth is required." });
    }
    if (_age < MIN_AGE) {
      return res.status(403).json({ ok: false, error: `You must be at least ${MIN_AGE} years old to create an account.`, code: "AGE_RESTRICTED" });
    }

    // ── Bot prevention: honeypot field ──────────────────────────────
    // Frontend must NOT fill this field; bots auto-fill hidden inputs.
    if (req.body.website || req.body.url || req.body.phone_number) {
      // Silently reject — looks like success to the bot
      return res.status(201).json({ ok: true, user: { id: "ok", username } });
    }

    // ── Bot prevention: timing check ────────────────────────────────
    // Legitimate users take ≥2 seconds to fill a 4-field form.
    const formLoadedAt = Number(req.body._t) || 0;
    if (formLoadedAt > 0 && (Date.now() - formLoadedAt) < 2000) {
      return res.status(201).json({ ok: true, user: { id: "ok", username } });
    }

    // ── Bot prevention: per-IP daily cap ────────────────────────────
    const today = new Date().toISOString().slice(0, 10);
    const ipKey = req.ip || "unknown";
    const ipEntry = _regIpDaily.get(ipKey);
    if (!_REG_CAP_BYPASS && ipEntry && ipEntry.day === today && ipEntry.count >= MAX_REGISTRATIONS_PER_IP_PER_DAY) {
      return res.status(429).json({ ok: false, error: "Too many registrations from this network today. Try again tomorrow." });
    }

    // Check if registration is allowed
    if (String(process.env.ALLOW_REGISTRATION || "true").toLowerCase() !== "true") {
      return res.status(403).json({ ok: false, error: "Registration disabled" });
    }

    // Check for banned email (re-registration prevention) and prohibited usernames
    try {
      if (isEmailBanned(db, email)) {
        return res.status(403).json({ ok: false, error: "Registration not permitted" });
      }
      const usernameScan = scanUsernameGuard(username);
      if (usernameScan.blocked) {
        return res.status(400).json({ ok: false, error: "Username not permitted" });
      }
    } catch (_) { /* content-guard may not be available yet */ }

    // ── Bot prevention: disposable email domain blocking ────────────
    const emailDomain = email.split("@")[1]?.toLowerCase();
    const DISPOSABLE_DOMAINS = new Set([
      "mailinator.com", "guerrillamail.com", "tempmail.com", "throwaway.email",
      "yopmail.com", "sharklasers.com", "guerrillamailblock.com", "grr.la",
      "dispostable.com", "maildrop.cc", "temp-mail.org", "fakeinbox.com",
      "trashmail.com", "getnada.com", "10minutemail.com", "minutemail.com",
    ]);
    if (DISPOSABLE_DOMAINS.has(emailDomain)) {
      return res.status(400).json({ ok: false, error: "Please use a permanent email address" });
    }

    // Check for existing user
    if (AuthDB.getUserByUsername(username)) {
      return res.status(409).json({ ok: false, error: "Username taken" });
    }
    if (AuthDB.getUserByEmail(email)) {
      return res.status(409).json({ ok: false, error: "Email taken" });
    }

    const userId = crypto.randomUUID();
    const userCount = AuthDB.getUserCount();
    const user = {
      id: userId,
      username,
      email,
      passwordHash: hashPassword(password),
      role: userCount === 0 ? "owner" : "member",
      scopes: userCount === 0 ? ["*"] : ["read", "write"],
      emailVerified: false,
      dateOfBirth: dateOfBirth || null,
      createdAt: new Date().toISOString(),
      lastLoginAt: null
    };

    // Guard: if bcrypt is unavailable, passwordHash will be null — reject registration
    if (!user.passwordHash) {
      return res.status(503).json({ ok: false, error: "Password hashing unavailable. Install bcryptjs to enable registration." });
    }

    AuthDB.createUser(user);

    // Grant starter inventory so the new user can immediately gather, craft,
    // and trade without spending the first 30 minutes empty-handed.
    try {
      import("../lib/starter-content.js").then((sc) => {
        sc.grantStarterInventoryToUser?.(db, userId);
      }).catch(() => { /* starter grant best-effort */ });
    } catch { /* import silent */ }

    // Track per-IP daily registrations
    if (ipEntry && ipEntry.day === today) {
      ipEntry.count++;
    } else {
      _regIpDaily.set(ipKey, { count: 1, day: today });
    }

    const token = createToken(userId);
    const refreshToken = createRefreshToken(userId);

    // SECURITY: Set httpOnly cookies for browser auth
    if (token) setAuthCookie(res, token);
    if (refreshToken) setRefreshCookie(res, refreshToken);

    // Track refresh token family
    try {
      const decoded = jwt.decode(refreshToken);
      if (decoded?.family) _REFRESH_FAMILIES.set(decoded.family, { userId, currentJti: decoded.jti, rotatedAt: Date.now() });
    } catch (_e) { logger.debug('auth', 'silent catch', { error: _e?.message }); }

    // Audit log registration
    auditLog("auth", "register", {
      userId,
      username,
      ip: req.ip,
      userAgent: req.headers["user-agent"]
    });

    res.status(201).json({
      ok: true,
      user: { id: userId, username, email, role: user.role },
      token // Also return token for non-browser clients
    });
  });

  // AUTH: prod-write-mw — productionWriteAuthMiddleware (server.js:5808) enforces req.user for all writes in production
  router.post("/login", authRateLimitMiddleware, validate("userLogin"), (req, res) => {
    // Defense-in-depth: per-IP AND per-account rate limiting so NAT
    // doesn't defeat the IP bucket and a botnet can't target one account.
    const ip = req.ip || req.connection.remoteAddress;
    if (!checkLoginRateLimit(ip)) {
      return res.status(429).json({ ok: false, error: "Too many login attempts. Try again in 15 minutes." });
    }

    const { username, email, password } = req.validated || req.body;
    const accountKey = username || email;
    if (!checkAccountRateLimit(accountKey)) {
      return res.status(429).json({ ok: false, error: "Too many failed login attempts for this account. Try again in 15 minutes." });
    }

    // Find user by username or email
    let user = null;
    if (username) {
      user = AuthDB.getUserByUsername(username);
    } else if (email) {
      user = AuthDB.getUserByEmail(email);
    }

    if (!user || !verifyPassword(password, user.passwordHash)) {
      // Audit failed login attempt
      auditLog("auth", "login_failed", {
        attemptedUser: username || email,
        ip: req.ip,
        userAgent: req.headers["user-agent"],
        requestId: req.id
      });
      return res.status(401).json({ ok: false, error: "Invalid credentials" });
    }

    // Successful login — clear the per-account failure bucket. We do NOT
    // revoke other active sessions: users legitimately want to be logged
    // in on multiple devices at once. A proper "log out everywhere"
    // button belongs in settings and should call revokeAllForUser
    // explicitly. Session fixation for THIS login path is already
    // mitigated by the fact that the new cookie replaces whatever
    // cookie was on the browser — and the new JTI is unrelated to any
    // prior one, so an attacker holding a pre-login cookie can't
    // elevate it via this response.
    clearAccountRateLimit(accountKey);

    AuthDB.updateUserLogin(user.id);

    const token = createToken(user.id);
    const refreshToken = createRefreshToken(user.id);

    // SECURITY: Set httpOnly cookies for browser auth
    if (token) setAuthCookie(res, token);
    if (refreshToken) setRefreshCookie(res, refreshToken);

    // Track refresh token family
    try {
      if (refreshToken) {
        const decoded = jwt.decode(refreshToken);
        if (decoded?.family) _REFRESH_FAMILIES.set(decoded.family, { userId: user.id, currentJti: decoded.jti, rotatedAt: Date.now() });
      }
    } catch (_e) { logger.debug('auth', 'silent catch', { error: _e?.message }); }

    // Audit successful login
    auditLog("auth", "login_success", {
      userId: user.id,
      username: user.username,
      ip: req.ip,
      userAgent: req.headers["user-agent"]
    });

    // Derive personal locker key from plaintext password (available only at login).
    // Run async in background — does not block the login response.
    if (setLockerKey && db) {
      (async () => {
        try {
          let lockerSalt = user.locker_salt;
          if (!lockerSalt) {
            lockerSalt = generateLockerSalt();
            db.prepare("UPDATE users SET locker_salt = ? WHERE id = ?").run(lockerSalt, user.id);
          }
          const key = await deriveLockerKey(password, user.id, lockerSalt);
          setLockerKey(user.id, key);
        } catch (_e) { /* non-fatal — locker simply stays locked */ }
      })();
    }

    res.json({
      ok: true,
      user: { id: user.id, username: user.username, email: user.email, role: user.role },
      token: token || undefined // Only return token if JWT is available
    });
  });

  router.get("/me", (req, res) => {
    if (!req.user) return res.status(401).json({ ok: false, error: "Not authenticated" });
    // Pull the declared region/nation directly so the frontend knows
    // whether to show "Choose Your Universe" onboarding.
    let declaredRegional = null;
    let declaredNational = null;
    let primaryLens = null;
    try {
      if (db) {
        const row = db.prepare(
          "SELECT declared_regional, declared_national, primary_lens FROM users WHERE id = ?"
        ).get(req.user.id);
        if (row) {
          declaredRegional = row.declared_regional || null;
          declaredNational = row.declared_national || null;
          primaryLens = row.primary_lens || null;
        }
      }
    } catch (_e) { /* columns may not exist on older schemas — fall through */ }

    res.json({
      ok: true,
      user: {
        id: req.user.id,
        username: req.user.username,
        email: req.user.email,
        role: req.user.role,
        scopes: req.user.scopes,
        declaredRegional,
        declaredNational,
        primaryLens,
        // Convenience: frontend gate for the onboarding screen.
        needsOnboarding: !declaredRegional && !declaredNational && !primaryLens,
      }
    });
  });

  // POST /choose-universe — set region / nation / primary lens in one
  // call. The "Choose Your Universe" post-signup screen hits this. All
  // three fields are optional individually, but the caller must pass
  // at least one. Adds the primary_lens column lazily if the schema
  // doesn't have it yet.
  router.post("/choose-universe", (req, res) => {
    if (!req.user) return res.status(401).json({ ok: false, error: "Not authenticated" });
    const { regional, national, primaryLens } = req.body || {};

    if (!regional && !national && !primaryLens) {
      return res.status(400).json({
        ok: false,
        error: "must_provide_at_least_one",
        fields: ["regional", "national", "primaryLens"],
      });
    }

    try {
      // Ensure primary_lens column exists (idempotent).
      try {
        const cols = db.prepare("PRAGMA table_info(users)").all();
        if (!cols.some((c) => c.name === "primary_lens")) {
          db.exec("ALTER TABLE users ADD COLUMN primary_lens TEXT");
        }
      } catch (_e) { /* best-effort */ }

      const now = new Date().toISOString();

      // Fetch existing so we don't null out fields the caller omitted.
      const existing = db.prepare(
        "SELECT declared_regional, declared_national, primary_lens FROM users WHERE id = ?"
      ).get(req.user.id);
      if (!existing) return res.status(404).json({ ok: false, error: "user_not_found" });

      const nextRegional = regional !== undefined ? (regional || null) : existing.declared_regional;
      const nextNational = national !== undefined ? (national || null) : existing.declared_national;
      const nextPrimaryLens = primaryLens !== undefined ? (primaryLens || null) : existing.primary_lens;

      // Record location history if we changed region/nation.
      if (nextRegional !== existing.declared_regional || nextNational !== existing.declared_national) {
        try {
          db.prepare(`
            INSERT INTO user_location_history (id, user_id, regional, national, previous_regional, previous_national, changed_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `).run(
            `ulh_${Date.now().toString(36)}_${crypto.randomBytes(4).toString("hex")}`,
            req.user.id,
            nextRegional,
            nextNational,
            existing.declared_regional,
            existing.declared_national,
            now,
          );
        } catch (_e) { /* history table may not exist yet — non-fatal */ }
      }

      db.prepare(`
        UPDATE users
        SET declared_regional = ?,
            declared_national = ?,
            primary_lens = ?,
            location_declared_at = COALESCE(location_declared_at, ?)
        WHERE id = ?
      `).run(nextRegional, nextNational, nextPrimaryLens, now, req.user.id);

      auditLog("auth", "choose_universe", {
        userId: req.user.id,
        regional: nextRegional,
        national: nextNational,
        primaryLens: nextPrimaryLens,
        ip: req.ip,
      });

      // Drop the cached viewer-location so userVisibleDTUs sees the
      // new region / nation on the very next feed query instead of
      // waiting out the TTL.
      try { invalidateViewerLocation?.(req.user.id); } catch (_e) { /* best-effort */ }

      return res.json({
        ok: true,
        universe: {
          regional: nextRegional,
          national: nextNational,
          primaryLens: nextPrimaryLens,
        },
      });
    } catch (e) {
      console.error("[auth] choose-universe failed:", e?.message);
      return res.status(500).json({ ok: false, error: "Internal error" });
    }
  });

  // Logout - clears auth cookie + blacklists token (Tier 1: Auth Hardening)
  router.post("/logout", authRateLimitMiddleware, (req, res) => {
    // Blacklist current access token so it can't be replayed
    const cookieToken = req.cookies?.concord_auth;
    if (cookieToken && jwt) {
      try {
        const decoded = jwt.decode(cookieToken);
        if (decoded?.jti) {
          const expiresAt = decoded.exp ? decoded.exp * 1000 : Date.now() + 7 * 86400000;
          _TOKEN_BLACKLIST.revoke(decoded.jti, expiresAt, decoded.userId || decoded.sub || (req.user && req.user.id));
        }
      } catch (_e) { logger.debug('auth', 'silent catch', { error: _e?.message }); }
    }

    // Also revoke refresh token
    const refreshCookie = req.cookies?.[REFRESH_TOKEN_COOKIE];
    if (refreshCookie && jwt) {
      try {
        const decoded = jwt.decode(refreshCookie);
        if (decoded?.jti) _TOKEN_BLACKLIST.revoke(decoded.jti, Date.now() + 30 * 86400000, decoded.userId || decoded.sub || (req.user && req.user.id));
        if (decoded?.family) _REFRESH_FAMILIES.delete(decoded.family);
      } catch (_e) { logger.debug('auth', 'silent catch', { error: _e?.message }); }
    }

    // Audit logout
    if (req.user) {
      auditLog("auth", "logout", {
        userId: req.user.id,
        username: req.user.username,
        ip: req.ip,
        userAgent: req.headers["user-agent"]
      });
    }

    // Clear personal locker key from memory
    if (clearLockerKey && req.user?.id) clearLockerKey(req.user.id);

    // Clear auth cookies
    clearAuthCookie(res);

    res.json({ ok: true, message: "Logged out successfully" });
  });

  // ---- Refresh Token Endpoint (Tier 1: Auth Hardening) ----
  // AUTH: prod-write-mw — productionWriteAuthMiddleware (server.js:5808) enforces req.user for all writes in production
  router.post("/refresh", authRateLimitMiddleware, (req, res) => {
    const refreshCookie = req.cookies?.[REFRESH_TOKEN_COOKIE];
    if (!refreshCookie) {
      return res.status(401).json({ ok: false, error: "No refresh token provided", code: "REFRESH_MISSING" });
    }

    const decoded = verifyToken(refreshCookie);
    if (!decoded || decoded.type !== "refresh") {
      clearAuthCookie(res);
      return res.status(401).json({ ok: false, error: "Invalid or expired refresh token", code: "REFRESH_INVALID" });
    }

    // Check token family for theft detection (refresh token rotation)
    const family = _REFRESH_FAMILIES.get(decoded.family);
    if (family && family.currentJti !== decoded.jti) {
      // This refresh token was already used! Possible token theft.
      // Revoke the entire family and force re-login.
      _TOKEN_BLACKLIST.revokeAllForUser(decoded.userId);
      _REFRESH_FAMILIES.delete(decoded.family);
      clearAuthCookie(res);
      auditLog("security", "refresh_token_reuse", {
        userId: decoded.userId,
        family: decoded.family,
        ip: req.ip,
        userAgent: req.headers["user-agent"]
      });
      return res.status(401).json({ ok: false, error: "Token reuse detected. All sessions revoked for security.", code: "TOKEN_THEFT_DETECTED" });
    }

    // Revoke old refresh token
    _TOKEN_BLACKLIST.revoke(decoded.jti, decoded.exp ? decoded.exp * 1000 : Date.now() + 30 * 86400000, decoded.userId);

    // Issue new token pair (rotation)
    const user = AuthDB.getUser(decoded.userId);
    if (!user) {
      clearAuthCookie(res);
      return res.status(401).json({ ok: false, error: "User not found" });
    }

    const newAccessToken = createToken(user.id);
    const newRefreshToken = createRefreshToken(user.id);

    setAuthCookie(res, newAccessToken);
    if (newRefreshToken) setRefreshCookie(res, newRefreshToken);

    // Update family tracking
    try {
      const newDecoded = jwt.decode(newRefreshToken);
      if (newDecoded?.family) {
        _REFRESH_FAMILIES.set(newDecoded.family, { userId: user.id, currentJti: newDecoded.jti, rotatedAt: Date.now() });
      }
    } catch (_e) { logger.debug('auth', 'silent catch', { error: _e?.message }); }

    auditLog("auth", "token_refresh", { userId: user.id, ip: req.ip });

    res.json({
      ok: true,
      user: { id: user.id, username: user.username, email: user.email, role: user.role },
      token: newAccessToken
    });
  });

  // ---- Revoke All Sessions (Tier 1: Auth Hardening) ----
  router.post("/revoke-all-sessions", authRateLimitMiddleware, (req, res) => {
    if (!req.user) return res.status(401).json({ ok: false, error: "Not authenticated" });

    _TOKEN_BLACKLIST.revokeAllForUser(req.user.id);

    // Clear own family entries
    for (const [family, entry] of _REFRESH_FAMILIES) {
      if (entry.userId === req.user.id) _REFRESH_FAMILIES.delete(family);
    }

    auditLog("auth", "revoke_all_sessions", {
      userId: req.user.id,
      ip: req.ip,
      userAgent: req.headers["user-agent"]
    });

    clearAuthCookie(res);
    res.json({ ok: true, message: "All sessions revoked. Please log in again." });
  });

  // CSRF Token endpoint - provides token for state-changing requests
  router.get("/csrf-token", (req, res) => {
    const csrfToken = generateCsrfToken(req.user?.id || req.ip);

    // Set CSRF cookie (readable by JS for double-submit pattern)
    // Must use same sameSite policy as auth cookies so the CSRF cookie is
    // present whenever auth cookies are. "lax" ensures it's sent on same-site
    // navigations + fetch requests.
    const cookieDomain = process.env.COOKIE_DOMAIN || undefined;
    res.cookie("csrf_token", csrfToken, {
      httpOnly: false, // JS needs to read this
      secure: NODE_ENV === "production",
      sameSite: process.env.COOKIE_SAME_SITE || "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: "/",
      ...(cookieDomain && { domain: cookieDomain }),
    });

    res.json({ ok: true, csrfToken });
  });

  // Audit log endpoint (admin only) - uses SQLite for persistent logs
  router.get("/audit-log", requireRole("owner", "admin"), (req, res) => {
    const { limit = 100, offset = 0, category, action, userId, startDate, endDate } = req.query;

    // Use AuditDB for SQLite-backed queries (falls back to memory)
    const logs = AuditDB.query({
      limit: Number(limit),
      offset: Number(offset),
      category,
      action,
      userId,
      startDate,
      endDate
    });

    const total = AuditDB.count({ category, userId });

    res.json({
      ok: true,
      total,
      offset: Number(offset),
      limit: Number(limit),
      persistent: db !== null, // Indicates if using SQLite
      logs
    });
  });

  router.post("/api-keys", requireRole("owner", "admin"), validate("apiKeyCreate"), (req, res) => {
    const { name, scopes } = req.validated || req.body;
    const apiKey = generateApiKey();
    const hashedKey = hashApiKey(apiKey);

    // SECURITY: Store only the hash, not the raw key
    AuthDB.createApiKey({
      id: uid("apikey"),
      userId: req.user.id,
      name,
      keyHash: hashedKey,
      keyPrefix: apiKey.slice(0, 8),
      scopes,
      createdAt: new Date().toISOString(),
      lastUsedAt: null
    });

    // Audit log API key creation
    auditLog("api_key", "created", {
      userId: req.user.id,
      keyName: name,
      ip: req.ip,
      requestId: req.id
    });

    // Return the raw key ONCE - user must save it, we can't recover it
    res.status(201).json({
      ok: true,
      apiKey, // Raw key - only returned once
      name,
      scopes,
      warning: "Save this API key now. It cannot be retrieved again."
    });
  });

  router.get("/api-keys", (req, res) => {
    if (!req.user) return res.status(401).json({ ok: false, error: "Not authenticated" });

    // Get keys for user (or all keys for owner)
    const userKeys = req.user.role === "owner"
      ? AuthDB.getAllApiKeys()
      : AuthDB.getApiKeysByUser(req.user.id);

    const keys = userKeys.map(data => ({
      id: data.id,
      keyPrefix: data.keyPrefix + "...",
      name: data.name,
      scopes: data.scopes,
      createdAt: data.createdAt,
      lastUsedAt: data.lastUsedAt
    }));

    res.json({ ok: true, apiKeys: keys });
  });

  router.delete("/api-keys/:keyId", (req, res) => {
    if (!req.user) return res.status(401).json({ ok: false, error: "Not authenticated" });

    const keyId = req.params.keyId;
    const deleted = AuthDB.deleteApiKey(keyId, req.user.id);

    if (deleted) {
      auditLog("api_key", "deleted", {
        userId: req.user.id,
        keyId,
        ip: req.ip,
        requestId: req.id
      });
      return res.json({ ok: true });
    }

    res.status(404).json({ ok: false, error: "API key not found" });
  });

  // API Key Rotation - creates new key and invalidates old one atomically
  router.post("/api-keys/:keyId/rotate", authRateLimitMiddleware, requireRole("owner", "admin"), (req, res) => {
    const keyId = req.params.keyId;

    // Find the existing key
    const allKeys = AuthDB.getAllApiKeys();
    const existingKey = allKeys.find(k => k.id === keyId && k.userId === req.user.id);

    if (!existingKey) {
      return res.status(404).json({ ok: false, error: "API key not found" });
    }

    // Generate new key
    const newApiKey = generateApiKey();
    const newHashedKey = hashApiKey(newApiKey);

    // Create new key with same name and scopes
    AuthDB.createApiKey({
      id: uid("apikey"),
      userId: req.user.id,
      name: existingKey.name + " (rotated)",
      keyHash: newHashedKey,
      keyPrefix: newApiKey.slice(0, 8),
      scopes: existingKey.scopes,
      createdAt: new Date().toISOString(),
      lastUsedAt: null
    });

    // Delete old key
    AuthDB.deleteApiKey(keyId, req.user.id);

    // Audit log rotation
    auditLog("api_key", "rotated", {
      userId: req.user.id,
      oldKeyId: keyId,
      newKeyPrefix: newApiKey.slice(0, 8),
      ip: req.ip,
      requestId: req.id
    });

    structuredLog("info", "api_key_rotated", {
      userId: req.user.id,
      keyName: existingKey.name
    });

    res.status(201).json({
      ok: true,
      apiKey: newApiKey,
      warning: "Save this API key now. It cannot be retrieved again. The old key has been invalidated."
    });
  });

  // Password change endpoint
  router.post("/change-password", authRateLimitMiddleware, validate("changePassword"), (req, res) => {
    if (!req.user) return res.status(401).json({ ok: false, error: "Not authenticated" });

    const { currentPassword, newPassword } = req.validated || req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ ok: false, error: "Both current and new password required" });
    }

    if (newPassword.length < 12) {
      return res.status(400).json({ ok: false, error: "New password must be at least 12 characters" });
    }

    // Verify current password
    const user = AuthDB.getUser(req.user.id);
    if (!user || !verifyPassword(currentPassword, user.passwordHash)) {
      auditLog("auth", "password_change_failed", {
        userId: req.user.id,
        reason: "invalid_current_password",
        ip: req.ip,
        requestId: req.id
      });
      return res.status(401).json({ ok: false, error: "Current password is incorrect" });
    }

    // Update password in database
    if (db) {
      const stmt = db.prepare("UPDATE users SET password_hash = ? WHERE id = ?");
      stmt.run(hashPassword(newPassword), req.user.id);
    } else {
      user.passwordHash = hashPassword(newPassword);
      saveAuthData();
    }

    auditLog("auth", "password_changed", {
      userId: req.user.id,
      ip: req.ip,
      requestId: req.id
    });

    structuredLog("info", "password_changed", { userId: req.user.id });

    res.json({ ok: true, message: "Password changed successfully" });
  });

  return router;
}
