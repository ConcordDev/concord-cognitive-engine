// server/tests/chat-extras.test.js
//
// Tier-2 contract tests for Sprint A: memory, projects, personas,
// prompts, branches. Plus the smoking-gun fix verification: the
// legacy chat.js is now reachable via registerLensAction.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import registerChatExtrasMacros from "../domains/chat-extras.js";
import {
  saveMemory, recallMemory, listMemory, updateMemory, deleteMemory,
  createProject, getProject, listProjectsForUser, hasProjectRole,
  attachDtuToProject, listProjectDtus, detachDtuFromProject,
  createPersona, listPersonas, bumpPersonaUsage, deletePersona,
  createPrompt, listPrompts,
  recordBranch, listBranches,
} from "../lib/chat/persistence.js";

const MACROS = new Map();
function register(_d, n, h) { MACROS.set(n, h); }
let db;

before(async () => {
  db = new Database(":memory:");
  const m = await import("../migrations/223_chat_extras.js");
  m.up(db);
  registerChatExtrasMacros(register);
});
after(() => { try { db.close(); } catch { /* ok */ } });

function ctx(userId) { return { db, actor: { userId } }; }

// ─── Memory ───────────────────────────────────────────────────────

describe("memory: save + recall + list + update + delete", () => {
  it("saveMemory + recall returns the fact ranked by confidence", () => {
    saveMemory(db, { userId: "u_m1", fact: "prefers concise replies", kind: "preference", confidence: 0.9 });
    saveMemory(db, { userId: "u_m1", fact: "lives in Berlin", kind: "identity", confidence: 0.8 });
    const r = recallMemory(db, { userId: "u_m1" });
    assert.equal(r.length, 2);
    assert.equal(r[0].fact, "prefers concise replies"); // higher confidence first
  });

  it("project memory ranks above global memory", () => {
    saveMemory(db, { userId: "u_m2", fact: "global fact", confidence: 0.9 });
    saveMemory(db, { userId: "u_m2", projectId: "p1", fact: "project fact", confidence: 0.5 });
    const r = recallMemory(db, { userId: "u_m2", projectId: "p1" });
    assert.equal(r[0].fact, "project fact");
  });

  it("recallMemory bumps hit_count", () => {
    saveMemory(db, { userId: "u_m_hit", fact: "tracked", confidence: 0.5 });
    recallMemory(db, { userId: "u_m_hit" });
    recallMemory(db, { userId: "u_m_hit" });
    const list = listMemory(db, "u_m_hit");
    assert.equal(list[0].hit_count, 2);
  });

  it("updateMemory enabled=0 hides from recall", () => {
    const r = saveMemory(db, { userId: "u_m3", fact: "ephemeral", confidence: 0.8 });
    updateMemory(db, r.id, "u_m3", { enabled: false });
    const recall = recallMemory(db, { userId: "u_m3" });
    assert.equal(recall.length, 0);
  });

  it("deleteMemory scoped to owner", () => {
    const r = saveMemory(db, { userId: "u_m4", fact: "delete me" });
    const denied = deleteMemory(db, r.id, "u_other");
    assert.equal(denied.ok, false);
    const okR = deleteMemory(db, r.id, "u_m4");
    assert.equal(okR.ok, true);
  });
});

// ─── Projects ─────────────────────────────────────────────────────

describe("projects: CRUD + roles + attached DTUs", () => {
  it("createProject seeds owner row in members", () => {
    const r = createProject(db, { ownerId: "u_pa", name: "Quarterly review" });
    assert.equal(r.ok, true);
    assert.equal(hasProjectRole(db, r.id, "u_pa", "owner"), true);
  });

  it("listProjectsForUser scopes by membership", () => {
    createProject(db, { ownerId: "u_pl", name: "Mine A" });
    createProject(db, { ownerId: "u_pl", name: "Mine B" });
    createProject(db, { ownerId: "u_pl_other", name: "Theirs" });
    const list = listProjectsForUser(db, "u_pl");
    assert.equal(list.length, 2);
  });

  it("attach + list + detach DTUs round-trip", () => {
    const p = createProject(db, { ownerId: "u_pa2", name: "DTU test" });
    attachDtuToProject(db, p.id, "dtu:abc", "u_pa2");
    attachDtuToProject(db, p.id, "dtu:def", "u_pa2");
    assert.equal(listProjectDtus(db, p.id).length, 2);
    detachDtuFromProject(db, p.id, "dtu:abc", "u_pa2");
    assert.equal(listProjectDtus(db, p.id).length, 1);
  });

  it("attach DTU forbidden across users on private project", () => {
    const p = createProject(db, { ownerId: "u_priv", name: "Private" });
    const r = attachDtuToProject(db, p.id, "dtu:x", "u_thief");
    assert.equal(r.ok, false); assert.equal(r.reason, "forbidden");
  });
});

// ─── Personas ─────────────────────────────────────────────────────

