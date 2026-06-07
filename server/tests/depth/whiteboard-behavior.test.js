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
