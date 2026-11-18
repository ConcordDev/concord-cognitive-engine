// tests/depth/retail-stall-behavior.test.js — "The Stall" register-floor
// features: custom price tags, product photos (owned image DTUs), the day
// board + daily goal, regulars (customer insights), till sessions with a
// minted ledger DTU, and milestone stamps. Behavioral (exact values) and
// adversarial (garbage numbers, foreign / wrong-type images, double close,
// cross-user isolation, injection-shaped text) in one file.
//
// lens.run wrapping (depth-harness convention): a handler's
// { ok:true, result:X } surfaces as r.ok===true + r.result===X; a refusal
// surfaces as r.ok===false with r.result.error.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { lensRun, depthCtx, load } from "./_harness.js";

const refused = (r) => r.ok === false || r.result?.ok === false;
const errOf = (r) => String(r.result?.error || r.error || "");
const DAY = 86400000;

async function freshShop(label) {
  const ctx = await depthCtx(`stall-${label}-${randomUUID()}`);
  const run = (action, params = {}) => lensRun("retail", action, { params }, ctx);
  return { ctx, run, userId: ctx.actor.userId };
}

async function sell(run, lines, tenders, extra = {}) {
  const cartId = (await run("cart-open")).result.cart.id;
  for (const [sku, qty] of lines) await run("cart-add-line", { cartId, sku, qty });
  return run("cart-tender", { cartId, taxRate: 0, tzOffsetMinutes: 0, tenders, ...extra });
}

describe("retail stall — custom price tag", () => {
  let shop;
  before(async () => { shop = await freshShop("custom"); });

  it("adds an open-price line that totals, tenders, and never touches stock", async () => {
    const cartId = (await shop.run("cart-open")).result.cart.id;
    const r = await shop.run("cart-add-custom-line", { cartId, name: "  Gift   wrap ", price: 3.5, qty: 2 });
    assert.equal(r.ok, true, JSON.stringify(r));
    const line = r.result.cart.lines[0];
    assert.equal(line.name, "Gift wrap");
    assert.equal(line.unitPrice, 3.5);
    assert.equal(line.custom, true);
    assert.match(line.sku, /^CUSTOM-/);
    const tot = await shop.run("cart-total", { cartId, taxRate: 0 });
    assert.equal(tot.result.total, 7);
    // qty edits work on a custom line and never raise a stock warning
    const up = await shop.run("cart-set-line-qty", { cartId, sku: line.sku, qty: 3 });
    assert.equal(up.ok, true);
    assert.equal(up.result.stockWarning, undefined);
    const t = await shop.run("cart-tender", { cartId, taxRate: 0, tenders: [{ kind: "cash", amount: 20 }] });
    assert.equal(t.result.order.total, 10.5);
    assert.equal(t.result.order.change, 9.5);
  });

  it("refuses garbage prices, quantities and names", async () => {
    const cartId = (await shop.run("cart-open")).result.cart.id;
    for (const price of [0, -1, "abc", "1e999", Infinity, 100001, true, null]) {
      assert.ok(refused(await shop.run("cart-add-custom-line", { cartId, name: "x", price })), `price ${String(price)}`);
    }
    for (const qty of [0, -2, 1.5, 10000, "two"]) {
      assert.ok(refused(await shop.run("cart-add-custom-line", { cartId, name: "x", price: 1, qty })), `qty ${String(qty)}`);
    }
    assert.ok(refused(await shop.run("cart-add-custom-line", { cartId, name: "   ", price: 1 })));
    assert.ok(refused(await shop.run("cart-add-custom-line", { cartId: "cart_nope", name: "x", price: 1 })));
    const cart = (await shop.run("cart-get", { cartId })).result.cart;
    assert.equal(cart.lines.length, 0, "no refused call wrote a line");
  });

  it("stores injection-shaped names as inert, capped, control-free text", async () => {
    const cartId = (await shop.run("cart-open")).result.cart.id;
    const evil = `<img src=x onerror=alert(1)>\u0000\u0007${"A".repeat(200)}`;
    const r = await shop.run("cart-add-custom-line", { cartId, name: evil, price: 1 });
    const name = r.result.cart.lines[0].name;
    assert.ok(name.length <= 60);
    assert.doesNotMatch(name, /[\u0000-\u001f]/);
    assert.ok(name.startsWith("<img src=x"), "stored verbatim as text; the client renders it as text");
  });
});

