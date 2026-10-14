// INC-SWEEP research F2 — Save-as-DTU / dtu.create must store the tags the
// caller sent. Auto-classify must not silently append unrelated domains
// unless the caller opts in with autoTag:true.

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { macroRuntime } from "./depth/_harness.js";

describe("dtu.create honors caller tags (research F2)", () => {
  let runMacro, ctx;

  before(async () => {
    ({ runMacro, ctx } = await macroRuntime("rsch-f2-tags"));
  });

  it("stores exactly the sent tags when the caller names tags (no photography/welding)", async () => {
    const sent = ["real-data", "research-lens", "rschmv8d163a"];
    const created = await runMacro("dtu", "create", {
      title: "Research note rschmv8d163a",
      content: "Body with lens aperture shutter and mig tig weld fabrication marker.",
      tags: sent,
      source: "research-lens",
      contentClass: "knowledge",
      visibility: "private",
      isGlobal: false,
    }, ctx);
    assert.equal(created.ok, true, JSON.stringify(created));
    const dtu = created.dtu;
    assert.ok(dtu?.id, "dtu id missing");
    const tags = dtu.tags || [];
    assert.deepEqual(tags.slice().sort(), sent.slice().sort());
    assert.equal(tags.includes("photography"), false);
    assert.equal(tags.includes("welding"), false);

    const back = await runMacro("dtu", "get", { id: dtu.id }, ctx);
    assert.equal(back.ok, true);
    const backTags = back.dtu.tags || [];
    assert.deepEqual(backTags.slice().sort(), sent.slice().sort());
  });

  it("autoTag:true opts back into enrichment", async () => {
    const created = await runMacro("dtu", "create", {
      title: "Weld bead under camera aperture",
      content: "photography camera exposure aperture shutter lens; welding weld mig tig arc fabrication bead",
      tags: ["keep-me"],
      autoTag: true,
      source: "research-lens",
      visibility: "private",
    }, ctx);
    assert.equal(created.ok, true, JSON.stringify(created));
    const tags = created.dtu.tags || [];
    assert.ok(tags.includes("keep-me"));
    assert.ok(
      tags.includes("photography") || tags.includes("welding") || tags.length > 1,
      `expected enrichment when autoTag:true, got ${JSON.stringify(tags)}`,
    );
  });
});
