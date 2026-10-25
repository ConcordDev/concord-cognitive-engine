/**
 * world-chat contract test — the game clients' chat:send (Aura REQ-1).
 *
 * say  → proximity-chat's real distance gate from the sender's tracked position
 * tell → one live, visible addressee by userId or username
 * party → the sender's party members (lib/parties.js)
 *
 * Run: node --test tests/world-chat.test.js
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { configurePresence, updateUserPosition, setUserVisibility, removeUser } from "../lib/city-presence.js";
import { _resetRateLimitState } from "../lib/proximity-chat.js";
import { routeWorldChat, _resetWorldChatRateLimit, WORLD_CHAT_CHANNELS } from "../lib/world-chat.js";

const USERS = ["wc_alice", "wc_bob", "wc_carl", "wc_dana"];
let db;

beforeEach(() => {
  configurePresence({ db: null, fireTrigger: null });
  _resetRateLimitState();
  _resetWorldChatRateLimit();
  for (const uid of USERS) { try { removeUser(uid); } catch { /* absent */ } }
  db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT);
    CREATE TABLE parties (id TEXT PRIMARY KEY, leader_id TEXT NOT NULL, name TEXT,
      max_size INTEGER NOT NULL DEFAULT 8, privacy TEXT NOT NULL DEFAULT 'invite_only',
      party_type TEXT NOT NULL DEFAULT 'normal', created_at INTEGER, disbanded_at INTEGER);
    CREATE TABLE party_members (party_id TEXT NOT NULL, user_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member', joined_at INTEGER, PRIMARY KEY (party_id, user_id));
  `);
  for (const u of USERS) db.prepare("INSERT INTO users (id, username) VALUES (?, ?)").run(u, u.replace("wc_", ""));
});

describe("routeWorldChat", () => {
  it("exposes exactly say / tell / party", () => {
    assert.deepEqual([...WORLD_CHAT_CHANNELS], ["say", "tell", "party"]);
  });

  it("say reaches a player 10 m away and not one 500 m away", () => {
    updateUserPosition("wc_alice", { cityId: "c1", x: 0, y: 0, z: 0 });
    updateUserPosition("wc_bob", { cityId: "c1", x: 10, y: 0, z: 0 });
    updateUserPosition("wc_carl", { cityId: "c1", x: 500, y: 0, z: 0 });
    const r = routeWorldChat(db, { senderId: "wc_alice", senderName: "alice", text: " hello ", channel: "say" });
    assert.equal(r.ok, true);
    assert.deepEqual(r.recipients, ["wc_bob"]);
    assert.equal(r.message.text, "hello");
    assert.equal(r.message.from, "wc_alice");
    assert.equal(r.message.fromName, "alice");
    assert.equal(r.message.channel, "say");
    assert.equal(r.message.radiusM, 40);
    assert.ok(r.proximity, "say carries proximity-chat's own message for browser delivery");
    assert.equal(r.proximity.body, "hello");
  });

  it("say defaults to the say channel and refuses without live presence", () => {
    const r = routeWorldChat(db, { senderId: "wc_alice", text: "hi" });
    assert.deepEqual(r, { ok: false, reason: "no_live_presence" });
  });

  it("refuses an unknown channel and an empty or overlong body", () => {
    updateUserPosition("wc_alice", { cityId: "c1", x: 0, y: 0, z: 0 });
    assert.equal(routeWorldChat(db, { senderId: "wc_alice", text: "x", channel: "shout" }).reason, "unknown_channel");
    assert.equal(routeWorldChat(db, { senderId: "wc_alice", text: "  ", channel: "say" }).reason, "empty_body");
    assert.equal(routeWorldChat(db, { senderId: "wc_alice", text: "y".repeat(281), channel: "tell", to: "wc_bob" }).reason, "body_too_long");
  });

  it("tell reaches one addressee by id or by username, at any distance", () => {
    updateUserPosition("wc_alice", { cityId: "c1", x: 0, y: 0, z: 0 });
    updateUserPosition("wc_bob", { cityId: "c9", x: 9000, y: 0, z: 0 });
    const byId = routeWorldChat(db, { senderId: "wc_alice", text: "psst", channel: "tell", to: "wc_bob" });
    assert.equal(byId.ok, true);
    assert.deepEqual(byId.recipients, ["wc_bob"]);
    assert.equal(byId.message.to, "wc_bob");
    const byName = routeWorldChat(db, { senderId: "wc_alice", text: "psst", channel: "tell", to: "BOB" });
    assert.deepEqual(byName.recipients, ["wc_bob"]);
  });

  it("tell refuses no addressee, self, offline, and hidden addressees alike", () => {
    updateUserPosition("wc_alice", { cityId: "c1", x: 0, y: 0, z: 0 });
    assert.equal(routeWorldChat(db, { senderId: "wc_alice", text: "a", channel: "tell" }).reason, "no_addressee");
    assert.equal(routeWorldChat(db, { senderId: "wc_alice", text: "a", channel: "tell", to: "wc_alice" }).reason, "cannot_tell_self");
    assert.equal(routeWorldChat(db, { senderId: "wc_alice", text: "a", channel: "tell", to: "wc_carl" }).reason, "addressee_offline");
    updateUserPosition("wc_dana", { cityId: "c1", x: 1, y: 0, z: 0 });
    setUserVisibility("wc_dana", "hidden");
    assert.equal(routeWorldChat(db, { senderId: "wc_alice", text: "a", channel: "tell", to: "wc_dana" }).reason, "addressee_offline",
      "a hidden player must look exactly like an offline one");
  });

  it("party reaches the other members and refuses outside a party", () => {
    assert.equal(routeWorldChat(db, { senderId: "wc_alice", text: "a", channel: "party" }).reason, "not_in_party");
    db.prepare("INSERT INTO parties (id, leader_id) VALUES ('p1', 'wc_alice')").run();
    for (const u of ["wc_alice", "wc_bob", "wc_carl"]) {
      db.prepare("INSERT INTO party_members (party_id, user_id, joined_at) VALUES ('p1', ?, 1)").run(u);
    }
    const r = routeWorldChat(db, { senderId: "wc_alice", text: "regroup", channel: "party" });
    assert.equal(r.ok, true);
    assert.deepEqual(r.recipients.sort(), ["wc_bob", "wc_carl"]);
    assert.equal(r.message.channel, "party");
  });

  it("tell/party are rate limited at 20 a minute", () => {
    updateUserPosition("wc_alice", { cityId: "c1", x: 0, y: 0, z: 0 });
    updateUserPosition("wc_bob", { cityId: "c1", x: 1, y: 0, z: 0 });
    for (let i = 0; i < 20; i++) {
      assert.equal(routeWorldChat(db, { senderId: "wc_alice", text: `m${i}`, channel: "tell", to: "wc_bob" }).ok, true);
    }
    assert.equal(routeWorldChat(db, { senderId: "wc_alice", text: "m21", channel: "tell", to: "wc_bob" }).reason, "rate_limited");
  });
});
