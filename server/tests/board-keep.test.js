// tests/board-keep.test.js — REAL end-to-end proof for the Board lens
// keep-and-draft workflow. Mirrors the established pattern:
// create a real board via `board-create`, add a card via `card-create`,
// read it back via `board-detail`, save it as a private DTU via
// `dtu.create`, read that DTU back via `dtu.get`, then draft it in Thread
// via `thread.thread-draft` citing that exact DTU id.
//
// Every lensRun call below names the macro literally. Nothing is published.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { lensRun, depthCtx } from "./depth/_harness.js";

describe("board keep + thread draft", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("board-keep-proof"); });

  it("creates a real board, adds a card, reads it back, saves a private DTU, reads it back, and drafts it in Thread", async () => {
    // 1. Create a real board via the board domain macro.
    const created = await lensRun("board", "board-create", {
      params: { name: "Proof Board" },
    }, ctx);
    assert.equal(created.ok, true, "board-create should succeed");
    const board = created.result.board;
    assert.ok(board.id, "board should have an id");
    assert.ok(board.columns.length >= 3, "board should have default columns");

    // 2. Add a real card to the first column.
    const firstCol = board.columns[0];
    const cardR = await lensRun("board", "card-create", {
      params: {
        boardId: board.id,
        columnId: firstCol.id,
        title: "Proof card",
        description: "Real card created by the board keep proof.",
        labels: ["frontend"],
        dueDate: "2026-11-01",
        assignee: "alex",
      },
    }, ctx);
    assert.equal(cardR.ok, true, "card-create should succeed");
    const card = cardR.result.card;
    assert.ok(card.id, "card should have an id");
    assert.equal(card.title, "Proof card");

    // 3. Read the real board back (the same macro the UI uses).
    const detail = await lensRun("board", "board-detail", { params: { id: board.id } }, ctx);
    assert.equal(detail.ok, true, "board-detail should succeed");
    const back = detail.result.board;
    assert.equal(back.id, board.id);
    assert.equal(back.name, "Proof Board");
    assert.ok(back.cards.length >= 1, "board should have the card");
    assert.equal(back.cards[0].title, "Proof card");

    // 4. Save the board as a private DTU.
    const sentence = `${back.name}: ${back.columns.length} columns, ${back.cards.length} cards.`;
    const dtuCreated = await lensRun("dtu", "create", {
      params: {
        title: sentence.slice(0, 80),
        tags: ["board", "kanban", "project"],
        source: "board-lens:board-report",
        human: { summary: sentence },
        core: { definitions: [sentence], claims: [sentence.slice(0, 240)] },
        machine: {
          kind: "board_lens_board_report",
          boardId: back.id,
          name: back.name,
          columnCount: back.columns.length,
          cardCount: back.cards.length,
          createdAt: back.createdAt,
        },
        meta: { visibility: "private", consent: { allowCitations: false }, createdFrom: "board" },
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
        title: "Board — Proof Board",
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

  it("refuses to create a board with no name", async () => {
    const r = await lensRun("board", "board-create", { params: { name: "" } }, ctx);
    assert.equal(r.result.ok, false);
    assert.ok(/name/.test(r.result.error), "should reject empty name");
  });
});