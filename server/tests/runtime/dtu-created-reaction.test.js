// tests/runtime/dtu-created-reaction.test.js
//
// Pins the platform-wide half of lib/runtime/reactions.js: dtu.created ->
// notify the creator's followers. Exercises the reactor directly against
// the real emergent/social-layer.js substrate (follow + notify), the same
// way tests/runtime/craft-reaction-chain.test.js exercises the crafting
// half end-to-end. The server.js bridge itself (ConcordEventBus's real
// dtu.created -> this bus) is a thin, one-line-per-event mirror checked
// separately by tests/runtime/dtu-eventbus-bridge.test.js against the
// actual server.js source, since booting the full server per-test here
// would be disproportionate to what's being pinned.
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { publish, _reset as _resetBus } from "../../lib/runtime/event-bus.js";
import { initReactions, _resetReactions } from "../../lib/runtime/reactions.js";
import { followUser, getNotifications, upsertProfile } from "../../emergent/social-layer.js";

beforeEach(() => {
  _resetBus();
  _resetReactions();
  delete globalThis.STATE;
});
afterEach(() => {
  _resetReactions();
  delete globalThis.STATE;
});

describe("dtu.created -> follower notification, platform-wide (not Concordia-specific)", () => {
  it("a follower of the creator gets a real notification naming the DTU", () => {
    globalThis.STATE = {};
    initReactions();
    upsertProfile(globalThis.STATE, "follower_1", {});
    upsertProfile(globalThis.STATE, "creator_1", {});
    followUser(globalThis.STATE, "follower_1", "creator_1");

    publish("dtu.created", { id: "dtu_1", title: "A Field Guide to Rust", domain: "science", creatorId: "creator_1" });

    const { notifications, total } = getNotifications(globalThis.STATE, "follower_1");
    assert.equal(total, 1);
    assert.equal(notifications[0].type, "dtu_created");
    assert.equal(notifications[0].fromUserId, "creator_1");
    assert.match(notifications[0].content, /A Field Guide to Rust/);
  });

  it("notifies EVERY follower, not just the first", () => {
    globalThis.STATE = {};
    initReactions();
    for (const u of ["follower_a", "follower_b", "follower_c", "creator_1"]) upsertProfile(globalThis.STATE, u, {});
    followUser(globalThis.STATE, "follower_a", "creator_1");
    followUser(globalThis.STATE, "follower_b", "creator_1");
    followUser(globalThis.STATE, "follower_c", "creator_1");

    publish("dtu.created", { id: "dtu_1", title: "Test DTU", creatorId: "creator_1" });

    for (const u of ["follower_a", "follower_b", "follower_c"]) {
      assert.equal(getNotifications(globalThis.STATE, u).total, 1, `${u} should have been notified`);
    }
  });

  it("falls back to a domain-flavored label when the DTU has no title", () => {
    globalThis.STATE = {};
    initReactions();
    upsertProfile(globalThis.STATE, "follower_1", {});
    upsertProfile(globalThis.STATE, "creator_1", {});
    followUser(globalThis.STATE, "follower_1", "creator_1");

    publish("dtu.created", { id: "dtu_1", domain: "music", creatorId: "creator_1" });

    const { notifications } = getNotifications(globalThis.STATE, "follower_1");
    assert.match(notifications[0].content, /a new music item/);
  });

  it("a creator with zero followers produces zero notifications — real no-op, not an error", () => {
    globalThis.STATE = {};
    initReactions();
    // deliberately no followUser() call

    assert.doesNotThrow(() => publish("dtu.created", { id: "dtu_1", title: "Lonely DTU", creatorId: "creator_nobody_follows" }));
  });

  it("a payload missing id or creatorId is an honest no-op, never a fabricated notification", () => {
    globalThis.STATE = {};
    initReactions();
    upsertProfile(globalThis.STATE, "follower_1", {});
    upsertProfile(globalThis.STATE, "creator_1", {});
    followUser(globalThis.STATE, "follower_1", "creator_1");

    publish("dtu.created", { title: "No id or creator" }); // missing both id and creatorId

    assert.equal(getNotifications(globalThis.STATE, "follower_1").total, 0);
  });

  it("no STATE yet -> honest no-op, never throws", () => {
    initReactions();
    // globalThis.STATE deliberately left unset
    assert.doesNotThrow(() => publish("dtu.created", { id: "dtu_1", title: "X", creatorId: "creator_1" }));
  });

  it("crafting and DTU-follower reactors coexist without interfering with each other", () => {
    globalThis.STATE = {};
    initReactions();
    upsertProfile(globalThis.STATE, "follower_1", {});
    upsertProfile(globalThis.STATE, "crafter_1", {});
    followUser(globalThis.STATE, "follower_1", "crafter_1");

    publish("item.crafted", { userId: "crafter_1", dtuId: "d1", itemName: "Iron Sword", qualityMultiplier: 1.0, failed: false });
    publish("dtu.created", { id: "d1", title: "Iron Sword", creatorId: "crafter_1" });

    // crafter gets their own craft notification; follower gets the DTU one — no cross-talk
    assert.equal(getNotifications(globalThis.STATE, "crafter_1").total, 1);
    assert.equal(getNotifications(globalThis.STATE, "crafter_1").notifications[0].type, "item_crafted");
    assert.equal(getNotifications(globalThis.STATE, "follower_1").total, 1);
    assert.equal(getNotifications(globalThis.STATE, "follower_1").notifications[0].type, "dtu_created");
  });
});
