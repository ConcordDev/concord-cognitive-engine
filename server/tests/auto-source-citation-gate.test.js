// Auto-source citation DTUs were all rejected live by the council gate
// (low_value, score 1): they are reference records like public feed items and
// need the same personal-save bar, but only inside the research auto-source
// ingest scope.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const src = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "server.js"), "utf8");

test("dtu.create gives auto-source citations the feed reference-record bar, scope-bound", () => {
  assert.ok(src.includes('const _autoSourceCitation = source === "auto-source" && dtu.visibility === "public" && currentFeedIngest()?.domain === "research" && currentFeedIngest()?.action === "auto-source";'));
  assert.equal(src.split("...(_autoSourceCitation ? { minScore: 1 } : {})").length - 1, 2, "dtu.create gate and pipelineCommitDTU");
});
