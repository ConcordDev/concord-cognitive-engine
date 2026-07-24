// Grounding-audit gap fix (2026-07-24) — tool-preference signal in style
// learning.
//
// The V1.2 roadmap names "personal operating-style learning... adapt
// tone/approach/tool-preference" as a shipped signal. Before this file,
// initiative-engine.js#learnStyle genuinely adapted tone/length/formality/
// emoji-rate from real chat messages (pinned by
// tests/prompt-registry-style-injection.test.js and
// tests/initiative-engine.test.js) — but a direct grep across the whole
// codebase for "tool preference" / "preferred_tool" / "tool_usage_pattern"
// returned ZERO hits. Nothing computed a tool-preference signal at all.
//
// This pins the fix end-to-end:
//   (a) initiative-engine.js#recordToolUsage tallies real tool-call
//       dispatches per (user, toolName), correctly, across several calls
//   (b) chat-agent.js#runAgentLoop's real dispatch site increments the
//       SAME tally (this is the actual production wire — not just the
//       engine in isolation) and composeSystemPrompt surfaces a
//       "tends to reach for X" line once one tool clearly dominates a
//       real sample
//   (c) NO preference line is injected when calls are evenly spread across
//       tools, OR the total sample is below the floor (honest-absence —
//       never a fabricated/guessed preference from too little data)
//   (d) the tool-preference line composes cleanly alongside the existing
//       formality/emoji lines — adding this signal doesn't disturb the
//       pre-existing style-injection wiring for the same user
//
// Existing formality/emoji regression coverage stays in
// tests/prompt-registry-style-injection.test.js and
// tests/initiative-engine.test.js — this file doesn't duplicate those, it
// only adds one direct check (d) that both signals coexist correctly on
// the same composed prompt.

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { up as upInitiative } from "../migrations/029_initiative.js";
import { up as upToolUsage } from "../migrations/388_user_style_tool_usage.js";
import { createInitiativeEngine } from "../lib/initiative-engine.js";
import { composeSystemPrompt } from "../lib/prompt-registry.js";
import { runAgentLoop } from "../lib/chat-agent.js";

function makeDb() {
  const db = new Database(":memory:");
  upInitiative(db);
  upToolUsage(db);
  return db;
}

// A fake runMacro that handles exactly the domain/action pairs
// executeToolCall's web_search / generate_image / expert_mode cases hit —
// enough surface for a real end-to-end dispatch through chat-agent.js
// without needing the full server.js MACROS registry.
async function fakeRunMacro(domain, action) {
  if (domain === "tools" && action === "web_search") {
    return { ok: true, summary: "search result" };
  }
  if (domain === "multimodal" && action === "image_generate") {
    return { ok: true, source: "stub", image: "base64data" };
  }
  if (domain === "expert_mode" && action === "answer") {
    return { ok: true, answer: "expert answer", sources: [], citationsRecorded: 0 };
  }
  return { ok: false, error: "unhandled in fake runMacro" };
}

// Builds a fake brainChat that, on its first call, returns a single
// assistant turn containing `n` TOOL_CALL markers for `toolName` (all
// dispatched within ONE turn — chat-agent.js's per-turn loop executes up to
// 5 queued calls per turn), then on the next call returns a plain final
// answer with no tool calls so the loop terminates cleanly.
function makeBrainWithToolBurst(calls) {
  let turn = 0;
  return async () => {
    turn++;
    if (turn === 1) {
      const markers = calls
        .map(({ tool, params = {} }) => `[TOOL_CALL: ${JSON.stringify({ tool, params })}]`)
        .join("\n");
      return { ok: true, provider: "test", model: "test-model", text: markers, tokensIn: 10, tokensOut: 10 };
    }
    return { ok: true, provider: "test", model: "test-model", text: "Here is your final answer.", tokensIn: 10, tokensOut: 10 };
  };
}

