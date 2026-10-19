// server/tests/self-continuation.test.js
// Pure, no-server-boot tests for the self-continuation module.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAgentLoop } from "../lib/chat-agent.js";
import {
  CHECKPOINT_OPEN,
  CHECKPOINT_CLOSE,
  selfContinueConfig,
  selfContinueActive,
  checkpointProtocolBlock,
  parseCheckpoint,
  stripControl,
  buildContinuationMessages,
  stitch,
  runSelfContinuation,
  CONTINUE_SYSTEM,
} from "../lib/chat/self-continuation.js";

function assertNoCheckpoint(result) {
  assert.ok(
    !result.text.includes("CONCORD_CHECKPOINT"),
    "self-continuation result must not leak CONCORD_CHECKPOINT"
  );
}

function repeatTo(len, word = "word ") {
  let s = "";
  let i = 0;
  while (s.length < len) {
    s += word + i + " ";
    i++;
  }
  return s.slice(0, len);
}

function checkpointBlock(body) {
  return `${CHECKPOINT_OPEN}\n${body}\n${CHECKPOINT_CLOSE}`;
}

describe("parseCheckpoint", () => {
  it("parses a complete checkpoint block as JSON", () => {
    const body = JSON.stringify({ done: ["section A"], remaining: ["section B"], next: "write B" });
    const text = `Here is part one.\n\n${checkpointBlock(body)}`;
    const r = parseCheckpoint(text);
    assert.equal(r.malformed, false);
    assert.deepEqual(r.checkpoint, { done: ["section A"], remaining: ["section B"], next: "write B" });
    assert.equal(r.visible, "Here is part one.");
    assert.ok(!r.visible.includes("CONCORD_CHECKPOINT"));
  });

  it("tolerantly parses malformed line-based checkpoints", () => {
    const text = `Some text.\n\n${checkpointBlock("done: alpha; beta\nremaining: gamma, delta\nnext: finish")}`;
    const r = parseCheckpoint(text);
    assert.equal(r.malformed, true);
    assert.deepEqual(r.checkpoint, { done: ["alpha", "beta"], remaining: ["gamma", "delta"], next: "finish" });
    assert.equal(r.visible, "Some text.");
  });

  it("treats an opener without a closer as malformed", () => {
    const text = `Start answer\n${CHECKPOINT_OPEN}\n{"done":["a"],"remaining":["b"]}`;
    const r = parseCheckpoint(text);
    assert.equal(r.malformed, true);
    assert.deepEqual(r.checkpoint, { done: [], remaining: ["finish the answer"], next: "" });
    assert.equal(r.visible, "Start answer");
    assert.ok(!r.visible.includes("CONCORD_CHECKPOINT"));
  });

  it("returns null checkpoint when no block is present", () => {
    const r = parseCheckpoint("Just a plain answer.");
    assert.equal(r.checkpoint, null);
    assert.equal(r.malformed, false);
    assert.equal(r.visible, "Just a plain answer.");
  });
});

describe("stripControl", () => {
  it("removes multiple complete checkpoint blocks", () => {
    const text = `Before\n\n${checkpointBlock(JSON.stringify({ done: ["a"], remaining: ["b"] }))}\n\nMiddle\n\n${checkpointBlock(JSON.stringify({ done: ["c"], remaining: ["d"] }))}\n\nAfter`;
    const r = stripControl(text);
    assert.equal(r, "Before\n\nMiddle\n\nAfter");
    assert.ok(!r.includes("CONCORD_CHECKPOINT"));
  });

  it("removes stray lines containing CONCORD_CHECKPOINT", () => {
    const r = stripControl("Hello\nstray CONCORD_CHECKPOINT line\nWorld");
    assert.equal(r, "Hello\nWorld");
  });

  it("returns an empty string for nullish input", () => {
    assert.equal(stripControl(null), "");
    assert.equal(stripControl(undefined), "");
  });
});

