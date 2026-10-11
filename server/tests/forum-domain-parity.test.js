// Contract tests for the forum Discourse + Reddit 2026-parity
// community lens (categories, topics, replies, voting, moderation
// flags, reputation tiers, search).

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerForumActions from "../domains/forum.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`forum.${name}`);
  assert.ok(fn, `forum.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerForumActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };
const asMod = (ctx) => ({ ...ctx, actor: { ...ctx.actor, role: "moderator" } });

describe("forum.category-*", () => {
  it("creates, lists with topic counts and deletes", () => {
    const cat = call("category-create", ctxA, { name: "General" }).result.category;
    call("topic-create", ctxA, { categoryId: cat.id, title: "Hello" });
    const list = call("category-list", ctxA, {});
    assert.equal(list.result.categories[0].topicCount, 1);
    call("category-delete", ctxA, { id: cat.id });
    assert.equal(call("category-list", ctxA, {}).result.count, 0);
  });

  it("shares public categories and hides private ones from non-members", () => {
    call("category-create", ctxA, { name: "Open" });
    const secret = call("category-create", ctxA, { name: "Secret", visibility: "private" }).result.category;
    const club = call("category-create", ctxA, { name: "Club", private: true, members: ["user_b"] }).result.category;
    const names = call("category-list", ctxB, {}).result.categories.map((c) => c.name);
    assert.deepEqual(names.sort(), ["Club", "Open"]);
    assert.equal(names.includes("Secret"), false);
    assert.equal(call("category-delete", ctxB, { id: secret.id }).error, "category not found");
    assert.equal(call("category-list", asMod(ctxB), {}).result.categories.some((c) => c.id === secret.id), true);
    assert.ok(club.id);
  });
});

describe("forum topics & replies", () => {
  it("creates topics, replies and returns the thread", () => {
    const t = call("topic-create", ctxA, { title: "Question", body: "How?", tags: ["help", "Help"] }).result.topic;
    assert.deepEqual(t.tags, ["help"]);
    call("post-reply", ctxA, { topicId: t.id, body: "Answer one" });
    call("post-reply", ctxA, { topicId: t.id, body: "Answer two" });
    const got = call("topic-get", ctxA, { id: t.id });
    assert.equal(got.result.replyCount, 2);
  });

  it("locks a topic and blocks replies", () => {
    const t = call("topic-create", ctxA, { title: "Closed" }).result.topic;
    assert.equal(call("topic-lock", ctxA, { id: t.id, locked: true }).error, "moderator role required");
    call("topic-lock", asMod(ctxA), { id: t.id, locked: true });
    assert.equal(call("post-reply", ctxA, { topicId: t.id, body: "late" }).ok, false);
  });

  it("pins topics to the top of the list", () => {
    const t1 = call("topic-create", ctxA, { title: "Normal" }).result.topic;
    const t2 = call("topic-create", ctxA, { title: "Important" }).result.topic;
    call("topic-pin", asMod(ctxA), { id: t2.id, pinned: true });
    const list = call("topic-list", ctxA, {});
    assert.equal(list.result.topics[0].id, t2.id);
    assert.ok(t1);
  });

  it("deletes a topic and its replies", () => {
    const t = call("topic-create", ctxA, { title: "Temp" }).result.topic;
    call("post-reply", ctxA, { topicId: t.id, body: "x" });
    call("topic-delete", ctxA, { id: t.id });
    assert.equal(call("topic-list", ctxA, {}).result.count, 0);
  });
});

describe("forum voting", () => {
  it("votes on a topic and updates the score", () => {
    const t = call("topic-create", ctxA, { title: "Voted" }).result.topic;
    const up = call("vote", ctxA, { targetType: "topic", targetId: t.id, direction: 1 });
    assert.equal(up.result.score, 1);
    const clear = call("vote", ctxA, { targetType: "topic", targetId: t.id, direction: 0 });
    assert.equal(clear.result.score, 0);
  });

  it("sorts topics by top score", () => {
    const t1 = call("topic-create", ctxA, { title: "Low" }).result.topic;
    const t2 = call("topic-create", ctxA, { title: "High" }).result.topic;
    call("vote", ctxA, { targetType: "topic", targetId: t2.id, direction: 1 });
    const list = call("topic-list", ctxA, { sort: "top" });
    assert.equal(list.result.topics[0].id, t2.id);
    assert.ok(t1);
  });
});

describe("forum moderation", () => {
  it("creates flags, queues them and resolves", () => {
    const t = call("topic-create", ctxA, { title: "Reported" }).result.topic;
    const flag = call("flag-create", ctxA, { targetType: "topic", targetId: t.id, reason: "spam" }).result.flag;
    assert.equal(call("flag-queue", ctxA, {}).error, "moderator role required");
    assert.equal(call("forum-dashboard", ctxA, {}).result.pendingFlags, 0);
    assert.equal(call("flag-queue", asMod(ctxA), {}).result.pendingCount, 1);
    call("flag-resolve", asMod(ctxA), { id: flag.id, action: "content_removed" });
    const q = call("flag-queue", asMod(ctxA), {});
    assert.equal(q.result.pendingCount, 0);
    assert.equal(q.result.resolvedCount, 1);
  });
});

describe("forum reputation & search", () => {
  it("computes a trust tier from contributions", () => {
    for (let i = 0; i < 6; i++) call("topic-create", ctxA, { title: `T${i}` });
    const rep = call("user-reputation", ctxA, {});
    assert.equal(rep.result.tier, "basic");
    assert.equal(rep.result.contributions, 6);
  });

  it("searches topic titles, bodies and replies", () => {
    const t = call("topic-create", ctxA, { title: "Recipe ideas", body: "share your best" }).result.topic;
    call("post-reply", ctxA, { topicId: t.id, body: "pasta is great" });
    assert.equal(call("forum-search", ctxA, { query: "recipe" }).result.topicHits, 1);
    assert.equal(call("forum-search", ctxA, { query: "pasta" }).result.matchingReplies, 1);
  });

  it("dashboard rolls up the community", () => {
    call("category-create", ctxA, { name: "C" });
    const t = call("topic-create", ctxA, { title: "T" }).result.topic;
    call("post-reply", ctxA, { topicId: t.id, body: "r" });
    const d = call("forum-dashboard", ctxA, {});
    assert.equal(d.result.categories, 1);
    assert.equal(d.result.topics, 1);
    assert.equal(d.result.replies, 1);
  });
});

describe("forum nested comment trees", () => {
  it("builds a nested reply tree from parentId links", () => {
    const t = call("topic-create", ctxA, { title: "Tree" }).result.topic;
    const top = call("post-reply", ctxA, { topicId: t.id, body: "level 1" }).result.post;
    const child = call("post-reply", ctxA, { topicId: t.id, body: "level 2", parentId: top.id }).result.post;
    call("post-reply", ctxA, { topicId: t.id, body: "level 3", parentId: child.id });
    const got = call("topic-get", ctxA, { id: t.id });
    assert.equal(got.result.tree.length, 1);
    assert.equal(got.result.tree[0].replies.length, 1);
    assert.equal(got.result.tree[0].replies[0].replies.length, 1);
    assert.equal(got.result.tree[0].replies[0].depth, 1);
    assert.equal(got.result.replyCount, 3);
  });

  it("ignores a parentId from a different topic", () => {
    const t1 = call("topic-create", ctxA, { title: "T1" }).result.topic;
    const t2 = call("topic-create", ctxA, { title: "T2" }).result.topic;
    const foreign = call("post-reply", ctxA, { topicId: t1.id, body: "x" }).result.post;
    const reply = call("post-reply", ctxA, { topicId: t2.id, body: "y", parentId: foreign.id }).result.post;
    assert.equal(reply.parentId, null);
  });
});

describe("forum rich content", () => {
  it("stores markdown format and image embeds on topics and posts", () => {
    const t = call("topic-create", ctxA, {
      title: "Rich", body: "**bold**", format: "markdown",
      images: ["https://example.com/a.png", ""],
    }).result.topic;
    assert.equal(t.format, "markdown");
    assert.deepEqual(t.images, ["https://example.com/a.png"]);
    const p = call("post-reply", ctxA, {
      topicId: t.id, body: "_em_", format: "markdown", images: ["https://example.com/b.png"],
    }).result.post;
    assert.equal(p.format, "markdown");
    assert.equal(p.images.length, 1);
  });
});

describe("forum subforums", () => {
  it("creates a subforum with rules and a mod team", () => {
    const sf = call("subforum-create", ctxA, {
      name: "Producers", description: "beats", rules: ["Be kind"],
    }).result.subforum;
    assert.equal(sf.slug, "producers");
    assert.equal(sf.rules.length, 1);
    assert.equal(sf.moderators.length, 1);
    const list = call("subforum-list", ctxA, {});
    assert.equal(list.result.count, 1);
  });

  it("rejects duplicate subforum slug", () => {
    call("subforum-create", ctxA, { name: "Dup" });
    const r = call("subforum-create", ctxA, { name: "Dup" });
    assert.equal(r.ok, false);
  });

  it("updates rules and adds moderators", () => {
    const sf = call("subforum-create", ctxA, { name: "Mods" }).result.subforum;
    call("subforum-update-rules", ctxA, { id: sf.id, rules: ["A", "B"] });
    const upd = call("subforum-add-mod", ctxA, { id: sf.id, moderator: "Alice" });
    assert.equal(upd.result.moderators.includes("Alice"), true);
    const list = call("subforum-list", ctxA, {});
    assert.equal(list.result.subforums[0].rules.length, 2);
  });

  it("links topics to a subforum and counts them", () => {
    const sf = call("subforum-create", ctxA, { name: "Linked" }).result.subforum;
    call("topic-create", ctxA, { title: "In subforum", subforumId: sf.id });
    const list = call("subforum-list", ctxA, {});
    assert.equal(list.result.subforums[0].topicCount, 1);
    const filtered = call("topic-list", ctxA, { subforumId: sf.id });
    assert.equal(filtered.result.count, 1);
  });

  it("shares public communities and hides private ones from non-members", () => {
    call("subforum-create", ctxA, { name: "Public Room" });
    call("subforum-create", ctxA, { name: "Private Room", visibility: "private" });
    const names = call("subforum-list", ctxB, {}).result.subforums.map((f) => f.name);
    assert.deepEqual(names, ["Public Room"]);
  });
});

describe("forum subscriptions & notifications", () => {
  it("subscribes to a thread and notifies on new replies", () => {
    const t = call("topic-create", ctxA, { title: "Watched" }).result.topic;
    const sub = call("thread-subscribe", ctxA, { topicId: t.id });
    assert.equal(sub.result.subscribed, true);
    call("post-reply", ctxA, { topicId: t.id, body: "ping" });
    const notes = call("notification-list", ctxA, {});
    assert.equal(notes.result.unread, 1);
    assert.equal(notes.result.notifications[0].kind, "reply");
  });

  it("lists subscriptions and toggles them off", () => {
    const t = call("topic-create", ctxA, { title: "Toggle" }).result.topic;
    call("thread-subscribe", ctxA, { topicId: t.id });
    assert.equal(call("subscription-list", ctxA, {}).result.count, 1);
    const off = call("thread-subscribe", ctxA, { topicId: t.id });
    assert.equal(off.result.subscribed, false);
    assert.equal(call("subscription-list", ctxA, {}).result.count, 0);
  });

  it("marks notifications as read", () => {
    const t = call("topic-create", ctxA, { title: "Read" }).result.topic;
    call("thread-subscribe", ctxA, { topicId: t.id });
    call("post-reply", ctxA, { topicId: t.id, body: "r" });
    const r = call("notification-read", ctxA, {});
    assert.equal(r.result.unread, 0);
  });
});

describe("forum awards", () => {
  it("exposes an award catalog", () => {
    const cat = call("award-catalog", ctxA, {});
    assert.ok(cat.result.awards.length >= 3);
    assert.ok(cat.result.awards.every((a) => a.id && a.icon));
  });

  it("gives an award to a topic and rejects unknown kinds", () => {
    const t = call("topic-create", ctxA, { title: "Awardable" }).result.topic;
    const ok = call("award-give", ctxA, { targetType: "topic", targetId: t.id, kind: "gold" });
    assert.equal(ok.result.awards.length, 1);
    assert.equal(ok.result.awards[0].kind, "gold");
    const bad = call("award-give", ctxA, { targetType: "topic", targetId: t.id, kind: "bogus" });
    assert.equal(bad.ok, false);
  });

  it("gives an award to a post", () => {
    const t = call("topic-create", ctxA, { title: "T" }).result.topic;
    const p = call("post-reply", ctxA, { topicId: t.id, body: "great answer" }).result.post;
    const r = call("award-give", ctxA, { targetType: "post", targetId: p.id, kind: "helpful" });
    assert.equal(r.result.awards.length, 1);
  });
});

describe("forum saved posts, history & profile", () => {
  it("toggles saved posts and lists them", () => {
    const t = call("topic-create", ctxA, { title: "Saveable" }).result.topic;
    const on = call("save-toggle", ctxA, { targetType: "topic", targetId: t.id });
    assert.equal(on.result.saved, true);
    assert.equal(call("saved-list", ctxA, {}).result.count, 1);
    const off = call("save-toggle", ctxA, { targetType: "topic", targetId: t.id });
    assert.equal(off.result.saved, false);
    assert.equal(call("saved-list", ctxA, {}).result.count, 0);
  });

  it("returns post history in reverse chronological order", () => {
    const t = call("topic-create", ctxA, { title: "Hist" }).result.topic;
    call("post-reply", ctxA, { topicId: t.id, body: "reply" });
    const h = call("post-history", ctxA, {});
    assert.equal(h.result.count, 2);
    assert.ok(h.result.history.some((x) => x.type === "topic"));
    assert.ok(h.result.history.some((x) => x.type === "reply"));
  });

  it("builds a user profile with karma and award breakdown", () => {
    const t = call("topic-create", ctxA, { title: "Profiled" }).result.topic;
    call("vote", ctxA, { targetType: "topic", targetId: t.id, direction: 1 });
    call("award-give", ctxA, { targetType: "topic", targetId: t.id, kind: "gold" });
    const p = call("user-profile", ctxA, {});
    assert.equal(p.result.topics, 1);
    assert.equal(p.result.karma, 1);
    assert.equal(p.result.awardsEarned, 1);
    assert.equal(p.result.awardBreakdown.gold, 1);
  });
});

describe("forum trending", () => {
  it("ranks topics by a hot score blending votes, replies and age", () => {
    const cold = call("topic-create", ctxA, { title: "Cold" }).result.topic;
    const hot = call("topic-create", ctxA, { title: "Hot" }).result.topic;
    call("vote", ctxA, { targetType: "topic", targetId: hot.id, direction: 1 });
    call("post-reply", ctxA, { topicId: hot.id, body: "engaged" });
    const r = call("trending", ctxA, { limit: 10 });
    assert.equal(r.result.trending[0].id, hot.id);
    assert.ok(typeof r.result.trending[0].hotScore === "number");
    assert.ok(cold);
  });

  it("applies a personalization boost from tag affinity", () => {
    const t = call("topic-create", ctxA, { title: "Tagged", tags: ["jazz"] }).result.topic;
    call("post-reply", ctxA, { topicId: t.id, body: "I love jazz" });
    const other = call("topic-create", ctxA, { title: "Jazz again", tags: ["jazz"] }).result.topic;
    const r = call("trending", ctxA, { personalize: true });
    const ranked = r.result.trending.find((x) => x.id === other.id);
    assert.ok(ranked.personalBoost > 0);
    assert.ok(r.result.affinityTags.some((a) => a.tag === "jazz"));
  });

  it("returns an empty trending list when there are no topics", () => {
    const r = call("trending", ctxA, {});
    assert.equal(r.result.count, 0);
    assert.deepEqual(r.result.trending, []);
  });
});

// Additional coverage for the macro paths the rebuilt forum UI relies on
// (nested-tree panel, rich editor, communities, inbox, profile page).
describe("forum UI macro coverage", () => {
  it("carries markdown format, images and awards through the comment tree", () => {
    const t = call("topic-create", ctxA, { title: "Tree rich" }).result.topic;
    const root = call("post-reply", ctxA, {
      topicId: t.id, body: "**root**", format: "markdown",
      images: ["https://example.com/x.png"],
    }).result.post;
    call("award-give", ctxA, { targetType: "post", targetId: root.id, kind: "insightful" });
    call("post-reply", ctxA, { topicId: t.id, body: "child", parentId: root.id });
    const got = call("topic-get", ctxA, { id: t.id });
    const node = got.result.tree[0];
    assert.equal(node.format, "markdown");
    assert.equal(node.images.length, 1);
    assert.equal(node.awards[0].kind, "insightful");
    assert.ok(node.awards[0].icon);
    assert.equal(node.replies.length, 1);
  });

  it("topic-get reports subscription state for the watched-thread UI", () => {
    const t = call("topic-create", ctxA, { title: "Watch me" }).result.topic;
    assert.equal(call("topic-get", ctxA, { id: t.id }).result.subscribed, false);
    call("thread-subscribe", ctxA, { topicId: t.id });
    assert.equal(call("topic-get", ctxA, { id: t.id }).result.subscribed, true);
  });

  it("filters topics by subforum for the communities picker", () => {
    const sf = call("subforum-create", ctxA, { name: "Picker" }).result.subforum;
    call("topic-create", ctxA, { title: "In", subforumId: sf.id });
    call("topic-create", ctxA, { title: "Out" });
    const inSub = call("topic-list", ctxA, { subforumId: sf.id });
    assert.equal(inSub.result.count, 1);
    assert.equal(inSub.result.topics[0].title, "In");
  });

  it("dashboard surfaces inbox and saved counts for the section header", () => {
    const t = call("topic-create", ctxA, { title: "Dash" }).result.topic;
    call("thread-subscribe", ctxA, { topicId: t.id });
    call("post-reply", ctxA, { topicId: t.id, body: "ping" });
    call("save-toggle", ctxA, { targetType: "topic", targetId: t.id });
    const d = call("forum-dashboard", ctxA, {}).result;
    assert.equal(d.subscriptions, 1);
    assert.equal(d.unreadNotifications, 1);
    assert.equal(d.savedPosts, 1);
  });

  it("removes a rule from a subforum via update-rules", () => {
    const sf = call("subforum-create", ctxA, { name: "Rules2", rules: ["A", "B", "C"] }).result.subforum;
    call("subforum-update-rules", ctxA, { id: sf.id, rules: ["A", "C"] });
    const list = call("subforum-list", ctxA, {});
    assert.deepEqual(list.result.subforums[0].rules, ["A", "C"]);
  });
});

describe("forum shared board", () => {
  it("lets B read, reply, and upvote a topic A posted, and only A can delete it", () => {
    const t = call("topic-create", ctxA, { title: "From A", body: "hello board" }).result.topic;
    assert.equal(t.authorId, "user_a");
    const listed = call("topic-list", ctxB, {});
    assert.equal(listed.result.topics.some((x) => x.id === t.id), true);
    const got = call("topic-get", ctxB, { id: t.id });
    assert.equal(got.ok, true);
    assert.equal(got.result.topic.title, "From A");

    const reply = call("post-reply", ctxB, { topicId: t.id, body: "from B" });
    assert.equal(reply.ok, true);
    assert.equal(reply.result.post.authorId, "user_b");

    assert.equal(call("vote", ctxB, { targetType: "topic", targetId: t.id, direction: 1 }).result.score, 1);
    assert.equal(call("vote", ctxB, { targetType: "topic", targetId: t.id, direction: 1 }).result.score, 1);
    assert.equal(call("vote", ctxA, { targetType: "topic", targetId: t.id, direction: 1 }).result.score, 2);

    const locked = call("topic-lock", ctxB, { id: t.id });
    assert.equal(locked.ok, false);
    assert.equal(locked.error, "moderator role required");
    const removed = call("topic-delete", ctxB, { id: t.id });
    assert.equal(removed.ok, false);
    assert.equal(removed.error, "only the author can delete");
    assert.equal(call("topic-delete", asMod(ctxB), { id: t.id }).error, "only the author can delete");

    assert.equal(call("topic-delete", ctxA, { id: t.id }).ok, true);
    assert.equal(call("topic-get", ctxB, { id: t.id }).error, "topic not found");
    assert.equal(call("topic-list", ctxA, {}).result.count, 0);
  });

  it("hides a topic filed in a private category from non-members", () => {
    const cat = call("category-create", ctxA, { name: "Inner", visibility: "private" }).result.category;
    const hidden = call("topic-create", ctxA, { title: "Quiet", categoryId: cat.id }).result.topic;
    assert.equal(call("topic-list", ctxB, {}).result.count, 0);
    assert.equal(call("topic-get", ctxB, { id: hidden.id }).error, "topic not found");
    const invited = call("category-create", ctxA, {
      name: "Invited", visibility: "private", members: ["user_b"],
    }).result.category;
    const visible = call("topic-create", ctxA, { title: "Welcome in", categoryId: invited.id }).result.topic;
    const titles = call("topic-list", ctxB, {}).result.topics.map((x) => x.id);
    assert.deepEqual(titles, [visible.id]);
  });

  it("folds legacy per-user maps into the shared store without deleting them", () => {
    const createdAt = "2026-01-01T00:00:00.000Z";
    globalThis._concordSTATE.forumLens = {
      categories: new Map([["user_a", [{ id: "cat_old", name: "Legacy" }]]]),
      topics: new Map([["user_a", [{
        id: "top_old", title: "Legacy topic", body: "kept", tags: ["old"],
        voters: { user_a: 1 }, score: 1, createdAt, updatedAt: createdAt,
      }]]]),
      posts: new Map([["user_a", [{
        id: "pst_old", topicId: "top_old", body: "legacy reply", author: "Ada",
        voters: {}, score: 0, createdAt,
      }]]]),
      subforums: new Map(),
      flags: new Map(),
    };
    const list = call("topic-list", ctxB, {});
    assert.equal(list.result.count, 1);
    assert.equal(list.result.topics[0].id, "top_old");
    assert.equal(list.result.topics[0].authorId, "user_a");
    assert.equal(list.result.topics[0].replyCount, 1);
    const again = call("topic-list", ctxB, {});
    assert.equal(again.result.count, 1);
    const source = globalThis._concordSTATE.forumLens.topics.get("user_a");
    assert.equal(source.length, 1);
    assert.equal(source[0].title, "Legacy topic");
    assert.equal(call("category-list", ctxB, {}).result.categories[0].authorId, "user_a");

    assert.equal(call("topic-delete", ctxA, { id: "top_old" }).ok, true);
    assert.equal(call("topic-list", ctxB, {}).result.count, 0);
    assert.equal(globalThis._concordSTATE.forumLens.topics.get("user_a").length, 1);
    assert.equal(call("topic-list", ctxA, {}).result.count, 0);
  });

  it("rejects an unsigned reader", () => {
    const anon = call("topic-list", { actor: { userId: "anon" }, userId: "anon" }, {});
    assert.equal(anon.ok, false);
    assert.equal(anon.error, "sign in required");
    assert.equal(call("topic-create", {}, { title: "Nope" }).error, "sign in required");
  });

  it("trending on an empty board is an empty list", () => {
    const r = call("trending", ctxA, {});
    assert.equal(r.result.count, 0);
    assert.deepEqual(r.result.trending, []);
    assert.deepEqual(r.result.affinityTags, []);
  });
});
