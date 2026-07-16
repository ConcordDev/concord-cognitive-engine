// tests/depth/fashion-moodboard-behavior.test.js — REAL behavioral tests for
// the fashion.moodboard-* macros (registerLensAction family, invoked via
// lensRun). Wave-4 gap-closure: docs/WAVE4_INVENTORY.md row 173 —
// "No moodboards (pin inspiration to a canvas)" (Whering/Stylebook parity,
// docs/lens-specs/fashion-capability-map.md). Distinct from the existing
// fashion.wishlist-* family and from SaveAsDtuButton's "save one item":
// a moodboard is a named board holding MANY pinned external image
// references, each with an optional note and a simple x/y position on a
// bounded virtual canvas — real per-user STATE persistence, no fabricated
// data, no client-only state.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { lensRun, depthCtx } from "./_harness.js";

describe("fashion.moodboard-create / moodboard-list", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("fashion-moodboard-create"); });

  it("creates a board and lists it back for the owner", async () => {
    const created = await lensRun("fashion", "moodboard-create", { params: { name: "Autumn capsule" } }, ctx);
    assert.equal(created.ok, true);
    assert.ok(created.result.moodboard.id);
    assert.equal(created.result.moodboard.name, "Autumn capsule");
    assert.equal(created.result.moodboard.itemCount, 0);
    assert.deepEqual(created.result.moodboard.items, []);

    const list = await lensRun("fashion", "moodboard-list", {}, ctx);
    assert.equal(list.ok, true);
    assert.equal(list.result.count, 1);
    assert.equal(list.result.moodboards[0].id, created.result.moodboard.id);
    assert.equal(list.result.moodboards[0].itemCount, 0);
  });

  it("rejects an empty or missing name and creates nothing", async () => {
    const beforeCount = (await lensRun("fashion", "moodboard-list", {}, ctx)).result.count;

    const missing = await lensRun("fashion", "moodboard-create", { params: {} }, ctx);
    assert.equal(missing.result.ok, false);
    assert.ok(String(missing.result.error).includes("name required"));

    const blank = await lensRun("fashion", "moodboard-create", { params: { name: "   " } }, ctx);
    assert.equal(blank.result.ok, false);

    const afterCount = (await lensRun("fashion", "moodboard-list", {}, ctx)).result.count;
    assert.equal(afterCount, beforeCount, "no board created on rejected input");
  });

  it("boards are isolated per user", async () => {
    const other = await depthCtx("fashion-moodboard-other-user");
    await lensRun("fashion", "moodboard-create", { params: { name: "Mine" } }, ctx);
    const otherList = await lensRun("fashion", "moodboard-list", {}, other);
    assert.ok(!otherList.result.moodboards.some((b) => b.name === "Mine"));
  });
});

