// server/lib/agent-marathon.js
//
// Sprint 12 — long-running marathon agent sessions.
//
// Marathon sessions persist across requests/restarts. Each call to
// `tickMarathon` advances the session by N turns (default 5) using
// the same brainChat() + tool loop as chat_agent.do, then returns
// the updated state. A heartbeat module auto-ticks running sessions
// so they make progress even when the user closes the tab.
//
// Tools available in marathon mode = SAME tools as chat_agent.do
// (web_search, run_compute, browse_url, run_lens_action, create_dtu,
// expert_mode, generate_image, mcp_call, mcp_list).
//
// Termination: the brain ends a session by emitting [TASK_COMPLETE]
// or [TASK_BLOCKED: reason] markers in its final reply. The session
// flips status to 'completed' or 'paused' respectively. max_turns
// is a hard ceiling (default 200).

import crypto from "node:crypto";
import { runAgentLoop } from "./chat-agent.js";

const DEFAULT_TICK_TURNS = 5;
const DEFAULT_MAX_TURNS = 200;
const DEFAULT_TICK_INTERVAL_S = 60; // 1 min between auto-ticks for running sessions

const COMPLETE_MARKER = /\[TASK_COMPLETE\]/i;
const BLOCKED_MARKER = /\[TASK_BLOCKED:\s*([^\]]*)\]/i;

export function startMarathon(db, userId, opts = {}) {
  if (!db || !userId) return { ok: false, reason: "missing_inputs" };
  const { goal, title, maxTurns, allowedDomains, budgetCap } = opts || {};
  if (!goal) return { ok: false, reason: "missing_goal" };
  const id = `mar_${crypto.randomUUID().slice(0, 16)}`;

  // Governance envelope (mig 379) — both OPT-IN restrictions. Omitting
  // either preserves the pre-existing unrestricted behavior, which matters
  // for callers that don't know about this envelope yet: the autonomous
  // re-goal path (emergent/agent-marathon-cycle.js#reGoalIdleAgents calls
  // startMarathon with only { goal }), and every pre-migration 379 test/
  // caller. MarathonPanel.tsx (the human "New marathon" UI) is the one
  // caller expected to always pass an explicit budgetCap.
  let allowedDomainsJson = null;
  if (Array.isArray(allowedDomains) && allowedDomains.length > 0) {
    const cleaned = allowedDomains.filter((d) => typeof d === "string" && d.trim()).slice(0, 500);
    if (cleaned.length > 0) allowedDomainsJson = JSON.stringify(cleaned);
  }
  const cap = (Number.isFinite(budgetCap) && budgetCap > 0) ? Math.min(100_000, Math.floor(budgetCap)) : null;

  try {
    db.prepare(`
      INSERT INTO agent_marathon_sessions
        (id, user_id, title, goal, status, max_turns, allowed_domains_json, budget_cap)
      VALUES (?, ?, ?, ?, 'pending', ?, ?, ?)
    `).run(id, userId, title || goal.slice(0, 80), goal, Math.min(2000, maxTurns || DEFAULT_MAX_TURNS), allowedDomainsJson, cap);
  } catch {
    // Pre-migration-379 schema (governance columns absent) — fall back to
    // the original insert shape so an unmigrated DB still works exactly as
    // before, rather than throwing. The envelope is simply absent (fully
    // unrestricted), which is the correct back-compat behavior.
    db.prepare(`
      INSERT INTO agent_marathon_sessions
        (id, user_id, title, goal, status, max_turns)
      VALUES (?, ?, ?, ?, 'pending', ?)
    `).run(id, userId, title || goal.slice(0, 80), goal, Math.min(2000, maxTurns || DEFAULT_MAX_TURNS));
  }
  // Seed the user-goal turn so resume sees it.
  db.prepare(`
    INSERT INTO agent_marathon_turns
      (session_id, turn_index, role, content)
    VALUES (?, 0, 'user', ?)
  `).run(id, goal);
  return { ok: true, sessionId: id };
}

export function listMarathons(db, userId, opts = {}) {
  if (!db || !userId) return [];
  try {
    return db.prepare(`
      SELECT id, title, goal, status, total_turns, max_turns, created_at, updated_at, completed_at
      FROM agent_marathon_sessions
      WHERE user_id = ?
      ${opts.status ? "AND status = ?" : ""}
      ORDER BY updated_at DESC
      LIMIT ?
    `).all(...(opts.status ? [userId, opts.status, opts.limit || 50] : [userId, opts.limit || 50]));
  } catch {
    return [];
  }
}