describe("stitch", () => {
  it("removes a long echoed overlap", () => {
    const a = "Here is the quick brown fox jumps";
    const b = "the quick brown fox jumps over the lazy dog.";
    const r = stitch(a, b);
    assert.equal(r, "Here is the quick brown fox jumps over the lazy dog.");
  });

  it("joins with a paragraph break when the continuation starts a heading", () => {
    const a = "Intro paragraph.";
    const b = "## Details\nMore info.";
    const r = stitch(a, b);
    assert.equal(r, "Intro paragraph.\n\n## Details\nMore info.");
  });
});

describe("buildContinuationMessages", () => {
  it("builds four messages containing the original prompt and remaining list", () => {
    const r = buildContinuationMessages({
      systemPrompt: "You are helpful.",
      originalPrompt: "Explain quantum computing.",
      stitched: "Intro.",
      checkpoint: { done: ["intro"], remaining: ["qubits", "algorithms"], next: "qubits" },
      round: 2,
    });
    assert.equal(r.length, 4);
    assert.deepEqual(
      r.map((m) => m.role),
      ["system", "user", "assistant", "user"]
    );
    assert.ok(r[0].content.includes(CONTINUE_SYSTEM));
    assert.ok(r[1].content.includes("Explain quantum computing."));
    assert.ok(r[2].content.includes("Intro."));
    assert.ok(r[3].content.includes("Remaining: qubits; algorithms."));
    assert.ok(r[3].content.includes("Next: qubits."));
  });

  it("shrinks a long stitched text to fit the character budget", () => {
    const stitched = repeatTo(20000);
    const r = buildContinuationMessages({
      systemPrompt: "Sys.",
      originalPrompt: "Prompt.",
      stitched,
      checkpoint: { done: [], remaining: ["rest"], next: "" },
      round: 1,
      budgetChars: 6000,
    });
    const total = r.reduce((s, m) => s + String(m.content || "").length, 0);
    assert.ok(total <= 6000, `total ${total} should be <= 6000`);
    const tail = String(r[2].content);
    assert.ok(tail.endsWith(stitched.slice(-200)), "tail should end with the last 200 chars of stitched text");
  });
});

