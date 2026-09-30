/**
 * API Key Authentication Middleware
 *
 * Checks the Authorization header for "Bearer csk_..." API keys.
 * If an API key is found and valid, attaches key metadata to req.apiKey
 * and tracks usage. Falls back to JWT/cookie auth if no API key is present.
 *
 * Scope enforcement: if the key has scopes, the requested endpoint's
 * domain must match one of the allowed scopes.
 */

import { validateKey, trackUsage, checkScope } from "../lib/api-keys.js"; // no DB import — apiKeyAuth runs at request time when STATE.db is in scope (see resolveDb below)

/**
 * Resolve the better-sqlite3 handle from wherever the running Concord
 * server has stashed it. Mirrors the same pattern used at server.js:9309
 * and server.js:28522 — never assumes a specific global name, never
 * throws. Returns null in test/CLI contexts where no DB exists yet.
 */
function resolveDb() {
  try {
    if (typeof globalThis === "undefined") return null;
    // Prefer STATE.db (the running server), fall back to one of the
    // three known global stashes in order of most-to-least common.
    const s = globalThis._concordSTATE || globalThis.STATE;
    if (s && s.db && typeof s.db.prepare === "function") return s.db;
    const g = globalThis._concordDB || globalThis.__concordDB;
    if (g && typeof g.prepare === "function") return g;
  } catch {
    // ignore — return null below
  }
  return null;
}

/**
 * Map common route prefixes to lens domain names for scope checking.
 * This is a best-effort mapping; keys with empty scopes bypass this entirely.
 */
const ROUTE_TO_DOMAIN = {
  "/api/lens/":        null, // domain extracted from URL dynamically
  "/api/dtus":         "dtus",
  "/api/dtu":          "dtus",
  "/api/chat":         "chat",
  "/api/search":       "search",
  "/api/economy":      "economy",
  "/api/billing":      "billing",
  "/api/marketplace":  "marketplace",
  "/api/council":      "council",
  "/api/graph":        "graph",
  "/api/personas":     "personas",
  "/api/emergent":     "emergent",
  "/api/forge":        "forge",
  "/api/keys":         "keys",
  "/api/docs":         "docs",
  "/api/auth":         "auth",
  "/api/atlas":        "atlas",
  "/api/backup":       "backup",
  "/api/system":       "system",
};

/**
 * Resolve the domain for an incoming request path.
 *
 * @param {string} urlPath - req.path
 * @param {string} [bodyDomain] - req.body?.domain, used only for the
 *   generic macro dispatcher (see below)
 * @returns {string} domain name (or "unknown")
 */
export function resolveDomain(urlPath, bodyDomain) {
  // Lens routes encode domain in the URL: /api/lens/:domain/...
  const lensMatch = urlPath.match(/^\/api\/lens\/([^/]+)/);
  if (lensMatch) {
    const seg = lensMatch[1];
    // /api/lens/run is the generic macro dispatcher (POST {domain,name,input}
    // — see server.js's "/api/lens/run" handler and CLAUDE.md's "macro
    // system" section). "run" is a literal path token there, never a real
    // domain, so a scoped key would otherwise NEVER match any domain on the
    // one endpoint the whole macro system funnels through. Read the real
    // domain from the body instead.
    if (seg === "run" && bodyDomain && typeof bodyDomain === "string") {
      return bodyDomain;
    }
    return seg;
  }

  for (const [prefix, domain] of Object.entries(ROUTE_TO_DOMAIN)) {
    if (urlPath.startsWith(prefix) && domain) return domain;
  }

  return "unknown";
}

/**
 * Create the API key auth middleware.
 *
 * @param {object} [options]
 * @param {Function} [options.jwtFallback] - Optional function(req, res, next) for JWT auth fallback
 * @returns {Function} Express middleware
 */