export function getMarathon(db, sessionId) {
  if (!db || !sessionId) return null;
  try {
    const session = db.prepare(`SELECT * FROM agent_marathon_sessions WHERE id = ?`).get(sessionId);
    if (!session) return null;
    const turns = db.prepare(`
      SELECT turn_index, role, content, tool_calls_json, artifacts_json, provider, model, created_at
      FROM agent_marathon_turns
      WHERE session_id = ?
      ORDER BY turn_index ASC
    `).all(sessionId);
    return {
      ...session,
      turns: turns.map(t => ({
        ...t,
        tool_calls: t.tool_calls_json ? safeParse(t.tool_calls_json) : [],
        artifacts: t.artifacts_json ? safeParse(t.artifacts_json) : [],
      })),
    };
  } catch {
    return null;
  }
}

/**
 * Advance a marathon session by up to `tickTurns` brain turns.
 *
 * @param {object} args
 * @param {object} args.db
 * @param {string} args.sessionId
 * @param {Function} args.runMacro
 * @param {Map} args.lensActions
 * @param {object} [args.opts]
 * @returns {Promise<{ok, status, newTurns, totalTurns, error?}>}
 */
// Extracted so it's directly unit-testable (tickMarathon's real path runs
// through runAgentLoop, which needs live brain infra to reach this point).
// Scoped to the session owner's own `user:<id>` room via the 3rd realtimeEmit
// options argument — a bare 2-arg call silently falls through to a GLOBAL
// broadcast in server.js#realtimeEmit, leaking every user's marathon
// session_id/title to every connected socket. Best-effort; never throws.
export function emitMarathonStatus(session, sessionId, nextStatus, totalTurns) {
  try {
    const re = globalThis._concordRealtimeEmit;
    if (typeof re === "function") {
      re("marathon:status", {
        actor_kind: "marathon",
        actor_id: sessionId,
        session_id: sessionId,
        user_id: session.user_id,
        status: nextStatus,
        total_turns: totalTurns,
        title: session.title,
      }, { userId: session.user_id });
    }
  } catch { /* never block on telemetry */ }
}

/**
 * Resolve the macro-domain a tool call targets, for allowed_domains_json
 * enforcement. Only tool types that actually route through a macro domain
 * get a domain tag; run_compute / browse_url / browser_act / mcp_call /
 * mcp_list carry no macro-domain concept at all (they don't call
 * runMacro), so allowed_domains does not — and semantically cannot —
 * scope them. They're still counted against budget_cap by the gate below;
 * only the domain-allowlist check is a no-op for them (returns null here).
 */
export function domainForToolCall(call) {
  if (!call || typeof call.tool !== "string") return null;
  switch (call.tool) {
    case "run_lens_action": {
      const d = call.params && call.params.domain;
      return (typeof d === "string" && d.trim()) ? d.trim() : null;
    }
    case "web_search": return "tools"; // runMacro("tools", "web_search", ...)
    case "create_dtu": return "dtu"; // runMacro("dtu", "create", ...)
    case "expert_mode": return "expert_mode"; // runMacro("expert_mode", "answer", ...)
    case "generate_image": return "multimodal"; // runMacro("multimodal", "image_generate", ...)
    // ConKay tool-authoring first slice (docs/CONKAY_TOOL_AUTHORING_SPEC.md
    // §7 point 5) — a synthetic domain tag so a marathon session's
    // allowed_domains_json allowlist can explicitly permit/deny authored-
    // tool use per session. The per-call revoked/approved/authorization
    // checks still live in conkay-tool-invoke.js#invokeAuthoredTool
    // regardless of this allowlist — this only gates whether the SESSION
    // may attempt run_authored_tool calls at all.
    case "run_authored_tool": return "conkay_tool";
    default: return null;
  }
}

/**
 * Build a per-session governance gate — real-time enforcement of
 * revocation + the domain allowlist + the spend budget, checked
 * immediately before EVERY real tool call chat-agent.js's runAgentLoop is
 * about to dispatch (wired via its opt-in `opts.toolGate` hook). Nothing
 * here is decorative: every branch either lets a real call through (and
 * durably records the spend before it runs) or returns an honest refusal
 * the brain sees in its next turn — never a silent no-op, and never a
 * fabricated success.
 *
 * Contract for the returned function:
 *   - `{ ok: true }` — call is allowed, dispatch it.
 *   - `{ ok: false, halt: false, reason }` — refuse THIS call only; the
 *     brain sees a real tool error and the marathon keeps running.
 *   - `{ ok: false, halt: true, reason }` — stop the WHOLE tick right now
 *     (revoked, or the spend budget is exhausted); tickMarathon maps
 *     `reason` onto a terminal session status.
 *
 * Fails OPEN (returns `{ ok: true }`) only when there's no session row at
 * all, or when the governance columns don't exist yet (pre-migration-379
 * DB / hand-rolled minimal test schema) — matching the same back-compat
 * contract as startMarathon's insert fallback above: an unmigrated session
 * is fully unrestricted, never silently broken.
 */
