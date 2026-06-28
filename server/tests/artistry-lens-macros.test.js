// Phase-2 gate — behavioral macro tests for server/domains/artistry.js, the
// Behance/ArtStation-shaped creative-portfolio substrate the /lenses/artistry
// lens + its components drive.
//
// COMPLEMENT to artistry-domain-parity.test.js (which pins happy-path SHAPE).
// This file is the Phase-2 NON-SCORE GATE: it drives each macro with the EXACT
// input field names the live frontend sends and asserts the EXACT output field
// names the components render, with REAL COMPUTED VALUES — so a field rename on
// either side (the "dead surface" failure mode: component reads a field the
// handler never returns → blank in production while shape tests stay green)
// surfaces HERE.
//
// DISPATCH FIDELITY: artistry registers via `registerLensAction(domain, action,
// handler)` (LENS_ACTIONS), reached by /api/lens/run + /api/lens/:domain/:id/run
// and invoked as `handler(ctx, virtualArtifact, input)` — the 3-ARG convention
// with virtualArtifact.data === input. The compute macros read artifact.data.*;
// the social macros read the 3rd `params` arg. Both receive the SAME `input`
// object in the live dispatch (server.js:39287-39288), so our harness passes it
// to BOTH positions, exactly as production does.
//
// MONEY/CORRECTNESS SCRUTINY: the compute macros are pure calculators (no wallet,
// no minting), so the risk is fail-OPEN non-finite output. `parseFloat("Infinity")`
// = Infinity and `Infinity || d` = Infinity, so a naive `parseFloat(x) || d` would
// let a poisoned magnitude flow into a computed total (mediaInventory value,
// composition canvas, palette weight). The domain was hardened with `finNum`
// (non-finite / beyond-1e15 → fallback, FINITE output guaranteed). The poisoned-
// numeric block below pins that every computed total stays finite under
// Infinity / 1e999 / NaN input — fail-CLOSED.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerArtistryActions from "../domains/artistry.js";

const ACTIONS = new Map();
function registerLensAction(domain, name, fn) {
  assert.equal(domain, "artistry", `unexpected domain: ${domain}`);
  ACTIONS.set(name, fn);
}
// Mirror the live dispatch EXACTLY: handler(ctx, virtualArtifact, input) with
// virtualArtifact.data === input (compute macros read artifact.data.*, social
// macros read params — both get the same object).
function call(name, ctx, input = {}) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`artistry.${name} not registered`);
  const virtualArtifact = { id: null, domain: "artistry", type: "domain_action", data: input || {}, meta: {} };
  return fn(ctx, virtualArtifact, input || {});
}

before(() => { registerArtistryActions(registerLensAction); });

beforeEach(() => {
  // Fresh isolated STATE per test so the per-user Maps don't leak.
  globalThis._concordSTATE = {};
  globalThis._concordSaveStateDebounced = () => {};
  globalThis.fetch = async () => { throw new Error("network disabled"); };
});

const ctxA = { actor: { userId: "artist_a" }, userId: "artist_a" };
const ctxB = { actor: { userId: "artist_b" }, userId: "artist_b" };

// Every macro the lens page + its components reach via lensRun / useRunArtifact.
const LENS_MACROS = [
  // compute artifact actions (page Artistry Compute Actions panel, useRunArtifact)
  "colorPaletteAnalysis", "compositionScore", "styleClassify", "mediaInventory",
  // ProjectStudio.tsx
  "projectCreate", "projectList", "projectView", "projectUpdate", "projectDelete",
  "appreciate", "commentAdd",
  // CommunityNetwork.tsx
  "personalizedFeed", "followGraph", "follow", "unfollow",
  // Collections.tsx
  "collectionCreate", "collectionList", "collectionSave", "collectionItems",
  // PortfolioProfile.tsx
  "profileGet", "profileUpdate",
  // DisciplineSearch.tsx
  "search", "tagCloud",
  // JobBoard.tsx
  "jobPost", "jobList", "jobApply", "jobClose",
  // CuratedGalleries.tsx
  "galleryCreate", "galleryList", "galleryItems",
  // comment list/delete (round-trip completeness)
  "commentList", "commentDelete",
];

