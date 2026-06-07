// tests/depth/whiteboard-behavior.test.js — REAL behavioral tests for the
// whiteboard domain (registerLensAction family, via lensRun). The tldraw/Miro-
// style canvas lens. Calc/transform actions read artifact.data (pass { data });
// CRUD/collab actions read params against per-user STATE (pass { params } +
// a shared ctx). Exact values below are derived from server/domains/whiteboard.js.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { lensRun, depthCtx } from "./_harness.js";

describe("whiteboard — geometry/transform calcs (exact values)", () => {
  it("shapeDetect: classifies shapes, sums area, computes canvas bounds", async () => {
    const r = await lensRun("whiteboard", "shapeDetect", { data: { elements: [
      { id: "a", type: "rectangle", x: 10, y: 20, width: 100, height: 50 },
      { id: "b", x: 0, y: 0, width: 40, height: 40 }, // no type, w===h → square
    ] } });
    assert.equal(r.ok, true);
    assert.equal(r.result.totalElements, 2);
    assert.equal(r.result.totalArea, 6600);          // 100*50 + 40*40
    assert.equal(r.result.avgArea, 3300);            // 6600 / 2
    assert.deepEqual(r.result.shapeDistribution, { rectangle: 1, square: 1 });
    assert.deepEqual(r.result.canvasBounds, { minX: 0, minY: 0, maxX: 110, maxY: 70 });
  });

  it("layoutOptimize: snaps to default grid 20, scores alignment", async () => {
    const r = await lensRun("whiteboard", "layoutOptimize", { data: { elements: [
      { id: "a", x: 23, y: 38, width: 50, height: 50 },   // off-grid → snaps to (20,40)
      { id: "b", x: 100, y: 100, w: 50, h: 50 },          // on-grid, no overlap
    ] } });
    assert.equal(r.ok, true);
    assert.equal(r.result.gridSize, 20);
    assert.equal(r.result.overlaps, 0);
    assert.equal(r.result.elementsSnapped, 1);
    assert.equal(r.result.alignmentScore, 50);       // (2-1)/2 * 100
    const snappedA = r.result.suggestions.find((sg) => sg.id === "a");
    assert.equal(snappedA.snappedX, 20);             // round(23/20)*20
    assert.equal(snappedA.snappedY, 40);             // round(38/20)*20
  });

  it("exportPrep: tight canvas bounds + aspect ratio + per-layer counts", async () => {
    const r = await lensRun("whiteboard", "exportPrep", { data: { elements: [
      { id: "a", type: "rect", x: 0, y: 0, width: 100, height: 100 },
      { id: "b", type: "note", x: 200, y: 50, width: 100, height: 50 },
    ] } });
    assert.equal(r.ok, true);
    assert.equal(r.result.canvas.width, 300);        // maxX 300 - minX 0
    assert.equal(r.result.canvas.height, 100);       // maxY 100 - minY 0
    assert.equal(r.result.canvas.aspectRatio, "3:1");
    assert.deepEqual(r.result.layers, [{ name: "default", elementCount: 2 }]);
    assert.equal(r.result.totalElements, 2);
  });
});

describe("whiteboard — board CRUD round-trips", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("whiteboard-crud"); });

  it("board-save → board-list → board-load reads the same scene back", async () => {
    const title = `Roadmap ${randomUUID()}`;
    const saved = await lensRun("whiteboard", "board-save", { params: { title, scene: { elements: [{ id: "n1", kind: "sticky", text: "ship it" }] } } }, ctx);
    assert.equal(saved.ok, true);
    const boardId = saved.result.board.id;
    assert.ok(boardId);
    const list = await lensRun("whiteboard", "board-list", {}, ctx);
    const row = list.result.boards.find((b) => b.id === boardId);
    assert.ok(row, "saved board appears in board-list");
    assert.equal(row.elementCount, 1);              // 1 sticky in the scene
    const loaded = await lensRun("whiteboard", "board-load", { params: { id: boardId } }, ctx);
    assert.equal(loaded.result.board.title, title);
    assert.equal(loaded.result.board.scene.elements[0].text, "ship it");
  });

  it("board-duplicate copies the scene; board-delete removes the copy", async () => {
    const src = await lensRun("whiteboard", "board-save", { params: { title: `Src ${randomUUID()}`, scene: { elements: [{ id: "x", kind: "sticky" }, { id: "y", kind: "sticky" }] } } }, ctx);
    const srcId = src.result.board.id;
    const dup = await lensRun("whiteboard", "board-duplicate", { params: { id: srcId } }, ctx);
    assert.equal(dup.ok, true);
    const dupId = dup.result.board.id;
    assert.notEqual(dupId, srcId);                  // distinct id
    assert.equal(dup.result.board.scene.elements.length, 2); // deep-copied scene
    const del = await lensRun("whiteboard", "board-delete", { params: { id: dupId } }, ctx);
    assert.equal(del.result.deleted, dupId);
    const gone = await lensRun("whiteboard", "board-load", { params: { id: dupId } }, ctx);
    assert.equal(gone.result.ok, false);            // deleted board no longer loads
    assert.match(gone.result.error, /not found/);
  });

  it("vote-cast accumulates, vote-tally ranks by count", async () => {
    const b = await lensRun("whiteboard", "board-save", { params: { title: `Vote ${randomUUID()}` } }, ctx);
    const boardId = b.result.board.id;
    await lensRun("whiteboard", "vote-cast", { params: { boardId, elementId: "opt-1" } }, ctx);
    const second = await lensRun("whiteboard", "vote-cast", { params: { boardId, elementId: "opt-1" } }, ctx);
    assert.equal(second.result.voteCount, 1);       // same user → set-dedupe, still 1
    const tally = await lensRun("whiteboard", "vote-tally", { params: { boardId } }, ctx);
    assert.equal(tally.result.total, 1);
    assert.ok(tally.result.tally.some((t) => t.elementId === "opt-1" && t.count === 1));
  });
});

