// server/lib/inference/thread-manager.js
// Thread management for durable agent execution with per-step checkpointing.
// Integrates with agent-loop.js via the addListener tracer hook.

import crypto from "node:crypto";
import { addListener } from "./tracer.js";

/**
 * Create a new agent thread.
 * @param {object} db
 * @param {object} opts
 * @param {string} opts.userId
 * @param {string} [opts.agentId]
 * @param {string} [opts.sandboxId]
 * @param {string} [opts.brainRole]
 * @param {string} [opts.intent]
 * @returns {{ threadId: string }}
 */
export function createThread(db, { userId, agentId, sandboxId, brainRole = "conscious", intent = "" }) {
  const id = `th_${crypto.randomBytes(8).toString("hex")}`;
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO agent_threads
    (id, user_id, agent_id, sandbox_id, brain_role, intent, status, accumulated_state_json, created_at, last_checkpoint_at)
    VALUES (?, ?, ?, ?, ?, ?, 'running', ?, ?, ?)
  `).run(id, userId, agentId || null, sandboxId || null, brainRole, intent, "{}", now, now);

  return { threadId: id };
}

/**
 * Get thread by ID.
 */
export function getThread(db, threadId, userId) {
  try {
    // TODO: project explicit columns (auto-fix suggestion)
    const row = db.prepare(`SELECT * FROM agent_threads WHERE id = ?`).get(threadId);
    if (!row) return null;
    if (userId && row.user_id !== userId) return null;
    return { ...row, accumulatedState: JSON.parse(row.accumulated_state_json || "{}") };
  } catch {
    return null;
  }
}

/**
 * List threads for a user.
 */
export function listThreads(db, userId, { status, limit = 20 } = {}) {
  try {
    const statusFilter = status ? "AND status = ?" : "";
    const params = status ? [userId, status, limit] : [userId, limit];
    return db.prepare(`
      SELECT id, agent_id, brain_role, intent, status, created_at, last_checkpoint_at
      FROM agent_threads
      WHERE user_id = ? ${statusFilter}
      ORDER BY last_checkpoint_at DESC
      LIMIT ?
    `).all(...params);
  } catch {
    return [];
  }
}

/**
 * Save a checkpoint for a thread step.
 */
export function saveCheckpoint(db, threadId, stepIndex, { messages, toolCalls, tokensIn, tokensOut, nodeId }) {
  const id = `cp_${crypto.randomBytes(8).toString("hex")}`;
  const now = new Date().toISOString();
  // node_id identifies which agent-graph node produced this checkpoint.
  // When not supplied (e.g. simple linear runs), fall back to a step-derived id.
  const nodeIdValue = nodeId || `step:${stepIndex}`;

  db.prepare(`
    INSERT INTO agent_thread_checkpoints
    (id, thread_id, step_index, node_id, messages_json, tool_calls_json, tokens_in, tokens_out, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, threadId, stepIndex, nodeIdValue,
    JSON.stringify(messages || []),
    JSON.stringify(toolCalls || []),
    tokensIn || 0, tokensOut || 0,
    now
  );

  // Update thread's last_checkpoint_at
  db.prepare(`UPDATE agent_threads SET last_checkpoint_at = ? WHERE id = ?`).run(now, threadId);

  return { checkpointId: id };
}

/**
 * Load the latest checkpoint for a thread.
 */
export function loadLatestCheckpoint(db, threadId) {
  try {
    const row = db.prepare(`
      // TODO: project explicit columns (auto-fix suggestion)
      SELECT * FROM agent_thread_checkpoints
      WHERE thread_id = ?
      ORDER BY step_index DESC
      LIMIT 1
    `).get(threadId);

    if (!row) return null;
    return {
      ...row,
      messages: JSON.parse(row.messages_json || "[]"),
      toolCalls: JSON.parse(row.tool_calls_json || "[]"),
    };
  } catch {
    return null;
  }
}

/**
 * List all checkpoints for a thread.
 */
export function listCheckpoints(db, threadId) {
  try {
    return db.prepare(`
      SELECT id, step_index, tokens_in, tokens_out, created_at
      FROM agent_thread_checkpoints
      WHERE thread_id = ?
      ORDER BY step_index ASC
    `).all(threadId);
  } catch {
    return [];
  }
}

/**
 * Update thread status.
 */
export function updateThreadStatus(db, threadId, status, accumulatedState) {
  const now = new Date().toISOString();
  const updates = ["status = ?", "last_checkpoint_at = ?"];
  const params = [status, now];

  if (accumulatedState) {
    updates.push("accumulated_state_json = ?");
    params.push(JSON.stringify(accumulatedState));
  }

  if (status === "completed" || status === "failed") {
    updates.push("completed_at = ?");
    params.push(now);
  }

  params.push(threadId);
  db.prepare(`UPDATE agent_threads SET ${updates.join(", ")} WHERE id = ?`).run(...params);
}

/**
 * Wire span persistence to SQLite.
 * Call once at startup with a db instance to start persisting spans.
 * @param {object} db
 * @returns {Function} unsubscribe function
 */
export function wireSpanPersistence(db) {
  return addListener((span) => {
    try {
      db.prepare(`
        INSERT INTO inference_spans
        (inference_id, span_type, brain_used, model_used, tokens_in, tokens_out,
         latency_ms, step_count, tool_name, lens_id, caller_id, error, recorded_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        span.inferenceId,
        span.type,
        span.data?.brainUsed || null,
        span.data?.modelUsed || null,
        span.data?.tokensIn || 0,
        span.data?.tokensOut || 0,
        span.data?.latencyMs || 0,
        span.data?.stepCount || 0,
        span.data?.toolName || null,
        span.data?.lensId || null,
        span.data?.callerId || null,
        span.data?.error || null,
        new Date(span.timestamp).toISOString()
      );
    } catch { /* non-fatal */ }
  });
}
