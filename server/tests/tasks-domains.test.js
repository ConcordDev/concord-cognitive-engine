// server/tests/tasks-domains.test.js
//
// Tier-2 contract tests for the five Tasks domain files
// (tasks / tasks-workflow / tasks-sprint / tasks-collab / tasks-views).
// Exercises macro envelope shape, permission gates, workflow
// validation, sprint burndown math, and saved-view round-trip.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import registerTasksMacros from "../domains/tasks.js";
import registerTasksWorkflowMacros from "../domains/tasks-workflow.js";
import registerTasksSprintMacros from "../domains/tasks-sprint.js";
import registerTasksCollabMacros from "../domains/tasks-collab.js";
import registerTasksViewsMacros from "../domains/tasks-views.js";

const MACROS = new Map();
function register(_d, n, h) { MACROS.set(n, h); }
let db;

before(async () => {
  db = new Database(":memory:");
  const mig = await import("../migrations/214_tasks.js");
  mig.up(db);
  registerTasksMacros(register);
  registerTasksWorkflowMacros(register);
  registerTasksSprintMacros(register);
  registerTasksCollabMacros(register);
  registerTasksViewsMacros(register);
});
after(() => { try { db.close(); } catch { /* ok */ } });

function ctx(userId = "u_dom") { return { db, actor: { userId } }; }

async function makeProject(userId = "u_dom", key = "DOM") {
  const r = await MACROS.get("project_create")(ctx(userId), { key, name: "Domain test" });
  return r.id;
}

describe("tasks domain: project + task CRUD", () => {
  it("project_create + project_get round-trip", async () => {
    const c = await MACROS.get("project_create")(ctx("u_a"), { key: "AAA", name: "Alpha" });
    assert.equal(c.ok, true);
    const g = await MACROS.get("project_get")(ctx("u_a"), { id: c.id });
    assert.equal(g.project.name, "Alpha");
    assert.equal(g.project.key, "AAA");
  });

  it("project_get_by_key resolves project by uppercase key", async () => {
    await MACROS.get("project_create")(ctx("u_b"), { key: "BETA", name: "Beta" });
    const r = await MACROS.get("project_get_by_key")(ctx("u_b"), { key: "beta" });
    assert.equal(r.project.key, "BETA");
  });

  it("task_create generates PROJ-N keys + auto-watcher reporter", async () => {
    const pid = await makeProject("u_t", "TSK");
    const t = await MACROS.get("task_create")(ctx("u_t"), { projectId: pid, title: "Task 1" });
    assert.equal(t.ok, true);
    assert.equal(t.taskKey, "TSK-1");
    const list = await MACROS.get("task_list")(ctx("u_t"), { projectId: pid });
    assert.equal(list.tasks.length, 1);
  });

  it("task_get enriches with labels + participants + dependencies", async () => {
    const pid = await makeProject("u_enrich", "ENR");
    const t = await MACROS.get("task_create")(ctx("u_enrich"), {
      projectId: pid, title: "Enriched", labels: ["x"], assigneeId: "u_enrich",
    });
    const r = await MACROS.get("task_get")(ctx("u_enrich"), { id: t.id });
    assert.deepEqual(r.task.labels, ["x"]);
    assert.ok(r.task.participants.length >= 1);
    assert.ok(r.task.dependencies);
  });

  it("task_create forbidden for non-member", async () => {
    const pid = await makeProject("u_owner_f", "FRB");
    const r = await MACROS.get("task_create")(ctx("u_outsider"), { projectId: pid, title: "Hacked" });
    assert.equal(r.ok, false); assert.equal(r.reason, "forbidden");
  });

  it("task_assigned_to_me lists across projects", async () => {
    const p1 = await makeProject("u_me", "ME1");
    const p2 = await makeProject("u_me", "ME2");
    await MACROS.get("task_create")(ctx("u_me"), { projectId: p1, title: "P1", assigneeId: "u_me" });
    await MACROS.get("task_create")(ctx("u_me"), { projectId: p2, title: "P2", assigneeId: "u_me" });
    const r = await MACROS.get("task_assigned_to_me")(ctx("u_me"));
    assert.ok(r.tasks.length >= 2);
  });

  it("task_bulk_update transitions status across many tasks", async () => {
    const pid = await makeProject("u_bulk", "BLK");
    const ids = [];
    for (let i = 0; i < 5; i++) {
      const t = await MACROS.get("task_create")(ctx("u_bulk"), { projectId: pid, title: `T${i}` });
      ids.push(t.id);
    }
    const r = await MACROS.get("task_bulk_update")(ctx("u_bulk"), { ids, patch: { priority: "high" } });
    assert.equal(r.updated, 5);
    const list = await MACROS.get("task_list")(ctx("u_bulk"), { projectId: pid });
    assert.ok(list.tasks.every((t) => t.priority === "high"));
  });
});

