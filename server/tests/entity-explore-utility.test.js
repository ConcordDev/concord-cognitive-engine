// Entity explore on the utility slot: focused prompt, thinking off, no tool
// catalog, and an output check before anything is saved as a DTU.
// Fixtures are real outputs from concord-core-v6 on the A40 pod (2026-10-17).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildEntityExplorePrompt, exploreCallOptions, assessExploreOutput, exploreBrainName, contextText,
} from "../lib/brain/entity-explore.js";

const SERVER = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "../server.js"), "utf8");

describe("explore prompt and call options", () => {
  it("asks for one insight from the notes, no tools, no system talk", () => {
    const p = buildEntityExplorePrompt({ lens: "physics", context: "[DTU 1] Bernoulli...", entity: { id: "e1", species: "explorer" } });
    assert.match(p.system, /ONE specific insight/);
    assert.match(p.system, /NOTES:\n\[DTU 1\] Bernoulli/);
    assert.match(p.system, /no tool calls/);
    assert.doesNotMatch(p.system, /TOOL_CALL|You execute|utility brain/);
    assert.equal(p.user, "Write the insight.");
  });
  it("has a no-notes variant and caps long notes", () => {
    assert.match(buildEntityExplorePrompt({ lens: "music_theory" }).system, /about music theory/);
    const long = buildEntityExplorePrompt({ lens: "x", context: "a".repeat(20000) }).system;
    assert.ok(long.length < 4500);
  });
  it("reads a sovereign context object", () => {
    assert.equal(contextText({ context: "notes" }), "notes");
    assert.equal(contextText({ globalAssistType: "needs_consent" }), "");
  });
  it("turns thinking off, keeps temperature low, sends no tool catalog", () => {
    const o = exploreCallOptions("sys");
    assert.equal(o.think, false);
    assert.equal(o.enableTools, false);
    assert.equal(o.presencePenalty, 0);
    assert.ok(o.temperature <= 0.3);
  });
  it("brain slot defaults to utility and accepts conscious", () => {
    assert.equal(exploreBrainName({}), "utility");
    assert.equal(exploreBrainName({ CONCORD_ENTITY_EXPLORE_BRAIN: "conscious" }), "conscious");
    assert.equal(exploreBrainName({ CONCORD_ENTITY_EXPLORE_BRAIN: "gpt" }), "utility");
  });
});

describe("assessExploreOutput (real core-v6 outputs)", () => {
  const bad = [
    ["", "empty"],
    ['[TOOL_CALL: {"tool": "search_dtus", "params": {"query": "physics", "domain": "science", "limit": 15}}]', "tool_call_marker"],
    ["DHTP made this a DHTP word — I won't keep saying it in passing.", "garbled"],
    ["Momentum is conserved.", "too_short"],
    ["<think>\n\n</think>\n\n4", "thinking_leak"],
    ["Speaking for myself — not the company — I think the real story in finance is that people who can explain a pattern as a rule get power.", "persona_leak"],
    ["the the the the the the the the the the the the the the the the.", "repetitive"],
    ["Momentum and energy are conserved in collisions, and Bernoulli links pressure and speed along a streamline, so a", "unfinished"],
  ];
  for (const [t, reason] of bad) it(`rejects ${reason}`, () => assert.deepEqual(assessExploreOutput(t), { ok: false, reason }));
  it("accepts a coherent insight", () => {
    const t = "When a fluid flows through a narrowing pipe, its speed increases and pressure drops, as Bernoulli's principle says. Copper's conductivity, about eight times steel's, is why heat exchangers use it.";
    assert.deepEqual(assessExploreOutput(t), { ok: true, reason: null });
  });
});

describe("server wiring", () => {
  it("callBrain forwards think and presence_penalty to Ollama", () => {
    assert.match(SERVER, /typeof options\.think === "boolean" \? \{ think: options\.think \}/);
    assert.match(SERVER, /presence_penalty: options\.presencePenalty/);
  });
  it("entityExploreLens uses the module and rejects before the DTU save", () => {
    const start = SERVER.indexOf("async function entityExploreLens(");
    const body = SERVER.slice(start, SERVER.indexOf("\n}\n", start));
    assert.match(body, /lib\/brain\/entity-explore\.js/);
    assert.doesNotMatch(body, /enableTools: true/);
    assert.doesNotMatch(body, /temperature: 0\.8/);
    const reject = body.indexOf("assessExploreOutput");
    const save = body.indexOf('runMacro("dtu", "create"');
    assert.ok(reject > 0 && save > reject, "output is checked before the DTU is created");
  });
});
