// server/lib/tools/sandbox-manager.js
// Manages sandbox agent workspace lifecycle.
// Sandboxes provide isolated environments for Computer Use (browser) and code execution.

import crypto from "node:crypto";

/**
 * Create a new sandbox workspace record.
 * @param {object} db
 * @param {object} opts
 * @param {string} opts.userId
 * @param {string} [opts.agentId]
 * @param {string} [opts.threadId]
 * @param {string} [opts.name]
 * @param {'browser'|'desktop'|'code'|'general'} [opts.sandboxType]
 * @param {object} [opts.config]
 * @returns {{ sandboxId: string }}
 */
export function createSandbox(db, { userId, agentId, threadId, name = "workspace", sandboxType = "browser", config = {} }) {
  const id = `sb_${crypto.randomBytes(8).toString("hex")}`;
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO sandbox_workspaces
    (id, user_id, agent_id, thread_id, name, status, sandbox_type, config_json, created_at, last_active_at)
    VALUES (?, ?, ?, ?, ?, 'ready', ?, ?, ?, ?)
  `).run(id, userId, agentId || null, threadId || null, name, sandboxType, JSON.stringify(config), now, now);

  return { sandboxId: id };
}

/**
 * Get a sandbox by ID, verifying ownership.
 */
export function getSandbox(db, sandboxId, userId) {
  try {
    const row = db.prepare(`SELECT * FROM sandbox_workspaces WHERE id = ?`).get(sandboxId);
    if (!row) return null;
    if (userId && row.user_id !== userId) return null;
    return { ...row, config: JSON.parse(row.config_json || "{}") };
  } catch {
    return null;
  }
}

/**
 * List active sandboxes for a user.
 */
export function listSandboxes(db, userId, { includeTerminated = false } = {}) {
  try {
    const statusFilter = includeTerminated ? "" : "AND status != 'terminated'";
    return db.prepare(`
      SELECT id, name, status, sandbox_type, created_at, last_active_at, entry_url
      FROM sandbox_workspaces
      WHERE user_id = ? ${statusFilter}
      ORDER BY last_active_at DESC
      LIMIT 50
    `).all(userId);
  } catch {
    return [];
  }
}

/**
 * Record a sandbox action (for audit trail).
 */
export function recordSandboxAction(db, workspaceId, actionType, args, result, error, durationMs) {
  try {
    const id = `sa_${crypto.randomBytes(8).toString("hex")}`;
    db.prepare(`
      INSERT INTO sandbox_actions (id, workspace_id, action_type, action_args_json, result_json, error, duration_ms, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, workspaceId, actionType,
      JSON.stringify(args || {}),
      result ? JSON.stringify(result) : null,
      error || null,
      durationMs || null,
      new Date().toISOString()
    );
  } catch { /* non-fatal */ }
}

/**
 * Pause a sandbox — snapshot its state for later resumption.
 */
export function pauseSandbox(db, sandboxId) {
  db.prepare(`
    UPDATE sandbox_workspaces SET status = 'paused', last_active_at = ?
    WHERE id = ? AND status IN ('ready','running')
  `).run(new Date().toISOString(), sandboxId);
}

/**
 * Resume a paused sandbox.
 */
export function resumeSandbox(db, sandboxId) {
  db.prepare(`
    UPDATE sandbox_workspaces SET status = 'ready', last_active_at = ?
    WHERE id = ? AND status = 'paused'
  `).run(new Date().toISOString(), sandboxId);
}

/**
 * Terminate a sandbox and mark it as closed.
 */
export function terminateSandbox(db, sandboxId) {
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE sandbox_workspaces SET status = 'terminated', terminated_at = ?, last_active_at = ?
    WHERE id = ?
  `).run(now, now, sandboxId);
}

/**
 * Clean up old terminated sandboxes (call periodically).
 */
export function pruneTerminatedSandboxes(db, olderThanDays = 7) {
  try {
    const cutoff = new Date(Date.now() - olderThanDays * 86400000).toISOString();
    const result = db.prepare(`
      DELETE FROM sandbox_workspaces WHERE status = 'terminated' AND terminated_at < ?
    `).run(cutoff);
    return result.changes;
  } catch {
    return 0;
  }
}
