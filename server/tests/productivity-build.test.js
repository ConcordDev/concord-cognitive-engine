// server/tests/productivity-build.test.js
//
// Productivity full lens build (B2) — pins, against the REAL registry
// handlers in server/domains/productivity.js:
//   S1/F1  the agenda buckets follow the viewer's local today; overdue
//          tasks ride along explicitly instead of vanishing
//   F8     the dashboard's DUE TODAY counts only tasks due today
//   S3/F3  the calendar month count excludes completed tasks
//   S5/F5  ICS priority maps onto the RFC scale both ways (round-trip
//          exact) and zoned times convert into the viewer's timezone
//   S6/F6  share/assign validate against real accounts when a users
//          directory is attached; comments carry author names
import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerProductivityActions from "../domains/productivity.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`productivity.${name}`);
  assert.ok(fn, `productivity.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerProductivityActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const today = () => new Date().toISOString().slice(0, 10);
const dayOffset = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

const USERS = [
  { id: "user_a", username: "ada", display_name: "Ada Lovelace", is_active: 1 },
  { id: "user_b", username: "bea", display_name: "Bea Knower", is_active: 1 },
];
function stubDb() {
  const cols = ["id", "username", "display_name", "is_active"].map((name) => ({ name }));
  function match(sql, value) {
    const activeFilter = sql.includes("is_active = 1");
    const pool = activeFilter ? USERS.filter((u) => u.is_active === 1) : USERS;
    // Key on the WHERE clause only — the SELECT list also names columns.
    const where = sql.slice(sql.indexOf("WHERE"));
    if (where.includes("id =")) return pool.filter((u) => u.id === value);
    if (where.includes("lower(display_name)")) return pool.filter((u) => u.display_name.toLowerCase() === String(value).toLowerCase());
    if (where.includes("display_name")) return pool.filter((u) => u.display_name === value);
    if (where.includes("lower(username)")) return pool.filter((u) => u.username.toLowerCase() === String(value).toLowerCase());
    if (where.includes("username")) return pool.filter((u) => u.username === value);
    return [];
  }
  return {
    prepare(sql) {
      if (sql.startsWith("PRAGMA")) return { all: () => cols, get: () => null };
      return {
        // Honor the SELECT alias a real driver applies (display_name AS displayName).
        get: (v) => {
          const row = match(sql, v)[0] || null;
          return row && sql.includes("AS displayName") ? { ...row, displayName: row.display_name } : row;
        },
        all: (v) => match(sql, v),
      };
    },
  };
}
const ctxDb = { actor: { userId: "user_a" }, userId: "user_a", db: stubDb() };

describe("productivity build — S1 viewer-day agenda", () => {
  it("upcoming-view starts at the viewer's today and returns overdue explicitly", () => {
    call("task-add", ctxA, { content: "Late", dueDate: "2026-10-30" });
    call("task-add", ctxA, { content: "Tomorrow task", dueDate: "2026-11-01" });
    const uv = call("upcoming-view", ctxA, { today: "2026-10-31" });
    assert.equal(uv.result.days.length, 7);
    assert.equal(uv.result.days[0].date, "2026-10-31");
    assert.equal(uv.result.days[1].date, "2026-11-01");
    assert.deepEqual(uv.result.days[1].tasks.map((t) => t.content), ["Tomorrow task"]);
    assert.deepEqual(uv.result.overdue.map((t) => t.content), ["Late"]);
    const tv = call("today-view", ctxA, { today: "2026-10-31" });
    assert.equal(tv.result.overdue, 1);
    assert.equal(tv.result.dueToday, 0);
  });

  it("dashboard DUE TODAY excludes overdue (F8)", () => {
    call("task-add", ctxA, { content: "Late", dueDate: dayOffset(-2) });
    call("task-add", ctxA, { content: "Now", dueDate: today() });
    const d = call("productivity-dashboard", ctxA, {});
    assert.equal(d.result.dueToday, 1);
    assert.equal(d.result.overdue, 1);
  });
});

describe("productivity build — S3 calendar count", () => {
  it("totalScheduled counts open tasks only; completed reported separately", () => {
    const t = call("task-add", ctxA, { content: "Done one", dueDate: today() }).result.task;
    call("task-add", ctxA, { content: "Open one", dueDate: today() });
    call("task-complete", ctxA, { id: t.id });
    const cv = call("calendar-view", ctxA, { month: today() });
    assert.equal(cv.result.totalScheduled, 1);
    assert.equal(cv.result.completedScheduled, 1);
    const cell = cv.result.days.find((d) => d.date === today());
    assert.equal(cell.tasks.length, 2, "completed task still renders in its day cell");
  });
});

describe("productivity build — S5 ICS interop", () => {
  it("export maps P4 to RFC 9 and P1 to RFC 1", () => {
    call("task-add", ctxA, { content: "Low", priority: 4, dueDate: dayOffset(3) });
    call("task-add", ctxA, { content: "High", priority: 1, dueDate: dayOffset(3) });
    const ex = call("calendar-export-ics", ctxA, {});
    assert.ok(ex.result.ics.includes("PRIORITY:9"));
    assert.ok(ex.result.ics.includes("PRIORITY:1"));
    assert.ok(!ex.result.ics.includes("PRIORITY:4"));
  });

  it("import converts a Z time into the viewer's timezone and maps RFC priority back", async () => {
    const ics = [
      "BEGIN:VCALENDAR", "VERSION:2.0",
      "BEGIN:VEVENT", "UID:z1@x", "DTSTART:20261103T150000Z", "SUMMARY:Zoned call", "PRIORITY:9", "END:VEVENT",
      "BEGIN:VEVENT", "UID:z2@x", "DTSTART:20261103T150000", "SUMMARY:Floating call", "PRIORITY:2", "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    const r = await call("calendar-import-ics", ctxA, { ics, utcOffsetMinutes: -300 });
    assert.equal(r.result.importedCount, 2);
    const zoned = r.result.imported.find((t) => t.content === "Zoned call");
    assert.equal(zoned.dueDate, "2026-11-03");
    assert.equal(zoned.dueTime, "10:00", "15:00Z is 10:00 at UTC-5");
    assert.equal(zoned.priority, 4, "RFC 9 (lowest) maps to internal P4");
    const floating = r.result.imported.find((t) => t.content === "Floating call");
    assert.equal(floating.dueTime, "15:00", "floating times keep their wall clock");
    assert.equal(floating.priority, 2, "RFC 2 maps to internal P2");
  });
});

describe("productivity build — S6 collaborate identity", () => {
  it("share resolves a display name, rejects unknown people, keeps names", () => {
    const p = call("project-create", ctxDb, { name: "Shared" }).result.project;
    const ghost = call("project-share", ctxDb, { projectId: p.id, collaboratorId: "Nobody Here" });
    assert.equal(ghost.ok, false);
    assert.equal(ghost.error, "unknown user");
    const sh = call("project-share", ctxDb, { projectId: p.id, collaboratorId: "Bea Knower", role: "editor" });
    assert.equal(sh.ok, true);
    assert.equal(sh.result.share.collaboratorId, "user_b");
    assert.equal(sh.result.share.collaboratorName, "Bea Knower");
    const list = call("project-collaborators", ctxDb, { projectId: p.id });
    assert.equal(list.result.collaborators[0].collaboratorName, "Bea Knower");
  });

  it("assign validates too; comments carry the author's name", () => {
    const t = call("task-add", ctxDb, { content: "Collab" }).result.task;
    const bad = call("task-assign", ctxDb, { taskId: t.id, assigneeId: "ghost-person" });
    assert.equal(bad.ok, false);
    const good = call("task-assign", ctxDb, { taskId: t.id, assigneeId: "@bea" });
    assert.equal(good.result.task.assigneeId, "user_b");
    assert.equal(good.result.task.assigneeName, "Bea Knower");
    call("task-comment-add", ctxDb, { taskId: t.id, body: "Looks good" });
    const cm = call("task-comments", ctxDb, { taskId: t.id });
    assert.equal(cm.result.comments[0].authorName, "Ada Lovelace");
  });

  it("directory-less contexts keep the previous accept-as-id behavior", () => {
    const p = call("project-create", ctxA, { name: "MacroShared" }).result.project;
    const sh = call("project-share", ctxA, { projectId: p.id, collaboratorId: "user_b" });
    assert.equal(sh.ok, true);
    assert.equal(sh.result.share.collaboratorId, "user_b");
  });
});