export function createToolGate(db, sessionId) {
  return async function toolGate(call) {
    if (!db || !sessionId) return { ok: true };
    let session;
    try {
      session = db.prepare(`
        SELECT status, allowed_domains_json, budget_cap, budget_spent, revoked_at
        FROM agent_marathon_sessions WHERE id = ?
      `).get(sessionId);
    } catch {
      return { ok: true }; // governance columns absent — never block on a missing envelope
    }
    if (!session) return { ok: true };

    // Revocation always wins. Re-read fresh from the DB on every single
    // call (not cached), so a revoke landing mid-tick — the user hitting
    // Revoke while several turns are still in flight — stops the very
    // next tool dispatch, not just the next tick.
    if (session.revoked_at) {
      return { ok: false, halt: true, reason: "revoked" };
    }

    const domain = domainForToolCall(call);
    if (domain) {
      let allowed = null;
      try {
        allowed = session.allowed_domains_json ? JSON.parse(session.allowed_domains_json) : null;
      } catch {
        allowed = null;
      }
      if (Array.isArray(allowed) && !allowed.includes(domain)) {
        // Refuse just THIS call — the marathon keeps running and the brain
        // sees a real, actionable refusal (not a crash, not a silent drop).
        return { ok: false, halt: false, reason: `domain_not_allowed:${domain}` };
      }
    }

    if (session.budget_cap != null && session.budget_spent >= session.budget_cap) {
      return { ok: false, halt: true, reason: "budget_exhausted" };
    }

    // This call is really about to execute — spend the budget now,
    // atomically, BEFORE the tool runs (not after: a crash/timeout mid-call
    // must never leave an approved call uncounted, and must never let the
    // same slot be double-spent on retry).
    try {
      db.prepare(`UPDATE agent_marathon_sessions SET budget_spent = budget_spent + 1 WHERE id = ?`).run(sessionId);
    } catch { /* budget_spent column absent — never block on it */ }
    return { ok: true };
  };
}

// ── Turn history compaction (bounds growth for very long marathon sessions) ─
//
// Grounding-audit gap (2026-07-24, migration 387): tickMarathon used to feed
// EVERY prior turn into the brain call with no cap. This mirrors the
// rolling-window pattern conversation-memory.js already uses for regular
// chat sessions (WINDOW_THRESHOLD=50 raw messages triggers a pass that folds
// the oldest COMPRESSION_BATCH=20 into a compact record, leaving a fixed-
// size tail) — the same trigger/batch numbers are reused here as sensible,
// already-battle-tested precedent rather than invented from scratch.
//
// Deliberate divergence from conversation-memory.js: that engine calls the
// Utility brain to extract insights/decisions/claims because its output is
// a searchable DTU a user might reference in a LATER, unrelated
// conversation. A marathon checkpoint has a narrower job — keep the SAME
// agent's own transcript coherent for itself so it can keep working — so
// this uses a pure deterministic condensation (no brain call, no fabricated
// content, built only from the real compacted turns' own text). That avoids
// adding a second async LLM dependency to a governance-critical path (every
// tick already makes one brain call via runAgentLoop) and keeps the
// mechanism byte-testable without live brain infra.
//
// The checkpoint is a single `role:'system', is_checkpoint:1` turn per
// session (migration 387). Re-compaction passes UPDATE that same row rather
// than inserting a new one, folding the newly-aged batch's topics/excerpts
// into the existing summary under a hard cap (MAX_CHECKPOINT_EXCERPTS /
// MAX_CHECKPOINT_TOPICS) — so the checkpoint's own size stays bounded no
// matter how many times a very long session re-compacts; it never grows
// without limit the way the raw-turn-per-tick approach did. Structured
// state (coversThroughTurnIndex, topics, excerpts) rides in the existing
// `tool_calls_json` column — a system checkpoint turn has no real tool
// calls, so that slot is otherwise unused. `content` is the deterministic
// rendered text actually fed to the brain as a {role, content} message —
// chat-agent.js's runAgentLoop needs no changes to understand it.

/** Raw (uncovered) turn count that triggers a compaction pass. Matches
 *  conversation-memory.js's WINDOW_THRESHOLD as precedent. */
export const MARATHON_HISTORY_THRESHOLD = Number(process.env.CONCORD_MARATHON_HISTORY_THRESHOLD) || 50;

/** How many of the oldest uncovered turns get folded in per pass. Matches
 *  conversation-memory.js's COMPRESSION_BATCH as precedent — leaves a tail
 *  of THRESHOLD - BATCH = 30 raw turns, matching ACTIVE_WINDOW there too. */
