/**
 * Two people find each other, post, reply, and message on the canonical store.
 * DM policy defaults stay "everyone" and read receipts stay on, so older
 * privacy tests still deliver. Opt-in policy and receipts are covered here.
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import Database from "better-sqlite3";
import { up as upStore } from "../migrations/482_social_canonical_store.js";
import { up as upDrafts } from "../migrations/483_social_drafts.js";
import {
  upsertProfile, followUser, createPost, addComment, getComments, sendMessage,
  getConversations, getMessages, markMessagesRead, getNotifications, pinPost,
  canonicalSocial,
} from "../emergent/social-layer.js";
import {
  editPost, saveDraft, setSocialPreferences, findUserByUsername, acceptMessageRequest,
  declineMessageRequest, hideMessageForUser, groupNotifications, runInteractionLoop,
} from "../lib/social-loop.js";
import { flushSocialStore, forgetSocialMemory } from "../lib/social-persist.js";
import createSocialCoreRoutes from "../routes/social-core.js";
import registerSocialActions from "../domains/social.js";

function fresh(withDrafts = false) {
  const db = new Database(":memory:");
  upStore(db);
  if (withDrafts) upDrafts(db);
  const STATE = { db, dtus: new Map() };
  globalThis._concordSTATE = STATE;
  globalThis._concordSaveStateDebounced = () => {};
  return STATE;
}

describe("social core loop", { concurrency: 1 }, () => {
  beforeEach(() => { fresh(); });

  it("runs post, mention, reply, and DM for two people", () => {
    const STATE = globalThis._concordSTATE;
    upsertProfile(STATE, "ana", { displayName: "Ana", isPublic: true });
    upsertProfile(STATE, "bea", { displayName: "Bea", isPublic: true });
    const loop = runInteractionLoop(STATE, { ana: "ana", bea: "bea", text: "hello @bea" });
    assert.equal(loop.post.ok, true);
    assert.equal(loop.reply.ok, true);
    assert.equal(loop.dm.ok, true);
    const types = loop.notes.notifications.map((n) => n.type);
    assert.ok(types.includes("comment"));
    assert.ok(types.includes("dm"));
    assert.ok(getNotifications(STATE, "bea").notifications.some((n) => n.type === "mention"));
    assert.equal(getConversations(STATE, "ana").conversations.length, 1);
    assert.equal(getConversations(STATE, "bea").conversations.length, 1);
  });

  it("holds a message request until the recipient accepts", () => {
    const STATE = globalThis._concordSTATE;
    upsertProfile(STATE, "ana", { displayName: "Ana", isPublic: true });
    upsertProfile(STATE, "bea", { displayName: "Bea", isPublic: true });
    setSocialPreferences(STATE, "ana", { dmPolicy: "followers" });
    const pending = sendMessage(STATE, { fromUserId: "bea", toUserId: "ana", content: "secret request" });
    assert.equal(pending.ok, true);
    assert.equal(getConversations(STATE, "ana").conversations.length, 0);
    assert.equal(getMessages(STATE, pending.message.conversationId, { userId: "ana" }).messages.length, 0);
    assert.equal(getMessages(STATE, pending.message.conversationId, { userId: "bea" }).messages.length, 1);
    assert.ok(getNotifications(STATE, "ana").notifications.some((n) => n.type === "message_request"));
    assert.equal(acceptMessageRequest(STATE, { userId: "ana", fromUserId: "bea" }).ok, true);
    const opened = getMessages(STATE, pending.message.conversationId, { userId: "ana" });
    assert.equal(opened.messages[0].content, "secret request");
  });

  it("declines a request and refuses a closed inbox", () => {
    const STATE = globalThis._concordSTATE;
    upsertProfile(STATE, "ana", { displayName: "Ana", isPublic: true });
    upsertProfile(STATE, "bea", { displayName: "Bea", isPublic: true });
    setSocialPreferences(STATE, "ana", { dmPolicy: "followers" });
    sendMessage(STATE, { fromUserId: "bea", toUserId: "ana", content: "no thanks" });
    assert.equal(declineMessageRequest(STATE, { userId: "ana", fromUserId: "bea" }).ok, true);
    assert.equal(getMessages(STATE, ["ana", "bea"].sort().join(":"), { userId: "ana" }).messages.length, 0);
    setSocialPreferences(STATE, "ana", { dmPolicy: "nobody" });
    const closed = sendMessage(STATE, { fromUserId: "bea", toUserId: "ana", content: "again" });
    assert.equal(closed.ok, false);
    assert.equal(closed.status, 403);
  });

  it("clears unread without a receipt when receipts are off", () => {
    const STATE = globalThis._concordSTATE;
    upsertProfile(STATE, "ana", { displayName: "Ana", isPublic: true });
    upsertProfile(STATE, "bea", { displayName: "Bea", isPublic: true });
    setSocialPreferences(STATE, "ana", { readReceipts: false });
    const sent = sendMessage(STATE, { fromUserId: "bea", toUserId: "ana", content: "ping" });
    const key = sent.message.conversationId;
    assert.equal(getConversations(STATE, "ana").conversations[0].unreadCount, 1);
    const marked = markMessagesRead(STATE, { userId: "ana", conversationId: key });
    assert.equal(marked.receipts, false);
    assert.equal(getConversations(STATE, "ana").conversations[0].unreadCount, 0);
    const body = getMessages(STATE, key, { userId: "bea" }).messages[0];
    assert.equal(body.readBy.includes("ana"), false);
  });

  it("hides a message from one participant only", () => {
    const STATE = globalThis._concordSTATE;
    upsertProfile(STATE, "ana", { displayName: "Ana", isPublic: true });
    upsertProfile(STATE, "bea", { displayName: "Bea", isPublic: true });
    const sent = sendMessage(STATE, { fromUserId: "bea", toUserId: "ana", content: "keep" });
    assert.equal(hideMessageForUser(STATE, { userId: "ana", messageId: sent.message.id }).ok, true);
    assert.equal(getMessages(STATE, sent.message.conversationId, { userId: "ana" }).messages.length, 0);
    assert.equal(getMessages(STATE, sent.message.conversationId, { userId: "bea" }).messages.length, 1);
  });

  it("edits inside 15 minutes and keeps the previous text", () => {
    const STATE = globalThis._concordSTATE;
    upsertProfile(STATE, "ana", { displayName: "Ana", isPublic: true });
    const posted = createPost(STATE, { userId: "ana", content: "first" });
    const id = posted.post.id;
    const edited = editPost(STATE, { userId: "ana", postId: id, content: "second" });
    assert.equal(edited.ok, true);
    assert.equal(edited.post.editHistory[0].content, "first");
    canonicalSocial(STATE).posts.get(id).createdAt = new Date(Date.now() - 16 * 60 * 1000).toISOString();
    const late = editPost(STATE, { userId: "ana", postId: id, content: "third" });
    assert.equal(late.ok, false);
    assert.match(late.error, /edit window/);
  });

  it("hides a mentioned-only reply from a stranger", () => {
    const STATE = globalThis._concordSTATE;
    upsertProfile(STATE, "ana", { displayName: "Ana", isPublic: true });
    upsertProfile(STATE, "bea", { displayName: "Bea", isPublic: true });
    upsertProfile(STATE, "cy", { displayName: "Cy", isPublic: true });
    const posted = createPost(STATE, { userId: "ana", content: "thread", replyAudience: "mentioned" });
    const reply = addComment(STATE, { userId: "bea", postId: posted.post.id, content: "only ana", mentionedUsers: ["ana"] });
    assert.equal(reply.comment.audience, "mentioned");
    assert.equal(getComments(STATE, posted.post.id, { viewerId: "cy" }).comments.length, 0);
    assert.equal(getComments(STATE, posted.post.id, { viewerId: "ana" }).comments.length, 1);
    assert.equal(getComments(STATE, posted.post.id, { viewerId: "bea" }).comments.length, 1);
  });

  it("groups two comments on the same post", () => {
    const notes = [
      { type: "comment", postId: "p1", fromUserId: "bea" },
      { type: "comment", postId: "p1", fromUserId: "cy" },
    ];
    const grouped = groupNotifications(notes);
    assert.equal(grouped.length, 1);
    assert.match(grouped[0].summary, /bea and 1 other commented/);
  });

  it("pins only the author's post", () => {
    const STATE = globalThis._concordSTATE;
    upsertProfile(STATE, "ana", { displayName: "Ana", isPublic: true });
    const posted = createPost(STATE, { userId: "ana", content: "pin me" });
    assert.equal(pinPost(STATE, { userId: "bea", postId: posted.post.id }).ok, false);
    assert.equal(pinPost(STATE, { userId: "ana", postId: posted.post.id }).ok, true);
  });

  it("resolves a profile username and drops a disabled notification type", () => {
    const STATE = globalThis._concordSTATE;
    upsertProfile(STATE, "ana", { displayName: "Ana", isPublic: true });
    canonicalSocial(STATE).profiles.get("ana").username = "ana";
    assert.equal(findUserByUsername(STATE, "ana").user.id, "ana");
    createPost(STATE, { userId: "bea", content: "hi @ana", mentionedUsers: ["ana"] });
    setSocialPreferences(STATE, "ana", { notificationTypes: { mention: false } });
    assert.equal(getNotifications(STATE, "ana").notifications.some((n) => n.type === "mention"), false);
  });

  it("a lens repost notifies the author", () => {
    const STATE = fresh();
    upsertProfile(STATE, "ana", { displayName: "Ana", isPublic: true });
    upsertProfile(STATE, "bea", { displayName: "Bea", isPublic: true });
    const actions = new Map();
    registerSocialActions((domain, name, fn) => actions.set(`${domain}.${name}`, fn));
    const created = actions.get("social.createPost")({ actor: { userId: "ana" }, userId: "ana" }, {}, { body: "share me" });
    const postId = created.result.post.id;
    const reposted = actions.get("social.repost")({ actor: { userId: "bea" }, userId: "bea" }, {}, { postId });
    assert.equal(reposted.ok, true);
    assert.ok(getNotifications(STATE, "ana").notifications.some((n) => n.type === "repost"));
  });

  it("keeps a draft and an edited post across a restart", () => {
    const STATE = fresh(true);
    upsertProfile(STATE, "ana", { displayName: "Ana", isPublic: true });
    const posted = createPost(STATE, { userId: "ana", content: "first", replyAudience: "followers" });
    editPost(STATE, { userId: "ana", postId: posted.post.id, content: "second" });
    setSocialPreferences(STATE, "ana", { dmPolicy: "followers", interests: ["#Music", "music"] });
    const draft = saveDraft(STATE, { userId: "ana", content: "unsent" });
    assert.equal(flushSocialStore(STATE), true);
    forgetSocialMemory(STATE);
    const again = canonicalSocial(STATE);
    const post = again.posts.get(posted.post.id);
    assert.equal(post.content, "second");
    assert.equal(post.editHistory[0].content, "first");
    assert.equal(post.replyAudience, "followers");
    assert.equal(again.profiles.get("ana").dmPolicy, "followers");
    assert.deepEqual(again.profiles.get("ana").interests, ["music"]);
    assert.equal(again.drafts.get(draft.draft.id).content, "unsent");
  });
});

describe("social core loop routes", { concurrency: 1 }, () => {
  it("the edit route is the one that answers", async () => {
    fresh();
    const STATE = globalThis._concordSTATE;
    upsertProfile(STATE, "ana", { displayName: "Ana", isPublic: true });
    const posted = createPost(STATE, { userId: "ana", content: "route" });
    const app = express();
    app.use(express.json());
    app.use("/api/social", createSocialCoreRoutes({
      db: STATE.db,
      requireAuth: () => (req, _res, next) => { req.user = { id: req.header("x-user") }; next(); },
    }));
    const server = app.listen(0);
    try {
      const port = server.address().port;
      const res = await fetch(`http://127.0.0.1:${port}/api/social/posts/${posted.post.id}/edit`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-user": "ana" },
        body: JSON.stringify({ content: "edited via route" }),
      });
      const body = await res.json();
      assert.equal(res.status, 200);
      assert.equal(body.post.content, "edited via route");
      const stranger = await fetch(`http://127.0.0.1:${port}/api/social/posts/${posted.post.id}/edit`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-user": "bea" },
        body: JSON.stringify({ content: "nope" }),
      });
      assert.equal(stranger.status, 403);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
