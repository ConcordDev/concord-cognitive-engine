// Contract tests for server/domains/artistry.js — pure-compute analysis
// macros plus the Behance/ArtStation social-portfolio parity surface
// (projects, follows, comments, appreciations, collections, profiles,
// tag search, job board, curated galleries).

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerArtistryActions from "../domains/artistry.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`artistry.${name}`);
  if (!fn) throw new Error(`artistry.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}
function callArt(name, ctx, data = {}, params = {}) {
  const fn = ACTIONS.get(`artistry.${name}`);
  if (!fn) throw new Error(`artistry.${name} not registered`);
  return fn(ctx, { id: null, data, meta: {} }, params);
}

before(() => { registerArtistryActions(register); });

beforeEach(() => {
  // Fresh isolated state per test so user maps don't leak across cases.
  globalThis._concordSTATE = {};
});

const ctxA = { actor: { userId: "artist_a" }, userId: "artist_a" };
const ctxB = { actor: { userId: "artist_b" }, userId: "artist_b" };

describe("artistry analysis macros (pure-compute)", () => {
  it("colorPaletteAnalysis returns harmony + dominant hue", () => {
    const r = callArt("colorPaletteAnalysis", ctxA, {
      palette: ["#ff0000", "#00ff00", "#0000ff"],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.colorCount, 3);
    assert.ok(typeof r.result.harmonyScore === "number");
    assert.ok(typeof r.result.dominantHueName === "string");
  });

  it("compositionScore evaluates rule-of-thirds", () => {
    const r = callArt("compositionScore", ctxA, {
      canvas: { width: 100, height: 100 },
      elements: [{ x: 25, y: 25, width: 16, height: 16 }],
    });
    assert.equal(r.ok, true);
    assert.ok(typeof r.result.overallScore === "number");
  });

  it("styleClassify identifies a style from tags", () => {
    const r = callArt("styleClassify", ctxA, {
      tags: ["impressionist", "plein air", "oil"],
      attributes: { era: "19th century" },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.classification, "Impressionism");
  });

  it("mediaInventory totals value and flags reorders", () => {
    const r = callArt("mediaInventory", ctxA, {
      supplies: [{ name: "Cobalt Blue", category: "paint", quantity: 1, unitCost: 12, reorderThreshold: 3 }],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.reorderCount, 1);
  });
});

describe("artistry project case studies", () => {
  it("creates, lists, views, updates and deletes a project", () => {
    const created = call("projectCreate", ctxA, {
      title: "Neon City", description: "A study", discipline: "concept-art",
      tools: ["Photoshop"], tags: ["Neon", "City"],
      images: [{ url: "https://x/1.png", caption: "wide" }],
      processSteps: [{ title: "Sketch", detail: "rough lines" }],
    });
    assert.equal(created.ok, true);
    const pid = created.result.project.id;
    assert.equal(created.result.project.tags[0], "neon");

    const listed = call("projectList", ctxA, {});
    assert.equal(listed.ok, true);
    assert.equal(listed.result.count, 1);

    const viewed = call("projectView", ctxB, { projectId: pid });
    assert.equal(viewed.ok, true);
    assert.equal(viewed.result.project.views, 1);

    const updated = call("projectUpdate", ctxA, { projectId: pid, title: "Neon City v2" });
    assert.equal(updated.ok, true);
    assert.equal(updated.result.project.title, "Neon City v2");

    const deleted = call("projectDelete", ctxA, { projectId: pid });
    assert.equal(deleted.ok, true);
    assert.equal(deleted.result.deleted, true);
  });
});

describe("artistry follow graph + personalized feed", () => {
  it("follows, builds graph, and serves a personalized feed", () => {
    call("projectCreate", ctxB, { title: "B Work", discipline: "illustration" });

    const f = call("follow", ctxA, { targetUserId: "artist_b" });
    assert.equal(f.ok, true);
    assert.equal(f.result.followingCount, 1);

    const graph = call("followGraph", ctxA, {});
    assert.equal(graph.ok, true);
    assert.deepEqual(graph.result.following, ["artist_b"]);

    const feed = call("personalizedFeed", ctxA, {});
    assert.equal(feed.ok, true);
    assert.equal(feed.result.mode, "follows");
    assert.equal(feed.result.count, 1);

    const uf = call("unfollow", ctxA, { targetUserId: "artist_b" });
    assert.equal(uf.ok, true);
    assert.equal(uf.result.followingCount, 0);
  });

  it("rejects self-follow", () => {
    const r = call("follow", ctxA, { targetUserId: "artist_a" });
    assert.equal(r.ok, false);
    assert.equal(r.error, "cannot_follow_self");
  });
});

describe("artistry comments + appreciations", () => {
  it("adds, lists and deletes comments + toggles appreciation", () => {
    const proj = call("projectCreate", ctxA, { title: "Commentable" });
    const pid = proj.result.project.id;

    const cmt = call("commentAdd", ctxB, { projectId: pid, body: "Stunning work" });
    assert.equal(cmt.ok, true);
    assert.equal(cmt.result.commentCount, 1);

    const list = call("commentList", ctxA, { projectId: pid });
    assert.equal(list.result.count, 1);

    const ap1 = call("appreciate", ctxB, { projectId: pid });
    assert.equal(ap1.ok, true);
    assert.equal(ap1.result.appreciated, true);
    const ap2 = call("appreciate", ctxB, { projectId: pid });
    assert.equal(ap2.result.appreciated, false);

    const del = call("commentDelete", ctxB, { projectId: pid, commentId: cmt.result.comment.id });
    assert.equal(del.ok, true);
  });
});

describe("artistry collections (save-to-board)", () => {
  it("creates a collection and saves projects to it", () => {
    const proj = call("projectCreate", ctxA, { title: "Savable" });
    const pid = proj.result.project.id;

    const coll = call("collectionCreate", ctxA, { name: "Inspiration" });
    assert.equal(coll.ok, true);
    const cid = coll.result.collection.id;

    const save = call("collectionSave", ctxA, { collectionId: cid, projectId: pid });
    assert.equal(save.ok, true);
    assert.equal(save.result.saved, true);
    assert.equal(save.result.itemCount, 1);

    const items = call("collectionItems", ctxA, { collectionId: cid });
    assert.equal(items.ok, true);
    assert.equal(items.result.count, 1);

    const list = call("collectionList", ctxA, {});
    assert.equal(list.result.count, 1);
  });
});

describe("artistry portfolio profile", () => {
  it("updates and reads a profile with aggregate stats", () => {
    call("projectCreate", ctxA, { title: "Profile Piece" });
    const up = call("profileUpdate", ctxA, {
      displayName: "Ada", headline: "Illustrator", disciplines: ["illustration"],
      availableForHire: true,
    });
    assert.equal(up.ok, true);
    assert.equal(up.result.profile.displayName, "Ada");

    const get = call("profileGet", ctxA, {});
    assert.equal(get.ok, true);
    assert.equal(get.result.isOwner, true);
    assert.equal(get.result.stats.projectCount, 1);
  });
});

describe("artistry tag search + tag cloud", () => {
  it("searches by discipline/tag and builds a tag cloud", () => {
    call("projectCreate", ctxA, { title: "Tagged", discipline: "photography", tags: ["sunset"] });

    const search = call("search", ctxA, { discipline: "photography" });
    assert.equal(search.ok, true);
    assert.equal(search.result.count, 1);

    const cloud = call("tagCloud", ctxA, {});
    assert.equal(cloud.ok, true);
    assert.ok(cloud.result.tags.some((t) => t.tag === "sunset"));
    assert.ok(cloud.result.disciplines.some((d) => d.discipline === "photography"));
  });
});

describe("artistry job board", () => {
  it("posts, lists, applies to and closes a job", () => {
    const post = call("jobPost", ctxA, {
      title: "Book cover commission", kind: "commission",
      discipline: "illustration", budgetMin: 200, budgetMax: 500,
    });
    assert.equal(post.ok, true);
    const jid = post.result.job.id;

    const list = call("jobList", ctxB, {});
    assert.equal(list.ok, true);
    assert.equal(list.result.count, 1);

    const apply = call("jobApply", ctxB, { jobId: jid, message: "I'd love to", quote: 350 });
    assert.equal(apply.ok, true);
    assert.equal(apply.result.applicationCount, 1);

    const dupe = call("jobApply", ctxB, { jobId: jid });
    assert.equal(dupe.ok, false);
    assert.equal(dupe.error, "already_applied");

    const close = call("jobClose", ctxA, { jobId: jid });
    assert.equal(close.ok, true);
    assert.equal(close.result.closed, true);
  });

  it("rejects applying to your own job", () => {
    const post = call("jobPost", ctxA, { title: "Own Job" });
    const r = call("jobApply", ctxA, { jobId: post.result.job.id });
    assert.equal(r.ok, false);
    assert.equal(r.error, "cannot_apply_own_job");
  });
});

describe("artistry curated galleries", () => {
  it("creates a gallery and resolves its published items", () => {
    const proj = call("projectCreate", ctxA, { title: "Gallery Piece" });
    const pid = proj.result.project.id;

    const gal = call("galleryCreate", ctxA, {
      title: "Best of 2026", theme: "Annual", featured: true, projectIds: [pid],
    });
    assert.equal(gal.ok, true);
    const gid = gal.result.gallery.id;

    const list = call("galleryList", ctxB, {});
    assert.equal(list.ok, true);
    assert.equal(list.result.count, 1);
    assert.equal(list.result.galleries[0].projectCount, 1);

    const items = call("galleryItems", ctxB, { galleryId: gid });
    assert.equal(items.ok, true);
    assert.equal(items.result.count, 1);
  });
});
