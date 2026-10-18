// server/lib/long-task.js
//
// Long tasks: Chat / ConKay hand a multi-step job to a marathon session
// (lib/agent-marathon.js) instead of trying to finish it inside one 5-turn
// reply. A long task is an ordinary marathon row whose meta_json carries
// { longTask: 1, mode, origin }. The marathon heartbeat
// (emergent/agent-marathon-cycle.js) advances it in the background; when it
// reaches a terminal status, deliverLongTaskResult posts the result back to
// the conversation it came from: written into the Chat session it started in,
// or queued for ConKay's next reply (ConKay keeps its history client-side).
//
// Budgets: every long task gets a real budget_cap (tool calls) and max_turns,
// and a user may have at most LONG_TASK_DEFAULTS.maxActivePerUser running.

import { startMarathon, getMarathon } from "./agent-marathon.js";

export const LONG_TASK_DEFAULTS = Object.freeze({
  maxTurns: Number(process.env.CONCORD_LONG_TASK_MAX_TURNS) || 40,
  budgetCap: Number(process.env.CONCORD_LONG_TASK_BUDGET) || 80,
  maxActivePerUser: Number(process.env.CONCORD_LONG_TASK_MAX_ACTIVE) || 3,
  tickTurns: 3,
  tickIntervalS: 30,
});

export const LONG_TASK_MODES = Object.freeze(["research", "plan", "code", "general"]);

const COMPLETE_RE = /\[TASK_COMPLETE\]/gi;
const BLOCKED_RE = /\[TASK_BLOCKED:\s*([^\]]*)\]/i;

/** Best guess at the kind of job from the user's words. */
export function inferLongTaskMode(text) {
  const p = String(text || "").toLowerCase();
  if (/\b(?:research|report|sources?|citations?|compare|comparison|survey|look into|find (?:the )?best|literature|review of)\b/.test(p)) return "research";
  if (/\b(?:plan|schedule|roadmap|milestones?|timeline|week[- ]by[- ]week|day[- ]by[- ]day)\b/.test(p)) return "plan";
  if (/\b(?:code|script|program|implement|refactor|debug|function|unit tests?|app)\b/.test(p)) return "code";
  return "general";
}

function parseMeta(json) {
  if (!json) return {};
  try { const m = JSON.parse(json); return m && typeof m === "object" ? m : {}; } catch { return {}; }
}

/** The long-task meta of a session row, or null when the row is not a long task. */
export function longTaskMeta(session) {
  const m = parseMeta(session?.meta_json);
  return m.longTask ? m : null;
}

function writeMeta(db, sessionId, meta) {
  db.prepare(`UPDATE agent_marathon_sessions SET meta_json = ?, updated_at = unixepoch() WHERE id = ?`)
    .run(JSON.stringify(meta), sessionId);
}

export function activeLongTaskCount(db, userId) {
  try {
    return db.prepare(`
      SELECT COUNT(*) AS n FROM agent_marathon_sessions
      WHERE user_id = ? AND status IN ('pending','running')
        AND json_extract(meta_json, '$.longTask') = 1
    `).get(userId)?.n || 0;
  } catch { return 0; }
}

const clampInt = (v, lo, hi, dflt) => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n > 0 ? Math.max(lo, Math.min(hi, n)) : dflt;
};

/**
 * Start a long task for a user. Returns { ok, jobId, mode, budgetCap, maxTurns }
 * or { ok:false, reason }.
 */
