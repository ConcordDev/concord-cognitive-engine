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
}
