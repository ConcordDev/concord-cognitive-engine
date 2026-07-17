// Wires real LLM inference metering to the central ctx.llm.chat() chokepoint.
//
// Context: `recordInferenceSpan` (lib/inference-metering.js) and the
// ops-telemetry dashboard (`aggregateInferenceCosts`) existed already, but
// almost nothing called the writer — nearly all real chat traffic flows
// through `makeCtx(req).llm.chat()` (server.js, default + BYO branches) and
// a second standalone builder inside the `chat:message` socket handler.
// This file proves the makeCtx builder now records a REAL span (real
// Ollama-reported token counts, never a fabricated chars/4 estimate) on
// every real completion attempt, and that a metering failure can never
// break the chat reply itself.
//
// Note on brain URL config: brain-config.js's getActiveBrainConfig() is
// computed ONCE from env vars at server.js import time (BRAIN_CONFIG is a
// module-level const); pickBrainEndpoint("conscious") always prefers that
// cached candidate over anything mutated on BRAIN.conscious.url after boot.
// So this file points BRAIN_CONSCIOUS_URL at one fake server BEFORE
// importing server.js, then varies that single server's *response* per
// test (mirrors tests/brain-endpoint-wiring.test.js's pre-import env
// convention) rather than trying to swap URLs post-boot.
//
// Run: node --test server/tests/inference-metering-chat-wiring.test.js

import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { registerServerCleanExit } from "./lib/server-clean-exit.js";

// Mutable behavior — the handler reads `currentBehavior()` fresh on every
// request, so tests can change the fake Ollama's response without moving
// the server (which would require a re-import of server.js to pick up).
let currentBehavior = () => ({ status: 200, body: { message: { content: "unset" } } });

function makeFakeOllamaServer() {
  const hits = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      let parsed = {};
      try { parsed = JSON.parse(body || "{}"); } catch { /* ignore */ }
      if (req.method === "POST" && req.url === "/api/chat") hits.push(parsed);
      const result = currentBehavior(parsed);
      if (result.destroy) {
        // Simulate a real network failure (connection reset mid-request) —
        // no HTTP response at all, so the client fetch() rejects.
        req.socket.destroy();
        return;
      }
      res.writeHead(result.status || 200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result.body ?? {}));
    });
  });
  return { server, hits, url: null };
}

function listen(fake) {
  return new Promise((resolve, reject) => {
    fake.server.listen(0, "127.0.0.1", (err) => {
      if (err) return reject(err);
      const { port } = fake.server.address();
      fake.url = `http://127.0.0.1:${port}`;
      resolve(fake);
    });
  });
}

let T;
let fake;

before(async () => {
  process.env.NODE_ENV = process.env.NODE_ENV || "test";
  process.env.CONCORD_NO_LISTEN = process.env.CONCORD_NO_LISTEN || "true";
  if (!process.env.STATE_PATH) {
    process.env.STATE_PATH = path.join(os.tmpdir(), `concord-inference-metering-wiring-state-${process.pid}-${Date.now()}.json`);
  }
  // Isolate DB_PATH — a real (file-backed) sqlite db of its own, so
  // migration 058's inference_spans table applies cleanly and this file
  // never shares state with another test's DB.
  if (!process.env.DB_PATH) {
    process.env.DB_PATH = path.join(os.tmpdir(), `concord-inference-metering-wiring-${process.pid}-${Date.now()}.db`);
  }

  fake = makeFakeOllamaServer();
  await listen(fake);

  // Must be set BEFORE importing server.js — brain-config.js reads env
  // vars into a module-level const at import time (see note above).
  delete process.env.BRAIN_CONSCIOUS_URLS;
  process.env.BRAIN_CONSCIOUS_URL = fake.url;

  T = (await import("../server.js")).__TEST__;
  assert.ok(T?.makeCtx, "server.js __TEST__ must expose makeCtx");
  assert.ok(T?.STATE?.db, "server boot must produce a real db handle at STATE.db for this test's isolated DB_PATH");
  assert.equal(T.BRAIN.conscious.url, fake.url, "sanity: BRAIN.conscious.url resolved to the fake server set pre-import");
});

after(async () => {
  await new Promise((resolve) => fake.server.close(() => resolve()));
});

registerServerCleanExit(() => T);

function latestSpan(db) {
  return db.prepare(`SELECT * FROM inference_spans ORDER BY id DESC LIMIT 1`).get();
}

function countSpans(db) {
  return db.prepare(`SELECT COUNT(*) AS n FROM inference_spans`).get().n;
}

