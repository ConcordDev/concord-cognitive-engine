// server/domains/agent-projects.js
//
// V1.2 Wave B (Deep ConKay Agency) — macros over the project linking layer
// (lib/project-thread.js, mig 378). A "project" here is the one addressable,
// named thing that ties a durable goal tree (decomp.*), its marathon
// session(s) (agent_marathon.*), and a relevance-scoped conversation-memory
// pull into something a user can reopen across separate logins. This domain
// never reimplements any of those three subsystems — it only reads/writes
// the thin projects / project_marathon_links tables and calls straight back
// into goal-decomposition.js's and agent-marathon.js's own getters.
//
// Domain deliberately named "agent_projects", NOT "projects" — an existing,
// unrelated `server/domains/projects.js` already owns the "projects" macro
// domain for a Linear/Asana/Jira-style task/sprint tracker (ganttGenerate,
// riskMatrix, burndownCalc, task/sprint CRUD, …). Reusing that domain name
// for this entirely different concept (an agent-work continuity thread, not
// a project-management board) would silently collide two unrelated meanings
// under one macro-domain string. "agent_projects" mirrors the sibling
// "agent_marathon" domain (server/domains/agent-marathon.js) it links to.
//
// Registered from server.js: registerAgentProjectMacros(register).

import {
  createProject, listProjects, getProject, linkMarathonToProject, touchProjectOpened,
} from "../lib/project-thread.js";

export default function registerAgentProjectMacros(register) {
  register("agent_projects", "create", async (ctx, input = {}) => {
    const db = ctx?.db; if (!db) return { ok: false, reason: "no_db" };
    const userId = input.userId || ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_user" };
    return createProject(db, userId, input.name, { goalTreeId: input.goalTreeId });
  }, { note: "create a named project, optionally pre-linked to a goal tree" });

  register("agent_projects", "list", async (ctx, input = {}) => {
    const db = ctx?.db; if (!db) return { ok: false, reason: "no_db" };
    const userId = input.userId || ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_user" };
    return { ok: true, projects: listProjects(db, userId, { limit: input.limit }) };
  }, { note: "list a user's projects with a cheap marathon-link count" });

  register("agent_projects", "get", async (ctx, input = {}) => {
    const db = ctx?.db; if (!db) return { ok: false, reason: "no_db" };
    const userId = input.userId || ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_user" };
    if (!input.projectId) return { ok: false, reason: "missing_project_id" };
    // ctx.state.dtus is the live write-through DTU store (see
    // server/domains/conkay.js's memory_list for the same access pattern) —
    // pass it through so getProject can honestly attempt the conversation-
    // memory pull; its absence (e.g. a minimal test harness) degrades to
    // `memory.available:false`, never a fabricated result.
    return getProject(db, userId, input.projectId, { dtus: ctx?.state?.dtus, memoryLimit: input.memoryLimit });
  }, { note: "fetch a project's full live state: goal tree + marathon sessions + relevant memory" });

  register("agent_projects", "link_marathon", async (ctx, input = {}) => {
    const db = ctx?.db; if (!db) return { ok: false, reason: "no_db" };
    const userId = input.userId || ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_user" };
    if (!input.projectId) return { ok: false, reason: "missing_project_id" };
    if (!input.marathonSessionId) return { ok: false, reason: "missing_marathon_session_id" };
    const project = db.prepare(`SELECT user_id AS userId FROM projects WHERE id = ?`).get(input.projectId);
    if (!project) return { ok: false, reason: "project_not_found" };
    if (project.userId !== String(userId)) return { ok: false, reason: "not_owned" };
    return linkMarathonToProject(db, input.projectId, input.marathonSessionId);
  }, { note: "attach a marathon session to a project (idempotent; a project may accumulate several over its life)" });

  register("agent_projects", "touch_opened", async (ctx, input = {}) => {
    const db = ctx?.db; if (!db) return { ok: false, reason: "no_db" };
    const userId = input.userId || ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_user" };
    if (!input.projectId) return { ok: false, reason: "missing_project_id" };
    return touchProjectOpened(db, userId, input.projectId);
  }, { note: "stamp a project as opened-now by its owner (the 'resume' beat)" });
}
