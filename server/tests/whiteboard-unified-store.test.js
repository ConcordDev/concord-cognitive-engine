/**
 * Whiteboard S1 — one board store (PR #1714).
 *
 * Pins: board-save persists origin/dtuId (the canvas mirror tag);
 * board-list counts a mirrored canvas board's sketch elements; the
 * Analyze macros resolve elements board-first (artifact whiteboardId
 * link / params.boardId / artifact id) so a board whose canvas lives in
 * the store no longer analyzes as zeros, with the artifact payload kept
 * as the fallback for boardless calls.
 *
 * Run: node --test server/tests/whiteboard-unified-store.test.js
 */
import { test } from "node:test";
import assert from "node:assert/strict";

globalThis._concordSTATE = {};
globalThis.STATE = globalThis._concordSTATE;

const { default: registerWhiteboardActions } = await import("../domains/whiteboard.js");
const actions = new Map();
registerWhiteboardActions((domain, name, fn) => actions.set(name, fn));
const CTX = { actor: { userId: "wb-s1-test" }, userId: "wb-s1-test" };
const call = (name, params = {}) => actions.get(name)(CTX, { data: params }, params);

const SKETCH = [
  { id: "e1", type: "rectangle", x: 0, y: 0, width: 100, height: 60 },
  { id: "e2", type: "ellipse", x: 200, y: 0, width: 80, height: 80 },
  { id: "e3", type: "notecard", x: 0, y: 200, width: 180, height: 90, text: "alpha plan" },
  { id: "e4", type: "notecard", x: 220, y: 200, width: 180, height: 90, text: "alpha budget" },
  { id: "e5", type: "text", x: 40, y: 40, width: 120, height: 24, text: "Title" },
];

test("board-save persists the canvas origin tag and board-list counts sketch elements", async () => {
  const saved = await call("board-save", {
    id: "dtu_board_1", title: "Canvas board", origin: "canvas", dtuId: "dtu_board_1",
    scene: { elements: SKETCH, appState: {}, model: "sketch" },
  });
  assert.equal(saved.result.board.origin, "canvas");
  const meta = (await call("board-list", {})).result.boards.find((b) => b.id === "dtu_board_1");
  assert.equal(meta.elementCount, 5);
  assert.equal(meta.origin, "canvas");
});

test("shapeDetect reads the stored board through the artifact's whiteboardId link", async () => {
  const artifact = { id: "artifact_shadow_9", data: { whiteboardId: "dtu_board_1", elements: [] } };
  const det = await actions.get("shapeDetect")(CTX, artifact, {});
  assert.equal(det.result.totalElements, 5);
});

test("shapeDetect honours params.boardId and falls back to the payload for unknown ids", async () => {
  const viaParams = await actions.get("shapeDetect")(CTX, { data: { elements: [] } }, { boardId: "dtu_board_1" });
  assert.equal(viaParams.result.totalElements, 5);
  const fallback = await actions.get("shapeDetect")(CTX, { data: { elements: SKETCH.slice(0, 2) } }, { boardId: "board_missing" });
  assert.equal(fallback.result.totalElements, 2);
});
