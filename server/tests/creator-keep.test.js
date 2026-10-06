// tests/creator-keep.test.js — REAL end-to-end proof for the Creator lens
// keep-and-draft workflow. Mirrors the established pattern:
// create a real content item via `content-add`, read it back via
// `content-list`, save it as a private DTU via `dtu.create`, read that
// DTU back via `dtu.get`, then draft it in Thread via
// `thread.thread-draft` citing that exact DTU id.
//
// Every lensRun call below names the macro literally. Nothing is published.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { lensRun, depthCtx } from "./depth/_harness.js";

describe("creator keep + thread draft", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("creator-keep-proof"); });

  it("creates a real content item, reads it back, saves a private DTU, reads it back, and drafts it in Thread", async () => {
    // 1. Create a real content item via the creator domain content-add macro.
    const contentR = await lensRun("creator", "content-add", {
      params: {
        title: "Proof Video",
        format: "video",
        stage: "idea",
        notes: "Proof pipeline item for keep-menu round-trip.",
      },
    }, ctx);
    assert.equal(contentR.ok, true, "content-add should succeed");
    const item = contentR.result.item;
    assert.ok(item.id, "content should have an id");
    assert.equal(item.title, "Proof Video");
    assert.equal(item.format, "video");
    assert.equal(item.stage, "idea");
    assert.equal(item.views, 0, "views start at 0 — never seeded");

    // 2. Read the real content back via content-list (the same macro the UI uses).
    const listR = await lensRun("creator", "content-list", {}, ctx);
    assert.equal(listR.ok, true, "content-list should succeed");
    const back = listR.result.items.find((c) => c.id === item.id);
    assert.ok(back, "content-list should include the created item");
    assert.equal(back.title, "Proof Video");
    assert.equal(back.format, "video");
    assert.equal(back.stage, "idea");

    // 3. Advance the content to "scripted" to exercise the state machine.
    const advR = await lensRun("creator", "content-advance", { params: { id: item.id } }, ctx);
    assert.equal(advR.ok, true, "content-advance should succeed");
    assert.equal(advR.result.stage, "scripted", "advance should move idea -> scripted");

    // 4. Save the content as a private DTU.
    const sentence = "Proof Video: video · scripted.";
    const dtuCreated = await lensRun("dtu", "create", {
      params: {
        title: sentence.slice(0, 80),
        tags: ["creator", "content", "pipeline"],
        source: "creator-lens:content-report",
        human: { summary: sentence },
        core: { definitions: [sentence], claims: [sentence.slice(0, 240)] },
        machine: {
          kind: "creator_content_report",
          contentId: item.id,
          title: item.title,
          format: item.format,
          stage: "scripted",
        },
        meta: { visibility: "private", consent: { allowCitations: false }, createdFrom: "creator" },
      },
    }, ctx);
    assert.equal(dtuCreated.ok, true, "dtu.create should succeed");
    const dtuId = dtuCreated.result.dtu.id;
    assert.ok(dtuId, "DTU should have an id");

    // 5. Read the DTU back and confirm the id matches.
    const dtuBack = await lensRun("dtu", "get", { params: { id: dtuId } }, ctx);
    assert.equal(dtuBack.ok, true, "dtu.get should succeed");
    assert.equal(dtuBack.result.dtu.id, dtuId, "read-back DTU id must match");

    // 6. Draft it in Thread, citing that exact DTU.
    const drafted = await lensRun("thread", "thread-draft", {
      params: {
        title: `Creator content — Proof Video`,
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

    // 7. Read the draft back and confirm it still cites the DTU.
    const draftBack = await lensRun("thread", "draft-detail", { params: { id: draft.id } }, ctx);
    assert.equal(draftBack.ok, true, "draft-detail should succeed");
    assert.equal(draftBack.result.draft.citedDtuId, dtuId, "draft-detail must cite the same DTU");
    assert.equal(draftBack.result.draft.status, "draft", "draft-detail must still be draft");
  });

  it("refuses to create content with no title", async () => {
    const r = await lensRun("creator", "content-add", { params: { title: "" } }, ctx);
    assert.equal(r.result.ok, false);
    assert.ok(/title/i.test(r.result.error), "should reject missing title");
  });
});