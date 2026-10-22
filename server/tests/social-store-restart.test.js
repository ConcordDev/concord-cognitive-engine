import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { up } from "../migrations/482_social_canonical_store.js";
import {
  upsertProfile, followUser, createPost, sendMessage, getNotifications, getFollowing, getUserPosts, canonicalSocial,
} from "../emergent/social-layer.js";
import { flushSocialStore, forgetSocialMemory } from "../lib/social-persist.js";
import registerSocialActions from "../domains/social.js";

function fresh() {
  const db = new Database(":memory:");
  up(db);
  const STATE = { db, dtus: new Map() };
  globalThis._concordSTATE = STATE;
  globalThis._concordSaveStateDebounced = () => {};
  return STATE;
}

describe("canonical social store survives a restart", () => {
  beforeEach(() => { fresh(); });

  it("keeps a follow, a post, a DM and a notification", () => {
    const STATE = globalThis._concordSTATE;
    upsertProfile(STATE, "ana", { displayName: "Ana", isPublic: true });
    upsertProfile(STATE, "bea", { displayName: "Bea", isPublic: true });
    assert.equal(followUser(STATE, "ana", "bea").ok, true);
    const posted = createPost(STATE, { userId: "bea", content: "hello from bea" });
    assert.equal(posted.ok, true);
    const dm = sendMessage(STATE, { fromUserId: "bea", toUserId: "ana", content: "ping" });
    assert.equal(dm.ok, true);
    assert.ok(getNotifications(STATE, "ana").notifications.some((n) => n.type === "dm"));

    assert.equal(flushSocialStore(STATE), true);
    forgetSocialMemory(STATE);

    const again = canonicalSocial(STATE);
    assert.ok(again.follows.get("ana")?.has("bea"));
    assert.ok([...again.posts.values()].some((p) => p.content === "hello from bea"));
    assert.equal(again.messages.size, 1);
    assert.ok((again.notifications.get("ana") || []).some((n) => n.type === "dm"));
    assert.ok(getFollowing(STATE, "ana").following.some((row) => row.userId === "bea"));
  });

  it("a lens post is the same post the REST store returns", () => {
    const actions = new Map();
    registerSocialActions((domain, name, fn) => actions.set(`${domain}.${name}`, fn));
    const ctx = { actor: { userId: "ana" }, userId: "ana" };
    const created = actions.get("social.createPost")(ctx, {}, { body: "from the lens #live" });
    assert.equal(created.ok, true);
    const STATE = globalThis._concordSTATE;
    const listed = getUserPosts(STATE, "ana", { viewerId: "ana" });
    assert.ok(listed.posts.some((p) => p.content === "from the lens #live"));
    const id = created.result.post.id;
    assert.equal(canonicalSocial(STATE).posts.get(id).body, "from the lens #live");
  });
});