describe("personas: create + list + apply + delete", () => {
  it("create + list returns my persona", () => {
    const c = createPersona(db, { ownerId: "u_per", name: "Editor", systemPrompt: "You are a tough editor." });
    assert.equal(c.ok, true);
    const list = listPersonas(db, "u_per");
    assert.ok(list.find((p) => p.id === c.id));
  });

  it("createPersona requires name + systemPrompt", () => {
    assert.equal(createPersona(db, { ownerId: "u_x", name: "x" }).ok, false);
    assert.equal(createPersona(db, { ownerId: "u_x", systemPrompt: "x" }).ok, false);
  });

  it("listPersonas surfaces public + workspace ones too", () => {
    createPersona(db, { ownerId: "u_other", name: "Shared", systemPrompt: "x", visibility: "public" });
    const list = listPersonas(db, "u_visible");
    assert.ok(list.find((p) => p.name === "Shared"));
  });

  it("bumpPersonaUsage increments + sorts higher next time", () => {
    const c = createPersona(db, { ownerId: "u_bump", name: "Hot", systemPrompt: "x" });
    bumpPersonaUsage(db, c.id);
    bumpPersonaUsage(db, c.id);
    const list = listPersonas(db, "u_bump");
    assert.equal(list[0].usage_count, 2);
  });

  it("deletePersona scoped to owner", () => {
    const c = createPersona(db, { ownerId: "u_del", name: "Doomed", systemPrompt: "x" });
    const r = deletePersona(db, c.id, "u_del");
    assert.equal(r.ok, true);
  });
});

// ─── Prompts ──────────────────────────────────────────────────────

describe("prompts: create + list", () => {
  it("createPrompt + list returns mine", () => {
    const c = createPrompt(db, { ownerId: "u_pr", title: "Brainstorm", body: "List 10 ideas for {{topic}}" });
    assert.equal(c.ok, true);
    const list = listPrompts(db, "u_pr");
    assert.ok(list.find((p) => p.id === c.id));
  });

  it("category filter works", () => {
    createPrompt(db, { ownerId: "u_cat", title: "A", body: "x", category: "writing" });
    createPrompt(db, { ownerId: "u_cat", title: "B", body: "x", category: "coding" });
    const writing = listPrompts(db, "u_cat", { category: "writing" });
    assert.equal(writing.length, 1);
    assert.equal(writing[0].title, "A");
  });
});

// ─── Branches ─────────────────────────────────────────────────────

describe("branches: record + list bidirectional", () => {
  it("recordBranch + listBranches returns both sides", () => {
    recordBranch(db, { sessionId: "sess_orig", parentMessageIdx: 5, branchedSessionId: "sess_fork", branchedBy: "u_b" });
    const fromOrig = listBranches(db, "sess_orig");
    const fromFork = listBranches(db, "sess_fork");
    assert.equal(fromOrig.length, 1);
    assert.equal(fromFork.length, 1);
    assert.equal(fromOrig[0].branched_session_id, "sess_fork");
  });
});

// ─── Macro envelopes ──────────────────────────────────────────────

describe("chat-extras macros end-to-end", () => {
  it("memory_save + memory_recall round-trip via macros", async () => {
    const s = await MACROS.get("memory_save")(ctx("u_mm"), { fact: "uses TypeScript", kind: "preference" });
    assert.equal(s.ok, true);
    const r = await MACROS.get("memory_recall")(ctx("u_mm"));
    assert.equal(r.facts[0].fact, "uses TypeScript");
  });

  it("project_create + project_attach_dtu + project_get round-trip", async () => {
    const p = await MACROS.get("project_create")(ctx("u_mp"), { name: "Macro test project" });
    await MACROS.get("project_attach_dtu")(ctx("u_mp"), { projectId: p.id, dtuId: "dtu:macro" });
    const g = await MACROS.get("project_get")(ctx("u_mp"), { id: p.id });
    assert.equal(g.project.name, "Macro test project");
    assert.equal(g.project.attachedDtus.length, 1);
  });

  it("persona_apply returns system_prompt + brain hints + bumps usage", async () => {
    const c = await MACROS.get("persona_create")(ctx("u_pap"), { name: "Coach", systemPrompt: "You are a patient coach.", brainSlot: "subconscious" });
    const a = await MACROS.get("persona_apply")(ctx("u_pap"), { id: c.id });
    assert.equal(a.persona.brainSlot, "subconscious");
    assert.equal(a.persona.systemPrompt, "You are a patient coach.");
    const list = await MACROS.get("persona_list")(ctx("u_pap"));
    assert.equal(list.personas.find((p) => p.id === c.id).usage_count, 1);
  });

  it("memory_update + memory_delete via macros", async () => {
    const s = await MACROS.get("memory_save")(ctx("u_mud"), { fact: "ephemeral" });
    await MACROS.get("memory_update")(ctx("u_mud"), { id: s.id, fact: "edited" });
    const list = await MACROS.get("memory_list")(ctx("u_mud"));
    assert.equal(list.memory[0].fact, "edited");
    await MACROS.get("memory_delete")(ctx("u_mud"), { id: s.id });
    const after = await MACROS.get("memory_list")(ctx("u_mud"));
    assert.equal(after.memory.length, 0);
  });

  it("project_get forbidden across private projects", async () => {
    const p = await MACROS.get("project_create")(ctx("u_pf"), { name: "Private", visibility: "private" });
    const r = await MACROS.get("project_get")(ctx("u_other"), { id: p.id });
    assert.equal(r.ok, false); assert.equal(r.reason, "forbidden");
  });
});

// ─── Smoking-gun fix: legacy chat.js handlers reachable ──────────

describe("smoking-gun #9/10 verification: chat.js handlers wire", () => {
  it("registerChatActions registers 21 legacy handlers", async () => {
    const LEGACY = new Map();
    function legacyRegister(domain, name, fn) { LEGACY.set(`${domain}.${name}`, fn); }
    const mod = await import("../domains/chat.js");
    mod.default(legacyRegister);
    assert.ok(LEGACY.size >= 20, `expected 20+ handlers, got ${LEGACY.size}`);
    // Spot-check known names
    const names = Array.from(LEGACY.keys());
    assert.ok(names.some((n) => n.includes("threadSummarize") || n.includes("summarize")));
    assert.ok(names.some((n) => n.includes("project") || n.includes("Project")));
  });
});