describe("runSelfContinuation", () => {
  it("(a) continues through checkpoint blocks and stops on a clean final part", async () => {
    const firstText = `This is the first part of the answer.\n\n${checkpointBlock(JSON.stringify({ done: ["one"], remaining: ["two"] }))}`;
    const generate = async (_msgs, o) => {
      if (o.round === 1) {
        return {
          ok: true,
          text: `This is the second part of the answer.\n\n${checkpointBlock(JSON.stringify({ done: ["two"], remaining: ["three"] }))}`,
        };
      }
      return { ok: true, text: "This is the third part of the answer." };
    };
    const r = await runSelfContinuation({ generate, firstText, systemPrompt: "Sys.", originalPrompt: "Go." });
    assertNoCheckpoint(r);
    assert.equal(r.rounds, 2);
    assert.equal(r.stoppedBy, "complete");
    assert.equal(r.incomplete, false);
    assert.ok(r.text.includes("first part"));
    assert.ok(r.text.includes("second part"));
    assert.ok(r.text.includes("third part"));
    assert.ok(r.text.indexOf("first part") < r.text.indexOf("second part"));
    assert.ok(r.text.indexOf("second part") < r.text.indexOf("third part"));
  });

  it("(b) continues when first reply stopped on length even without a checkpoint", async () => {
    const generate = async () => ({ ok: true, text: "This is the final part of the answer." });
    const r = await runSelfContinuation({
      generate,
      firstText: "Part one cut off at token limit",
      firstDoneReason: "length",
      systemPrompt: "Sys.",
      originalPrompt: "Go.",
    });
    assertNoCheckpoint(r);
    assert.equal(r.rounds, 1);
    assert.equal(r.stoppedBy, "complete");
    assert.equal(r.incomplete, false);
    assert.ok(r.text.includes("Part one cut off at token limit"));
    assert.ok(r.text.includes("This is the final part of the answer."));
  });

  it("(c) does not call generate when the first reply is already complete", async () => {
    let calls = 0;
    const generate = async () => {
      calls++;
      return { ok: true, text: "should not be used" };
    };
    const r = await runSelfContinuation({
      generate,
      firstText: "Complete answer.",
      firstDoneReason: "stop",
      systemPrompt: "Sys.",
      originalPrompt: "Go.",
    });
    assertNoCheckpoint(r);
    assert.equal(calls, 0);
    assert.equal(r.rounds, 0);
    assert.equal(r.stoppedBy, "complete");
    assert.equal(r.incomplete, false);
    assert.ok(r.text.includes("Complete answer."));
  });

  it("(d) stops at maxRounds when the model keeps emitting checkpoints", async () => {
    let n = 0;
    // Each round must add new text: identical rounds are caught by the stall guard instead.
    const generate = async () => ({
      ok: true,
      text: `Here is continuation chunk number ${++n} with new content.\n\n${checkpointBlock(JSON.stringify({ done: ["more"], remaining: ["still more"] }))}`,
    });
    const r = await runSelfContinuation({
      generate,
      firstText: `Start.\n\n${checkpointBlock(JSON.stringify({ done: ["start"], remaining: ["rest"] }))}`,
      systemPrompt: "Sys.",
      originalPrompt: "Go.",
      env: { CONCORD_SELF_CONTINUE_MAX_ROUNDS: "3" },
    });
    assertNoCheckpoint(r);
    assert.equal(r.rounds, 3);
    assert.equal(r.stoppedBy, "max_rounds");
    assert.equal(r.incomplete, true);
    assert.ok(r.text.includes('Say "continue"'));
  });

  it("(e) kill switch stops before any generate call", async () => {
    let calls = 0;
    const generate = async () => {
      calls++;
      return { ok: true, text: "never used" };
    };
    const r = await runSelfContinuation({
      generate,
      firstText: `Start.\n\n${checkpointBlock(JSON.stringify({ done: ["start"], remaining: ["rest"] }))}`,
      systemPrompt: "Sys.",
      originalPrompt: "Go.",
      env: { CONCORD_SELF_CONTINUE_KILL: "1" },
    });
    assertNoCheckpoint(r);
    assert.equal(calls, 0);
    assert.equal(r.rounds, 0);
    assert.equal(r.stoppedBy, "kill_switch");
    assert.equal(r.incomplete, true);
  });

  it("(e) kill file created after round 1 stops before round 2", async () => {
    const killFile = join(tmpdir(), `concord-self-continue-kill-${Date.now()}.off`);
    try {
      assert.equal(existsSync(killFile), false);
      let calls = 0;
      const generate = async () => {
        calls++;
        if (calls === 1) writeFileSync(killFile, "");
        return {
          ok: true,
          text: `Round ${calls} has enough text to count as progress.\n\n${checkpointBlock(JSON.stringify({ done: ["r" + calls], remaining: ["more"] }))}`,
        };
      };
      const r = await runSelfContinuation({
        generate,
        firstText: `Start.\n\n${checkpointBlock(JSON.stringify({ done: ["start"], remaining: ["rest"] }))}`,
        systemPrompt: "Sys.",
        originalPrompt: "Go.",
        env: { CONCORD_SELF_CONTINUE_KILL_FILE: killFile },
      });
      assertNoCheckpoint(r);
      assert.equal(r.rounds, 1);
      assert.equal(r.stoppedBy, "kill_switch");
      assert.equal(r.incomplete, true);
      assert.ok(r.text.includes("Round 1 has enough text"));
      assert.ok(existsSync(killFile));
    } finally {
      try { unlinkSync(killFile); } catch {}
    }
  });

  it("(f) detects a stalled continuation", async () => {
    // Still cut on length but adding nothing: one retry with a stronger note, then stop.
    const generate = async () => ({ ok: true, text: "ok", doneReason: "length" });
    const r = await runSelfContinuation({
      generate,
      firstText: `Start.\n\n${checkpointBlock(JSON.stringify({ done: ["start"], remaining: ["rest"] }))}`,
      systemPrompt: "Sys.",
      originalPrompt: "Go.",
    });
    assertNoCheckpoint(r);
    assert.equal(r.rounds, 2);
    assert.equal(r.stoppedBy, "stalled");
    assert.equal(r.incomplete, true);
  });

  it("(g) stops when the deadline elapses", async () => {
    let t = 0;
    const generate = async () => {
      t += 400000;
      return {
        ok: true,
        text: `Progress at ${t}.\n\n${checkpointBlock(JSON.stringify({ done: ["p"], remaining: ["r"] }))}`,
      };
    };
    const now = () => t;
    const r = await runSelfContinuation({
      generate,
      firstText: `Start.\n\n${checkpointBlock(JSON.stringify({ done: ["start"], remaining: ["rest"] }))}`,
      systemPrompt: "Sys.",
      originalPrompt: "Go.",
      env: { CONCORD_SELF_CONTINUE_DEADLINE_MS: "500000" },
      now,
    });
    assertNoCheckpoint(r);
    assert.equal(r.stoppedBy, "deadline");
    assert.equal(r.incomplete, true);
  });

  it("(h) handles a throwing generate function", async () => {
    const generate = async () => {
      throw new Error("brain down");
    };
    const r = await runSelfContinuation({
      generate,
      firstText: `Start.\n\n${checkpointBlock(JSON.stringify({ done: ["start"], remaining: ["rest"] }))}`,
      systemPrompt: "Sys.",
      originalPrompt: "Go.",
    });
    assertNoCheckpoint(r);
    assert.equal(r.stoppedBy, "round_failed");
    assert.equal(r.incomplete, true);
    assert.ok(r.text.includes("Start."));
  });
});