export function startLongTask(db, { userId, goal, title = null, mode = null, origin = {}, budgetCap, maxTurns, allowedDomains = null, extraMeta = null } = {}) {
  if (!db || !userId) return { ok: false, reason: "no_actor" };
  const g = String(goal || "").replace(/\s+/g, " ").trim();
  if (g.length < 8) return { ok: false, reason: "goal_too_short" };
  const active = activeLongTaskCount(db, userId);
  if (active >= LONG_TASK_DEFAULTS.maxActivePerUser) {
    return { ok: false, reason: "too_many_active", active, limit: LONG_TASK_DEFAULTS.maxActivePerUser };
  }
  const m = LONG_TASK_MODES.includes(mode) ? mode : inferLongTaskMode(g);
  const cap = clampInt(budgetCap, 5, 300, LONG_TASK_DEFAULTS.budgetCap);
  const turns = clampInt(maxTurns, 3, 200, LONG_TASK_DEFAULTS.maxTurns);
  const r = startMarathon(db, userId, {
    goal: g.slice(0, 2000),
    title: String(title || g).slice(0, 80),
    maxTurns: turns,
    budgetCap: cap,
    allowedDomains: Array.isArray(allowedDomains) && allowedDomains.length ? allowedDomains : undefined,
  });
  if (!r?.ok) return r || { ok: false, reason: "start_failed" };
  const meta = {
    longTask: 1,
    mode: m,
    origin: {
      surface: ["chat", "conkay", "agent"].includes(origin?.surface) ? origin.surface : "agent",
      sessionId: origin?.sessionId ? String(origin.sessionId).slice(0, 200) : null,
    },
    startedAt: Date.now(),
    ...(extraMeta && typeof extraMeta === "object" ? extraMeta : {}),
  };
  try {
    db.prepare(`
      UPDATE agent_marathon_sessions
      SET meta_json = ?, status = 'running', next_tick_at = unixepoch(), updated_at = unixepoch()
      WHERE id = ?
    `).run(JSON.stringify(meta), r.sessionId);
  } catch (e) {
    return { ok: false, reason: "meta_write_failed", error: e?.message };
  }
  return { ok: true, jobId: r.sessionId, mode: m, budgetCap: cap, maxTurns: turns };
}

/** Run the first tick right away so the job starts without waiting for the heartbeat. */
export function kickLongTask({ db, jobId, runMacro, lensActions }) {
  if (!db || !jobId || typeof runMacro !== "function") return false;
  setTimeout(() => {
    import("./agent-marathon.js")
      .then(({ tickMarathon }) => tickMarathon({ db, sessionId: jobId, runMacro, lensActions: lensActions || new Map(), opts: { tickTurns: LONG_TASK_DEFAULTS.tickTurns } }))
      .catch(() => { /* the heartbeat retries */ });
  }, 50);
  return true;
}

/** Real tool calls the job has dispatched (forensic log, else the stored turns). */
export function longTaskStepCount(db, sessionId) {
  try {
    const n = db.prepare(`SELECT COUNT(*) AS n FROM agent_marathon_tool_log WHERE session_id = ?`).get(sessionId)?.n;
    if (Number.isFinite(n) && n > 0) return n;
  } catch { /* table optional */ }
  try {
    const rows = db.prepare(`SELECT tool_calls_json FROM agent_marathon_turns WHERE session_id = ? AND role = 'assistant'`).all(sessionId);
    let n = 0;
    for (const r of rows) { try { const a = JSON.parse(r.tool_calls_json || "[]"); if (Array.isArray(a)) n += a.length; } catch { /* skip */ } }
    return n;
  } catch { return 0; }
}

/** Strip loop markers from a model answer for display. */
export function cleanAnswer(text) {
  return String(text || "")
    .replace(COMPLETE_RE, "")
    .replace(/\[TASK_BLOCKED:[^\]]*\]/gi, "")
    .replace(/\[TOOL_CALL:[\s\S]*?\]\s*$/gm, "")
    .trim();
}

function lastAssistant(session) {
  const turns = Array.isArray(session?.turns) ? session.turns : [];
  for (let i = turns.length - 1; i >= 0; i--) {
    if (turns[i].role === "assistant" && String(turns[i].content || "").trim()) return turns[i];
  }
  return null;
}

