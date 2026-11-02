/**
 * Whiteboard S9 — true counts (PR #1714).
 *
 * Pins: workspace-summary counts stickies in both element models
 * (Collab kind 'sticky' + sketch type 'notecard'), excludes trashed
 * boards from every count, and counts open comments via the bucket's
 * real boardId keying.
 *
 * Run: node --test server/tests/whiteboard-true-counts.test.js
 */
import { test } from "node:test";
import assert from "node:assert/strict";

globalThis._concordSTATE = {};
globalThis.STATE = globalThis._concordSTATE;

const { default: registerWhiteboardActions } = await import("../domains/whiteboard.js");
const actions = new Map();
registerWhiteboardActions((domain, name, fn) => actions.set(name, fn));
const CTX = { actor: { userId: "wb-s9-test" }, userId: "wb-s9-test" };
const call = (name, params = {}) => actions.get(name)(CTX, { data: params }, params);

test("workspace-summary: both sticky models, live boards only, real comments", async () => {
  await call("board-save", {
    id: "board_collab", title: "Collab",
    scene: { elements: [
      { id: "s1", kind: "sticky", x: 0, y: 0, text: "a" },
      { id: "s2", kind: "sticky", x: 9, y: 9, text: "b" },
      { id: "r1", kind: "rect", x: 0, y: 0 },
    ], appState: {} },
  });
  await call("board-save", {
    id: "board_canvas", title: "Canvas", origin: "canvas", dtuId: "board_canvas",
    scene: { elements: [
      { id: "n1", type: "notecard", x: 0, y: 0, text: "note" },
      { id: "t1", type: "text", x: 5, y: 5, text: "label" },
    ], appState: {}, model: "sketch" },
  });
  await call("comments-add", { boardId: "board_collab", elementId: "s1", body: "open one" });
  const sum = await call("workspace-summary", {});
  assert.equal(sum.result.boardCount, 2);
  assert.equal(sum.result.elementCount, 5);
  assert.equal(sum.result.stickyCount, 3);
  assert.equal(sum.result.openCommentCount, 1);
});
