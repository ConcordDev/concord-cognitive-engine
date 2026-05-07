/**
 * Webhook Authentication — Secret verification for inbound webhooks.
 *
 * Supports:
 *   - Per-domain webhook secrets stored in STATE
 *   - Global webhook secret from env (WEBHOOK_SECRET)
 *   - HMAC-SHA256 signature verification (X-Webhook-Signature header)
 *   - Bearer token auth (Authorization header)
 */

import crypto from "crypto";
import logger from "../logger.js";

// ── Webhook Secret Management ──────────────────────────────────────────────

const GLOBAL_SECRET = process.env.WEBHOOK_SECRET || null;

/**
 * Create or retrieve a webhook secret for a domain.
 *
 * @param {object} STATE
 * @param {string} domain
 * @returns {{ secret: string, isNew: boolean }}
 */
export function getOrCreateWebhookSecret(STATE, domain) {
  if (!STATE.webhookSecrets) STATE.webhookSecrets = {};

  if (STATE.webhookSecrets[domain]) {
    return { secret: STATE.webhookSecrets[domain], isNew: false };
  }

  const secret = crypto.randomBytes(32).toString("hex");
  STATE.webhookSecrets[domain] = secret;
  return { secret, isNew: true };
}

/**
 * List all registered webhook domains and their URLs.
 */
export function listWebhookDomains(STATE, { baseUrl = "" } = {}) {
  const domains = Object.keys(STATE.webhookSecrets || {});
  return domains.map(domain => ({
    domain,
    url: `${baseUrl}/api/webhook/${domain}`,
    hasSecret: true,
  }));
}

/**
 * Revoke a webhook secret for a domain.
 */
export function revokeWebhookSecret(STATE, domain) {
  if (STATE.webhookSecrets?.[domain]) {
    delete STATE.webhookSecrets[domain];
    return true;
  }
  return false;
}

// ── Signature Verification ─────────────────────────────────────────────────

/**
 * Verify an inbound webhook request.
 *
 * Checks (in order):
 *   1. HMAC-SHA256 signature in X-Webhook-Signature header
 *   2. Bearer token in Authorization header matching domain secret
 *   3. Global WEBHOOK_SECRET env var match
 *   4. If no secrets configured for domain, allow (open mode for unconfigured domains)
 *
 * @param {object} req - Express request
 * @param {object} STATE
 * @param {string} domain
 * @returns {{ authenticated: boolean, method: string }}
 */
export function verifyWebhook(req, STATE, domain) {
  const domainSecret = STATE.webhookSecrets?.[domain];
  const signature = req.headers["x-webhook-signature"] || req.headers["x-hub-signature-256"];
  const authHeader = req.headers["authorization"];

  // Method 1: HMAC signature verification
  if (signature && domainSecret) {
    const bodyStr = typeof req.rawBody === "string"
      ? req.rawBody
      : JSON.stringify(req.body || {});
    const expected = "sha256=" + crypto
      .createHmac("sha256", domainSecret)
      .update(bodyStr, "utf8")
      .digest("hex");

    if (crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
      return { authenticated: true, method: "hmac-sha256" };
    }
    // Signature present but invalid
    return { authenticated: false, method: "hmac-invalid" };
  }

  // Method 2: Bearer token
  if (authHeader) {
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (domainSecret && token === domainSecret) {
      return { authenticated: true, method: "bearer-token" };
    }
    if (GLOBAL_SECRET && token === GLOBAL_SECRET) {
      return { authenticated: true, method: "global-secret" };
    }
    return { authenticated: false, method: "bearer-invalid" };
  }

  // Method 3: Query param secret
  if (req.query?.secret) {
    if (domainSecret && req.query.secret === domainSecret) {
      return { authenticated: true, method: "query-secret" };
    }
    if (GLOBAL_SECRET && req.query.secret === GLOBAL_SECRET) {
      return { authenticated: true, method: "global-secret" };
    }
    return { authenticated: false, method: "query-invalid" };
  }

  // No secret configured for this domain — open mode
  if (!domainSecret && !GLOBAL_SECRET) {
    return { authenticated: true, method: "open" };
  }

  // Secret exists but no auth provided
  return { authenticated: false, method: "no-credentials" };
}

export default {
  getOrCreateWebhookSecret,
  listWebhookDomains,
  revokeWebhookSecret,
  verifyWebhook,
};