export const MARATHON_COMPRESSION_BATCH = Number(process.env.CONCORD_MARATHON_COMPRESSION_BATCH) || 20;

/** Hard cap on how many excerpt lines the rolling checkpoint ever carries —
 *  keeps the checkpoint's own rendered size bounded across unlimited
 *  re-compactions (bookended: oldest half + newest half kept on overflow). */
export const MAX_CHECKPOINT_EXCERPTS = 12;

/** Hard cap on distinct topics carried in the rolling checkpoint. */
export const MAX_CHECKPOINT_TOPICS = 8;

const CHECKPOINT_EXCERPT_MAX_LEN = 200;
const CHECKPOINT_RENDER_MAX_LEN = 4000;

/** Deterministic keyword-frequency topic extraction — no brain call, no
 *  invention; every returned topic is a word that actually appears in the
 *  compacted turns. Same technique as conversation-memory.js#extractFallback. */
function extractCheckpointTopics(turns) {
  const text = turns.map((t) => String(t.content || "")).join(" ").toLowerCase();
  const words = text.split(/\W+/).filter((w) => w.length > 4);
  const freq = new Map();
  for (const w of words) freq.set(w, (freq.get(w) || 0) + 1);
  return Array.from(freq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([w]) => w);
}

function renderCheckpoint(state) {
  const header = `[Marathon checkpoint — ${state.totalTurnsCompacted} earlier turn(s) condensed, through turn ${state.coversThroughTurnIndex}]`;
  const topicsLine = state.topics.length ? `Topics so far: ${state.topics.join(", ")}` : "";
  const excerptLines = state.excerpts.map((e) => `- ${e}`);
  return [header, topicsLine, ...excerptLines].filter(Boolean).join("\n").slice(0, CHECKPOINT_RENDER_MAX_LEN);
}

/** Fold a newly-aged batch of real turns into (or onto) the prior checkpoint
 *  state. Every excerpt/topic is derived from the batch's own real content —
 *  never invented. Overflow is bookended (keep the earliest + most recent
 *  excerpts) rather than simply truncated, so a checkpoint that's been
 *  re-compacted many times still shows both "how the session started" and
 *  "what it was doing most recently" instead of losing the start entirely. */
function mergeCheckpointState(prevState, newBatchTurns, coversThroughTurnIndex) {
  const newTopics = extractCheckpointTopics(newBatchTurns);
  const newExcerpts = newBatchTurns.map((t) =>
    `${t.role}: ${String(t.content || "").replace(/\s+/g, " ").trim().slice(0, CHECKPOINT_EXCERPT_MAX_LEN)}`
  );

  const topics = Array.from(new Set([...(prevState?.topics || []), ...newTopics])).slice(0, MAX_CHECKPOINT_TOPICS);

  let excerpts = [...(prevState?.excerpts || []), ...newExcerpts];
  if (excerpts.length > MAX_CHECKPOINT_EXCERPTS) {
    const keepHead = Math.ceil(MAX_CHECKPOINT_EXCERPTS / 2);
    const keepTail = MAX_CHECKPOINT_EXCERPTS - keepHead;
    excerpts = [...excerpts.slice(0, keepHead), ...excerpts.slice(-keepTail)];
  }

  return {
    checkpoint: true,
    coversThroughTurnIndex,
    totalTurnsCompacted: (prevState?.totalTurnsCompacted || 0) + newBatchTurns.length,
    topics,
    excerpts,
  };
}

/**
 * Fold the oldest MARATHON_COMPRESSION_BATCH not-yet-covered real turns of a
 * marathon session into the session's single rolling checkpoint turn, if the
 * uncovered count exceeds MARATHON_HISTORY_THRESHOLD. Never throws — a
 * failure here must never stop the marathon; callers just proceed with the
 * uncompressed history for this tick (identical to the pre-387 behavior).
 *
 * @returns {{ ok: boolean, compressed?: boolean, reason?: string, turnsCompacted?: number, coversThroughTurnIndex?: number }}
 */
