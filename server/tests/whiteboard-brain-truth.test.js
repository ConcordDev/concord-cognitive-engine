/**
 * Whiteboard S7 — brain truth (PR #1714).
 *
 * Pins: ai-summarize-board / ai-cluster-stickies see sketch
 * notecards (type 'notecard'), not only Collab stickies
 * (kind 'sticky'); an empty transcript never reaches the brain.
 *
 * Run: node --test server/tests/whiteboard-brain-truth.test.js
 */
import { test } from "node:test";
import assert from "node:assert/strict";

globalThis._concordSTATE = {};
globalThis.STATE = globalThis._concordSTATE;

const { default: registerWhiteboardActions } = await import("../domains/whiteboard.js");
const actions = new Map();
registerWhiteboardActions((domain, name, fn) => actions.set(name, fn));
const CTX = { actor: { userId: "wb-s7-test" }, userId: "wb-s7-test" };
const call = (name, params = {}, ctx = CTX) => actions.get(name)(ctx, { data: params }, params);

test("summarize and cluster read sketch notecards", async () => {
  const saved = await call("board-save", {
    title: "sketch board",
    scene: { elements: [
      { id: "n1", type: "notecard", x: 0, y: 0, width: 180, height: 120, text: "ship the beta release" },
      { id: "n2", type: "notecard", x: 200, y: 0, width: 180, height: 120, text: "ship the beta docs" },
      { id: "n3", type: "notecard", x: 400, y: 0, width: 180, height: 120, text: "fix the login bug" },
      { id: "r1", type: "rectangle", x: 0, y: 200, width: 300, height: 200 },
    ], appState: {} },
  });
  const id = saved.result.board.id;
  const sum = await call("ai-summarize-board", { boardId: id });
  assert.equal(sum.result.source, "deterministic");
  assert.match(sum.result.summary, /3 sticky notes/);
  assert.match(sum.result.summary, /1 frame/);
  const cl = await call("ai-cluster-stickies", { boardId: id });
  assert.ok(cl.result.clusters.length >= 1);
});

test("an empty transcript never reaches the brain", async () => {
  const saved = await call("board-save", {
    title: "shapes only",
    scene: { elements: [
      { id: "r1", type: "rectangle", x: 0, y: 0, width: 100, height: 80 },
      { id: "e1", type: "ellipse", x: 50, y: 50, width: 60, height: 60 },
    ], appState: {} },
  });
  let brainCalls = 0;
  const brainCtx = { ...CTX, llm: { chat: async () => { brainCalls += 1; return { content: '{"summary":"fragment","actionItems":[]}' }; } } };
  const sum = await call("ai-summarize-board", { boardId: saved.result.board.id }, brainCtx);
  assert.equal(brainCalls, 0);
  assert.equal(sum.result.source, "deterministic");
});