describe("retail stall — product photo is an owned image DTU", () => {
  let shop, STATE, other;
  const sku = `PH-${randomUUID().slice(0, 6)}`;
  const putDtu = (id, ownerId, type, sizeBytes) => STATE.dtus.set(id, { id, ownerId, artifact: { type, sizeBytes } });

  before(async () => {
    ({ STATE } = await load());
    shop = await freshShop("photo");
    other = await freshShop("photo-other");
    await shop.run("product-upsert", { sku, name: "Jam", price: 6, stock: 4 });
  });

  it("links the caller's own PNG/JPEG/WebP and the link survives a re-save", async () => {
    const id = `art_${randomUUID()}`;
    putDtu(id, shop.userId, "image/webp", 2048);
    const r = await shop.run("product-set-image", { sku, dtuId: id });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.result.product.imageDtuId, id);
    await shop.run("product-upsert", { sku, name: "Jam (rhubarb)", price: 6.5, stock: 4 });
    const list = await shop.run("product-list");
    assert.equal(list.result.products.find((p) => p.sku === sku).imageDtuId, id);
    const clear = await shop.run("product-set-image", { sku, dtuId: null });
    assert.equal(clear.result.product.imageDtuId, undefined);
  });

  it("refuses someone else's image, SVG, non-images, oversized files and missing DTUs", async () => {
    const foreign = `art_${randomUUID()}`; putDtu(foreign, other.userId, "image/png", 100);
    const svg = `art_${randomUUID()}`; putDtu(svg, shop.userId, "image/svg+xml", 100);
    const pdf = `art_${randomUUID()}`; putDtu(pdf, shop.userId, "application/pdf", 100);
    const huge = `art_${randomUUID()}`; putDtu(huge, shop.userId, "image/png", 6 * 1024 * 1024);
    const empty = `art_${randomUUID()}`; putDtu(empty, shop.userId, "image/png", 0);
    assert.match(errOf(await shop.run("product-set-image", { sku, dtuId: foreign })), /your own/);
    assert.match(errOf(await shop.run("product-set-image", { sku, dtuId: svg })), /PNG, JPEG or WebP/);
    assert.match(errOf(await shop.run("product-set-image", { sku, dtuId: pdf })), /PNG, JPEG or WebP/);
    assert.match(errOf(await shop.run("product-set-image", { sku, dtuId: huge })), /5 MB/);
    assert.match(errOf(await shop.run("product-set-image", { sku, dtuId: empty })), /5 MB/);
    assert.match(errOf(await shop.run("product-set-image", { sku, dtuId: "art_missing" })), /not found/);
    assert.match(errOf(await other.run("product-set-image", { sku, dtuId: foreign })), /product not found/, "another shop can't touch this product");
  });
});

