// tests/depth/research-generate-behavior.test.js — REAL behavioral tests for the
// research.generate lens-action (added in the lens-audit batch: the Analyze button
// POSTed research.generate but no macro was registered, so it 404'd).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { lensRun } from "./_harness.js";

describe("research.generate — hypothesis analysis", () => {
  it("returns a titled, substantive analysis for a hypothesis", async () => {
    const r = await lensRun("research", "generate", {
      params: { hypothesis: "Sleep deprivation reduces working memory capacity in adults", type: "analysis" },
    });
    assert.equal(r.ok, true);
    assert.equal(typeof r.result.title, "string");
    assert.ok(r.result.title.length > 0, "has a title");
    assert.equal(typeof r.result.content, "string");
    // The deterministic scaffold echoes the hypothesis and names real sections.
    assert.match(r.result.content, /Hypothesis/);
    assert.match(r.result.content, /Threats to validity/);
    assert.ok(r.result.content.length > 200, "content is substantive, not a stub");
  });

  it("extracts constructs from the hypothesis into the analysis", async () => {
    const r = await lensRun("research", "generate", {
      params: { hypothesis: "Caffeine improves marathon endurance performance" },
    });
    assert.equal(r.ok, true);
    // A salient construct from the input should surface in the constructs line.
    assert.match(r.result.content.toLowerCase(), /caffeine|marathon|endurance|performance/);
  });

  it("rejects an empty hypothesis instead of inventing one", async () => {
    const r = await lensRun("research", "generate", { params: { hypothesis: "   " } });
    assert.equal(r.result.ok, false);
    assert.match(String(r.result.error), /hypothesis required/);
  });

  it("is deterministic for the same input (heuristic mode, no LLM)", async () => {
    const input = { params: { hypothesis: "Remote work increases individual productivity" } };
    const a = await lensRun("research", "generate", input);
    const b = await lensRun("research", "generate", input);
    assert.equal(a.result.content, b.result.content);
  });
});
