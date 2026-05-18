// server/tests/chat-ai.test.js
//
// Tier-2 contract tests for Sprint B: artifacts/Canvas, Deep Research,
// tool-call audit, structured output, auto-extract memory, reasoning
// trace extraction.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import registerChatExtrasMacros from "../domains/chat-extras.js";
import registerChatAiMacros from "../domains/chat-ai.js";
import {
  createArtifact, getArtifact, updateArtifactBody, listVersions, revertArtifact,
  recordToolCall, listToolCalls,
} from "../lib/chat/artifacts.js";
import {
  composeDeterministicPlan, startRun, getRun, updateRun,
} from "../lib/chat/research.js";

const MACROS = new Map();
function register(_d, n, h) { MACROS.set(n, h); }
let db;

before(async () => {
  db = new Database(":memory:");
  for (const m of ["223_chat_extras", "224_chat_ai_surface"]) {
    const x = await import(`../migrations/${m}.js`);
    x.up(db);
  }
  registerChatExtrasMacros(register);
  registerChatAiMacros(register);
});
after(() => { try { db.close(); } catch { /* ok */ } });

function ctx(userId = "u_ai", llm = null) { return { db, actor: { userId }, llm }; }

// ─── Artifacts ────────────────────────────────────────────────────

describe("artifacts: create + version + revert", () => {
  it("createArtifact persists body + seeds v1", () => {
    const r = createArtifact(db, { ownerId: "u_a1", sessionId: "sess_a", kind: "code", title: "Hello", body: "console.log('hi')", authorKind: "llm" });
    assert.equal(r.ok, true);
    const a = getArtifact(db, r.id);
    assert.equal(a.body, "console.log('hi')");
    assert.equal(a.current_version, 1);
  });

  it("updateArtifactBody bumps current_version + appends to versions", () => {
    const r = createArtifact(db, { ownerId: "u_a2", sessionId: "sess_v", kind: "code", body: "v1", authorKind: "llm" });
    updateArtifactBody(db, r.id, { body: "v2", author: "u_a2", authorKind: "user" });
    updateArtifactBody(db, r.id, { body: "v3", author: "u_a2", authorKind: "user" });
    const a = getArtifact(db, r.id);
    assert.equal(a.body, "v3");
    assert.equal(a.current_version, 3);
    const vs = listVersions(db, r.id);
    assert.equal(vs.length, 3);
    assert.equal(vs[0].version, 3);
  });

  it("revertArtifact moves body back + bumps version", () => {
    const r = createArtifact(db, { ownerId: "u_a3", sessionId: "sess_r", kind: "code", body: "orig", authorKind: "llm" });
    updateArtifactBody(db, r.id, { body: "edited", author: "u_a3" });
    const rev = revertArtifact(db, r.id, 1, "u_a3");
    assert.equal(rev.ok, true);
    const a = getArtifact(db, r.id);
    assert.equal(a.body, "orig");
    assert.equal(a.current_version, 3); // 1 → 2 (edit) → 3 (revert to v1)
  });

  it("invalid kind rejected", () => {
    const r = createArtifact(db, { ownerId: "u", sessionId: "s", kind: "exotic", body: "x" });
    assert.equal(r.ok, false); assert.equal(r.reason, "invalid_kind");
  });
});

// ─── Tool call audit ─────────────────────────────────────────────

describe("tool calls: record + list by message", () => {
  it("recordToolCall + listToolCalls returns tool name + args + result", () => {
    recordToolCall(db, {
      sessionId: "sess_t", messageIdx: 3, tool: "web_search",
      args: { q: "concord" }, result: { hits: 5 }, latencyMs: 250, brainSlot: "utility",
    });
    const list = listToolCalls(db, "sess_t");
    assert.equal(list.length, 1);
    assert.equal(list[0].tool, "web_search");
    const args = JSON.parse(list[0].args_json);
    assert.equal(args.q, "concord");
  });

  it("filter by messageIdx", () => {
    recordToolCall(db, { sessionId: "sess_f", messageIdx: 1, tool: "create_dtu" });
    recordToolCall(db, { sessionId: "sess_f", messageIdx: 2, tool: "web_search" });
    const m2 = listToolCalls(db, "sess_f", { messageIdx: 2 });
    assert.equal(m2.length, 1);
    assert.equal(m2[0].tool, "web_search");
  });
});

// ─── Deep Research ───────────────────────────────────────────────

describe("research: plan + run lifecycle", () => {
  it("composeDeterministicPlan produces 4 steps", () => {
    const p = composeDeterministicPlan("what is concord?");
    assert.equal(p.length, 4);
    assert.equal(p[0].step, 1);
  });

  it("startRun + getRun round-trips with deterministic plan", () => {
    const r = startRun(db, { sessionId: "sess_r", userId: "u_r", query: "explain RAG" });
    assert.equal(r.ok, true);
    const got = getRun(db, r.id);
    assert.equal(got.status, "planning");
    assert.equal(got.plan.length, 4);
  });

  it("updateRun transitions to complete + stamps completed_at", () => {
    const r = startRun(db, { sessionId: "sess_r2", userId: "u_r2", query: "x" });
    updateRun(db, r.id, { status: "complete", reportMd: "# Done\n\nAll set." });
    const got = getRun(db, r.id);
    assert.equal(got.status, "complete");
    assert.ok(got.completed_at != null);
    assert.ok(got.report_md.includes("Done"));
  });
});

// ─── Macros: artifacts ──────────────────────────────────────────

