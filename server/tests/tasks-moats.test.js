// server/tests/tasks-moats.test.js
//
// Tier-2 contract tests for the 5 Sprint C moat capabilities:
// project-bound agents, mint-as-DTU, project templates, CSV
// importers, roadmap/timeline. Stub LLM where needed; stub DTUs
// table for the mint path (full economy schema not required for
// the cite-cascade graceful degradation test).

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import registerTasksMacros from "../domains/tasks.js";
import registerTasksWorkflowMacros from "../domains/tasks-workflow.js";
import registerTasksMoatsMacros from "../domains/tasks-moats.js";
import { parseCsv, detectProvider, importCsv } from "../lib/tasks/importers.js";
import { buildTimeline } from "../lib/tasks/timeline.js";

const MACROS = new Map();
function register(_d, n, h) { MACROS.set(n, h); }
let db;

before(async () => {
  db = new Database(":memory:");
  for (const m of ["214_tasks", "215_tasks_ai", "216_tasks_moats"]) {
    const x = await import(`../migrations/${m}.js`);
    x.up(db);
  }
  // Minimal dtus table for mint paths
  db.exec(`
    CREATE TABLE IF NOT EXISTS dtus (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      title TEXT,
      creator_id TEXT,
      meta_json TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `);
  registerTasksMacros(register);
  registerTasksWorkflowMacros(register);
  registerTasksMoatsMacros(register);
});
after(() => { try { db.close(); } catch { /* ok */ } });

function ctx(userId, llm = null) { return { db, actor: { userId }, llm }; }
async function makeProject(userId, key) {
  return (await MACROS.get("project_create")(ctx(userId), { key, name: key })).id;
}

describe("tasks-moats: project-bound agents", () => {
  it("agent_create requires admin role", async () => {
    const pid = await makeProject("u_pa_admin", "PAG");
    const r = await MACROS.get("agent_create")(ctx("u_outsider"), {
      projectId: pid, name: "Sneak", systemPrompt: "x",
    });
    assert.equal(r.ok, false); assert.equal(r.reason, "forbidden");
  });

  it("agent_create + list + delete round-trip", async () => {
    const pid = await makeProject("u_pa", "PAGN");
    const c = await MACROS.get("agent_create")(ctx("u_pa"), {
      projectId: pid, name: "Triager", systemPrompt: "You triage tasks.",
      capabilities: ["read_tasks", "triage"],
    });
    assert.equal(c.ok, true);
    const list = await MACROS.get("agent_list")(ctx("u_pa"), { projectId: pid });
    assert.ok(list.agents.find((a) => a.id === c.id));
    assert.deepEqual(list.agents[0].capabilities.sort(), ["read_tasks", "triage"].sort());
    const d = await MACROS.get("agent_delete")(ctx("u_pa"), { id: c.id });
    assert.equal(d.ok, true);
  });

  it("agent_run injects task context per read_tasks capability", async () => {
    const pid = await makeProject("u_pa_r", "PRUN");
    await MACROS.get("task_create")(ctx("u_pa_r"), { projectId: pid, title: "Live task" });
    const a = await MACROS.get("agent_create")(ctx("u_pa_r"), {
      projectId: pid, name: "Reader", systemPrompt: "Read tasks.",
      capabilities: ["read_tasks"],
    });
    let captured = "";
    const llm = { chat: async (req) => { captured = req.messages[0].content; return { content: "ack" }; } };
    await MACROS.get("agent_run")({ db, actor: { userId: "u_pa_r" }, llm }, { id: a.id, message: "summarise" });
    assert.ok(captured.includes("Tasks ("));
    assert.ok(captured.includes("Live task"));
  });

  it("agent_publish mints an agent_spec DTU + idempotent", async () => {
    const pid = await makeProject("u_pa_pub", "PPUB");
    const a = await MACROS.get("agent_create")(ctx("u_pa_pub"), {
      projectId: pid, name: "Publishable", systemPrompt: "x",
    });
    const p = await MACROS.get("agent_publish")(ctx("u_pa_pub"), { id: a.id });
    assert.equal(p.ok, true);
    assert.ok(p.dtuId.startsWith("agent_spec:"));
    const dtu = db.prepare(`SELECT kind FROM dtus WHERE id = ?`).get(p.dtuId);
    assert.equal(dtu.kind, "agent_spec");
    const p2 = await MACROS.get("agent_publish")(ctx("u_pa_pub"), { id: a.id });
    assert.equal(p2.alreadyPublished, true);
  });
});