describe("tasks-workflow domain", () => {
  it("workflow_list returns the default workflow seeded on project_create", async () => {
    const pid = await makeProject("u_wf", "WF");
    const r = await MACROS.get("workflow_list")(ctx("u_wf"), { projectId: pid });
    assert.equal(r.workflows.length, 1);
    assert.equal(r.workflows[0].is_default, 1);
    assert.ok(r.workflows[0].statuses.length >= 5);
  });

  it("workflow_create with custom statuses works", async () => {
    const pid = await makeProject("u_wf2", "WF2");
    const r = await MACROS.get("workflow_create")(ctx("u_wf2"), {
      projectId: pid, name: "Custom",
      statuses: [
        { id: "st:custom_todo", name: "Custom Todo", category: "todo", color: "#fff" },
        { id: "st:custom_done", name: "Custom Done", category: "done", color: "#000" },
      ],
    });
    assert.equal(r.ok, true);
  });

  it("workflow_create rejects invalid status category", async () => {
    const pid = await makeProject("u_inv", "INV");
    const r = await MACROS.get("workflow_create")(ctx("u_inv"), {
      projectId: pid, name: "Bad",
      statuses: [{ id: "s1", name: "Bad", category: "fake_category" }],
    });
    assert.equal(r.ok, false);
    assert.ok(r.reason.startsWith("unknown_category_"));
  });

  it("workflow status transition gate enforces transitions_json", async () => {
    const pid = await makeProject("u_trans", "TRS");
    const wf = await MACROS.get("workflow_create")(ctx("u_trans"), {
      projectId: pid, name: "Strict",
      statuses: [
        { id: "open", name: "Open", category: "todo" },
        { id: "doing", name: "Doing", category: "in_progress" },
        { id: "done", name: "Done", category: "done" },
      ],
      transitions: [{ from: "open", to: "doing" }, { from: "doing", to: "done" }],
      defaultStatusId: "open",
    });
    const t = await MACROS.get("task_create")(ctx("u_trans"), {
      projectId: pid, title: "Strict task", workflowId: wf.id,
    });
    // open → done is not allowed; open → doing is
    const skip = await MACROS.get("task_update")(ctx("u_trans"), { id: t.id, statusId: "done" });
    assert.equal(skip.ok, false);
    assert.equal(skip.reason, "transition_not_allowed");
    const okR = await MACROS.get("task_update")(ctx("u_trans"), { id: t.id, statusId: "doing" });
    assert.equal(okR.ok, true);
  });

  it("custom_field_create + list + delete round-trip", async () => {
    const pid = await makeProject("u_cf", "CFL");
    const c = await MACROS.get("custom_field_create")(ctx("u_cf"), {
      projectId: pid, key: "rice", label: "RICE score", type: "number",
    });
    assert.equal(c.ok, true);
    const list = await MACROS.get("custom_field_list")(ctx("u_cf"), { projectId: pid });
    assert.equal(list.fields.length, 1);
    const dup = await MACROS.get("custom_field_create")(ctx("u_cf"), {
      projectId: pid, key: "rice", label: "Dup", type: "number",
    });
    assert.equal(dup.ok, false);
    assert.equal(dup.reason, "key_taken");
  });
});