describe("tool-preference signal", () => {
  describe("(a) initiative-engine.js#recordToolUsage — direct tally correctness", () => {
    let db, engine;

    before(() => {
      db = makeDb();
      engine = createInitiativeEngine(db);
    });

    it("increments a single tool's count across repeated calls", () => {
      engine.recordToolUsage("u-tally", "web_search");
      engine.recordToolUsage("u-tally", "web_search");
      const tally = engine.recordToolUsage("u-tally", "web_search");
      assert.equal(tally.web_search, 3);
    });

    it("tracks multiple distinct tools independently for the same user", () => {
      engine.recordToolUsage("u-multi", "web_search");
      engine.recordToolUsage("u-multi", "web_search");
      engine.recordToolUsage("u-multi", "create_dtu");
      const tally = engine.getToolUsageTally("u-multi");
      assert.equal(tally.web_search, 2);
      assert.equal(tally.create_dtu, 1);
    });

    it("getStyleProfile folds the tally in as .toolUsage", () => {
      engine.recordToolUsage("u-profile-fold", "run_lens_action");
      const profile = engine.getStyleProfile("u-profile-fold");
      assert.equal(profile.toolUsage.run_lens_action, 1);
    });

    it("a never-recorded user reads back an honest empty tally, not a crash", () => {
      const tally = engine.getToolUsageTally("u-never-used-a-tool");
      assert.deepEqual(tally, {});
    });

    it("validates required arguments", () => {
      assert.throws(() => engine.recordToolUsage(null, "web_search"));
      assert.throws(() => engine.recordToolUsage("u-x", ""));
      assert.throws(() => engine.recordToolUsage("u-x", 42));
    });

    it("degrades honestly (no throw, empty tally) on a DB that predates migration 388", () => {
      const legacyDb = new Database(":memory:");
      upInitiative(legacyDb); // migration 029 ONLY — no tool_usage_json column
      const legacyEngine = createInitiativeEngine(legacyDb);
      assert.doesNotThrow(() => legacyEngine.recordToolUsage("u-legacy", "web_search"));
      const profile = legacyEngine.getStyleProfile("u-legacy");
      assert.deepEqual(profile.toolUsage, {});
    });
  });

  describe("(b) chat-agent.js#runAgentLoop — real dispatch site wires the tally + composeSystemPrompt surfaces dominance", () => {
    let db;

    before(() => {
      db = makeDb();
    });

    it("5 real web_search dispatches through the actual agent loop produce a dominant-tool line", async () => {
      const userId = "u-dominant";
      const brain = makeBrainWithToolBurst(
        Array.from({ length: 5 }, () => ({ tool: "web_search", params: { query: "concord" } })),
      );

      const result = await runAgentLoop({
        db, userId, message: "search for things 5 times",
        runMacro: fakeRunMacro, lensActions: new Map(),
        opts: { brainChat: brain, maxTurns: 2 },
      });

      assert.equal(result.ok, true);
      assert.equal(result.toolCalls.length, 5);
      assert.ok(result.toolCalls.every((c) => c.tool === "web_search" && c.ok === true));

      // The tally is real, persisted state — verify directly off the engine
      // (compute-don't-guess: read the actual persisted count, don't assume it).
      const engine = createInitiativeEngine(db);
      const tally = engine.getToolUsageTally(userId);
      assert.equal(tally.web_search, 5);

      const prompt = composeSystemPrompt("conscious", { mode: "chat", userId, db });
      assert.match(prompt.system, /Learned conversational style for this user/);
      assert.match(prompt.system, /tends to reach for the web_search tool/);
      assert.match(prompt.system, /5\/5/);
    });

    it("failed tool dispatches still count toward the tally (a failed call still reflects which tool was reached for)", async () => {
      const userId = "u-failed-calls-still-count";
      // fakeRunMacro returns ok:false for run_compute (unhandled), so every
      // one of these 5 calls will fail — but they should still tally.
      const brain = makeBrainWithToolBurst(
        Array.from({ length: 5 }, () => ({ tool: "run_compute", params: { key: "bogus.fn", input: {} } })),
      );

      const result = await runAgentLoop({
        db, userId, message: "run some bogus compute 5 times",
        runMacro: fakeRunMacro, lensActions: new Map(),
        opts: { brainChat: brain, maxTurns: 2 },
      });

      assert.equal(result.ok, true);
      assert.equal(result.toolCalls.length, 5);

      const engine = createInitiativeEngine(db);
      const tally = engine.getToolUsageTally(userId);
      assert.equal(tally.run_compute, 5);
    });
  });

  describe("(c) honest-absence — no fabricated preference from too little/too-even data", () => {
    let db;

    before(() => {
      db = makeDb();
    });

    it("below MIN_TOOL_SAMPLE (only 4 calls, all one tool) injects nothing", async () => {
      const userId = "u-below-floor";
      const brain = makeBrainWithToolBurst(
        Array.from({ length: 4 }, () => ({ tool: "web_search", params: { query: "x" } })),
      );
      await runAgentLoop({
        db, userId, message: "search 4 times",
        runMacro: fakeRunMacro, lensActions: new Map(),
        opts: { brainChat: brain, maxTurns: 2 },
      });

      const engine = createInitiativeEngine(db);
      assert.equal(engine.getToolUsageTally(userId).web_search, 4);

      const prompt = composeSystemPrompt("conscious", { mode: "chat", userId, db });
      assert.doesNotMatch(prompt.system, /tends to reach for/);
    });

    it("above the floor but evenly spread across tools (no clear majority) injects nothing", async () => {
      const userId = "u-even-spread";
      // 2 web_search + 2 generate_image + 1 expert_mode = 5 total; top
      // share is 2/5 = 0.4, below DOMINANT_TOOL_SHARE (0.6).
      const brain = makeBrainWithToolBurst([
        { tool: "web_search", params: { query: "a" } },
        { tool: "web_search", params: { query: "b" } },
        { tool: "generate_image", params: { prompt: "a cat" } },
        { tool: "generate_image", params: { prompt: "a dog" } },
        { tool: "expert_mode", params: { query: "c" } },
      ]);
      await runAgentLoop({
        db, userId, message: "mix of tools",
        runMacro: fakeRunMacro, lensActions: new Map(),
        opts: { brainChat: brain, maxTurns: 2 },
      });

      const engine = createInitiativeEngine(db);
      const tally = engine.getToolUsageTally(userId);
      const total = Object.values(tally).reduce((s, n) => s + n, 0);
      assert.equal(total, 5); // sample floor met...
      const top = Math.max(...Object.values(tally));
      assert.ok(top / total < 0.6, "fixture must stay below the dominance threshold");

      const prompt = composeSystemPrompt("conscious", { mode: "chat", userId, db });
      assert.doesNotMatch(prompt.system, /tends to reach for/);
    });

    it("a user with no tool calls at all gets no tool-preference line (pre-existing honest-empty path)", () => {
      const prompt = composeSystemPrompt("conscious", { mode: "chat", userId: "u-no-tools-ever", db });
      assert.doesNotMatch(prompt.system, /tends to reach for/);
    });
  });

  describe("(d) composability — tool-preference line coexists with the pre-existing formality/emoji lines", () => {
    it("a user with BOTH a learned casual style AND a dominant tool gets BOTH lines, unaffected by each other", async () => {
      const db = makeDb();
      const userId = "u-both-signals";
      const engine = createInitiativeEngine(db);

      // Real EMA style learning — unchanged pre-existing behavior.
      const casualProfile = engine.learnStyle(userId, "hey lol 😀😂 whats up dude gonna check this out no cap");
      assert.ok(casualProfile.formalityLevel <= 0.35, "fixture message must land in the casual bucket");
      assert.ok(casualProfile.emojiRate >= 0.05, "fixture message must land in the emoji bucket");

      // Real tool-preference dominance, via the actual runAgentLoop dispatch site.
      const brain = makeBrainWithToolBurst(
        Array.from({ length: 6 }, () => ({ tool: "create_dtu", params: { title: "t", summary: "s" } })),
      );
      await runAgentLoop({
        db, userId, message: "mint 6 dtus",
        runMacro: fakeRunMacro, lensActions: new Map(),
        opts: { brainChat: brain, maxTurns: 2 },
      });

      const prompt = composeSystemPrompt("conscious", { mode: "chat", userId, db });
      assert.match(prompt.system, /casual\/informal phrasing with contractions/);
      assert.match(prompt.system, /occasional emoji reads naturally to them/);
      assert.match(prompt.system, /tends to reach for the create_dtu tool/);
      // All three bits must live inside the SAME single "Learned
      // conversational style" sentence, not scattered/duplicated lines.
      const matches = prompt.system.match(/Learned conversational style for this user[^.]*\./g) || [];
      assert.equal(matches.length, 1, "expected exactly one style-guidance sentence");
    });
  });
});
