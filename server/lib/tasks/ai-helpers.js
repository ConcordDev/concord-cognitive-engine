// server/lib/tasks/ai-helpers.js
//
// Shared primitives for the Tasks AI macros: timeouts, JSON
// extractors, run-ledger writer. Mirrors lib/docs/ai-compose.js so
// the patterns stay consistent across lenses.

const TIMEOUT_MS_DEFAULT = 18_000;

export function withTimeout(p, ms = TIMEOUT_MS_DEFAULT) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`timeout_${ms}ms`)), ms))]);
}

export function stripFences(s) {
  const m = String(s || "").match(/```(?:\w+)?\n([\s\S]*?)```/);
  return m ? m[1] : s;
}

export function extractJsonArray(raw) {
  const stripped = stripFences(raw).trim();
  try { const v = JSON.parse(stripped); if (Array.isArray(v)) return v; } catch { /* try */ }
  const m = stripped.match(/\[[\s\S]*\]/);
  if (m) { try { const v = JSON.parse(m[0]); if (Array.isArray(v)) return v; } catch { return null; } }
  return null;
}

export function extractJsonObject(raw) {
  const stripped = stripFences(raw).trim();
  try { const v = JSON.parse(stripped); if (v && typeof v === "object") return v; } catch { /* try */ }
  const m = stripped.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch { return null; } }
  return null;
}

export function recordAiRun(db, {
  taskId = null, projectId = null, userId, kind, prompt = null,
  inputText = null, outputText, source = "llm", latencyMs = null,
}) {
  if (!db || !userId || !kind) return null;
  try {
    const r = db.prepare(`
      INSERT INTO task_ai_runs
        (task_id, project_id, user_id, kind, prompt, input_text, output_text, source, latency_ms, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch())
    `).run(taskId, projectId, userId, kind,
      prompt ? String(prompt).slice(0, 2000) : null,
      inputText ? String(inputText).slice(0, 6000) : null,
      String(outputText || "").slice(0, 16000),
      source, latencyMs);
    return r.lastInsertRowid;
  } catch { return null; }
}

// Heuristic priority signal — used as deterministic fallback for ai_prioritize
// when the LLM is unavailable. Boosts urgent labels, due-soon, blockers.
export function heuristicPriorityScore(task, now = Math.floor(Date.now() / 1000)) {
  let score = 50;
  const pri = task.priority || "medium";
  score += ({ urgent: 40, high: 25, medium: 0, low: -15, none: -25 })[pri] || 0;
  if (task.due_at) {
    const daysUntilDue = (task.due_at - now) / 86400;
    if (daysUntilDue < 0) score += 30;             // overdue
    else if (daysUntilDue < 2) score += 20;
    else if (daysUntilDue < 7) score += 10;
  }
  const labels = task.labels || [];
  if (labels.includes("urgent") || labels.includes("bug")) score += 12;
  if (labels.includes("blocker")) score += 18;
  if (task.type === "bug") score += 8;
  if (task.type === "spike") score -= 6;
  return Math.max(0, Math.min(100, score));
}

// Strip HTML to plain-text context for LLM prompts.
export function plainText(html, maxChars = 3000) {
  const t = String(html || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
  return t.length > maxChars ? t.slice(0, maxChars) + "…" : t;
}
