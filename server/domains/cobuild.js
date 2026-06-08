// server/domains/cobuild.js
//
// Co-build collaboration lens-action domain (id "cobuild"). Backs the
// CollaborationTools world-lens panel with REAL per-user data: live co-build
// sessions and their participants, a kanban task board scoped under a session,
// and design-review annotations.
//
// NOTE: this is DISTINCT from the existing "collab" domain (doc-CRDT-shaped).
// Do NOT reuse "collab" — co-build sessions / kanban tasks / design annotations
// are their own substrate.
//
// In-memory, STATE-backed (no migrations). Per-user authorship via
// ctx.actor.userId; sessions/tasks/annotations are addressable by every
// participant. Empty by construction — no fabricated rows; a user sees nothing
// until they create a session and add tasks/annotations.
//
// Macros:
//   session-create / session-list / session-join / session-leave
//   task-create / task-list / task-update-status
//   annotation-add / annotations-list / annotation-resolve
//   cobuild-summary

export default function registerCobuildActions(registerLensAction) {
  // ── STATE plumbing ───────────────────────────────────────────────
  function STATE() {
    if (!globalThis._concordSTATE) globalThis._concordSTATE = {};
    const S = globalThis._concordSTATE;
    S.cobuildSessions ??= new Map();    // sessionId -> Session
    S.cobuildTasks ??= new Map();       // sessionId -> Map<taskId, Task>
    S.cobuildAnnotations ??= new Map(); // sessionId -> Map<annId, Annotation>
    return S;
  }
  function save() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best-effort */ }
    }
  }
  const aid = (ctx) => ctx?.actor?.userId || ctx?.userId || "anon";
  const sid = (prefix) => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

  function sessionTasks(S, sessionId) {
    if (!S.cobuildTasks.has(sessionId)) S.cobuildTasks.set(sessionId, new Map());
    return S.cobuildTasks.get(sessionId);
  }
  function sessionAnnotations(S, sessionId) {
    if (!S.cobuildAnnotations.has(sessionId)) S.cobuildAnnotations.set(sessionId, new Map());
    return S.cobuildAnnotations.get(sessionId);
  }

  const TASK_STATUSES = ["todo", "doing", "done"];

  // ── session-create ───────────────────────────────────────────────
  registerLensAction("cobuild", "session-create", (ctx, _artifact, params = {}) => {
    try {
      const S = STATE();
      const userId = aid(ctx);
      const p = params || {};
      const name = String(p.name || "").trim();
      if (!name) return { ok: false, error: "name required" };
      const session = {
        id: sid("cob"),
        name,
        goal: String(p.goal || "").trim(),
        ownerId: userId,
        participants: [userId],
        createdAt: new Date().toISOString(),
      };
      S.cobuildSessions.set(session.id, session);
      sessionTasks(S, session.id);
      sessionAnnotations(S, session.id);
      save();
      return { ok: true, result: { session } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ── session-list (sessions the user participates in) ─────────────
  registerLensAction("cobuild", "session-list", (ctx, _artifact, params = {}) => {
    try {
      const S = STATE();
      const userId = aid(ctx);
      const p = params || {};
      const all = String(p.all || "") === "true" || p.all === true;
      let list = [...S.cobuildSessions.values()];
      if (!all) list = list.filter((s) => s.participants.includes(userId));
      list = list.map((s) => ({
        ...s,
        participantCount: s.participants.length,
        taskCount: sessionTasks(S, s.id).size,
        annotationCount: sessionAnnotations(S, s.id).size,
        joined: s.participants.includes(userId),
      }));
      list.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
      return { ok: true, result: { sessions: list, count: list.length } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ── session-join ─────────────────────────────────────────────────
  registerLensAction("cobuild", "session-join", (ctx, _artifact, params = {}) => {
    try {
      const S = STATE();
      const userId = aid(ctx);
      const session = S.cobuildSessions.get(String((params || {}).sessionId || ""));
      if (!session) return { ok: false, error: "session not found" };
      const already = session.participants.includes(userId);
      if (!already) session.participants.push(userId);
      save();
      return {
        ok: true,
        result: { joined: true, alreadyMember: already, session, participantCount: session.participants.length },
      };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ── session-leave (removes participant) ──────────────────────────
  registerLensAction("cobuild", "session-leave", (ctx, _artifact, params = {}) => {
    try {
      const S = STATE();
      const userId = aid(ctx);
      const session = S.cobuildSessions.get(String((params || {}).sessionId || ""));
      if (!session) return { ok: false, error: "session not found" };
      const idx = session.participants.indexOf(userId);
      if (idx === -1) return { ok: false, error: "not a participant" };
      session.participants.splice(idx, 1);
      save();
      return {
        ok: true,
        result: { left: true, session, participantCount: session.participants.length },
      };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ── task-create ──────────────────────────────────────────────────
  registerLensAction("cobuild", "task-create", (ctx, _artifact, params = {}) => {
    try {
      const S = STATE();
      const userId = aid(ctx);
      const p = params || {};
      const sessionId = String(p.sessionId || "");
      const session = S.cobuildSessions.get(sessionId);
      if (!session) return { ok: false, error: "session not found" };
      const title = String(p.title || "").trim();
      if (!title) return { ok: false, error: "title required" };
      const task = {
        id: sid("task"),
        sessionId,
        title,
        description: String(p.description || "").trim(),
        status: "todo",
        createdBy: userId,
        assignee: p.assignee ? String(p.assignee) : null,
        createdAt: new Date().toISOString(),
        updatedAt: null,
      };
      sessionTasks(S, sessionId).set(task.id, task);
      save();
      return { ok: true, result: { task } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ── task-list (under a session) ──────────────────────────────────
  registerLensAction("cobuild", "task-list", (ctx, _artifact, params = {}) => {
    try {
      const S = STATE();
      const p = params || {};
      const sessionId = String(p.sessionId || "");
      if (!S.cobuildSessions.has(sessionId)) return { ok: false, error: "session not found" };
      let list = [...sessionTasks(S, sessionId).values()];
      if (p.status) {
        const want = String(p.status).trim().toLowerCase();
        list = list.filter((t) => t.status === want);
      }
      const byStatus = { todo: 0, doing: 0, done: 0 };
      for (const t of list) byStatus[t.status] = (byStatus[t.status] || 0) + 1;
      list.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
      return { ok: true, result: { tasks: list, count: list.length, byStatus } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ── task-update-status (todo → doing → done) ─────────────────────
  registerLensAction("cobuild", "task-update-status", (ctx, _artifact, params = {}) => {
    try {
      const S = STATE();
      const p = params || {};
      const sessionId = String(p.sessionId || "");
      if (!S.cobuildSessions.has(sessionId)) return { ok: false, error: "session not found" };
      const task = sessionTasks(S, sessionId).get(String(p.taskId || ""));
      if (!task) return { ok: false, error: "task not found" };
      const status = String(p.status || "").trim().toLowerCase();
      if (!TASK_STATUSES.includes(status)) {
        return { ok: false, error: `invalid status (must be one of ${TASK_STATUSES.join(", ")})` };
      }
      task.status = status;
      task.updatedAt = new Date().toISOString();
      save();
      return { ok: true, result: { task } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ── annotation-add ───────────────────────────────────────────────
  registerLensAction("cobuild", "annotation-add", (ctx, _artifact, params = {}) => {
    try {
      const S = STATE();
      const userId = aid(ctx);
      const p = params || {};
      const sessionId = String(p.sessionId || "");
      if (!S.cobuildSessions.has(sessionId)) return { ok: false, error: "session not found" };
      const content = String(p.content || p.text || "").trim();
      if (!content) return { ok: false, error: "content required" };
      const kindRaw = String(p.kind || p.type || "suggestion").trim().toLowerCase();
      const kind = ["suggestion", "issue", "praise"].includes(kindRaw) ? kindRaw : "suggestion";
      const annotation = {
        id: sid("ann"),
        sessionId,
        kind,
        content,
        author: userId,
        targetRef: p.targetRef ? String(p.targetRef) : null,
        resolved: false,
        createdAt: new Date().toISOString(),
        resolvedAt: null,
      };
      sessionAnnotations(S, sessionId).set(annotation.id, annotation);
      save();
      return { ok: true, result: { annotation } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ── annotations-list ─────────────────────────────────────────────
  registerLensAction("cobuild", "annotations-list", (ctx, _artifact, params = {}) => {
    try {
      const S = STATE();
      const p = params || {};
      const sessionId = String(p.sessionId || "");
      if (!S.cobuildSessions.has(sessionId)) return { ok: false, error: "session not found" };
      let list = [...sessionAnnotations(S, sessionId).values()];
      if (p.resolved !== undefined) {
        const want = p.resolved === true || String(p.resolved) === "true";
        list = list.filter((a) => a.resolved === want);
      }
      list.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
      const openCount = list.filter((a) => !a.resolved).length;
      return { ok: true, result: { annotations: list, count: list.length, openCount } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ── annotation-resolve ───────────────────────────────────────────
  registerLensAction("cobuild", "annotation-resolve", (ctx, _artifact, params = {}) => {
    try {
      const S = STATE();
      const p = params || {};
      const sessionId = String(p.sessionId || "");
      if (!S.cobuildSessions.has(sessionId)) return { ok: false, error: "session not found" };
      const ann = sessionAnnotations(S, sessionId).get(String(p.annotationId || ""));
      if (!ann) return { ok: false, error: "annotation not found" };
      ann.resolved = true;
      ann.resolvedAt = new Date().toISOString();
      save();
      return { ok: true, result: { annotation: ann } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ── cobuild-summary (counts for one session) ─────────────────────
  registerLensAction("cobuild", "cobuild-summary", (ctx, _artifact, params = {}) => {
    try {
      const S = STATE();
      const p = params || {};
      const sessionId = String(p.sessionId || "");
      const session = S.cobuildSessions.get(sessionId);
      if (!session) return { ok: false, error: "session not found" };
      const tasks = [...sessionTasks(S, sessionId).values()];
      const annotations = [...sessionAnnotations(S, sessionId).values()];
      const openTasks = tasks.filter((t) => t.status !== "done").length;
      const openAnnotations = annotations.filter((a) => !a.resolved).length;
      return {
        ok: true,
        result: {
          sessionId,
          name: session.name,
          participantCount: session.participants.length,
          taskCount: tasks.length,
          openTaskCount: openTasks,
          doneTaskCount: tasks.length - openTasks,
          annotationCount: annotations.length,
          openAnnotationCount: openAnnotations,
        },
      };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });
}
