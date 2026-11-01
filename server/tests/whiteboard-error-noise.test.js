/**
 * Whiteboard S10 — error noise (PR #1714).
 *
 * Pins: join/leave/broadcast-scene/broadcast-cursor return a quiet
 * {shared:false} no-op for the caller's own unshared board (the
 * collab hook fires them automatically); unknown ids still error;
 * deliberate shared actions (shared-vote-cast) keep their errors.
 *
 * Run: node --test server/tests/whiteboard-error-noise.test.js
 */
import { test } from "node:test";
import assert from "node:assert/strict";

globalThis._concordSTATE = {};
globalThis.STATE = globalThis._concordSTATE;

const { default: registerWhiteboardActions } = await import("../domains/whiteboard.js");
const actions = new Map();
registerWhiteboardActions((domain, name, fn) => actions.set(name, fn));
const CTX = { actor: { userId: "wb-s10-test" }, userId: "wb-s10-test" };
const call = (name, params = {}) => actions.get(name)(CTX, { data: params }, params);

test("own unshared board: quiet no-ops; unknown id: hard error", async () => {
  const saved = await call("board-save", { title: "private", scene: { elements: [], appState: {} } });
  const id = saved.result.board.id;
  for (const [name, params] of [
    ["join-shared", { id }],
    ["broadcast-cursor", { id, x: 1, y: 2 }],
    ["broadcast-scene", { id, scene: { elements: [], appState: {} } }],
    ["leave-shared", { id }],
  ]) {
    const r = await call(name, params);
    assert.equal(r.ok, true, `${name}: ${JSON.stringify(r)}`);
    assert.equal(r.result.shared, false, name);
  }
  const ghost = await call("join-shared", { id: "board_that_exists_nowhere" });
  assert.equal(ghost.ok, false);
  assert.equal(ghost.error, "shared board not found");
  const vote = await call("shared-vote-cast", { id, elementId: "e1" });
  assert.equal(vote.ok, false);
});