describe("tasks-moats: project mint + cite + export", () => {
  it("project_mint creates project_spec DTU + mint row", async () => {
    const pid = await makeProject("u_mint", "MNT");
    const r = await MACROS.get("project_mint")(ctx("u_mint"), { projectId: pid, royaltyRate: 0.15 });
    assert.equal(r.ok, true);
    assert.ok(r.dtuId.startsWith("project_spec:"));
    assert.equal(r.royaltyRate, 0.15);
  });

  it("project_mint idempotent + royalty rate clamped to 30%", async () => {
    const pid = await makeProject("u_clamp", "CLM");
    const a = await MACROS.get("project_mint")(ctx("u_clamp"), { projectId: pid, royaltyRate: 0.99 });
    assert.equal(a.royaltyRate, 0.30);
    const b = await MACROS.get("project_mint")(ctx("u_clamp"), { projectId: pid });
    assert.equal(b.alreadyMinted, true);
    assert.equal(b.dtuId, a.dtuId);
  });

  it("project_cite_dtu requires mint first + degrades gracefully when engine absent", async () => {
    const pid = await makeProject("u_cite", "CIT");
    const unminted = await MACROS.get("project_cite_dtu")(ctx("u_cite"), { projectId: pid, dtuId: "dtu:fake" });
    assert.equal(unminted.ok, false); assert.equal(unminted.reason, "project_not_minted_yet");

    await MACROS.get("project_mint")(ctx("u_cite"), { projectId: pid });
    db.prepare(`INSERT INTO dtus (id, kind, title, creator_id, meta_json) VALUES (?, 'whiteboard_board', 'Parent', 'u_other', '{}')`).run("dtu:wb:1");
    const r = await MACROS.get("project_cite_dtu")(ctx("u_cite"), { projectId: pid, dtuId: "dtu:wb:1" });
    assert.equal(r.ok, true);
    assert.ok(r.childDtuId);
  });

  it("project_export_pack produces v1 envelope with tasks + workflows", async () => {
    const pid = await makeProject("u_exp", "EXP");
    await MACROS.get("task_create")(ctx("u_exp"), { projectId: pid, title: "Task in pack" });
    const r = await MACROS.get("project_export_pack")(ctx("u_exp"), { projectId: pid });
    assert.equal(r.ok, true);
    assert.equal(r.pack.spec, "concord-project-pack/v1");
    assert.equal(r.pack.task_count, 1);
    assert.ok(r.pack.workflows.length >= 1);
  });
});

describe("tasks-moats: project templates", () => {
  it("project_template_list seeds 4 defaults", async () => {
    const r = await MACROS.get("project_template_list")(ctx("u_tpl"));
    assert.equal(r.ok, true);
    assert.ok(r.templates.length >= 4);
    const names = r.templates.map((t) => t.name);
    assert.ok(names.includes("Software project"));
    assert.ok(names.includes("Sprint planning"));
  });

  it("project_template_apply creates project + seed tasks + custom fields", async () => {
    const list = await MACROS.get("project_template_list")(ctx("u_apply"));
    const soft = list.templates.find((t) => t.name === "Software project");
    const r = await MACROS.get("project_template_apply")(ctx("u_apply"), {
      id: soft.id, key: "SWA", name: "Software A",
    });
    assert.equal(r.ok, true);
    assert.ok(r.seedTasks.length >= 3);
    const cfList = await MACROS.get("custom_field_list")(ctx("u_apply"), { projectId: r.projectId });
    assert.ok(cfList.fields.find((f) => f.key === "rice"));
  });

  it("project_template_apply rejects without admin if private template", async () => {
    const c = await MACROS.get("project_template_save")(ctx("u_tpriv"), {
      projectId: await makeProject("u_tpriv", "TPRV"),
      name: "Private tmpl", visibility: "private",
    });
    const r = await MACROS.get("project_template_apply")(ctx("u_other"), {
      id: c.id, key: "STOLE", name: "Stolen",
    });
    assert.equal(r.ok, false); assert.equal(r.reason, "forbidden");
  });
});