describe("tasks-sprint domain", () => {
  let pid;
  before(async () => { pid = await makeProject("u_sp", "SPR"); });

  it("sprint_create + sprint_list + add_task + remove_task", async () => {
    const s = await MACROS.get("sprint_create")(ctx("u_sp"), {
      projectId: pid, name: "Sprint 1", startAt: Math.floor(Date.now()/1000), endAt: Math.floor(Date.now()/1000) + 14*86400,
    });
    assert.equal(s.ok, true);
    const t = await MACROS.get("task_create")(ctx("u_sp"), { projectId: pid, title: "In sprint", estimate: 5 });
    const a = await MACROS.get("sprint_add_task")(ctx("u_sp"), { sprintId: s.id, taskId: t.id });
    assert.equal(a.ok, true);
    const list = await MACROS.get("sprint_list")(ctx("u_sp"), { projectId: pid });
    assert.ok(list.sprints.find((x) => x.id === s.id));
    const rm = await MACROS.get("sprint_remove_task")(ctx("u_sp"), { sprintId: s.id, taskId: t.id });
    assert.equal(rm.ok, true);
  });

  it("sprint_burndown computes points + pacing", async () => {
    const s = await MACROS.get("sprint_create")(ctx("u_sp"), {
      projectId: pid, name: "Burndown sprint",
      startAt: Math.floor(Date.now()/1000) - 5*86400,
      endAt: Math.floor(Date.now()/1000) + 5*86400,
    });
    const t = await MACROS.get("task_create")(ctx("u_sp"), { projectId: pid, title: "10pt", estimate: 10 });
    await MACROS.get("sprint_add_task")(ctx("u_sp"), { sprintId: s.id, taskId: t.id });
    const r = await MACROS.get("sprint_burndown")(ctx("u_sp"), { sprintId: s.id });
    assert.equal(r.ok, true);
    assert.equal(r.totalPoints, 10);
    assert.ok(["ahead","on-track","behind"].includes(r.pacing));
  });

  it("time_log + time_entries round-trip", async () => {
    const t = await MACROS.get("task_create")(ctx("u_sp"), { projectId: pid, title: "Timed" });
    await MACROS.get("time_log")(ctx("u_sp"), { taskId: t.id, seconds: 3600, note: "1hr" });
    const r = await MACROS.get("time_entries")(ctx("u_sp"), { taskId: t.id });
    assert.equal(r.entries.length, 1);
    assert.equal(r.totalSeconds, 3600);
  });
});

