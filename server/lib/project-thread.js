// server/lib/project-thread.js
//
// V1.2 Wave B (Deep ConKay Agency) — the "project" linking layer (mig 378).
//
// Ties three real, independently-tested subsystems into one addressable,
// resumable unit a user can reopen across separate logins:
//   - server/lib/goal-decomposition.js — the durable subgoal tree.
//   - server/lib/agent-marathon.js     — persistent long-running task runs.
//   - server/lib/conversation-memory.js — cross-session conversation_memory
//     DTUs (via the STATE.dtus map — see the "memory" section below).
//
// This module does NOT reimplement any of their logic. It stores which
// goal_tree and which marathon session(s) belong to a project, and calls
// straight back into goal-decomposition.js's/agent-marathon.js's OWN getters
// for live state. Honest-by-construction: a dangling goal_tree_id or a
// vanished marathon session is reported plainly in the returned shape
// (`{ ok:false, reason:... }` / `{ status:'missing', reason:... }`), never
// papered over as if the state still existed.
//
// ── Conversation memory linking ─────────────────────────────────────────────
// Deliberately NOT a join table. `conversation-memory.js` writes structured
// `conversation_memory` / `conversation_memory_hyper` DTUs into the
// server's write-through `STATE.dtus` map (see server/domains/conkay.js's
// memory_list/memory_pin/memory_forget macros, which already scope that
// store at read time by `(kind, machine.userId)`). There is no durable
// per-project foreign key to declare against that store yet, and building
// one now would be a parallel, un-asked-for membership substrate — exactly
// what server/lib/workspace-rooms.js's header (mig 377) declines to do for
// its own "visited" question. Instead, `getProject` below re-uses conkay.js's
// exact ownership scope (kind + machine.userId) and ranks the result by a
// simple, deterministic keyword-overlap score against the project's own
// name + linked goal-tree title/description — the same "grounded score
// derived from real content" shape `extractFallback` in
// conversation-memory.js already uses when the brain is offline. No LLM
// call, no fabricated relevance number: overlap count IS the score.

import crypto from "node:crypto";
import { getGoalTree } from "./goal-decomposition.js";
import { getMarathon } from "./agent-marathon.js";

const NAME_MAX_LEN = 140;
/** The only two conversation-memory DTU kinds that carry a real per-user
 *  `machine.userId` stamp — mirrors OWNED_MEMORY_KINDS in
 *  server/domains/conkay.js (see buildConversationMemoryDTU /
 *  checkTopicConsolidation's hyper branch in conversation-memory.js).
 *  `conversation_memory_mega` is keyed by topic + sessionIds, not userId,
 *  so — same as conkay.js — it is left out rather than guessed at. */
const MEMORY_KINDS = new Set(["conversation_memory", "conversation_memory_hyper"]);
const DEFAULT_MEMORY_LIMIT = 5;

function newProjectId() {
  return `proj_${crypto.randomUUID().slice(0, 16)}`;
}

function projectRow(db, projectId) {
  return db.prepare(`
    SELECT id, user_id AS userId, name, goal_tree_id AS goalTreeId,
           created_at AS createdAt, updated_at AS updatedAt, last_opened_at AS lastOpenedAt
    FROM projects WHERE id = ?
  `).get(projectId);
}

/** Create a named project, optionally pre-linked to an existing goal tree.
 *  The goal tree, if given, must exist AND belong to the same user — this
 *  never silently adopts someone else's tree. */
export function createProject(db, userId, name, opts = {}) {
  if (!db) return { ok: false, reason: "no_db" };
  const uid = String(userId || "").trim();
  const trimmedName = String(name || "").trim().slice(0, NAME_MAX_LEN);
  if (!uid) return { ok: false, reason: "no_user" };
  if (!trimmedName) return { ok: false, reason: "missing_name" };

  const goalTreeId = opts.goalTreeId ? String(opts.goalTreeId) : null;
  if (goalTreeId) {
    const gt = getGoalTree(db, goalTreeId);
    if (!gt.ok) return { ok: false, reason: "goal_tree_not_found" };
    if (gt.tree.userId !== uid) return { ok: false, reason: "goal_tree_not_owned" };
  }

  const id = newProjectId();
  try {
    db.prepare(`
      INSERT INTO projects (id, user_id, name, goal_tree_id) VALUES (?, ?, ?, ?)
    `).run(id, uid, trimmedName, goalTreeId);
  } catch (e) {
    return { ok: false, reason: "insert_failed", error: String(e?.message || e) };
  }
  return { ok: true, project: projectRow(db, id) };
}