describe("tasks-moats: CSV importers", () => {
  it("parseCsv handles quoted fields with commas", () => {
    const csv = `title,description,priority\n"Comma, here","also ""quoted""",high`;
    const r = parseCsv(csv);
    assert.equal(r.rows[0].title, "Comma, here");
    assert.equal(r.rows[0].description, 'also "quoted"');
    assert.equal(r.rows[0].priority, "high");
  });

  it("detectProvider identifies Jira / Asana / generic", () => {
    assert.equal(detectProvider(["issue key", "summary", "status"]), "jira");
    assert.equal(detectProvider(["task name", "name", "assignee", "section/column"]), "asana");
    assert.equal(detectProvider(["title", "description"]), "generic");
  });

  it("importCsv normalises priority + status + type across providers", () => {
    const csv = `Title,Status,Priority,Type\nFix login bug,In Progress,P0,Bug\nDraft RFC,Backlog,P3,task`;
    const r = importCsv(csv);
    assert.equal(r.ok, true);
    assert.equal(r.rows[0].priority, "urgent");
    assert.equal(r.rows[0].type, "bug");
    assert.equal(r.rows[0].status, "st:in_progress");
    assert.equal(r.rows[1].priority, "low");
  });

  it("import_csv macro dry-run returns preview without creating tasks", async () => {
    const pid = await makeProject("u_csv", "CSV");
    const csv = `Title,Priority\nTest task,high`;
    const r = await MACROS.get("import_csv")(ctx("u_csv"), { projectId: pid, csv, dryRun: true });
    assert.equal(r.ok, true);
    assert.equal(r.dryRun, true);
    assert.equal(r.createdCount, 0);
    assert.equal(r.parsedCount, 1);
  });

  it("import_csv creates tasks + maps parent relationships in second pass", async () => {
    const pid = await makeProject("u_csv2", "CSV2");
    const csv = `id,title,parent id,priority\nE-1,Epic title,,high\nT-1,Child task,E-1,medium`;
    const r = await MACROS.get("import_csv")(ctx("u_csv2"), { projectId: pid, csv });
    assert.equal(r.ok, true);
    assert.equal(r.createdCount, 2);
    // Verify parent_id was wired
    const tasks = db.prepare(`SELECT title, parent_id FROM tasks WHERE project_id = ?`).all(pid);
    const child = tasks.find((t) => t.title === "Child task");
    assert.ok(child.parent_id != null);
  });
});

describe("tasks-moats: roadmap / timeline", () => {
  it("buildTimeline topologically sorts by dependencies + priority", () => {
    const tasks = [
      { id: "a", task_key: "A-1", title: "A", priority: "low", estimate: 1, estimate_unit: "points", status_id: "st:todo" },
      { id: "b", task_key: "A-2", title: "B", priority: "urgent", estimate: 2, estimate_unit: "points", status_id: "st:todo" },
      { id: "c", task_key: "A-3", title: "C", priority: "medium", estimate: 1, estimate_unit: "points", status_id: "st:todo" },
    ];
    const deps = [{ blocker_id: "a", blocked_id: "c", kind: "blocks" }];
    const tl = buildTimeline(tasks, deps);
    // Urgent B (no deps) should come first; A before C (dependency); critical path includes C
    assert.equal(tl.lanes[0].title, "B");
    const aIdx = tl.lanes.findIndex((l) => l.title === "A");
    const cIdx = tl.lanes.findIndex((l) => l.title === "C");
    assert.ok(aIdx < cIdx, "A should sort before C (A blocks C)");
    assert.ok(tl.criticalPath.includes("A-3"));
  });

  it("roadmap macro returns lanes + criticalPath", async () => {
    const pid = await makeProject("u_rm", "RM");
    const t1 = await MACROS.get("task_create")(ctx("u_rm"), { projectId: pid, title: "T1", estimate: 3 });
    const t2 = await MACROS.get("task_create")(ctx("u_rm"), { projectId: pid, title: "T2", estimate: 5 });
    await MACROS.get("dependency_add")(ctx("u_rm"), { blockerId: t1.id, blockedId: t2.id, kind: "blocks" });
    const r = await MACROS.get("roadmap")(ctx("u_rm"), { projectId: pid });
    assert.equal(r.ok, true);
    assert.equal(r.lanes.length, 2);
    assert.ok(r.totalDays >= 0);
    assert.ok(r.criticalPath.length >= 1);
  });
});
