/**
 * Packet A — cross-account READ leaks.
 *
 * Archaeology, indexed dtu.search hits, and artistry drafts must not leak
 * account A's private rows to account B. Shared catalogs stay shared, but
 * their payloads do not carry another account's raw id.
 *
 * Run:
 *   NODE_ENV=test node --test --import=./tests/preload/no-egress.mjs tests/cross-account-read-leaks.test.js
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { privateDtuHiddenFrom, ctxMayReadDtu } from "../lib/dtu-read-access.js";
import {
  handleArchaeology,
  handleSubstrateDiff,
  handleTimeCrystalDetect,
} from "../lib/knowledge-archaeology.js";
import {
  filterVisibleSearchHits,
  materializeIndexedHits,
} from "../lib/dtu-search-hits.js";
import { fallThroughDtuGet } from "../lib/chat/dtu-get-fallthrough.js";
import registerArtistry from "../domains/artistry.js";
import registerCollab from "../domains/collab.js";
import registerFitness from "../domains/fitness.js";
import registerFood from "../domains/food.js";
import registerMentorship from "../domains/mentorship.js";
import registerMusic from "../domains/music.js";
import registerTimeline from "../domains/timeline.js";

const A = { actor: { userId: "user_a" }, userId: "user_a" };
const B = { actor: { userId: "user_b" }, userId: "user_b" };

function harness(register) {
  const actions = new Map();
  register((d, n, fn) => actions.set(`${d}.${n}`, fn));
  const call = (name, ctx, input = {}) => {
    const fn = actions.get(name);
    if (!fn) throw new Error(`missing ${name}`);
    return fn(ctx, { id: null, domain: name.split(".")[0], type: "domain_action", data: {}, meta: {} }, input);
  };
  return call;
}

function invoke(handler, { userId, role } = {}) {
  const req = {
    actor: userId ? { userId, id: userId, role: role || "member" } : undefined,
    query: {},
    get() { return ""; },
  };
  const res = {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  handler(req, res);
  return { status: res.statusCode, body: res.body };
}

describe("archaeology and substrate diff", () => {
  const secret = {
    id: "dtu_secret_a",
    title: "ledger coffee 18.40",
    domain: "ledger",
    tier: "regular",
    ownerId: "user_a",
    author: "user_a",
    userId: "user_a",
    visibility: "private",
    privacy: "private",
    scope: "user",
    createdAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
  };
  const pub = {
    id: "dtu_public",
    title: "public note",
    domain: "notes",
    tier: "regular",
    visibility: "public",
    scope: "global",
    createdAt: secret.createdAt,
  };

  function visible(viewerId) {
    return [secret, pub].filter((d) => !privateDtuHiddenFrom(d, viewerId) && d.visibility !== "internal");
  }

  const diffState = {
    dtus: new Map([[secret.id, secret], [pub.id, pub]]),
    swarms: [],
    timeCrystals: [],
  };

  it("hides A's private On This Day title from B and from anon", () => {
    const anon = invoke((req, res) => handleArchaeology(req, res, visible));
    assert.equal(anon.status, 401);
    const b = invoke((req, res) => handleArchaeology(req, res, visible), { userId: "user_b" });
    const week = b.body.memories["1 week ago"];
    assert.equal(week.some((m) => m.id === secret.id || m.title === secret.title), false);
    assert.equal(week.some((m) => m.id === pub.id), true);
    const a = invoke((req, res) => handleArchaeology(req, res, visible), { userId: "user_a" });
    assert.equal(a.body.memories["1 week ago"].some((m) => m.id === secret.id && m.title === secret.title), true);
  });

  it("refuses anonymous substrate diff and keeps the body aggregate", () => {
    const anon = invoke((req, res) => handleSubstrateDiff(req, res, diffState));
    assert.equal(anon.status, 401);
    const a = invoke((req, res) => handleSubstrateDiff(req, res, diffState), { userId: "user_a" });
    assert.equal(a.status, 200);
    assert.equal(typeof a.body.diff.newDTUs, "number");
    assert.equal(JSON.stringify(a.body).includes(secret.title), false);
  });

  it("limits time-crystal detect to an operator", () => {
    const anon = invoke((req, res) => handleTimeCrystalDetect(req, res, () => [{ id: "c1" }]));
    assert.equal(anon.status, 401);
    const member = invoke((req, res) => handleTimeCrystalDetect(req, res, () => [{ id: "c1" }]), { userId: "user_b", role: "member" });
    assert.equal(member.status, 403);
    const op = invoke((req, res) => handleTimeCrystalDetect(req, res, () => [{ id: "c1" }]), { userId: "user_a", role: "admin" });
    assert.equal(op.status, 200);
    assert.equal(op.body.count, 1);
  });
});

describe("dtu.search indexed hits", () => {
  const secret = {
    id: "dtu_zz_secret",
    title: "zz-secret-A",
    ownerId: "user_a",
    author: "user_a",
    visibility: "private",
    privacy: "private",
    scope: "user",
    tier: "regular",
  };

  it("drops another account's private hit, a missing id, and applies limit after the filter", () => {
    const evicted = [];
    const live = materializeIndexedHits(
      [{ id: secret.id, score: 2 }, { id: "gone", score: 9 }, { id: "pub1", score: 1 }],
      {
        getLive: (id) => (id === secret.id ? secret : id === "pub1" ? { id: "pub1", title: "zz-secret-A public", visibility: "public", scope: "global", tier: "regular" } : null),
        evict: (id) => evicted.push(id),
        isShadow: (d) => d.tier === "shadow",
      },
    );
    assert.deepEqual(evicted, ["gone"]);
    assert.equal(live.some((d) => !d.id), false);
    const visibleB = new Set(["pub1"]);
    const b = filterVisibleSearchHits(live, { visibleIds: visibleB, limit: 20 });
    assert.equal(b.length, 1);
    assert.equal(b[0].id, "pub1");
    const visibleA = new Set([secret.id, "pub1"]);
    const a = filterVisibleSearchHits(live, { visibleIds: visibleA, limit: 1 });
    assert.equal(a.length, 1);
    assert.equal(a[0].id, secret.id);
  });

  it("dtu.get predicate refuses A's private DTU to B", () => {
    assert.equal(ctxMayReadDtu({ actor: { userId: "user_b", id: "user_b" } }, secret), false);
    assert.equal(ctxMayReadDtu({ actor: { userId: "user_a", id: "user_a" } }, secret), true);
  });
});

describe("chat dtu.get falls through to the next search hit", () => {
  it("replaces a not-found get with the next search id", async () => {
    const prior = [{
      ok: true,
      domain: "dtu",
      action: "search",
      result: { query: "zz", dtus: [{ id: "missing" }, { id: "live" }] },
    }];
    const failed = { ok: false, domain: "dtu", action: "get", input: { id: "missing" }, error: "DTU not found" };
    const next = await fallThroughDtuGet(failed, prior, async (id) => (
      id === "live" ? { ok: true, domain: "dtu", action: "get", input: { id }, result: { dtu: { id, title: "live" } } } : { ok: false, domain: "dtu", action: "get", error: "DTU not found" }
    ));
    assert.equal(next.ok, true);
    assert.equal(next.result.dtu.id, "live");
    assert.equal(next.fellThroughFrom, "missing");
  });
});

describe("artistry projectView", () => {
  const call = harness(registerArtistry);
  beforeEach(() => { globalThis._concordSTATE = {}; globalThis._concordSaveStateDebounced = () => {}; });

  it("refuses an unpublished project to B, then shows it without A's user id", () => {
    const created = call("artistry.projectCreate", A, { title: "Draft study", published: false });
    assert.equal(created.ok, true);
    const id = created.result.project.id;
    const denied = call("artistry.projectView", B, { projectId: id });
    assert.equal(denied.ok, false);
    assert.equal(denied.error, "project_not_found");
    assert.equal(call("artistry.projectView", A, { projectId: id }).result.project.views, 0);
    call("artistry.projectUpdate", A, { projectId: id, published: true });
    const seen = call("artistry.projectView", B, { projectId: id });
    assert.equal(seen.ok, true);
    assert.equal(seen.result.project.views, 1);
    assert.equal(seen.result.project.isMine, false);
    assert.equal(Object.hasOwn(seen.result.project, "userId"), false);
    assert.equal(JSON.stringify(seen.result).includes("user_a"), false);
    const mine = call("artistry.projectView", A, { projectId: id });
    assert.equal(mine.result.project.userId, "user_a");
    assert.equal(mine.result.project.views, 1);
  });
});

describe("shared payloads omit another account's raw id", () => {
  beforeEach(() => { globalThis._concordSTATE = {}; globalThis._concordSaveStateDebounced = () => {}; });

  it("collab, fitness, food, mentorship, music, and timeline", () => {
    const collab = harness(registerCollab);
    const doc = collab("collab.docCreate", A, { title: "Shared" }).result;
    const listed = collab("collab.docList", B).result.documents.find((d) => d.id === doc.id);
    assert.equal(listed.isOwner, false);
    assert.equal(Object.hasOwn(listed, "ownerId"), false);
    assert.ok(listed.ownerDisplayName);
    assert.equal(collab("collab.docList", A).result.documents.find((d) => d.id === doc.id).ownerId, "user_a");

    const fit = harness(registerFitness);
    const seg = fit("fitness.segment-create", A, { name: "Hill", distanceKm: 1 }).result.segment;
    const segB = fit("fitness.segment-list", B).result.segments.find((s) => s.id === seg.id);
    assert.equal(Object.hasOwn(segB, "ownerUserId"), false);
    const club = fit("fitness.club-create", A, { name: "Run club" }).result.club;
    const clubB = fit("fitness.club-list", B).result.clubs.find((c) => c.id === club.id);
    assert.equal(Object.hasOwn(clubB, "ownerUserId"), false);
    assert.equal(Object.hasOwn(clubB, "members"), false);
    const chal = fit("fitness.challenge-create", A, { name: "May", metric: "distance", target: 10 }).result.challenge;
    const chalB = fit("fitness.challenge-list", B).result.challenges.find((c) => c.id === chal.id);
    assert.equal(JSON.stringify(chalB).includes("user_a"), false);

    const food = harness(registerFood);
    const biz = food("food.biz-create", A, { name: "Cafe", cuisine: "coffee" }).result.business;
    const bizB = food("food.biz-list", B).result.businesses.find((b) => b.id === biz.id);
    assert.equal(Object.hasOwn(bizB, "ownerUserId"), false);
    food("food.review-create", A, { bizId: biz.id, rating: 5, text: "good" });
    const detail = food("food.biz-detail", B, { id: biz.id }).result;
    assert.equal(JSON.stringify(detail).includes("user_a"), false);

    const mentor = harness(registerMentorship);
    const registered = mentor("mentorship.mentor-register", A, { name: "Ada" });
    assert.equal(registered.ok, true, JSON.stringify(registered));
    const added = mentor("mentorship.review-add", B, { mentorId: "user_a", rating: 5, comment: "helpful", authorName: "Bea" });
    assert.equal(added.ok, true, JSON.stringify(added));
    const reviews = mentor("mentorship.review-list", A, { mentorId: "user_a" }).result.reviews;
    assert.equal(reviews.length, 1);
    assert.equal(Object.hasOwn(reviews[0], "authorId"), false);
    assert.equal(JSON.stringify(reviews).includes("user_b"), false);

    const music = harness(registerMusic);
    const trackA = music("music.track-add", A, { title: "Song A" }).result.track;
    const trackB = music("music.track-add", B, { title: "Song B" }).result.track;
    const pl = music("music.playlist-create", A, { name: "Collab", collaborative: true }).result.playlist;
    assert.equal(music("music.playlist-collab-edit", A, { playlistId: pl.id, trackId: trackA.id, op: "add" }).ok, true);
    const edit = music("music.playlist-collab-edit", B, { playlistId: pl.id, trackId: trackB.id, op: "add" });
    assert.equal(edit.ok, true, JSON.stringify(edit));
    const foreign = edit.result.collabLog.filter((e) => e.isMine === false);
    assert.ok(foreign.length >= 1);
    assert.equal(JSON.stringify(foreign).includes("user_a"), false);

    const timeline = harness(registerTimeline);
    const post = timeline("timeline.post-create", A, { content: "hello", privacy: "public" }).result.post;
    timeline("timeline.comment-add", A, { postId: post.id, text: "note" });
    const thread = timeline("timeline.comment-list", B, { postId: post.id }).result.thread;
    assert.equal(thread.length, 1);
    assert.equal(Object.hasOwn(thread[0], "authorId"), false);
    assert.equal(JSON.stringify(thread).includes("user_a"), false);
    assert.equal(timeline("timeline.comment-list", A, { postId: post.id }).result.thread[0].authorId, "user_a");
  });
});
