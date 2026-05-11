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

// Domain names are user-controlled when an admin registers a new integration.
// Reject anything that isn't a strict slug to neutralise prototype-pollution
// (e.g. domain="__proto__" → STATE.webhookSecrets["__proto__"] = secret would
// mutate Object.prototype on a plain-object map).
const DOMAIN_SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/i;
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function assertValidDomain(domain) {
  if (typeof domain !== "string" || !DOMAIN_SLUG_RE.test(domain) || FORBIDDEN_KEYS.has(domain)) {
    throw new Error(`Invalid webhook domain: ${typeof domain === "string" ? domain.slice(0, 32) : typeof domain}`);
  }
}

function ensureSecretsMap(STATE) {
  // Map sidesteps prototype-pollution risk entirely (keys can't reach Object.prototype).
  // Back-compat: if a prior process stored a plain object, lift it into the Map.
  if (!STATE.webhookSecrets || !(STATE.webhookSecrets instanceof Map)) {
    const m = new Map();
    if (STATE.webhookSecrets && typeof STATE.webhookSecrets === "object") {
      for (const k of Object.keys(STATE.webhookSecrets)) {
        if (DOMAIN_SLUG_RE.test(k) && !FORBIDDEN_KEYS.has(k)) {
          m.set(k, STATE.webhookSecrets[k]);
        }
      }
    }
    STATE.webhookSecrets = m;
  }
  return STATE.webhookSecrets;
}

/**
 * Create or retrieve a webhook secret for a domain.
 *
 * @param {object} STATE
 * @param {string} domain
 * @returns {{ secret: string, isNew: boolean }}
 */
export function getOrCreateWebhookSecret(STATE, domain) {
  assertValidDomain(domain);
  const secrets = ensureSecretsMap(STATE);

  const existing = secrets.get(domain);
  if (existing) {
    return { secret: existing, isNew: false };
  }

  const secret = crypto.randomBytes(32).toString("hex");
  secrets.set(domain, secret);
  return { secret, isNew: true };
}

/**
 * List all registered webhook domains and their URLs.
 */
export function listWebhookDomains(STATE, { baseUrl = "" } = {}) {
  const secrets = ensureSecretsMap(STATE);
  return [...secrets.keys()].map(domain => ({
    domain,
    url: `${baseUrl}/api/webhook/${domain}`,
    hasSecret: true,
  }));
}

/**
 * Revoke a webhook secret for a domain.
 */
export function revokeWebhookSecret(STATE, domain) {
  if (typeof domain !== "string" || !DOMAIN_SLUG_RE.test(domain) || FORBIDDEN_KEYS.has(domain)) {
    return false;
  }
  const secrets = ensureSecretsMap(STATE);
  if (secrets.has(domain)) {
    secrets.delete(domain);
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
  // Reject malformed/forbidden domain keys outright — same gate as the writers.
  if (typeof domain !== "string" || !DOMAIN_SLUG_RE.test(domain) || FORBIDDEN_KEYS.has(domain)) {
    return { authenticated: false, method: "invalid-domain" };
  }
  const secrets = ensureSecretsMap(STATE);
  const domainSecret = secrets.get(domain);
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

  // SECURITY: previously, no secret configured ⇒ "open mode" ⇒ any payload
  // was accepted as authenticated. That silently trusted arbitrary
  // third-party requests as legitimate events. We now default-deny —
  // operators must explicitly enable open mode via env var.
  const openModeEnabled = process.env.CONCORD_WEBHOOK_ALLOW_OPEN === "true";
  if (!domainSecret && !GLOBAL_SECRET) {
    if (openModeEnabled) {
      return { authenticated: true, method: "open" };
    }
    return { authenticated: false, method: "no-secret-configured" };
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
