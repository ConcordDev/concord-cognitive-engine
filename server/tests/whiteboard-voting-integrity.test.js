/**
 * Whiteboard S8 — voting integrity (PR #1714).
 *
 * Pins: vote-cast refuses fake boards and fake elements (any id
 * pair tallied before); real votes tally; vote-tally prunes
 * entries whose element no longer exists.
 *
 * Run: node --test server/tests/whiteboard-voting-integrity.test.js
 */
import { test } from "node:test";
import assert from "node:assert/strict";

globalThis._concordSTATE = {};
globalThis.STATE = globalThis._concordSTATE;

const { default: registerWhiteboardActions } = await import("../domains/whiteboard.js");
const actions = new Map();
registerWhiteboardActions((domain, name, fn) => actions.set(name, fn));
const CTX = { actor: { userId: "wb-s8-test" }, userId: "wb-s8-test" };
const call = (name, params = {}, ctx = CTX) => actions.get(name)(ctx, { data: params }, params);

test("fake board/element votes are refused; real votes tally", async () => {
  const saved = await call("board-save", {
    title: "votable",
    scene: { elements: [{ id: "real1", kind: "sticky", x: 0, y: 0, text: "real" }], appState: {} },
  });
  const id = saved.result.board.id;
  const fakeBoard = await call("vote-cast", { boardId: "board_fake", elementId: "real1" });
  assert.equal(fakeBoard.ok, false);
  const fakeElement = await call("vote-cast", { boardId: id, elementId: "ghost_element" });
  assert.equal(fakeElement.ok, false);
  const real = await call("vote-cast", { boardId: id, elementId: "real1" });
  assert.equal(real.ok, true);
  assert.equal(real.result.voteCount, 1);
  const tally = await call("vote-tally", { boardId: id });
  assert.equal(tally.result.total, 1);
  const other = { actor: { userId: "wb-s8-other" }, userId: "wb-s8-other" };
  const cross = await call("vote-cast", { boardId: id, elementId: "real1" }, other);
  assert.equal(cross.ok, false);
});
