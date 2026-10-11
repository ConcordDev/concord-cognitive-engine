// Docs publish read-back: a page body minted through dtu.create comes back
// unchanged from dtu.get, and the DTU is private.
//
//   node --test --import=./tests/preload/no-egress.mjs --test-timeout=300000 tests/docs-publish-readback.test.js

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { lensRun, macroRuntime } from "./depth/_harness.js";

const BODY = "The river was high at dawn.";

describe("docs publish read-back", () => {
  let runMacro;
  let ctx;

  before(async () => {
    ({ runMacro, ctx } = await macroRuntime("docs-publish-reader"));
  });

  it("creates a private DTU whose content equals the page body", async () => {
    const createdPage = await lensRun("docs", "page-create", { params: { title: "Field notes" } }, ctx);
    assert.equal(createdPage.ok, true, JSON.stringify(createdPage));
    const pageId = createdPage.result.page.id;
    const added = await lensRun("docs", "block-add", {
      params: { pageId, type: "paragraph", text: BODY },
    }, ctx);
    assert.equal(added.ok, true, JSON.stringify(added));

    const detail = await lensRun("docs", "page-detail", { params: { id: pageId } }, ctx);
    assert.equal(detail.ok, true, JSON.stringify(detail));
    const page = detail.result.page;
    const content = page.blocks.map((b) => b.text).filter(Boolean).join("\n\n");
    assert.equal(content, BODY);

    const minted = await runMacro("dtu", "create", {
      title: page.title,
      content,
      source: "lens",
      domain: "docs",
      lens: "docs",
      visibility: "private",
      human: { summary: content.slice(0, 320) },
      tags: ["docs"],
      meta: { visibility: "private", lens: "docs", consent: { allowCitations: false } },
    }, ctx);
    assert.equal(minted.ok, true, `dtu.create failed: ${JSON.stringify(minted)}`);
    assert.equal(minted.dtu.visibility, "private");
    assert.ok(minted.dtu.id, "create returns an id");

    const read = await runMacro("dtu", "get", { id: minted.dtu.id }, ctx);
    assert.equal(read.ok, true, `dtu.get failed: ${JSON.stringify(read)}`);
    assert.equal(read.dtu.content, BODY);
    assert.equal(read.dtu.content, content);
    assert.equal(read.dtu.visibility, "private");
  });
});
