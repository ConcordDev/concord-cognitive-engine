// Whiteboards are owner-scoped: a board is listed, opened and updated only by
// the user who created it. Boards stored before ownerId was recorded (no
// owner) stay reachable so existing users don't lose them.

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { macroRuntime } from "./_harness.js";

describe("whiteboard ownership", () => {
  let runMacro, STATE, alice, bob;
  before(async () => {
    ({ runMacro, STATE, ctx: alice } = await macroRuntime("wb-alice"));
    ({ ctx: bob } = await macroRuntime("wb-bob"));
  });

  it("the creator lists, opens and updates their board", async () => {
    const c = await runMacro("whiteboard", "create", { title: "Plan" }, alice);
    assert.equal(c.ok, true);
    const list = await runMacro("whiteboard", "list", {}, alice);
    assert.ok(list.whiteboards.some((w) => w.id === c.dtuId));
    const u = await runMacro("whiteboard", "update", { whiteboardId: c.dtuId, elements: [{ id: "e1", type: "rectangle" }] }, alice);
    assert.equal(u.ok, true);
    const g = await runMacro("whiteboard", "get", { whiteboardId: c.dtuId }, alice);
    assert.equal(g.whiteboard.elements.length, 1);
  });

  it("another user can't see, open or overwrite it", async () => {
    const c = await runMacro("whiteboard", "create", { title: "Private" }, alice);
    const list = await runMacro("whiteboard", "list", {}, bob);
    assert.equal(list.whiteboards.some((w) => w.id === c.dtuId), false);
    assert.equal((await runMacro("whiteboard", "get", { whiteboardId: c.dtuId }, bob)).ok, false);
    const u = await runMacro("whiteboard", "update", { whiteboardId: c.dtuId, elements: [] }, bob);
    assert.equal(u.ok, false);
    const g = await runMacro("whiteboard", "get", { whiteboardId: c.dtuId }, alice);
    assert.equal(g.ok, true);
  });

  it("boards without a recorded owner stay reachable", async () => {
    const id = "wb_legacy_test";
    STATE.dtus.set(id, { id, title: "Whiteboard: Old", machine: { kind: "whiteboard", data: { id, title: "Old", elements: [] } }, lineage: { parents: [] }, createdAt: new Date().toISOString() });
    const r = await runMacro("whiteboard", "get", { whiteboardId: id }, bob);
    assert.equal(r.ok, true);
    assert.equal(r.whiteboard.id, id);
    assert.equal(r.whiteboard.title, "Old");
    STATE.dtus.delete(id);
  });

  it("lists most recently updated first", async () => {
    const a = await runMacro("whiteboard", "create", { title: "Older" }, alice);
    await new Promise((r) => setTimeout(r, 5));
    const b = await runMacro("whiteboard", "create", { title: "Newer" }, alice);
    await new Promise((r) => setTimeout(r, 5));
    await runMacro("whiteboard", "update", { whiteboardId: a.dtuId, elements: [{ id: "x", type: "line" }] }, alice);
    const ids = (await runMacro("whiteboard", "list", {}, alice)).whiteboards.map((w) => w.id);
    assert.ok(ids.indexOf(a.dtuId) < ids.indexOf(b.dtuId));
  });
});
