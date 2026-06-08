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

// ─────────────────────────────────────────────────────────────────────────
// Additional coverage for the uncovered CRUD/mutation/validation macros.
// ─────────────────────────────────────────────────────────────────────────

describe("creative — board/card mutation + delete round-trips (shared ctx)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("creative-board-mut"); });

  it("board-rename: renames an existing board; rejects blank title + unknown id", async () => {
    const b = await lensRun("creative", "board-create", { params: { title: "Old Name" } }, ctx);
    const id = b.result.board.id;

    const ren = await lensRun("creative", "board-rename", { params: { id, title: "New Name" } }, ctx);
    assert.equal(ren.ok, true);
    assert.equal(ren.result.board.title, "New Name");

    const blank = await lensRun("creative", "board-rename", { params: { id, title: "   " } }, ctx);
    assert.equal(blank.result.ok, false);
    assert.match(blank.result.error, /title required/);

    const missing = await lensRun("creative", "board-rename", { params: { id: "nope", title: "x" } }, ctx);
    assert.equal(missing.result.ok, false);
    assert.match(missing.result.error, /board not found/);
  });

  it("board-delete: cascades cards + connections; board-get then fails", async () => {
    const b = await lensRun("creative", "board-create", { params: { title: "Doomed" } }, ctx);
    const boardId = b.result.board.id;
    const c1 = await lensRun("creative", "card-add", { params: { boardId, content: "A" } }, ctx);
    const c2 = await lensRun("creative", "card-add", { params: { boardId, content: "B" } }, ctx);
    await lensRun("creative", "connection-add", {
      params: { fromCardId: c1.result.card.id, toCardId: c2.result.card.id },
    }, ctx);

    const del = await lensRun("creative", "board-delete", { params: { id: boardId } }, ctx);
    assert.equal(del.ok, true);
    assert.equal(del.result.deleted, boardId);

    const got = await lensRun("creative", "board-get", { params: { id: boardId } }, ctx);
    assert.equal(got.result.ok, false);
    assert.match(got.result.error, /board not found/);
  });

  it("board-duplicate: copies title with (copy) suffix + remaps cards + connections", async () => {
    const b = await lensRun("creative", "board-create", { params: { title: "Source" } }, ctx);
    const boardId = b.result.board.id;
    const c1 = await lensRun("creative", "card-add", { params: { boardId, content: "Node1" } }, ctx);
    const c2 = await lensRun("creative", "card-add", { params: { boardId, content: "Node2" } }, ctx);
    await lensRun("creative", "connection-add", {
      params: { fromCardId: c1.result.card.id, toCardId: c2.result.card.id },
    }, ctx);

    const dup = await lensRun("creative", "board-duplicate", { params: { id: boardId } }, ctx);
    assert.equal(dup.ok, true);
    assert.equal(dup.result.board.title, "Source (copy)");
    assert.notEqual(dup.result.board.id, boardId);

    const got = await lensRun("creative", "board-get", { params: { id: dup.result.board.id } }, ctx);
    assert.equal(got.result.cards.length, 2);
    assert.equal(got.result.connections.length, 1);
    // Connection points at the copied cards, not the originals.
    assert.ok(got.result.cards.some((c) => c.id === got.result.connections[0].fromCardId));
    assert.ok(!got.result.cards.some((c) => c.id === c1.result.card.id));
  });

  it("card-update: applies content/color/done; clamps w; rejects unknown card", async () => {
    const b = await lensRun("creative", "board-create", { params: { title: "Edit" } }, ctx);
    const c = await lensRun("creative", "card-add", { params: { boardId: b.result.board.id, content: "before" } }, ctx);
    const cardId = c.result.card.id;

    const upd = await lensRun("creative", "card-update", {
      params: { cardId, content: "after", color: "rose", done: true, w: 1 },
    }, ctx);
    assert.equal(upd.ok, true);
    assert.equal(upd.result.card.content, "after");
    assert.equal(upd.result.card.color, "rose");
    assert.equal(upd.result.card.done, true);
    assert.equal(upd.result.card.w, 80);    // clamped to lower bound 80

    const bad = await lensRun("creative", "card-update", { params: { cardId: "missing" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /card not found/);
  });

  it("card-move: clamps x/y to bounds and returns the new position", async () => {
    const b = await lensRun("creative", "board-create", { params: { title: "Move" } }, ctx);
    const c = await lensRun("creative", "card-add", { params: { boardId: b.result.board.id, content: "M" } }, ctx);
    const mv = await lensRun("creative", "card-move", {
      params: { cardId: c.result.card.id, x: 999999, y: -999999 },
    }, ctx);
    assert.equal(mv.ok, true);
    assert.equal(mv.result.x, 8000);     // clamped upper
    assert.equal(mv.result.y, -2000);    // clamped lower
  });

  it("card-raise: bumps z above the current max on the board", async () => {
    const b = await lensRun("creative", "board-create", { params: { title: "Z" } }, ctx);
    const boardId = b.result.board.id;
    const c1 = await lensRun("creative", "card-add", { params: { boardId, content: "first" } }, ctx);
    const c2 = await lensRun("creative", "card-add", { params: { boardId, content: "second" } }, ctx);
    // c2 has higher z initially; raising c1 should exceed it.
    const raised = await lensRun("creative", "card-raise", { params: { cardId: c1.result.card.id } }, ctx);
    assert.equal(raised.ok, true);
    assert.ok(raised.result.z > c2.result.card.z);
  });

  it("card-delete + connection-delete: removing a card drops its connections", async () => {
    const b = await lensRun("creative", "board-create", { params: { title: "Cleanup" } }, ctx);
    const boardId = b.result.board.id;
    const c1 = await lensRun("creative", "card-add", { params: { boardId, content: "X" } }, ctx);
    const c2 = await lensRun("creative", "card-add", { params: { boardId, content: "Y" } }, ctx);
    const conn = await lensRun("creative", "connection-add", {
      params: { fromCardId: c1.result.card.id, toCardId: c2.result.card.id },
    }, ctx);
    assert.equal(conn.ok, true);

    const delCard = await lensRun("creative", "card-delete", { params: { cardId: c1.result.card.id } }, ctx);
    assert.equal(delCard.result.deleted, c1.result.card.id);

    const got = await lensRun("creative", "board-get", { params: { id: boardId } }, ctx);
    assert.equal(got.result.connections.length, 0);   // connection auto-removed

    // connection-delete on an already-gone id is rejected.
    const delConn = await lensRun("creative", "connection-delete", { params: { id: conn.result.connection.id } }, ctx);
    assert.equal(delConn.result.ok, false);
    assert.match(delConn.result.error, /connection not found/);
  });

  it("connection-delete: removes an existing connection", async () => {
    const b = await lensRun("creative", "board-create", { params: { title: "DelConn" } }, ctx);
    const boardId = b.result.board.id;
    const c1 = await lensRun("creative", "card-add", { params: { boardId, content: "P" } }, ctx);
    const c2 = await lensRun("creative", "card-add", { params: { boardId, content: "Q" } }, ctx);
    const conn = await lensRun("creative", "connection-add", {
      params: { fromCardId: c1.result.card.id, toCardId: c2.result.card.id },
    }, ctx);
    const del = await lensRun("creative", "connection-delete", { params: { id: conn.result.connection.id } }, ctx);
    assert.equal(del.ok, true);
    assert.equal(del.result.deleted, conn.result.connection.id);
  });

  it("connection-add: rejects connecting cards on different boards", async () => {
    const b1 = await lensRun("creative", "board-create", { params: { title: "BoardA" } }, ctx);
    const b2 = await lensRun("creative", "board-create", { params: { title: "BoardB" } }, ctx);
    const ca = await lensRun("creative", "card-add", { params: { boardId: b1.result.board.id, content: "a" } }, ctx);
    const cb = await lensRun("creative", "card-add", { params: { boardId: b2.result.board.id, content: "b" } }, ctx);
    const bad = await lensRun("creative", "connection-add", {
      params: { fromCardId: ca.result.card.id, toCardId: cb.result.card.id },
    }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /same board/);
  });

  it("creative-dashboard: rolls up board/card/task counts for the user", async () => {
    const ctx2 = await depthCtx("creative-dash-fresh");
    const b = await lensRun("creative", "board-create", { params: { title: "Dash" } }, ctx2);
    const boardId = b.result.board.id;
    await lensRun("creative", "card-add", { params: { boardId, type: "task", content: "todo" } }, ctx2);
    const t2 = await lensRun("creative", "card-add", { params: { boardId, type: "task", content: "done one" } }, ctx2);
    await lensRun("creative", "card-update", { params: { cardId: t2.result.card.id, done: true } }, ctx2);
    await lensRun("creative", "card-add", { params: { boardId, type: "note", content: "note" } }, ctx2);

    const dash = await lensRun("creative", "creative-dashboard", {}, ctx2);
    assert.equal(dash.ok, true);
    assert.equal(dash.result.boards, 1);
    assert.equal(dash.result.cards, 3);
    assert.equal(dash.result.openTasks, 1);
    assert.equal(dash.result.doneTasks, 1);
  });
});

describe("creative — review assets/comments CRUD + workflow (shared ctx)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("creative-review"); });

  it("review-asset-create: rejects a blank name", async () => {
    const bad = await lensRun("creative", "review-asset-create", { params: { name: "  " } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /asset name required/);
  });

  it("review-comment add → list → resolve → delete with open/total counts", async () => {
    const asset = await lensRun("creative", "review-asset-create", { params: { name: "Edit v2", kind: "video", durationSec: 60 } }, ctx);
    const assetId = asset.result.asset.id;

    // comment timestamp clamps to the asset duration (60).
    const cmt = await lensRun("creative", "review-comment-add", {
      params: { assetId, body: "fix audio", author: "Dir", timestampSec: 999 },
    }, ctx);
    assert.equal(cmt.ok, true);
    assert.equal(cmt.result.comment.timestampSec, 60);
    assert.equal(cmt.result.comment.resolved, false);

    const list = await lensRun("creative", "review-comment-list", { params: { assetId } }, ctx);
    assert.equal(list.result.count, 1);

    // asset-list surfaces commentCount + openCount.
    const al = await lensRun("creative", "review-asset-list", {}, ctx);
    const row = al.result.assets.find((a) => a.id === assetId);
    assert.equal(row.commentCount, 1);
    assert.equal(row.openCount, 1);

    // resolve toggles; openCount drops.
    const res = await lensRun("creative", "review-comment-resolve", { params: { id: cmt.result.comment.id } }, ctx);
    assert.equal(res.result.comment.resolved, true);
    const al2 = await lensRun("creative", "review-asset-list", {}, ctx);
    assert.equal(al2.result.assets.find((a) => a.id === assetId).openCount, 0);

    const del = await lensRun("creative", "review-comment-delete", { params: { id: cmt.result.comment.id } }, ctx);
    assert.equal(del.result.deleted, cmt.result.comment.id);
    const list2 = await lensRun("creative", "review-comment-list", { params: { assetId } }, ctx);
    assert.equal(list2.result.count, 0);
  });

  it("review-comment-add: rejects body on a missing asset + blank body", async () => {
    const noAsset = await lensRun("creative", "review-comment-add", { params: { assetId: "ghost", body: "hi" } }, ctx);
    assert.equal(noAsset.result.ok, false);
    assert.match(noAsset.result.error, /review asset not found/);

    const asset = await lensRun("creative", "review-asset-create", { params: { name: "Blank body", kind: "image" } }, ctx);
    const blank = await lensRun("creative", "review-comment-add", { params: { assetId: asset.result.asset.id, body: "  " } }, ctx);
    assert.equal(blank.result.ok, false);
    assert.match(blank.result.error, /comment body required/);
  });

  it("review-asset-delete: removes asset + cascades its comments", async () => {
    const asset = await lensRun("creative", "review-asset-create", { params: { name: "Doomed asset", kind: "video", durationSec: 30 } }, ctx);
    const assetId = asset.result.asset.id;
    await lensRun("creative", "review-comment-add", { params: { assetId, body: "note" } }, ctx);
    const del = await lensRun("creative", "review-asset-delete", { params: { id: assetId } }, ctx);
    assert.equal(del.result.deleted, assetId);
    const list = await lensRun("creative", "review-comment-list", { params: { assetId } }, ctx);
    assert.equal(list.result.count, 0);
  });
});

describe("creative — call sheets / breakdowns / deliverables / calendar / proof links CRUD (shared ctx)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("creative-prod2"); });

  it("callsheet create → get → list → remove-row → delete round-trip", async () => {
    const cs = await lensRun("creative", "callsheet-create", { params: { project: "Spot Day 1", generalCall: "09:00" } }, ctx);
    const id = cs.result.sheet.id;

    const got = await lensRun("creative", "callsheet-get", { params: { id } }, ctx);
    assert.equal(got.result.sheet.id, id);

    const row = await lensRun("creative", "callsheet-add-row", { params: { id, section: "crew", name: "Grip", department: "G&E", callTime: "07:00" } }, ctx);
    const rowId = row.result.sheet.crew[0].id;

    const list = await lensRun("creative", "callsheet-list", {}, ctx);
    const lr = list.result.sheets.find((x) => x.id === id);
    assert.equal(lr.crewCount, 1);

    const rm = await lensRun("creative", "callsheet-remove-row", { params: { id, section: "crew", rowId } }, ctx);
    assert.equal(rm.ok, true);
    assert.equal(rm.result.sheet.crew.length, 0);

    const del = await lensRun("creative", "callsheet-delete", { params: { id } }, ctx);
    assert.equal(del.result.deleted, id);
  });

  it("callsheet-create: rejects a blank project; add-row rejects unknown section", async () => {
    const bad = await lensRun("creative", "callsheet-create", { params: { project: "  " } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /project required/);

    const cs = await lensRun("creative", "callsheet-create", { params: { project: "Section test" } }, ctx);
    const badSec = await lensRun("creative", "callsheet-add-row", { params: { id: cs.result.sheet.id, section: "snacks", name: "x" } }, ctx);
    assert.equal(badSec.result.ok, false);
    assert.match(badSec.result.error, /cast\|crew\|locations\|schedule/);
  });

  it("breakdown create → tag → get → untag → list → delete round-trip", async () => {
    const bd = await lensRun("creative", "breakdown-create", { params: { title: "Sc 9", script: "INT. LAB - DAY" } }, ctx);
    const id = bd.result.breakdown.id;

    const tag = await lensRun("creative", "breakdown-tag", { params: { id, category: "props", value: "beaker" } }, ctx);
    assert.equal(tag.result.breakdown.tags.props.length, 1);
    const tagId = tag.result.breakdown.tags.props[0].id;

    // duplicate tag (case-insensitive) does not double-insert.
    const dup = await lensRun("creative", "breakdown-tag", { params: { id, category: "props", value: "BEAKER" } }, ctx);
    assert.equal(dup.result.breakdown.tags.props.length, 1);

    const got = await lensRun("creative", "breakdown-get", { params: { id } }, ctx);
    assert.equal(got.result.breakdown.id, id);
    assert.ok(got.result.suggestions.locations.includes("LAB"));

    const untag = await lensRun("creative", "breakdown-untag", { params: { id, category: "props", tagId } }, ctx);
    assert.equal(untag.result.breakdown.tags.props.length, 0);

    const list = await lensRun("creative", "breakdown-list", {}, ctx);
    assert.ok(list.result.breakdowns.some((b) => b.id === id));

    const del = await lensRun("creative", "breakdown-delete", { params: { id } }, ctx);
    assert.equal(del.result.deleted, id);
  });

  it("breakdown-rescan: re-extracts suggestions from updated script", async () => {
    const bd = await lensRun("creative", "breakdown-create", { params: { title: "Rescan", script: "INT. ONE - DAY" } }, ctx);
    const id = bd.result.breakdown.id;
    const re = await lensRun("creative", "breakdown-rescan", { params: { id, script: "EXT. ROOFTOP - NIGHT\n\nJANE\nGo." } }, ctx);
    assert.equal(re.ok, true);
    assert.ok(re.result.suggestions.locations.includes("ROOFTOP"));
    assert.ok(re.result.suggestions.cast.includes("JANE"));
  });

  it("deliverable list → get → set-current → delete; set-current rejects unknown version", async () => {
    const d = await lensRun("creative", "deliverable-create", { params: { name: "Master" } }, ctx);
    const id = d.result.deliverable.id;
    await lensRun("creative", "deliverable-add-version", { params: { id, note: "v2" } }, ctx);

    const got = await lensRun("creative", "deliverable-get", { params: { id } }, ctx);
    assert.equal(got.result.deliverable.versions.length, 2);

    const list = await lensRun("creative", "deliverable-list", {}, ctx);
    const row = list.result.deliverables.find((x) => x.id === id);
    assert.equal(row.versionCount, 2);

    const setC = await lensRun("creative", "deliverable-set-current", { params: { id, version: 1 } }, ctx);
    assert.equal(setC.result.deliverable.currentVersion, 1);

    const badV = await lensRun("creative", "deliverable-set-current", { params: { id, version: 99 } }, ctx);
    assert.equal(badV.result.ok, false);
    assert.match(badV.result.error, /version not found/);

    const del = await lensRun("creative", "deliverable-delete", { params: { id } }, ctx);
    assert.equal(del.result.deleted, id);
  });

  it("deliverable-add-version: reopens an approved deliverable back to draft", async () => {
    const d = await lensRun("creative", "deliverable-create", { params: { name: "Reopen" } }, ctx);
    const id = d.result.deliverable.id;
    await lensRun("creative", "deliverable-submit", { params: { id } }, ctx);
    await lensRun("creative", "deliverable-decide", { params: { id, decision: "approved" } }, ctx);
    const v = await lensRun("creative", "deliverable-add-version", { params: { id, note: "fresh" } }, ctx);
    assert.equal(v.result.deliverable.status, "draft");
    assert.equal(v.result.deliverable.currentVersion, 2);
  });

  it("calendar add → list (filter+counts) → update → delete round-trip", async () => {
    const ctx3 = await depthCtx("creative-cal-fresh");
    const ev = await lensRun("creative", "calendar-add", { params: { title: "Shoot", date: "2099-01-15", kind: "shoot_day" } }, ctx3);
    const id = ev.result.event.id;
    await lensRun("creative", "calendar-add", { params: { title: "Past Due", date: "2000-01-01", kind: "milestone" } }, ctx3);

    const list = await lensRun("creative", "calendar-list", {}, ctx3);
    assert.equal(list.result.count, 2);
    assert.equal(list.result.upcoming, 1);   // 2099 future, not done
    assert.equal(list.result.overdue, 1);    // 2000 past, not done

    // kind filter narrows.
    const filtered = await lensRun("creative", "calendar-list", { params: { kind: "shoot_day" } }, ctx3);
    assert.equal(filtered.result.count, 1);

    const upd = await lensRun("creative", "calendar-update", { params: { id, title: "Shoot Day Rev", done: true } }, ctx3);
    assert.equal(upd.result.event.title, "Shoot Day Rev");
    assert.equal(upd.result.event.done, true);

    const del = await lensRun("creative", "calendar-delete", { params: { id } }, ctx3);
    assert.equal(del.result.deleted, id);
  });

  it("prooflink list → toggle (deactivate) → public-get rejects inactive → delete", async () => {
    const asset = await lensRun("creative", "review-asset-create", { params: { name: "Proof asset", kind: "video", durationSec: 90 } }, ctx);
    const link = await lensRun("creative", "prooflink-create", { params: { assetId: asset.result.asset.id, label: "Client cut" } }, ctx);
    const linkId = link.result.link.id;
    const token = link.result.link.token;

    const list = await lensRun("creative", "prooflink-list", {}, ctx);
    assert.ok(list.result.links.some((l) => l.id === linkId && l.shareUrl === `/proof/${token}`));

    // public-get works while active.
    const pub = await lensRun("creative", "prooflink-public-get", { params: { token } }, ctx);
    assert.equal(pub.ok, true);
    assert.equal(pub.result.asset.id, asset.result.asset.id);

    // toggle off → public-get rejected as inactive.
    const off = await lensRun("creative", "prooflink-toggle", { params: { id: linkId, active: false } }, ctx);
    assert.equal(off.result.link.active, false);
    const pub2 = await lensRun("creative", "prooflink-public-get", { params: { token } }, ctx);
    assert.equal(pub2.result.ok, false);
    assert.match(pub2.result.error, /inactive/);

    const del = await lensRun("creative", "prooflink-delete", { params: { id: linkId } }, ctx);
    assert.equal(del.result.deleted, linkId);
  });

  it("prooflink-public-get: rejects an unknown token", async () => {
    const bad = await lensRun("creative", "prooflink-public-get", { params: { token: "nope" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /proof link not found/);
  });
});