describe("fashion.moodboard-add-item / moodboard-remove-item", () => {
  let ctx, boardId;
  before(async () => {
    ctx = await depthCtx("fashion-moodboard-items");
    const created = await lensRun("fashion", "moodboard-create", { params: { name: "Pin board" } }, ctx);
    boardId = created.result.moodboard.id;
  });

  it("pins a valid http(s) image with a note and an auto-cascaded position", async () => {
    const r = await lensRun("fashion", "moodboard-add-item", {
      params: { boardId, imageUrl: "https://example.com/inspo1.jpg", note: "Great texture" },
    }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.itemCount, 1);
    assert.ok(r.result.item.id);
    assert.equal(r.result.item.imageUrl, "https://example.com/inspo1.jpg");
    assert.equal(r.result.item.note, "Great texture");
    assert.equal(typeof r.result.item.x, "number");
    assert.equal(typeof r.result.item.y, "number");
    assert.ok(r.result.item.x >= 0 && r.result.item.x <= 1000);
    assert.ok(r.result.item.y >= 0 && r.result.item.y <= 1000);
  });

  it("accepts an explicit x/y position, clamped to the bounded canvas", async () => {
    const r = await lensRun("fashion", "moodboard-add-item", {
      params: { boardId, imageUrl: "https://example.com/inspo2.jpg", x: 5000, y: -50 },
    }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.item.x, 1000); // clamped to MOODBOARD_CANVAS_MAX
    assert.equal(r.result.item.y, 0); // clamped to 0
  });

  it("accepts a data:image URI as a valid image reference", async () => {
    const dataUri = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const r = await lensRun("fashion", "moodboard-add-item", { params: { boardId, imageUrl: dataUri } }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.item.imageUrl, dataUri);
  });

  it("rejects a missing imageUrl and does not create a pin", async () => {
    const before = (await lensRun("fashion", "moodboard-list", {}, ctx)).result.moodboards
      .find((b) => b.id === boardId).itemCount;
    const r = await lensRun("fashion", "moodboard-add-item", { params: { boardId, note: "no image" } }, ctx);
    assert.equal(r.result.ok, false);
    assert.ok(String(r.result.error).includes("imageUrl"));
    const after = (await lensRun("fashion", "moodboard-list", {}, ctx)).result.moodboards
      .find((b) => b.id === boardId).itemCount;
    assert.equal(after, before);
  });

  it("rejects an invalid (non-http, non-data-image) imageUrl", async () => {
    const r = await lensRun("fashion", "moodboard-add-item", {
      params: { boardId, imageUrl: "not-a-real-url" },
    }, ctx);
    assert.equal(r.result.ok, false);
    assert.ok(String(r.result.error).includes("imageUrl"));
  });

  it("rejects pinning to an unknown board", async () => {
    const r = await lensRun("fashion", "moodboard-add-item", {
      params: { boardId: "nope", imageUrl: "https://example.com/x.jpg" },
    }, ctx);
    assert.equal(r.result.ok, false);
    assert.ok(String(r.result.error).includes("moodboard not found"));
  });

  it("removes a pinned item and reflects the updated count", async () => {
    const added = await lensRun("fashion", "moodboard-add-item", {
      params: { boardId, imageUrl: "https://example.com/removable.jpg" },
    }, ctx);
    const countBefore = added.result.itemCount;
    const removed = await lensRun("fashion", "moodboard-remove-item", {
      params: { boardId, itemId: added.result.item.id },
    }, ctx);
    assert.equal(removed.ok, true);
    assert.equal(removed.result.itemCount, countBefore - 1);
    assert.equal(removed.result.deleted, added.result.item.id);
  });

  it("removing an item that doesn't exist on the board is an honest rejection, not a silent no-op", async () => {
    const before = (await lensRun("fashion", "moodboard-list", {}, ctx)).result.moodboards
      .find((b) => b.id === boardId).itemCount;
    const r = await lensRun("fashion", "moodboard-remove-item", {
      params: { boardId, itemId: "ghost_pin_id" },
    }, ctx);
    assert.equal(r.result.ok, false);
    assert.ok(String(r.result.error).includes("pinned item not found"));
    const after = (await lensRun("fashion", "moodboard-list", {}, ctx)).result.moodboards
      .find((b) => b.id === boardId).itemCount;
    assert.equal(after, before, "a failed remove must not mutate the board");
  });

  it("removing from an unknown board is rejected", async () => {
    const r = await lensRun("fashion", "moodboard-remove-item", {
      params: { boardId: "nope", itemId: "x" },
    }, ctx);
    assert.equal(r.result.ok, false);
    assert.ok(String(r.result.error).includes("moodboard not found"));
  });
});

describe("fashion.moodboard-update", () => {
  let ctx, boardId;
  before(async () => {
    ctx = await depthCtx("fashion-moodboard-update");
    const created = await lensRun("fashion", "moodboard-create", { params: { name: "Original name" } }, ctx);
    boardId = created.result.moodboard.id;
  });

  it("renames a board", async () => {
    const r = await lensRun("fashion", "moodboard-update", { params: { id: boardId, name: "Renamed board" } }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.moodboard.name, "Renamed board");
    const list = await lensRun("fashion", "moodboard-list", {}, ctx);
    assert.equal(list.result.moodboards.find((b) => b.id === boardId).name, "Renamed board");
  });

  it("rejects renaming to an empty name", async () => {
    const r = await lensRun("fashion", "moodboard-update", { params: { id: boardId, name: "   " } }, ctx);
    assert.equal(r.result.ok, false);
    assert.ok(String(r.result.error).includes("cannot be empty"));
  });

  it("rejects updating an unknown board", async () => {
    const r = await lensRun("fashion", "moodboard-update", { params: { id: "nope", name: "X" } }, ctx);
    assert.equal(r.result.ok, false);
    assert.ok(String(r.result.error).includes("moodboard not found"));
  });
});

