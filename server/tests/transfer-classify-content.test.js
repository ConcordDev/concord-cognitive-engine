// server/tests/transfer-classify-content.test.js
//
// FIX-transfer-009: the Transfer UI classifies free text — it posts
// { content } to /api/transfer/classify-domain — but the
// transfer.classify_domain macro only accepted a dtuId and answered
// "dtuId required" to every UI classification. The macro now
// classifies supplied content through the platform's pseudo-DTU shape
// while the dtuId path keeps its exact prior behavior, and the
// neither-input error names both options.
//
// Boots the real server (temp DATA_DIR, no egress) and drives the real
// macro through runMacro — the same dispatch the API route uses.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "concord-transfer-classify-"));
process.env.CONCORD_LOW_MEMORY_HOST = "1";

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { registerServerCleanExit } from "./lib/server-clean-exit.js";

const { __TEST__ } = await import("../server.js");
registerServerCleanExit(() => __TEST__);
const { runMacro, makeInternalCtx } = __TEST__;

const classify = (input) =>
  runMacro("transfer", "classify_domain", input, makeInternalCtx("transfer-classify-pin"));

describe("transfer classify_domain — content path (FIX-transfer-009)", () => {
  it("classifies free text sent as content (the UI's call)", async () => {
    const r = await classify({ content: "Our revenue strategy: grow the product market and keep every customer profitable for the company" });
    assert.equal(r?.ok, true, `content classification must succeed: ${JSON.stringify(r)}`);
    assert.equal(r.domain, "business");
    assert.equal(r.classifiedFrom, "content");
  });

  it("neither dtuId nor content names both options", async () => {
    const r = await classify({});
    assert.equal(r?.ok, false);
    assert.match(String(r.error), /dtuId or content required/);
  });

  it("the dtuId path is unchanged: an unknown id still answers DTU not found", async () => {
    const r = await classify({ dtuId: "dtu_that_does_not_exist" });
    assert.equal(r?.ok, false);
    assert.equal(r.error, "DTU not found");
  });
});
