// server/tests/code-spec.test.js
//
// Tier-2 contract tests for Code Sprint C #10 — spec-driven workflow.
// Real DB. spec_to_plan uses a stub ctx.llm (the LLM call itself
// is library code, not what we're contracting here); plan_to_code
// dispatches through a stub runMacro that asserts the citation
// chain wiring.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import registerCodeSpecMacros from "../domains/code-spec.js";

function _setupDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE IF NOT EXISTS dtus (
      id TEXT PRIMARY KEY, kind TEXT NOT NULL, title TEXT,
      creator_id TEXT, meta_json TEXT, skill_level INTEGER DEFAULT 1,
      total_experience INTEGER DEFAULT 0, created_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS royalty_lineage (
      id TEXT PRIMARY KEY,
      child_id TEXT NOT NULL,
      parent_id TEXT NOT NULL,
      generation INTEGER NOT NULL DEFAULT 1,
      creator_id TEXT,
      parent_creator TEXT,
      created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS user_consent (
      user_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER,
      PRIMARY KEY (user_id, key)
    );
  `);
  return db;
}

describe("code-spec: spec → plan → code citation chain", () => {
  let db; const macros = new Map();
  before(() => {
    db = _setupDb();
    const register = (_d, n, h) => macros.set(n, h);
    registerCodeSpecMacros(register);
  });
  after(() => { try { db.close(); } catch { /* ok */ } });

  it("spec_create requires title + requirements/body", async () => {
    const ctx = { db, actor: { userId: "u1" } };
    assert.equal((await macros.get("spec_create")(ctx, {})).reason, "title_required");
    assert.equal((await macros.get("spec_create")(ctx, { title: "x" })).reason, "requirements_or_body_required");
  });

  it("spec_create mints a kind='code_spec' DTU", async () => {
    const ctx = { db, actor: { userId: "u1" } };
    const r = await macros.get("spec_create")(ctx, {
      title: "Build leaderboard",
      requirements: ["users can submit scores", "top 100 visible", "auth via JWT"],
    });
    assert.equal(r.ok, true);
    assert.ok(r.specDtuId.startsWith("code_spec:"));
    assert.equal(r.requirementsCount, 3);
    const row = db.prepare("SELECT kind, creator_id FROM dtus WHERE id = ?").get(r.specDtuId);
    assert.equal(row.kind, "code_spec");
    assert.equal(row.creator_id, "u1");
  });

  it("spec_to_plan converts via LLM into kind='code_plan' DTU and cites the spec", async () => {
    const ctx = {
      db, actor: { userId: "u1" },
      llm: { chat: async () => ({ text: JSON.stringify({
        summary: "Two-table schema with REST endpoints.",
        milestones: [
          { title: "Schema + migration", steps: ["create scores table", "add index on user_id"] },
          { title: "Endpoints", steps: ["POST /scores", "GET /top"] },
        ],
      })}),
      },
    };
    const create = await macros.get("spec_create")(ctx, {
      title: "Leaderboard v2", requirements: ["submit score", "view top 10"],
    });
    const plan = await macros.get("spec_to_plan")(ctx, { specDtuId: create.specDtuId });
    assert.equal(plan.ok, true);
    assert.ok(plan.planDtuId.startsWith("code_plan:"));
    assert.equal(plan.milestoneCount, 2);
    const cite = db.prepare("SELECT * FROM royalty_lineage WHERE child_id = ? AND parent_id = ?")
      .get(plan.planDtuId, create.specDtuId);
    assert.ok(cite, "plan should cite the spec via royalty_lineage");
  });

  it("spec_to_plan rejects when spec not found", async () => {
    const ctx = { db, actor: { userId: "u1" }, llm: { chat: async () => ({ text: "{}" }) } };
    const r = await macros.get("spec_to_plan")(ctx, { specDtuId: "nope" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "spec_not_found");
  });

  it("spec_to_plan rejects when LLM output isn't parseable", async () => {
    const ctx = { db, actor: { userId: "u1" }, llm: { chat: async () => ({ text: "no json here" }) } };
    const create = await macros.get("spec_create")(ctx, { title: "x", body: "y" });
    const plan = await macros.get("spec_to_plan")(ctx, { specDtuId: create.specDtuId });
    assert.equal(plan.ok, false);
    assert.equal(plan.reason, "plan_parse_failed");
  });

  it("plan_to_code dispatches to agent_loop and cites the plan", async () => {
    const ctx = {
      db, actor: { userId: "u1" },
      llm: { chat: async () => ({ text: JSON.stringify({ summary: "s", milestones: [{ title: "m", steps: ["s1"] }] })}) },
      runMacro: async (domain, name, _input) => {
        if (domain === "code" && name === "agent_loop") {
          return { ok: true, sessionId: "code_agent_session:test", verdict: "pass", iterations: 1, steps: [], stepDtuIds: [] };
        }
        return { ok: false, reason: "unexpected_macro" };
      },
    };
    const sp = await macros.get("spec_create")(ctx, { title: "s2", body: "b" });
    const pp = await macros.get("spec_to_plan")(ctx, { specDtuId: sp.specDtuId });
    // Pre-insert the sessionId DTU so the cascade citation has a referent.
    db.prepare(`INSERT INTO dtus (id, kind, title, creator_id, meta_json, created_at) VALUES (?, 'code_agent_session', 'test', 'u1', '{}', unixepoch())`)
      .run("code_agent_session:test");
    const r = await macros.get("plan_to_code")(ctx, {
      planDtuId: pp.planDtuId, projectPath: "x", files: [],
    });
    assert.equal(r.ok, true);
    assert.equal(r.verdict, "pass");
    const cite = db.prepare("SELECT * FROM royalty_lineage WHERE child_id = ? AND parent_id = ?")
      .get(r.sessionId, pp.planDtuId);
    assert.ok(cite, "session should cite the plan via royalty_lineage");
  });

  it("spec_list filters by user + kind", async () => {
    const ctx = { db, actor: { userId: "u1" } };
    const r = await macros.get("spec_list")(ctx, { kind: "code_spec" });
    assert.equal(r.ok, true);
    assert.ok(r.items.length >= 1);
  });

  it("spec_get returns spec / plan / session", async () => {
    const ctx = { db, actor: { userId: "u1" }, llm: { chat: async () => ({ text: "{}" }) } };
    const sp = await macros.get("spec_create")(ctx, { title: "t", body: "b" });
    const r = await macros.get("spec_get")(ctx, { id: sp.specDtuId });
    assert.equal(r.ok, true);
    assert.equal(r.dtu.kind, "code_spec");
  });
});
