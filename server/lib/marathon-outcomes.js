// server/lib/marathon-outcomes.js
//
// Cross-project learning — procedural-memory tier (2026-07-24).
//
// The gap: server/lib/project-thread.js links a goal tree + marathon
// session(s) + conversation-memory into one addressable "project", but
// nothing ever derives "how did completing project A actually go, and does
// that inform project B." This module is that missing post-mortem layer —
// and nothing more. It does not reimplement agent-marathon.js's state
// machine; it reads FROM `agent_marathon_sessions` / `agent_marathon_turns`
// (mig 171/379) once a session has genuinely reached a terminal status, and
// writes one denormalized snapshot row into `marathon_outcomes` (mig 390).
//
// Two functions:
//
//   extractOutcomeFromSession(db, sessionId) — read-only against the
//     marathon tables, writes exactly one row (idempotent — re-extraction
//     on the same session UPDATEs its own row rather than duplicating).
//     Every field is real: goal/title/status straight off
//     agent_marathon_sessions; the tool-domain histogram is a real count of
//     agent_marathon_turns.tool_calls_json entries resolved through
//     agent-marathon.js's OWN `domainForToolCall` (not re-derived); turn
//     count + duration are read straight off the session row. Refuses
//     honestly (`{ ok:false, reason:... }`) on a missing or non-terminal
//     session — never fabricates a post-mortem for a session that hasn't
//     finished.
//
//   findSimilarOutcomes(db, goalText, limit, opts) — deterministic,
//     LLM-free keyword-overlap ranking against `marathon_outcomes.goal` +
//     `.title`. Reuses project-thread.js's `tokenize()` EXACTLY (the same
//     function `relevantMemories` uses for its own conversation-memory
//     scoring) rather than inventing a second scoring mechanism — overlap
//     count IS the score, tie-broken by most-recently-completed, exactly
//     mirroring relevantMemories' own tie-break shape.
//
// Retrieval-on-request only. This module is deliberately NOT wired into
// agent-marathon.js#tickMarathon's prompt construction — a new marathon's
// prompt must never be silently padded with "here's how similar projects
// went" by default. The domains/agent-projects.js `similar_outcomes` macro
// is the only caller, and only fires when a user/agent explicitly asks for
// it.

import crypto from "node:crypto";
import { tokenize } from "./project-thread.js";
import { domainForToolCall } from "./agent-marathon.js";

const DEFAULT_SIMILAR_LIMIT = 5;
const MAX_SIMILAR_LIMIT = 50;

/** Matches agent-marathon.js#tickMarathon's own terminal-status check
 *  (`["completed", "abandoned", "failed", "revoked"].includes(session.status)`)
 *  — 'paused' is deliberately excluded: a paused marathon can still resume,
 *  so it is not yet a "how did it go" post-mortem candidate. */
const TERMINAL_STATUSES = new Set(["completed", "abandoned", "failed", "revoked"]);

function safeParseJson(s, fallback) {
  if (!s) return fallback;
  try { return JSON.parse(s); } catch { return fallback; }
}

/** Deterministic id derived from the session id (not a fresh random one on
 *  every call) — so re-extracting the same session's outcome UPDATEs the
 *  same row instead of accumulating duplicates, with no read-before-write
 *  race needed. */
function outcomeIdFor(sessionId) {
  return `mout_${crypto.createHash("sha1").update(String(sessionId)).digest("hex").slice(0, 16)}`;
}

/**
 * Extract a deterministic outcome record from a terminal marathon session
 * and persist it into `marathon_outcomes`. Read-only against
 * agent_marathon_sessions/agent_marathon_turns; writes exactly one row.
 *
 * @param {object} db
 * @param {string} sessionId
 * @returns {{ ok: boolean, reason?: string, status?: string, outcome?: object }}
 */
