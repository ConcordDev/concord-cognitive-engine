// server/domains/chat-ai.js
//
// Chat lens Sprint B — Canvas/Artifacts + Deep Research + tool-call
// audit log + structured-output mode + auto-extract memory from
// finished conversations.

import {
  createArtifact, getArtifact, listArtifactsForSession, updateArtifactBody,
  listVersions, revertArtifact, deleteArtifact,
  recordToolCall, listToolCalls,
} from "../lib/chat/artifacts.js";
import {
  composeDeterministicPlan, startRun, getRun, listRunsForSession, updateRun,
} from "../lib/chat/research.js";
import { saveMemory } from "../lib/chat/persistence.js";

function _resolveDb(ctx) { return ctx?.db || ctx?.STATE?.db || globalThis._concordSTATE?.db || null; }
function _actor(ctx) { return ctx?.actor?.userId || ctx?.userId || null; }
function _now() { return Math.floor(Date.now() / 1000); }

const TIMEOUT_MS = 18_000;
function _withTimeout(p, ms = TIMEOUT_MS) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`timeout_${ms}ms`)), ms))]);
}
function _stripFences(s) {
  const m = String(s || "").match(/```(?:\w+)?\n([\s\S]*?)```/);
  return m ? m[1] : s;
}
function _extractJson(raw, isArray = false) {
  const stripped = _stripFences(raw).trim();
  try { const v = JSON.parse(stripped); if (isArray ? Array.isArray(v) : (v && typeof v === "object")) return v; } catch { /* try */ }
  const re = isArray ? /\[[\s\S]*\]/ : /\{[\s\S]*\}/;
  const m = stripped.match(re);
  if (m) { try { return JSON.parse(m[0]); } catch { return null; } }
  return null;
}