describe("retail stall — day board + daily goal", () => {
  let shop, STATE;
  const sku = `DB-${randomUUID().slice(0, 6)}`;
  before(async () => {
    ({ STATE } = await load());
    shop = await freshShop("dayboard");
    await shop.run("product-upsert", { sku, name: "Bread", price: 5, stock: 100 });
  });

  it("buckets by local hour, compares to yesterday at the same time, and tracks the goal", async () => {
    await shop.run("goal-set", { amount: 40 });
    const a = await sell(shop.run, [[sku, 2]], [{ kind: "cash", amount: 10 }]); // $10 today
    const b = await sell(shop.run, [[sku, 4]], [{ kind: "cash", amount: 20 }]); // $20 today
    const c = await sell(shop.run, [[sku, 1]], [{ kind: "cash", amount: 5 }]);  // → yesterday, earlier hour
    const d = await sell(shop.run, [[sku, 3]], [{ kind: "cash", amount: 15 }]); // → yesterday, later than now
    const orders = STATE.retailLens.orders.get(shop.userId);
    const now = Date.now();
    orders.find((o) => o.id === c.result.order.id).completedAt = new Date(now - DAY - 60000).toISOString();
    // "yesterday, later in the day than now" — kept inside yesterday even
    // when the suite runs in the last minutes before UTC midnight.
    const msToMidnight = Date.parse(new Date(now).toISOString().slice(0, 10) + "T00:00:00Z") + DAY - now;
    const later = Math.max(1000, Math.min(3600000, msToMidnight - 1000));
    orders.find((o) => o.id === d.result.order.id).completedAt = new Date(now - DAY + later).toISOString();
    const r = await shop.run("analytics-hourly", { tzOffsetMinutes: 0 });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.result.todayTotal, 30);
    assert.equal(r.result.todayOrders, 2);
    assert.equal(r.result.today[new Date(now).getUTCHours()].revenue, 30);
    assert.equal(r.result.yesterdayTotal, 20, "both backdated orders are yesterday's");
    assert.equal(r.result.yesterdaySameTime, 5, "only yesterday's sales up to this time of day");
    assert.equal(r.result.goal, 40);
    assert.equal(r.result.goalProgress, 0.75);
    assert.ok(a.ok && b.ok);
  });

  it("tz offset moves the day boundary", async () => {
    const utc = await shop.run("analytics-hourly", { tzOffsetMinutes: 0 });
    const tokyo = await shop.run("analytics-hourly", { tzOffsetMinutes: -540 });
    assert.equal(tokyo.result.currentHour, (utc.result.currentHour + 9) % 24);
  });

  it("refuses garbage tz offsets and goals; goal 0 clears it", async () => {
    for (const tz of [900, -900, 1.5, "abc", "1e999"]) assert.ok(refused(await shop.run("analytics-hourly", { tzOffsetMinutes: tz })), `tz ${tz}`);
    for (const amount of [-1, "1e999", "lots", 10000001, true]) assert.ok(refused(await shop.run("goal-set", { amount })), `goal ${String(amount)}`);
    await shop.run("goal-set", { amount: 0 });
    const r = await shop.run("analytics-hourly", {});
    assert.equal(r.result.goal, 0);
    assert.equal(r.result.goalProgress, null);
  });
});

describe("retail stall — regulars (customer insights from real orders)", () => {
  let shop;
  const A = `RG-${randomUUID().slice(0, 5)}`, B = `RG-${randomUUID().slice(0, 5)}`;
  before(async () => {
    shop = await freshShop("regulars");
    await shop.run("product-upsert", { sku: A, name: "Tea", price: 4, stock: 100 });
    await shop.run("product-upsert", { sku: B, name: "Scone", price: 3, stock: 100 });
  });

  it("visits, spend net of refunds, average, favorite and recency come from the customer's orders", async () => {
    const customerId = (await shop.run("customers-add", { name: "Ada", email: `ada-${randomUUID().slice(0, 5)}@ex.com` })).result.customer.id;
    const buy = async (lines, amount) => {
      const cartId = (await shop.run("cart-open")).result.cart.id;
      for (const [sku, qty] of lines) await shop.run("cart-add-line", { cartId, sku, qty });
      await shop.run("cart-set-customer", { cartId, customerId });
      return shop.run("cart-tender", { cartId, taxRate: 0, tenders: [{ kind: "cash", amount }] });
    };
    await buy([[A, 2], [B, 1]], 11);           // $11
    const second = await buy([[A, 1]], 4);     // $4
    await buy([[B, 1]], 3);                    // $3
    await shop.run("refunds-create", { orderId: second.result.order.id, amount: 4, reason: "other", restock: false });
    await sell(shop.run, [[B, 5]], [{ kind: "cash", amount: 15 }]); // a walk-in: not Ada's
    const r = await shop.run("customer-insights", { customerId });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.result.visits, 3);
    assert.equal(r.result.totalSpent, 14);       // 11 + 4 + 3 − 4 refunded
    assert.equal(r.result.avgOrder, 4.67);
    assert.equal(r.result.favorite.sku, A);       // Tea ×3 beats Scone ×2
    assert.equal(r.result.favorite.qty, 3);
    assert.equal(r.result.daysSinceLastVisit, 0);
  });

  it("a brand-new customer has honest empty insights; unknown ids refuse", async () => {
    const customerId = (await shop.run("customers-add", { name: "New", email: `new-${randomUUID().slice(0, 5)}@ex.com` })).result.customer.id;
    const r = await shop.run("customer-insights", { customerId });
    assert.equal(r.result.visits, 0);
    assert.equal(r.result.favorite, null);
    assert.equal(r.result.lastVisitAt, null);
    assert.ok(refused(await shop.run("customer-insights", { customerId: "cust_nope" })));
    const stranger = await freshShop("regulars-stranger");
    assert.ok(refused(await stranger.run("customer-insights", { customerId })), "another shop can't read this customer");
  });
});

