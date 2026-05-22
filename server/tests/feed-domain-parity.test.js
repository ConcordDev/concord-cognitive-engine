// Tier-2 contract tests for the feed lens 2026 X/Threads parity backlog:
//   - Algorithmic ranked "For You" (record-interaction / rank-for-you / affinity-summary)
//   - Quote-posts / threaded reply trees with collapse (thread-*)
//   - Lists / curated timelines (list-*)
//   - Polls in the composer + live results (poll-*)
//   - Bookmark folders + saved-search alerts (folder-*, saved-search-*)
//   - Live audio rooms / Spaces (space-*)
//   - Content controls — mute words / sensitive-media / block (controls-*)
// Pins per-user scoping, validation, and the recommendation/algebra math.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerFeedActions from "../domains/feed.js";

const ACTIONS = new Map();
function register(domain, name, fn) {
  ACTIONS.set(`${domain}.${name}`, fn);
}
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`feed.${name}`);
  if (!fn) throw new Error(`feed.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => {
  registerFeedActions(register);
});

beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

// ════════════════════════════════════════════════════════════════════
// 1. Algorithmic ranked "For You"
// ════════════════════════════════════════════════════════════════════

describe("feed — record-interaction", () => {
  it("records a weighted interaction and returns affinity", () => {
    const r = call("record-interaction", ctxA, { authorId: "alice", kind: "like" });
    assert.equal(r.ok, true);
    assert.equal(r.result.authorId, "alice");
    assert.ok(r.result.affinity > 0);
  });

  it("rejects missing authorId and invalid kind", () => {
    assert.equal(call("record-interaction", ctxA, { kind: "like" }).ok, false);
    assert.equal(call("record-interaction", ctxA, { authorId: "x", kind: "bogus" }).ok, false);
  });

  it("INVARIANT: interactions are scoped per-user", () => {
    call("record-interaction", ctxA, { authorId: "alice", kind: "reply" });
    const b = call("affinity-summary", ctxB);
    assert.equal(b.result.total, 0);
  });
});

describe("feed — rank-for-you", () => {
  it("ranks candidates higher for authors the user engages with", () => {
    call("record-interaction", ctxA, { authorId: "alice", kind: "reply" });
    call("record-interaction", ctxA, { authorId: "alice", kind: "repost" });
    const now = new Date().toISOString();
    const r = call("rank-for-you", ctxA, {
      candidates: [
        { id: "p1", authorId: "bob", createdAt: now, likes: 0 },
        { id: "p2", authorId: "alice", createdAt: now, likes: 0 },
      ],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.ranked[0].id, "p2");
    assert.equal(r.result.modelTrained, true);
  });

  it("filters out blocked authors and muted words while ranking", () => {
    call("controls-block-user", ctxA, { userId: "spammer" });
    call("controls-mute-word", ctxA, { word: "crypto" });
    const r = call("rank-for-you", ctxA, {
      candidates: [
        { id: "p1", authorId: "spammer", content: "hello" },
        { id: "p2", authorId: "bob", content: "buy crypto now" },
        { id: "p3", authorId: "carol", content: "clean post" },
      ],
    });
    assert.equal(r.result.ranked.length, 1);
    assert.equal(r.result.ranked[0].id, "p3");
  });

  it("returns an empty ranking with no candidates", () => {
    const r = call("rank-for-you", ctxA, { candidates: [] });
    assert.equal(r.ok, true);
    assert.equal(r.result.ranked.length, 0);
  });
});

describe("feed — affinity-summary", () => {
  it("returns authors sorted by affinity desc", () => {
    call("record-interaction", ctxA, { authorId: "low", kind: "view" });
    call("record-interaction", ctxA, { authorId: "high", kind: "repost" });
    const r = call("affinity-summary", ctxA);
    assert.equal(r.ok, true);
    assert.equal(r.result.authors[0].authorId, "high");
  });
});

// ════════════════════════════════════════════════════════════════════
// 2. Quote-post / threaded reply trees with collapse
// ════════════════════════════════════════════════════════════════════

describe("feed — thread tree", () => {
  it("adds a root post, a reply, and builds a nested tree", () => {
    const root = call("thread-add", ctxA, { body: "root post" });
    assert.equal(root.ok, true);
    assert.equal(root.result.node.kind, "post");
    const reply = call("thread-add", ctxA, { body: "a reply", parentId: root.result.node.id });
    assert.equal(reply.result.node.kind, "reply");
    const tree = call("thread-tree", ctxA);
    assert.equal(tree.result.tree[0].children.length, 1);
    assert.equal(tree.result.tree[0].replyCount, 1);
  });

  it("classifies a quote-post when quotedId is set", () => {
    const r = call("thread-add", ctxA, { body: "quoting you", quotedId: "ext_post_1", quotedBody: "original" });
    assert.equal(r.result.node.kind, "quote");
    assert.equal(r.result.node.quotedId, "ext_post_1");
  });

  it("rejects empty body and unknown parent", () => {
    assert.equal(call("thread-add", ctxA, { body: "  " }).ok, false);
    assert.equal(call("thread-add", ctxA, { body: "x", parentId: "nope" }).ok, false);
  });

  it("collapse hides children in the tree", () => {
    const root = call("thread-add", ctxA, { body: "root" });
    call("thread-add", ctxA, { body: "child", parentId: root.result.node.id });
    call("thread-collapse", ctxA, { nodeId: root.result.node.id, collapsed: true });
    const tree = call("thread-tree", ctxA);
    assert.equal(tree.result.tree[0].children.length, 0);
    assert.equal(tree.result.tree[0].collapsed, true);
  });

  it("delete cascades to descendants", () => {
    const root = call("thread-add", ctxA, { body: "root" });
    const child = call("thread-add", ctxA, { body: "child", parentId: root.result.node.id });
    call("thread-add", ctxA, { body: "grandchild", parentId: child.result.node.id });
    const r = call("thread-delete", ctxA, { nodeId: root.result.node.id });
    assert.equal(r.result.deleted, 3);
  });
});

// ════════════════════════════════════════════════════════════════════
// 3. Lists / curated timelines
// ════════════════════════════════════════════════════════════════════

describe("feed — lists", () => {
  it("creates a list and lists it back", () => {
    const c = call("list-create", ctxA, { name: "Builders", members: ["alice", "bob"] });
    assert.equal(c.ok, true);
    assert.equal(c.result.list.members.length, 2);
    const all = call("list-all", ctxA);
    assert.equal(all.result.lists.length, 1);
  });

  it("rejects an empty list name", () => {
    assert.equal(call("list-create", ctxA, { name: "" }).ok, false);
  });

  it("adds, removes members and pins the list", () => {
    const l = call("list-create", ctxA, { name: "Devs" }).result.list;
    call("list-update-members", ctxA, { listId: l.id, member: "carol", op: "add" });
    let r = call("list-update-members", ctxA, { listId: l.id, member: "carol", op: "remove" });
    assert.equal(r.result.list.members.length, 0);
    r = call("list-update-members", ctxA, { listId: l.id, pinned: true });
    assert.equal(r.result.list.pinned, true);
  });

  it("list-feed returns only posts from list members", () => {
    const l = call("list-create", ctxA, { name: "Sources", members: ["alice"] }).result.list;
    const r = call("list-feed", ctxA, {
      listId: l.id,
      candidates: [
        { id: "p1", authorId: "alice", createdAt: "2026-05-02" },
        { id: "p2", authorId: "bob", createdAt: "2026-05-01" },
      ],
    });
    assert.equal(r.result.posts.length, 1);
    assert.equal(r.result.posts[0].id, "p1");
  });

  it("deletes a list", () => {
    const l = call("list-create", ctxA, { name: "Temp" }).result.list;
    assert.equal(call("list-delete", ctxA, { listId: l.id }).ok, true);
    assert.equal(call("list-all", ctxA).result.lists.length, 0);
  });

  it("INVARIANT: lists are scoped per-user", () => {
    call("list-create", ctxA, { name: "A-only" });
    assert.equal(call("list-all", ctxB).result.lists.length, 0);
  });
});

// ════════════════════════════════════════════════════════════════════
// 4. Polls in the composer + live results
// ════════════════════════════════════════════════════════════════════

describe("feed — polls", () => {
  it("creates a poll with 2-4 options", () => {
    const r = call("poll-create", ctxA, { question: "Best lens?", options: ["feed", "code"] });
    assert.equal(r.ok, true);
    assert.equal(r.result.poll.options.length, 2);
    assert.equal(r.result.poll.totalVotes, 0);
  });

  it("rejects fewer than 2 options or an empty question", () => {
    assert.equal(call("poll-create", ctxA, { question: "x", options: ["only"] }).ok, false);
    assert.equal(call("poll-create", ctxA, { question: "", options: ["a", "b"] }).ok, false);
  });

  it("vote tallies live results and one vote per user", () => {
    const poll = call("poll-create", ctxA, { question: "?", options: ["a", "b"] }).result.poll;
    call("poll-vote", ctxA, { pollId: poll.id, optionId: "opt0" });
    let r = call("poll-vote", ctxB, { pollId: poll.id, optionId: "opt1" });
    assert.equal(r.result.poll.totalVotes, 2);
    // re-vote replaces the earlier vote
    r = call("poll-vote", ctxA, { pollId: poll.id, optionId: "opt1" });
    assert.equal(r.result.poll.totalVotes, 2);
    assert.equal(r.result.poll.options.find((o) => o.id === "opt1").votes, 2);
  });

  it("poll-results reports myVote for the viewer", () => {
    const poll = call("poll-create", ctxA, { question: "?", options: ["a", "b"] }).result.poll;
    call("poll-vote", ctxA, { pollId: poll.id, optionId: "opt0" });
    const r = call("poll-results", ctxA, { pollId: poll.id });
    assert.equal(r.result.poll.myVote, "opt0");
  });

  it("poll-list returns the user's polls", () => {
    call("poll-create", ctxA, { question: "q1", options: ["a", "b"] });
    const r = call("poll-list", ctxA);
    assert.equal(r.result.polls.length, 1);
  });
});

// ════════════════════════════════════════════════════════════════════
// 5. Bookmark folders + saved-search alerts
// ════════════════════════════════════════════════════════════════════

describe("feed — bookmark folders", () => {
  it("creates a folder and adds/removes items", () => {
    const f = call("folder-create", ctxA, { name: "Read later" }).result.folder;
    let r = call("folder-add-item", ctxA, { folderId: f.id, postId: "p1" });
    assert.equal(r.result.folder.itemCount, 1);
    r = call("folder-add-item", ctxA, { folderId: f.id, postId: "p1", op: "remove" });
    assert.equal(r.result.folder.itemCount, 0);
  });

  it("rejects an empty folder name", () => {
    assert.equal(call("folder-create", ctxA, { name: "" }).ok, false);
  });

  it("lists and deletes folders, scoped per-user", () => {
    const f = call("folder-create", ctxA, { name: "Temp" }).result.folder;
    assert.equal(call("folder-list", ctxA).result.folders.length, 1);
    assert.equal(call("folder-list", ctxB).result.folders.length, 0);
    call("folder-delete", ctxA, { folderId: f.id });
    assert.equal(call("folder-list", ctxA).result.folders.length, 0);
  });
});

describe("feed — saved searches", () => {
  it("creates a saved search and runs it against candidates", () => {
    const s = call("saved-search-create", ctxA, { query: "sovereignty" }).result.search;
    const r = call("saved-search-run", ctxA, {
      searchId: s.id,
      candidates: [
        { id: "p1", content: "On sovereignty and local-first systems", createdAt: new Date().toISOString() },
        { id: "p2", content: "unrelated post", createdAt: new Date().toISOString() },
      ],
    });
    assert.equal(r.result.matches.length, 1);
    assert.equal(r.result.matches[0].id, "p1");
  });

  it("rejects an empty query", () => {
    assert.equal(call("saved-search-create", ctxA, { query: "" }).ok, false);
  });

  it("counts new matches since last check for alert searches", () => {
    const s = call("saved-search-create", ctxA, { query: "lens" }).result.search;
    const future = new Date(Date.now() + 60000).toISOString();
    const r = call("saved-search-run", ctxA, {
      searchId: s.id,
      candidates: [{ id: "p1", content: "new lens shipped", createdAt: future }],
    });
    assert.equal(r.result.newSinceLastCheck, 1);
    assert.equal(r.result.alert, true);
  });

  it("lists and deletes saved searches", () => {
    const s = call("saved-search-create", ctxA, { query: "x" }).result.search;
    assert.equal(call("saved-search-list", ctxA).result.searches.length, 1);
    call("saved-search-delete", ctxA, { searchId: s.id });
    assert.equal(call("saved-search-list", ctxA).result.searches.length, 0);
  });
});

// ════════════════════════════════════════════════════════════════════
// 6. Live audio rooms / Spaces
// ════════════════════════════════════════════════════════════════════

describe("feed — spaces", () => {
  it("creates a live space with the host as a speaker", () => {
    const r = call("space-create", ctxA, { title: "Builder hangout" });
    assert.equal(r.ok, true);
    assert.equal(r.result.space.status, "live");
    assert.equal(r.result.space.hostId, "user_a");
    assert.equal(r.result.space.speakerCount, 1);
  });

  it("rejects an empty title", () => {
    assert.equal(call("space-create", ctxA, { title: "" }).ok, false);
  });

  it("join/leave moves a user between speaker and listener", () => {
    const sp = call("space-create", ctxA, { title: "Talk" }).result.space;
    let r = call("space-join", ctxB, { spaceId: sp.id, role: "listener" });
    assert.equal(r.result.space.listenerCount, 1);
    r = call("space-join", ctxB, { spaceId: sp.id, role: "speaker" });
    assert.equal(r.result.space.speakerCount, 2);
    assert.equal(r.result.space.listenerCount, 0);
    r = call("space-leave", ctxB, { spaceId: sp.id });
    assert.equal(r.result.space.speakerCount, 1);
  });

  it("only the host can end a space", () => {
    const sp = call("space-create", ctxA, { title: "Talk" }).result.space;
    assert.equal(call("space-end", ctxB, { spaceId: sp.id }).ok, false);
    const r = call("space-end", ctxA, { spaceId: sp.id });
    assert.equal(r.result.space.status, "ended");
  });

  it("space-list surfaces live spaces first", () => {
    const a = call("space-create", ctxA, { title: "ended one" }).result.space;
    call("space-end", ctxA, { spaceId: a.id });
    call("space-create", ctxA, { title: "live one" });
    const r = call("space-list", ctxA);
    assert.equal(r.result.spaces[0].status, "live");
    assert.equal(r.result.liveCount, 1);
  });
});

// ════════════════════════════════════════════════════════════════════
// 7. Content controls — mute words / sensitive-media / block
// ════════════════════════════════════════════════════════════════════

describe("feed — content controls", () => {
  it("returns default controls on first get", () => {
    const r = call("controls-get", ctxA);
    assert.equal(r.ok, true);
    assert.equal(r.result.controls.sensitiveMedia, "blur");
    assert.deepEqual(r.result.controls.mutedWords, []);
  });

  it("mutes and unmutes a word", () => {
    let r = call("controls-mute-word", ctxA, { word: "Spoiler" });
    assert.deepEqual(r.result.controls.mutedWords, ["spoiler"]);
    r = call("controls-mute-word", ctxA, { word: "spoiler", op: "remove" });
    assert.deepEqual(r.result.controls.mutedWords, []);
  });

  it("blocks a user and sets sensitive-media mode", () => {
    let r = call("controls-block-user", ctxA, { userId: "troll" });
    assert.deepEqual(r.result.controls.blockedUsers, ["troll"]);
    r = call("controls-sensitive-media", ctxA, { mode: "hide" });
    assert.equal(r.result.controls.sensitiveMedia, "hide");
    assert.equal(call("controls-sensitive-media", ctxA, { mode: "bogus" }).ok, false);
  });

  it("controls-apply filters muted, blocked and flags sensitive posts", () => {
    call("controls-block-user", ctxA, { userId: "troll" });
    call("controls-mute-word", ctxA, { word: "spam" });
    call("controls-sensitive-media", ctxA, { mode: "blur" });
    const r = call("controls-apply", ctxA, {
      candidates: [
        { id: "p1", authorId: "troll", content: "hi" },
        { id: "p2", authorId: "bob", content: "this is spam" },
        { id: "p3", authorId: "carol", content: "graphic", sensitive: true },
        { id: "p4", authorId: "dave", content: "clean" },
      ],
    });
    assert.equal(r.result.removed.blocked, 1);
    assert.equal(r.result.removed.muted, 1);
    assert.equal(r.result.sensitiveFlagged, 1);
    assert.equal(r.result.posts.length, 2);
    const flagged = r.result.posts.find((p) => p.id === "p3");
    assert.equal(flagged.mediaTreatment, "blur");
  });
});

describe("feed — STATE unavailable path", () => {
  it("returns an error shape when STATE is missing", () => {
    globalThis._concordSTATE = undefined;
    const r = call("list-all", ctxA);
    assert.equal(r.ok, false);
    assert.match(r.error, /STATE unavailable/);
  });
});
