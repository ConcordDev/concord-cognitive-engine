/**
 * Per-user memory routes (Settings > Memory). Mounted at /api/user-memory.
 *
 * Every handler takes the user from the session (req.user.id), never from the body, query or path, and talks to
 * the store only through lib/user-memory.js (which binds user_id on every statement). Enabling memory is refused
 * while the operator's master flag (CONCORD_USER_MEMORY) is off.
 */
import express from "express";
import * as M from "../lib/user-memory.js";

export default function createUserMemoryRouter({ db, requireAuth }) {
  const router = express.Router();
  const auth = typeof requireAuth === "function" ? requireAuth() : (_req, res) => res.status(401).json({ ok: false, error: "auth_required" });

  const uid = (req) => req.user?.id || null;
  const guard = (fn) => (req, res) => {
    const userId = uid(req);
    if (!userId) return res.status(401).json({ ok: false, error: "auth_required" });
    try {
      return fn(userId, req, res);
    } catch (err) {
      console.warn("[user-memory] route failed", { err: err.message });
      return res.status(500).json({ ok: false, error: "user_memory_failed" });
    }
  };
  const result = (res, r, okStatus = 200) => res.status(r.ok === false ? (r.error === "not_found" ? 404 : 400) : okStatus).json(r);

  router.get("/settings", auth, guard((userId, _req, res) => {
    const flags = M.memoryFlags();
    res.json({ ok: true, enabled: M.isEnabled(db, userId), available: flags.master, flags });
  }));

  router.put("/settings", auth, guard((userId, req, res) => {
    const enabled = req.body?.enabled === true;
    if (enabled && !M.memoryFlags().master) return res.status(409).json({ ok: false, error: "memory_unavailable" });
    res.json(M.setEnabled(db, userId, enabled));
  }));

  router.put("/projects/:projectId/off", auth, guard((userId, req, res) => {
    result(res, M.setProjectOff(db, userId, req.params.projectId, req.body?.off !== false));
  }));

  router.get("/facts", auth, guard((userId, req, res) => {
    const { projectId, status, search } = req.query;
    res.json({ ok: true, facts: M.listFacts(db, userId, { projectId, status, search, limit: Number(req.query.limit) || 200 }) });
  }));

  router.get("/facts/:id/why", auth, guard((userId, req, res) => {
    const w = M.why(db, userId, req.params.id);
    if (!w) return res.status(404).json({ ok: false, error: "not_found" });
    res.json({ ok: true, why: w });
  }));

  router.get("/facts/:id/history", auth, guard((userId, req, res) => {
    const h = M.history(db, userId, req.params.id);
    if (!h.length) return res.status(404).json({ ok: false, error: "not_found" });
    res.json({ ok: true, history: h });
  }));

  router.patch("/facts/:id", auth, guard((userId, req, res) => {
    result(res, M.editFact(db, userId, req.params.id, req.body?.value));
  }));

  router.post("/facts/:id/resolve", auth, guard((userId, req, res) => {
    result(res, M.resolvePending(db, userId, req.params.id));
  }));

  router.delete("/facts/:id", auth, guard((userId, req, res) => {
    result(res, M.forgetFact(db, userId, req.params.id));
  }));

  router.delete("/projects/:projectId", auth, guard((userId, req, res) => {
    result(res, M.forgetProject(db, userId, req.params.projectId));
  }));

  router.delete("/all", auth, guard((userId, _req, res) => {
    result(res, M.forgetAll(db, userId));
  }));

  router.get("/used", auth, guard((userId, req, res) => {
    const { sessionId, msgId } = req.query;
    if (!sessionId || !msgId) return res.status(400).json({ ok: false, error: "missing_reply" });
    res.json({ ok: true, facts: M.usedInReply(db, userId, String(sessionId), String(msgId)) });
  }));

  router.get("/export", auth, guard((userId, _req, res) => {
    res.json({ ok: true, memory: M.exportMemory(db, userId) });
  }));

  return router;
}