describe("selfContinueConfig / selfContinueActive", () => {
  it("defaults to disabled", () => {
    const cfg = selfContinueConfig({});
    assert.equal(cfg.enabled, false);
    assert.equal(cfg.killed, false);
    assert.equal(cfg.maxRounds, 4);
    assert.equal(cfg.roundTokens, 3072);
    assert.equal(cfg.maxChars, 60000);
    assert.equal(cfg.deadlineMs, 600000);
  });

  it("is active when the env flag is on", () => {
    assert.equal(selfContinueActive({ CONCORD_CHAT_SELF_CONTINUE: "1" }, {}), true);
  });

  it("is inactive when input opts out", () => {
    assert.equal(
      selfContinueActive({ CONCORD_CHAT_SELF_CONTINUE: "1" }, { selfContinue: false }),
      false
    );
  });

  it("is inactive when the kill switch is on", () => {
    assert.equal(
      selfContinueActive({ CONCORD_CHAT_SELF_CONTINUE: "1", CONCORD_SELF_CONTINUE_KILL: "1" }, {}),
      false
    );
  });

  it("clamps numeric config values", () => {
    const cfg = selfContinueConfig({
      CONCORD_CHAT_SELF_CONTINUE: "1",
      CONCORD_SELF_CONTINUE_MAX_ROUNDS: "20",
      CONCORD_SELF_CONTINUE_ROUND_TOKENS: "10000",
      CONCORD_SELF_CONTINUE_MAX_CHARS: "500000",
      CONCORD_SELF_CONTINUE_DEADLINE_MS: "2000000",
    });
    assert.equal(cfg.maxRounds, 8);
    assert.equal(cfg.roundTokens, 8192);
    assert.equal(cfg.maxChars, 400000);
    assert.equal(cfg.deadlineMs, 1800000);
  });
});