describe("artifact macros end-to-end", () => {
  it("artifact_create + artifact_get returns body + versions", async () => {
    const c = await MACROS.get("artifact_create")(ctx("u_m1"), {
      sessionId: "sess_m", kind: "markdown", title: "Notes", body: "# Title", authorKind: "user",
    });
    const g = await MACROS.get("artifact_get")(ctx("u_m1"), { id: c.id });
    assert.equal(g.artifact.body, "# Title");
    assert.equal(g.versions.length, 1);
  });

  it("artifact_update + revert via macros", async () => {
    const c = await MACROS.get("artifact_create")(ctx("u_m2"), {
      sessionId: "sess_mr", kind: "code", body: "v1",
    });
    await MACROS.get("artifact_update")(ctx("u_m2"), { id: c.id, body: "v2" });
    await MACROS.get("artifact_revert")(ctx("u_m2"), { id: c.id, toVersion: 1 });
    const g = await MACROS.get("artifact_get")(ctx("u_m2"), { id: c.id });
    assert.equal(g.artifact.body, "v1");
  });

  it("artifact_get forbidden cross-user when private", async () => {
    const c = await MACROS.get("artifact_create")(ctx("u_owner"), { sessionId: "sess_p", kind: "code", body: "secret" });
    const r = await MACROS.get("artifact_get")(ctx("u_thief"), { id: c.id });
    assert.equal(r.ok, false); assert.equal(r.reason, "forbidden");
  });
});

// ─── Macros: research ────────────────────────────────────────────

describe("research macros end-to-end", () => {
  it("research_start with no LLM falls back to deterministic plan", async () => {
    const r = await MACROS.get("research_start")(ctx("u_rs"), { sessionId: "sess_rs", query: "deep dive into MCP" });
    assert.equal(r.ok, true);
    assert.equal(r.plan.length, 4);
    const got = await MACROS.get("research_get")(ctx("u_rs"), { id: r.id });
    assert.equal(got.run.status, "planning");
  });

  it("research_start with LLM uses LLM plan", async () => {
    const llm = { chat: async () => ({ content: '[{"step":1,"action":"Define scope","expected":"sub-questions"},{"step":2,"action":"Pull sources","expected":"3 sources"}]' }) };
    const r = await MACROS.get("research_start")({ db, actor: { userId: "u_llm" }, llm }, { sessionId: "sess_rl", query: "x" });
    assert.equal(r.ok, true);
    assert.equal(r.plan.length, 2);
    const got = await MACROS.get("research_get")({ db, actor: { userId: "u_llm" } }, { id: r.id });
    assert.equal(got.run.source, "llm");
  });
});

// ─── Macros: structured output ──────────────────────────────────

describe("ai_structured", () => {
  it("requires llm + prompt", async () => {
    const r1 = await MACROS.get("ai_structured")(ctx("u_s1"), {});
    assert.equal(r1.reason, "prompt_required");
    const r2 = await MACROS.get("ai_structured")(ctx("u_s2"), { prompt: "x" });
    assert.equal(r2.reason, "llm_unavailable");
  });

  it("parses valid JSON output from LLM", async () => {
    const llm = { chat: async () => ({ content: '{"summary":"ok","tags":["a","b"]}' }) };
    const r = await MACROS.get("ai_structured")({ db, actor: { userId: "u_sj" }, llm }, {
      prompt: "summarize", schemaHint: '{ summary: string, tags: string[] }',
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.summary, "ok");
    assert.deepEqual(r.result.tags, ["a","b"]);
  });

  it("returns parse_failed when LLM emits garbage", async () => {
    const llm = { chat: async () => ({ content: "not json at all" }) };
    const r = await MACROS.get("ai_structured")({ db, actor: { userId: "u_sg" }, llm }, { prompt: "x" });
    assert.equal(r.ok, false); assert.equal(r.reason, "parse_failed");
  });
});

// ─── Macros: extract memory ─────────────────────────────────────

describe("ai_extract_memory", () => {
  it("fallback extracts 'I prefer/like/use' lines as facts", async () => {
    const transcript = "I prefer concise replies.\nWhat's the weather?\nI use TypeScript daily.\nI live in Berlin.";
    const r = await MACROS.get("ai_extract_memory")(ctx("u_em"), { sessionId: "sess_em", transcript });
    assert.equal(r.source, "fallback");
    assert.ok(r.saved.length >= 2);
  });

  it("LLM path parses + persists JSON array of facts", async () => {
    const llm = { chat: async () => ({ content: '[{"fact":"works on concord","kind":"context","confidence":0.9},{"fact":"prefers brevity","kind":"preference","confidence":0.85}]' }) };
    const r = await MACROS.get("ai_extract_memory")({ db, actor: { userId: "u_emllm" }, llm }, {
      sessionId: "sess_emllm", transcript: "long transcript",
    });
    assert.equal(r.source, "llm");
    assert.equal(r.count, 2);
  });

  it("requires transcript", async () => {
    const r = await MACROS.get("ai_extract_memory")(ctx("u_x"), {});
    assert.equal(r.ok, false); assert.equal(r.reason, "transcript_required");
  });
});

// ─── Macros: reasoning trace ────────────────────────────────────

describe("ai_reasoning_trace", () => {
  it("extracts <thinking> block when present", async () => {
    const r = await MACROS.get("ai_reasoning_trace")({}, { raw: "<thinking>First I need to consider...</thinking>Here's the answer." });
    assert.equal(r.hasReasoning, true);
    assert.equal(r.trace, "First I need to consider...");
  });

  it("returns hasReasoning=false when no thinking block", async () => {
    const r = await MACROS.get("ai_reasoning_trace")({}, { raw: "just the answer" });
    assert.equal(r.hasReasoning, false);
  });
});
