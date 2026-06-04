// tests/depth/ingest-batch-behavior.test.js
//
// Behavioral coverage for ingest.batch-ingest (lens-audit broken-wire closure):
// text files are genuinely ingested as DTUs; binaries are honestly skipped (not
// faked as ingested); a filenames-only legacy payload errors honestly.

import { test } from "node:test";
import assert from "node:assert/strict";
import { lensRun } from "./_harness.js";

test("ingest.batch-ingest ingests text files and skips binaries honestly", async () => {
  const r = await lensRun("ingest", "batch-ingest", {
    params: {
      files: [
        { name: "notes.md", mime: "text/markdown", content: "# Heading\nSome real notes." },
        { name: "data.json", mime: "application/json", content: '{"a":1}' },
        { name: "photo.png", mime: "image/png", content: "" },
        { name: "empty.txt", mime: "text/plain", content: "   " },
      ],
    },
  });
  const res = r.result ?? r;
  assert.equal(res.requested, 4);
  assert.equal(res.ingested, 2, "two real text files ingested");
  assert.equal(res.skipped, 2, "image + empty file skipped");
  const reasons = res.skippedFiles.map((s) => s.reason).join("|");
  assert.match(reasons, /unsupported_type|no_text_content/);
  // ingested files carry a real DTU id (not fabricated)
  assert.ok(res.ingestedFiles.every((f) => "dtuId" in f));
});

test("ingest.batch-ingest errors honestly on a filenames-only legacy payload", async () => {
  const r = await lensRun("ingest", "batch-ingest", {
    params: { fileCount: 3, filenames: ["a.txt", "b.txt", "c.txt"] },
  });
  const res = r.result ?? r;
  const err = r.ok === false ? r.error : res?.error;
  assert.deepStrictEqual(err, "no_file_content", "does not pretend to ingest content it never received");
});
