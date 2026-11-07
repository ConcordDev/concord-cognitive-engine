// Close-out A12 — the bridge-actor guarantee (Message F1).
//
// (1) enrichActorIdentity: an actor the bridge constructs for a real account
//     gains that account's resolved identity from the users table; anonymous,
//     internal, unresolved, and already-identified actors pass through.
// (2) The message domain's stamps are actor-first: a client-passed
//     params.senderName is never the authority — an enriched actor's name is
//     the stamp even against a spoofed param, and with no client name the
//     stamp is the account's name, never the raw user id.
import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { lookupUserIdentity, enrichActorIdentity } from "../lib/user-identity.js";
import registerMessageActions from "../domains/message.js";

function usersDb({ withDisplayName = false } = {}) {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT${withDisplayName ? ", display_name TEXT" : ""})`);
  if (withDisplayName) {
    db.prepare("INSERT INTO users (id, username, display_name) VALUES (?, ?, ?)").run("user_a", "tester", "Test Person");
  } else {
    db.prepare("INSERT INTO users (id, username) VALUES (?, ?)").run("user_a", "tester");
  }
  return db;
}

describe("A12 — enrichActorIdentity", () => {
  it("a resolved actor gains displayName + username from the users row", () => {
    const db = usersDb({ withDisplayName: true });
    const actor = { userId: "user_a", orgId: "default", role: "member", scopes: ["read", "write"] };
    const out = enrichActorIdentity(db, actor);
    assert.equal(out.displayName, "Test Person");
    assert.equal(out.username, "tester");
    assert.equal(out.role, "member"); // the rest of the actor is untouched
  });

  it("without a display_name column the handle serves as the name", () => {
    const db = usersDb();
    const out = enrichActorIdentity(db, { userId: "user_a", role: "member" });
    assert.equal(out.displayName, "tester");
    assert.equal(out.username, "tester");
  });

  it("an unresolved id gains nothing — no name is invented from the id", () => {
    const db = usersDb({ withDisplayName: true });
    const actor = { userId: "ghost_id", role: "member" };
    const out = enrichActorIdentity(db, actor);
    assert.equal(out, actor); // same object back
    assert.equal(out.displayName, undefined);
  });

  it("anonymous and internal actors pass through untouched", () => {
    const db = usersDb({ withDisplayName: true });
    const anon = { userId: "anon", orgId: "public", role: "viewer" };
    assert.equal(enrichActorIdentity(db, anon), anon);
    const internal = { userId: "user_a", internal: true, role: "owner" };
    assert.equal(enrichActorIdentity(db, internal), internal);
  });

  it("an already-identified actor is not re-resolved", () => {
    const db = usersDb({ withDisplayName: true });
    const actor = { userId: "user_a", username: "tester", displayName: "Kept Name" };
    assert.equal(enrichActorIdentity(db, actor), actor);
  });

  it("no db — the actor passes through (resolution declines, never throws)", () => {
    const actor = { userId: "user_a", role: "member" };
    assert.equal(enrichActorIdentity(null, actor), actor);
    assert.deepEqual(lookupUserIdentity(null, "user_a"), { username: null, displayName: null });
  });
});

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`message.${name}`);
  if (!fn) throw new Error(`message.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerMessageActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

// The actor as the A12-enriched bridge now constructs it.
const enriched = { actor: { userId: "user_a", username: "tester", displayName: "Test Person" }, userId: "user_a" };

function sendAndRead(ctx, params) {
  const ch = call("channels-create", ctx, { name: "a12-room" });
  assert.equal(ch.ok, true);
  const channelId = ch.result.channel.id;
  const sent = call("messages-send", ctx, { channelId, body: "hello", ...params });
  assert.equal(sent.ok, true);
  const list = call("messages-list", ctx, { channelId });
  assert.equal(list.ok, true);
  return list.result.messages.at(-1);
}

describe("A12 — message stamps are actor-first", () => {
  it("a spoofed params.senderName never wins over the actor's name", () => {
    const msg = sendAndRead(enriched, { senderName: "Mallory" });
    assert.equal(msg.senderName, "Test Person");
    assert.equal(msg.senderId, "user_a");
  });

  it("with no client name the stamp is the account's name, never the raw id", () => {
    const msg = sendAndRead(enriched, {});
    assert.equal(msg.senderName, "Test Person");
  });

  it("an actor carrying only a username stamps the username", () => {
    const ctx = { actor: { userId: "user_a", username: "tester" }, userId: "user_a" };
    const msg = sendAndRead(ctx, { senderName: "Mallory" });
    assert.equal(msg.senderName, "tester");
  });

  it("replies stamp the actor's name the same way", () => {
    const ch = call("channels-create", enriched, { name: "a12-thread" });
    const channelId = ch.result.channel.id;
    const root = call("messages-send", enriched, { channelId, body: "root" });
    const reply = call("thread-reply", enriched, { channelId, rootId: root.result.message.id, body: "re", senderName: "Mallory" });
    assert.equal(reply.ok, true);
    assert.equal(reply.result.reply.senderName, "Test Person");
  });
});