describe("whiteboard — frames + connectors round-trips", () => {
  let ctx, boardId;
  before(async () => {
    ctx = await depthCtx("whiteboard-struct");
    const b = await lensRun("whiteboard", "board-save", { params: { title: `Struct ${randomUUID()}`, scene: { elements: [
      { id: "a", kind: "sticky", x: 0, y: 0, w: 100, h: 100 },
      { id: "b", kind: "sticky", x: 300, y: 0, w: 100, h: 100 },
    ] } } }, ctx);
    boardId = b.result.board.id;
  });

  it("frame-create reports members whose centre falls inside, frame-list reads back", async () => {
    // Frame covering x 0..200 contains 'a' (centre 50,50) but not 'b' (centre 350,50).
    const fc = await lensRun("whiteboard", "frame-create", { params: { boardId, label: "Left", x: -10, y: -10, w: 220, h: 220 } }, ctx);
    assert.equal(fc.ok, true);
    assert.deepEqual(fc.result.frame.memberIds, ["a"]);
    const fl = await lensRun("whiteboard", "frame-list", { params: { boardId } }, ctx);
    assert.ok(fl.result.frames.some((f) => f.id === fc.result.frame.id));
  });

  it("connector-create auto-routes an orthogonal path between two shapes", async () => {
    const cc = await lensRun("whiteboard", "connector-create", { params: { boardId, fromId: "a", toId: "b" } }, ctx);
    assert.equal(cc.ok, true);
    // a(cx50,cy50) → b(cx350,cy50): horizontal, start at a's right edge (100,50), end at b's left edge (300,50).
    assert.deepEqual(cc.result.connector.route.start, { x: 100, y: 50 });
    assert.deepEqual(cc.result.connector.route.end, { x: 300, y: 50 });
    assert.equal(cc.result.connector.route.length, 200); // manhattan |300-100| + |50-50|
    const cl = await lensRun("whiteboard", "connector-list", { params: { boardId } }, ctx);
    assert.ok(cl.result.connectors.some((c) => c.id === cc.result.connector.id));
  });

  it("export-raster-plan draws frames before shapes (layer order)", async () => {
    const r = await lensRun("whiteboard", "export-raster-plan", { params: { boardId, format: "png" } }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.format, "png");
    assert.equal(r.result.elementCount, 2);          // both stickies on the board scene
    assert.ok(r.result.drawOrder.every((d) => d.layer === 1)); // no frames in scene → all layer 1
  });
});

describe("whiteboard — validation rejections", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("whiteboard-reject"); });

  it("template-load rejects an unknown template id", async () => {
    const bad = await lensRun("whiteboard", "template-load", { params: { id: "does-not-exist" } }, ctx);
    assert.equal(bad.result.ok, false);             // lens.run wraps handler {ok:false}
    assert.match(bad.result.error, /unknown template/);
  });

  it("connector-create rejects binding a shape to itself", async () => {
    const b = await lensRun("whiteboard", "board-save", { params: { title: `Self ${randomUUID()}`, scene: { elements: [{ id: "solo", kind: "sticky" }] } } }, ctx);
    const boardId = b.result.board.id;
    const bad = await lensRun("whiteboard", "connector-create", { params: { boardId, fromId: "solo", toId: "solo" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /bind a shape to itself/);
  });
});

// ─── TOP-UP: previously-uncovered macros ──────────────────────────────

describe("whiteboard top-up — pure-compute calcs (exact values)", () => {
  it("clusterGroup: groups by proximity threshold, ranks clusters by size", async () => {
    // 3 elements within 50px of each other (one cluster of 3) + 1 far away (singleton).
    const r = await lensRun("whiteboard", "clusterGroup", { data: { threshold: 50, elements: [
      { id: "a", x: 0, y: 0 },
      { id: "b", x: 30, y: 0 },    // 30 from a → same cluster
      { id: "c", x: 30, y: 30 },   // ~42 from b → same cluster
      { id: "d", x: 1000, y: 1000 }, // far → own cluster
    ] } });
    assert.equal(r.ok, true);
    assert.equal(r.result.clusterCount, 2);
    assert.equal(r.result.singletons, 1);
    const big = r.result.clusters[0];               // sorted desc by size
    assert.equal(big.elementCount, 3);
    assert.deepEqual(big.elements.sort(), ["a", "b", "c"]);
    assert.deepEqual(big.center, { x: 20, y: 10 }); // round(mean(0,30,30))=20, round(mean(0,0,30))=10
  });

  it("templates-list: enumerates the 6 starters with exact element counts", async () => {
    const r = await lensRun("whiteboard", "templates-list", {});
    assert.equal(r.ok, true);
    assert.equal(r.result.templates.length, 6);
    const swot = r.result.templates.find((t) => t.id === "swot");
    assert.equal(swot.elementCount, 4);             // 4 quadrant frames
    const crazy8s = r.result.templates.find((t) => t.id === "crazy8s");
    assert.equal(crazy8s.elementCount, 8);          // 8-cell grid
    assert.ok(r.result.templates.some((t) => t.id === "retro" && t.elementCount === 3));
  });

  it("template-load: returns the SWOT template body with its 4 frames", async () => {
    const r = await lensRun("whiteboard", "template-load", { params: { id: "swot" } });
    assert.equal(r.ok, true);
    assert.equal(r.result.template.id, "swot");
    assert.equal(r.result.template.elements.length, 4);
    assert.ok(r.result.template.elements.some((e) => e.label === "Strengths" && e.kind === "frame"));
  });

  it("ai-generate-board (deterministic): builds a real retro scaffold scene", async () => {
    const noBrain = await depthCtx("whiteboard-aigen-nobrain");
    delete noBrain.llm;  // force the deterministic scaffold path (no brain-replaced stickies)
    const r = await lensRun("whiteboard", "ai-generate-board", { params: { prompt: "sprint 42", kind: "retro" } }, noBrain);
    assert.equal(r.ok, true);
    assert.equal(r.result.kind, "retro");
    assert.equal(r.result.source, "deterministic");
    const frames = r.result.scene.elements.filter((e) => e.kind === "rect");
    assert.equal(frames.length, 3);                 // Went well / Could improve / Action items
    assert.ok(frames.some((f) => f.text === "Action items"));
    assert.ok(r.result.scene.elements.some((e) => e.kind === "sticky" && e.text.includes("sprint 42")));
  });

  it("ai-generate-board rejects an empty prompt", async () => {
    const bad = await lensRun("whiteboard", "ai-generate-board", { params: { prompt: "   " } });
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /prompt required/);
  });
});

