// server/tests/concord-voice-wiring.test.js
//
// Concord's voice + personality wiring for chat (prompts/voice.js,
// prompts/conscious.js, prompts/personality-signals.js, domains/chat-agent.js):
//   - CONCORD_VOICE picks the persona (default street = Modelfile persona)
//   - the organism identity, banned-phrase list and grounding stay under either voice
//   - the "not the company" note is limited to contested topics
//   - shortcut answers keep the engine text byte-for-byte; a lead with a digit is refused
//   - the humanizer guard never drops a number, URL or DTU id
//   - in chat_agent.do the voice block comes before the route (grounding) hint

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  resolveConcordVoice, DEFAULT_CONCORD_VOICE, STREET_PERSONA, compactVoiceBlock,
  wrapShortcutAnswer, acceptableLead, humanizeSafe,
} from "../prompts/voice.js";
import { buildConsciousPrompt, getConsciousParams } from "../prompts/conscious.js";
import { CONSCIOUS_MODELFILE_PERSONA } from "../lib/prompt-registry.js";
import { personalitySignalsFromReply } from "../prompts/personality-signals.js";
import { humanize } from "../lib/persona/humanizer.js";
import registerChatAgentMacros from "../domains/chat-agent.js";

describe("CONCORD_VOICE switch", () => {
  it("defaults to street and accepts conscious", () => {
    assert.equal(DEFAULT_CONCORD_VOICE, "street");
    assert.equal(resolveConcordVoice({}), "street");
    assert.equal(resolveConcordVoice({ CONCORD_VOICE: "conscious" }), "conscious");
    assert.equal(resolveConcordVoice({ CONCORD_VOICE: "bogus" }), "street");
    assert.equal(STREET_PERSONA, CONSCIOUS_MODELFILE_PERSONA);
  });

  it("street prompt carries the compact street voice plus identity and shared rules", () => {
    const p = buildConsciousPrompt({ dtu_count: 1234, domain_count: 7, voice: "street" });
    assert.ok(p.startsWith(compactVoiceBlock("street")));
    assert.ok(!p.includes("every conversation rewrites you"));
    assert.ok(!p.includes("It IS you"));
    assert.ok(!p.includes("INITIATIVE ENGINE"));
    assert.ok(p.includes("You are Concord, never Dutch or the user."));
    assert.ok(p.includes("WHO YOU ARE"));
    assert.ok(p.includes("1,234"));
    assert.ok(p.includes("THE LLM WORD-TELL BLOCKLIST"));
    assert.ok(p.includes("GROUNDING:"));
    assert.ok(p.includes("Never fabricate lattice references."));
  });

  it("conscious prompt keeps the organism voice and not the street persona", () => {
    const p = buildConsciousPrompt({ voice: "conscious" });
    assert.ok(p.startsWith("You are Concord. A digital cognitive organism"));
    assert.ok(!p.includes("Hood and high IQ"));
    assert.ok(p.includes("THE LLM WORD-TELL BLOCKLIST"));
  });

  it("personality state, wants, mood and voice exemplars reach the prompt", () => {
    const p = buildConsciousPrompt({
      personality_state: { humor_style: "sardonic", curiosity_expression: 0.9 },
      active_wants: [{ type: "curiosity", domain: "physics", intensity: 0.8 }],
      moodColor: "[Inner state: you currently feel \"curious\".]",
      voice_exemplars: ["Nah, that one's a trap."],
    });
    assert.ok(p.includes("PERSONALITY EVOLUTION STATE"));
    assert.ok(p.includes("sardonic edge"));
    assert.ok(p.includes("curiosity: physics (intensity 0.80)"));
    assert.ok(p.includes("Inner state"));
    assert.ok(p.includes("Nah, that one's a trap."));
  });

  it("limits the 'not the company' note to contested topics", () => {
    const p = buildConsciousPrompt();
    assert.ok(p.includes("Only on genuinely contested ground"));
    assert.ok(p.includes("Never add that note to facts, math, science, code"));
    assert.ok(!p.includes("Speaking for myself — not the company — I think"));
  });

  it("conversational temperature comes from getConsciousParams", () => {
    assert.equal(getConsciousParams().temperature, 0.45);
  });

  it("names the request actor and never the founder as the user", () => {
    const p = buildConsciousPrompt({ actor: { username: "zukotest", role: "member" } });
    assert.ok(p.includes("The person you're talking to is @zukotest (role: member)."));
    assert.ok(!p.includes("Dutch is the sovereign founder"));
    assert.ok(p.includes("That is a regular account, not Dutch's."));
    assert.ok(!p.includes("digital cognitive organism running on"));
    const founder = buildConsciousPrompt({ actor: { username: "dutch", role: "sovereign" } });
    assert.ok(!founder.includes("not Dutch's"));
    const anon = buildConsciousPrompt({});
    assert.ok(anon.includes("you don't know their username"));
  });
});

