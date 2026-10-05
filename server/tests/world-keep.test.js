// tests/world-keep.test.js — REAL end-to-end proof for the World lens
// keep-and-draft workflow. Mirrors the established pattern:
// create a real share link via `share-link-create`, read it back via
// `share-links-list`, save it as a private DTU via `dtu.create`, read that
// DTU back via `dtu.get`, then draft it in Thread via `thread.thread-draft`
// citing that exact DTU id.
//
// Every lensRun call below names the macro literally. Nothing is published.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { lensRun, depthCtx } from "./depth/_harness.js";

describe("world share link keep + thread draft", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("world-keep-proof"); });

  it("creates a real share link, lists it, saves a private DTU, reads it back, and drafts it in Thread", async () => {
    // 1. Create a real share link via the world domain macro.
    const created = await lensRun("world", "share-link-create", {
      params: { worldId: "concordia-hub", x: 10, y: 20, z: 30, note: "Proof spot" },
    }, ctx);
    assert.equal(created.ok, true, "share-link-create should succeed");
    const link = created.result.link;
    assert.ok(link.id, "link should have an id");
    assert.equal(link.worldId, "concordia-hub");
    assert.ok(link.url, "link should have a url");

    // 2. Read the real share-links list (the same macro the UI uses).
    const list = await lensRun("world", "share-links-list", {}, ctx);
    assert.equal(list.ok, true, "share-links-list should succeed");
    const listRow = (list.result.links || []).find((l) => l.id === link.id);
    assert.ok(listRow, "share-links-list should contain the created link");

    // 3. Save the link as a private DTU.
    const sentence = `Concordia share link ${link.id} for ${link.worldId} @ (${link.x.toFixed(1)}, ${link.y.toFixed(1)}, ${link.z.toFixed(1)}).`;
    const dtuCreated = await lensRun("dtu", "create", {
      params: {
        title: sentence.slice(0, 80),
        tags: ["world", "concordia", "share-link"],
        source: "world-lens:share-link-report",
        human: { summary: sentence },
        core: { definitions: [sentence], claims: [sentence.slice(0, 240)] },
        machine: {
          kind: "world_lens_share_link_report",
          linkId: link.id,
          worldId: link.worldId,
          x: link.x,
          y: link.y,
          z: link.z,
          note: link.note,
          url: link.url,
          createdAt: link.createdAt,
        },
        meta: { visibility: "private", consent: { allowCitations: false }, createdFrom: "world" },
      },
    }, ctx);
    assert.equal(dtuCreated.ok, true, "dtu.create should succeed");
    const dtuId = dtuCreated.result.dtu.id;
    assert.ok(dtuId, "DTU should have an id");

    // 4. Read the DTU back and confirm the id matches.
    const dtuBack = await lensRun("dtu", "get", { params: { id: dtuId } }, ctx);
    assert.equal(dtuBack.ok, true, "dtu.get should succeed");
    assert.equal(dtuBack.result.dtu.id, dtuId, "read-back DTU id must match");

    // 5. Draft it in Thread, citing that exact DTU.
    const drafted = await lensRun("thread", "thread-draft", {
      params: {
        title: "Concordia share — concordia-hub",
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

    // 6. Read the draft back and confirm it still cites the DTU.
    const draftBack = await lensRun("thread", "draft-detail", { params: { id: draft.id } }, ctx);
    assert.equal(draftBack.ok, true, "draft-detail should succeed");
    assert.equal(draftBack.result.draft.citedDtuId, dtuId, "draft-detail must cite the same DTU");
    assert.equal(draftBack.result.draft.status, "draft", "draft-detail must still be draft");
  });

  it("refuses to create a share link with no worldId", async () => {
    const r = await lensRun("world", "share-link-create", { params: { x: 1, y: 2, z: 3 } }, ctx);
    assert.equal(r.result.ok, false);
    assert.ok(/worldId/.test(r.result.error), "should reject missing worldId");
  });
});