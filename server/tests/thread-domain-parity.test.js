// Contract tests for the thread lens — Typefully-shape thread composer
// in server/domains/thread.js.

import { describe, it, before, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import registerThreadActions from "../domains/thread.js";
import Database from "better-sqlite3";
import { up as migrate331 } from "../migrations/331_connector_oauth_tokens.js";
import { _setSocialFetchForTest } from "../lib/social-publish.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`thread.${name}`);
  assert.ok(fn, `thread.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerThreadActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

describe("thread.split-preview", () => {
  it("keeps short text as a single post", () => {
    const r = call("split-preview", ctxA, { content: "Just one short thought." });
    assert.equal(r.result.postCount, 1);
  });
  it("auto-splits long text into numbered posts under the limit", () => {
    const long = Array.from({ length: 12 }, (_, i) => `This is sentence number ${i + 1} of a long thread that must be split.`).join(" ");
    const r = call("split-preview", ctxA, { content: long, limit: 200 });
    assert.ok(r.result.postCount > 1);
    assert.ok(r.result.posts.every((p) => p.chars <= 200));
    assert.match(r.result.posts[0].text, /1\/\d+$/);
  });
});

describe("thread.draft CRUD", () => {
  it("creates a draft, splitting content, scoped per user", () => {
    const r = call("thread-draft", ctxA, { content: "First line of the draft.\n\nSecond paragraph here." });
    assert.equal(r.ok, true);
    assert.ok(r.result.draft.posts.length >= 1);
    assert.equal(call("draft-list", ctxA, {}).result.count, 1);
    assert.equal(call("draft-list", ctxB, {}).result.count, 0);
  });
  it("rejects an empty draft", () => {
    assert.equal(call("thread-draft", ctxA, { content: "" }).ok, false);
  });
  it("update re-splits the content", () => {
    const d = call("thread-draft", ctxA, { content: "short" }).result.draft;
    const long = Array.from({ length: 10 }, () => "A sentence that adds length to force a split here.").join(" ");
    call("draft-update", ctxA, { id: d.id, content: long });
    assert.ok(call("draft-detail", ctxA, { id: d.id }).result.draft.posts.length > 1);
  });
  it("delete removes the draft", () => {
    const d = call("thread-draft", ctxA, { content: "to delete" }).result.draft;
    call("draft-delete", ctxA, { id: d.id });
    assert.equal(call("draft-list", ctxA, {}).result.count, 0);
  });
});

describe("thread.queue + publish", () => {
  it("schedule moves a draft into the queue", () => {
    const d = call("thread-draft", ctxA, { content: "scheduled thread" }).result.draft;
    const sched = call("draft-schedule", ctxA, { id: d.id, scheduledAt: "2099-06-01T09:00:00Z" });
    assert.equal(sched.result.draft.status, "scheduled");
    assert.equal(call("queue-list", ctxA, {}).result.count, 1);
  });
  it("rejects an invalid schedule date", () => {
    const d = call("thread-draft", ctxA, { content: "x y z" }).result.draft;
    assert.equal(call("draft-schedule", ctxA, { id: d.id, scheduledAt: "not-a-date" }).ok, false);
  });
  it("publish flips status and dashboard counts", () => {
    const d = call("thread-draft", ctxA, { content: "publish me now" }).result.draft;
    call("draft-publish", ctxA, { id: d.id });
    const dash = call("thread-dashboard", ctxA, {});
    assert.equal(dash.result.published, 1);
    assert.equal(dash.result.total, 1);
  });
  it("best-time returns a labelled GENERIC guideline when the user has <3 posts", () => {
    const r = call("best-time", ctxA, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.basis, "generic_guideline");
    assert.ok(r.result.slots.length >= 3);
    // honest generic path carries no fabricated per-slot score / recommended
    assert.ok(r.result.slots.every((s) => s.day && s.time && s.rationale));
    assert.match(r.result.note, /not personalised/i);
  });

  it("best-time switches to the user's OWN posting-time distribution once ≥3 posts exist", () => {
    // publish 3 drafts at controlled times
    for (const iso of ["2026-01-06T09:00:00Z", "2026-01-13T09:30:00Z", "2026-01-20T17:00:00Z"]) {
      const d = call("thread-draft", ctxA, { content: `post ${iso}` }).result.draft;
      call("draft-schedule", ctxA, { id: d.id, scheduledAt: iso });
      call("draft-publish", ctxA, { id: d.id });
    }
    const r = call("best-time", ctxA, {});
    assert.equal(r.result.basis, "your_history");
    assert.ok(r.result.sampleSize >= 3);
    assert.ok(r.result.recommended.score >= r.result.slots[r.result.slots.length - 1].score);
    assert.match(r.result.note, /not from audience-engagement data/i);
  });
});

describe("thread — analysis macros still intact", () => {
  it("threadAnalyze handles input", () => {
    const r = call("threadAnalyze", ctxA, {});
    assert.equal(r.ok, true);
  });
});

describe("thread.account multi-account management", () => {
  it("X / Threads / LinkedIn accounts are manual (copy-and-post), never 'connected' by a pasted token", async () => {
    const r = await call("account-connect", ctxA, { platform: "x", handle: "@me", oauthToken: "anything" });
    assert.equal(r.ok, true);
    assert.equal(r.result.account.status, "manual");
    assert.equal(r.result.account.publishMode, "manual");
    assert.equal(r.result.account.handle, "me");
  });
  it("account-list is per-user", async () => {
    await call("account-connect", ctxA, { platform: "x", handle: "alice" });
    assert.equal(call("account-list", ctxA, {}).result.count, 1);
    assert.equal(call("account-list", ctxB, {}).result.count, 0);
  });
  it("account-connect rejects an invalid platform", async () => {
    assert.equal((await call("account-connect", ctxA, { platform: "myspace", handle: "x" })).ok, false);
  });
  it("account-update changes default numbering style", async () => {
    const a = (await call("account-connect", ctxA, { platform: "x", handle: "h1" })).result.account;
    const r = call("account-update", ctxA, { id: a.id, numberingStyle: "emoji" });
    assert.equal(r.result.account.defaults.numberingStyle, "emoji");
  });
  it("account-disconnect removes the account", async () => {
    const a = (await call("account-connect", ctxA, { platform: "x", handle: "h2" })).result.account;
    call("account-disconnect", ctxA, { id: a.id });
    assert.equal(call("account-list", ctxA, {}).result.count, 0);
  });
});

describe("thread.media attachments", () => {
  function draftWith() { return call("thread-draft", ctxA, { content: "media draft body here" }).result.draft; }
  it("media-attach adds an image to a post", () => {
    const d = draftWith();
    const r = call("media-attach", ctxA, { draftId: d.id, postIndex: 1, url: "https://x/a.png", kind: "image" });
    assert.equal(r.ok, true);
    assert.equal(r.result.media.kind, "image");
  });
  it("media-attach rejects a missing url", () => {
    const d = draftWith();
    assert.equal(call("media-attach", ctxA, { draftId: d.id, postIndex: 1, url: "" }).ok, false);
  });
  it("media-list returns attached media grouped by post", () => {
    const d = draftWith();
    call("media-attach", ctxA, { draftId: d.id, postIndex: 1, url: "https://x/a.png" });
    const r = call("media-list", ctxA, { draftId: d.id });
    assert.equal(r.result.count, 1);
  });
  it("media-reorder reorders media within a post", () => {
    const d = draftWith();
    const m1 = call("media-attach", ctxA, { draftId: d.id, postIndex: 1, url: "https://x/1.png" }).result.media;
    const m2 = call("media-attach", ctxA, { draftId: d.id, postIndex: 1, url: "https://x/2.png" }).result.media;
    const r = call("media-reorder", ctxA, { draftId: d.id, postIndex: 1, order: [m2.id, m1.id] });
    assert.equal(r.ok, true);
    assert.equal(r.result.postMedia[0].id, m2.id);
  });
  it("media-remove drops a media item", () => {
    const d = draftWith();
    const m = call("media-attach", ctxA, { draftId: d.id, postIndex: 1, url: "https://x/1.png" }).result.media;
    call("media-remove", ctxA, { draftId: d.id, mediaId: m.id });
    assert.equal(call("media-list", ctxA, { draftId: d.id }).result.count, 0);
  });
});

describe("thread.queue-calendar", () => {
  it("buckets scheduled drafts into a week grid", () => {
    const d = call("thread-draft", ctxA, { content: "cal thread" }).result.draft;
    call("draft-schedule", ctxA, { id: d.id, scheduledAt: "2099-06-03T09:00:00Z" });
    const r = call("queue-calendar", ctxA, { range: "week", anchor: "2099-06-03T00:00:00Z" });
    assert.equal(r.ok, true);
    assert.equal(r.result.range, "week");
    assert.equal(r.result.scheduledCount, 1);
    assert.ok(r.result.cells.some((c) => c.count === 1));
  });
  it("supports a month range", () => {
    const r = call("queue-calendar", ctxA, { range: "month", anchor: "2099-06-15T00:00:00Z" });
    assert.equal(r.result.range, "month");
  });
});

describe("thread.ai assist", () => {
  it("ai-suggest-hook returns multiple hook variants", () => {
    const r = call("ai-suggest-hook", ctxA, { content: "Building software is hard. Here is what I learned over the years." });
    assert.equal(r.ok, true);
    assert.ok(r.result.hooks.length >= 3);
  });
  it("ai-suggest-hook rejects too-short content", () => {
    assert.equal(call("ai-suggest-hook", ctxA, { content: "hi" }).ok, false);
  });
  it("ai-rewrite tightens content", () => {
    const r = call("ai-rewrite", ctxA, { content: "I really just think that this is basically very good.", mode: "tighten" });
    assert.equal(r.ok, true);
    assert.ok(r.result.rewritten.length <= r.result.original.length);
  });
});

describe("thread.numbering styles + CTA templates", () => {
  it("cta-templates lists templates and numbering styles", () => {
    const r = call("cta-templates", ctxA, {});
    assert.ok(r.result.templates.length >= 3);
    assert.ok(r.result.numberingStyles.includes("emoji"));
  });
  it("restyle-preview applies emoji numbering and a CTA", () => {
    const long = Array.from({ length: 10 }, () => "A sentence that adds enough length to force a multi-post split here.").join(" ");
    const r = call("restyle-preview", ctxA, { content: long, numberingStyle: "emoji", ctaText: "Follow for more.", limit: 200 });
    assert.equal(r.ok, true);
    assert.equal(r.result.numberingStyle, "emoji");
    assert.ok(r.result.posts.length > 1);
    assert.match(r.result.posts[r.result.posts.length - 1].text, /Follow for more\./);
  });
});

describe("thread.publish + engagement analytics", () => {
  function dbCtx(userId) {
    const db = new Database(":memory:");
    migrate331(db);
    return { actor: { userId }, userId, db };
  }
  function fakeBluesky({ failAt = Infinity } = {}) {
    const calls = [];
    let n = 0;
    _setSocialFetchForTest(async (url, init) => {
      const body = init?.body ? JSON.parse(init.body) : null;
      calls.push({ url, body });
      const ok = (data) => ({ ok: true, status: 200, json: async () => data });
      if (url.endsWith("createSession")) {
        if (body.password !== "app-pass-1") return { ok: false, status: 401, json: async () => ({ error: "AuthenticationRequired" }) };
        return ok({ did: "did:plc:abc", handle: "me.bsky.social", accessJwt: "jwt" });
      }
      if (url.endsWith("createRecord")) {
        n++;
        if (n >= failAt) return { ok: false, status: 500, json: async () => ({ error: "InternalServerError" }) };
        return ok({ uri: `at://did:plc:abc/app.bsky.feed.post/r${n}`, cid: `c${n}` });
      }
      if (url.includes("getPosts")) return ok({ posts: [{ uri: "at://did:plc:abc/app.bsky.feed.post/r1", likeCount: 7, repostCount: 2, replyCount: 1 }] });
      return { ok: false, status: 404, json: async () => ({}) };
    });
    return calls;
  }
  afterEach(() => _setSocialFetchForTest(null));

  it("a manual account prepares posts to paste and never claims they were posted", async () => {
    const d = call("thread-draft", ctxA, { content: "publish target thread" }).result.draft;
    const a = (await call("account-connect", ctxA, { platform: "x", handle: "pend" })).result.account;
    const r = await call("publish-to-account", ctxA, { draftId: d.id, accountId: a.id });
    assert.equal(r.ok, true);
    assert.equal(r.result.published.status, "ready_to_post");
    assert.equal(r.result.published.dispatch.delivered, false);
    assert.ok(r.result.published.posts[0].text.includes("publish target thread"));
  });

  it("Bluesky: wrong app password is refused; right one connects and publishes a real reply chain", async () => {
    const ctx = dbCtx("bsky_user");
    const calls = fakeBluesky();
    assert.equal((await call("account-connect", ctx, { platform: "bluesky", handle: "me.bsky.social", appPassword: "wrong" })).ok, false);
    const a = (await call("account-connect", ctx, { platform: "bluesky", handle: "me.bsky.social", appPassword: "app-pass-1" })).result.account;
    assert.equal(a.status, "connected");
    const long = Array.from({ length: 30 }, (_, i) => `Sentence number ${i} about building things carefully.`).join(" ");
    const d = call("thread-draft", ctx, { content: long }).result.draft;
    const r = await call("publish-to-account", ctx, { draftId: d.id, accountId: a.id });
    assert.equal(r.ok, true);
    const pub = r.result.published;
    assert.equal(pub.status, "published");
    assert.ok(pub.postCount > 1);
    const creates = calls.filter((c) => c.url.endsWith("createRecord"));
    assert.equal(creates.length, pub.postCount);
    assert.equal(creates[0].body.record.reply, undefined);
    assert.equal(creates[1].body.record.reply.parent.uri, "at://did:plc:abc/app.bsky.feed.post/r1");
    assert.equal(creates[1].body.record.reply.root.uri, "at://did:plc:abc/app.bsky.feed.post/r1");
    assert.equal(pub.posts[0].url, "https://bsky.app/profile/me.bsky.social/post/r1");
    const eng = await call("engagement-fetch", ctx, { publishId: pub.id });
    assert.equal(eng.result.engagement.likes, 7);
    assert.equal(eng.result.engagement.impressions, null);
  });

  it("Bluesky: a failure mid-thread is reported as failed, not published", async () => {
    const ctx = dbCtx("bsky_fail");
    fakeBluesky({ failAt: 2 });
    const a = (await call("account-connect", ctx, { platform: "bluesky", handle: "me.bsky.social", appPassword: "app-pass-1" })).result.account;
    const long = Array.from({ length: 30 }, (_, i) => `Sentence number ${i} about building things carefully.`).join(" ");
    const d = call("thread-draft", ctx, { content: long }).result.draft;
    const r = await call("publish-to-account", ctx, { draftId: d.id, accountId: a.id });
    assert.equal(r.ok, false);
    assert.equal(r.result.published.status, "partially_published");
    assert.equal(r.result.published.dispatch.posted.length, 1);
  });

  it("engagement-sync records user-entered per-post metrics and engagement-report aggregates them", async () => {
    const d = call("thread-draft", ctxA, { content: "report thread body here" }).result.draft;
    const a = (await call("account-connect", ctxA, { platform: "x", handle: "rep" })).result.account;
    const pub = (await call("publish-to-account", ctxA, { draftId: d.id, accountId: a.id })).result.published;
    const r = call("engagement-sync", ctxA, { publishId: pub.id, perPost: [{ postIndex: 1, impressions: 200, likes: 20, reposts: 4, replies: 2 }] });
    assert.equal(r.result.engagement.impressions, 200);
    const rep = call("engagement-report", ctxA, {});
    assert.equal(rep.ok, true);
    assert.equal(rep.result.totals.impressions, 200);
  });
});

describe("thread.publish-mark-posted", () => {
  it("records the user's own confirmation for a ready-to-post thread, once", async () => {
    const d = call("thread-draft", ctxA, { content: "manual post body" }).result.draft;
    const a = (await call("account-connect", ctxA, { platform: "linkedin", handle: "me" })).result.account;
    const pub = (await call("publish-to-account", ctxA, { draftId: d.id, accountId: a.id })).result.published;
    const r = call("publish-mark-posted", ctxA, { publishId: pub.id, url: "https://www.linkedin.com/posts/x" });
    assert.equal(r.ok, true);
    assert.equal(r.result.published.status, "published");
    assert.equal(r.result.published.postedManually, true);
    assert.equal(r.result.published.dispatch.delivered, false);
    assert.equal(call("publish-mark-posted", ctxA, { publishId: pub.id }).ok, false);
    const rep = call("engagement-report", ctxA, {}).result.threads.find((t) => t.publishId === pub.id);
    assert.equal(rep.method, "manual");
    assert.equal(rep.posts[0].url, "https://www.linkedin.com/posts/x");
  });
});
