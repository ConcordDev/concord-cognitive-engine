// Feed full build (F-B row 8) — the legs the premise priced:
//   S3/F3 — rank-for-you + home + affinity-summary carry the post's own
//     title (its first line) and the author's resolved display name;
//     reason strings never embed a raw author id. Names resolve the way
//     the social layer's serializePost resolves them: the in-memory
//     social profile's displayName first, then the users-table identity.
//   S5/F5 — the feed lens registers an export provider with
//     lib/lens-export.js: collectLensExport returns the CALLER's own
//     feedLens records (folder · saved search · list · thread · poll ·
//     hosted space · controls) and none of another user's; spaces are
//     exported only for their host.
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerFeedActions from "../domains/feed.js";
import { collectLensExport, hasLensExportProvider } from "../lib/lens-export.js";

const ACTIONS = new Map();
function register(domain, name, fn) {
  ACTIONS.set(`${domain}.${name}`, fn);
}
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`feed.${name}`);
  if (!fn) throw new Error(`feed.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

const ALICE = "11111111-2222-3333-4444-555555555555";
const BOB = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

function seedIdentity() {
  const profiles = new Map();
  profiles.set(ALICE, { userId: ALICE, displayName: "Alice Author", username: "alice" });
  globalThis._concordSTATE._social = { profiles, posts: new Map() };
  globalThis._concordSTATE.db = {
    prepare(sql) {
      if (String(sql).startsWith("PRAGMA")) return { all: () => [{ name: "id" }, { name: "username" }] };
      return {
        get: (id) => (id === BOB ? { username: "bobby" } : undefined),
      };
    },
  };
}

describe("feed full build — identity rendering + export provider", () => {
  beforeEach(() => {
    ACTIONS.clear();
    globalThis._concordSTATE = { dtus: new Map() };
    globalThis._concordSaveStateDebounced = () => {};
    registerFeedActions(register);
    seedIdentity();
  });

  it("rank-for-you rows carry title + resolved names; reasons name the author, never the raw id", () => {
    call("record-interaction", ctxA, { authorId: ALICE, kind: "reply" });
    call("record-interaction", ctxA, { authorId: BOB, kind: "like" });
    const now = new Date().toISOString();
    const r = call("rank-for-you", ctxA, {
      candidates: [
        { id: "p1", authorId: ALICE, content: "First line title\nrest of the post body", likes: 2, comments: 1, reposts: 0, createdAt: now },
        { id: "p2", authorId: BOB, content: "Bob's post about lenses", likes: 0, comments: 0, reposts: 0, createdAt: now },
        { id: "p3", authorId: "ghost-user", content: "A post by an unnamed author", likes: 0, comments: 0, reposts: 0, createdAt: now },
      ],
    });
    assert.equal(r.ok, true);
    const byId = new Map(r.result.ranked.map((row) => [row.id, row]));
    const p1 = byId.get("p1");
    assert.equal(p1.title, "First line title");
    assert.equal(p1.authorName, "Alice Author");
    assert.equal(p1.authorHandle, "alice");
    assert.ok(p1.reasons.some((x) => x.includes("Alice Author")), `reasons name the author: ${JSON.stringify(p1.reasons)}`);
    assert.ok(r.result.ranked.every((row) => row.reasons.every((x) => !x.includes(ALICE) && !x.includes(BOB))), "no reason string renders a raw author id as identity");
    const p2 = byId.get("p2");
    assert.equal(p2.title, "Bob's post about lenses");
    assert.equal(p2.authorName, "bobby");
    assert.ok(p2.reasons.some((x) => x.includes("bobby")));
    const p3 = byId.get("p3");
    assert.equal(p3.authorName, null);
    assert.equal(p3.authorHandle, null);
    assert.ok(p3.reasons.every((x) => !x.includes("ghost-user")), "an unresolved author is never named by raw id");
  });

  it("home items carry title + authorName and reasons without raw ids", () => {
    call("record-interaction", ctxA, { authorId: ALICE, kind: "like" });
    // home reads STATE.social.posts (the legacy bucket name) — seed both
    // buckets at the same Map so the read finds the post either way.
    globalThis._concordSTATE.social = { posts: globalThis._concordSTATE._social.posts };
    globalThis._concordSTATE._social.posts.set("hp1", {
      id: "hp1", userId: ALICE, authorId: ALICE,
      content: "Home post headline\nbody text", createdAt: new Date().toISOString(),
      likes: 1, comments: 0, reposts: 0,
    });
    const r = call("home", ctxA, { limit: 10 });
    assert.equal(r.ok, true);
    const item = r.items.find((x) => x.id === "hp1");
    assert.ok(item, "home returns the seeded post");
    assert.equal(item.title, "Home post headline");
    assert.equal(item.authorName, "Alice Author");
    assert.ok(item.reasons.some((x) => x.includes("Alice Author")));
    assert.ok(item.reasons.every((x) => !x.includes(ALICE)), "no home reason renders the raw author id");
  });

  it("affinity-summary authors carry resolved names", () => {
    call("record-interaction", ctxA, { authorId: ALICE, kind: "bookmark" });
    call("record-interaction", ctxA, { authorId: BOB, kind: "view" });
    const r = call("affinity-summary", ctxA, {});
    assert.equal(r.ok, true);
    const alice = r.result.authors.find((a) => a.authorId === ALICE);
    const bob = r.result.authors.find((a) => a.authorId === BOB);
    assert.equal(alice.authorName, "Alice Author");
    assert.equal(alice.authorHandle, "alice");
    assert.equal(bob.authorName, "bobby");
  });

  it("thread-tree nodes carry the author's resolved name", () => {
    const added = call("thread-add", { actor: { userId: ALICE }, userId: ALICE }, { body: "Root thought" });
    assert.equal(added.ok, true);
    const tree = call("thread-tree", { actor: { userId: ALICE }, userId: ALICE }, {});
    assert.equal(tree.ok, true);
    assert.equal(tree.result.tree.length, 1);
    assert.equal(tree.result.tree[0].authorName, "Alice Author");
    assert.equal(tree.result.tree[0].authorHandle, "alice");
  });

  it("the export provider returns exactly the caller's feed records", async () => {
    assert.equal(hasLensExportProvider("feed"), true);
    call("folder-create", ctxA, { name: "A folder" });
    call("saved-search-create", ctxA, { query: "a query" });
    call("list-create", ctxA, { name: "A list" });
    call("thread-add", ctxA, { body: "A thread root" });
    call("poll-create", ctxA, { question: "A poll?", options: ["yes", "no"] });
    call("controls-mute-word", ctxA, { word: "spam" });
    call("folder-create", ctxB, { name: "B folder" });
    call("space-create", ctxB, { title: "B space" });

    const runMacro = async () => ({ ok: true, artifacts: [] });
    const outA = await collectLensExport({ runMacro, domain: "feed", ctx: ctxA, limit: 100 });
    assert.equal(outA.ok, true);
    const typesA = outA.artifacts.map((r) => r.type).sort();
    assert.deepEqual(typesA, ["bookmark-folder", "content-controls", "list", "poll", "saved-search", "thread-node"]);
    assert.ok(outA.artifacts.every((r) => !JSON.stringify(r).includes("B folder")), "no other user's records in A's export");
    assert.ok(outA.artifacts.every((r) => !JSON.stringify(r).includes("B space")), "another host's space is not exported");

    const outB = await collectLensExport({ runMacro, domain: "feed", ctx: ctxB, limit: 100 });
    const typesB = outB.artifacts.map((r) => r.type).sort();
    assert.deepEqual(typesB, ["bookmark-folder", "space"]);
    const spaceRow = outB.artifacts.find((r) => r.type === "space");
    assert.equal(spaceRow.title, "B space");
  });
});