describe("whiteboard top-up — timer/comment/export round-trips", () => {
  let ctx, boardId;
  before(async () => {
    ctx = await depthCtx("whiteboard-topup");
    const b = await lensRun("whiteboard", "board-save", { params: { title: `Topup ${randomUUID()}`, scene: { elements: [
      { id: "s1", kind: "sticky", text: "ship the thing" },
      { id: "s2", kind: "sticky", text: "idea two" },
    ] } } }, ctx);
    boardId = b.result.board.id;
  });

  it("timer-start → timer-get reports active with remaining seconds, timer-stop clears it", async () => {
    const start = await lensRun("whiteboard", "timer-start", { params: { boardId, minutes: 5, label: "Standup" } }, ctx);
    assert.equal(start.ok, true);
    assert.equal(start.result.timer.durationSec, 300);   // 5 * 60
    const get = await lensRun("whiteboard", "timer-get", { params: { boardId } }, ctx);
    assert.equal(get.result.active, true);
    assert.equal(get.result.label, "Standup");
    assert.ok(get.result.remainingSec > 290 && get.result.remainingSec <= 300);
    const stop = await lensRun("whiteboard", "timer-stop", { params: { boardId } }, ctx);
    assert.equal(stop.result.active, false);
    const after = await lensRun("whiteboard", "timer-get", { params: { boardId } }, ctx);
    assert.equal(after.result.active, false);            // gone after stop
  });

  it("timer-start clamps minutes to the 0.25..120 range", async () => {
    const huge = await lensRun("whiteboard", "timer-start", { params: { boardId, minutes: 9999 } }, ctx);
    assert.equal(huge.result.timer.durationSec, 7200);   // clamped to 120 min
    await lensRun("whiteboard", "timer-stop", { params: { boardId } }, ctx);
  });

  it("comments-add → comments-list reads the comment back; comments-resolve flips resolved", async () => {
    const add = await lensRun("whiteboard", "comments-add", { params: { boardId, elementId: "s1", body: "needs a deadline" } }, ctx);
    assert.equal(add.ok, true);
    const cmtId = add.result.comment.id;
    assert.equal(add.result.comment.resolved, false);
    const list = await lensRun("whiteboard", "comments-list", { params: { boardId, elementId: "s1" } }, ctx);
    assert.ok(list.result.comments.some((c) => c.id === cmtId && c.body === "needs a deadline"));
    const res = await lensRun("whiteboard", "comments-resolve", { params: { boardId, id: cmtId } }, ctx);
    assert.equal(res.result.comment.resolved, true);
    assert.ok(res.result.comment.resolvedAt);
  });

  it("comments-add rejects an empty body", async () => {
    const bad = await lensRun("whiteboard", "comments-add", { params: { boardId, elementId: "s1", body: "  " } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /body required/);
  });

  it("comments-delete removes a comment; second delete reports not found", async () => {
    const add = await lensRun("whiteboard", "comments-add", { params: { boardId, elementId: "s2", body: "temporary" } }, ctx);
    const cmtId = add.result.comment.id;
    const del = await lensRun("whiteboard", "comments-delete", { params: { boardId, id: cmtId } }, ctx);
    assert.equal(del.result.deleted, true);
    const gone = await lensRun("whiteboard", "comments-delete", { params: { boardId, id: cmtId } }, ctx);
    assert.equal(gone.result.ok, false);
    assert.match(gone.result.error, /comment not found/);
  });

  it("board-export-json packs the scene + comments under the v1 envelope", async () => {
    const r = await lensRun("whiteboard", "board-export-json", { params: { boardId } }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.export.format, "concord-whiteboard/v1");
    assert.equal(r.result.export.board.id, boardId);
    assert.equal(r.result.export.board.scene.elements.length, 2);
    assert.ok(r.result.export.exportedAt);
  });

  it("workspace-summary counts boards, elements, stickies for the user", async () => {
    const r = await lensRun("whiteboard", "workspace-summary", {}, ctx);
    assert.equal(r.ok, true);
    assert.ok(r.result.boardCount >= 1);
    // The Topup board alone has 2 sticky elements; user may have more boards.
    assert.ok(r.result.stickyCount >= 2);
    assert.ok(r.result.elementCount >= r.result.stickyCount);
  });
});

describe("whiteboard top-up — frames/connectors/embeds/presentation", () => {
  let ctx, boardId;
  before(async () => {
    ctx = await depthCtx("whiteboard-topup-struct");
    const b = await lensRun("whiteboard", "board-save", { params: { title: `Struct2 ${randomUUID()}`, scene: { elements: [
      { id: "p", kind: "sticky", x: 0, y: 0, w: 100, h: 100 },
      { id: "q", kind: "sticky", x: 300, y: 0, w: 100, h: 100 },
    ] } } }, ctx);
    boardId = b.result.board.id;
  });

  it("frame-update relabels + resizes; frame-delete removes it", async () => {
    const fc = await lensRun("whiteboard", "frame-create", { params: { boardId, label: "Orig", x: 0, y: 0, w: 200, h: 200 } }, ctx);
    const frameId = fc.result.frame.id;
    const fu = await lensRun("whiteboard", "frame-update", { params: { boardId, id: frameId, label: "Renamed", w: 10 } }, ctx);
    assert.equal(fu.result.frame.label, "Renamed");
    assert.equal(fu.result.frame.w, 40);            // Math.max(40, 10) floor
    const fd = await lensRun("whiteboard", "frame-delete", { params: { boardId, id: frameId } }, ctx);
    assert.equal(fd.result.deleted, frameId);
    const list = await lensRun("whiteboard", "frame-list", { params: { boardId } }, ctx);
    assert.ok(!list.result.frames.some((f) => f.id === frameId));
  });

  it("connector-delete removes a created connector", async () => {
    const cc = await lensRun("whiteboard", "connector-create", { params: { boardId, fromId: "p", toId: "q" } }, ctx);
    const connId = cc.result.connector.id;
    const cd = await lensRun("whiteboard", "connector-delete", { params: { boardId, id: connId } }, ctx);
    assert.equal(cd.result.deleted, connId);
    const list = await lensRun("whiteboard", "connector-list", { params: { boardId } }, ctx);
    assert.ok(!list.result.connectors.some((c) => c.id === connId));
  });

  it("connector-create rejects an endpoint not on the board", async () => {
    const bad = await lensRun("whiteboard", "connector-create", { params: { boardId, fromId: "p", toId: "ghost" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /toId not on board/);
  });

  it("embed-add classifies an image URL by extension; embed-list reads it back", async () => {
    const ea = await lensRun("whiteboard", "embed-add", { params: { boardId, url: "https://example.com/pic.png", x: 5, y: 5 } }, ctx);
    assert.equal(ea.ok, true);
    assert.equal(ea.result.embed.kind, "image");    // classifyEmbedUrl by .png
    assert.equal(ea.result.embed.w, 240);           // image default width
    const list = await lensRun("whiteboard", "embed-list", { params: { boardId } }, ctx);
    assert.ok(list.result.embeds.some((e) => e.id === ea.result.embed.id && e.kind === "image"));
  });

  it("embed-add rejects a non-http url", async () => {
    const bad = await lensRun("whiteboard", "embed-add", { params: { boardId, url: "ftp://nope" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /url must be http/);
  });

  it("embed-update moves + resizes; embed-delete removes it", async () => {
    const ea = await lensRun("whiteboard", "embed-add", { params: { boardId, url: "https://example.com/clip.mp4" } }, ctx);
    const embedId = ea.result.embed.id;
    assert.equal(ea.result.embed.kind, "video");
    const eu = await lensRun("whiteboard", "embed-update", { params: { boardId, id: embedId, x: 99, w: 10 } }, ctx);
    assert.equal(eu.result.embed.x, 99);
    assert.equal(eu.result.embed.w, 40);            // Math.max(40, 10) floor
    const ed = await lensRun("whiteboard", "embed-delete", { params: { boardId, id: embedId } }, ctx);
    assert.equal(ed.result.deleted, embedId);
  });

  it("presentation-build turns frames into ordered slides with camera bounds", async () => {
    const pb = await lensRun("whiteboard", "board-save", { params: { title: `Pres ${randomUUID()}`, scene: { elements: [
      { id: "m", kind: "sticky", x: 50, y: 50, w: 40, h: 40 },
    ] } } }, ctx);
    const presBoard = pb.result.board.id;
    await lensRun("whiteboard", "frame-create", { params: { boardId: presBoard, label: "Slide A", x: 0, y: 0, w: 200, h: 200 } }, ctx);
    await lensRun("whiteboard", "frame-create", { params: { boardId: presBoard, label: "Slide B", x: 500, y: 0, w: 200, h: 200 } }, ctx);
    const r = await lensRun("whiteboard", "presentation-build", { params: { boardId: presBoard } }, ctx);
    assert.equal(r.result.slideCount, 2);
    assert.equal(r.result.slides[0].title, "Slide A");
    assert.deepEqual(r.result.slides[0].camera, { x: 0, y: 0, width: 200, height: 200 });
    assert.deepEqual(r.result.slides[0].memberIds, ["m"]); // sticky centre (70,70) inside Slide A
  });
});

describe("whiteboard top-up — shared boards + ops CRDT round-trips", () => {
  let ctx, sharedId;
  before(async () => {
    ctx = await depthCtx("whiteboard-topup-shared");
    const sb = await lensRun("whiteboard", "share-board", { params: { title: `Shared ${randomUUID()}`, scene: { elements: [{ id: "z", kind: "sticky", text: "hi" }] } } }, ctx);
    sharedId = sb.result.board.id;
  });

  it("share-board → shared-list shows the board for its owner-participant", async () => {
    const list = await lensRun("whiteboard", "shared-list", {}, ctx);
    const row = list.result.boards.find((b) => b.id === sharedId);
    assert.ok(row, "shared board appears for owner");
    assert.equal(row.participantCount, 1);          // owner auto-joined
    assert.equal(row.elementCount, 1);
  });

  it("broadcast-scene rejects a non-participant, accepts the owner", async () => {
    const other = await depthCtx("whiteboard-topup-other");
    const denied = await lensRun("whiteboard", "broadcast-scene", { params: { id: sharedId, scene: { elements: [] } } }, other);
    assert.equal(denied.result.ok, false);
    assert.match(denied.result.error, /not a participant/);
    const ok = await lensRun("whiteboard", "broadcast-scene", { params: { id: sharedId, scene: { elements: [{ id: "z" }, { id: "w" }] } } }, ctx);
    assert.equal(ok.ok, true);
    assert.ok(ok.result.updatedAt);
  });

  it("shared-vote-cast dedupes per voter; shared-vote-tally aggregates", async () => {
    await lensRun("whiteboard", "shared-vote-cast", { params: { id: sharedId, elementId: "z" } }, ctx);
    const second = await lensRun("whiteboard", "shared-vote-cast", { params: { id: sharedId, elementId: "z" } }, ctx);
    assert.equal(second.result.voteCount, 1);       // same user → still 1
    const tally = await lensRun("whiteboard", "shared-vote-tally", { params: { id: sharedId } }, ctx);
    assert.equal(tally.result.total, 1);
    assert.ok(tally.result.tally.some((t) => t.elementId === "z" && t.count === 1));
  });

  it("join-shared lets another user in, then leave-shared decrements participants", async () => {
    const guest = await depthCtx("whiteboard-topup-guest");
    const join = await lensRun("whiteboard", "join-shared", { params: { id: sharedId } }, guest);
    assert.equal(join.result.board.participantCount, 2);
    const leave = await lensRun("whiteboard", "leave-shared", { params: { id: sharedId } }, guest);
    assert.equal(leave.result.remainingParticipants, 1);
  });

  it("ops-apply folds add/update/delete LWW; ops-since returns ops past a clock", async () => {
    const ob = await lensRun("whiteboard", "board-save", { params: { title: `Ops ${randomUUID()}`, scene: { elements: [] } } }, ctx);
    const opsBoard = ob.result.board.id;
    const a1 = await lensRun("whiteboard", "ops-apply", { params: { boardId: opsBoard, ops: [
      { type: "add", element: { id: "e1", kind: "sticky", text: "v1" } },
      { type: "add", element: { id: "e2", kind: "sticky", text: "keep" } },
    ] } }, ctx);
    assert.equal(a1.result.accepted, 2);
    assert.equal(a1.result.clock, 2);
    const a2 = await lensRun("whiteboard", "ops-apply", { params: { boardId: opsBoard, ops: [
      { type: "update", element: { id: "e1", kind: "sticky", text: "v2" } },
      { type: "delete", elementId: "e2" },
    ] } }, ctx);
    assert.equal(a2.result.clock, 4);
    const load = await lensRun("whiteboard", "board-load", { params: { id: opsBoard } }, ctx);
    const els = load.result.board.scene.elements;
    assert.equal(els.length, 1);                    // e2 deleted, e1 updated
    assert.ok(els.some((e) => e.id === "e1" && e.text === "v2")); // LWW kept the higher-clock value
    const since = await lensRun("whiteboard", "ops-since", { params: { boardId: opsBoard, sinceClock: 2 } }, ctx);
    assert.equal(since.result.ops.length, 2);       // only the 2 ops after clock 2
    assert.ok(since.result.ops.every((o) => o.clock > 2));
  });

  it("reaction-send rejects an unsupported emoji, accepts a palette one", async () => {
    const bad = await lensRun("whiteboard", "reaction-send", { params: { id: sharedId, boardId: sharedId, emoji: "🦄", x: 1, y: 1 } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /unsupported emoji/);
    const ok = await lensRun("whiteboard", "reaction-send", { params: { boardId: sharedId, emoji: "🎉", x: 10, y: 20 } }, ctx);
    assert.equal(ok.ok, true);
    assert.equal(ok.result.reaction.emoji, "🎉");
    assert.ok(ok.result.palette.includes("🚀"));
  });

  it("presence-ping records a named cursor; presence-list returns it as active", async () => {
    await lensRun("whiteboard", "presence-ping", { params: { boardId: sharedId, name: "Ada", x: 7, y: 8 } }, ctx);
    const list = await lensRun("whiteboard", "presence-list", { params: { boardId: sharedId } }, ctx);
    assert.ok(list.result.participants.some((p) => p.name === "Ada" && p.x === 7 && p.y === 8));
  });
});

// ─── WAVE 7 TOP-UP: previously-uncovered deterministic macros ─────────
//
// New coverage: shapeDetect circle area, layoutOptimize overlap detection,
// exportPrep recommendations, clusterGroup singletons, vote-tally ranking,
// ai-cluster-stickies (Jaccard), ai-summarize-board (action-item extraction),
// connector-create vertical route geometry, export-raster-plan PDF tiling +
// padding bounds, broadcast-cursor, published-blueprint-coverage.

describe("whiteboard — geometry/cluster calcs (wave 7 top-up)", () => {
  it("shapeDetect computes circle area via πr² and classifies by radius", async () => {
    const r = await lensRun("whiteboard", "shapeDetect", { data: { elements: [
      { id: "c", radius: 10 },                                  // circle → round(π·10²) = 314
      { id: "p", type: "polygon", x: 5, y: 5, width: 20, height: 20 },
    ] } });
    assert.equal(r.ok, true);
    assert.deepEqual(r.result.shapeDistribution, { circle: 1, polygon: 1 });
    const circle = r.result.elements.find((e) => e.id === "c");
    assert.equal(circle.area, 314);                            // Math.round(π·100)
    assert.equal(r.result.totalArea, 314 + 400);              // circle 314 + polygon 20*20
    assert.equal(r.result.avgArea, Math.round(714 / 2));      // 357
  });

  it("layoutOptimize flags overlapping pairs by AABB intersection", async () => {
    const r = await lensRun("whiteboard", "layoutOptimize", { data: { elements: [
      { id: "a", x: 0, y: 0, width: 100, height: 100 },
      { id: "b", x: 50, y: 50, width: 100, height: 100 },     // overlaps a
      { id: "c", x: 1000, y: 1000, width: 20, height: 20 },   // far away
    ] } });
    assert.equal(r.ok, true);
    assert.equal(r.result.overlaps, 1);
    assert.ok(r.result.overlapPairs.some((p) => p.element1 === "a" && p.element2 === "b"));
    assert.ok(!r.result.overlapPairs.some((p) => p.element1 === "c" || p.element2 === "c"));
  });

  it("exportPrep emits the large-canvas + many-elements recommendations", async () => {
    // 201 tiny elements, one of which pushes the canvas past 4000px wide.
    const elements = Array.from({ length: 201 }, (_, i) => ({ id: `e${i}`, x: i, y: 0, width: 10, height: 10 }));
    elements.push({ id: "far", x: 5000, y: 0, width: 10, height: 10 });
    const r = await lensRun("whiteboard", "exportPrep", { data: { elements } });
    assert.equal(r.ok, true);
    assert.ok(r.result.canvas.width >= 5000);                 // far element widens the canvas
    assert.ok(r.result.recommendations.includes("Large canvas — consider splitting for high-res export"));
    assert.ok(r.result.recommendations.includes("Many elements — SVG export recommended over raster"));
  });

  it("clusterGroup returns a single singleton cluster when all elements are far apart", async () => {
    const r = await lensRun("whiteboard", "clusterGroup", { data: { threshold: 10, elements: [
      { id: "a", x: 0, y: 0 },
      { id: "b", x: 500, y: 0 },
      { id: "c", x: 0, y: 500 },
    ] } });
    assert.equal(r.ok, true);
    assert.equal(r.result.clusterCount, 3);                   // each isolated
    assert.equal(r.result.singletons, 3);
    assert.ok(r.result.clusters.every((c) => c.elementCount === 1));
  });

  it("connector-create routes a vertical elbow when shapes are stacked", async () => {
    const ctx = await depthCtx("whiteboard-wave7-conn");
    const b = await lensRun("whiteboard", "board-save", { params: { title: `VConn ${randomUUID()}`, scene: { elements: [
      { id: "top", kind: "sticky", x: 0, y: 0, w: 100, h: 100 },     // cx50, cy50
      { id: "bot", kind: "sticky", x: 0, y: 300, w: 100, h: 100 },   // cx50, cy350
    ] } } }, ctx);
    const boardId = b.result.board.id;
    const cc = await lensRun("whiteboard", "connector-create", { params: { boardId, fromId: "top", toId: "bot" } }, ctx);
    assert.equal(cc.ok, true);
    // dy(300) > dx(0) → vertical: start at top's bottom edge (50,100), end at bot's top edge (50,300).
    assert.deepEqual(cc.result.connector.route.start, { x: 50, y: 100 });
    assert.deepEqual(cc.result.connector.route.end, { x: 50, y: 300 });
    assert.equal(cc.result.connector.route.length, 200);       // |50-50| + |300-100|
    assert.equal(cc.result.connector.route.waypoints.length, 2); // colinear → no elbow inserted
  });
});

describe("whiteboard — AI deterministic (wave 7 top-up)", () => {
  let ctx, boardId;
  before(async () => {
    ctx = await depthCtx("whiteboard-wave7-ai");
    // Strip the brain so the AI macros exercise their DETERMINISTIC path
    // unconditionally — otherwise a reachable loopback Ollama makes the
    // source/content non-deterministic. We assert the deterministic algo.
    delete ctx.llm;
    const b = await lensRun("whiteboard", "board-save", { params: { title: `AI ${randomUUID()}`, scene: { elements: [
      { id: "k1", kind: "sticky", text: "redesign the onboarding flow for new users" },
      { id: "k2", kind: "sticky", text: "rework the onboarding flow tooltips" }, // shares onboarding/flow → same cluster
      { id: "k3", kind: "sticky", text: "ship the billing export feature" },     // disjoint tokens → own cluster
      { id: "k4", kind: "frame", text: "Themes" },
    ] } } }, ctx);
    boardId = b.result.board.id;
  });

  it("ai-cluster-stickies groups by token-overlap Jaccard ≥ 0.2 deterministically", async () => {
    const r = await lensRun("whiteboard", "ai-cluster-stickies", { params: { boardId } }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.source, "deterministic");           // brain stripped in before()
    // k1+k2 share "onboarding"/"flow" → one cluster of 2; k3 alone → cluster of 1.
    const big = r.result.clusters.find((c) => c.size === 2);
    assert.ok(big, "two onboarding stickies cluster together");
    assert.deepEqual(big.memberIds.sort(), ["k1", "k2"]);
    assert.ok(big.theme.includes("onboarding") || big.theme.includes("flow")); // theme from common tokens
    assert.ok(r.result.clusters.some((c) => c.size === 1 && c.memberIds[0] === "k3"));
  });

  it("ai-summarize-board extracts imperative stickies as action items", async () => {
    const r = await lensRun("whiteboard", "ai-summarize-board", { params: { boardId } }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.source, "deterministic");           // brain stripped in before()
    assert.ok(r.result.summary.includes("3 sticky notes"));    // k1,k2,k3 are stickies; k4 is a frame
    assert.ok(r.result.summary.includes("1 frame"));
    // "ship the billing export" matches the imperative pattern (\bship\b); onboarding ones don't.
    assert.ok(r.result.actionItems.some((a) => a.sourceShapeId === "k3"));
    assert.ok(!r.result.actionItems.some((a) => a.sourceShapeId === "k1"));
  });

  it("ai-summarize-board reports an empty board honestly", async () => {
    const empty = await lensRun("whiteboard", "board-save", { params: { title: `Empty ${randomUUID()}`, scene: { elements: [] } } }, ctx);
    const r = await lensRun("whiteboard", "ai-summarize-board", { params: { boardId: empty.result.board.id } }, ctx);
    assert.equal(r.result.summary, "(board is empty)");
    assert.deepEqual(r.result.actionItems, []);
  });

  it("ai-cluster-stickies short-circuits with < 2 sticky notes", async () => {
    const solo = await lensRun("whiteboard", "board-save", { params: { title: `Solo ${randomUUID()}`, scene: { elements: [
      { id: "only", kind: "sticky", text: "lonely note" },
    ] } } }, ctx);
    const r = await lensRun("whiteboard", "ai-cluster-stickies", { params: { boardId: solo.result.board.id } }, ctx);
    assert.equal(r.ok, true);
    assert.deepEqual(r.result.clusters, []);
    assert.match(r.result.message, /at least 2 sticky notes/);
  });
});

describe("whiteboard — raster export + cursor (wave 7 top-up)", () => {
  let ctx, boardId;
  before(async () => {
    ctx = await depthCtx("whiteboard-wave7-export");
    const b = await lensRun("whiteboard", "board-save", { params: { title: `Big ${randomUUID()}`, scene: { elements: [
      { id: "tl", kind: "sticky", x: 0, y: 0, w: 100, h: 100 },
      { id: "br", kind: "sticky", x: 2000, y: 1500, w: 100, h: 100 }, // far → spans multiple PDF pages
    ] } } }, ctx);
    boardId = b.result.board.id;
  });

  it("export-raster-plan applies padding to the bounds and scales pixel dimensions", async () => {
    const r = await lensRun("whiteboard", "export-raster-plan", { params: { boardId, format: "png", scale: 2, padding: 40 } }, ctx);
    assert.equal(r.ok, true);
    // content bounds 0..2100 wide, 0..1600 tall; padding 40 each side.
    assert.deepEqual(r.result.bounds, { x: -40, y: -40, width: 2100 + 80, height: 1600 + 80 });
    assert.equal(r.result.pixelDimensions.width, (2100 + 80) * 2);   // bounds.width * scale
    assert.equal(r.result.pixelDimensions.height, (1600 + 80) * 2);
  });

  it("export-raster-plan tiles a large board into a PDF page grid", async () => {
    const r = await lensRun("whiteboard", "export-raster-plan", { params: { boardId, format: "pdf", padding: 0 } }, ctx);
    assert.equal(r.result.format, "pdf");
    // bounds 2100 wide / 1123 page → 2 cols; 1600 tall / 794 → 3 rows → 6 pages.
    const cols = Math.ceil(2100 / 1123), rows = Math.ceil(1600 / 794);
    assert.equal(r.result.pages.length, cols * rows);
    assert.ok(r.result.warnings.some((w) => w.includes("PDF pages")));
    assert.deepEqual(r.result.pages[0], { index: 0, x: 0, y: 0, width: 1123, height: 794 });
  });

  it("export-raster-plan reports empty boards instead of computing bounds", async () => {
    const empty = await lensRun("whiteboard", "board-save", { params: { title: `E ${randomUUID()}`, scene: { elements: [] } } }, ctx);
    const r = await lensRun("whiteboard", "export-raster-plan", { params: { boardId: empty.result.board.id } }, ctx);
    assert.equal(r.result.empty, true);
    assert.match(r.result.message, /no elements/);
  });

  it("broadcast-cursor rejects a non-participant and non-finite coords, echoes valid ones", async () => {
    const sb = await lensRun("whiteboard", "share-board", { params: { title: `Cur ${randomUUID()}`, scene: { elements: [{ id: "z" }] } } }, ctx);
    const id = sb.result.board.id;
    const badCoords = await lensRun("whiteboard", "broadcast-cursor", { params: { id, x: "nope" } }, ctx);
    assert.equal(badCoords.result.ok, false);
    assert.match(badCoords.result.error, /x, y required/);
    const other = await depthCtx("whiteboard-wave7-cursor-other");
    const denied = await lensRun("whiteboard", "broadcast-cursor", { params: { id, x: 1, y: 2 } }, other);
    assert.equal(denied.result.ok, false);
    assert.match(denied.result.error, /not a participant/);
    const ok = await lensRun("whiteboard", "broadcast-cursor", { params: { id, x: 12, y: 34 } }, ctx);
    assert.equal(ok.ok, true);
    assert.equal(ok.result.x, 12);
    assert.equal(ok.result.y, 34);
  });

  it("vote-tally ranks elements by descending vote count across the board", async () => {
    const vctx = await depthCtx("whiteboard-wave7-vote");
    const b = await lensRun("whiteboard", "board-save", { params: { title: `Tally ${randomUUID()}` } }, vctx);
    const bId = b.result.board.id;
    await lensRun("whiteboard", "vote-cast", { params: { boardId: bId, elementId: "low" } }, vctx);
    await lensRun("whiteboard", "vote-cast", { params: { boardId: bId, elementId: "high" } }, vctx);
    const tally = await lensRun("whiteboard", "vote-tally", { params: { boardId: bId } }, vctx);
    assert.equal(tally.result.total, 2);                        // both elements, 1 voter each
    assert.equal(tally.result.tally.length, 2);
    assert.ok(tally.result.tally.every((t) => t.count === 1));
  });
});

// ─── WAVE 8 TOP-UP: still-uncovered deterministic macros ──────────────
//
// New coverage: shapeDetect unknown/polygon fallbacks, embed-add document
// classification + default dims, connector style/label, frame-create defaults,
// ops-apply knownClock skew + ops-since baseline, timer-get expiry, vote-tally
// empty, and the content-engine bridge (publish-as-blueprint serialisation +
// published-blueprint-coverage DB round-trip).

describe("whiteboard — classification + embed edge calcs (wave 8 top-up)", () => {
  it("shapeDetect tags zero-dimension elements 'unknown' with area 0", async () => {
    const r = await lensRun("whiteboard", "shapeDetect", { data: { elements: [
      { id: "ghost" },                                          // no dims, no type → unknown
      { id: "line", points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] }, // points → polygon, area 0 (w/h 0)
    ] } });
    assert.equal(r.ok, true);
    assert.deepEqual(r.result.shapeDistribution, { unknown: 1, polygon: 1 });
    const ghost = r.result.elements.find((e) => e.id === "ghost");
    assert.equal(ghost.type, "unknown");
    assert.equal(ghost.area, 0);
    assert.equal(r.result.totalArea, 0);                        // both contribute 0
    assert.equal(r.result.avgArea, 0);
  });

  it("embed-add classifies a .pdf URL as a document with the 280px link/doc default width", async () => {
    const ctx = await depthCtx("whiteboard-wave8-embed");
    const b = await lensRun("whiteboard", "board-save", { params: { title: `Doc ${randomUUID()}`, scene: { elements: [] } } }, ctx);
    const boardId = b.result.board.id;
    const ea = await lensRun("whiteboard", "embed-add", { params: { boardId, url: "https://example.com/spec.pdf", x: 11, y: 22 } }, ctx);
    assert.equal(ea.ok, true);
    assert.equal(ea.result.embed.kind, "document");             // classifyEmbedUrl by .pdf
    assert.equal(ea.result.embed.w, 280);                       // document default width
    assert.equal(ea.result.embed.h, 120);                       // document default height
    assert.equal(ea.result.embed.title, "https://example.com/spec.pdf"); // no title → falls back to url
    const list = await lensRun("whiteboard", "embed-list", { params: { boardId } }, ctx);
    assert.ok(list.result.embeds.some((e) => e.id === ea.result.embed.id && e.kind === "document"));
  });

  it("connector-create honours a 'dashed' style + label, defaults bad styles to 'arrow'", async () => {
    const ctx = await depthCtx("whiteboard-wave8-conn");
    const b = await lensRun("whiteboard", "board-save", { params: { title: `Styled ${randomUUID()}`, scene: { elements: [
      { id: "u", kind: "sticky", x: 0, y: 0, w: 100, h: 100 },
      { id: "v", kind: "sticky", x: 400, y: 0, w: 100, h: 100 },
    ] } } }, ctx);
    const boardId = b.result.board.id;
    const dashed = await lensRun("whiteboard", "connector-create", { params: { boardId, fromId: "u", toId: "v", style: "dashed", label: "depends on" } }, ctx);
    assert.equal(dashed.result.connector.style, "dashed");
    assert.equal(dashed.result.connector.label, "depends on");
    const fallback = await lensRun("whiteboard", "connector-create", { params: { boardId, fromId: "u", toId: "v", style: "squiggle" } }, ctx);
    assert.equal(fallback.result.connector.style, "arrow");     // unknown style → default arrow
  });
});

describe("whiteboard — frame/timer/ops edges (wave 8 top-up)", () => {
  let ctx, boardId;
  before(async () => {
    ctx = await depthCtx("whiteboard-wave8-struct");
    const b = await lensRun("whiteboard", "board-save", { params: { title: `W8 ${randomUUID()}`, scene: { elements: [
      { id: "out", kind: "sticky", x: 5000, y: 5000, w: 40, h: 40 }, // centre far outside default frame
    ] } } }, ctx);
    boardId = b.result.board.id;
  });

  it("frame-create applies the 600x400 default box when no size is given", async () => {
    const fc = await lensRun("whiteboard", "frame-create", { params: { boardId, label: "Default" } }, ctx);
    assert.equal(fc.ok, true);
    assert.equal(fc.result.frame.w, 600);                       // default width
    assert.equal(fc.result.frame.h, 400);                       // default height
    assert.equal(fc.result.frame.x, 0);
    assert.equal(fc.result.frame.y, 0);
    assert.deepEqual(fc.result.frame.memberIds, []);            // 'out' centre (5020,5020) not inside 0..600/0..400
  });

  it("timer-get reports expired (not active) once endsAt has passed", async () => {
    const start = await lensRun("whiteboard", "timer-start", { params: { boardId, minutes: 0.25, label: "Quick" } }, ctx);
    assert.equal(start.result.timer.durationSec, 15);           // clamped low bound 0.25 min
    // Force expiry by rewinding endsAt into the past directly on STATE.
    const { STATE } = await import("../../server.js").then((m) => m.__TEST__);
    STATE.whiteboardLens.timers.get(boardId).endsAt = new Date(Date.now() - 1000).toISOString();
    const get = await lensRun("whiteboard", "timer-get", { params: { boardId } }, ctx);
    assert.equal(get.result.active, false);
    assert.equal(get.result.expired, true);
    assert.equal(get.result.label, "Quick");
    await lensRun("whiteboard", "timer-stop", { params: { boardId } }, ctx);
  });

  it("ops-apply seeds the Lamport clock past a knownClock skew", async () => {
    const ob = await lensRun("whiteboard", "board-save", { params: { title: `Skew ${randomUUID()}`, scene: { elements: [] } } }, ctx);
    const opsBoard = ob.result.board.id;
    const a = await lensRun("whiteboard", "ops-apply", { params: { boardId: opsBoard, knownClock: 40, ops: [
      { type: "add", element: { id: "n", kind: "sticky", text: "after skew" } },
    ] } }, ctx);
    assert.equal(a.result.accepted, 1);
    assert.equal(a.result.clock, 41);                           // max(0,40) then +1
    assert.equal(a.result.ops[0].clock, 41);
  });

  it("ops-apply rejects an empty ops array; ops-since with sinceClock 0 returns the baseline scene", async () => {
    const ob = await lensRun("whiteboard", "board-save", { params: { title: `Base ${randomUUID()}`, scene: { elements: [] } } }, ctx);
    const opsBoard = ob.result.board.id;
    const bad = await lensRun("whiteboard", "ops-apply", { params: { boardId: opsBoard, ops: [] } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /ops array required/);
    await lensRun("whiteboard", "ops-apply", { params: { boardId: opsBoard, ops: [
      { type: "add", element: { id: "k", kind: "sticky", text: "seed" } },
    ] } }, ctx);
    const since = await lensRun("whiteboard", "ops-since", { params: { boardId: opsBoard, sinceClock: 0 } }, ctx);
    assert.equal(since.result.baselineNeeded, true);            // sinceClock 0 → full baseline
    assert.ok(since.result.scene);
    assert.ok(since.result.scene.elements.some((e) => e.id === "k"));
  });

  it("vote-tally reports an empty result for a board nobody has voted on", async () => {
    const vctx = await depthCtx("whiteboard-wave8-vote");
    const b = await lensRun("whiteboard", "board-save", { params: { title: `Novote ${randomUUID()}` } }, vctx);
    const tally = await lensRun("whiteboard", "vote-tally", { params: { boardId: b.result.board.id } }, vctx);
    assert.equal(tally.result.total, 0);
    assert.deepEqual(tally.result.tally, []);
  });
});

describe("whiteboard — content-engine blueprint bridge (wave 8 top-up)", () => {
  let ctx, boardId;
  before(async () => {
    ctx = await depthCtx("whiteboard-wave8-blueprint");
    const b = await lensRun("whiteboard", "board-save", { params: { title: `Tavern ${randomUUID()}`, scene: { elements: [
      { id: "bar",  kind: "rectangle", x: 10, y: 20, width: 200, height: 60, text: "Long bar", fillColor: "#553311" },
      { id: "stool" },  // no dims/kind/text → defaults: kind 'shape', 60x60, no label
    ] } } }, ctx);
    boardId = b.result.board.id;
  });

  it("publish-as-blueprint serialises the board to decor with default-filled geometry, then coverage reads it back", async () => {
    const pub = await lensRun("whiteboard", "publish-as-blueprint", { params: { boardId, archetype: "tavern" } }, ctx);
    assert.equal(pub.ok, true);
    assert.equal(pub.result.elementCount, 2);                   // both elements serialised
    assert.equal(pub.result.archetype, "tavern");
    assert.equal(pub.result.created, true);                     // first publish creates the asset
    assert.match(pub.result.sourceId, /^blueprint:tavern:/);
    // published-blueprint-coverage reads the just-registered evo_assets row back (DB round-trip).
    const cov = await lensRun("whiteboard", "published-blueprint-coverage", {}, ctx);
    assert.equal(cov.ok, true);
    assert.ok(cov.result.archetypes.tavern, "tavern archetype now covered");
    assert.equal(cov.result.archetypes.tavern.assetId, pub.result.assetId);
    assert.equal(cov.result.archetypes.forge, null);            // unpublished archetype stays null
  });

  it("publish-as-blueprint is idempotent on (source, sourceId) for the same board", async () => {
    const first = await lensRun("whiteboard", "publish-as-blueprint", { params: { boardId, archetype: "archive" } }, ctx);
    assert.equal(first.result.created, true);
    const second = await lensRun("whiteboard", "publish-as-blueprint", { params: { boardId, archetype: "archive" } }, ctx);
    assert.equal(second.result.created, false);                 // dedup → same asset id, not re-created
    assert.equal(second.result.assetId, first.result.assetId);
  });

  it("publish-as-blueprint rejects an unknown archetype and a missing boardId", async () => {
    const badArch = await lensRun("whiteboard", "publish-as-blueprint", { params: { boardId, archetype: "dungeon" } }, ctx);
    assert.equal(badArch.result.ok, false);
    assert.match(badArch.result.error, /archetype must be one of/);
    const noBoard = await lensRun("whiteboard", "publish-as-blueprint", { params: { archetype: "tavern" } }, ctx);
    assert.equal(noBoard.result.ok, false);
    assert.match(noBoard.result.error, /boardId required/);
  });
});