/** List a user's projects, newest-updated first, with a cheap (no N+1)
 *  count of how many marathon sessions each has accumulated. */
export function listProjects(db, userId, opts = {}) {
  if (!db || !userId) return [];
  const limit = Math.min(Math.max(Number(opts.limit) || 50, 1), 200);
  const rows = db.prepare(`
    SELECT id, name, goal_tree_id AS goalTreeId, created_at AS createdAt,
           updated_at AS updatedAt, last_opened_at AS lastOpenedAt
    FROM projects WHERE user_id = ? ORDER BY updated_at DESC LIMIT ?
  `).all(String(userId), limit);
  if (!rows.length) return [];

  const ids = rows.map((r) => r.id);
  const ph = ids.map(() => "?").join(",");
  const counts = db.prepare(`
    SELECT project_id AS pid, COUNT(*) AS n
    FROM project_marathon_links WHERE project_id IN (${ph}) GROUP BY project_id
  `).all(...ids);
  const cmap = new Map(counts.map((c) => [c.pid, c.n]));

  return rows.map((r) => ({ ...r, marathonCount: cmap.get(r.id) || 0 }));
}

function _tokenize(text) {
  return String(text || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2);
}

/** Deterministic, LLM-free keyword-overlap relevance score against the
 *  user's own conversation-memory DTUs (see the module header). Returns
 *  `{ available:false }` honestly when no live DTU store was passed in —
 *  never a fabricated empty-but-"checked" result. */
function relevantMemories(dtusMap, userId, queryText, limit = DEFAULT_MEMORY_LIMIT) {
  if (!dtusMap || typeof dtusMap.values !== "function") {
    return { available: false, reason: "no_state", items: [] };
  }
  const queryTerms = new Set(_tokenize(queryText));
  if (queryTerms.size === 0) return { available: true, items: [] };

  const scored = [];
  for (const dtu of dtusMap.values()) {
    if (!dtu || !MEMORY_KINDS.has(dtu.machine?.kind)) continue;
    if (dtu.machine?.userId !== userId) continue;
    const haystack = [
      dtu.title || "",
      ...(dtu.machine?.topics || []),
      ...(dtu.machine?.insights || []),
      ...(dtu.machine?.claims || []),
    ].join(" ");
    let overlap = 0;
    for (const t of _tokenize(haystack)) if (queryTerms.has(t)) overlap++;
    if (overlap > 0) scored.push({ dtu, overlap });
  }
  scored.sort((a, b) => b.overlap - a.overlap || new Date(b.dtu.updatedAt || 0) - new Date(a.dtu.updatedAt || 0));

  return {
    available: true,
    items: scored.slice(0, limit).map(({ dtu, overlap }) => ({
      id: dtu.id,
      kind: dtu.machine.kind,
      title: dtu.title || null,
      topics: Array.isArray(dtu.machine?.topics) ? dtu.machine.topics : [],
      insights: Array.isArray(dtu.machine?.insights) ? dtu.machine.insights.slice(0, 3) : [],
      relevance: overlap,
      updatedAt: dtu.updatedAt || null,
    })),
  };
}

/**
 * Assemble the full addressable project: its own row + the linked goal
 * tree's real current state (via goal-decomposition.js's own getter) + its
 * linked marathon sessions' real current state (via agent-marathon.js's own
 * getter) + a relevance-scoped conversation-memory pull. Never fabricates —
 * a missing/deleted goal tree or a vanished marathon session is reported
 * plainly, not silently dropped or invented.
 *
 * @param {object} [opts]
 * @param {Map} [opts.dtus] - the live STATE.dtus map (ctx.state.dtus), for
 *   the conversation-memory pull. Omit in contexts with no live state — the
 *   returned `memory.available` will honestly read false.
 * @param {number} [opts.memoryLimit]
 */
