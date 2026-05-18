// server/domains/chat-extras.js
//
// Chat lens Sprint A — new register()-pattern macros that sit
// alongside the legacy /domains/chat.js (the smoking-gun fix
// imports that legacy file too). Covers:
//
//   Memory:   memory_save/recall/list/update/delete
//   Projects: project_create/get/list/update/archive/attach_dtu/list_dtus/detach_dtu
//   Personas: persona_create/get/list/apply/delete
//   Prompts:  prompt_create/list/delete
//   Branches: branch_record/list
//
// ~25 macros total. Memory recall is the load-bearing one — it
// returns ranked facts that the chat orchestrator injects into the
// system prompt for cross-session recall (ChatGPT Memory parity).

import {
  saveMemory, recallMemory, listMemory, updateMemory, deleteMemory,
  createProject, getProject, listProjectsForUser, hasProjectRole,
  updateProject, archiveProject, attachDtuToProject, listProjectDtus, detachDtuFromProject,
  createPersona, getPersona, listPersonas, bumpPersonaUsage, deletePersona,
  createPrompt, listPrompts, deletePrompt, bumpPromptUsage,
  recordBranch, listBranches,
} from "../lib/chat/persistence.js";

function _resolveDb(ctx) { return ctx?.db || ctx?.STATE?.db || globalThis._concordSTATE?.db || null; }
function _actor(ctx) { return ctx?.actor?.userId || ctx?.userId || null; }