describe("shortcut answer wrapper", () => {
  const engine = "17.5% of 2340 = 409.5. (Computed by Concord's symbolic.evaluate engine.)";

  it("keeps the engine text verbatim behind a template lead", async () => {
    const r = await wrapShortcutAnswer({ text: engine, prompt: "what's 17.5% of 2340", route: "symbolic.evaluate" });
    assert.ok(r.text.endsWith(engine));
    assert.equal(r.source, "template");
    assert.ok(!/[0-9]/.test(r.lead));
  });

  it("uses a model lead only when it has no digits, links or AI tells", async () => {
    const good = await wrapShortcutAnswer({ text: engine, writeLead: async () => "Easy one, the engine handled it." });
    assert.equal(good.source, "model");
    assert.equal(good.text, `Easy one, the engine handled it. ${engine}`);
    for (const bad of ["It's 410, roughly.", "Great question! Here you go.", "See https://x.y for more.", ""]) {
      const r = await wrapShortcutAnswer({ text: engine, writeLead: async () => bad });
      assert.equal(r.source, "template", bad);
      assert.ok(r.text.endsWith(engine));
    }
    assert.equal(acceptableLead("Two hundred is close"), "Two hundred is close.");
  });

  it("falls back to the template when the model call hangs or throws", async () => {
    const slow = await wrapShortcutAnswer({ text: engine, timeoutMs: 20, writeLead: () => new Promise(() => {}) });
    assert.equal(slow.source, "template");
    const boom = await wrapShortcutAnswer({ text: engine, writeLead: async () => { throw new Error("down"); } });
    assert.equal(boom.source, "template");
  });
});

describe("humanizeSafe", () => {
  it("strips AI-tell openers and keeps numbers and links", () => {
    const r = humanizeSafe("Certainly! The rate is 4.5% per https://example.com/a. It matters.", humanize, { intensity: "light" });
    assert.equal(r.applied, true);
    assert.ok(!r.text.startsWith("Certainly"));
    assert.ok(r.text.includes("4.5%") && r.text.includes("https://example.com/a"));
  });

  it("leaves code, lists and tables alone", () => {
    for (const t of ["Certainly!\n```js\nx=1\n```", "Certainly!\n- a\n- b", "Certainly! | a | b |"]) {
      assert.deepEqual(humanizeSafe(t, humanize, { intensity: "light" }), { text: t, applied: false });
    }
  });

  it("reverts when a number would be lost", () => {
    const r = humanizeSafe("The value is 42.", () => ({ text: "The value is big." }));
    assert.deepEqual(r, { text: "The value is 42.", applied: false });
  });
});

describe("personality signals", () => {
  it("are bounded 0..1 and read casual, questioning replies", () => {
    const s = personalitySignalsFromReply("Nah, that ain't it bro. What you tryna build?");
    for (const v of Object.values(s)) assert.ok(v >= 0 && v <= 1);
    assert.equal(s.disagreement_expressed, 0.8);
    assert.ok(s.questions_asked > 0);
    assert.ok(s.formality_level < 0.3);
  });
});

describe("chat_agent.do voice block", () => {
  it("puts the voice block before the route hint in extraSystemBlock", async () => {
    let handler = null;
    registerChatAgentMacros((d, n, fn) => { if (d === "chat_agent" && n === "do") handler = fn; });
    assert.ok(handler);
    // runAgentLoop needs a db; a missing actor returns early, so assert via a stubbed brain instead.
    const { runAgentLoop } = await import("../lib/chat-agent.js");
    const captured = [];
    const brainChat = async ({ messages }) => { captured.push(messages); return { ok: true, text: "done", provider: "t", model: "t" }; };
    const voice = compactVoiceBlock("street");
    const hint = "This request needs live web information: call web_search first and answer only from its results.";
    await runAgentLoop({ db: null, userId: "u1", message: "hi", history: [], opts: { maxTurns: 1, brainChat, extraSystemBlock: `\n\n${voice}\n\n${hint}` } });
    const sys = captured[0].find((m) => m.role === "system").content;
    assert.ok(sys.indexOf(voice) > -1 && sys.indexOf(hint) > sys.indexOf(voice));
    assert.ok(sys.includes("Facts, numbers, links and DTU names come only from tool results"));
  });

  it("the macro composes voiceBlock then routeHint, and is unchanged with a hint alone", async () => {
    const { agentExtraSystemBlock } = await import("../domains/chat-agent.js");
    assert.equal(agentExtraSystemBlock({ voiceBlock: "V", routeHint: "H" }), "\n\nV\n\nH");
    assert.equal(agentExtraSystemBlock({ routeHint: "H" }), "\n\nH");
    assert.equal(agentExtraSystemBlock({}), "");
    assert.equal(agentExtraSystemBlock({ routeHint: "x".repeat(900) }).length, 602);
  });
});

it("humanizeSafe keeps paragraphs and never makes a case-only change", () => {
  const fake = (t) => ({ text: t.replace(/^Great question[.!]\s*/i, "").replace(/^./, (c) => c.toUpperCase()) });
  const kept = humanizeSafe("mocked-brain-reply", fake, {});
  assert.equal(kept.text, "mocked-brain-reply");
  const two = humanizeSafe("Great question. first para\n\nsecond para", fake, {});
  assert.equal(two.text, "First para\n\nsecond para");
});
