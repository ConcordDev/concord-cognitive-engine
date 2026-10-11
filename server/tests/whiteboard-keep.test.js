// tests/whiteboard-keep.test.js — REAL end-to-end proof for the Whiteboard
// lens keep-and-draft workflow. Mirrors the established pattern:
// create a real board via `board-save` (with a real scene + element),
// read it back via `board-load`, save it as a private DTU via `dtu.create`,
// read that DTU back via `dtu.get`, then draft it in Thread via
// `thread.thread-draft` citing that exact DTU id.
//
// Every lensRun call below names the macro literally. Nothing is published.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { lensRun, depthCtx } from "./depth/_harness.js";

describe("whiteboard keep + thread draft", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("whiteboard-keep-proof"); });

  it("creates a real board, reads it back, saves a private DTU, reads it back, and drafts it in Thread", async () => {
    // 1. Create a real board via the whiteboard domain board-save macro.
    const scene = {
      elements: [
        { type: "rectangle", x: 10, y: 10, width: 100, height: 60, text: "Proof card", stroke: "#00d4ff", fill: "transparent", strokeWidth: 2 },
      ],
      appState: {},
    };
    const boardR = await lensRun("whiteboard", "board-save", {
      params: { title: "Proof Board", scene },
    }, ctx);
    assert.equal(boardR.ok, true, "board-save should succeed");
    const board = boardR.result.board;
    assert.ok(board.id, "board should have an id");
    assert.equal(board.title, "Proof Board");
    assert.equal(Array.isArray(board.scene?.elements), true);
    assert.equal(board.scene.elements.length, 1);

    // 2. Read the real board back via board-load (the same macro the UI uses).
    const loadR = await lensRun("whiteboard", "board-load", { params: { id: board.id } }, ctx);
    assert.equal(loadR.ok, true, "board-load should succeed");
    assert.equal(loadR.result.board.id, board.id, "read-back board id must match");
    assert.equal(loadR.result.board.title, "Proof Board");
    assert.equal(loadR.result.board.scene.elements.length, 1);

    // 3. Also confirm board-list sees it.
    const listR = await lensRun("whiteboard", "board-list", {}, ctx);
    assert.equal(listR.ok, true, "board-list should succeed");
    const listed = listR.result.boards.find((b) => b.id === board.id);
    assert.ok(listed, "board-list should include the created board");
    assert.equal(listed.title, "Proof Board");

    // 4. Save the board as a private DTU.
    const sentence = "Proof Board: 1 element.";
    const dtuCreated = await lensRun("dtu", "create", {
      params: {
        title: sentence.slice(0, 80),
        tags: ["whiteboard", "board", "canvas"],
        source: "whiteboard-lens:board-report",
        human: { summary: sentence },
        core: { definitions: [sentence], claims: [sentence.slice(0, 240)] },
        machine: {
          kind: "whiteboard_board_report",
          boardId: board.id,
          title: board.title,
          elementCount: 1,
        },
        meta: { visibility: "private", consent: { allowCitations: false }, createdFrom: "whiteboard" },
      },
    }, ctx);
    assert.equal(dtuCreated.ok, true, "dtu.create should succeed");
    const dtuId = dtuCreated.result.dtu.id;
    assert.ok(dtuId, "DTU should have an id");

    // 5. Read the DTU back and confirm the id matches.
    const dtuBack = await lensRun("dtu", "get", { params: { id: dtuId } }, ctx);
    assert.equal(dtuBack.ok, true, "dtu.get should succeed");
    assert.equal(dtuBack.result.dtu.id, dtuId, "read-back DTU id must match");

    // 6. Draft it in Thread, citing that exact DTU.
    const drafted = await lensRun("thread", "thread-draft", {
      params: {
        title: `Whiteboard — Proof Board`,
        content: sentence,
        platform: "x",
        citedDtuId: dtuId,
      },
    }, ctx);
    assert.equal(drafted.ok, true, "thread-draft should succeed");
    const draft = drafted.result.draft;
    assert.equal(draft.status, "draft", "draft must stay draft");
    assert.equal(draft.citedDtuId, dtuId, "draft must cite the exact DTU");
    assert.ok(draft.id, "draft should have an id");

    // 7. Read the draft back and confirm it still cites the DTU.
    const draftBack = await lensRun("thread", "draft-detail", { params: { id: draft.id } }, ctx);
    assert.equal(draftBack.ok, true, "draft-detail should succeed");
    assert.equal(draftBack.result.draft.citedDtuId, dtuId, "draft-detail must cite the same DTU");
    assert.equal(draftBack.result.draft.status, "draft", "draft-detail must still be draft");
  });

  it("a board-report DTU with skipAutoTag does not pick up schema, news, or crypto", async () => {
    const summary = "Updated: a definition of the board.";
    const created = await lensRun("dtu", "create", {
      params: {
        title: "Board report",
        tags: ["whiteboard", "board", "canvas"],
        source: "whiteboard-lens:board-report",
        skipAutoTag: true,
        human: { summary },
        core: { definitions: [summary], claims: [summary] },
        meta: { visibility: "private", createdFrom: "whiteboard", skipAutoTag: true },
      },
    }, ctx);
    assert.equal(created.ok, true);
    const id = created.result.dtu.id;
    const back = await lensRun("dtu", "get", { params: { id } }, ctx);
    const tags = back.result.dtu.tags || [];
    assert.equal(tags.includes("schema"), false);
    assert.equal(tags.includes("news"), false);
    assert.equal(tags.includes("crypto"), false);
    assert.equal(tags.includes("whiteboard"), true);
  });

  it("refuses to save a board with an unsafe id", async () => {
    const r = await lensRun("whiteboard", "board-save", {
      params: { id: "../../etc/passwd", title: "x", scene: { elements: [] } },
    }, ctx);
    assert.equal(r.result.ok, false, "unsafe board id should be rejected");
    assert.ok(/letters/i.test(r.result.error) || /must contain/i.test(r.result.error), "should reject unsafe id");
  });
});