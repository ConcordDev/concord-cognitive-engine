/**
 * When the conscious brain answers HTTP 503 `upstream_circuit_open`, chat.respond
 * must not invent a reply. The signed-in path (llm on by default) returns
 * ok:false, code:"ai_unavailable", llmUsed:false, and the short notice — never
 * the old "Based on what I know…" dressing of retrieved notes.
 *
 * One it() on purpose: this boots server.js through the depth harness, and a
 * second chat.respond in a sibling test races that harness's teardown.
 *
 * Run: node --test tests/chat-ai-unavailable.test.js
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { macroRuntime } from "./depth/_harness.js";
import { AI_UNAVAILABLE_CODE, AI_UNAVAILABLE_NOTICE } from "../lib/chat-offline-reply.js";

describe("chat.respond when the brain returns 503 circuit-open", () => {
  it("returns ai_unavailable and does not fabricate a reply", async () => {
    const { runMacro, STATE, ctx } = await macroRuntime("chat-ai-unavailable");
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, opts) => {
      const u = typeof url === "string" ? url : (url && url.url) || String(url);
      if (String(u).includes("/api/chat")) {
        return new Response(JSON.stringify({ error: "upstream_circuit_open" }), {
          status: 503,
          headers: { "content-type": "application/json" },
        });
      }
      return originalFetch(url, opts);
    };

    const sessionId = `sess-ai-down-${ctx.actor.userId}`;
    const message = "Reply with just the word OK.";
    try {
      const result = await runMacro("chat", "respond", {
        sessionId,
        message,
        brainOverride: "conscious",
      }, ctx);

      assert.equal(result.ok, false);
      assert.equal(result.code, AI_UNAVAILABLE_CODE);
      assert.equal(result.llmUsed, false);
      assert.equal(result.reply, AI_UNAVAILABLE_NOTICE);
      assert.equal(result.notice, AI_UNAVAILABLE_NOTICE);
      assert.equal(result.providerError, "upstream_circuit_open");
      assert.doesNotMatch(String(result.reply), /Based on what I know/);
      assert.doesNotMatch(String(result.reply), /I'd love to help/);
      assert.doesNotMatch(String(result.reply), /Stored notes/);
      assert.equal(String(result.reply).includes(message), false);
      if (result.retrieval) {
        assert.equal(result.retrieval.kind, "stored_notes");
        assert.equal(result.retrieval.label, "Stored notes");
        assert.ok(Array.isArray(result.retrieval.items) && result.retrieval.items.length > 0);
        for (const item of result.retrieval.items) {
          assert.equal(String(result.reply).includes(item), false);
        }
      }

      const sess = STATE.sessions.get(sessionId);
      assert.ok(sess, "the user turn is kept on the session");
      assert.ok(sess.messages.some((m) => m.role === "user" && m.content === message), "the user message was saved");
      const assistant = [...sess.messages].reverse().find((m) => m.role === "assistant");
      assert.equal(assistant?.content, AI_UNAVAILABLE_NOTICE);
      assert.equal(assistant?.meta?.code, AI_UNAVAILABLE_CODE);
      assert.equal(assistant?.meta?.llmUsed, false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
