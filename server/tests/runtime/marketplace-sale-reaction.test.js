// tests/runtime/marketplace-sale-reaction.test.js
//
// Pins the third reactor in lib/runtime/reactions.js: marketplace.purchased
// -> a PERSISTENT seller notification, complementing (not replacing) the
// real-time-only socket toast server.js's marketplace.purchaseWithRoyalties
// macro already sends. The gap this closes: that macro's existing
// `REALTIME.io.to(user:<seller>).emit("marketplace:sale", ...)` reaches
// nobody if the seller isn't connected at that exact moment — no
// persistence, no reconnect replay. This reactor is the durable half.
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { publish, _reset as _resetBus } from "../../lib/runtime/event-bus.js";
import { initReactions, _resetReactions } from "../../lib/runtime/reactions.js";
import { getNotifications } from "../../emergent/social-layer.js";

beforeEach(() => {
  _resetBus();
  _resetReactions();
  delete globalThis.STATE;
});
afterEach(() => {
  _resetReactions();
  delete globalThis.STATE;
});

describe("marketplace.purchased -> durable seller notification", () => {
  it("the seller gets a persistent notification naming the item and price", () => {
    globalThis.STATE = {};
    initReactions();

    publish("marketplace.purchased", { dtuId: "d1", buyerId: "buyer_1", sellerId: "seller_1", price: 12.5, title: "Iron Sword" });

    const { notifications, total } = getNotifications(globalThis.STATE, "seller_1");
    assert.equal(total, 1);
    assert.equal(notifications[0].type, "marketplace_sale");
    assert.match(notifications[0].content, /Iron Sword/);
    assert.match(notifications[0].content, /\$12\.50/);
    assert.equal(notifications[0].postId, "d1");
  });

  it("falls back to a generic label when the DTU has no title", () => {
    globalThis.STATE = {};
    initReactions();
    publish("marketplace.purchased", { dtuId: "d1", sellerId: "seller_1", price: 5 });
    const { notifications } = getNotifications(globalThis.STATE, "seller_1");
    assert.match(notifications[0].content, /your item/);
  });

  it("no sellerId or no STATE -> honest no-op, never throws", () => {
    initReactions();
    assert.doesNotThrow(() => publish("marketplace.purchased", { dtuId: "d1", price: 5 })); // no sellerId, no STATE
    globalThis.STATE = {};
    assert.doesNotThrow(() => publish("marketplace.purchased", { dtuId: "d1", price: 5 })); // still no sellerId
    assert.equal(getNotifications(globalThis.STATE, "seller_1").total, 0);
  });

  it("all three reactors (craft, DTU-follow, marketplace) coexist independently", () => {
    globalThis.STATE = {};
    initReactions();

    publish("item.crafted", { userId: "u1", dtuId: "d1", itemName: "Sword", qualityMultiplier: 1, failed: false });
    publish("marketplace.purchased", { dtuId: "d1", sellerId: "u1", price: 10, title: "Sword" });

    // Same user, two different reaction types, no cross-talk or overwrite.
    const { notifications, total } = getNotifications(globalThis.STATE, "u1");
    assert.equal(total, 2);
    const types = notifications.map((n) => n.type).sort();
    assert.deepEqual(types, ["item_crafted", "marketplace_sale"]);
  });
});