export function getProject(db, userId, projectId, opts = {}) {
  if (!db) return { ok: false, reason: "no_db" };
  if (!userId) return { ok: false, reason: "no_user" };
  if (!projectId) return { ok: false, reason: "missing_project_id" };

  const row = projectRow(db, projectId);
  if (!row) return { ok: false, reason: "not_found" };
  if (row.userId !== String(userId)) return { ok: false, reason: "not_owned" };

  let goalTree = null;
  if (row.goalTreeId) {
    const gt = getGoalTree(db, row.goalTreeId);
    goalTree = gt.ok ? gt : { ok: false, reason: gt.reason || "goal_tree_unavailable", treeId: row.goalTreeId };
  }

  const linkRows = db.prepare(`
    SELECT marathon_session_id AS sessionId, linked_at AS linkedAt
    FROM project_marathon_links WHERE project_id = ? ORDER BY linked_at DESC
  `).all(projectId);
  const marathons = linkRows.map((l) => {
    const m = getMarathon(db, l.sessionId);
    if (!m) return { sessionId: l.sessionId, linkedAt: l.linkedAt, status: "missing", reason: "session_not_found" };
    return {
      sessionId: l.sessionId,
      linkedAt: l.linkedAt,
      status: m.status,
      title: m.title || null,
      goal: m.goal || null,
      totalTurns: m.total_turns,
      maxTurns: m.max_turns,
      updatedAt: m.updated_at,
      completedAt: m.completed_at,
    };
  });

  const queryText = [row.name, goalTree?.ok ? goalTree.tree.title : null, goalTree?.ok ? goalTree.tree.description : null]
    .filter(Boolean).join(" ");
  const memory = relevantMemories(opts.dtus, String(userId), queryText, opts.memoryLimit);

  return { ok: true, project: row, goalTree, marathons, memory };
}

/** Link a marathon session to a project (idempotent — re-linking the same
 *  pair is a no-op, not an error). Both sides must genuinely exist. */
export function linkMarathonToProject(db, projectId, marathonSessionId) {
  if (!db) return { ok: false, reason: "no_db" };
  if (!projectId || !marathonSessionId) return { ok: false, reason: "missing_inputs" };

  const project = db.prepare(`SELECT id FROM projects WHERE id = ?`).get(projectId);
  if (!project) return { ok: false, reason: "project_not_found" };

  const session = getMarathon(db, marathonSessionId);
  if (!session) return { ok: false, reason: "marathon_not_found" };

  try {
    db.prepare(`
      INSERT OR IGNORE INTO project_marathon_links (project_id, marathon_session_id) VALUES (?, ?)
    `).run(projectId, marathonSessionId);
    db.prepare(`UPDATE projects SET updated_at = unixepoch() WHERE id = ?`).run(projectId);
  } catch (e) {
    return { ok: false, reason: "insert_failed", error: String(e?.message || e) };
  }
  return { ok: true, projectId, marathonSessionId };
}

/** Stamp a project as opened-now by its owner. Ownership-checked — this is
 *  the "resume" beat, so it must never touch/reveal a project that isn't
 *  the caller's. */
export function touchProjectOpened(db, userId, projectId) {
  if (!db) return { ok: false, reason: "no_db" };
  if (!userId || !projectId) return { ok: false, reason: "missing_inputs" };

  const row = db.prepare(`SELECT id, user_id AS userId FROM projects WHERE id = ?`).get(projectId);
  if (!row) return { ok: false, reason: "not_found" };
  if (row.userId !== String(userId)) return { ok: false, reason: "not_owned" };

  db.prepare(`UPDATE projects SET last_opened_at = unixepoch(), updated_at = unixepoch() WHERE id = ?`).run(projectId);
  return { ok: true, project: projectRow(db, projectId) };
}

export default {
  createProject, listProjects, getProject, linkMarathonToProject, touchProjectOpened,
};