export default function registerChatExtrasMacros(register) {

  // ─── Memory ──────────────────────────────────────────────────────

  register("chat", "memory_save", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    return saveMemory(db, {
      userId,
      projectId: input.projectId || null,
      fact: input.fact,
      kind: input.kind,
      sessionId: input.sessionId || null,
      confidence: input.confidence,
    });
  }, { destructive: true, note: "Save a fact to my cross-session memory (or project memory)" });

  register("chat", "memory_recall", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const facts = recallMemory(db, { userId, projectId: input.projectId || null, limit: input.limit });
    return { ok: true, facts, count: facts.length };
  }, { note: "Recall facts for the system prompt (ranked: project > global, confidence DESC)" });

  register("chat", "memory_list", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    return { ok: true, memory: listMemory(db, userId, { projectId: input.projectId, includeDisabled: !!input.includeDisabled, limit: input.limit }) };
  }, { note: "List all my memory facts for the UI" });

  register("chat", "memory_update", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    return updateMemory(db, Number(input.id), userId, input);
  }, { destructive: true, note: "Edit a memory fact (or disable it)" });

  register("chat", "memory_delete", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    return deleteMemory(db, Number(input.id), userId);
  }, { destructive: true, note: "Forget a memory fact" });

  // ─── Projects ────────────────────────────────────────────────────

  register("chat", "project_create", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    return createProject(db, { ownerId: userId, ...input });
  }, { destructive: true, note: "Create a Claude-Projects-style workspace" });

  register("chat", "project_get", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const p = getProject(db, String(input.id || ""));
    if (!p) return { ok: false, reason: "not_found" };
    if (!hasProjectRole(db, p.id, userId, "viewer")) return { ok: false, reason: "forbidden" };
    return { ok: true, project: { ...p, attachedDtus: listProjectDtus(db, p.id) } };
  }, { note: "Get a project with attached DTUs" });

  register("chat", "project_list", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    return { ok: true, projects: listProjectsForUser(db, userId, { limit: input.limit }) };
  }, { note: "List my chat projects" });

  register("chat", "project_update", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const id = String(input.id || "");
    if (!hasProjectRole(db, id, userId, "admin")) return { ok: false, reason: "forbidden" };
    return updateProject(db, id, input);
  }, { destructive: true, note: "Update project metadata" });

  register("chat", "project_archive", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    return archiveProject(db, String(input.id || ""), userId);
  }, { destructive: true, note: "Archive a project (owner only)" });

  register("chat", "project_attach_dtu", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    return attachDtuToProject(db, String(input.projectId || ""), String(input.dtuId || ""), userId);
  }, { destructive: true, note: "Attach a DTU to a project (context for every chat in it)" });

  register("chat", "project_list_dtus", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const projectId = String(input.projectId || "");
    if (!hasProjectRole(db, projectId, userId, "viewer")) return { ok: false, reason: "forbidden" };
    return { ok: true, attachedDtus: listProjectDtus(db, projectId) };
  }, { note: "List DTUs attached to a project" });

  register("chat", "project_detach_dtu", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    return detachDtuFromProject(db, String(input.projectId || ""), String(input.dtuId || ""), userId);
  }, { destructive: true, note: "Detach a DTU from a project" });

  // ─── Personas ────────────────────────────────────────────────────

  register("chat", "persona_create", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    return createPersona(db, { ownerId: userId, ...input });
  }, { destructive: true, note: "Create a custom persona (ChatGPT Custom GPTs parity)" });

  register("chat", "persona_get", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const p = getPersona(db, String(input.id || ""));
    if (!p) return { ok: false, reason: "not_found" };
    if (p.owner_id !== userId && p.visibility === "private") return { ok: false, reason: "forbidden" };
    return { ok: true, persona: p };
  }, { note: "Get a persona by id" });

  register("chat", "persona_list", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    return { ok: true, personas: listPersonas(db, userId, { limit: input.limit }) };
  }, { note: "List my personas + workspace + public" });

  register("chat", "persona_apply", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const p = getPersona(db, String(input.id || ""));
    if (!p) return { ok: false, reason: "not_found" };
    bumpPersonaUsage(db, p.id);
    return {
      ok: true,
      persona: {
        id: p.id, name: p.name,
        systemPrompt: p.system_prompt,
        brainSlot: p.brain_slot,
        styleVector: p.style_vector,
        toolAllowlist: p.tool_allowlist,
      },
    };
  }, { note: "Apply a persona to the current chat session (returns system_prompt + brain hints)" });

  register("chat", "persona_delete", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    return deletePersona(db, String(input.id || ""), userId);
  }, { destructive: true, note: "Delete a persona I own" });

  // ─── Prompts ─────────────────────────────────────────────────────

  register("chat", "prompt_create", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    return createPrompt(db, { ownerId: userId, ...input });
  }, { destructive: true, note: "Save a prompt template to my library" });

  register("chat", "prompt_list", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    return { ok: true, prompts: listPrompts(db, userId, { category: input.category, limit: input.limit }) };
  }, { note: "List prompts from my library + shared" });

  register("chat", "prompt_delete", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    return deletePrompt(db, String(input.id || ""), userId);
  }, { destructive: true, note: "Delete a prompt from my library" });

  register("chat", "prompt_use", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    bumpPromptUsage(db, String(input.id || ""));
    return { ok: true };
  }, { destructive: true, note: "Mark a prompt as used (analytics)" });

  // ─── Branches ────────────────────────────────────────────────────

  register("chat", "branch_record", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    return recordBranch(db, {
      sessionId: String(input.sessionId || ""),
      parentMessageIdx: input.parentMessageIdx,
      branchedSessionId: String(input.branchedSessionId || ""),
      branchedBy: userId,
      reason: input.reason,
    });
  }, { destructive: true, note: "Record a fork-from-message (the UI created a new session at message N)" });

  register("chat", "branch_list", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    return { ok: true, branches: listBranches(db, String(input.sessionId || "")) };
  }, { note: "List branches off / into a session" });

  // Smoking-gun cleanup — chat_scheduled_tasks was completely dead
  // (0 reads, 0 writes). The migration created the table for recurring
  // chat tasks (Tasks parity) but the CRUD never landed. These five
  // macros wire it up. The runner heartbeat is added in server.js.

  register("chat", "scheduled_create", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const title = String(input.title || "").trim();
    const prompt = String(input.prompt || "").trim();
    if (!title || !prompt) return { ok: false, reason: "title_and_prompt_required" };
    const cadenceKind = ["every_n_hours","daily","weekly","once_at"].includes(input.cadenceKind) ? input.cadenceKind : "every_n_hours";
    const cadenceParam = String(input.cadenceParam || "24");
    const nextRunAt = computeNextRunAt(cadenceKind, cadenceParam, Math.floor(Date.now() / 1000));
    const id = `chsched:${cryptoRandom()}`;
    db.prepare(`
      INSERT INTO chat_scheduled_tasks (id, owner_id, project_id, persona_id, title, prompt, cadence_kind, cadence_param, next_run_at, enabled, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, userId,
      input.projectId || null,
      input.personaId || null,
      title.slice(0, 200), prompt.slice(0, 8000),
      cadenceKind, cadenceParam, nextRunAt,
      input.enabled === false ? 0 : 1,
      Math.floor(Date.now() / 1000), Math.floor(Date.now() / 1000));
    return { ok: true, id, nextRunAt };
  }, { destructive: true, note: "Create a scheduled chat task (Tasks parity)" });

  register("chat", "scheduled_list", async (ctx) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const rows = db.prepare(`SELECT * FROM chat_scheduled_tasks WHERE owner_id = ? ORDER BY enabled DESC, next_run_at ASC`).all(userId);
    return { ok: true, tasks: rows };
  }, { note: "List my scheduled chat tasks" });

  register("chat", "scheduled_update", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const id = String(input.id || "");
    if (!id) return { ok: false, reason: "id_required" };
    const cur = db.prepare(`SELECT owner_id, cadence_kind, cadence_param FROM chat_scheduled_tasks WHERE id = ?`).get(id);
    if (!cur) return { ok: false, reason: "not_found" };
    if (cur.owner_id !== userId) return { ok: false, reason: "forbidden" };
    const sets = [], args = [];
    if (input.title !== undefined) { sets.push("title = ?"); args.push(String(input.title).slice(0, 200)); }
    if (input.prompt !== undefined) { sets.push("prompt = ?"); args.push(String(input.prompt).slice(0, 8000)); }
    if (input.enabled !== undefined) { sets.push("enabled = ?"); args.push(input.enabled ? 1 : 0); }
    if (input.cadenceKind && ["every_n_hours","daily","weekly","once_at"].includes(input.cadenceKind)) {
      sets.push("cadence_kind = ?"); args.push(input.cadenceKind);
      const param = input.cadenceParam !== undefined ? String(input.cadenceParam) : cur.cadence_param;
      sets.push("cadence_param = ?"); args.push(param);
      sets.push("next_run_at = ?"); args.push(computeNextRunAt(input.cadenceKind, param, Math.floor(Date.now() / 1000)));
    } else if (input.cadenceParam !== undefined) {
      sets.push("cadence_param = ?"); args.push(String(input.cadenceParam));
      sets.push("next_run_at = ?"); args.push(computeNextRunAt(cur.cadence_kind, String(input.cadenceParam), Math.floor(Date.now() / 1000)));
    }
    if (sets.length === 0) return { ok: false, reason: "nothing_to_update" };
    sets.push("updated_at = ?"); args.push(Math.floor(Date.now() / 1000));
    args.push(id);
    db.prepare(`UPDATE chat_scheduled_tasks SET ${sets.join(", ")} WHERE id = ?`).run(...args);
    return { ok: true };
  }, { destructive: true, note: "Update a scheduled chat task (cadence change recomputes next_run_at)" });

  register("chat", "scheduled_delete", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const id = String(input.id || "");
    const r = db.prepare(`DELETE FROM chat_scheduled_tasks WHERE id = ? AND owner_id = ?`).run(id, userId);
    return { ok: r.changes > 0 };
  }, { destructive: true, note: "Delete a scheduled chat task" });

  register("chat", "scheduled_due", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const limit = Math.min(Math.max(1, Number(input.limit) || 50), 500);
    const now = Math.floor(Date.now() / 1000);
    const rows = db.prepare(`
      SELECT * FROM chat_scheduled_tasks
      WHERE enabled = 1 AND next_run_at <= ?
      ORDER BY next_run_at ASC LIMIT ?
    `).all(now, limit);
    return { ok: true, due: rows, count: rows.length };
  }, { note: "Due scheduled chat tasks across all users — fed to the runner heartbeat" });
}

function cryptoRandom() {
  // crypto.randomUUID without a top-level import (lazy)
  // — uses node:crypto if available, otherwise a Math.random fallback
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require("node:crypto").randomUUID();
  } catch {
    return `r${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  }
}

function computeNextRunAt(kind, param, nowSec) {
  switch (kind) {
    case "every_n_hours": {
      const hours = Math.max(1, Math.min(720, Number(param) || 24));
      return nowSec + hours * 3600;
    }
    case "daily": return nowSec + 86400;
    case "weekly": return nowSec + 7 * 86400;
    case "once_at": return Math.max(nowSec, Number(param) || nowSec);
    default: return nowSec + 86400;
  }
}
