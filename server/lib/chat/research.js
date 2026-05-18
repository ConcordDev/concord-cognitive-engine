// server/lib/chat/research.js
//
// Deep Research — plan-then-execute. Produces a multi-source report
// from a query. Mirrors ChatGPT Deep Research / Perplexity Pro Search.
//
// composeDeterministicPlan produces a baseline 4-step plan when
// no LLM is available (concord runs on local Ollama; this is the
// fallback floor).

import { randomUUID } from "node:crypto";

function _now() { return Math.floor(Date.now() / 1000); }
function _safeJson(s, fb) { if (s == null) return fb; try { return JSON.parse(s); } catch { return fb; } }

export function composeDeterministicPlan(query) {
  const q = String(query || "").trim();
  if (!q) return null;
  return [
    { step: 1, action: "Identify the core question and 3-5 sub-questions", expected: "sub-question list" },
    { step: 2, action: "Search the web for primary sources on each sub-question", expected: "ranked source list with snippets" },
    { step: 3, action: "Read the top 3-5 sources for each sub-question", expected: "extracted claims with citations" },
    { step: 4, action: "Synthesize a 3-paragraph report with citation footnotes", expected: "final report.md" },
  ];
}

export function startRun(db, { sessionId, userId, query }) {
  if (!db || !sessionId || !userId || !query) return { ok: false, reason: "missing_args" };
  const id = `chresearch:${randomUUID()}`;
  const plan = composeDeterministicPlan(query);
  db.prepare(`
    INSERT INTO chat_research_runs (id, session_id, user_id, query, plan_json, status, source, created_at)
    VALUES (?, ?, ?, ?, ?, 'planning', 'deterministic', ?)
  `).run(id, sessionId, userId, String(query).slice(0, 2000), JSON.stringify(plan), _now());
  return { ok: true, id, plan };
}

export function getRun(db, id) {
  if (!db || !id) return null;
  const r = db.prepare(`SELECT * FROM chat_research_runs WHERE id = ?`).get(id);
  if (!r) return null;
  return { ...r, plan: _safeJson(r.plan_json, []), sources: _safeJson(r.sources_json, []) };
}

export function listRunsForSession(db, sessionId, { limit = 50 } = {}) {
  if (!db || !sessionId) return [];
  return db.prepare(`SELECT id, query, status, step_count, created_at, completed_at FROM chat_research_runs WHERE session_id = ? ORDER BY created_at DESC LIMIT ?`).all(sessionId, Math.min(Number(limit), 200));
}

export function updateRun(db, id, patch) {
  if (!db || !id) return { ok: false, reason: "missing_args" };
  const updates = [];
  const args = [];
  if (patch.status && ["planning","executing","complete","failed","cancelled"].includes(patch.status)) {
    updates.push("status = ?"); args.push(patch.status);
    if (patch.status === "complete" || patch.status === "failed" || patch.status === "cancelled") {
      updates.push("completed_at = ?"); args.push(_now());
    }
  }
  if (patch.plan) { updates.push("plan_json = ?"); args.push(JSON.stringify(patch.plan)); }
  if (patch.sources) { updates.push("sources_json = ?"); args.push(JSON.stringify(patch.sources)); }
  if (patch.reportMd !== undefined) { updates.push("report_md = ?"); args.push(patch.reportMd ? String(patch.reportMd).slice(0, 50_000) : null); }
  if (patch.stepCount != null) { updates.push("step_count = ?"); args.push(Number(patch.stepCount)); }
  if (patch.tokens != null) { updates.push("tokens = ?"); args.push(Number(patch.tokens)); }
  if (patch.source && ["llm","fallback","deterministic"].includes(patch.source)) { updates.push("source = ?"); args.push(patch.source); }
  if (updates.length === 0) return { ok: false, reason: "nothing_to_update" };
  args.push(id);
  db.prepare(`UPDATE chat_research_runs SET ${updates.join(", ")} WHERE id = ?`).run(...args);
  return { ok: true };
}
