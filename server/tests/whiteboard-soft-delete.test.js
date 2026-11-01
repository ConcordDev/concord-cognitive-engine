/**
 * Whiteboard S2 — delete that deletes (PR #1714).
 *
 * Pins: board-delete is soft and funnels through deletedAt (list,
 * load, duplicate and board lookups stop seeing the board at once);
 * board-save cannot resurrect a trashed board; board-restore returns
 * it whole; board-delete-permanent is trash-first and final.
 *
 * Run: node --test server/tests/whiteboard-soft-delete.test.js
 */
import { test } from "node:test";
import assert from "node:assert/strict";

globalThis._concordSTATE = {};
globalThis.STATE = globalThis._concordSTATE;

const { default: registerWhiteboardActions } = await import("../domains/whiteboard.js");
const actions = new Map();
registerWhiteboardActions((domain, name, fn) => actions.set(name, fn));
const CTX = { actor: { userId: "wb-s2-test" }, userId: "wb-s2-test" };
const call = (name, params = {}) => actions.get(name)(CTX, { data: params }, params);

const SCENE = { elements: [{ id: "a", kind: "sticky", x: 1, y: 2, text: "hi" }], appState: {} };

test("soft delete hides the board from list, load and duplicate", async () => {
  await call("board-save", { id: "board_d", title: "Doomed", scene: SCENE });
  const del = await call("board-delete", { id: "board_d" });
  assert.equal(del.result.soft, true);
  assert.equal((await call("board-list", {})).result.boards.length, 0);
  assert.equal((await call("board-load", { id: "board_d" })).ok, false);
  assert.equal((await call("board-duplicate", { id: "board_d" })).ok, false);
});

test("trash list + restore round-trips the board whole; saves cannot resurrect it", async () => {
  await call("board-save", { id: "board_t", title: "Trashed", scene: SCENE });
  await call("board-delete", { id: "board_t" });
  await call("board-save", { id: "board_t", title: "Trashed", scene: SCENE });
  assert.equal((await call("board-list", {})).result.boards.length, 0);
  const trash = await call("boards-trash-list", {});
  assert.equal(trash.result.boards.length, 1);
  assert.equal((await call("board-restore", { id: "board_t" })).ok, true);
  assert.equal((await call("board-load", { id: "board_t" })).result.board.scene.elements.length, 1);
});

test("permanent delete is trash-first and final", async () => {
  await call("board-save", { id: "board_p", title: "Perm", scene: SCENE });
  assert.equal((await call("board-delete-permanent", { id: "board_p" })).ok, false);
  await call("board-delete", { id: "board_p" });
  assert.equal((await call("board-delete-permanent", { id: "board_p" })).result.permanent, true);
  assert.equal((await call("board-restore", { id: "board_p" })).ok, false);
});