function summarizeJob(db, session) {
  const meta = longTaskMeta(session) || {};
  const last = lastAssistant(session);
  return {
    jobId: session.id,
    title: session.title,
    goal: session.goal,
    mode: meta.mode || "general",
    status: session.status,
    turns: session.total_turns,
    maxTurns: session.max_turns,
    steps: longTaskStepCount(db, session.id),
    budgetCap: session.budget_cap ?? null,
    budgetSpent: session.budget_spent ?? null,
    startedAt: session.created_at,
    updatedAt: session.updated_at,
    completedAt: session.completed_at || null,
    lastNote: last ? cleanAnswer(last.content).slice(0, session.status === "completed" ? 6000 : 800) : "",
    ...(meta.report ? { report: meta.report } : {}),
    ...(meta.goalTreeId ? { goalTreeId: meta.goalTreeId } : {}),
    ...(Array.isArray(meta.citationDtuIds) ? { citationDtus: meta.citationDtuIds.length } : {}),
  };
}

/** Status of one job (owner only) or the user's 3 most recent long tasks. */
export function longTaskStatus(db, userId, jobId = null) {
  if (!db || !userId) return { ok: false, reason: "no_actor" };
  if (jobId) {
    const s = getMarathon(db, String(jobId));
    if (!s || s.user_id !== userId || !longTaskMeta(s)) return { ok: false, reason: "job_not_found" };
    return { ok: true, jobs: [summarizeJob(db, s)] };
  }
  let ids = [];
  try {
    ids = db.prepare(`
      SELECT id FROM agent_marathon_sessions
      WHERE user_id = ? AND json_extract(meta_json, '$.longTask') = 1
      ORDER BY updated_at DESC LIMIT 3
    `).all(userId).map((r) => r.id);
  } catch { ids = []; }
  const jobs = ids.map((id) => getMarathon(db, id)).filter(Boolean).map((s) => summarizeJob(db, s));
  return { ok: true, jobs };
}

/** Human-readable status lines for a reply. */
export function formatLongTaskStatus(status) {
  if (!status?.ok) return status?.reason === "job_not_found" ? "I couldn't find that background job." : "I couldn't read your background jobs right now.";
  if (!status.jobs.length) return "You don't have any background jobs yet.";
  return status.jobs.map((j) => {
    const head = `• "${j.title}" (job ${j.jobId}) is ${j.status}: ${j.steps} tool step${j.steps === 1 ? "" : "s"} over ${j.turns} of ${j.maxTurns} turns${j.budgetCap ? `, budget ${j.budgetSpent}/${j.budgetCap}` : ""}${j.citationDtus ? `, ${j.citationDtus} citation DTU${j.citationDtus === 1 ? "" : "s"}` : ""}.`;
    const tail = j.report?.downloadUrl ? `\n  Report: ${j.report.filename || "report"} ${j.report.downloadUrl}` : "";
    const note = j.lastNote ? `\n  Latest: ${j.lastNote.replace(/\s+/g, " ").slice(0, 400)}` : "";
    return head + tail + note;
  }).join("\n");
}

const MODE_RULES = {
  research: "- Research: use web_search, then browse_url the best results and quote real numbers from the pages. Every claim in your notes and final report needs its source URL. Prefer several independent sources.",
  plan: "- Planning: break the goal into concrete, dated steps with durations. Put real dates on them (today is in the system note above).",
  code: "- Coding: write the code and run it (run_python, or run_lens_action code.build) to check it works before you report it. Show the final code.",
  general: "",
};

/** System block for one long-task tick. */
export function longTaskSystemBlock(session, meta) {
  const left = Math.max(0, (session.max_turns || 0) - (session.total_turns || 0));
  return [
    `BACKGROUND JOB ${session.id} (${meta.mode || "general"}). You are doing this job for the user in the background. They are not watching and can't answer questions, so don't ask any: make reasonable assumptions and say what you assumed.`,
    `Goal: ${String(session.goal || "").slice(0, 1500)}`,
    "- Make real progress every time with tools (search, read pages, compute, save). Don't just restate the plan.",
    "- End every reply with a 'Progress notes:' section: what you found so far, with source links, and what is left. Those notes are all you'll see of this work next time.",
    "- When the goal is fully done, write the complete final deliverable (the full answer or report, not a summary of it) and put [TASK_COMPLETE] on its own last line.",
    "- If you truly can't continue, explain why and end with [TASK_BLOCKED: reason].",
    MODE_RULES[meta.mode] || "",
    `- You have about ${left} turns left in this job. Finish before then.`,
    "- Never call start_long_task or check_long_task inside a background job.",
  ].filter(Boolean).join("\n");
}

