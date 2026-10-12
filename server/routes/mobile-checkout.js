// routes/mobile-checkout.js
// Mobile external payment redirect routes.
// iOS app opens these URLs in Safari to process token purchases via Stripe,
// bypassing Apple's 30% IAP commission under the External Purchase Link Entitlement.
//
// Flow: iOS app → Safari /checkout → Stripe Checkout → /checkout/success → deep link back to app

import express from "express";
import { createCheckoutSession } from "../economy/stripe.js";
import { resolveFrontendUrl } from "../lib/frontend-url.js";

const router = express.Router();

function frontendUrl() {
  return resolveFrontendUrl({ mode: "public", extraEnv: ["NEXT_PUBLIC_API_URL"] });
}
const DEEP_LINK_SCHEME = "concordapp";
const MIN_AMOUNT_CENTS = 100;       // $1.00
const MAX_AMOUNT_CENTS = 1_000_000; // $10,000.00
const TOKENS_PER_USD = Number(process.env.TOKENS_PER_USD) || 1;

// ── GET /checkout ──────────────────────────────────────────────────────────
// Mobile app redirects here with auth token + amount.
// Validates the JWT, creates a Stripe checkout session, and redirects to Stripe.

router.get("/checkout", async (req, res) => {
  const { source, userId, amount, token } = req.query;

  // Validate required params
  if (!userId || !amount || !token) {
    return res.status(400).send(renderErrorPage("Missing required parameters. Please try again from the app."));
  }

  // Validate JWT token using the server's verifyToken function (injected via deps)
  const decoded = req.app.locals.verifyToken?.(token);
  if (!decoded || decoded.userId !== userId) {
    return res.status(401).send(renderErrorPage("Invalid or expired session. Please try again from the app."));
  }

  // Validate amount
  const amountFloat = parseFloat(amount);
  const cents = Math.round(amountFloat * 100);
  if (isNaN(cents) || cents < MIN_AMOUNT_CENTS || cents > MAX_AMOUNT_CENTS) {
    return res.status(400).send(renderErrorPage("Invalid amount. Must be between $1 and $10,000."));
  }

  // Convert dollar amount to tokens
  const tokens = Math.round(amountFloat * TOKENS_PER_USD);

  try {
    const db = req.app.locals.db;
    const result = await createCheckoutSession(db, {
      userId,
      tokens,
      requestId: req.headers["x-request-id"] || undefined,
      ip: req.ip,
      // Override URLs for mobile flow
      successUrl: `${frontendUrl()}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${frontendUrl()}/checkout/cancel`,
      metadata: {
        source: source || "ios_app",
        coinAmount: String(amountFloat),
      },
    });

    if (!result.ok) {
      console.error("[mobile-checkout] Failed to create checkout session:", result.error);
      return res.status(500).send(renderErrorPage("Unable to start checkout. Please try again."));
    }

    // Redirect to Stripe's hosted checkout page
    return res.redirect(303, result.checkoutUrl);
  } catch (err) {
    console.error("[mobile-checkout] Checkout error:", err.message);
    return res.status(500).send(renderErrorPage("Something went wrong. Please try again from the app."));
  }
});

// ── GET /checkout/success ──────────────────────────────────────────────────
// Stripe redirects here after successful payment.
// The actual coin minting happens via the Stripe webhook (checkout.session.completed).
// This page just confirms success and offers a deep link back to the app.

router.get("/checkout/success", (_req, res) => {
  res.send(renderSuccessPage());
});

// ── GET /checkout/cancel ───────────────────────────────────────────────────
// Stripe redirects here if the user cancels the payment.

router.get("/checkout/cancel", (_req, res) => {
  res.send(renderCancelPage());
});

// ── HTML Page Renderers ────────────────────────────────────────────────────

function renderSuccessPage() {
  return `<!DOCTYPE html>
<html><head>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Purchase Complete — Concord</title>
  <style>
    body { font-family: -apple-system, sans-serif; background: #0a0a0f; color: #fff;
           display: flex; align-items: center; justify-content: center; min-height: 100vh;
           margin: 0; text-align: center; }
    .card { padding: 40px; max-width: 400px; }
    h1 { font-size: 24px; margin-bottom: 12px; }
    p { color: #888; font-size: 16px; line-height: 1.5; }
    .btn { display: inline-block; margin-top: 24px; padding: 14px 32px;
           background: #6366f1; color: white; border-radius: 12px;
           text-decoration: none; font-size: 16px; font-weight: 600; }
    .check { font-size: 48px; margin-bottom: 16px; }
  </style>
</head><body>
  <div class="card">
    <div class="check">&#10003;</div>
    <h1>Coins Added</h1>
    <p>Your Concord Coins are ready. They'll appear in your wallet within seconds.</p>
    <a href="${DEEP_LINK_SCHEME}://checkout-complete?status=success" class="btn">Return to Concord</a>
    <p style="margin-top: 16px; font-size: 13px; color: #555;">
      If the button doesn't work, open the Concord app manually.
    </p>
  </div>
</body></html>`;
}

function renderCancelPage() {
  return `<!DOCTYPE html>
<html><head>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Purchase Cancelled — Concord</title>
  <style>
    body { font-family: -apple-system, sans-serif; background: #0a0a0f; color: #fff;
           display: flex; align-items: center; justify-content: center; min-height: 100vh;
           margin: 0; text-align: center; }
    .card { padding: 40px; max-width: 400px; }
    h1 { font-size: 24px; margin-bottom: 12px; }
    p { color: #888; font-size: 16px; line-height: 1.5; }
    .btn { display: inline-block; margin-top: 24px; padding: 14px 32px;
           background: #333; color: white; border-radius: 12px;
           text-decoration: none; font-size: 16px; font-weight: 600; }
  </style>
</head><body>
  <div class="card">
    <h1>Purchase Cancelled</h1>
    <p>No charges were made. You can try again anytime.</p>
    <a href="${DEEP_LINK_SCHEME}://checkout-cancel" class="btn">Return to Concord</a>
  </div>
</body></html>`;
}

function renderErrorPage(message) {
  // Escape HTML entities to prevent XSS via query parameter injection
  const safeMessage = String(message)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");

  return `<!DOCTYPE html>
<html><head>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Error — Concord</title>
  <style>
    body { font-family: -apple-system, sans-serif; background: #0a0a0f; color: #fff;
           display: flex; align-items: center; justify-content: center; min-height: 100vh;
           margin: 0; text-align: center; }
    .card { padding: 40px; max-width: 400px; }
    h1 { font-size: 24px; margin-bottom: 12px; color: #ef4444; }
    p { color: #888; font-size: 16px; }
    .btn { display: inline-block; margin-top: 24px; padding: 14px 32px;
           background: #333; color: white; border-radius: 12px;
           text-decoration: none; font-size: 16px; font-weight: 600; }
  </style>
</head><body>
  <div class="card">
    <h1>Something Went Wrong</h1>
    <p>${safeMessage}</p>
    <a href="${DEEP_LINK_SCHEME}://error" class="btn">Return to Concord</a>
  </div>
</body></html>`;
}

export default router;