describe("ctx.llm.chat() default branch records a REAL inference span", () => {
  beforeEach(() => {
    T.BRAIN.conscious.enabled = true;
  });

  it("success: the span carries Ollama's own prompt_eval_count/eval_count, not an estimate", async () => {
    currentBehavior = () => ({
      status: 200,
      body: { message: { content: "a real completion" }, prompt_eval_count: 37, eval_count: 11, done: true },
    });
    const before = countSpans(T.STATE.db);

    const ctx = T.makeCtx(null);
    const result = await ctx.llm.chat({
      messages: [{ role: "user", content: "hello" }],
      maxTokens: 16,
      timeoutMs: 5000,
    });

    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.content, "a real completion");

    assert.equal(countSpans(T.STATE.db), before + 1, "exactly one span written for one real completion");
    const span = latestSpan(T.STATE.db);
    assert.equal(span.brain_used, "conscious");
    // The fake server's own reported usage — proves we plumbed the REAL
    // field (prompt_eval_count/eval_count), not a derived/estimated value.
    assert.equal(span.tokens_in, 37);
    assert.equal(span.tokens_out, 11);
    assert.equal(span.error, null);
    assert.ok(span.latency_ms >= 0);
  });

  it("provider HTTP error: records an honest error span with NO fabricated token count, and chat degrades instead of throwing", async () => {
    currentBehavior = () => ({ status: 500, body: { error: "model_overloaded" } });
    const before = countSpans(T.STATE.db);

    const ctx = T.makeCtx(null);
    const result = await ctx.llm.chat({
      messages: [{ role: "user", content: "hello" }],
      maxTokens: 16,
      timeoutMs: 5000,
    });

    assert.equal(result.ok, false, "a provider error must degrade honestly, not throw or fake a reply");
    assert.equal(countSpans(T.STATE.db), before + 1, "the failed real attempt is still recorded (for the failure-rate signal)");
    const span = latestSpan(T.STATE.db);
    assert.equal(span.brain_used, "conscious");
    assert.ok(span.error, "error field must be set — this is what makes it an honest failure record, not a silent fabricated success");
    // No usage was ever returned by the provider — the span must NOT invent
    // a token count (e.g. chars/4 of the prompt). It stays at the schema's
    // honest zero-default.
    assert.equal(span.tokens_in, 0);
    assert.equal(span.tokens_out, 0);
  });

  it("malformed 200 (no message.content): still an honest error span, never a fabricated success", async () => {
    currentBehavior = () => ({ status: 200, body: { done: true } }); // no message.content
    const before = countSpans(T.STATE.db);

    const ctx = T.makeCtx(null);
    const result = await ctx.llm.chat({
      messages: [{ role: "user", content: "hello" }],
      maxTokens: 16,
      timeoutMs: 5000,
    });

    assert.equal(result.ok, false);
    assert.equal(countSpans(T.STATE.db), before + 1);
    const span = latestSpan(T.STATE.db);
    assert.ok(span.error);
    assert.equal(span.tokens_in, 0);
    assert.equal(span.tokens_out, 0);
  });

  it("network exception (connection reset mid-request): chat degrades gracefully AND records an error span", async () => {
    currentBehavior = () => ({ destroy: true });
    const before = countSpans(T.STATE.db);

    const ctx = T.makeCtx(null);
    const result = await ctx.llm.chat({
      messages: [{ role: "user", content: "hello" }],
      maxTokens: 16,
      timeoutMs: 5000,
    });

    assert.equal(result.ok, false);
    assert.equal(countSpans(T.STATE.db), before + 1);
    const span = latestSpan(T.STATE.db);
    assert.ok(span.error);
    assert.equal(span.tokens_in, 0);
    assert.equal(span.tokens_out, 0);
  });
});

describe("metering can never break the chat reply", () => {
  it("a broken inference_spans table does not prevent a real completion from succeeding", async () => {
    T.BRAIN.conscious.enabled = true;
    currentBehavior = () => ({
      status: 200,
      body: { message: { content: "a real completion" }, prompt_eval_count: 5, eval_count: 5, done: true },
    });

    // Sabotage the metering sink: drop the table recordInferenceSpan writes
    // to. recordInferenceSpan() itself catches this (returns {ok:false});
    // the ctx.llm.chat() call sites additionally wrap the call in
    // _meterLlmChat's own try/catch. Either layer alone should be enough —
    // this proves the outcome, not the mechanism.
    T.STATE.db.exec(`DROP TABLE inference_spans`);

    const ctx = T.makeCtx(null);
    const result = await ctx.llm.chat({
      messages: [{ role: "user", content: "hello" }],
      maxTokens: 16,
      timeoutMs: 5000,
    });

    assert.equal(result.ok, true, "chat must succeed even though the metering sink is broken");
    assert.equal(result.content, "a real completion");

    // Restore the table so later tests in this file (if any run after) and
    // other describe blocks aren't affected.
    const { up } = await import("../migrations/058_agent_threads.js");
    // up() creates agent_threads/agent_thread_checkpoints/inference_spans;
    // IF NOT EXISTS guards make this idempotent against the tables that
    // survived the DROP.
    up(T.STATE.db);
  });
});
