// server/tests/tasks-persistence.test.js
//
// Tier-2 contract tests for the migration-214 substrate. Real
// SQLite, real CRUD round-trip, real role enforcement, real
// transactional workflow seeding, real history audit trail.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import {
  createProject, getProject, getProjectByKey, listProjectsForUser, updateProject, deleteProject,
  getProjectRole, hasProjectRole, inviteMember, listMembers,
  createTask, getTask, updateTask, softDeleteTask, listTasks,
  getLabelsForTask, setLabels, getParticipants, getDependencies, getHistory,
  nextTaskKey,
} from "../lib/tasks/persistence.js";

let db;

before(async () => {
  db = new Database(":memory:");
  const mig = await import("../migrations/214_tasks.js");
  mig.up(db);
});
after(() => { try { db.close(); } catch { /* ok */ } });

describe("tasks-persistence: createProject", () => {
  it("seeds default workflow + owner row in one transaction", () => {
    const r = createProject(db, { ownerId: "u_owner", key: "ACME", name: "Acme" });
    assert.equal(r.ok, true);
    assert.ok(r.id.startsWith("proj:"));
    assert.ok(r.workflowId.startsWith("wf:"));
    assert.equal(r.key, "ACME");
    const proj = getProject(db, r.id);
    assert.equal(proj.default_workflow_id, r.workflowId);
    assert.equal(getProjectRole(db, r.id, "u_owner"), "owner");
  });

  it("rejects lowercase / malformed keys", () => {
    const a = createProject(db, { ownerId: "u", key: "lowercase", name: "x" });
    assert.equal(a.reason, "key_must_be_uppercase_2_to_10_chars");
    const b = createProject(db, { ownerId: "u", key: "A", name: "x" });
    assert.equal(b.reason, "key_must_be_uppercase_2_to_10_chars");
    const c = createProject(db, { ownerId: "u", key: "TOOLONGKEYY", name: "x" });
    assert.equal(c.reason, "key_must_be_uppercase_2_to_10_chars");
  });

  it("UNIQUE key collision returns key_taken", () => {
    createProject(db, { ownerId: "u", key: "UNIQ", name: "First" });
    const dup = createProject(db, { ownerId: "u2", key: "UNIQ", name: "Second" });
    assert.equal(dup.ok, false);
    assert.equal(dup.reason, "key_taken");
  });
});