export function compressMarathonHistory(db, sessionId) {
  try {
    if (!db || !sessionId) return { ok: false, reason: "missing_inputs" };

    let cols;
    try {
      cols = db.prepare(`PRAGMA table_info(agent_marathon_turns)`).all().map((c) => c.name);
    } catch {
      return { ok: false, reason: "table_missing" };
    }
    if (!cols.includes("is_checkpoint")) {
      // Pre-387 schema — no column to anchor a checkpoint on. Back-compat:
      // behave exactly as before (uncapped history), never throw.
      return { ok: false, reason: "pre_387_schema" };
    }

    const existingCheckpoint = db.prepare(`
      SELECT id, tool_calls_json FROM agent_marathon_turns
      WHERE session_id = ? AND is_checkpoint = 1
      ORDER BY turn_index ASC LIMIT 1
    `).get(sessionId);

    let prevState = null;
    if (existingCheckpoint?.tool_calls_json) {
      try { prevState = JSON.parse(existingCheckpoint.tool_calls_json); } catch { prevState = null; }
    }
    const coveredThrough = Number.isFinite(prevState?.coversThroughTurnIndex) ? prevState.coversThroughTurnIndex : -1;

    const uncovered = db.prepare(`
      SELECT turn_index, role, content FROM agent_marathon_turns
      WHERE session_id = ? AND role IN ('user','assistant') AND turn_index > ?
      ORDER BY turn_index ASC
    `).all(sessionId, coveredThrough);

    if (uncovered.length <= MARATHON_HISTORY_THRESHOLD) {
      return { ok: true, compressed: false, reason: "below_threshold" };
    }

    const toCompress = uncovered.slice(0, MARATHON_COMPRESSION_BATCH);
    const newCoversThrough = toCompress[toCompress.length - 1].turn_index;
    const state = mergeCheckpointState(prevState, toCompress, newCoversThrough);
    const rendered = renderCheckpoint(state);
    const stateJson = JSON.stringify(state);

    if (existingCheckpoint) {
      db.prepare(`
        UPDATE agent_marathon_turns SET content = ?, tool_calls_json = ? WHERE id = ?
      `).run(rendered, stateJson, existingCheckpoint.id);
    } else {
      // Anchor the checkpoint row's turn_index at the FIRST compacted turn's
      // index, so `ORDER BY turn_index ASC` places it exactly where that
      // batch used to sit — before the surviving tail, after anything
      // already folded in by an earlier pass.
      db.prepare(`
        INSERT INTO agent_marathon_turns
          (session_id, turn_index, role, content, tool_calls_json, is_checkpoint)
        VALUES (?, ?, 'system', ?, ?, 1)
      `).run(sessionId, toCompress[0].turn_index, rendered, stateJson);
    }

    return { ok: true, compressed: true, turnsCompacted: toCompress.length, coversThroughTurnIndex: newCoversThrough };
  } catch (err) {
    // Never let a compaction bug stop the marathon itself.
    return { ok: false, reason: "compression_error", error: err?.message };
  }
}

/**
 * Build the bounded `{ history, lastMessage }` tickMarathon feeds into
 * runAgentLoop. Runs compressMarathonHistory first (best-effort; never
 * throws) so a very long session's oldest turns fold into the single
 * rolling checkpoint BEFORE this tick's history is assembled. Below
 * MARATHON_HISTORY_THRESHOLD, this reads byte-identically to the pre-387
 * "every prior turn" query — the checkpoint filter is a strict superset
 * that's a no-op until a checkpoint actually exists.
 *
 * @param {object} db
 * @param {string} sessionId
 * @param {string} fallbackMessage - used as lastMessage if no turns exist yet
 * @returns {{ history: Array<{role:string, content:string}>, lastMessage: string }}
 */
export function buildMarathonHistory(db, sessionId, fallbackMessage) {
  compressMarathonHistory(db, sessionId);

  let cols = [];
  try { cols = db.prepare(`PRAGMA table_info(agent_marathon_turns)`).all().map((c) => c.name); } catch { /* handled by hasCheckpointColumn below */ }
  const hasCheckpointColumn = cols.includes("is_checkpoint");

  let coveredThrough = -1;
  if (hasCheckpointColumn) {
    const cp = db.prepare(`
      SELECT tool_calls_json FROM agent_marathon_turns
      WHERE session_id = ? AND is_checkpoint = 1 ORDER BY turn_index ASC LIMIT 1
    `).get(sessionId);
    if (cp?.tool_calls_json) {
      try {
        const state = JSON.parse(cp.tool_calls_json);
        if (Number.isFinite(state?.coversThroughTurnIndex)) coveredThrough = state.coversThroughTurnIndex;
      } catch { /* malformed state — treat as no checkpoint coverage */ }
    }
  }

  const rows = hasCheckpointColumn
    ? db.prepare(`
        SELECT turn_index, role, content FROM agent_marathon_turns
        WHERE session_id = ? AND (
          is_checkpoint = 1
          OR (role IN ('user','assistant') AND turn_index > ?)
        )
        ORDER BY turn_index ASC
      `).all(sessionId, coveredThrough)
    : db.prepare(`
        SELECT turn_index, role, content FROM agent_marathon_turns
        WHERE session_id = ? AND role IN ('user','assistant')
        ORDER BY turn_index ASC
      `).all(sessionId);

  const priorTurns = rows.map((t) => ({ role: t.role, content: t.content }));
  const history = priorTurns.slice(0, -1);
  const lastMessage = priorTurns[priorTurns.length - 1]?.content || fallbackMessage;
  return { history, lastMessage };
}

