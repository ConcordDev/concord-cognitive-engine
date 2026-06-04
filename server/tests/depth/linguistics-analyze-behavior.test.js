// tests/depth/linguistics-analyze-behavior.test.js — REAL behavioral tests for the
// linguistics.analyze lens-action (added in the lens-audit broken-wire batch: the
// "Analyze" button POSTed linguistics.analyze but no macro was registered, so it fell
// through to the utility-brain catch-all instead of a real morphosyntactic analysis).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { lensRun } from "./_harness.js";

describe("linguistics.analyze — morphosyntactic analysis", () => {
  it("computes token/sentence/readability stats and a content string", async () => {
    const text = "The quick brown fox jumps over the lazy dog. It runs quickly and happily.";
    const r = await lensRun("linguistics", "analyze", { params: { text, type: "morphosyntactic" } });
    assert.equal(r.ok, true);
    assert.equal(typeof r.result.content, "string");
    assert.match(r.result.content, /Morphosyntactic analysis/);
    assert.equal(r.result.sentenceCount, 2);
    assert.ok(r.result.wordCount >= 13, "counts the words");
    assert.ok(r.result.lexicalDiversity > 0 && r.result.lexicalDiversity <= 100);
    assert.ok(["elementary", "middle-school", "high-school", "college"].includes(r.result.readingLevel));
  });

  it("infers word classes from affixes (quickly/happily → adverb)", async () => {
    const r = await lensRun("linguistics", "analyze", { params: { text: "She sang quickly and happily." } });
    assert.equal(r.ok, true);
    assert.ok((r.result.wordClasses.adverb || 0) >= 2, "quickly + happily counted as adverbs");
  });

  it("reads text from artifact.data as well as params (both bridge paths)", async () => {
    const r = await lensRun("linguistics", "analyze", { data: { text: "A short sentence here." } });
    assert.equal(r.ok, true);
    assert.ok(r.result.wordCount >= 4);
  });

  it("rejects empty input instead of fabricating an analysis", async () => {
    const r = await lensRun("linguistics", "analyze", { params: { text: "   " } });
    assert.equal(r.result.ok, false);
    assert.match(String(r.result.error), /text required/);
  });
});
