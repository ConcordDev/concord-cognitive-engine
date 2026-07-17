// tests/economy/stripe-checkout-idempotency.test.js
//
// Source-pin (repo convention — cf. tests/world-page-wind-direction-threading.test.ts)
// for a structural money-safety fix that can't be runtime-mocked without a real
// STRIPE_SECRET_KEY (getStripe() returns null when unset). The deposit-side
// idempotency key was computed but only stuffed into `metadata`, where Stripe
// never reads it — so it was inert. The fix passes it as the request-options
// SECOND argument to checkout.sessions.create(params, { idempotencyKey }), which
// becomes the real `Idempotency-Key` header, matching the payout side.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(path.join(__dirname, "../../economy/stripe.js"), "utf-8");

/** Slice out the createCheckoutSession function body for scoped assertions. */
function checkoutFnSource() {
  const start = SRC.indexOf("export async function createCheckoutSession");
  assert.ok(start >= 0, "createCheckoutSession not found");
  // End at the next top-level `export ` after the function opens.
  const end = SRC.indexOf("\nexport ", start + 10);
  return SRC.slice(start, end > start ? end : undefined);
}

describe("Stripe checkout idempotency key placement", () => {
  const fn = checkoutFnSource();

  it("passes idempotencyKey as the request-options 2nd arg to sessions.create", () => {
    // The create call must close its params object and open an options object
    // that carries idempotencyKey — i.e. `}, {  ... idempotencyKey ... }`.
    const createIdx = fn.indexOf("checkout.sessions.create(");
    assert.ok(createIdx >= 0, "sessions.create call not found");
    const after = fn.slice(createIdx);
    assert.match(
      after,
      /\},\s*\{[\s\S]*idempotencyKey[\s\S]*\}\s*\)/,
      "idempotencyKey must be in the request-options (2nd) argument of sessions.create",
    );
  });

  it("does NOT leave idempotencyKey inside the session metadata (inert placement)", () => {
    // Scope to the metadata object literal for the TOKEN_PURCHASE session.
    const metaIdx = fn.indexOf('purpose: "TOKEN_PURCHASE"');
    assert.ok(metaIdx >= 0, "TOKEN_PURCHASE metadata block not found");
    // The metadata object closes at the first `},` after the purpose line.
    const metaBlock = fn.slice(metaIdx, fn.indexOf("},", metaIdx));
    assert.doesNotMatch(
      metaBlock,
      /idempotencyKey/,
      "idempotencyKey must not sit in metadata (Stripe never reads it there)",
    );
  });

  it("still computes a per-request idempotency key", () => {
    assert.match(fn, /const idempotencyKey = createHash\("sha256"\)/);
  });
});