describe("retail stall — till sessions", () => {
  let shop, STATE;
  const sku = `TL-${randomUUID().slice(0, 6)}`;
  before(async () => {
    ({ STATE } = await load());
    shop = await freshShop("till");
    await shop.run("product-upsert", { sku, name: "Candle", price: 10, stock: 100 });
    await sell(shop.run, [[sku, 1]], [{ kind: "cash", amount: 10 }]); // before the till opens: not counted
  });

  it("expected drawer = float + cash in − change, over the session's orders only; close mints the ledger DTU", async () => {
    const open = await shop.run("till-open", { float: 100 });
    assert.equal(open.ok, true, JSON.stringify(open));
    assert.match(errOf(await shop.run("till-open", { float: 50 })), /already open/);
    const s1 = await sell(shop.run, [[sku, 2]], [{ kind: "cash", amount: 50 }]); // $20, change $30
    assert.equal(s1.result.order.tillSessionId, open.result.session.id);
    const gc = (await shop.run("gift-cards-create", { initialValue: 5 })).result.card.code;
    await sell(shop.run, [[sku, 1]], [{ kind: "gift_card", code: gc, amount: 5 }, { kind: "cash", amount: 5 }]); // $10
    const status = await shop.run("till-status");
    assert.equal(status.result.open, true);
    assert.deepEqual(
      { ...status.result.figures },
      { orderCount: 2, grossSales: 30, cashIn: 55, changeGiven: 30, cashSales: 25, cardSales: 0, giftCardSales: 5, otherSales: 0, refundsOnSessionOrders: 0, expectedCash: 125 },
    );
    const close = await shop.run("till-close", { countedCash: 122.5, note: "Tuesday" });
    assert.equal(close.ok, true, JSON.stringify(close));
    const sess = close.result.session;
    assert.equal(sess.status, "closed");
    assert.equal(sess.variance, -2.5);
    assert.equal(sess.figures.expectedCash, 125);
    assert.ok(sess.ledgerDtuId, `ledger minted (${sess.ledgerMintError || ""})`);
    const dtu = STATE.dtus.get(sess.ledgerDtuId);
    assert.ok(dtu, "ledger DTU exists");
    assert.ok(JSON.stringify(dtu).includes("short by $2.50"));
    const hist = await shop.run("till-history");
    assert.equal(hist.result.sessions[0].id, sess.id);
    const after = await sell(shop.run, [[sku, 1]], [{ kind: "cash", amount: 10 }]);
    assert.equal(after.result.order.tillSessionId, undefined, "a sale after close is not tagged to the closed session");
  });

  it("can't close twice or close a till that was never opened; garbage amounts refuse", async () => {
    assert.match(errOf(await shop.run("till-close", { countedCash: 1 })), /not open/);
    for (const v of [-1, "1e999", "abc", 1000001, true]) assert.ok(refused(await shop.run("till-open", { float: v })), `float ${String(v)}`);
    await shop.run("till-open", { float: 0 });
    for (const v of [-1, "1e999", "abc", null, 1000001]) assert.ok(refused(await shop.run("till-close", { countedCash: v })), `counted ${String(v)}`);
    assert.equal((await shop.run("till-status")).result.open, true, "a refused close leaves the till open");
    const other = await freshShop("till-other");
    assert.equal((await other.run("till-status")).result.open, false, "tills are per shop");
    assert.match(errOf(await other.run("till-close", { countedCash: 0 })), /not open/);
    await shop.run("till-close", { countedCash: 0 });
  });
});