/** The user-role message for a tick that continues earlier work. */
export function continuationMessage(session) {
  return `Continue the background job. Goal: ${String(session.goal || "").slice(0, 600)}\nPick up from your progress notes above and do the next concrete steps with tools. When everything is done, write the final deliverable and end with [TASK_COMPLETE].`;
}

function realtime(userId, event, payload) {
  try {
    const re = globalThis._concordRealtimeEmit;
    if (typeof re === "function") re(event, payload, { userId });
  } catch { /* best-effort */ }
}

/**
 * Post a finished (or stopped) long task back to where it started.
 * Chat: an assistant message in the originating chat session.
 * ConKay / agent: queued as a pending notice for the next reply on that surface.
 * Idempotent (meta.deliveredAt).
 */
export async function deliverLongTaskResult(db, sessionId) {
  if (!db || !sessionId) return { ok: false, reason: "missing_inputs" };
  const session = getMarathon(db, sessionId);
  const meta = longTaskMeta(session);
  if (!session || !meta) return { ok: false, reason: "not_long_task" };
  if (!["completed", "paused", "failed", "revoked"].includes(session.status)) return { ok: false, reason: "not_terminal" };
  if (meta.deliveredAt) return { ok: true, already: true };
  const steps = longTaskStepCount(db, sessionId);
  const last = lastAssistant(session);
  const body = last ? cleanAnswer(last.content) : "";
  const blocked = last ? BLOCKED_RE.exec(String(last.content || ""))?.[1] : null;
  let head;
  if (session.status === "completed") head = `Background job finished: "${session.title}" (job ${sessionId}, ${steps} tool steps over ${session.total_turns} turns).`;
  else if (session.status === "paused") head = `Background job paused: "${session.title}" (job ${sessionId}) after ${steps} tool steps${blocked ? `. It got stuck: ${blocked}` : ""}.`;
  else if (session.status === "revoked") head = `Background job stopped: "${session.title}" (job ${sessionId}) was revoked after ${steps} tool steps.`;
  else head = `Background job ended early: "${session.title}" (job ${sessionId}) hit its turn or budget limit after ${steps} tool steps. Here is what it had so far.`;
  const reportLine = meta.report?.downloadUrl ? `\n\nReport: ${meta.report.filename || "report"} ${meta.report.downloadUrl}` : "";
  const citeLine = Array.isArray(meta.citationDtuIds) && meta.citationDtuIds.length ? `\nSaved ${meta.citationDtuIds.length} citation DTU${meta.citationDtuIds.length === 1 ? "" : "s"}.` : "";
  const text = `${head}${reportLine}${citeLine}\n\n${body}`.trim().slice(0, 12000);

  let postedTo = null;
  const origin = meta.origin || {};
  if (origin.surface === "chat" && origin.sessionId) {
    try {
      const { persistChatMessage } = await import("./chat-session-store.js");
      persistChatMessage(db, origin.sessionId, { role: "assistant", content: text, ts: Date.now(), meta: { source: "long_task", jobId: sessionId, status: session.status } });
      const sess = globalThis._concordSTATE?.sessions?.get?.(origin.sessionId);
      if (sess && Array.isArray(sess.messages)) {
        sess.messages.push({ role: "assistant", content: text, ts: new Date().toISOString(), meta: { source: "long_task", jobId: sessionId, status: session.status } });
      }
      postedTo = "chat";
    } catch { postedTo = null; }
  }
  const next = { ...meta, deliveredAt: Date.now(), deliveredTo: postedTo, resultText: text, pendingNotice: postedTo ? 0 : 1 };
  try { writeMeta(db, sessionId, next); } catch { /* best-effort */ }
  realtime(session.user_id, "long_task:done", { jobId: sessionId, status: session.status, title: session.title, steps, chatSessionId: postedTo ? origin.sessionId : null });
  return { ok: true, postedTo, text };
}

/**
 * Finished-job notices not yet shown (ConKay keeps history client-side, so
 * its jobs are announced in the next reply). Marks them shown.
 */
