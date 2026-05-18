// server/tests/whiteboard-ai.test.js
//
// Tier-2 contract tests for Whiteboard Sprint A items #2 + #4.
// We test the parsing + fallback logic with a stubbed ctx.llm so the
// suite doesn't require a running Ollama. The brain-router path is
// already tested in the brain-routing tests.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import registerWhiteboardAiMacros from "../domains/whiteboard-ai.js";

const macros = new Map();
registerWhiteboardAiMacros((_d, n, h) => macros.set(n, h));

describe("whiteboard-ai: brainstorm", () => {
  it("rejects missing prompt", async () => {
    const r = await macros.get("brainstorm")({}, {});
    assert.equal(r.ok, false);
    assert.equal(r.reason, "prompt_required");
  });

  it("LLM path returns parsed ideas", async () => {
    const ctx = { llm: { chat: async () => ({ text: JSON.stringify(["idea A", "idea B", "idea C"]) }) } };
    const r = await macros.get("brainstorm")(ctx, { prompt: "coffee shop", count: 3 });
    assert.equal(r.ok, true);
    assert.deepEqual(r.ideas, ["idea A", "idea B", "idea C"]);
    assert.equal(r.source, "llm");
  });

  it("LLM path parses fenced JSON blocks too", async () => {
    const ctx = { llm: { chat: async () => ({ text: '```json\n["x", "y", "z"]\n```' }) } };
    const r = await macros.get("brainstorm")(ctx, { prompt: "x", count: 3 });
    assert.equal(r.ok, true);
    assert.equal(r.ideas.length, 3);
  });

  it("no-LLM falls back to deterministic angles (still ok:true)", async () => {
    const r = await macros.get("brainstorm")({}, { prompt: "coffee shop", count: 4 });
    assert.equal(r.ok, true);
    assert.equal(r.source, "deterministic_fallback");
    assert.equal(r.ideas.length, 4);
  });

  it("LLM error falls back deterministically (still ok:true)", async () => {
    const ctx = { llm: { chat: async () => { throw new Error("boom"); } } };
    const r = await macros.get("brainstorm")(ctx, { prompt: "x", count: 3 });
    assert.equal(r.ok, true);
    assert.equal(r.source, "deterministic_fallback_error");
  });

  it("clamps count between 1 and 50", async () => {
    const r = await macros.get("brainstorm")({}, { prompt: "x", count: 1000 });
    assert.ok(r.ideas.length <= 50);
  });

  it("LLM garbage falls back with parse_failed marker", async () => {
    const ctx = { llm: { chat: async () => ({ text: "no json anywhere" }) } };
    const r = await macros.get("brainstorm")(ctx, { prompt: "x", count: 3 });
    assert.equal(r.source, "deterministic_fallback_parse_failed");
    assert.equal(r.ideas.length, 3);
  });
});

describe("whiteboard-ai: summarize", () => {
  it("rejects when no elements", async () => {
    const r = await macros.get("summarize")({}, {});
    assert.equal(r.ok, false);
    assert.equal(r.reason, "no_elements");
  });

  it("rejects when no text on any element", async () => {
    const r = await macros.get("summarize")({}, { elements: [{ id: "x" }, { id: "y" }] });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "no_text_content");
  });

  it("LLM path returns structured summary + action items + decisions + themes", async () => {
    const ctx = { llm: { chat: async () => ({ text: JSON.stringify({
      summary: "Team explored coffee shop concepts.",
      action_items: ["Visit 3 local cafes", "Define brand"],
      decisions: ["Niche on pour-over"],
      themes: ["quality", "atmosphere"],
    }) }) } };
    const r = await macros.get("summarize")(ctx, {
      elements: [{ id: "1", text: "single-origin only" }, { id: "2", text: "no wifi" }],
    });
    assert.equal(r.ok, true);
    assert.equal(r.summary, "Team explored coffee shop concepts.");
    assert.equal(r.action_items.length, 2);
    assert.equal(r.decisions[0], "Niche on pour-over");
    assert.equal(r.themes.length, 2);
    assert.equal(r.source, "llm");
  });

  it("no-LLM fallback returns honest deterministic summary", async () => {
    const r = await macros.get("summarize")({}, {
      elements: Array.from({ length: 3 }, (_, i) => ({ id: `e${i}`, text: `idea ${i}` })),
    });
    assert.equal(r.ok, true);
    assert.equal(r.source, "deterministic_fallback");
    assert.ok(r.summary.includes("LLM offline"));
  });

  it("LLM garbage returns parse_failed without crashing", async () => {
    const ctx = { llm: { chat: async () => ({ text: "garbage" }) } };
    const r = await macros.get("summarize")(ctx, { elements: [{ text: "a" }] });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "parse_failed");
  });
});
