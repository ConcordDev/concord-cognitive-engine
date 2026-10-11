// INC-49 / INC-50 — philosophy debate privacy and channel collaborators.
// Two distinct actors. Debates follow the channel model (private unless
// the owner sets public). Collaborators can open a channel and add or
// delete their own blocks; unknown user ids are rejected against users.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerPhilosophyActions from "../domains/philosophy.js";

// Stands in for the users table lookupUserIdentity queries (PRAGMA + SELECT).
function usersDb() {
  const rows = new Map([
    ["user_a", { username: "ada", displayName: "Ada" }],
    ["user_b", { username: "bea", displayName: "Bea" }],
  ]);
  return {
    prepare(sql) {
      if (String(sql).includes("PRAGMA")) {
        return { all() { return [{ name: "id" }, { name: "username" }, { name: "display_name" }]; } };
      }
      return { get(id) { return rows.get(id); } };
    },
  };
}

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`philosophy.${name}`);
  assert.ok(fn, `philosophy.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

const ctxA = { actor: { userId: "user_a" }, userId: "user_a", db: null };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b", db: null };

before(() => { registerPhilosophyActions(register); });
beforeEach(() => {
  const db = usersDb();
  ctxA.db = db;
  ctxB.db = db;
  // No STATE.db — handlers must read ctx.db, the handle makeCtx passes.
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

function newChannel(over = {}) {
  return call("channel-create", ctxA, { title: "Free will", ...over }).result.channel;
}

describe("philosophy debates — private by default (INC-49)", () => {
  it("hides a private debate from a non-owner: list, detail, and post", () => {
    const t = call("debate-create", ctxA, { title: "Private will", claim: "Only the author sees this." }).result.thread;
    assert.equal(t.public, false);
    assert.equal(t.mine, true);

    const listB = call("debate-list", ctxB, {});
    assert.equal(listB.result.count, 0);
    assert.equal(listB.result.threads.some((row) => row.id === t.id), false);

    const detailB = call("debate-detail", ctxB, { id: t.id });
    assert.equal(detailB.ok, false);
    assert.equal(detailB.error, "debate thread not found");

    const postB = call("debate-post", ctxB, { threadId: t.id, stance: "object", body: "I should not be able to reply." });
    assert.equal(postB.ok, false);
    assert.equal(postB.error, "debate thread not found");

    const detailA = call("debate-detail", ctxA, { id: t.id });
    assert.equal(detailA.ok, true);
    assert.equal(detailA.result.thread.posts.length, 0);
  });

  it("lets a non-owner read and post on a debate the owner marked public", () => {
    const created = call("debate-create", ctxA, {
      title: "Public will", claim: "Anyone signed in may reply.", public: true,
    });
    assert.equal(created.result.thread.public, true);

    const listed = call("debate-list", ctxB, {}).result.threads;
    assert.equal(listed.length, 1);
    assert.equal(listed[0].id, created.result.thread.id);
    assert.equal(listed[0].public, true);
    assert.equal(listed[0].mine, false);

    const posted = call("debate-post", ctxB, { threadId: created.result.thread.id, stance: "object", body: "A public objection." });
    assert.equal(posted.ok, true);

    const detail = call("debate-detail", ctxB, { id: created.result.thread.id });
    assert.equal(detail.ok, true);
    assert.equal(detail.result.thread.posts.length, 1);
    assert.equal(detail.result.thread.posts[0].body, "A public objection.");
    assert.equal(detail.result.thread.posts[0].mine, true);
  });

  it("publishes and unpublishes only for the owner, after create", () => {
    const t = call("debate-create", ctxA, { title: "Toggle", claim: "Starts private." }).result.thread;
    assert.equal(call("debate-list", ctxB, {}).result.count, 0);
    assert.equal(call("debate-publish", ctxB, { id: t.id, public: true }).ok, false);
    assert.equal(call("debate-publish", ctxA, { id: t.id, public: true }).result.public, true);
    assert.equal(call("debate-detail", ctxB, { id: t.id }).ok, true);
    assert.equal(call("debate-publish", ctxA, { id: t.id, public: false }).result.public, false);
    assert.equal(call("debate-detail", ctxB, { id: t.id }).ok, false);
  });

  it("debate-delete removes the thread for the owner and refuses everyone else", () => {
    const priv = call("debate-create", ctxA, { title: "Mine", claim: "Delete me." }).result.thread;
    const pub = call("debate-create", ctxA, { title: "Ours", claim: "Still mine to delete.", public: true }).result.thread;

    assert.equal(call("debate-delete", ctxB, { id: priv.id }).ok, false);
    assert.equal(call("debate-delete", ctxB, { id: priv.id }).error, "debate thread not found");
    assert.equal(call("debate-detail", ctxA, { id: priv.id }).ok, true);

    assert.equal(call("debate-delete", ctxB, { id: pub.id }).ok, false);
    assert.equal(call("debate-detail", ctxB, { id: pub.id }).ok, true);

    assert.equal(call("debate-delete", ctxA, { id: priv.id }).result.deleted, priv.id);
    assert.equal(call("debate-detail", ctxA, { id: priv.id }).ok, false);
    assert.equal(call("debate-delete", ctxA, { id: pub.id }).ok, true);
    assert.equal(call("debate-list", ctxA, {}).result.count, 0);
    assert.equal(call("debate-list", ctxB, {}).result.count, 0);
  });

  it("does not put another user's raw id on list or detail payloads", () => {
    const t = call("debate-create", ctxA, { title: "Named", claim: "Ada wrote this.", public: true }).result.thread;
    call("debate-post", ctxB, { threadId: t.id, stance: "clarify", body: "Bea replies." });

    const listB = call("debate-list", ctxB, {});
    const detailB = call("debate-detail", ctxB, { id: t.id });
    const detailA = call("debate-detail", ctxA, { id: t.id });

    for (const payload of [listB, detailB]) {
      const blob = JSON.stringify(payload);
      assert.equal(blob.includes("user_a"), false);
      assert.equal(blob.includes("user_b"), false);
    }
    assert.equal(JSON.stringify(detailA).includes("user_b"), false);
    assert.equal(detailB.result.thread.authorName, "Ada");
    assert.equal(detailB.result.thread.mine, false);
    assert.equal(detailA.result.thread.mine, true);
    assert.equal(detailA.result.thread.authorName, "Ada");
    const reply = detailA.result.thread.posts[0];
    assert.equal(reply.authorName, "Bea");
    assert.equal(reply.mine, false);
    assert.equal(reply.author, undefined);
  });

  it("treats a stored debate with no public flag as private", () => {
    const t = call("debate-create", ctxA, { title: "Legacy", claim: "Predates the flag.", public: true }).result.thread;
    const stored = globalThis._concordSTATE.philosophyLens.debates.get("user_a").find((row) => row.id === t.id);
    delete stored.public;
    assert.equal(call("debate-list", ctxB, {}).result.count, 0);
    assert.equal(call("debate-detail", ctxB, { id: t.id }).ok, false);
    assert.equal(call("debate-post", ctxB, { threadId: t.id, body: "nope" }).ok, false);
    assert.equal(call("debate-detail", ctxA, { id: t.id }).result.thread.public, false);
  });
});

describe("philosophy channel collaborators (INC-50)", () => {
  it("lets a listed collaborator open the channel and add a block the owner sees", () => {
    const c = newChannel();
    const added = call("channel-collaborator-add", ctxA, { id: c.id, userId: "user_b" });
    assert.equal(added.ok, true);

    const listed = call("channel-list", ctxB, {});
    assert.equal(listed.result.count, 1);
    assert.equal(listed.result.channels[0].role, "collaborator");

    const detail = call("channel-detail", ctxB, { id: c.id });
    assert.equal(detail.ok, true);
    assert.equal(detail.result.channel.role, "collaborator");

    const block = call("block-add", ctxB, { channelId: c.id, content: "A collaborator's note." });
    assert.equal(block.ok, true);
    assert.equal(call("channel-detail", ctxA, { id: c.id }).result.blocks.length, 1);
    const seenByB = call("channel-detail", ctxB, { id: c.id });
    assert.equal(seenByB.result.blocks[0].content, "A collaborator's note.");
    assert.equal(seenByB.result.blocks[0].canDelete, true);
    assert.equal(JSON.stringify(seenByB).includes("user_a"), false);
  });

  it("lets a collaborator delete their own block and not the owner's", () => {
    const c = newChannel();
    const owners = call("block-add", ctxA, { channelId: c.id, content: "Owner note." }).result.block;
    call("channel-collaborator-add", ctxA, { id: c.id, userId: "user_b" });
    const mine = call("block-add", ctxB, { channelId: c.id, content: "Collaborator note." }).result.block;

    const denied = call("block-delete", ctxB, { id: owners.id });
    assert.equal(denied.ok, false);
    assert.equal(call("block-delete", ctxB, { id: mine.id }).ok, true);

    const left = call("channel-detail", ctxA, { id: c.id }).result.blocks;
    assert.equal(left.length, 1);
    assert.equal(left[0].id, owners.id);
  });

  it("still denies a non-collaborator channel-detail and block-add", () => {
    const c = newChannel();
    assert.equal(call("channel-detail", ctxB, { id: c.id }).ok, false);
    assert.equal(call("channel-detail", ctxB, { id: c.id }).error, "channel not found");
    assert.equal(call("block-add", ctxB, { channelId: c.id, content: "intrusion" }).ok, false);
    assert.equal(call("block-add", ctxB, { channelId: c.id, content: "intrusion" }).error, "channel not found");
    assert.equal(call("channel-list", ctxB, {}).result.count, 0);
  });

  it("rejects an unknown collaborator id", () => {
    const c = newChannel();
    const r = call("channel-collaborator-add", ctxA, { id: c.id, userId: "no_such_user_r91" });
    assert.equal(r.ok, false);
    assert.equal(r.error, "user not found");
    assert.equal(call("channel-collaborator-list", ctxA, { id: c.id }).result.collaborators.length, 0);
  });

  it("lets only the owner publish, delete the channel, or manage collaborators", () => {
    const c = newChannel();
    call("channel-collaborator-add", ctxA, { id: c.id, userId: "user_b" });

    assert.equal(call("channel-publish", ctxB, { id: c.id, public: true }).ok, false);
    assert.equal(call("public-channels", ctxB, {}).result.count, 0);
    assert.equal(call("channel-collaborator-add", ctxB, { id: c.id, userId: "user_a" }).ok, false);
    assert.equal(call("channel-collaborator-remove", ctxB, { id: c.id, userId: "user_b" }).ok, false);
    assert.equal(call("channel-collaborator-list", ctxA, { id: c.id }).result.collaborators.length, 1);
    assert.equal(call("channel-delete", ctxB, { id: c.id }).ok, false);
    assert.equal(call("channel-detail", ctxA, { id: c.id }).ok, true);
  });
});
