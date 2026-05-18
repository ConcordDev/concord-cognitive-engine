// server/tests/messaging-ai.test.js
//
// Tier-2 contract tests for Sprint B AI macros. Stubbed ctx.llm; the
// brain-routing path is tested elsewhere.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import registerMessagingAiMacros from "../domains/messaging-ai.js";
import registerMessagingConversationsMacros from "../domains/messaging-conversations.js";

let db; const macros = new Map();

before(async () => {
  db = new Database(":memory:");
  const mig = await import("../migrations/209_messaging_substrate.js");
  mig.up(db);
  registerMessagingAiMacros((_d, n, h) => macros.set(n, h));
  registerMessagingConversationsMacros((_d, n, h) => macros.set(n, h));
});
after(() => { try { db.close(); } catch { /* ok */ } });

describe("summarize_thread", () => {
  let cid;
  before(async () => {
    const r = await macros.get("convo_create")({ db, actor: { userId: "u_a" } }, {
      kind: "channel", title: "sumcheck",
    });
    cid = r.id;
    await macros.get("convo_add_participant")({ db, actor: { userId: "u_a" } }, { conversationId: cid, userId: "u_b", role: "member" });
    await macros.get("msg_post")({ db, actor: { userId: "u_a" } }, { conversationId: cid, body: "Should we ship Friday?" });
    await macros.get("msg_post")({ db, actor: { userId: "u_b" } }, { conversationId: cid, body: "Let's verify tests first." });
  });
  it("forbids non-participant", async () => {
    const r = await macros.get("summarize_thread")({ db, actor: { userId: "u_out" } }, { conversationId: cid });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "forbidden");
  });
  it("LLM path returns structured summary", async () => {
    const ctx = {
      db, actor: { userId: "u_a" },
      llm: { chat: async () => ({ text: JSON.stringify({
        summary: "Team discussed Friday ship; decided to test first.",
        action_items: ["Run regression"], decisions: ["Ship after green tests"], themes: ["release"],
      }) }) },
    };
    const r = await macros.get("summarize_thread")(ctx, { conversationId: cid });
    assert.equal(r.ok, true);
    assert.equal(r.summary.includes("Friday"), true);
    assert.equal(r.action_items[0], "Run regression");
    assert.equal(r.decisions.length, 1);
    assert.equal(r.themes[0], "release");
    assert.equal(r.source, "llm");
  });
  it("No-LLM falls back to deterministic", async () => {
    const r = await macros.get("summarize_thread")({ db, actor: { userId: "u_a" } }, { conversationId: cid });
    assert.equal(r.ok, true);
    assert.equal(r.source, "deterministic_fallback");
  });
});

describe("suggested_replies", () => {
  let cid;
  before(async () => {
    const r = await macros.get("convo_create")({ db, actor: { userId: "u_a" } }, { kind: "channel", title: "replyz" });
    cid = r.id;
    await macros.get("convo_add_participant")({ db, actor: { userId: "u_a" } }, { conversationId: cid, userId: "u_b", role: "member" });
    await macros.get("msg_post")({ db, actor: { userId: "u_b" } }, { conversationId: cid, body: "Can you ship the report by EOD?" });
  });
  it("LLM path returns N suggestions", async () => {
    const ctx = {
      db, actor: { userId: "u_a" },
      llm: { chat: async () => ({ text: JSON.stringify(["Yes — sending now", "Need until tomorrow", "Could you share the spec?"]) }) },
    };
    const r = await macros.get("suggested_replies")(ctx, { conversationId: cid, count: 3 });
    assert.equal(r.ok, true);
    assert.equal(r.replies.length, 3);
  });
  it("No-LLM fallback returns deterministic replies", async () => {
    const r = await macros.get("suggested_replies")({ db, actor: { userId: "u_a" } }, { conversationId: cid, count: 2 });
    assert.equal(r.ok, true);
    assert.equal(r.replies.length, 2);
    assert.equal(r.source, "deterministic_fallback");
  });
});