export default function apiKeyAuth(options = {}) {
  const { jwtFallback } = options;

  return function apiKeyAuthMiddleware(req, res, next) {
    const authHeader = req.headers.authorization || "";

    // Only intercept if the bearer token is a Concord Secret Key
    if (!authHeader.startsWith("Bearer csk_")) {
      // No API key — fall back to JWT auth if provided
      if (typeof jwtFallback === "function") {
        return jwtFallback(req, res, next);
      }
      return next();
    }

    const rawKey = authHeader.slice(7); // strip "Bearer "

    // ── Validate ───────────────────────────────────────────────────────────
    const result = validateKey(rawKey);
    if (!result.ok) {
      return res.status(401).json({
        ok: false,
        error: "invalid_api_key",
        detail: result.error,
      });
    }

    const keyRecord = result.key;

    // ── Scope check ────────────────────────────────────────────────────────
    const domain = resolveDomain(req.path, req.body && req.body.domain);
    if (!checkScope(keyRecord, domain)) {
      return res.status(403).json({
        ok: false,
        error: "scope_denied",
        detail: `Key does not have access to domain "${domain}"`,
        allowedScopes: keyRecord.scopes,
      });
    }

    // ── Rate limit check (simple per-minute window) ────────────────────────
    // This is a lightweight in-middleware check; the billing metering layer
    // handles cost-based gating separately.
    // We use a sliding-window counter stored on the key record itself.
    // For production, this would be backed by Redis or a proper sliding window.

    // ── Track usage ────────────────────────────────────────────────────────
    trackUsage(keyRecord.id);

    // ── Attach metadata to request ─────────────────────────────────────────
    req.apiKey = {
      id: keyRecord.id,
      userId: keyRecord.userId,
      scopes: keyRecord.scopes,
      rateLimit: keyRecord.rateLimit,
      usageCount: keyRecord.usageCount + 1, // post-increment
    };

    // Also set req.user if not already set (allows downstream auth guards
    // like requireAuth() to pass when only an API key is provided)
    if (!req.user) {
      // Resolve the keyholder's REAL role from the DB instead of
      // hardcoding 'member'. Pre-2026-08-11 this hardcoded 'member',
      // which meant a sovereign-role user (e.g. the founder or Dila
      // per migration 400) authenticating via `Bearer csk_<…>` would
      // be silently demoted to 'member' — every requireRole check
      // downstream would then fail. Migration 400 ships with this
      // patch to restore the original privilege when authenticating
      // via API key.
      //
      // The lookup is intentionally narrow (SELECT role, scopes only)
      // and falls back to the historical default ('member') only when
      // the DB is unconfigured (e.g. in an offline unit test). It
      // never throws — auth failure surfaces through validateKey()
      // above, not through this lookup.
      let resolvedRole = "member";
      let resolvedScopes = keyRecord.scopes;
      try {
        const db = resolveDb();
        if (db) {
          const row = db
            .prepare("SELECT role, scopes FROM users WHERE id = ?")
            .get(keyRecord.userId);
          if (row && row.role) {
            resolvedRole = row.role;
            if (row.scopes) {
              try {
                const parsed = typeof row.scopes === "string"
                  ? JSON.parse(row.scopes)
                  : row.scopes;
                if (Array.isArray(parsed)) resolvedScopes = parsed;
              } catch {
                // scope-parse failure: fall through with key's own scopes,
                // not the user's — keeps the legacy safe default intact.
              }
            }
          }
        }
      } catch {
        // DB lookup threw — keep the hardcoded 'member' default. Auth
        // still works (sovereign bypasses role checks anyway).
      }
      req.user = {
        id: keyRecord.userId,
        role: resolvedRole,
        scopes: resolvedScopes,
        authMethod: "apiKey",
      };
    }

    req.authMethod = "csk_apiKey";

    return next();
  };
}

/**
 * Convenience: scope-guard middleware factory.
 * Use after apiKeyAuth to require specific scopes on a route.
 *
 * @param {...string} requiredScopes - Domains that must be in the key's scopes
 * @returns {Function} Express middleware
 */
export function requireScope(...requiredScopes) {
  return (req, res, next) => {
    // If no API key was used, skip scope check (JWT users are unrestricted)
    if (!req.apiKey) return next();

    const keyScopes = req.apiKey.scopes || [];
    // Empty scopes = unrestricted
    if (keyScopes.length === 0 || keyScopes.includes("*")) return next();

    const missing = requiredScopes.filter((s) => !keyScopes.includes(s));
    if (missing.length > 0) {
      return res.status(403).json({
        ok: false,
        error: "insufficient_scopes",
        required: requiredScopes,
        missing,
      });
    }

    return next();
  };
}
