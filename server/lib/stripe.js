/**
 * server/lib/stripe.js
 * Stripe SDK initialization.
 *
 * Provides a lazy-loaded, cached Stripe instance using STRIPE_SECRET_KEY
 * from the environment.  Other modules should import `getStripe` and await it
 * rather than constructing their own Stripe instance.
 *
 * Usage:
 *   import { getStripe, STRIPE_ENABLED } from "../lib/stripe.js";
 *   const stripe = await getStripe();
 */

// ── Constants ──────────────────────────────────────────────────────────────────

/** Stripe is enabled when the secret key is present in the environment. */
export const STRIPE_ENABLED = Boolean(process.env.STRIPE_SECRET_KEY);

/** Webhook signing secret — required for verifying inbound Stripe events. */
export const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "";

/**
 * CC-to-USD conversion rate.
 * 1 CC = $0.01 USD  (i.e., 100 CC = $1.00 USD)
 * Override with the TOKENS_PER_USD env var (tokens you get per $1).
 */
export const TOKENS_PER_USD = Number(process.env.TOKENS_PER_USD) || 100;
const CC_TO_USD = 1 / TOKENS_PER_USD; // 0.01

// ── Singleton ──────────────────────────────────────────────────────────────────

let _stripe = null;

/**
 * Returns the Stripe SDK instance, lazily initialised.
 * Returns `null` when STRIPE_SECRET_KEY is not set.
 *
 * @returns {Promise<import('stripe').default | null>}
 */
export async function getStripe() {
  if (!STRIPE_ENABLED) return null;
  if (_stripe) return _stripe;

  try {
    const Stripe = (await import("stripe")).default;
    _stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: "2023-10-16",
    });
  } catch (err) {
    console.warn("[stripe] stripe package not available:", err.message);
    return null;
  }

  return _stripe;
}

/**
 * A real Stripe secret. Placeholders (`sk_REPLACE_ME…`) and empty values are
 * not configured — they must not be sent to Stripe and must not unlock a
 * "paid" state. Restricted keys (`rk_…`) are not accepted here.
 */
const STRIPE_SECRET_RE = /^sk_(test|live)_/;

export function stripeSecretKey() {
  const key = String(process.env.STRIPE_SECRET_KEY || "").trim();
  return STRIPE_SECRET_RE.test(key) ? key : "";
}

export function isStripeSecretConfigured() {
  return stripeSecretKey() !== "";
}

async function stripeV1(path, { method, body } = {}) {
  const key = stripeSecretKey();
  if (!key) {
    const err = new Error("stripe_not_configured");
    err.code = "stripe_not_configured";
    throw err;
  }
  const headers = { Authorization: `Bearer ${key}` };
  const init = { method: method || "GET", headers };
  if (body) {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    headers["Stripe-Version"] = "2025-09-30.acacia";
    init.body = new URLSearchParams(body).toString();
  }
  const res = await fetch(`https://api.stripe.com/v1${path}`, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data?.error?.message || `stripe ${path} failed`);
    err.code = "stripe_http_error";
    throw err;
  }
  return data;
}

/** GET /v1/payment_intents/:id — the charge is real only when Stripe says so. */
export function retrievePaymentIntent(paymentIntentId) {
  const id = String(paymentIntentId || "");
  return stripeV1(`/payment_intents/${encodeURIComponent(id)}`, { method: "GET" });
}

/** POST /v1/payment_intents. `formBody` values are Stripe form fields. */
export function createPaymentIntent(formBody) {
  return stripeV1("/payment_intents", { method: "POST", body: formBody });
}
