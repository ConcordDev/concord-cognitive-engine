// tests/depth/retail-register-behavior.test.js — the register primitives the
// redesigned retail lens is built on: line editing, parked sales, voids,
// customer attach, and gift-card split tender (atomic with the order).
//
// lens.run wrapping (depth-harness convention): a handler's
// { ok:true, result:X } surfaces as r.ok===true + r.result===X; a handler's
// { ok:false, error } surfaces as r.result.ok===false + r.result.error.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { lensRun, depthCtx } from "./_harness.js";

const refused = (r) => r.ok === false || r.result?.ok === false;
const errOf = (r) => r.result?.error || r.error;

describe("retail — register primitives", () => {
  let ctx;
  const A = `RG-A-${randomUUID().slice(0, 6)}`;
  const B = `RG-B-${randomUUID().slice(0, 6)}`;

  before(async () => {
    ctx = await depthCtx(`retail-register-${randomUUID()}`);
    await lensRun("retail", "product-upsert", { params: { sku: A, name: "Mug", price: 10, stock: 3 } }, ctx);
    await lensRun("retail", "product-upsert", { params: { sku: B, name: "Tea", price: 4, stock: 50 } }, ctx);
  });

  const openCart = async () => (await lensRun("retail", "cart-open", {}, ctx)).result.cart.id;

  it("set-line-qty changes a quantity, qty 0 removes the line, and totals follow", async () => {
    const cartId = await openCart();
    await lensRun("retail", "cart-add-line", { params: { cartId, sku: A, qty: 1 } }, ctx);
    await lensRun("retail", "cart-add-line", { params: { cartId, sku: B, qty: 1 } }, ctx);
    const up = await lensRun("retail", "cart-set-line-qty", { params: { cartId, sku: B, qty: 5 } }, ctx);
    assert.equal(up.ok, true);
    assert.equal(up.result.cart.lines.find((l) => l.sku === B).qty, 5);
    let tot = await lensRun("retail", "cart-total", { params: { cartId, taxRate: 0 } }, ctx);
    assert.equal(tot.result.subtotal, 30); // 10 + 5×4
    const rm = await lensRun("retail", "cart-set-line-qty", { params: { cartId, sku: A, qty: 0 } }, ctx);
    assert.equal(rm.result.removed, true);
    assert.equal(rm.result.cart.lines.length, 1);
    tot = await lensRun("retail", "cart-total", { params: { cartId, taxRate: 0 } }, ctx);
    assert.equal(tot.result.subtotal, 20);
    assert.ok(refused(await lensRun("retail", "cart-set-line-qty", { params: { cartId, sku: B, qty: -1 } }, ctx)));
    assert.ok(refused(await lensRun("retail", "cart-set-line-qty", { params: { cartId, sku: B, qty: 1.5 } }, ctx)));
    assert.ok(refused(await lensRun("retail", "cart-set-line-qty", { params: { cartId, sku: A, qty: 1 } }, ctx)), "a sku not in the cart is refused");
  });

  it("adding past stock is allowed but reported", async () => {
    const cartId = await openCart();
    const r = await lensRun("retail", "cart-add-line", { params: { cartId, sku: A, qty: 4 } }, ctx);
    assert.equal(r.ok, true);
    assert.match(r.result.stockWarning, /Only 3/);
    const ok = await lensRun("retail", "cart-set-line-qty", { params: { cartId, sku: A, qty: 2 } }, ctx);
    assert.equal(ok.result.stockWarning, undefined);
  });

  it("a fixed-amount code keeps its dollar value as the subtotal moves, and is dropped (and reported) below its minimum", async () => {
    const code = `FIVE${randomUUID().slice(0, 4).toUpperCase()}`;
    await lensRun("retail", "discounts-create", { params: { code, kind: "fixed_amount", value: 5, minSubtotal: 15 } }, ctx);
    const cartId = await openCart();
    await lensRun("retail", "cart-add-line", { params: { cartId, sku: B, qty: 5 } }, ctx); // $20
    const ap = await lensRun("retail", "discounts-apply", { params: { cartId, code } }, ctx);
    assert.equal(ap.ok, true, JSON.stringify(ap));
    await lensRun("retail", "cart-set-line-qty", { params: { cartId, sku: B, qty: 10 } }, ctx); // $40
    let tot = await lensRun("retail", "cart-total", { params: { cartId, taxRate: 0 } }, ctx);
    assert.equal(tot.result.discount, 5, "still $5 off, not 25% of $40");
    const drop = await lensRun("retail", "cart-set-line-qty", { params: { cartId, sku: B, qty: 2 } }, ctx); // $8 < $15
    assert.equal(drop.result.discountDropped, code);
    tot = await lensRun("retail", "cart-total", { params: { cartId, taxRate: 0 } }, ctx);
    assert.equal(tot.result.discount, 0);
  });

  it("cart-list shows parked sales; cart-get resumes one; cart-void discards it", async () => {
    const cartId = await openCart();
    await lensRun("retail", "cart-add-line", { params: { cartId, sku: B, qty: 3 } }, ctx);
    const list = await lensRun("retail", "cart-list", {}, ctx);
    const row = list.result.carts.find((c) => c.id === cartId);
    assert.equal(row.itemCount, 3);
    assert.equal(row.subtotal, 12);
    const got = await lensRun("retail", "cart-get", { params: { cartId } }, ctx);
    assert.equal(got.result.cart.lines[0].sku, B);
    const v = await lensRun("retail", "cart-void", { params: { cartId } }, ctx);
    assert.equal(v.result.voided, cartId);
    const after = await lensRun("retail", "cart-list", {}, ctx);
    assert.equal(after.result.carts.some((c) => c.id === cartId), false);
    assert.ok(refused(await lensRun("retail", "cart-get", { params: { cartId } }, ctx)));
  });

  it("an attached customer is stamped on the order and their totals move", async () => {
    const add = await lensRun("retail", "customers-add", { params: { name: "Ada", email: `ada-${randomUUID().slice(0, 6)}@ex.com` } }, ctx);
    const customerId = add.result.customer.id;
    const cartId = await openCart();
    await lensRun("retail", "cart-add-line", { params: { cartId, sku: B, qty: 2 } }, ctx);
    const set = await lensRun("retail", "cart-set-customer", { params: { cartId, customerId } }, ctx);
    assert.equal(set.result.cart.customerName, "Ada");
    const t = await lensRun("retail", "cart-tender", { params: { cartId, taxRate: 0, tenders: [{ kind: "cash", amount: 10 }] } }, ctx);
    assert.equal(t.result.order.customerId, customerId);
    assert.equal(t.result.order.change, 2);
    const list = await lensRun("retail", "customers-list", {}, ctx);
    const c = list.result.customers.find((x) => x.id === customerId);
    assert.equal(c.totalSpent, 8);
    assert.equal(c.orderCount, 1);
    assert.ok(c.lastOrderAt);
    assert.ok(refused(await lensRun("retail", "cart-set-customer", { params: { cartId: await openCart(), customerId: "cust_nope" } }, ctx)));
  });

  it("gift card + cash split tender redeems the card with the order; bad cards write nothing", async () => {
    const gc = await lensRun("retail", "gift-cards-create", { params: { initialValue: 15 } }, ctx);
    assert.equal(gc.ok, true, JSON.stringify(gc));
    const code = gc.result.card.code;
    const cartId = await openCart();
    await lensRun("retail", "cart-add-line", { params: { cartId, sku: A, qty: 2 } }, ctx); // $20

    // Gift card can't overpay (no change from a gift card).
    assert.match(errOf(await lensRun("retail", "cart-tender", { params: { cartId, taxRate: 0, tenders: [{ kind: "gift_card", code, amount: 25 }] } }, ctx)), /non-cash/);
    // Unknown card refuses and the real card is untouched.
    assert.match(errOf(await lensRun("retail", "cart-tender", { params: { cartId, taxRate: 0, tenders: [{ kind: "gift_card", code: "NOPE", amount: 10 }, { kind: "cash", amount: 10 }] } }, ctx)), /not found/);
    let bal = await lensRun("retail", "gift-cards-balance", { params: { code } }, ctx);
    assert.equal(bal.result.balance, 15);

    const t = await lensRun("retail", "cart-tender", { params: { cartId, taxRate: 0, tenders: [{ kind: "gift_card", code, amount: 15 }, { kind: "cash", amount: 10 }] } }, ctx);
    assert.equal(t.ok, true, JSON.stringify(t));
    assert.equal(t.result.order.total, 20);
    assert.equal(t.result.order.change, 5);
    bal = await lensRun("retail", "gift-cards-balance", { params: { code } }, ctx);
    assert.equal(bal.result.balance, 0);
    assert.equal(bal.result.status, "redeemed");
  });
});