export async function tickMarathon({ db, sessionId, runMacro, lensActions, opts = {} }) {
  if (!db || !sessionId) return { ok: false, reason: "missing_inputs" };
  const session = db.prepare(`SELECT * FROM agent_marathon_sessions WHERE id = ?`).get(sessionId);
  if (!session) return { ok: false, reason: "session_not_found" };
  if (["completed", "abandoned", "failed", "revoked"].includes(session.status)) {
    return { ok: true, alreadyTerminal: true, status: session.status };
  }
  // Governance envelope (mig 379) — revocation checked BEFORE this tick does
  // any work at all. `session.revoked_at` comes from the `SELECT *` above,
  // so this is a no-op (undefined, falsy) against a pre-migration-379 /
  // hand-rolled minimal test schema — same back-compat contract as
  // startMarathon's insert fallback. The mid-tick gate below is the second,
  // load-bearing check: a revoke landing WHILE this tick's runAgentLoop is
  // still in flight (several turns/tool calls deep) is caught there too.
  if (session.revoked_at) {
    db.prepare(`UPDATE agent_marathon_sessions SET status = 'revoked', updated_at = unixepoch() WHERE id = ?`).run(sessionId);
    return { ok: true, status: "revoked", reason: "revoked" };
  }
  if (session.total_turns >= session.max_turns) {
    db.prepare(`UPDATE agent_marathon_sessions SET status = 'failed', updated_at = unixepoch() WHERE id = ?`).run(sessionId);
    return { ok: true, status: "failed", reason: "max_turns_exceeded" };
  }

  // Wave 7 / Track B4 — "feeling decides when to think". If the caller supplies the
  // agent's live self-state (opts.salienceGate), only spend an expensive deliberation
  // turn on a tier-3 wake (a real dilemma / affect spike / human contact); otherwise the
  // agent stays on cheap instinct/routine this tick. Opt-in + reversible
  // (CONCORD_AFFECT_SALIENCE=0) — absent gate → always deliberate (prior behaviour).
  if (opts.salienceGate && process.env.CONCORD_AFFECT_SALIENCE !== "0") {
    try {
      const { decideDeliberation } = await import("./agent-brain-loop.js");
      const g = opts.salienceGate;
      const d = decideDeliberation(g.self, g.world, g.others, g.prior, g.opts);
      if (!d.deliberate) {
        return { ok: true, deliberated: false, reason: `instinct:${d.reason}`, tier: d.tier };
      }
    } catch { /* gate optional → fall through and deliberate */ }
  }

  // Wave 7 / Track B6 — this IS a tier-3 wake (we got past the gate, so the agent is
  // deliberating). Run the awareness loop ONCE: attend → read self-model + interoception
  // → predict-error → write a durable reasoning trace + the awareness-index sample.
  // Env-gated CONCORD_AWARENESS_LOOP; never throws; purely additive to the deliberation.
  if (opts.salienceGate && process.env.CONCORD_AWARENESS_LOOP === "1") {
    try {
      const { runAwarenessLoop } = await import("./awareness-loop.js");
      const g = opts.salienceGate;
      runAwarenessLoop({ force: true, db, agentId: g.agentId || session.user_id, self: g.self, world: g.world, others: g.others, prior: g.prior, system: g.system, prediction: g.prediction, actual: g.actual });
    } catch { /* awareness loop is best-effort — never blocks the marathon */ }
  }

  // Mark running.
  db.prepare(`UPDATE agent_marathon_sessions SET status = 'running', updated_at = unixepoch() WHERE id = ?`).run(sessionId);

  // Build history from prior turns — bounded via buildMarathonHistory
  // (migration 387): once a very long session's raw turn count exceeds
  // MARATHON_HISTORY_THRESHOLD, the oldest MARATHON_COMPRESSION_BATCH turns
  // fold into a single rolling checkpoint turn (mirrors conversation-
  // memory.js's rolling-window pattern), so the brain-call history stays
  // bounded no matter how many days a marathon runs. Below the threshold
  // this is byte-identical to the pre-387 "every prior turn" query.
  // The first user-turn is the goal; subsequent are tool-result responses.
  const { history, lastMessage } = buildMarathonHistory(db, sessionId, session.goal);

  const tickTurns = Math.min(opts.tickTurns || DEFAULT_TICK_TURNS, session.max_turns - session.total_turns);

  // Governance envelope (mig 379) — the real, enforced gate. Passed into
  // runAgentLoop's opt-in `opts.toolGate` hook so it runs immediately
  // before EVERY real tool dispatch this tick makes, not just once at the
  // top of the tick. `opts.brainChat` passthrough is test-only (never
  // exposed via the agent_marathon.tick macro/HTTP surface) — it lets
  // tests script the brain's replies deterministically, matching the
  // existing pattern in tests/agent-action-memory-wire.test.js.
  const toolGate = createToolGate(db, sessionId);

  const result = await runAgentLoop({
    db,
    userId: session.user_id,
    message: lastMessage,
    runMacro,
    lensActions,
    history,
    opts: { maxTurns: tickTurns, slot: opts.slot, sessionId, toolGate, brainChat: opts.brainChat },
  });

  if (!result.ok) {
    db.prepare(`UPDATE agent_marathon_sessions SET status = 'paused', updated_at = unixepoch() WHERE id = ?`).run(sessionId);
    return { ok: false, status: "paused", error: result.error };
  }

  // Persist the new assistant turn (or any tool-call turns the loop emitted).
  let nextTurnIndex = session.total_turns + 1;
  db.prepare(`
    INSERT INTO agent_marathon_turns
      (session_id, turn_index, role, content, tool_calls_json, artifacts_json, provider, model)
    VALUES (?, ?, 'assistant', ?, ?, ?, ?, ?)
  `).run(
    sessionId, nextTurnIndex,
    result.answer || "",
    JSON.stringify(result.toolCalls || []),
    JSON.stringify(result.artifacts || []),
    result.provider || null,
    result.model || null,
  );
  nextTurnIndex++;

  const totalTurns = session.total_turns + result.turns;

  // Check for termination markers. A governance halt (revoked mid-tick, or
  // the spend budget was exhausted mid-tick) ALWAYS wins over a
  // COMPLETE/BLOCKED marker the brain happened to also emit this turn —
  // the tick already stopped for real inside runAgentLoop, so the status
  // must honestly reflect that, not whatever text came back.
  let nextStatus = "running";
  if (result.halted) {
    nextStatus = result.haltReason === "revoked" ? "revoked" : "failed";
  } else if (COMPLETE_MARKER.test(result.answer || "")) {
    nextStatus = "completed";
  } else if (BLOCKED_MARKER.test(result.answer || "")) {
    nextStatus = "paused";
  }

  const nextTickAt = nextStatus === "running"
    ? Math.floor(Date.now() / 1000) + (opts.tickIntervalS || DEFAULT_TICK_INTERVAL_S)
    : Math.floor(Date.now() / 1000);

  db.prepare(`
    UPDATE agent_marathon_sessions
    SET total_turns = ?, status = ?, updated_at = unixepoch(),
        completed_at = CASE WHEN ? = 'completed' THEN unixepoch() ELSE completed_at END,
        next_tick_at = ?
    WHERE id = ?
  `).run(totalTurns, nextStatus, nextStatus, nextTickAt, sessionId);

  // Sprint 13 — terminal-status hooks. When a marathon completes or
  // gets blocked, fire an initiative engine event so the user's bell
  // lights up ("your marathon refactor is done" / "I'm blocked on X").
  // Best-effort; the marathon itself succeeds whether or not the
  // initiative engine is wired.
  if (nextStatus === "completed" || nextStatus === "paused" || nextStatus === "revoked" || (result.halted && nextStatus === "failed")) {
    emitMarathonStatus(session, sessionId, nextStatus, totalTurns);
    try {
      // Direct insert into initiative engine table if present — the
      // bell polls /api/initiative/pending which reads from there.
      const trigger = nextStatus === "completed" ? "pending_work" : "reflective_followup";
      const msg = nextStatus === "completed"
        ? `Marathon complete: "${session.title}" finished after ${totalTurns} turns.`
        : nextStatus === "revoked"
          ? `Marathon revoked: "${session.title}" was stopped by revocation after ${totalTurns} turns.`
          : (result.halted && nextStatus === "failed")
            ? `Marathon halted: "${session.title}" hit its spend/action budget cap after ${totalTurns} turns.`
            : `Marathon paused: "${session.title}" hit a block at turn ${totalTurns}. Reason in the answer body.`;
      try {
        const initId = `init_mar_${sessionId.slice(4, 16)}_${Date.now().toString(36)}`;
        db.prepare(`
          INSERT INTO initiatives (id, user_id, trigger_type, priority, message, status, created_at)
          VALUES (?, ?, ?, 'normal', ?, 'pending', unixepoch())
        `).run(initId, session.user_id, trigger, msg);
      } catch { /* initiatives table optional in test setups */ }
    } catch { /* never block on telemetry */ }
  }

  return {
    ok: true,
    sessionId,
    status: nextStatus,
    newTurns: result.turns,
    totalTurns,
    answer: result.answer,
    toolCalls: result.toolCalls,
    artifacts: result.artifacts,
    provider: result.provider,
    model: result.model,
    ...(result.halted ? { halted: true, haltReason: result.haltReason } : {}),
  };
}

