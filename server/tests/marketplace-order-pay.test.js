// A storefront checkout takes no money. Paying it is a real marketplace
// ledger purchase. A second click, a short balance, or a missing ledger
// must not say the order was paid.

import { it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import registerMarketplaceActions from "../domains/marketplace.js";
import { executePurchase } from "../economy/transfer.js";
import { getBalance } from "../economy/balances.js";
import { serializeLensState, hydrateLensState } from "../lib/lens-state-persistence.js";

const H = new Map();
registerMarketplaceActions((_d, n, fn) => H.set(n, fn));
const call = (n, ctx, p = {}) => H.get(n)(ctx, { id: null, data: {}, meta: {} }, p);
const seller = { actor: { userId: "s1" }, userId: "s1" };
const buyer = { actor: { userId: "b1" }, userId: "b1" };
const r2 = (n) => Math.round(n * 100) / 100;

function ledgerDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE economy_ledger (
      id TEXT PRIMARY KEY, type TEXT NOT NULL, from_user_id TEXT, to_user_id TEXT,
      amount REAL NOT NULL, fee REAL NOT NULL DEFAULT 0, net REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'complete', metadata_json TEXT DEFAULT '{}',
      request_id TEXT, ip TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), ref_id TEXT);
  `);
  return db;
}

beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

function placeOrder() {
  call("shop-get", seller);
  const id = call("listings-create", seller, { title: "Mug", priceUsd: 20, kind: "physical_good", stockQty: 3 }).result.listing.id;
  call("listings-publish", seller, { id });
  assert.equal(call("cart-add", buyer, { sellerId: "s1", listingId: id, qty: 1 }).ok, true);
  const co = call("checkout-create", buyer, { buyerName: "Bo" });
  assert.equal(co.ok, true);
  return co.result.checkout.orders[0].orderId;
}

const sellerOrder = (id) => call("orders-list", seller, {}).result.orders.find((o) => o.id === id);
const buyerOrder = (id) => call("orders-for-buyer", buyer, {}).result.orders.find((o) => o.id === id);

it("refuses to say paid when the ledger is missing or the balance is short", () => {
  const id = placeOrder();
  const missing = call("orders-pay", buyer, { id });
  assert.equal(missing.ok, false);
  assert.equal(missing.error, "ledger_unavailable");
  assert.equal(sellerOrder(id).status, "pending");
  assert.equal(sellerOrder(id).paymentStatus, "awaiting_payment");
  assert.equal(sellerOrder(id).batchId, undefined);

  const empty = ledgerDb();
  const broke = call("orders-pay", { ...buyer, db: empty }, { id });
  assert.equal(broke.ok, false);
  assert.equal(broke.error, "insufficient_balance");
  assert.equal(sellerOrder(id).status, "pending");
});

it("pays the sticker as Concord Coin once, then the same order survives a snapshot", () => {
  const id = placeOrder();
  const db = ledgerDb();
  executePurchase(db, { userId: "b1", amount: 100 });
  const before = getBalance(db, "b1").balance;
  const paid = call("orders-pay", { ...buyer, db }, { id });
  assert.equal(paid.ok, true);
  assert.equal(paid.result.order.status, "paid");
  assert.equal(paid.result.order.paymentStatus, "settled");
  assert.equal(paid.result.order.paidCc, 20);
  assert.ok(paid.result.order.batchId);
  assert.match(paid.result.paidSentence, /^Paid 20\.00 CC\. Ledger /);
  assert.match(paid.result.paidSentence, /No card was charged\.$/);
  assert.equal(r2(before - getBalance(db, "b1").balance), 20);
  assert.ok(getBalance(db, "s1").balance > 0);
  assert.ok(getBalance(db, "s1").balance < 20);

  const again = call("orders-pay", { ...buyer, db }, { id });
  assert.equal(again.ok, true);
  assert.equal(again.result.idempotent, true);
  assert.equal(again.result.order.batchId, paid.result.order.batchId);
  assert.equal(r2(getBalance(db, "b1").balance), r2(before - 20));

  assert.equal(call("orders-pay", seller, { id }).ok, false);
  assert.equal(buyerOrder(id).batchId, paid.result.order.batchId);

  const persisted = serializeLensState(globalThis._concordSTATE);
  globalThis._concordSTATE = { dtus: new Map() };
  hydrateLensState(globalThis._concordSTATE, persisted);
  const reloaded = call("orders-for-buyer", buyer, {}).result.orders.find((o) => o.id === id);
  assert.equal(reloaded.status, "paid");
  assert.equal(reloaded.batchId, paid.result.order.batchId);
  assert.equal(reloaded.paidCc, 20);
});

it("does not let a seller pay their own checkout", () => {
  call("shop-get", seller);
  const listingId = call("listings-create", seller, { title: "Self", priceUsd: 5, kind: "digital_download" }).result.listing.id;
  call("listings-publish", seller, { id: listingId });
  call("cart-add", seller, { sellerId: "s1", listingId, qty: 1 });
  const id = call("checkout-create", seller, { buyerName: "Seller" }).result.checkout.orders[0].orderId;
  const db = ledgerDb();
  executePurchase(db, { userId: "s1", amount: 50 });
  const before = getBalance(db, "s1").balance;
  const refused = call("orders-pay", { ...seller, db }, { id });
  assert.equal(refused.ok, false);
  assert.equal(refused.error, "you cannot pay your own shop");
  assert.equal(getBalance(db, "s1").balance, before);
  assert.equal(call("orders-list", seller, {}).result.orders.find((o) => o.id === id).status, "pending");
});