describe("retail stall — milestone stamps", () => {
  let shop, STATE;
  const sku = `ST-${randomUUID().slice(0, 6)}`;
  before(async () => {
    ({ STATE } = await load());
    shop = await freshShop("stamps");
    await shop.run("product-upsert", { sku, name: "Honey", price: 10, stock: 1000 });
  });
  const ids = (r) => (r.result.order.stamps || []).map((x) => x.id).sort();

  it("first sale, then goal hit exactly when today's sales cross the goal", async () => {
    const first = await sell(shop.run, [[sku, 1]], [{ kind: "cash", amount: 10 }]);
    assert.deepEqual(ids(first), ["first_sale"]);
    await shop.run("goal-set", { amount: 25 });
    assert.deepEqual(ids(await sell(shop.run, [[sku, 1]], [{ kind: "cash", amount: 10 }])), []);        // $20
    assert.deepEqual(ids(await sell(shop.run, [[sku, 1]], [{ kind: "cash", amount: 10 }])), ["goal_hit"]); // $30 ≥ 25
    assert.deepEqual(ids(await sell(shop.run, [[sku, 1]], [{ kind: "cash", amount: 10 }])), [], "goal only stamps once");
  });

  it("a 3-day streak stamps on the day's first sale; best day stamps when today passes the record", async () => {
    const s2 = await freshShop("stamps-streak");
    await s2.run("product-upsert", { sku, name: "Honey", price: 10, stock: 1000 });
    const back = async (days, qty) => {
      const r = await sell(s2.run, [[sku, qty]], [{ kind: "cash", amount: qty * 10 }]);
      STATE.retailLens.orders.get(s2.userId).find((o) => o.id === r.result.order.id).completedAt = new Date(Date.now() - days * DAY).toISOString();
    };
    await back(2, 3); // $30 two days ago
    await back(1, 2); // $20 yesterday
    const t1 = await sell(s2.run, [[sku, 1]], [{ kind: "cash", amount: 10 }]); // today $10
    assert.deepEqual(ids(t1), ["streak"]);
    assert.equal(t1.result.order.stamps.find((x) => x.id === "streak").label, "3-day streak");
    assert.deepEqual(ids(await sell(s2.run, [[sku, 1]], [{ kind: "cash", amount: 10 }])), [], "$20: not past the $30 record");
    assert.deepEqual(ids(await sell(s2.run, [[sku, 2]], [{ kind: "cash", amount: 20 }])), ["best_day"], "$40 passes $30");
    assert.deepEqual(ids(await sell(s2.run, [[sku, 1]], [{ kind: "cash", amount: 10 }])), [], "best day stamps once");
  });

  it("every 100th order is stamped", async () => {
    const s3 = await freshShop("stamps-100");
    await s3.run("product-upsert", { sku, name: "Honey", price: 1, stock: 1000 });
    const orders = STATE.retailLens.orders;
    // 99 prior orders, recorded through the real path once, then cloned in
    // the ledger to keep the test fast — the stamp reads the ledger count.
    const seed = await sell(s3.run, [[sku, 1]], [{ kind: "cash", amount: 1 }]);
    const list = orders.get(s3.userId);
    for (let i = 0; i < 98; i++) list.push({ ...seed.result.order, id: `ord_seed_${i}` });
    const hundredth = await sell(s3.run, [[sku, 1]], [{ kind: "cash", amount: 1 }]);
    assert.ok(ids(hundredth).includes("order_milestone"));
    assert.equal(hundredth.result.order.stamps.find((x) => x.id === "order_milestone").label, "100th order");
  });
});
