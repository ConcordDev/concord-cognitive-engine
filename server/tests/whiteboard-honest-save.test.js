/**
 * Whiteboard S3 — honest save model (PR #1714).
 *
 * Pins: the kept report-DTU linkage (keptDtuId/keptVersion/keptAt/
 * keptSceneHash) persists on the board record so keep gates survive
 * reloads; a metadata-only board-save preserves the stored scene and
 * title instead of erasing the canvas or renaming it to the default.
 *
 * Run: node --test server/tests/whiteboard-honest-save.test.js
 */
import { test } from "node:test";
import assert from "node:assert/strict";

globalThis._concordSTATE = {};
globalThis.STATE = globalThis._concordSTATE;

const { default: registerWhiteboardActions } = await import("../domains/whiteboard.js");
const actions = new Map();
registerWhiteboardActions((domain, name, fn) => actions.set(name, fn));
const CTX = { actor: { userId: "wb-s3-test" }, userId: "wb-s3-test" };
const call = (name, params = {}) => actions.get(name)(CTX, { data: params }, params);

const SCENE = { elements: [{ id: "a", kind: "sticky", x: 1, y: 2, text: "keep me" }], appState: {} };

test("kept linkage persists across saves and versions forward explicitly", async () => {
  await call("board-save", { id: "board_k", title: "Kept board", scene: SCENE });
  await call("board-save", { id: "board_k", keptDtuId: "dtu_report_1", keptVersion: 1, keptAt: "2026-10-28T20:00:00.000Z", keptSceneHash: "abc123" });
  let loaded = (await call("board-load", { id: "board_k" })).result.board;
  assert.equal(loaded.keptDtuId, "dtu_report_1");
  assert.equal(loaded.keptVersion, 1);
  await call("board-save", { id: "board_k", keptDtuId: "dtu_report_2", keptVersion: 2, keptSceneHash: "def456" });
  loaded = (await call("board-load", { id: "board_k" })).result.board;
  assert.equal(loaded.keptDtuId, "dtu_report_2");
  assert.equal(loaded.keptVersion, 2);
});

test("a metadata-only save preserves the scene and title", async () => {
  await call("board-save", { id: "board_m", title: "Real title", scene: SCENE });
  await call("board-save", { id: "board_m", keptDtuId: "dtu_x" });
  const loaded = (await call("board-load", { id: "board_m" })).result.board;
  assert.equal(loaded.title, "Real title");
  assert.equal(loaded.scene.elements.length, 1);
});