describe("fashion.moodboard-delete", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("fashion-moodboard-delete"); });

  it("deletes a board, and its pinned items go with it (no dangling references)", async () => {
    const created = await lensRun("fashion", "moodboard-create", { params: { name: "To be deleted" } }, ctx);
    const boardId = created.result.moodboard.id;
    await lensRun("fashion", "moodboard-add-item", { params: { boardId, imageUrl: "https://example.com/a.jpg" } }, ctx);
    await lensRun("fashion", "moodboard-add-item", { params: { boardId, imageUrl: "https://example.com/b.jpg" } }, ctx);
    const withItems = await lensRun("fashion", "moodboard-list", {}, ctx);
    assert.equal(withItems.result.moodboards.find((b) => b.id === boardId).itemCount, 2);

    const del = await lensRun("fashion", "moodboard-delete", { params: { id: boardId } }, ctx);
    assert.equal(del.ok, true);
    assert.equal(del.result.deleted, boardId);

    const after = await lensRun("fashion", "moodboard-list", {}, ctx);
    assert.ok(!after.result.moodboards.some((b) => b.id === boardId), "deleted board is gone");

    // Its items can no longer be targeted through any board-scoped macro —
    // proving there's no orphaned/dangling item state left to act on.
    const addAfterDelete = await lensRun("fashion", "moodboard-add-item", {
      params: { boardId, imageUrl: "https://example.com/c.jpg" },
    }, ctx);
    assert.equal(addAfterDelete.result.ok, false);
  });

  it("rejects deleting an unknown board", async () => {
    const r = await lensRun("fashion", "moodboard-delete", { params: { id: "nope" } }, ctx);
    assert.equal(r.result.ok, false);
    assert.ok(String(r.result.error).includes("moodboard not found"));
  });
});

describe("fashion.moodboard round-trip (create -> add -> remove -> delete)", () => {
  it("full lifecycle stays consistent end to end", async () => {
    const ctx = await depthCtx("fashion-moodboard-lifecycle");
    const created = await lensRun("fashion", "moodboard-create", { params: { name: "Lifecycle board" } }, ctx);
    const boardId = created.result.moodboard.id;

    const pin1 = await lensRun("fashion", "moodboard-add-item", {
      params: { boardId, imageUrl: "https://example.com/1.jpg", note: "look 1" },
    }, ctx);
    const pin2 = await lensRun("fashion", "moodboard-add-item", {
      params: { boardId, imageUrl: "https://example.com/2.jpg", note: "look 2" },
    }, ctx);
    assert.equal(pin2.result.itemCount, 2);

    const removed = await lensRun("fashion", "moodboard-remove-item", {
      params: { boardId, itemId: pin1.result.item.id },
    }, ctx);
    assert.equal(removed.result.itemCount, 1);

    const list = await lensRun("fashion", "moodboard-list", {}, ctx);
    const board = list.result.moodboards.find((b) => b.id === boardId);
    assert.equal(board.itemCount, 1);
    assert.equal(board.items[0].id, pin2.result.item.id);

    const renamed = await lensRun("fashion", "moodboard-update", { params: { id: boardId, name: "Final name" } }, ctx);
    assert.equal(renamed.result.moodboard.name, "Final name");

    const del = await lensRun("fashion", "moodboard-delete", { params: { id: boardId } }, ctx);
    assert.equal(del.ok, true);
    const finalList = await lensRun("fashion", "moodboard-list", {}, ctx);
    assert.equal(finalList.result.count, 0);
  });
});