describe("compose_in_my_voice", () => {
  let cid;
  before(async () => {
    const r = await macros.get("convo_create")({ db, actor: { userId: "u_voice" } }, { kind: "channel", title: "voicy" });
    cid = r.id;
    // Seed 5 outgoing messages from u_voice (style anchors)
    for (const body of ["Yo team", "Ship it", "lgtm 👍", "Will fix", "+1"]) {
      await macros.get("msg_post")({ db, actor: { userId: "u_voice" } }, { conversationId: cid, body });
    }
  });
  it("rejects missing prompt", async () => {
    const r = await macros.get("compose_in_my_voice")({ db, actor: { userId: "u_voice" } }, { conversationId: cid });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "prompt_required");
  });
  it("rejects no LLM", async () => {
    const r = await macros.get("compose_in_my_voice")({ db, actor: { userId: "u_voice" } }, { conversationId: cid, prompt: "x" });
    assert.equal(r.reason, "llm_unavailable");
  });
  it("LLM path returns a draft + anchorCount", async () => {
    const ctx = {
      db, actor: { userId: "u_voice" },
      llm: { chat: async () => ({ text: "yo, shipping in 5" }) },
    };
    const r = await macros.get("compose_in_my_voice")(ctx, { conversationId: cid, prompt: "tell them I'm done in 5 min" });
    assert.equal(r.ok, true);
    assert.equal(r.draft, "yo, shipping in 5");
    assert.equal(r.anchorCount, 5);
  });
});

describe("triage_inbox", () => {
  let cid;
  before(async () => {
    const r = await macros.get("convo_create")({ db, actor: { userId: "u_caller" } }, { kind: "channel", title: "tri" });
    cid = r.id;
    await macros.get("convo_add_participant")({ db, actor: { userId: "u_caller" } }, { conversationId: cid, userId: "u_sender", role: "member" });
    await macros.get("msg_post")({ db, actor: { userId: "u_sender" } }, { conversationId: cid, body: "URGENT: production is down" });
    await macros.get("msg_post")({ db, actor: { userId: "u_sender" } }, { conversationId: cid, body: "Unsubscribe at any time" });
    await macros.get("msg_post")({ db, actor: { userId: "u_sender" } }, { conversationId: cid, body: "thx" });
  });
  it("heuristic correctly classifies obvious cases", async () => {
    const r = await macros.get("triage_inbox")({ db, actor: { userId: "u_caller" } }, {});
    assert.equal(r.ok, true);
    assert.ok(r.buckets.priority.some((m) => m.body_preview.includes("URGENT")));
    assert.ok(r.buckets.newsletter.some((m) => m.body_preview.includes("Unsubscribe")));
    assert.ok(r.buckets.low.some((m) => m.body_preview === "thx"));
  });
});

describe("translate", () => {
  let cid; let mid;
  before(async () => {
    const r = await macros.get("convo_create")({ db, actor: { userId: "u_a" } }, { kind: "channel", title: "trans" });
    cid = r.id;
    const m = await macros.get("msg_post")({ db, actor: { userId: "u_a" } }, { conversationId: cid, body: "Hello world" });
    mid = m.id;
  });
  it("rejects invalid lang code", async () => {
    const r = await macros.get("translate")({ db, actor: { userId: "u_a" }, llm: { chat: async () => ({ text: "x" }) } }, { messageId: mid, targetLang: "english" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "invalid_lang_code");
  });
  it("LLM path returns translated text + caches", async () => {
    let calls = 0;
    const ctx = {
      db, actor: { userId: "u_a" },
      llm: { chat: async () => { calls++; return { text: "Hola mundo" }; } },
    };
    const r1 = await macros.get("translate")(ctx, { messageId: mid, targetLang: "es" });
    assert.equal(r1.translated, "Hola mundo");
    assert.equal(r1.source, "llm");
    const r2 = await macros.get("translate")(ctx, { messageId: mid, targetLang: "es" });
    assert.equal(r2.translated, "Hola mundo");
    assert.equal(r2.source, "cache");
    assert.equal(calls, 1);
  });
});