/** Find sessions that should auto-tick (status='running' AND next_tick_at <= now). */
export function findDueMarathons(db, opts = {}) {
  if (!db) return [];
  const limit = Math.min(20, opts.limit || 5);
  try {
    return db.prepare(`
      SELECT id FROM agent_marathon_sessions
      WHERE status = 'running' AND next_tick_at <= unixepoch()
      ORDER BY next_tick_at ASC
      LIMIT ?
    `).all(limit);
  } catch {
    return [];
  }
}

export function pauseMarathon(db, sessionId) {
  if (!db || !sessionId) return { ok: false, reason: "missing_inputs" };
  db.prepare(`UPDATE agent_marathon_sessions SET status = 'paused', updated_at = unixepoch() WHERE id = ?`).run(sessionId);
  return { ok: true };
}

export function abandonMarathon(db, sessionId) {
  if (!db || !sessionId) return { ok: false, reason: "missing_inputs" };
  db.prepare(`UPDATE agent_marathon_sessions SET status = 'abandoned', updated_at = unixepoch() WHERE id = ?`).run(sessionId);
  return { ok: true };
}

/**
 * Owner-only, real-time stop for a marathon (mig 379 governance envelope).
 * Distinct from `abandonMarathon` above: abandon only flips `status`, which
 * stops FUTURE ticks (findDueMarathons filters on status='running') but
 * does nothing about a tick that's already mid-flight — the old
 * pause/abandon pair never checked status again once a tick's runAgentLoop
 * call started. `revokeMarathon` additionally sets `revoked_at`, which
 * `createToolGate` re-reads fresh from the DB before every single tool
 * dispatch — so a revoke lands on the very next tool call even if the
 * current tick is several turns deep, not just on the next tick.
 *
 * Ownership check mirrors the one real ownership check already in this
 * file (the `agent_marathon.get` macro's `session.user_id !== userId`) —
 * pause/abandon predate that check and don't verify ownership at the lib
 * layer; revoke is new and gets it right from the start.
 */