export function extractOutcomeFromSession(db, sessionId) {
  if (!db) return { ok: false, reason: "no_db" };
  if (!sessionId) return { ok: false, reason: "missing_session_id" };

  let session;
  try {
    session = db.prepare(`
      SELECT id, user_id AS userId, title, goal, status, total_turns AS totalTurns,
             created_at AS createdAt, completed_at AS completedAt
      FROM agent_marathon_sessions WHERE id = ?
    `).get(sessionId);
  } catch (e) {
    return { ok: false, reason: "session_query_failed", error: String(e?.message || e) };
  }
  if (!session) return { ok: false, reason: "session_not_found" };
  if (!TERMINAL_STATUSES.has(session.status)) {
    return { ok: false, reason: "not_terminal", status: session.status };
  }

  let turns = [];
  try {
    turns = db.prepare(`
      SELECT tool_calls_json AS toolCallsJson FROM agent_marathon_turns WHERE session_id = ?
    `).all(sessionId);
  } catch {
    turns = [];
  }

  // Real count of tool calls per macro-domain, resolved through
  // agent-marathon.js's OWN domainForToolCall — never re-derived here.
  // Tool calls that resolve to no domain (browse_url, run_compute, mcp_*)
  // are real tool usage too but carry no domain concept, so they're
  // honestly excluded from a *domain* histogram rather than guessed at.
  const histogram = {};
  for (const turn of turns) {
    const calls = safeParseJson(turn.toolCallsJson, []);
    if (!Array.isArray(calls)) continue;
    for (const call of calls) {
      const domain = domainForToolCall(call);
      if (!domain) continue;
      histogram[domain] = (histogram[domain] || 0) + 1;
    }
  }

  const nowS = Math.floor(Date.now() / 1000);
  // Only 'completed' sets agent_marathon_sessions.completed_at (see
  // tickMarathon's UPDATE ... CASE) — a 'failed'/'abandoned'/'revoked'
  // session never got one, so this stamps extraction-time instead of
  // fabricating a completion moment that never happened.
  const completedAt = session.completedAt != null ? session.completedAt : nowS;
  const durationS = session.completedAt != null && session.createdAt != null
    ? Math.max(0, session.completedAt - session.createdAt)
    : null;

  const id = outcomeIdFor(sessionId);
  const histogramJson = JSON.stringify(histogram);
  try {
    db.prepare(`
      INSERT INTO marathon_outcomes
        (id, user_id, session_id, goal, title, status, tool_domain_histogram_json,
         turn_count, duration_s, completed_at, extracted_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch())
      ON CONFLICT(session_id) DO UPDATE SET
        goal = excluded.goal,
        title = excluded.title,
        status = excluded.status,
        tool_domain_histogram_json = excluded.tool_domain_histogram_json,
        turn_count = excluded.turn_count,
        duration_s = excluded.duration_s,
        completed_at = excluded.completed_at,
        extracted_at = unixepoch()
    `).run(
      id, session.userId, sessionId, session.goal, session.title || null, session.status,
      histogramJson, session.totalTurns || 0, durationS, completedAt,
    );
  } catch (e) {
    return { ok: false, reason: "insert_failed", error: String(e?.message || e) };
  }

  return {
    ok: true,
    outcome: {
      id, userId: session.userId, sessionId, goal: session.goal, title: session.title || null,
      status: session.status, toolDomainHistogram: histogram, turnCount: session.totalTurns || 0,
      durationS, completedAt,
    },
  };
}

/**
 * Deterministic, LLM-free keyword-overlap similarity lookup against past
 * marathon outcomes. Mirrors project-thread.js#relevantMemories' scoring
 * approach exactly (same `tokenize()`, overlap count IS the score, tie-break
 * by recency) rather than inventing a second mechanism.
 *
 * @param {object} db
 * @param {string} goalText - the new goal/project text to compare against
 * @param {number} [limit]
 * @param {object} [opts]
 * @param {string} [opts.userId] - when given, scopes the search to only
 *   this user's own past outcomes (privacy-preserving default for the
 *   `agent_projects.similar_outcomes` macro). Omitted only by internal/
 *   test callers that intentionally want a cross-user view.
 * @returns {{ ok: boolean, reason?: string, items: Array }}
 */
export function findSimilarOutcomes(db, goalText, limit = DEFAULT_SIMILAR_LIMIT, opts = {}) {
  if (!db) return { ok: false, reason: "no_db", items: [] };

  const queryTerms = new Set(tokenize(goalText));
  if (queryTerms.size === 0) return { ok: true, items: [] };

  const userId = opts.userId ? String(opts.userId) : null;
  let rows;
  try {
    rows = userId
      ? db.prepare(`
          SELECT id, user_id AS userId, session_id AS sessionId, goal, title, status,
                 tool_domain_histogram_json AS toolDomainHistogramJson, turn_count AS turnCount,
                 duration_s AS durationS, completed_at AS completedAt
          FROM marathon_outcomes WHERE user_id = ?
        `).all(userId)
      : db.prepare(`
          SELECT id, user_id AS userId, session_id AS sessionId, goal, title, status,
                 tool_domain_histogram_json AS toolDomainHistogramJson, turn_count AS turnCount,
                 duration_s AS durationS, completed_at AS completedAt
          FROM marathon_outcomes
        `).all();
  } catch {
    // Table absent (pre-migration DB / minimal test schema) — an honest
    // empty list, never a thrown error surfacing as a 500.
    return { ok: true, items: [] };
  }
  if (!rows.length) return { ok: true, items: [] };

  const scored = [];
  for (const row of rows) {
    const haystack = [row.goal || "", row.title || ""].join(" ");
    let overlap = 0;
    for (const t of tokenize(haystack)) if (queryTerms.has(t)) overlap++;
    if (overlap > 0) scored.push({ row, overlap });
  }
  // Same tie-break shape as relevantMemories: overlap desc, then recency desc.
  scored.sort((a, b) => b.overlap - a.overlap || (b.row.completedAt || 0) - (a.row.completedAt || 0));

  const capped = Math.max(1, Math.min(Number(limit) || DEFAULT_SIMILAR_LIMIT, MAX_SIMILAR_LIMIT));
  return {
    ok: true,
    items: scored.slice(0, capped).map(({ row, overlap }) => ({
      id: row.id,
      sessionId: row.sessionId,
      goal: row.goal,
      title: row.title,
      status: row.status,
      toolDomainHistogram: safeParseJson(row.toolDomainHistogramJson, {}),
      turnCount: row.turnCount,
      durationS: row.durationS,
      completedAt: row.completedAt,
      relevance: overlap,
    })),
  };
}

export default { extractOutcomeFromSession, findSimilarOutcomes };