describe("tasks-collab domain", () => {
  let pid, tid;
  before(async () => {
    pid = await makeProject("u_col", "COL");
    tid = (await MACROS.get("task_create")(ctx("u_col"), { projectId: pid, title: "Collab task" })).id;
  });

  it("comment_add + comment_list + comment_resolve", async () => {
    const c = await MACROS.get("comment_add")(ctx("u_col"), { taskId: tid, body: "First comment" });
    assert.equal(c.ok, true);
    const list = await MACROS.get("comment_list")(ctx("u_col"), { taskId: tid });
    assert.ok(list.comments.find((x) => x.id === c.id));
    const r = await MACROS.get("comment_resolve")(ctx("u_col"), { commentId: c.id });
    assert.equal(r.ok, true);
    const filtered = await MACROS.get("comment_list")(ctx("u_col"), { taskId: tid, onlyUnresolved: true });
    assert.ok(!filtered.comments.find((x) => x.id === c.id));
  });

  it("participant_add + remove", async () => {
    await MACROS.get("participant_add")(ctx("u_col"), { taskId: tid, userId: "u_observer", role: "watcher" });
    const list = await MACROS.get("participant_list")(ctx("u_col"), { taskId: tid });
    assert.ok(list.participants.find((p) => p.user_id === "u_observer" && p.role === "watcher"));
    await MACROS.get("participant_remove")(ctx("u_col"), { taskId: tid, userId: "u_observer", role: "watcher" });
    const after = await MACROS.get("participant_list")(ctx("u_col"), { taskId: tid });
    assert.ok(!after.participants.find((p) => p.user_id === "u_observer"));
  });

  it("link_add validates kind and stores target", async () => {
    const bad = await MACROS.get("link_add")(ctx("u_col"), { taskId: tid, kind: "garbage", targetId: "x" });
    assert.equal(bad.ok, false);
    const okR = await MACROS.get("link_add")(ctx("u_col"), { taskId: tid, kind: "doc", targetId: "doc:abc", label: "Spec" });
    assert.equal(okR.ok, true);
    const list = await MACROS.get("link_list")(ctx("u_col"), { taskId: tid });
    assert.ok(list.links.find((l) => l.target_id === "doc:abc" && l.target_kind === "doc"));
  });

  it("attachment_record + list", async () => {
    await MACROS.get("attachment_record")(ctx("u_col"), {
      taskId: tid, url: "/api/docs-asset/dimg_x", filename: "a.png", mimeType: "image/png", byteSize: 1024,
    });
    const list = await MACROS.get("attachment_list")(ctx("u_col"), { taskId: tid });
    assert.equal(list.attachments.length, 1);
    assert.equal(list.attachments[0].byte_size, 1024);
  });
});

describe("tasks-views domain", () => {
  it("view_save + view_list + view_delete", async () => {
    const s = await MACROS.get("view_save")(ctx("u_v"), {
      name: "My board", viewKind: "board", filters: { priority: ["high","urgent"] },
    });
    assert.equal(s.ok, true);
    const list = await MACROS.get("view_list")(ctx("u_v"));
    assert.ok(list.views.find((v) => v.id === s.id));
    const d = await MACROS.get("view_delete")(ctx("u_v"), { id: s.id });
    assert.equal(d.ok, true);
  });

  it("view_save with explicit id upserts", async () => {
    const a = await MACROS.get("view_save")(ctx("u_up"), { id: "view:fixed", name: "v1", viewKind: "list" });
    const b = await MACROS.get("view_save")(ctx("u_up"), { id: "view:fixed", name: "v2", viewKind: "board" });
    assert.equal(a.id, b.id);
    const g = await MACROS.get("view_get")(ctx("u_up"), { id: "view:fixed" });
    assert.equal(g.view.name, "v2");
    assert.equal(g.view.view_kind, "board");
  });
});

describe("tasks domain: dependencies", () => {
  it("dependency_add blocks/blocked-by + read", async () => {
    const pid = await makeProject("u_dep", "DEP");
    const t1 = await MACROS.get("task_create")(ctx("u_dep"), { projectId: pid, title: "Blocker" });
    const t2 = await MACROS.get("task_create")(ctx("u_dep"), { projectId: pid, title: "Blocked" });
    const r = await MACROS.get("dependency_add")(ctx("u_dep"), { blockerId: t1.id, blockedId: t2.id, kind: "blocks" });
    assert.equal(r.ok, true);
    const got = await MACROS.get("task_get")(ctx("u_dep"), { id: t1.id });
    assert.ok(got.task.dependencies.blocks.find((b) => b.task_key === t2.taskKey));
    const blocked = await MACROS.get("task_get")(ctx("u_dep"), { id: t2.id });
    assert.ok(blocked.task.dependencies.blockedBy.find((b) => b.task_key === t1.taskKey));
  });

  it("dependency_add rejects self-dependency", async () => {
    const pid = await makeProject("u_self", "SLF");
    const t = await MACROS.get("task_create")(ctx("u_self"), { projectId: pid, title: "Self" });
    const r = await MACROS.get("dependency_add")(ctx("u_self"), { blockerId: t.id, blockedId: t.id });
    assert.equal(r.ok, false); assert.equal(r.reason, "self_dependency_not_allowed");
  });
});
