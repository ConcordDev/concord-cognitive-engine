// Behaviour tests for Projects assignment identity (Review 4,
// projects.md F4 + §3b D3, slice S4/D3; §8 Q2 ruling 2026-10-29 —
// REAL ACCOUNTS ONLY). Membership in a project is the platform ACL:
// the owner plus accounts holding an active grant on kind "project"
// (server/lib/artifact-acl.js). task.assigneeId holds an account
// userId; there is no free-text member or assignee path. Legacy
// free-text member records migrate by remove-and-receipt (S4 plan §4).
// The db is a real in-memory SQLite (the repo's artifact-acl suite
// uses the same better-sqlite3 pattern) with a minimal users table.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { initArtifactAclTable } from "../lib/artifact-acl.js";
import registerProjectsActions from "../domains/projects.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`projects.${name}`);
  assert.ok(fn, `projects.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

function testDb() {
  const db = new Database(":memory:");
  db.exec("CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL DEFAULT '', role TEXT NOT NULL DEFAULT 'member', scopes TEXT NOT NULL DEFAULT '[\"read\",\"write\"]', created_at TEXT NOT NULL DEFAULT '2026-01-01', last_login_at TEXT, is_active INTEGER NOT NULL DEFAULT 1)");
  initArtifactAclTable(db);
  const ins = db.prepare("INSERT INTO users (id, username, email) VALUES (?, ?, ?)");
  ins.run("user_a", "usera", "a@example.test");
  ins.run("user_bea", "bea", "bea@example.test");
  ins.run("user_cy", "cy", "cy@example.test");
  return db;
}

before(() => { registerProjectsActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map(), db: testDb() };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_bea" }, userId: "user_bea" };

function project(ctx = ctxA, name = "Apollo", key = "APO") {
  return call("project-create", ctx, { name, key }).result.project;
}

describe("projects assignment — real accounts (S4/F4)", () => {
  it("the owner is a member and can assign work to themselves; it lands in My Work", () => {
    const p = project();
    const members = call("member-list", ctxA, { projectId: p.id }).result.members;
    assert.deepEqual(members.map((m) => m.userId), ["user_a"]);
    assert.equal(members[0].level, "owner");
    const task = call("task-create", ctxA, { projectId: p.id, title: "Mine", assigneeId: "user_a" });
    assert.equal(task.ok, true);
    const mine = call("my-work", ctxA, {});
    assert.equal(mine.result.count, 1);
    assert.equal(mine.result.tasks[0].projectName, "Apollo");
  });

  it("member-add grants a real account by @username; the account becomes assignable", () => {
    const p = project();
    const added = call("member-add", ctxA, { projectId: p.id, account: "@bea", level: "view" });
    assert.equal(added.ok, true);
    assert.equal(added.result.member.userId, "user_bea");
    assert.equal(added.result.member.level, "view");
    assert.equal(added.result.member.name, "bea");
    const members = call("member-list", ctxA, { projectId: p.id }).result.members;
    assert.deepEqual(members.map((m) => m.userId), ["user_a", "user_bea"]);
    const task = call("task-create", ctxA, { projectId: p.id, title: "Bea's", assigneeId: "user_bea" });
    assert.equal(task.ok, true);
    // Re-granting updates the level (the manager's update path).
    const again = call("member-add", ctxA, { projectId: p.id, account: "bea", level: "edit" });
    assert.equal(again.result.updated, true);
    assert.equal(again.result.member.level, "edit");
  });

  it("free-text names are refused as identities, in the refusal's own words", () => {
    const p = project();
    const noAccount = call("member-add", ctxA, { projectId: p.id });
    assert.equal(noAccount.ok, false);
    assert.match(noAccount.error, /free-text names are not supported/);
    const ghost = call("member-add", ctxA, { projectId: p.id, account: "Ada Lovelace" });
    assert.equal(ghost.ok, false);
    assert.match(ghost.error, /no Concord account found/);
    const self = call("member-add", ctxA, { projectId: p.id, account: "usera" });
    assert.equal(self.ok, false);
    assert.match(self.error, /already a member/);
  });

  it("assigning to a real account that is not a member is refused by name", () => {
    const p = project();
    const created = call("task-create", ctxA, { projectId: p.id, title: "Nope", assigneeId: "user_cy" });
    assert.equal(created.ok, false);
    assert.match(created.error, /not a member of this project/);
    const task = call("task-create", ctxA, { projectId: p.id, title: "Ok" }).result.task;
    const updated = call("task-update", ctxA, { id: task.id, assigneeId: "user_cy" });
    assert.equal(updated.ok, false);
    assert.match(updated.error, /not a member of this project/);
  });

  it("revoking a member unassigns their work in the project and ends assignability", () => {
    const p = project();
    call("member-add", ctxA, { projectId: p.id, account: "bea" });
    const task = call("task-create", ctxA, { projectId: p.id, title: "Bea's", assigneeId: "user_bea" }).result.task;
    const removed = call("member-delete", ctxA, { projectId: p.id, id: "user_bea" });
    assert.equal(removed.ok, true);
    const after = call("task-list", ctxA, { projectId: p.id }).result.tasks.find((x) => x.id === task.id);
    assert.equal(after.assigneeId, null);
    assert.deepEqual(call("member-list", ctxA, { projectId: p.id }).result.members.map((m) => m.userId), ["user_a"]);
    const again = call("task-create", ctxA, { projectId: p.id, title: "Again", assigneeId: "user_bea" });
    assert.equal(again.ok, false);
    const ownerOut = call("member-delete", ctxA, { projectId: p.id, id: "user_a" });
    assert.equal(ownerOut.ok, false);
    assert.match(ownerOut.error, /owner cannot be removed/);
  });

  it("legacy free-text members migrate by remove-and-receipt, exactly once", () => {
    const p = project();
    const s = globalThis._concordSTATE.projectsLens;
    s.members.set("user_a", [
      { id: "mbr_old1", projectId: p.id, name: "Ada", role: "engineer", createdAt: "2026-10-01T00:00:00.000Z" },
      { id: "mbr_old2", projectId: p.id, name: "Sam", role: "design", createdAt: "2026-10-01T00:00:00.000Z" },
    ]);
    const t1 = call("task-create", ctxA, { projectId: p.id, title: "Legacy 1" }).result.task;
    const t2 = call("task-create", ctxA, { projectId: p.id, title: "Legacy 2" }).result.task;
    const tasks = s.tasks.get("user_a");
    tasks.find((x) => x.id === t1.id).assigneeId = "mbr_old1";
    tasks.find((x) => x.id === t2.id).assigneeId = "mbr_old2";
    const members = call("member-list", ctxA, { projectId: p.id }).result.members;
    assert.deepEqual(members.map((m) => m.userId), ["user_a"], "legacy names are gone; only accounts remain");
    assert.equal(s.members.get("user_a").length, 0);
    const list = call("task-list", ctxA, { projectId: p.id }).result.tasks;
    assert.equal(list.find((x) => x.id === t1.id).assigneeId, null);
    assert.equal(list.find((x) => x.id === t2.id).assigneeId, null);
    const receipts = call("activity-list", ctxA, { projectId: p.id }).result.activity
      .filter((a) => a.action === "members_migrated");
    assert.equal(receipts.length, 1);
    assert.match(receipts[0].detail, /2 legacy name\(s\) removed, 2 assignment\(s\) cleared/);
    call("member-list", ctxA, { projectId: p.id });
    const again = call("activity-list", ctxA, { projectId: p.id }).result.activity
      .filter((a) => a.action === "members_migrated");
    assert.equal(again.length, 1, "the migration runs once, not per read");
  });

  it("duplicate copies no membership: the copy starts owner-only", () => {
    const p = project();
    call("member-add", ctxA, { projectId: p.id, account: "bea" });
    call("task-create", ctxA, { projectId: p.id, title: "Bea's", assigneeId: "user_bea" });
    call("task-create", ctxA, { projectId: p.id, title: "Mine", assigneeId: "user_a" });
    const dup = call("project-duplicate", ctxA, { id: p.id });
    assert.equal(dup.result.copied.members, 1);
    const copy = dup.result.project;
    assert.deepEqual(call("member-list", ctxA, { projectId: copy.id }).result.members.map((m) => m.userId), ["user_a"]);
    const tasks = call("task-list", ctxA, { projectId: copy.id }).result.tasks;
    assert.equal(tasks.find((x) => x.title === "Bea's").assigneeId, null);
    assert.equal(tasks.find((x) => x.title === "Mine").assigneeId, "user_a");
  });
});

describe("projects My Work (D3)", () => {
  it("lists the caller's open assignments across projects, due-first; completing one removes it", () => {
    const p1 = project(ctxA, "Apollo", "APO");
    const p2 = project(ctxA, "Zephyr", "ZEP");
    call("task-create", ctxA, { projectId: p1.id, title: "Later", assigneeId: "user_a", dueDate: "2026-12-01" });
    call("task-create", ctxA, { projectId: p2.id, title: "Sooner", assigneeId: "user_a", dueDate: "2026-11-02" });
    call("task-create", ctxA, { projectId: p1.id, title: "Not mine" });
    const done = call("task-create", ctxA, { projectId: p1.id, title: "Finished", assigneeId: "user_a" }).result.task;
    call("task-move-status", ctxA, { id: done.id, status: "done" });
    const mine = call("my-work", ctxA, {});
    assert.deepEqual(mine.result.tasks.map((x) => x.title), ["Sooner", "Later"]);
    assert.equal(mine.result.tasks[0].projectKey, "ZEP");
    const sooner = mine.result.tasks[0];
    call("task-move-status", ctxA, { id: sooner.id, status: "done" });
    assert.deepEqual(call("my-work", ctxA, {}).result.tasks.map((x) => x.title), ["Later"]);
    const board = call("board", ctxA, { projectId: p2.id }).result;
    const doneCol = board.columns.find((c) => c.status === "done");
    assert.equal(doneCol.tasks.length, 1, "completing in My Work updates the project's board");
  });

  it("shared-with-me discovers projects other accounts granted the caller", () => {
    const p = project(ctxB, "Bea's Board", "BEA");
    call("member-add", ctxB, { projectId: p.id, account: "usera", level: "view" });
    const shared = call("shared-with-me", ctxA, {});
    assert.equal(shared.result.count, 1);
    assert.equal(shared.result.projects[0].name, "Bea's Board");
    assert.equal(shared.result.projects[0].level, "view");
    assert.equal(shared.result.projects[0].ownerName, "bea");
  });
});

describe("A18 project-get members feed the assignee picker (R4 S4 re-review)", () => {
  it("a fresh project's project-get members contain the owner row — and match member-list", () => {
    const p = project();
    const got = call("project-get", ctxA, { id: p.id });
    assert.equal(got.ok, true);
    // The Board/Backlog panels pass project-get.members straight into the
    // task detail's Assignee select. This payload used to be the raw legacy
    // member store — empty on account-era projects — so the picker rendered
    // only "Unassigned" and self-assignment was impossible on the live
    // surface even though the write path accepted it.
    assert.equal(got.result.members.length, 1);
    const ownerRow = got.result.members[0];
    assert.equal(ownerRow.id, "user_a");
    assert.equal(ownerRow.userId, "user_a");
    assert.equal(ownerRow.level, "owner");
    assert.ok(ownerRow.name && ownerRow.name.length > 0);
    const listed = call("member-list", ctxA, { projectId: p.id });
    assert.deepEqual(
      got.result.members.map((m) => m.id).sort(),
      listed.result.members.map((m) => m.id).sort(),
    );
  });

  it("a granted member appears in project-get members too", () => {
    const p = project();
    call("member-add", ctxA, { projectId: p.id, account: "@bea" });
    const got = call("project-get", ctxA, { id: p.id });
    assert.deepEqual(got.result.members.map((m) => m.id).sort(), ["user_a", "user_bea"]);
  });
});