describe("tasks-persistence: roles", () => {
  let pid;
  before(() => { pid = createProject(db, { ownerId: "u_owner_r", key: "ROLE", name: "Roles" }).id; });

  it("hasProjectRole respects rank ordering", () => {
    inviteMember(db, { projectId: pid, userId: "u_admin", role: "admin", invitedBy: "u_owner_r" });
    inviteMember(db, { projectId: pid, userId: "u_member", role: "member", invitedBy: "u_owner_r" });
    inviteMember(db, { projectId: pid, userId: "u_viewer", role: "viewer", invitedBy: "u_owner_r" });
    assert.equal(hasProjectRole(db, pid, "u_admin", "admin"), true);
    assert.equal(hasProjectRole(db, pid, "u_admin", "owner"), false);
    assert.equal(hasProjectRole(db, pid, "u_member", "member"), true);
    assert.equal(hasProjectRole(db, pid, "u_viewer", "member"), false);
    assert.equal(hasProjectRole(db, pid, "u_viewer", "viewer"), true);
    assert.equal(hasProjectRole(db, pid, "u_stranger", "viewer"), false);
  });

  it("public visibility grants viewer to anyone", () => {
    updateProject(db, pid, { visibility: "public" });
    assert.equal(getProjectRole(db, pid, "u_anybody"), "viewer");
  });

  it("inviteMember requires admin role", () => {
    const r = inviteMember(db, { projectId: pid, userId: "u_x", role: "member", invitedBy: "u_member" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "forbidden");
  });
});

describe("tasks-persistence: task creation + keys", () => {
  let pid;
  before(() => { pid = createProject(db, { ownerId: "u_t", key: "TASK", name: "Tasks" }).id; });

  it("createTask generates sequential PROJ-N keys", () => {
    const t1 = createTask(db, { projectId: pid, reporterId: "u_t", title: "First" });
    const t2 = createTask(db, { projectId: pid, reporterId: "u_t", title: "Second" });
    assert.equal(t1.taskKey, "TASK-1");
    assert.equal(t2.taskKey, "TASK-2");
  });

  it("createTask seeds reporter as watcher + writes 'created' history", () => {
    const t = createTask(db, { projectId: pid, reporterId: "u_t", title: "Third" });
    const parts = getParticipants(db, t.id);
    assert.ok(parts.find((p) => p.role === "watcher" && p.user_id === "u_t"));
    const hist = getHistory(db, t.id);
    assert.ok(hist.find((h) => h.action === "created"));
  });

  it("createTask with assignee seeds assignee participant row", () => {
    const t = createTask(db, { projectId: pid, reporterId: "u_t", title: "Assigned", assigneeId: "u_assignee" });
    const parts = getParticipants(db, t.id);
    assert.ok(parts.find((p) => p.role === "assignee" && p.user_id === "u_assignee"));
  });

  it("createTask with labels writes label rows", () => {
    const t = createTask(db, { projectId: pid, reporterId: "u_t", title: "Tagged", labels: ["frontend", "urgent"] });
    const labels = getLabelsForTask(db, t.id);
    assert.deepEqual(labels.sort(), ["frontend", "urgent"]);
  });

  it("getTask works with both id and PROJ-N key", () => {
    const t = createTask(db, { projectId: pid, reporterId: "u_t", title: "Lookup" });
    const byId = getTask(db, t.id);
    const byKey = getTask(db, t.taskKey);
    assert.equal(byId.id, byKey.id);
  });
});

describe("tasks-persistence: updateTask + history", () => {
  let pid, tid;
  before(() => {
    pid = createProject(db, { ownerId: "u_upd", key: "UPD", name: "Updates" }).id;
    tid = createTask(db, { projectId: pid, reporterId: "u_upd", title: "Original" }).id;
  });

  it("updates title and writes retitled history", () => {
    updateTask(db, tid, "u_upd", { title: "Renamed" });
    const t = getTask(db, tid);
    assert.equal(t.title, "Renamed");
    const hist = getHistory(db, tid);
    assert.ok(hist.find((h) => h.action === "retitled" && h.after_value === "Renamed"));
  });

  it("updates assignee + writes assigned history + syncs participant row", () => {
    updateTask(db, tid, "u_upd", { assigneeId: "u_new" });
    const t = getTask(db, tid);
    assert.equal(t.assignee_id, "u_new");
    const parts = getParticipants(db, tid);
    assert.ok(parts.find((p) => p.role === "assignee" && p.user_id === "u_new"));
    const hist = getHistory(db, tid);
    assert.ok(hist.find((h) => h.action === "assigned" && h.after_value === "u_new"));
  });

  it("updates priority + writes reprioritized history", () => {
    updateTask(db, tid, "u_upd", { priority: "urgent" });
    const t = getTask(db, tid);
    assert.equal(t.priority, "urgent");
    const hist = getHistory(db, tid);
    assert.ok(hist.find((h) => h.action === "reprioritized" && h.after_value === "urgent"));
  });

  it("softDeleteTask requires member role", () => {
    const t = createTask(db, { projectId: pid, reporterId: "u_upd", title: "Doomed" });
    const denied = softDeleteTask(db, t.id, "u_outsider");
    assert.equal(denied.reason, "forbidden");
    const okR = softDeleteTask(db, t.id, "u_upd");
    assert.equal(okR.ok, true);
    assert.equal(getTask(db, t.id), null);
  });
});

describe("tasks-persistence: listTasks filtering", () => {
  let pid;
  before(() => {
    pid = createProject(db, { ownerId: "u_list", key: "LST", name: "List" }).id;
    createTask(db, { projectId: pid, reporterId: "u_list", title: "T1", labels: ["a"] });
    createTask(db, { projectId: pid, reporterId: "u_list", title: "T2", assigneeId: "u_X", labels: ["b"] });
    createTask(db, { projectId: pid, reporterId: "u_list", title: "T3", assigneeId: "u_X", labels: ["a","b"] });
  });

  it("filters by project + by assignee", () => {
    const all = listTasks(db, { projectId: pid });
    assert.equal(all.length, 3);
    const mine = listTasks(db, { projectId: pid, assigneeId: "u_X" });
    assert.equal(mine.length, 2);
  });

  it("filters by labels (intersection of label set)", () => {
    const a = listTasks(db, { projectId: pid, labels: ["a"] });
    assert.equal(a.length, 2);
    const both = listTasks(db, { projectId: pid, labels: ["a", "b"] });
    assert.ok(both.length >= 1);
  });

  it("search matches title and key", () => {
    const r = listTasks(db, { projectId: pid, search: "T1" });
    assert.equal(r.length, 1);
    assert.equal(r[0].title, "T1");
  });
});
