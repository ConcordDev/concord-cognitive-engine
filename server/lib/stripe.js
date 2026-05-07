/**
 * server/lib/stripe.js
 * Stripe SDK initialization.
 *
 * Provides a lazy-loaded, cached Stripe instance using STRIPE_SECRET_KEY
 * from the environment.  Other modules should import `getStripe` and await it
 * rather than constructing their own Stripe instance.
 *
 * Usage:
 *   import { getStripe, STRIPE_ENABLED, CC_TO_USD } from "../lib/stripe.js";
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
export const CC_TO_USD = 1 / TOKENS_PER_USD; // 0.01

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
