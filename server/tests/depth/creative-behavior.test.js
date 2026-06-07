// tests/depth/creative-behavior.test.js — REAL behavioral tests for the
// `creative` DOMAIN (registerLensAction family, invoked via lensRun). This is
// the Milanote/StudioBinder production-management substrate: shot lists, asset
// organization, budget tracking, distribution checklists, visual boards/cards/
// connections, script breakdowns, deliverable versioning + approval workflow,
// production calendar, and shareable client-proof links.
//
// All macros here are deterministic pure compute / in-memory CRUD — there are
// NO brain/LLM/network macros in this domain, so nothing is skipped for egress.
//
// lens.run UNWRAPS a handler's {ok:true, result:X} → r.ok===true, r.result===X.
// A handler {ok:false,error} is wrapped → r.ok===true, r.result==={ok:false,error}.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { lensRun, depthCtx } from "./_harness.js";

describe("creative — artifact calc contracts (exact computed values)", () => {
  it("budgetTrack: computes spent / remaining / percentUsed / byCategory / overBudget", async () => {
    const r = await lensRun("creative", "budgetTrack", {
      data: {
        budget: 1000,
        expenses: [
          { amount: 300, category: "Gear" },
          { amount: 200, category: "Gear" },
          { amount: 100, category: "Travel" },
        ],
      },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.totalSpent, 600);
    assert.equal(r.result.remaining, 400);          // 1000 − 600
    assert.equal(r.result.percentUsed, 60);         // round(600/1000*100)
    assert.equal(r.result.byCategory.Gear, 500);    // 300 + 200
    assert.equal(r.result.byCategory.Travel, 100);
    assert.equal(r.result.overBudget, false);
  });

  it("budgetTrack: flags overBudget when expenses exceed the budget", async () => {
    const r = await lensRun("creative", "budgetTrack", {
      data: { budget: 100, expenses: [{ amount: 150, category: "Post" }] },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.remaining, -50);
    assert.equal(r.result.overBudget, true);
    assert.equal(r.result.percentUsed, 150);
  });

  it("shotListGenerate: video type yields the 6-shot video plan, numbered 1..6", async () => {
    const r = await lensRun("creative", "shotListGenerate", { data: { type: "video" } });
    assert.equal(r.ok, true);
    assert.equal(r.result.count, 6);
    assert.ok(r.result.shots.some((sh) => sh.description === "Wide establishing shot"));
    assert.equal(r.result.shots[0].number, 1);
    assert.equal(r.result.shots[5].number, 6);
    assert.equal(r.result.shots[0].status, "planned");
  });

  it("assetOrganize: buckets assets by type and counts per category", async () => {
    const r = await lensRun("creative", "assetOrganize", {
      data: {
        assets: [
          { type: "photo" }, { type: "photo" }, { type: "video" }, {},
        ],
      },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.totalAssets, 4);
    assert.ok(r.result.categories.some((c) => c.type === "photo" && c.count === 2));
    assert.ok(r.result.categories.some((c) => c.type === "video" && c.count === 1));
    assert.ok(r.result.categories.some((c) => c.type === "uncategorized" && c.count === 1));
  });

  it("distributionChecklist: podcast type yields the 7-platform podcast checklist", async () => {
    const r = await lensRun("creative", "distributionChecklist", { data: { type: "podcast" } });
    assert.equal(r.ok, true);
    assert.equal(r.result.total, 7);
    assert.equal(r.result.type, "podcast");
    assert.ok(r.result.checklist.some((c) => c.platform === "Apple Podcasts" && c.status === "pending"));
  });

  it("project_summary: rolls up array counts + derives in_production status from deliverables", async () => {
    const r = await lensRun("creative", "project_summary", {
      data: { title: "Spec Spot", deliverables: [{}, {}], shots: [{}] },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.status, "in_production");
    assert.equal(r.result.counts.deliverables, 2);
    assert.equal(r.result.counts.shots, 1);
    assert.equal(r.result.totalItems, 3);
    assert.ok(r.result.summary.includes("2 deliverables"));
  });

  it("revision_summary: counts versions and reports the latest status", async () => {
    const r = await lensRun("creative", "revision_summary", {
      data: { versions: [{ status: "draft" }, { status: "approved" }] },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.revisionCount, 2);
    assert.equal(r.result.latestStatus, "approved");
    assert.equal(r.result.statusCounts.draft, 1);
    assert.equal(r.result.statusCounts.approved, 1);
  });
});

describe("creative — boards/cards CRUD round-trips + validation (shared ctx)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("creative-boards"); });

  it("board-create → board-list → card-add: card reads back on the board, clamped + colored", async () => {
    const created = await lensRun("creative", "board-create", { params: { title: "Pitch Board" } }, ctx);
    assert.equal(created.ok, true);
    const boardId = created.result.board.id;

    const list = await lensRun("creative", "board-list", {}, ctx);
    assert.ok(list.result.boards.some((b) => b.id === boardId));

    const card = await lensRun("creative", "card-add", {
      params: { boardId, type: "task", content: "Storyboard", color: "amber", x: 99999, w: 5 },
    }, ctx);
    assert.equal(card.ok, true);
    assert.equal(card.result.card.color, "amber");
    assert.equal(card.result.card.x, 8000);   // clamped to upper bound
    assert.equal(card.result.card.w, 80);     // clamped to lower bound

    const got = await lensRun("creative", "board-get", { params: { id: boardId } }, ctx);
    assert.ok(got.result.cards.some((c) => c.id === card.result.card.id && c.type === "task"));
  });

  it("connection-add: rejects connecting a card to itself", async () => {
    const board = await lensRun("creative", "board-create", { params: { title: "Graph" } }, ctx);
    const c1 = await lensRun("creative", "card-add", { params: { boardId: board.result.board.id, content: "A" } }, ctx);
    const bad = await lensRun("creative", "connection-add", {
      params: { fromCardId: c1.result.card.id, toCardId: c1.result.card.id },
    }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /cannot connect a card to itself/);
  });

  it("board-from-template: story-outline seeds 6 cards; templates list resolves it", async () => {
    const tpls = await lensRun("creative", "board-templates", {}, ctx);
    assert.ok(tpls.result.templates.some((t) => t.id === "story-outline"));

    const made = await lensRun("creative", "board-from-template", { params: { templateId: "story-outline" } }, ctx);
    assert.equal(made.ok, true);
    assert.equal(made.result.cardsSeeded, 6);
    const got = await lensRun("creative", "board-get", { params: { id: made.result.board.id } }, ctx);
    assert.ok(got.result.cards.some((c) => c.content === "Inciting incident"));
  });

  it("board-create: blank title is rejected", async () => {
    const bad = await lensRun("creative", "board-create", { params: { title: "   " } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /board title required/);
  });
});

describe("creative — production substrate CRUD + workflow (shared ctx)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("creative-prod"); });

  it("deliverable-create → add-version → submit → decide: approval workflow round-trips", async () => {
    const d = await lensRun("creative", "deliverable-create", { params: { name: "Hero Cut" } }, ctx);
    assert.equal(d.ok, true);
    const id = d.result.deliverable.id;
    assert.equal(d.result.deliverable.status, "draft");
    assert.equal(d.result.deliverable.currentVersion, 1);

    const v2 = await lensRun("creative", "deliverable-add-version", { params: { id, note: "v2 color" } }, ctx);
    assert.equal(v2.result.deliverable.currentVersion, 2);
    assert.equal(v2.result.deliverable.versions.length, 2);

    const sub = await lensRun("creative", "deliverable-submit", { params: { id, reviewer: "Client" } }, ctx);
    assert.equal(sub.result.deliverable.status, "in_review");

    const dec = await lensRun("creative", "deliverable-decide", { params: { id, decision: "approved", note: "ship it" } }, ctx);
    assert.equal(dec.result.deliverable.status, "approved");
    assert.equal(dec.result.deliverable.decisionNote, "ship it");
  });

  it("deliverable-decide: rejects a decision when the item is not in review", async () => {
    const d = await lensRun("creative", "deliverable-create", { params: { name: "Draft Only" } }, ctx);
    const bad = await lensRun("creative", "deliverable-decide", { params: { id: d.result.deliverable.id, decision: "approved" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /not in review/);
  });

  it("callsheet-create → add-row: general call recomputes to the earliest crew/cast call time", async () => {
    const cs = await lensRun("creative", "callsheet-create", { params: { project: "Day 1", generalCall: "09:00" } }, ctx);
    assert.equal(cs.ok, true);
    const id = cs.result.sheet.id;

    await lensRun("creative", "callsheet-add-row", { params: { id, section: "crew", name: "Gaffer", department: "Lighting", callTime: "07:30" } }, ctx);
    const r = await lensRun("creative", "callsheet-add-row", { params: { id, section: "cast", name: "Lead", role: "Hero", callTime: "08:15" } }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.sheet.generalCall, "07:30");   // earliest of 07:30 / 08:15
    assert.equal(r.result.sheet.crewCount ?? r.result.sheet.crew.length, 1);
  });

  it("breakdown-create: auto-extract surfaces INT./EXT. locations and ALL-CAPS cast cues", async () => {
    const script = [
      "INT. COFFEE SHOP - DAY",
      "",
      "MARIA",
      "Order up.",
      "",
      "EXT. ALLEY - NIGHT",
      "",
      "DET. VOSS",
      "We move at dawn.",
    ].join("\n");
    const bd = await lensRun("creative", "breakdown-create", { params: { title: "Scene 4", script } }, ctx);
    assert.equal(bd.ok, true);
    assert.ok(bd.result.suggestions.locations.includes("COFFEE SHOP"));
    assert.ok(bd.result.suggestions.cast.includes("MARIA"));
  });

  it("breakdown-tag: rejects an unknown category", async () => {
    const bd = await lensRun("creative", "breakdown-create", { params: { title: "Tag Me", script: "INT. ROOM - DAY" } }, ctx);
    const bad = await lensRun("creative", "breakdown-tag", { params: { id: bd.result.breakdown.id, category: "snacks", value: "donuts" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /category must be one of/);
  });

  it("calendar-add: rejects a non YYYY-MM-DD date", async () => {
    const bad = await lensRun("creative", "calendar-add", { params: { title: "Shoot", date: "June 7" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /date must be YYYY-MM-DD/);
  });

  it("review-asset-create → prooflink-create → public-comment: external comment lands in owner inbox", async () => {
    const asset = await lensRun("creative", "review-asset-create", { params: { name: "Cut v1", kind: "video", durationSec: 120 } }, ctx);
    assert.equal(asset.ok, true);
    const link = await lensRun("creative", "prooflink-create", { params: { assetId: asset.result.asset.id } }, ctx);
    assert.equal(link.ok, true);
    const token = link.result.link.token;

    const cmt = await lensRun("creative", "prooflink-public-comment", { params: { token, body: "Tighten the open", authorName: "Client", timestampSec: 12 } }, ctx);
    assert.equal(cmt.ok, true);
    assert.equal(cmt.result.comment.timestampSec, 12);

    const inbox = await lensRun("creative", "prooflink-inbox", { params: { token } }, ctx);
    assert.ok(inbox.result.comments.some((c) => c.body === "Tighten the open"));
  });
});
