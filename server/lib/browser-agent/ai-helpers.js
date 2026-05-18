// server/lib/browser-agent/ai-helpers.js
//
// Shared primitives for Browser-Agent AI macros. Same shape as
// lib/docs/ai-compose.js + lib/tasks/ai-helpers.js + lib/calendar/
// ai-helpers.js — consistency across the four 2026-rebuild lenses.

const TIMEOUT_MS_DEFAULT = 18_000;

export function withTimeout(p, ms = TIMEOUT_MS_DEFAULT) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`timeout_${ms}ms`)), ms))]);
}

export function stripFences(s) {
  const m = String(s || "").match(/```(?:\w+)?\n([\s\S]*?)```/);
  return m ? m[1] : s;
}

export function extractJsonObject(raw) {
  const stripped = stripFences(raw).trim();
  try { const v = JSON.parse(stripped); if (v && typeof v === "object") return v; } catch { /* try */ }
  const m = stripped.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch { return null; } }
  return null;
}

export function extractJsonArray(raw) {
  const stripped = stripFences(raw).trim();
  try { const v = JSON.parse(stripped); if (Array.isArray(v)) return v; } catch { /* try */ }
  const m = stripped.match(/\[[\s\S]*\]/);
  if (m) { try { const v = JSON.parse(m[0]); if (Array.isArray(v)) return v; } catch { return null; } }
  return null;
}

export function recordAiRun(db, {
  taskId = null, userId, kind, prompt = null, inputText = null,
  outputText, source = "llm", tokensIn = 0, tokensOut = 0, latencyMs = null,
}) {
  if (!db || !userId || !kind) return null;
  try {
    const r = db.prepare(`
      INSERT INTO browser_task_ai_runs (task_id, user_id, kind, prompt, input_text, output_text, source, tokens_in, tokens_out, latency_ms, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch())
    `).run(taskId, userId, kind,
      prompt ? String(prompt).slice(0, 2000) : null,
      inputText ? String(inputText).slice(0, 6000) : null,
      String(outputText || "").slice(0, 16000),
      source, tokensIn || 0, tokensOut || 0, latencyMs);
    return r.lastInsertRowid;
  } catch { return null; }
}

/**
 * Deterministic plan composer. Used as the fallback when no LLM is
 * available. Produces a 3-5 step generic plan from the goal text.
 */
export function deterministicPlan(goal) {
  const g = String(goal || "").trim();
  if (!g) return null;
  return [
    { step: 1, action: "navigate", expected: "Land on starting URL", thought: "Begin the task" },
    { step: 2, action: "extract",  expected: "Capture the main content", thought: "Gather data to reason over" },
    { step: 3, action: "screenshot", expected: "Visual snapshot for the user", thought: "Provide proof + LiveView context" },
    { step: 4, action: "summarize", expected: "1-paragraph summary of what was found", thought: "Close out cleanly" },
  ];
}