export default function registerChatAiMacros(register) {

  // ─── Artifacts (Canvas/Artifacts parity) ────────────────────────

  register("chat", "artifact_create", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    return createArtifact(db, {
      ownerId: userId,
      sessionId: input.sessionId,
      messageIdx: input.messageIdx,
      kind: input.kind,
      title: input.title,
      language: input.language,
      body: input.body,
      authorKind: input.authorKind || "user",
      note: input.note,
    });
  }, { destructive: true, note: "Create a Canvas/Artifact (code/html/svg/markdown/mermaid/react/json/csv/sql/prompt)" });

  register("chat", "artifact_get", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const a = getArtifact(db, String(input.id || ""));
    if (!a) return { ok: false, reason: "not_found" };
    if (a.owner_id !== userId && a.visibility === "private") return { ok: false, reason: "forbidden" };
    return { ok: true, artifact: a, versions: listVersions(db, a.id, { limit: 30 }) };
  }, { note: "Get a Canvas artifact + its version history" });

  register("chat", "artifact_list", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    return { ok: true, artifacts: listArtifactsForSession(db, String(input.sessionId || "")) };
  }, { note: "List artifacts attached to a chat session" });

  register("chat", "artifact_update", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const a = getArtifact(db, String(input.id || ""));
    if (!a) return { ok: false, reason: "not_found" };
    if (a.owner_id !== userId) return { ok: false, reason: "forbidden" };
    return updateArtifactBody(db, a.id, {
      body: input.body,
      author: input.author || userId,
      authorKind: input.authorKind || "user",
      note: input.note,
    });
  }, { destructive: true, note: "Edit an artifact (autosaves a new version)" });

  register("chat", "artifact_revert", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const a = getArtifact(db, String(input.id || ""));
    if (!a) return { ok: false, reason: "not_found" };
    if (a.owner_id !== userId) return { ok: false, reason: "forbidden" };
    return revertArtifact(db, a.id, Number(input.toVersion), userId);
  }, { destructive: true, note: "Revert an artifact to a prior version" });

  register("chat", "artifact_versions", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const a = getArtifact(db, String(input.id || ""));
    if (!a || a.owner_id !== userId) return { ok: false, reason: "forbidden" };
    return { ok: true, versions: listVersions(db, a.id, { limit: input.limit }) };
  }, { note: "List all versions of an artifact" });

  register("chat", "artifact_delete", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    return deleteArtifact(db, String(input.id || ""), userId);
  }, { destructive: true, note: "Delete an artifact (owner only)" });

  // ─── Tool-call audit (function-call logs visibility) ────────────

  register("chat", "tool_call_record", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    return recordToolCall(db, {
      sessionId: input.sessionId,
      messageIdx: input.messageIdx,
      tool: input.tool,
      args: input.args,
      result: input.result,
      success: input.success !== false,
      latencyMs: input.latencyMs,
      tokens: input.tokens,
      brainSlot: input.brainSlot,
    });
  }, { destructive: true, note: "Record a tool call from the chat orchestrator (visibility surface)" });

  register("chat", "tool_calls_list", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    return { ok: true, toolCalls: listToolCalls(db, String(input.sessionId || ""), { messageIdx: input.messageIdx, limit: input.limit }) };
  }, { note: "List tool calls for a session (optionally a specific message)" });

  // ─── Deep Research (plan-then-execute) ──────────────────────────

  register("chat", "research_start", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const sessionId = String(input.sessionId || "");
    const query = String(input.query || "").trim();
    if (!sessionId || !query) return { ok: false, reason: "sessionId_and_query_required" };
    const r = startRun(db, { sessionId, userId, query });
    if (!r.ok) return r;

    // Optional LLM-enriched plan if available
    const llm = ctx?.llm;
    if (llm?.chat) {
      try {
        const sys = `You produce a research plan as JSON: array of {step, action, expected} objects. 4-7 steps. The goal is to research the user's query thoroughly. Output ONLY JSON.`;
        const r2 = await _withTimeout(llm.chat({
          messages: [{ role: "system", content: sys }, { role: "user", content: query }],
          temperature: 0.4, maxTokens: 1000, slot: "subconscious",
        }), 12_000);
        const raw = String(r2?.text || r2?.content || r2?.message?.content || "").trim();
        const plan = _extractJson(raw, true);
        if (Array.isArray(plan) && plan.length > 0) {
          updateRun(db, r.id, { plan, source: "llm" });
        }
      } catch { /* keep deterministic */ }
    }
    return { ok: true, id: r.id, plan: getRun(db, r.id).plan };
  }, { destructive: true, note: "Start a Deep Research run (plan first; execution + report writing land in caller code)" });

  register("chat", "research_get", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const r = getRun(db, String(input.id || ""));
    if (!r) return { ok: false, reason: "not_found" };
    if (r.user_id !== userId) return { ok: false, reason: "forbidden" };
    return { ok: true, run: r };
  }, { note: "Get a Deep Research run with plan + sources + report" });

  register("chat", "research_list", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    return { ok: true, runs: listRunsForSession(db, String(input.sessionId || ""), { limit: input.limit }) };
  }, { note: "List Deep Research runs in a session" });

  register("chat", "research_update", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const r = getRun(db, String(input.id || ""));
    if (!r || r.user_id !== userId) return { ok: false, reason: "forbidden" };
    return updateRun(db, r.id, input);
  }, { destructive: true, note: "Update a Deep Research run's plan/sources/report/status" });

  // ─── Structured output ──────────────────────────────────────────

  register("chat", "ai_structured", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const llm = ctx?.llm;
    const prompt = String(input.prompt || "").trim();
    const schemaName = String(input.schemaName || "result");
    const schemaHint = input.schemaHint || "JSON object";
    if (!prompt) return { ok: false, reason: "prompt_required" };
    if (!llm?.chat) return { ok: false, reason: "llm_unavailable" };

    const sys = `You produce structured output ONLY as JSON matching this shape: ${typeof schemaHint === "string" ? schemaHint : JSON.stringify(schemaHint)}. Output ONLY JSON, no prose, no fences. The JSON's top-level key is "${schemaName}".`;
    const t0 = Date.now();
    try {
      const r = await _withTimeout(llm.chat({
        messages: [{ role: "system", content: sys }, { role: "user", content: prompt }],
        temperature: 0.2, maxTokens: input.maxTokens || 1200, slot: input.brainSlot || "utility",
      }));
      const raw = String(r?.text || r?.content || r?.message?.content || "").trim();
      const parsed = _extractJson(raw);
      if (!parsed) return { ok: false, reason: "parse_failed", raw: raw.slice(0, 400) };
      return { ok: true, result: parsed, source: "llm", latencyMs: Date.now() - t0 };
    } catch (e) {
      return { ok: false, reason: "llm_error", error: e?.message };
    }
  }, { requiresLLM: true, note: "Structured-output / JSON mode (ChatGPT JSON mode parity)" });

  // ─── Auto-extract memory from a finished session ───────────────

  register("chat", "ai_extract_memory", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const sessionId = String(input.sessionId || "");
    const transcript = String(input.transcript || "").trim();
    if (!transcript) return { ok: false, reason: "transcript_required" };
    const llm = ctx?.llm;
    const t0 = Date.now();

    if (!llm?.chat) {
      // Deterministic fallback: extract first-person "I" statements that look like preferences
      const lines = transcript.split(/\n+/).map((l) => l.trim()).filter(Boolean);
      const candidates = lines.filter((l) => /^I (prefer|like|use|am|work|live|own|need|want|hate|always|never)/i.test(l));
      const facts = candidates.slice(0, 5).map((l) => ({ fact: l, kind: "preference" }));
      const saved = [];
      for (const f of facts) {
        const r = saveMemory(db, { userId, fact: f.fact, kind: f.kind, sessionId, confidence: 0.55 });
        if (r.ok) saved.push({ id: r.id, ...f });
      }
      return { ok: true, source: "fallback", saved, count: saved.length, latencyMs: Date.now() - t0 };
    }

    const sys = `Extract 0-5 long-term facts about the user from this conversation. Output JSON array of {fact, kind, confidence (0-1)}. kind is one of: preference, identity, goal, context, constraint, fact. Only include facts that would help in FUTURE conversations — not transient info. Be concise (each fact under 80 chars). Output ONLY JSON.`;
    try {
      const r = await _withTimeout(llm.chat({
        messages: [{ role: "system", content: sys }, { role: "user", content: transcript.slice(0, 8000) }],
        temperature: 0.3, maxTokens: 500, slot: "utility",
      }), 8000);
      const raw = String(r?.text || r?.content || r?.message?.content || "").trim();
      const arr = _extractJson(raw, true);
      if (!Array.isArray(arr) || arr.length === 0) {
        return { ok: true, source: "llm", saved: [], count: 0, raw: raw.slice(0, 200) };
      }
      const saved = [];
      for (const f of arr.slice(0, 5)) {
        if (!f?.fact) continue;
        const r2 = saveMemory(db, {
          userId,
          fact: f.fact,
          kind: ["preference","identity","goal","context","constraint","fact"].includes(f.kind) ? f.kind : "preference",
          sessionId,
          confidence: Math.max(0.3, Math.min(1, Number(f.confidence) || 0.7)),
        });
        if (r2.ok) saved.push({ id: r2.id, ...f });
      }
      return { ok: true, source: "llm", saved, count: saved.length, latencyMs: Date.now() - t0 };
    } catch (e) {
      return { ok: false, reason: "llm_error", error: e?.message };
    }
  }, { destructive: true, note: "Extract long-term facts from a conversation transcript + persist as memory" });

  // ─── Reasoning visibility ───────────────────────────────────────

  register("chat", "ai_reasoning_trace", async (_ctx, input = {}) => {
    // Returns a structured reasoning trace from a raw LLM output that
    // includes <thinking>...</thinking> blocks (Claude style).
    const raw = String(input.raw || "");
    const m = raw.match(/<thinking>([\s\S]*?)<\/thinking>/);
    if (!m) return { ok: true, hasReasoning: false, trace: null };
    return { ok: true, hasReasoning: true, trace: m[1].trim() };
  }, { note: "Extract a reasoning trace from a raw LLM output (no DB)" });
}