describe("runAgentLoop self-continuation integration", () => {
  it("continues a checkpoint-marked answer when the flag is on", async () => {
    const prev = process.env.CONCORD_CHAT_SELF_CONTINUE;
    process.env.CONCORD_CHAT_SELF_CONTINUE = "1";
    try {
      let calls = 0;
      const firstCheckpoint = checkpointBlock(JSON.stringify({ done: ["one"], remaining: ["two"] }));
      const brain = async ({ messages }) => {
        calls++;
        if (calls === 1) {
          assert.ok(messages[0].content.includes("LONG ANSWERS"), "first system prompt should include the checkpoint protocol");
          return {
            ok: true,
            provider: "test",
            model: "test-model",
            text: `This is part one of the answer.\n\n${firstCheckpoint}`,
            doneReason: "length",
          };
        }
        assert.ok(messages.some((m) => m.content.includes("part one")), "continuation messages should include earlier text");
        return { ok: true, provider: "test", model: "test-model", text: "This is part two of the answer." };
      };

      const r = await runAgentLoop({
        db: null,
        userId: "u1",
        message: "long story",
        runMacro: async () => ({ ok: true }),
        lensActions: new Map(),
        history: [],
        opts: { brainChat: brain, selfContinue: true },
      });

      assert.equal(r.ok, true);
      assert.ok(r.answer.includes("part one"));
      assert.ok(r.answer.includes("part two"));
      assert.ok(!r.answer.includes("CONCORD_CHECKPOINT"));
      assert.ok(r.selfContinuation);
      assert.equal(r.selfContinuation.rounds, 1);
      assert.equal(r.selfContinuation.stoppedBy, "complete");
      assert.equal(r.selfContinuation.incomplete, false);
      assert.equal(calls, 2);
    } finally {
      if (prev === undefined) delete process.env.CONCORD_CHAT_SELF_CONTINUE;
      else process.env.CONCORD_CHAT_SELF_CONTINUE = prev;
    }
  });

  it("strips the checkpoint block and does not continue when the flag is off", async () => {
    const prev = process.env.CONCORD_CHAT_SELF_CONTINUE;
    delete process.env.CONCORD_CHAT_SELF_CONTINUE;
    try {
      let calls = 0;
      const brain = async () => {
        calls++;
        return {
          ok: true,
          provider: "test",
          model: "test-model",
          text: `Part one.\n\n${checkpointBlock(JSON.stringify({ done: ["one"], remaining: ["two"] }))}`,
        };
      };

      const r = await runAgentLoop({
        db: null,
        userId: "u1",
        message: "long story",
        runMacro: async () => ({ ok: true }),
        lensActions: new Map(),
        history: [],
        opts: { brainChat: brain },
      });

      assert.equal(r.ok, true);
      assert.ok(r.answer.includes("Part one."));
      assert.ok(!r.answer.includes("CONCORD_CHECKPOINT"));
      assert.equal(r.selfContinuation, undefined);
      assert.equal(calls, 1);
    } finally {
      if (prev === undefined) delete process.env.CONCORD_CHAT_SELF_CONTINUE;
      else process.env.CONCORD_CHAT_SELF_CONTINUE = prev;
    }
  });
});

