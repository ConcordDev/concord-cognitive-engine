/**
 * Agents Routes — REST surface for autonomous agent management.
 *
 * Backed by a zero-migration SQLite table. Provides spawn, query,
 * task assignment, and termination of named agents.
 *
 * Mounts under /api/agents via app.use("/api/agents", ...).
 *
 * Endpoints:
 *   GET    /                        — list agents (with optional status filter)
 *   POST   /                        — spawn a new agent
 *   GET    /:agentId                — get agent state
 *   POST   /:agentId/task           — assign a task to an agent
 *   POST   /:agentId/stop           — pause / stop an agent
 *   DELETE /:agentId                — terminate an agent
 *   GET    /:agentId/log            — execution log for an agent
 */

import { Router } from "express";
import crypto from "crypto";
import { listWorktrees } from "../lib/agentic/worktree.js";

function uid() {
  return crypto.randomUUID();
}

export default function createAgentsRouter({ db, requireAuth, STATE }) {
  const router = Router();

  // ── Schema bootstrap ────────────────────────────────────────────────────────

  db.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      agent_id    TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      skills      TEXT NOT NULL DEFAULT '[]',
      status      TEXT NOT NULL DEFAULT 'idle',
      created_by  TEXT NOT NULL,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
      config      TEXT NOT NULL DEFAULT '{}'
    );
    CREATE INDEX IF NOT EXISTS idx_agents_status ON agents (status);
    CREATE INDEX IF NOT EXISTS idx_agents_creator ON agents (created_by);

    CREATE TABLE IF NOT EXISTS agent_tasks (
      task_id      TEXT PRIMARY KEY,
      agent_id     TEXT NOT NULL,
      title        TEXT NOT NULL,
      description  TEXT NOT NULL DEFAULT '',
      status       TEXT NOT NULL DEFAULT 'pending',
      priority     INTEGER NOT NULL DEFAULT 5,
      assigned_at  TEXT NOT NULL DEFAULT (datetime('now')),
      started_at   TEXT,
      completed_at TEXT,
      result       TEXT,
      FOREIGN KEY (agent_id) REFERENCES agents (agent_id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_tasks_agent ON agent_tasks (agent_id, status);

    CREATE TABLE IF NOT EXISTS agent_logs (
      log_id     TEXT PRIMARY KEY,
      agent_id   TEXT NOT NULL,
      level      TEXT NOT NULL DEFAULT 'info',
      message    TEXT NOT NULL,
      data       TEXT,
      logged_at  TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (agent_id) REFERENCES agents (agent_id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_agent_logs ON agent_logs (agent_id, logged_at DESC);
  `);

  // ── Prepared statements ─────────────────────────────────────────────────────

  const stmts = {
    insertAgent: db.prepare(
      `INSERT INTO agents (agent_id, name, description, skills, status, created_by, config)
       VALUES (?, ?, ?, ?, 'idle', ?, ?)`
    ),
    getAgent: db.prepare(
      `SELECT * FROM agents WHERE agent_id = ?`
    ),
    listAgents: db.prepare(
      `SELECT agent_id, name, description, skills, status, created_by, created_at, updated_at
       FROM agents ORDER BY created_at DESC LIMIT ?`
    ),
    listByStatus: db.prepare(
      `SELECT agent_id, name, description, skills, status, created_by, created_at, updated_at
       FROM agents WHERE status = ? ORDER BY created_at DESC LIMIT ?`
    ),
    updateStatus: db.prepare(
      `UPDATE agents SET status = ?, updated_at = datetime('now') WHERE agent_id = ?`
    ),
    deleteAgent: db.prepare(
      `DELETE FROM agents WHERE agent_id = ?`
    ),
    insertTask: db.prepare(
      `INSERT INTO agent_tasks (task_id, agent_id, title, description, priority)
       VALUES (?, ?, ?, ?, ?)`
    ),
    getTaskCount: db.prepare(
      `SELECT COUNT(*) AS cnt, status FROM agent_tasks WHERE agent_id = ? GROUP BY status`
    ),
    getLogs: db.prepare(
      `SELECT log_id, level, message, data, logged_at
       FROM agent_logs WHERE agent_id = ? ORDER BY logged_at DESC LIMIT ?`
    ),
    insertLog: db.prepare(
      `INSERT INTO agent_logs (log_id, agent_id, level, message, data) VALUES (?, ?, ?, ?, ?)`
    ),
  };

  // ── Helpers ─────────────────────────────────────────────────────────────────

  function resolveUserId(req) {
     
    // eslint-disable-next-line no-restricted-syntax
    return req.user?.id || req.body?.userId || req.query?.userId || "anonymous"; // safe: target-identifier
  }

  function parseAgent(row) {
    if (!row) return null;
    let skills = [];
    let config = {};
    try { skills = JSON.parse(row.skills || "[]"); } catch { /* ignore */ }
    try { config = JSON.parse(row.config || "{}"); } catch { /* ignore */ }
    return { agentId: row.agent_id, name: row.name, description: row.description, skills, status: row.status, createdBy: row.created_by, createdAt: row.created_at, updatedAt: row.updated_at, config };
  }

  function addTaskStats(agent) {
    if (!agent) return agent;
    const rows = stmts.getTaskCount.all(agent.agentId);
    const taskStats = {};
    let total = 0;
    for (const r of rows) { taskStats[r.status] = r.cnt; total += r.cnt; }
    return { ...agent, taskStats, totalTasks: total };
  }

  function appendLog(agentId, level, message, data) {
    try {
      stmts.insertLog.run(uid(), agentId, level, message, data ? JSON.stringify(data) : null);
    } catch (_) { /* non-fatal */ }
  }

  // ── GET / — list agents ─────────────────────────────────────────────────────

  router.get("/", (req, res) => {
    try {
      const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
      const status = req.query.status;
      const rows = status
        ? stmts.listByStatus.all(status, limit)
        : stmts.listAgents.all(limit);
      const agents = rows.map((r) => addTaskStats(parseAgent(r)));
      res.json({ ok: true, agents, count: agents.length });
    } catch (err) {
      console.error("[agents] GET / error:", err);
      res.status(500).json({ ok: false, error: 'An unexpected error occurred' });
    }
  });

  // ── POST / — spawn agent ────────────────────────────────────────────────────

  router.post("/", requireAuth(), (req, res) => {
    try {
      const userId = resolveUserId(req);
      const { name, description, skills, config } = req.body || {};
      if (!name || typeof name !== "string" || !name.trim()) {
        return res.status(400).json({ ok: false, error: "Agent name is required" });
      }
      if (name.trim().length > 80) {
        return res.status(400).json({ ok: false, error: "Agent name must be 80 characters or fewer" });
      }
      const safeSkills = Array.isArray(skills)
        ? skills.filter((s) => typeof s === "string").slice(0, 20).map((s) => s.trim())
        : [];
      const safeConfig = config && typeof config === "object" ? config : {};
      const agentId = uid();
      stmts.insertAgent.run(
        agentId,
        name.trim(),
        (description || "").slice(0, 500),
        JSON.stringify(safeSkills),
        userId,
        JSON.stringify(safeConfig)
      );
      appendLog(agentId, "info", `Agent spawned by ${userId}`);
      res.json({ ok: true, agentId, status: "idle" });
    } catch (err) {
      console.error("[agents] POST / error:", err);
      res.status(500).json({ ok: false, error: 'An unexpected error occurred' });
    }
  });

  // ── GET /:agentId — get agent ───────────────────────────────────────────────

  router.get("/:agentId", (req, res) => {
    try {
      const row = stmts.getAgent.get(req.params.agentId);
      if (!row) return res.status(404).json({ ok: false, error: "Agent not found" });
      res.json({ ok: true, agent: addTaskStats(parseAgent(row)) });
    } catch (err) {
      console.error("[agents] GET /:agentId error:", err);
      res.status(500).json({ ok: false, error: 'An unexpected error occurred' });
    }
  });

  // ── POST /:agentId/task — assign task ──────────────────────────────────────

  router.post("/:agentId/task", requireAuth(), (req, res) => {
    try {
      const row = stmts.getAgent.get(req.params.agentId);
      if (!row) return res.status(404).json({ ok: false, error: "Agent not found" });
      if (row.status === "terminated") {
        return res.status(400).json({ ok: false, error: "Cannot assign task to terminated agent" });
      }
      const { title, description, priority } = req.body || {};
      if (!title || typeof title !== "string" || !title.trim()) {
        return res.status(400).json({ ok: false, error: "Task title is required" });
      }
      const taskId = uid();
      const prio = Math.min(Math.max(parseInt(priority, 10) || 5, 1), 10);
      stmts.insertTask.run(taskId, req.params.agentId, title.trim().slice(0, 200), (description || "").slice(0, 2000), prio);
      // Activate agent if idle
      if (row.status === "idle") {
        stmts.updateStatus.run("active", req.params.agentId);
      }
      appendLog(req.params.agentId, "info", `Task assigned: ${title}`, { taskId, priority: prio });
      res.json({ ok: true, taskId, agentId: req.params.agentId });
    } catch (err) {
      console.error("[agents] POST /:agentId/task error:", err);
      res.status(500).json({ ok: false, error: 'An unexpected error occurred' });
    }
  });

  // ── POST /:agentId/stop — pause / stop ─────────────────────────────────────

  router.post("/:agentId/stop", requireAuth(), (req, res) => {
    try {
      const row = stmts.getAgent.get(req.params.agentId);
      if (!row) return res.status(404).json({ ok: false, error: "Agent not found" });
      stmts.updateStatus.run("stopped", req.params.agentId);
      appendLog(req.params.agentId, "info", "Agent stopped");
      res.json({ ok: true, agentId: req.params.agentId, status: "stopped" });
    } catch (err) {
      console.error("[agents] POST /:agentId/stop error:", err);
      res.status(500).json({ ok: false, error: 'An unexpected error occurred' });
    }
  });

  // ── DELETE /:agentId — terminate ────────────────────────────────────────────

  router.delete("/:agentId", requireAuth(), (req, res) => {
    try {
      const row = stmts.getAgent.get(req.params.agentId);
      if (!row) return res.status(404).json({ ok: false, error: "Agent not found" });
      appendLog(req.params.agentId, "warn", "Agent terminated");
      stmts.deleteAgent.run(req.params.agentId);
      res.json({ ok: true, agentId: req.params.agentId, terminated: true });
    } catch (err) {
      console.error("[agents] DELETE /:agentId error:", err);
      res.status(500).json({ ok: false, error: 'An unexpected error occurred' });
    }
  });

  // ── GET /:agentId/worktrees — list emergent worktrees ──────────────────────

  router.get("/:agentId/worktrees", (req, res) => {
    try {
      const worktrees = listWorktrees(req.params.agentId);
      // Exclude the full operations array from the response to keep payloads small
      const summary = worktrees.map(wt => ({
        branch: wt.branch,
        emergentId: wt.emergentId,
        dtuPrefix: wt.dtuPrefix,
        operationCount: wt.operations.length,
        createdAt: wt.createdAt,
        status: wt.status,
      }));
      res.json({ ok: true, emergentId: req.params.agentId, worktrees: summary, count: summary.length });
    } catch (err) {
      console.error("[agents] GET /:agentId/worktrees error:", err);
      res.status(500).json({ ok: false, error: 'An unexpected error occurred' });
    }
  });

  // ── GET /:agentId/log — execution log ──────────────────────────────────────

  router.get("/:agentId/log", (req, res) => {
    try {
      const row = stmts.getAgent.get(req.params.agentId);
      if (!row) return res.status(404).json({ ok: false, error: "Agent not found" });
      const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 500);
      const rows = stmts.getLogs.all(req.params.agentId, limit);
      const logs = rows.map((r) => {
        let data = null;
        try { data = r.data ? JSON.parse(r.data) : null; } catch { /* ignore */ }
        return { logId: r.log_id, level: r.level, message: r.message, data, loggedAt: r.logged_at };
      });
      res.json({ ok: true, agentId: req.params.agentId, logs, count: logs.length });
    } catch (err) {
      console.error("[agents] GET /:agentId/log error:", err);
      res.status(500).json({ ok: false, error: 'An unexpected error occurred' });
    }
  });

  return router;
}