describe("artistry — registration (every lens-driven macro present)", () => {
  it("registers every macro the lens page + components call", () => {
    for (const m of LENS_MACROS) {
      assert.ok(ACTIONS.has(m), `artistry.${m} must be registered (a lens component calls it)`);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Compute Actions — the page renders EXACT fields from each result. We pin the
// real computed value (not just typeof) so the page's rendered numbers are live.
// ─────────────────────────────────────────────────────────────────────────────
describe("artistry compute — colorPaletteAnalysis (page renders harmonyScore/dominantHue/contrastRange/colors[].hex)", () => {
  it("computes harmony + dominant hue + contrast the page renders", () => {
    // Input: artifact.data.palette (page passes the artifact's stored data).
    const r = call("colorPaletteAnalysis", ctxA, { palette: ["#ff0000", "#00ff00", "#0000ff"] });
    assert.equal(r.ok, true);
    // EXACT fields the page reads (page.tsx:252-261).
    assert.equal(typeof r.result.harmonyScore, "number");
    assert.ok(Number.isFinite(r.result.harmonyScore));
    assert.equal(typeof r.result.dominantHue, "number"); // page renders {dominantHue}; gate: dominantHue !== undefined
    assert.equal(typeof r.result.contrastRange, "number");
    // pure red/green/blue are all 50% lightness → contrast range exactly 0.
    assert.equal(r.result.contrastRange, 0);
    assert.ok(Array.isArray(r.result.colors));
    assert.equal(r.result.colors[0].hex, "#ff0000"); // colors[].hex swatch
    assert.equal(r.result.colorCount, 3);
  });

  it("DEGRADE-GRACEFUL: empty palette returns the page's honest message + colors:[]", () => {
    const r = call("colorPaletteAnalysis", ctxA, { palette: [] });
    assert.equal(r.ok, true);
    assert.equal(typeof r.result.message, "string"); // page renders actionResult.message fallback
    assert.deepEqual(r.result.colors, []);
    assert.equal(r.result.harmonyScore, 0);
  });

  it("FAIL-CLOSED: poisoned weight (Infinity) keeps harmonyScore + dominantHue finite", () => {
    const r = call("colorPaletteAnalysis", ctxA, {
      palette: [{ color: "#ff0000", weight: "Infinity" }, { color: "#0000ff", weight: "1e999" }],
    });
    assert.equal(r.ok, true);
    assert.ok(Number.isFinite(r.result.harmonyScore), "harmonyScore must stay finite");
    assert.ok(Number.isFinite(r.result.dominantHue), "dominantHue must stay finite");
    assert.ok(Number.isFinite(r.result.averageSaturation));
    assert.ok(Number.isFinite(r.result.averageLightness));
  });
});

describe("artistry compute — compositionScore (page renders overallScore)", () => {
  it("computes a real overallScore for a centered element", () => {
    const r = call("compositionScore", ctxA, {
      canvas: { width: 100, height: 100 },
      elements: [{ x: 25, y: 25, width: 16, height: 16, weight: 1 }],
    });
    assert.equal(r.ok, true);
    assert.equal(typeof r.result.overallScore, "number"); // page reads {overallScore}/100
    assert.ok(r.result.overallScore >= 0 && r.result.overallScore <= 1);
    // element center (33,33)/100 sits ~on a rule-of-thirds point → proximity ~1.
    assert.ok(r.result.elements[0].proximityScore >= 0.99);
    assert.ok(r.result.ruleOfThirdsScore >= 0.99);
    assert.equal(r.result.elementCount, 1);
  });

  it("DEGRADE-GRACEFUL: no elements returns the page's message branch", () => {
    const r = call("compositionScore", ctxA, { elements: [], canvas: {} });
    assert.equal(r.ok, true);
    assert.equal(typeof r.result.message, "string");
    assert.equal(r.result.score, 0);
  });

  it("FAIL-CLOSED: poisoned canvas/element dims keep overallScore finite", () => {
    const r = call("compositionScore", ctxA, {
      canvas: { width: "Infinity", height: "NaN" },
      elements: [{ x: "1e999", y: 0, width: "Infinity", height: 10, weight: "Infinity" }],
    });
    assert.equal(r.ok, true);
    assert.ok(Number.isFinite(r.result.overallScore), "overallScore must stay finite");
    assert.ok(Number.isFinite(r.result.balanceScore));
    assert.ok(Number.isFinite(r.result.coverageScore));
  });
});

describe("artistry compute — styleClassify (page renders classification + confidence)", () => {
  it("classifies Impressionism from tags + era", () => {
    const r = call("styleClassify", ctxA, {
      tags: ["impressionist", "plein air", "oil"],
      attributes: { era: "19th century" },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.classification, "Impressionism"); // page renders {classification}
    assert.equal(typeof r.result.confidence, "number");     // page renders {confidence}%
    assert.ok(r.result.confidence > 0 && r.result.confidence <= 1);
  });

  it("DEGRADE-GRACEFUL: no attributes/tags returns message + null classification", () => {
    const r = call("styleClassify", ctxA, {});
    assert.equal(r.ok, true);
    assert.equal(typeof r.result.message, "string");
    assert.equal(r.result.classification, null);
    assert.equal(r.result.confidence, 0);
  });

  it("unmatched tags classify as Unclassified (page still renders a string)", () => {
    const r = call("styleClassify", ctxA, { tags: ["zzzzz", "qqqqq"] });
    assert.equal(r.ok, true);
    assert.equal(r.result.classification, "Unclassified");
  });
});

describe("artistry compute — mediaInventory (page renders totalItems + categoryBreakdown[].category/itemCount)", () => {
  it("totals value, builds category breakdown, flags reorders", () => {
    const r = call("mediaInventory", ctxA, {
      supplies: [
        { name: "Cadmium Red", category: "paint", quantity: 3, unit: "tube", unitCost: 12, reorderThreshold: 5 },
        { name: "Cold Press", category: "paper", quantity: 20, unit: "sheet", unitCost: 2 },
      ],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.totalItems, 2); // page renders {totalItems} items
    assert.ok(Array.isArray(r.result.categoryBreakdown));
    const paint = r.result.categoryBreakdown.find((c) => c.category === "paint");
    assert.ok(paint, "categoryBreakdown must carry a {category} the page maps over");
    assert.equal(paint.itemCount, 1); // page renders {itemCount}
    assert.equal(r.result.totalInventoryValue, 76); // 3*12 + 20*2
    // qty 3 <= threshold 5 → a reorder alert.
    assert.equal(r.result.reorderCount, 1);
    assert.equal(r.result.reorderAlerts[0].name, "Cadmium Red");
  });

  it("DEGRADE-GRACEFUL: empty supplies returns the page message branch + zeroed totals", () => {
    const r = call("mediaInventory", ctxA, { supplies: [] });
    assert.equal(r.ok, true);
    assert.equal(typeof r.result.message, "string");
    assert.equal(r.result.totalItems, 0);
    assert.deepEqual(r.result.reorderAlerts, []);
  });

  it("FAIL-CLOSED: poisoned quantity/unitCost keep totalInventoryValue finite", () => {
    const r = call("mediaInventory", ctxA, {
      supplies: [
        { name: "Poison", category: "paint", quantity: "Infinity", unitCost: "1e999" },
        { name: "NaNish", category: "paint", quantity: "NaN", unitCost: 5 },
      ],
    });
    assert.equal(r.ok, true);
    assert.ok(Number.isFinite(r.result.totalInventoryValue), "totalInventoryValue must stay finite");
    assert.ok(Number.isFinite(r.result.totalQuantity));
    assert.ok(Number.isFinite(r.result.estimatedReorderCost));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ProjectStudio — create/list/view/appreciate/comment round-trip with the EXACT
// field names the component reads (r.data.result.projects, .project, .comments,
// .appreciated, .count, .comment).
// ─────────────────────────────────────────────────────────────────────────────
describe("artistry projects — ProjectStudio round-trip", () => {
  it("create → list → view exposes the fields the component renders", () => {
    // ProjectStudio.submit() sends these exact field names.
    const created = call("projectCreate", ctxA, {
      title: "Dune Concepts", description: "moodboard", discipline: "concept-art",
      tools: ["Photoshop"], tags: ["scifi", "desert"],
      coverUrl: "https://x/cover.png",
      images: [{ url: "https://x/1.png", caption: "wide", order: 0 }],
      processSteps: [{ title: "thumbnail", detail: "10 thumbs" }],
    });
    assert.equal(created.ok, true);
    const id = created.result.project.id;
    assert.ok(typeof id === "string" && id);

    const listed = call("projectList", ctxA, {});
    assert.ok(Array.isArray(listed.result.projects)); // component: r.data.result.projects
    assert.equal(listed.result.projects.length, 1);
    const card = listed.result.projects[0];
    // card fields ProjectStudio renders.
    assert.equal(card.title, "Dune Concepts");
    assert.equal(card.discipline, "concept-art");
    assert.equal(card.views, 0);
    assert.equal(card.appreciations, 0);   // list maps appreciations count
    assert.equal(card.commentCount, 0);    // list maps commentCount

    // A DIFFERENT viewer increments views (component reads detail.project.views).
    const viewed = call("projectView", ctxB, { projectId: id });
    assert.equal(viewed.ok, true);
    assert.equal(viewed.result.project.views, 1);
    assert.ok(Array.isArray(viewed.result.comments)); // detail.comments
    assert.equal(viewed.result.appreciations, 0);     // detail.appreciations
    assert.equal(viewed.result.appreciated, false);   // detail.appreciated
  });

  it("appreciate toggles + returns {appreciated, count} the component reads", () => {
    const p = call("projectCreate", ctxA, { title: "P" });
    const id = p.result.project.id;
    const a1 = call("appreciate", ctxB, { projectId: id });
    assert.equal(a1.ok, true);
    assert.equal(a1.result.appreciated, true); // component: r.data.result.appreciated
    assert.equal(a1.result.count, 1);          // component: r.data.result.count
    const a2 = call("appreciate", ctxB, { projectId: id });
    assert.equal(a2.result.appreciated, false);
    assert.equal(a2.result.count, 0);
  });

  it("commentAdd → returns {comment} the component appends; commentList/Delete round-trip", () => {
    const p = call("projectCreate", ctxA, { title: "P" });
    const id = p.result.project.id;
    const c = call("commentAdd", ctxB, { projectId: id, body: "love this" });
    assert.equal(c.ok, true);
    assert.equal(c.result.comment.body, "love this"); // component: r.data.result.comment
    assert.equal(c.result.commentCount, 1);
    const cid = c.result.comment.id;

    const list = call("commentList", ctxA, { projectId: id });
    assert.equal(list.result.count, 1);

    const del = call("commentDelete", ctxB, { projectId: id, commentId: cid });
    assert.equal(del.ok, true);
    assert.equal(del.result.deleted, true);
  });

  it("VALIDATION-REJECTION: commentAdd without body is rejected fail-closed", () => {
    const p = call("projectCreate", ctxA, { title: "P" });
    const id = p.result.project.id;
    const c = call("commentAdd", ctxB, { projectId: id, body: "   " });
    assert.equal(c.ok, false);
    assert.equal(c.error, "body_required");
  });

  it("VALIDATION-REJECTION: projectView on a missing id is rejected, not faked", () => {
    const r = call("projectView", ctxA, { projectId: "nope" });
    assert.equal(r.ok, false);
    assert.equal(r.error, "project_not_found");
  });

  it("projectDelete removes the row + drafts hidden from other viewers", () => {
    const p = call("projectCreate", ctxA, { title: "secret", published: false });
    const id = p.result.project.id;
    // a different viewer's list omits the draft (published filter).
    const otherList = call("projectList", ctxB, { userId: "artist_a" });
    assert.equal(otherList.result.projects.length, 0);
    const del = call("projectDelete", ctxA, { projectId: id });
    assert.equal(del.result.deleted, true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CommunityNetwork — personalizedFeed + followGraph with the EXACT fields read.
// ─────────────────────────────────────────────────────────────────────────────
describe("artistry network — CommunityNetwork", () => {
  it("followGraph returns following/followers/mutuals + counts the component renders", () => {
    call("follow", ctxA, { targetUserId: "artist_b" });
    call("follow", ctxB, { targetUserId: "artist_a" }); // mutual
    const g = call("followGraph", ctxA, {});
    assert.equal(g.ok, true);
    assert.deepEqual(g.result.following, ["artist_b"]);
    assert.deepEqual(g.result.followers, ["artist_b"]);
    assert.deepEqual(g.result.mutuals, ["artist_b"]);
    assert.equal(g.result.followingCount, 1); // graph?.followingCount
    assert.equal(g.result.followerCount, 1);  // graph?.followerCount
    assert.equal(g.result.mutualCount, 1);    // graph?.mutualCount
  });

  it("personalizedFeed follows mode → discovery fallback with the rendered fields", () => {
    // B publishes a project; A follows B → feed mode 'follows'.
    call("projectCreate", ctxB, { title: "B work", coverUrl: "https://x/c.png" });
    call("follow", ctxA, { targetUserId: "artist_b" });
    const f = call("personalizedFeed", ctxA, { limit: 24 });
    assert.equal(f.ok, true);
    assert.equal(f.result.mode, "follows"); // feed?.mode
    assert.ok(Array.isArray(f.result.items));
    assert.equal(f.result.items[0].title, "B work");
    assert.equal(f.result.items[0].userId, "artist_b"); // feed item: by {userId}
    assert.equal(typeof f.result.items[0].appreciations, "number");
    assert.equal(typeof f.result.items[0].commentCount, "number");
    assert.equal(typeof f.result.fromFollowsCount, "number");

    // A NEW user with no follows falls back to discovery (most-appreciated).
    const f2 = call("personalizedFeed", { actor: { userId: "lonely" }, userId: "lonely" }, {});
    assert.equal(f2.result.mode, "discovery");
  });

  it("VALIDATION-REJECTION: cannot follow self", () => {
    const r = call("follow", ctxA, { targetUserId: "artist_a" });
    assert.equal(r.ok, false);
    assert.equal(r.error, "cannot_follow_self");
  });

  it("unfollow returns {unfollowed, followingCount}", () => {
    call("follow", ctxA, { targetUserId: "artist_b" });
    const u = call("unfollow", ctxA, { targetUserId: "artist_b" });
    assert.equal(u.ok, true);
    assert.equal(u.result.unfollowed, "artist_b");
    assert.equal(u.result.followingCount, 0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Collections — create/list/save/items with EXACT field names.
// ─────────────────────────────────────────────────────────────────────────────
describe("artistry collections — Collections", () => {
  it("create → list → save → items round-trip with rendered fields", () => {
    const coll = call("collectionCreate", ctxA, { name: "Inspo", description: "refs", isPrivate: false });
    assert.equal(coll.ok, true);
    const cid = coll.result.collection.id;

    const list = call("collectionList", ctxA, {});
    assert.ok(Array.isArray(list.result.collections)); // component: r.data?.result?.collections
    assert.equal(list.result.collections[0].name, "Inspo");
    assert.equal(list.result.collections[0].itemCount, 0); // component renders {itemCount}

    const proj = call("projectCreate", ctxA, { title: "MyArt" });
    const pid = proj.result.project.id;
    const saved = call("collectionSave", ctxA, { collectionId: cid, projectId: pid });
    assert.equal(saved.ok, true);
    assert.equal(saved.result.saved, true);
    assert.equal(saved.result.itemCount, 1);

    const items = call("collectionItems", ctxA, { collectionId: cid });
    assert.ok(Array.isArray(items.result.items)); // component: r.data.result.items
    assert.equal(items.result.collection.id, cid); // component: r.data.result.collection
    assert.equal(items.result.items[0].title, "MyArt");
  });

  it("VALIDATION-REJECTION: private collection hidden from a non-owner viewer", () => {
    const coll = call("collectionCreate", ctxA, { name: "Secret", isPrivate: true });
    const cid = coll.result.collection.id;
    const r = call("collectionItems", ctxB, { collectionId: cid });
    assert.equal(r.ok, false);
    assert.equal(r.error, "collection_private");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PortfolioProfile — profileUpdate/profileGet with EXACT fields (profile, stats,
// projects, isOwner).
// ─────────────────────────────────────────────────────────────────────────────
describe("artistry profile — PortfolioProfile", () => {
  it("update → get exposes profile/stats/projects/isOwner the component reads", () => {
    const upd = call("profileUpdate", ctxA, {
      displayName: "Ada", headline: "Concept Artist", bio: "I draw", location: "NYC",
      avatarUrl: "https://x/a.png", bannerUrl: "https://x/b.png",
      disciplines: ["illustration", "concept-art"],
      links: [{ label: "site", url: "https://ada.art" }],
      availableForHire: true, layout: "masonry",
    });
    assert.equal(upd.ok, true);
    assert.equal(upd.result.profile.displayName, "Ada");

    call("projectCreate", ctxA, { title: "Piece", coverUrl: "https://x/p.png", published: true });
    const got = call("profileGet", ctxA, {});
    assert.equal(got.ok, true);
    // EXACT fields PortfolioProfile destructures: { profile, projects, stats, isOwner }.
    assert.equal(got.result.profile.displayName, "Ada");
    assert.equal(got.result.profile.layout, "masonry");
    assert.equal(got.result.isOwner, true);
    assert.ok(Array.isArray(got.result.projects));
    assert.equal(got.result.projects[0].title, "Piece");
    // stats fields the component renders.
    assert.equal(got.result.stats.projectCount, 1);
    assert.equal(typeof got.result.stats.totalViews, "number");
    assert.equal(typeof got.result.stats.totalAppreciations, "number");
    assert.equal(typeof got.result.stats.followerCount, "number");
    assert.equal(typeof got.result.stats.followingCount, "number");
  });

  it("profileGet on an unknown user returns a default profile (component never blanks)", () => {
    const got = call("profileGet", ctxA, { userId: "ghost" });
    assert.equal(got.ok, true);
    assert.equal(got.result.profile.userId, "ghost");
    assert.equal(got.result.isOwner, false);
    assert.equal(got.result.stats.projectCount, 0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DisciplineSearch — search + tagCloud with EXACT fields (results, tags,
// disciplines).
// ─────────────────────────────────────────────────────────────────────────────
describe("artistry search — DisciplineSearch", () => {
  beforeEach(() => {
    call("projectCreate", ctxA, { title: "Forest", discipline: "illustration", tags: ["nature", "green"] });
    call("projectCreate", ctxA, { title: "Cityscape", discipline: "photography", tags: ["urban"] });
  });

  it("search returns {results} the component renders + respects discipline/tag/sort", () => {
    const r = call("search", ctxA, { query: "", sort: "recent", discipline: "illustration", tag: "" });
    assert.equal(r.ok, true);
    assert.ok(Array.isArray(r.result.results)); // component: r.data.result.results
    assert.equal(r.result.results.length, 1);
    assert.equal(r.result.results[0].title, "Forest");
    assert.equal(typeof r.result.results[0].appreciations, "number"); // result card fields
    assert.equal(typeof r.result.results[0].commentCount, "number");
  });

  it("tagCloud returns {tags, disciplines} the component renders", () => {
    const r = call("tagCloud", ctxA, {});
    assert.equal(r.ok, true);
    assert.ok(Array.isArray(r.result.tags));        // component: r.data.result.tags
    assert.ok(Array.isArray(r.result.disciplines)); // component: r.data.result.disciplines
    const nature = r.result.tags.find((t) => t.tag === "nature");
    assert.ok(nature && nature.count === 1);
    const ill = r.result.disciplines.find((d) => d.discipline === "illustration");
    assert.ok(ill && ill.count === 1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// JobBoard — jobPost/jobList/jobApply/jobClose with EXACT fields.
// ─────────────────────────────────────────────────────────────────────────────
describe("artistry jobs — JobBoard", () => {
  it("post → list → apply → close round-trip with rendered fields", () => {
    const job = call("jobPost", ctxA, {
      title: "Album cover", description: "brief", discipline: "illustration", kind: "commission",
      budgetMin: 200, budgetMax: 800, remote: true, location: "", tags: ["music"],
    });
    assert.equal(job.ok, true);
    const jid = job.result.job.id;
    assert.equal(job.result.job.budgetMin, 200);
    assert.equal(job.result.job.budgetMax, 800);
    assert.equal(job.result.job.status, "open");

    // A different artist sees the open job (jobList component fields).
    const open = call("jobList", ctxB, { mine: false });
    assert.equal(open.result.jobs.length, 1);
    assert.equal(open.result.jobs[0].applicationCount, 0); // component: j.applicationCount
    assert.equal(open.result.jobs[0].applied, false);      // component: j.applied

    const applied = call("jobApply", ctxB, { jobId: jid, message: "pitch", quote: 500 });
    assert.equal(applied.ok, true);
    assert.equal(applied.result.applicationCount, 1);

    // Owner's list shows the applicant + applied flag re-derived per viewer.
    const mine = call("jobList", ctxA, { mine: true, includeClosed: true });
    assert.equal(mine.result.jobs[0].applicationCount, 1);
    assert.equal(mine.result.jobs[0].applications[0].quote, 500); // owner: a.quote

    const closed = call("jobClose", ctxA, { jobId: jid });
    assert.equal(closed.ok, true);
    assert.equal(closed.result.closed, true);
  });

  it("VALIDATION-REJECTION: cannot apply to your own job / closed job / twice", () => {
    const job = call("jobPost", ctxA, { title: "Mine" });
    const jid = job.result.job.id;
    assert.equal(call("jobApply", ctxA, { jobId: jid }).error, "cannot_apply_own_job");
    call("jobApply", ctxB, { jobId: jid });
    assert.equal(call("jobApply", ctxB, { jobId: jid }).error, "already_applied");
    call("jobClose", ctxA, { jobId: jid });
    assert.equal(call("jobApply", { actor: { userId: "c" }, userId: "c" }, { jobId: jid }).error, "job_closed");
  });

  it("VALIDATION-REJECTION: jobPost without title rejected; poisoned budget coerces to 0", () => {
    assert.equal(call("jobPost", ctxA, { title: "  " }).error, "title_required");
    const job = call("jobPost", ctxA, { title: "Ok", budgetMin: "Infinity", budgetMax: "1e999" });
    assert.equal(job.ok, true);
    assert.equal(job.result.job.budgetMin, 0); // fail-closed
    assert.equal(job.result.job.budgetMax, 0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CuratedGalleries — galleryCreate/galleryList/galleryItems with EXACT fields.
// ─────────────────────────────────────────────────────────────────────────────
describe("artistry galleries — CuratedGalleries", () => {
  it("create → list → items resolves only PUBLISHED projects with rendered fields", () => {
    const pub = call("projectCreate", ctxA, { title: "Pub", published: true, coverUrl: "https://x/c.png" });
    const draft = call("projectCreate", ctxA, { title: "Draft", published: false });
    const gal = call("galleryCreate", ctxA, {
      title: "Best of 2026", theme: "Featured", description: "top picks", featured: true,
      projectIds: [pub.result.project.id, draft.result.project.id],
    });
    assert.equal(gal.ok, true);
    const gid = gal.result.gallery.id;

    const list = call("galleryList", ctxA, {});
    assert.ok(Array.isArray(list.result.galleries)); // component: r.data?.result?.galleries
    assert.equal(list.result.galleries[0].projectCount, 2); // component renders {projectCount}
    assert.equal(list.result.galleries[0].featured, true);

    const items = call("galleryItems", ctxA, { galleryId: gid });
    assert.ok(Array.isArray(items.result.items)); // component: r.data.result.items
    assert.equal(items.result.gallery.id, gid);   // component: r.data.result.gallery
    // Only the PUBLISHED project resolves (the draft is filtered).
    assert.equal(items.result.items.length, 1);
    assert.equal(items.result.items[0].title, "Pub");
  });

  it("VALIDATION-REJECTION: galleryCreate without title rejected; galleryItems missing id rejected", () => {
    assert.equal(call("galleryCreate", ctxA, { title: "" }).error, "title_required");
    assert.equal(call("galleryItems", ctxA, { galleryId: "nope" }).error, "gallery_not_found");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// State-unavailable degrade: with no STATE the social macros never throw.
// ─────────────────────────────────────────────────────────────────────────────
describe("artistry — degrade graceful when STATE is absent", () => {
  it("social macros return {ok:false, state_unavailable}, never throw", () => {
    globalThis._concordSTATE = undefined;
    const r = call("projectList", ctxA, {});
    assert.equal(r.ok, false);
    assert.equal(r.error, "state_unavailable");
  });

  it("compute macros are STATE-independent (pure compute) and still resolve", () => {
    globalThis._concordSTATE = undefined;
    const r = call("colorPaletteAnalysis", ctxA, { palette: ["#123456"] });
    assert.equal(r.ok, true);
    assert.ok(Number.isFinite(r.result.harmonyScore));
  });
});
