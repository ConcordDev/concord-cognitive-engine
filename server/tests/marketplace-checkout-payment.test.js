// Storefront checkout takes no payment, so its orders must not claim "paid":
// they wait for the seller to confirm payment, can't ship before that, and
// an unpaid order is cancelled rather than "refunded".

import { it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerMarketplaceActions from "../domains/marketplace.js";

const H = new Map();
registerMarketplaceActions((_d, n, fn) => H.set(n, fn));
const call = (n, ctx, p = {}) => H.get(n)(ctx, { id: null, data: {}, meta: {} }, p);
const seller = { actor: { userId: "s1" }, userId: "s1" };
const buyer = { actor: { userId: "b1" }, userId: "b1" };

beforeEach(() => { globalThis._concordSTATE = { dtus: new Map() }; });

function placeOrder() {
  call("shop-get", seller);
  const id = call("listings-create", seller, { title: "Mug", priceUsd: 20, kind: "physical_good", stockQty: 3 }).result.listing.id;
  call("listings-publish", seller, { id });
  assert.equal(call("cart-add", buyer, { sellerId: "s1", listingId: id, qty: 1 }).ok, true);
  const co = call("checkout-create", buyer, { buyerName: "Bo", buyerEmail: "bo@x.com" });
  assert.equal(co.ok, true);
  return co.result.checkout.orders[0].orderId;
}
const order = (id) => call("orders-list", seller, {}).result.orders.find((o) => o.id === id);

it("checkout orders await payment and cannot ship until the seller confirms it", () => {
  const id = placeOrder();
  assert.equal(order(id).status, "pending");
  assert.equal(order(id).paymentStatus, "awaiting_payment");
  assert.equal(call("orders-mark-shipped", seller, { id, trackingNumber: "1Z" }).ok, false);
  assert.equal(call("orders-mark-paid", seller, { id }).result.order.status, "paid");
  assert.equal(call("orders-mark-paid", seller, { id }).ok, false);
  assert.equal(call("orders-mark-shipped", seller, { id, trackingNumber: "1Z" }).result.order.status, "shipped");
});

it("an unpaid order is cancelled, not refunded", () => {
  const id = placeOrder();
  const r = call("orders-refund", seller, { id, reason: "out of stock" });
  assert.equal(r.result.order.cancelled, true);
});
