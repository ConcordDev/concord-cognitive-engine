// server/tests/docs-skills.test.js
//
// Tier-2 contract tests for Docs Sprint B Custom AI Skills + the
// run ledger. Skill CRUD round-trips, visibility gates, template
// substitution, and run_count increment.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import registerDocsSkillsMacros from "../domains/docs-skills.js";

let db;
const MACROS = new Map();

function register(_domain, name, handler) { MACROS.set(name, handler); }

before(async () => {
  db = new Database(":memory:");
  const mig211 = await import("../migrations/211_documents.js");
  const mig212 = await import("../migrations/212_doc_ai.js");
  mig211.up(db); mig212.up(db);
  registerDocsSkillsMacros(register);
});
after(() => { try { db.close(); } catch { /* ok */ } });

function ctx(userId = "u_skills", llm = null) {
  return { db, actor: { userId }, llm };
}

describe("docs-skills: CRUD", () => {
  it("skill_create requires name + prompt", async () => {
    const a = await MACROS.get("skill_create")(ctx(), { name: "x" });
    assert.equal(a.ok, false); assert.equal(a.reason, "prompt_required");
    const b = await MACROS.get("skill_create")(ctx(), { prompt: "x" });
    assert.equal(b.ok, false); assert.equal(b.reason, "name_required");
  });

  it("skill_create + skill_get + skill_update + skill_delete round-trip", async () => {
    const c = await MACROS.get("skill_create")(ctx(), {
      name: "Tone polish", prompt: "Rewrite this friendlier: {{selection}}",
      kind: "rewrite", visibility: "private",
    });
    assert.equal(c.ok, true);
    const g = await MACROS.get("skill_get")(ctx(), { id: c.id });
    assert.equal(g.skill.name, "Tone polish");

    const u = await MACROS.get("skill_update")(ctx(), { id: c.id, name: "Tone polish v2" });
    assert.equal(u.ok, true);
    const g2 = await MACROS.get("skill_get")(ctx(), { id: c.id });
    assert.equal(g2.skill.name, "Tone polish v2");

    const d = await MACROS.get("skill_delete")(ctx(), { id: c.id });
    assert.equal(d.deleted, 1);
  });

  it("skill_update rejected for non-owner", async () => {
    const c = await MACROS.get("skill_create")(ctx("u_owner"), { name: "X", prompt: "Y" });
    const u = await MACROS.get("skill_update")(ctx("u_other"), { id: c.id, name: "hacked" });
    assert.equal(u.ok, false); assert.equal(u.reason, "forbidden");
  });

  it("skill_list returns my + workspace + public, excludes others' private", async () => {
    const mine = await MACROS.get("skill_create")(ctx("u_a"), { name: "Mine", prompt: "p", visibility: "private" });
    await MACROS.get("skill_create")(ctx("u_b"), { name: "Workspace", prompt: "p", visibility: "workspace" });
    await MACROS.get("skill_create")(ctx("u_b"), { name: "Public", prompt: "p", visibility: "public" });
    await MACROS.get("skill_create")(ctx("u_b"), { name: "Private of B", prompt: "p", visibility: "private" });
    const list = await MACROS.get("skill_list")(ctx("u_a"));
    const names = list.skills.map((s) => s.name);
    assert.ok(names.includes("Mine"));
    assert.ok(names.includes("Workspace"));
    assert.ok(names.includes("Public"));
    assert.ok(!names.includes("Private of B"));
  });

  it("skill_get of someone else's private skill returns forbidden", async () => {
    const c = await MACROS.get("skill_create")(ctx("u_priv"), { name: "Locked", prompt: "p", visibility: "private" });
    const g = await MACROS.get("skill_get")(ctx("u_other"), { id: c.id });
    assert.equal(g.ok, false); assert.equal(g.reason, "forbidden");
  });
});

describe("docs-skills: skill_run", () => {
  it("returns llm_unavailable without an LLM in context", async () => {
    const c = await MACROS.get("skill_create")(ctx("u_run"), { name: "Test", prompt: "Hello {{selection}}" });
    const r = await MACROS.get("skill_run")(ctx("u_run"), { id: c.id });
    assert.equal(r.ok, false); assert.equal(r.reason, "llm_unavailable");
  });

  it("templates {{selection}} / {{input}} / {{doc}} into prompt before LLM call", async () => {
    const c = await MACROS.get("skill_create")(ctx("u_tmpl"), {
      name: "Echo", prompt: "S={{selection}} I={{input}} D={{doc}}",
    });
    let capturedPrompt = "";
    const llm = {
      chat: async (req) => {
        capturedPrompt = req.messages[1].content;
        return { content: "OK" };
      },
    };
    const r = await MACROS.get("skill_run")(
      { db, actor: { userId: "u_tmpl" }, llm },
      { id: c.id, selection: "PICKED", input: "EXTRA" },
    );
    assert.equal(r.ok, true);
    assert.ok(capturedPrompt.includes("S=PICKED"), `got: ${capturedPrompt}`);
    assert.ok(capturedPrompt.includes("I=EXTRA"));
  });

  it("bumps run_count after a successful run", async () => {
    const c = await MACROS.get("skill_create")(ctx("u_cnt"), { name: "Counter", prompt: "x" });
    const before = (await MACROS.get("skill_get")(ctx("u_cnt"), { id: c.id })).skill.run_count;
    await MACROS.get("skill_run")(
      { db, actor: { userId: "u_cnt" }, llm: { chat: async () => ({ content: "ok" }) } },
      { id: c.id },
    );
    const after = (await MACROS.get("skill_get")(ctx("u_cnt"), { id: c.id })).skill.run_count;
    assert.equal(after, before + 1);
  });
});

describe("docs-skills: ai_runs_recent ledger", () => {
  it("records a run row after skill_run", async () => {
    const c = await MACROS.get("skill_create")(ctx("u_ledger"), { name: "L", prompt: "x" });
    await MACROS.get("skill_run")(
      { db, actor: { userId: "u_ledger" }, llm: { chat: async () => ({ content: "out" }) } },
      { id: c.id },
    );
    const r = await MACROS.get("ai_runs_recent")(ctx("u_ledger"));
    assert.ok(r.runs.length >= 1);
    assert.equal(r.runs[0].kind, "skill");
    assert.equal(r.runs[0].skill_id, c.id);
  });

  it("filters by documentId when provided", async () => {
    const r = await MACROS.get("ai_runs_recent")(ctx("u_ledger"), { documentId: "doc:nonexistent" });
    assert.equal(r.runs.length, 0);
  });
});