// ---- Prefill mode + reconcile (real-model runs on the pod, 2026-10-18) ----
describe("prefill continuation (default mode)", async () => {
  const m = await import("../lib/chat/self-continuation.js");
  it("config defaults to prefill; note mode is selectable", () => {
    assert.equal(m.selfContinueConfig({}).mode, "prefill");
    assert.equal(m.selfContinueConfig({ CONCORD_SELF_CONTINUE_MODE: "note" }).mode, "note");
  });
  it("buildPrefillMessages ends with the verbatim tail as an assistant message", () => {
    const stitched = "## A\n" + "alpha beta gamma. ".repeat(400) + "\n## B\nThe last words here";
    const msgs = m.buildPrefillMessages({ systemPrompt: "Sys.", originalPrompt: "Write it.", stitched, checkpoint: null });
    assert.deepEqual(msgs.map((x) => x.role), ["system", "user", "assistant"]);
    assert.ok(msgs[2].content.endsWith("The last words here"));
    assert.ok(msgs[2].content.length <= 3500);
    assert.match(msgs[0].content, /Continue it exactly/);
    assert.match(msgs[0].content, /## A/); // outline of the part before the tail
    assert.equal(msgs[1].content, "Write it.");
  });
  it("buildPrefillMessages respects the char budget", () => {
    const msgs = m.buildPrefillMessages({ systemPrompt: "S".repeat(7000), originalPrompt: "Q", stitched: "word ".repeat(5000), budgetChars: 9000 });
    const total = msgs.reduce((n, x) => n + x.content.length, 0);
    assert.ok(total <= 9000 || msgs[2].content.length <= 800, `total ${total}`);
  });
  it("joinExact joins token-exact continuations without guessing spaces", () => {
    assert.equal(m.joinExact("hops on la", "wns."), "hops on lawns.");
    assert.equal(m.joinExact("In winter, bot", "h sexes"), "In winter, both sexes");
    assert.equal(m.joinExact("End.", " Next."), "End. Next.");
    assert.equal(m.joinExact("End.", "Next."), "End. Next.");
    assert.equal(m.joinExact("| 1 | a |", "| 2 | b |"), "| 1 | a |\n| 2 | b |");
    assert.equal(m.joinExact("| 1 | Ro", "bin | b |"), "| 1 | Robin | b |");
    assert.equal(m.joinExact("Para.", "## Next"), "Para.\n\n## Next");
  });
  it("stitchExact drops a re-emitted earlier section and merges a restarted table", () => {
    const a = "## 1. Cardinal (C c)\nRed.\n\n## Summary\n| # | Bird |\n|---|---|\n| 1 | Cardinal |";
    const b = "\n\n## 1. Cardinal\nRed again.\n\n## Summary\n| # | Bird |\n|---|---|\n| 1 | Cardinal |\n| 2 | Robin |";
    const out = m.stitchExact(a, b);
    assert.equal((out.match(/## Summary/g) || []).length, 1);
    assert.equal((out.match(/Cardinal \|/g) || []).length, 1);
    assert.ok(!/Red again/.test(out));
    assert.ok(out.endsWith("| 2 | Robin |"));
  });
  it("a prose section restarted from its heading replaces the partial one", () => {
    const a = "## 1. A\nDone.\n\n## 2. Robin (T m)\nOrange breast, hops on la";
    const out = m.stitch(a, "## 2. Robin\nOrange breast, hops on lawns.\n\n## 3. Jay\nBlue.");
    assert.equal((out.match(/Robin/g) || []).length, 1);
    assert.ok(out.includes("hops on lawns.") && out.includes("## 3. Jay"));
  });
  it("dropPartialTableRow removes a cut-off row (open end or missing cells)", () => {
    assert.equal(m.dropPartialTableRow("| a | b | c |\n|---|---|---|\n| 1 | x | y |\n| 2 | q"), "| a | b | c |\n|---|---|---|\n| 1 | x | y |");
    assert.equal(m.dropPartialTableRow("| a | b | c |\n|---|---|---|\n| 1 | x | y |\n| 2 | q |"), "| a | b | c |\n|---|---|---|\n| 1 | x | y |");
    assert.equal(m.dropPartialTableRow("Plain."), "Plain.");
  });
  it('"remaining":["none"] counts as finished', () => {
    const p = m.parseCheckpoint(`x\n${m.CHECKPOINT_OPEN}\n{"done":["a"],"remaining":["none"],"next":"none"}\n${m.CHECKPOINT_CLOSE}`);
    assert.deepEqual(p.checkpoint.remaining, []);
    assert.equal(m.needsContinuation({ checkpoint: p.checkpoint, doneReason: "stop" }), false);
  });
  it("loop: length-cut answer is continued token-exact until a natural stop", async () => {
    const pieces = [
      { text: "ns, then the summary.\n\n## Summary\n| # | Bird |\n|---|---|\n| 1 | Card", doneReason: "length" },
      { text: "inal |\n| 2 | Robin |", doneReason: "stop" },
    ];
    const seen = [];
    const r = await m.runSelfContinuation({
      env: { CONCORD_CHAT_SELF_CONTINUE: "1" },
      generate: async (msgs) => { seen.push(msgs); return { ok: true, ...pieces.shift() }; },
      firstText: "## 1. Cardinal\nRobins eat worms and seeds; they hop on law",
      firstDoneReason: "length",
      systemPrompt: "Sys.", originalPrompt: "Go.",
    });
    assert.equal(r.stoppedBy, "complete");
    assert.equal(r.incomplete, false);
    assert.equal(r.rounds, 2);
    assert.equal(seen[0].at(-1).role, "assistant");
    assert.ok(seen[0].at(-1).content.endsWith("hop on law"));
    assert.ok(r.text.includes("hop on lawns, then the summary."));
    assert.ok(r.text.endsWith("| 1 | Cardinal |\n| 2 | Robin |"));
  });
  it("loop: an empty successful continuation means the answer is complete (no footer)", async () => {
    const r = await m.runSelfContinuation({
      env: { CONCORD_CHAT_SELF_CONTINUE: "1" },
      generate: async () => ({ ok: true, text: "", doneReason: "stop" }),
      firstText: `All done.\n\n${m.CHECKPOINT_OPEN}\n{"done":["all"],"remaining":["Summary"]}\n${m.CHECKPOINT_CLOSE}`,
      firstDoneReason: "stop",
      systemPrompt: "Sys.", originalPrompt: "Go.",
    });
    assert.equal(r.stoppedBy, "complete");
    assert.equal(r.incomplete, false);
    assert.equal(r.text, "All done.");
  });
});


describe("optin mode", async () => {
  const m = await import("../lib/chat/self-continuation.js");
  it('"optin" turns it on only for a request that asks', () => {
    const env = { CONCORD_CHAT_SELF_CONTINUE: "optin", CONCORD_SELF_CONTINUE_KILL_FILE: "/nonexistent/kill" };
    assert.equal(m.selfContinueActive(env, {}), false);
    assert.equal(m.selfContinueActive(env, { selfContinue: true }), true);
    assert.equal(m.selfContinueActive({ ...env, CONCORD_SELF_CONTINUE_KILL: "1" }, { selfContinue: true }), false);
    assert.equal(m.selfContinueActive({ CONCORD_SELF_CONTINUE_KILL_FILE: "/nonexistent/kill" }, { selfContinue: true }), false, "unset env stays off even if asked");
    assert.equal(m.selfContinueActive({ CONCORD_CHAT_SELF_CONTINUE: "1", CONCORD_SELF_CONTINUE_KILL_FILE: "/nonexistent/kill" }, { selfContinue: false }), false);
  });
});

describe("bold field labels are not section headings", async () => {
  const m = await import("../lib/chat/self-continuation.js");
  it("repeated **Habitat:** labels in a new section are kept", () => {
    const a = "## 1. Cardinal\n\n**Habitat:**\nWoods.\n\n**Diet:**\nSeeds.\n\n## 2. Robin\n\n**Habitat:**\nLawns.";
    const b = "\n\n**Diet:**\nWorms.\n\n## 3. Jay\n\n**Habitat:**\nForests.\n\n**Diet:**\nAcorns.";
    const out = m.stitchExact(a, b);
    assert.ok(out.endsWith("**Diet:**\nAcorns."));
    assert.ok(out.includes("Worms.") && out.includes("## 3. Jay") && out.includes("Forests."));
  });
});

describe("no 'I'll continue step by step' preamble (2026-10-18)", async () => {
  const m = await import("../lib/chat/self-continuation.js");
  const LIVE = "I can give you a detailed guide, but not in a single response. We'll continue step by step.";

  it("the protocol block forbids announcing parts and never asks for 'continue'", () => {
    const b = checkpointProtocolBlock(3072);
    assert.match(b, /one continuous reply/);
    assert.match(b, /never announce that you will continue/i);
    assert.ok(!/You will then be asked to continue/.test(b), "must not tell the model it will be asked to continue");
    assert.ok(b.includes(CHECKPOINT_OPEN) && b.includes(CHECKPOINT_CLOSE), "checkpoint protocol itself stays");
  });

  it("drops the live preamble and a trailing 'ready for the next part' line", () => {
    const out = m.stripContinuationPreamble(`${LIVE}\n\n## 1. Site\nPick a sunny spot.\n\n## 2. Soil\nTest it.\n\nLet me know when you're ready for the next part.`, {});
    assert.equal(out, "## 1. Site\nPick a sunny spot.\n\n## 2. Soil\nTest it.");
  });

  it("keeps the rest of a mixed opening paragraph", () => {
    const out = m.stripContinuationPreamble("Sure! This won't fit in one response, so I'll split it into parts. Here is the full guide:\n\n## A\nx", {});
    assert.equal(out, "Sure! Here is the full guide:\n\n## A\nx");
  });

  it("leaves ordinary content alone", () => {
    for (const t of [
      "Let's go through this step by step.\n\n1. Do x",
      "Here's what to write in a reply to your landlord.\n\nDear Sir...",
      "The guide has three parts: soil, water, light.\n\n## Soil\nx",
      "Great question! Gardening is rewarding.\n\n## 1\nx\n\n## Summary\nThat's everything — enjoy your garden.",
      "Not in a single response.", // single paragraph: never stripped to nothing
    ]) assert.equal(m.stripContinuationPreamble(t, {}), t);
  });

  it("CONCORD_SELF_CONTINUE_PREAMBLE_STRIP=0 turns the strip off", () => {
    const t = `${LIVE}\n\n## 1\nx`;
    assert.equal(m.stripContinuationPreamble(t, { CONCORD_SELF_CONTINUE_PREAMBLE_STRIP: "0" }), t);
  });

  it("runSelfContinuation still continues and returns one clean reply", async () => {
    let calls = 0;
    const first = `${LIVE}\n\n## 1. Site\nPick a sunny spot.\n\n${CHECKPOINT_OPEN}\n{"done":["site"],"remaining":["soil"]}\n${CHECKPOINT_CLOSE}`;
    const r = await runSelfContinuation({
      generate: async () => { calls++; return { ok: true, text: "\n\n## 2. Soil\nTest it.", doneReason: "stop" }; },
      firstText: first, firstDoneReason: "stop",
      env: { CONCORD_CHAT_SELF_CONTINUE: "1", CONCORD_SELF_CONTINUE_KILL_FILE: "/nonexistent/kill" },
    });
    assert.equal(calls, 1);
    assert.equal(r.stoppedBy, "complete");
    assert.ok(r.text.startsWith("## 1. Site"), r.text);
    assert.ok(r.text.includes("## 2. Soil"));
    assertNoCheckpoint(r);
  });

  it("runAgentLoop: a one-part answer loses the preamble when self-continuation is on", async () => {
    const prev = process.env.CONCORD_CHAT_SELF_CONTINUE;
    process.env.CONCORD_CHAT_SELF_CONTINUE = "1";
    try {
      const brain = async () => ({ ok: true, provider: "test", model: "t", text: `${LIVE}\n\n## 1. Site\nPick a sunny spot.\n\n## 2. Soil\nTest it.`, doneReason: "stop" });
      const r = await runAgentLoop({ db: null, userId: "u1", message: "garden guide", runMacro: async () => ({ ok: true }), lensActions: new Map(), history: [], opts: { brainChat: brain, deepen: false } });
      assert.equal(r.ok, true);
      assert.ok(r.answer.startsWith("## 1. Site"), r.answer);
      assert.ok(!/single response|step by step/i.test(r.answer));
    } finally {
      if (prev === undefined) delete process.env.CONCORD_CHAT_SELF_CONTINUE;
      else process.env.CONCORD_CHAT_SELF_CONTINUE = prev;
    }
  });
});
