// tests/depth/paper-export-behavior.test.js — REAL behavioral test for paper.export_pdf
// (lens-audit: the paper "Export PDF" button hit no macro until this landed; it returns
// a downloadable text export — honest text/markdown, not a faked .pdf binary).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { lensRun } from "./_harness.js";

describe("paper.export_pdf", () => {
  it("formats a paper artifact into a downloadable text document", async () => {
    const r = await lensRun("paper", "export_pdf", {
      data: { title: "Deep Learning Survey", authors: ["A. Smith", "B. Lee"], year: 2025, abstract: "We survey methods.", doi: "10.1/x" },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.filename, "deep-learning-survey.txt");
    assert.equal(r.result.format, "text");
    assert.match(r.result.content, /Deep Learning Survey/);
    assert.match(r.result.content, /Authors: A\. Smith, B\. Lee/);
    assert.match(r.result.content, /Abstract/);
    assert.ok(r.result.byteLength > 0);
  });
});