export function takePendingLongTaskNotices(db, userId, { surface = null, limit = 2 } = {}) {
  if (!db || !userId) return [];
  let rows = [];
  try {
    rows = db.prepare(`
      SELECT id, meta_json FROM agent_marathon_sessions
      WHERE user_id = ? AND json_extract(meta_json, '$.longTask') = 1
        AND json_extract(meta_json, '$.pendingNotice') = 1
      ORDER BY completed_at DESC, updated_at DESC LIMIT 10
    `).all(userId);
  } catch { return []; }
  const out = [];
  for (const r of rows) {
    if (out.length >= limit) break;
    const meta = parseMeta(r.meta_json);
    if (surface && meta.origin?.surface && meta.origin.surface !== surface) continue;
    out.push({ jobId: r.id, text: meta.resultText || "" });
    try { writeMeta(db, r.id, { ...meta, pendingNotice: 0, noticeShownAt: Date.now() }); } catch { /* best-effort */ }
  }
  return out;
}

// Asks that should become a background job rather than a one-shot reply.
const LONG_RES = [
  /\b(?:research|investigate|look into|dig into)\b[^.?!]{3,200}\b(?:and|then)\s+(?:write|give|make|send|put together|compile|prepare)\b[^.?!]{0,30}\b(?:report|write-?up|summary|brief|doc(?:ument)?|comparison|review)\b/i,
  /\b(?:deep|thorough|in-?depth|comprehensive|full)\s+(?:research|dive|analysis|report|review)\b/i,
  /\b(?:write|make|put together|compile|prepare)\s+(?:me\s+)?(?:a|an)\s+(?:detailed\s+|full\s+|thorough\s+|comprehensive\s+)?(?:research\s+)?report\s+(?:on|about|comparing)\b/i,
  /\b(?:in the background|background (?:job|task)|long[- ](?:task|job|running)|keep working on|work on (?:it|this) (?:for a while|overnight|in the background)|over the next (?:hour|few hours|day|couple of hours))\b/i,
];
const JOB_STATUS_RES = [
  /\b(?:how(?:'s| is| are)|status of|check on|progress (?:on|of)|update on|where are we on|is)\b[^.?!]{0,30}\b(?:my|the|that)\s+(?:background\s+|long\s+|research\s+)?(?:job|task|report|research)s?\b(?:[^.?!]{0,20}\b(?:going|done|ready|finished|coming along|status))?/i,
  /\b(?:background|long)\s+(?:jobs?|tasks?)\b/i,
  /\bjob\s+mar_[a-z0-9-]+\b/i,
];

/** True for an ask that should start a long task. */
export function isLongTaskAsk(text) {
  const p = String(text || "");
  if (p.length < 12 || p.length > 4000) return false;
  return LONG_RES.some((r) => r.test(p));
}

/** True for "how's my background job going?" */
export function isLongTaskStatusAsk(text) {
  const p = String(text || "");
  if (!p || p.length > 400) return false;
  if (/\b(?:add|create|make|new)\s+(?:a\s+)?task\b/i.test(p)) return false;
  return JOB_STATUS_RES.some((r) => r.test(p)) && /\b(?:job|task|report|research)s?\b/i.test(p) && !/\btasks?\s+(?:list|for today|today)\b/i.test(p);
}

/** One-line acknowledgement after a job starts. */
export function longTaskStartedReply(r, goal) {
  if (!r?.ok) {
    if (r?.reason === "too_many_active") return `You already have ${r.active} background jobs running (the limit is ${r.limit}). Ask me "how are my background jobs going?" or wait for one to finish.`;
    return `I couldn't start a background job for that${r?.reason ? ` (${r.reason})` : ""}.`;
  }
  const kind = r.mode === "research" ? "research job" : r.mode === "plan" ? "planning job" : r.mode === "code" ? "coding job" : "background job";
  return `Started a ${kind} for "${String(goal).slice(0, 160)}" (job ${r.jobId}). It keeps working in the background (up to ${r.maxTurns} turns and ${r.budgetCap} tool steps) and I'll post the result here when it's done. Ask "how's my job going?" any time for progress.`;
}
