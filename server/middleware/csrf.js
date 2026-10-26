// CSRF middleware. Moved out of server.js so a test can run this exact
// function with NODE_ENV=production and CONCORD_ENFORCE_CSRF=true, without
// booting the process in production (that path process.exit(1)s unless
// every production secret is set).
//
// server.js passes the NODE_ENV and AUTH_MODE values it captured at boot.
// CONCORD_DISABLE_CSRF and CONCORD_ENFORCE_CSRF stay live env reads, same
// as when this lived inline.

import crypto from "node:crypto";

// The one anonymous write under /api/public-share/: a reviewer's comment on a
// proof link (POST /api/public-share/proof/:token/comment). Every gate that
// lets it through matches this exact route, never a prefix.
export const PUBLIC_PROOF_COMMENT_RE = /^\/api\/public-share\/proof\/[^/]+\/comment$/;
// INC-72: inbound ingest webhook — POST only, token in the path is the credential
// (crypto.randomBytes(16) hex, resolved server-side to one user's endpoint).
export const INGEST_WEBHOOK_RE = /^\/api\/ingest\/webhook\/[a-f0-9]{32}$/;

// Public receipt check. Exact path only — a prefix would also open
// /api/receipts/verify/x and /api/receipts/verify-extra.
export const RECEIPT_VERIFY_PATH = "/api/receipts/verify";

/**
 * @param {object} [opts]
 * @param {string} [opts.nodeEnv]
 * @param {string} [opts.authMode]
 * @param {Function} [opts.auditLog]
 * @param {string} [opts.jwtSecret]
 */
export function createCsrfMiddleware({ nodeEnv, authMode, auditLog, jwtSecret } = {}) {
  function generateCsrfToken(sessionId = "") {
    // Generate a token based on a secret + session identifier
    const secret = String(jwtSecret || "").slice(0, 32);
    const data = `${sessionId}:${Date.now()}`;
    return crypto.createHmac("sha256", secret).update(data).digest("hex").slice(0, 32);
  }

  function validateCsrfToken(token, cookieToken) {
    if (!token || !cookieToken) return false;
    try {
      return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(cookieToken));
    } catch {
      return false;
    }
  }

  function csrfMiddleware(req, res, next) {
    // Skip CSRF for non-browser requests (API keys, no cookies)
    if (req.authMethod === "apiKey") return next();
    // Bearer JWT / Unity kitchen guest without a browser session cookie — API
    // clients (curl harness, ConcordClient HTTP hit/quest) are not CSRF-vulnerable
    // the way cookie-authenticated browsers are.
    if ((req.authMethod === "jwt" || req.authMethod === "unity-local-guest")
        && !req.cookies?.concord_auth) {
      return next();
    }

    // Skip for safe methods
    const safeMethods = ["GET", "HEAD", "OPTIONS"];
    if (safeMethods.includes(req.method)) return next();

    // Skip for public endpoints and core API paths (chat, lens operations)
    // /api/stripe/webhook is authenticated by Stripe's request SIGNATURE (verified
    // in handleWebhook), not a cookie/CSRF token — Stripe can't send one. It must
    // be CSRF-exempt or every webhook 403s and paid coins never mint.
    const csrfExempt = ["/api/auth/login", "/api/auth/register", "/api/auth/refresh", "/api/auth/google", "/api/auth/apple", "/health", "/ready", "/api/chat", "/api/lens", "/api/stripe/webhook", "/mcp", "/api/metrics/vitals", "/api/client-error", "/api/world/perf-telemetry", "/api/welding/portal/", "/api/spectate/", "/api/esign/"];  // "/mcp" added Sprint 54 for local-first MCP server bypass; "/api/auth/refresh" is cookie-authenticated via the httpOnly refresh token (SameSite=lax already blocks cross-site POST) and must work before a CSRF cookie exists. The 3 telemetry paths added 2026-08-24 (found live during a real-browser load test) — all three are reported via navigator.sendBeacon (lib/perf.ts and its error-reporting sibling), which cannot attach a custom X-CSRF-Token header the way a fetch() call can; requiring one made every anonymous beacon 403 unconditionally. All three are fire-and-forget, non-sensitive (perf numbers / error messages / vitals), already have their own Gate-1 POST bypasses in server.js's authMiddleware for the identical reason, and have no state-changing side effect beyond appending to an in-memory buffer — the CSRF gate exists to stop a forged cross-site STATE CHANGE, and there is none here to forge.
    if (csrfExempt.some(p => req.path.startsWith(p))) return next();
    // The anonymous proof-link reviewer comment: exactly this one POST route,
    // not the /api/public-share/ prefix. No session cookie exists to forge.
    if (req.method === "POST" && PUBLIC_PROOF_COMMENT_RE.test(req.path)) return next();
    if (req.method === "POST" && INGEST_WEBHOOK_RE.test(req.path)) return next();
    // POST /api/receipts/verify checks an Ed25519 signature and writes nothing.
    // Exact path, not a prefix, so no other route under /api/receipts/ is opened.
    // The /verify page and third-party verifiers POST JSON with no CSRF header
    // and no session. Rate limit stays write.receipt-verify (routes/receipts.js).
    if (req.method === "POST" && req.path === RECEIPT_VERIFY_PATH) return next();

    // In AUTH_MODE=public, skip CSRF — anonymous users have no session to protect
    if (authMode === "public") return next();

    // CSRF is enforced in production by default. Dev / staging can opt
    // out with CONCORD_DISABLE_CSRF=true when they're running local
    // scripts that don't thread a CSRF token. This matches the original
    // behavior (NODE_ENV !== "production" is implicit opt-out) but
    // flips the default for non-production explicitly so that a
    // staging instance accidentally running without NODE_ENV set still
    // gets protection — unless the operator turns it off.
    if (process.env.CONCORD_DISABLE_CSRF === "true") return next();
    if (nodeEnv !== "production" && process.env.CONCORD_ENFORCE_CSRF !== "true") return next();

    // Validate CSRF token
    const headerToken = req.headers["x-csrf-token"] || req.headers["x-xsrf-token"];
    const cookieToken = req.cookies?.csrf_token;

    if (!validateCsrfToken(headerToken, cookieToken)) {
      auditLog("security", "csrf_failed", { path: req.path, method: req.method, ip: req.ip });
      return res.status(403).json({ ok: false, error: "CSRF token invalid or missing", code: "CSRF_FAILED" });
    }

    return next();
  }

  return { csrfMiddleware, generateCsrfToken };
}