export function revokeMarathon(db, sessionId, userId) {
  if (!db || !sessionId || !userId) return { ok: false, reason: "missing_inputs" };
  const session = db.prepare(`SELECT user_id, status FROM agent_marathon_sessions WHERE id = ?`).get(sessionId);
  if (!session) return { ok: false, reason: "not_found" };
  if (session.user_id !== userId) return { ok: false, reason: "not_owner" };
  if (["completed", "abandoned", "revoked", "failed"].includes(session.status)) {
    return { ok: false, reason: "already_terminal", status: session.status };
  }
  try {
    db.prepare(`
      UPDATE agent_marathon_sessions
      SET revoked_at = unixepoch(), status = 'revoked', updated_at = unixepoch()
      WHERE id = ?
    `).run(sessionId);
  } catch {
    // Pre-migration-379 schema (no revoked_at column to enforce against) —
    // an honest failure, never a fabricated success: the caller needs to
    // know revocation did NOT actually get recorded/enforced.
    return { ok: false, reason: "governance_columns_missing" };
  }
  return { ok: true, sessionId, status: "revoked" };
}

function safeParse(s) {
  try { return JSON.parse(s); } catch { return []; }
}

// Governance envelope (mig 379) — sane non-null default for the "New
// marathon" UI's budget-cap field (MarathonPanel.tsx). Per-tick a marathon
// can run up to DEFAULT_TICK_TURNS turns with up to 5 tool calls each
// (chat-agent.js caps at `calls.slice(0, 5)`); DEFAULT_BUDGET_CAP gives a
// long-running session real room to work (well beyond DEFAULT_MAX_TURNS'
// own scale) while still being a REAL ceiling instead of "unrestricted" —
// the user must explicitly opt into unrestricted, not get it by default.
const DEFAULT_BUDGET_CAP = 150;

export const MARATHON_CONSTANTS = Object.freeze({
  DEFAULT_TICK_TURNS, DEFAULT_MAX_TURNS, DEFAULT_TICK_INTERVAL_S, DEFAULT_BUDGET_CAP,
  MARATHON_HISTORY_THRESHOLD, MARATHON_COMPRESSION_BATCH, MAX_CHECKPOINT_EXCERPTS, MAX_CHECKPOINT_TOPICS,
});
