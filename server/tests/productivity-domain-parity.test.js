// Contract tests for the productivity Todoist + TickTick 2026-parity
// task-manager macros (tasks, projects, labels, smart views, habits,
// focus, Eisenhower, karma).

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
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };
const today = () => new Date().toISOString().slice(0, 10);
const dayOffset = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

describe("productivity.task-* CRUD", () => {
  it("add requires content, scoped per user", () => {
    assert.equal(call("task-add", ctxA, {}).ok, false);
    call("task-add", ctxA, { content: "Write report" });
    assert.equal(call("task-list", ctxA, {}).result.count, 1);
    assert.equal(call("task-list", ctxB, {}).result.count, 0);
  });

  it("complete a non-recurring task; reopen", () => {
    const t = call("task-add", ctxA, { content: "One-off" }).result.task;
    const c = call("task-complete", ctxA, { id: t.id });
    assert.equal(c.result.task.done, true);
    assert.equal(c.result.spawned, null);
    assert.equal(call("task-list", ctxA, {}).result.count, 0);
    call("task-complete", ctxA, { id: t.id, reopen: true });
    assert.equal(call("task-list", ctxA, {}).result.count, 1);
  });

  it("completing a recurring task spawns the next occurrence", () => {
    const t = call("task-add", ctxA, { content: "Standup", recurring: "daily", dueDate: today() }).result.task;
    const c = call("task-complete", ctxA, { id: t.id });
    assert.ok(c.result.spawned);
    assert.equal(c.result.spawned.dueDate, dayOffset(1));
    assert.equal(call("task-list", ctxA, {}).result.count, 1); // the spawned one
  });
});

describe("productivity.subtasks", () => {
  it("add + toggle subtasks", () => {
    const t = call("task-add", ctxA, { content: "Parent" }).result.task;
    const sub = call("subtask-add", ctxA, { taskId: t.id, content: "Step 1" }).result.subtask;
    call("subtask-toggle", ctxA, { taskId: t.id, id: sub.id });
    assert.equal(call("task-detail", ctxA, { id: t.id }).result.task.subtasks[0].done, true);
  });
});

describe("productivity.projects + labels", () => {
  it("project task counts; deleting unassigns tasks", () => {
    const p = call("project-create", ctxA, { name: "Work" }).result.project;
    call("task-add", ctxA, { content: "Task", projectId: p.id });
    assert.equal(call("project-list", ctxA, {}).result.projects[0].taskCount, 1);
    assert.equal(call("project-detail", ctxA, { id: p.id }).result.tasks.length, 1);
    call("project-delete", ctxA, { id: p.id });
    assert.equal(call("task-list", ctxA, {}).result.tasks[0].projectId, null);
  });

  it("labels count tagged tasks", () => {
    call("label-create", ctxA, { name: "urgent" });
    call("task-add", ctxA, { content: "Tagged", labels: ["urgent"] });
    assert.equal(call("label-list", ctxA, {}).result.labels[0].taskCount, 1);
  });
});

describe("productivity.smart views", () => {
  it("today-view splits overdue and due-today", () => {
    call("task-add", ctxA, { content: "Late", dueDate: dayOffset(-2) });
    call("task-add", ctxA, { content: "Now", dueDate: today() });
    call("task-add", ctxA, { content: "Later", dueDate: dayOffset(5) });
    const tv = call("today-view", ctxA, {});
    assert.equal(tv.result.tasks.length, 2);
    assert.equal(tv.result.overdue, 1);
    assert.equal(tv.result.dueToday, 1);
  });

  it("eisenhower-matrix routes by urgency and importance", () => {
    call("task-add", ctxA, { content: "Crisis", priority: 1, dueDate: today() });
    call("task-add", ctxA, { content: "Plan", priority: 2, dueDate: dayOffset(20) });
    call("task-add", ctxA, { content: "Noise", priority: 4, dueDate: dayOffset(30) });
    const m = call("eisenhower-matrix", ctxA, {}).result.quadrants;
    assert.equal(m.do_first.length, 1);
    assert.equal(m.schedule.length, 1);
    assert.equal(m.eliminate.length, 1);
  });
});

describe("productivity.habits", () => {
  it("checkin builds a streak", () => {
    const h = call("habit-create", ctxA, { name: "Read" }).result.habit;
    call("habit-checkin", ctxA, { id: h.id, date: dayOffset(-1) });
    const r = call("habit-checkin", ctxA, { id: h.id, date: today() });
    assert.equal(r.result.streak, 2);
    assert.equal(r.result.doneToday, true);
    assert.equal(call("habit-list", ctxA, {}).result.habits[0].streak, 2);
  });
});

describe("productivity.focus + karma", () => {
  it("focus sessions accumulate", () => {
    call("focus-log", ctxA, { durationMin: 25 });
    call("focus-log", ctxA, { durationMin: 50 });
    const fs = call("focus-stats", ctxA, {});
    assert.equal(fs.result.totalSessions, 2);
    assert.equal(fs.result.totalMinutes, 75);
  });

  it("karma rewards completions by priority", () => {
    const t1 = call("task-add", ctxA, { content: "P1", priority: 1 }).result.task;
    const t2 = call("task-add", ctxA, { content: "P4", priority: 4 }).result.task;
    call("task-complete", ctxA, { id: t1.id });
    call("task-complete", ctxA, { id: t2.id });
    const k = call("karma", ctxA, {});
    assert.equal(k.result.karma, 12); // 8 + 4
    assert.equal(k.result.completions, 2);
  });
});

describe("productivity.dashboard + stats", () => {
  it("stats track completions and streak", () => {
    const t = call("task-add", ctxA, { content: "Done today" }).result.task;
    call("task-complete", ctxA, { id: t.id });
    const st = call("productivity-stats", ctxA, {});
    assert.equal(st.result.completedToday, 1);
    assert.equal(st.result.streak, 1);
  });

  it("dashboard aggregates", () => {
    call("task-add", ctxA, { content: "Due", dueDate: today() });
    call("project-create", ctxA, { name: "P" });
    call("focus-log", ctxA, { durationMin: 25 });
    const d = call("productivity-dashboard", ctxA, {});
    assert.equal(d.result.activeTasks, 1);
    assert.equal(d.result.dueToday, 1);
    assert.equal(d.result.focusMinutesToday, 25);
  });
});

// ─── Backlog parity tests ────────────────────────────────────────────

describe("productivity natural-language quick add", () => {
  it("task-parse extracts priority, project, label, date, time, recurrence", () => {
    const r = call("task-parse", ctxA, { text: "submit report tomorrow 5pm p1 #work @urgent every weekday" });
    assert.equal(r.ok, true);
    const p = r.result.parsed;
    assert.equal(p.priority, 1);
    assert.equal(p.project, "work");
    assert.ok(p.labels.includes("urgent"));
    assert.equal(p.dueDate, dayOffset(1));
    assert.equal(p.dueTime, "17:00");
    assert.equal(p.recurring, "weekday");
    assert.equal(p.content, "submit report");
  });

  it("task-parse rejects empty text", () => {
    assert.equal(call("task-parse", ctxA, { text: "  " }).ok, false);
  });

  it("task-quick-add creates a real persisted task and resolves the project", () => {
    const r = call("task-quick-add", ctxA, { text: "call dentist today p2 #health" });
    assert.equal(r.ok, true);
    assert.equal(r.result.task.priority, 2);
    assert.equal(r.result.task.dueDate, today());
    assert.ok(r.result.task.projectId);
    const proj = call("project-list", ctxA, {}).result.projects.find((p) => p.name === "health");
    assert.ok(proj, "project auto-created from #tag");
    assert.equal(r.result.task.projectId, proj.id);
  });
});

describe("productivity recurring tasks", () => {
  it("every N days recurrence parses and advances", () => {
    const t = call("task-add", ctxA, { content: "Water plants", recurring: "every 3 days", dueDate: today() }).result.task;
    assert.equal(t.recurring, "every_3_days");
    const c = call("task-complete", ctxA, { id: t.id });
    assert.ok(c.result.spawned);
    assert.equal(c.result.spawned.dueDate, dayOffset(3));
  });

  it("monthly recurrence spawns next month occurrence", () => {
    const t = call("task-add", ctxA, { content: "Pay rent", recurring: "monthly", dueDate: today() }).result.task;
    const c = call("task-complete", ctxA, { id: t.id });
    assert.ok(c.result.spawned);
    assert.equal(c.result.spawned.recurring, "monthly");
  });
});

describe("productivity reminders + notifications", () => {
  it("reminder-add validates ISO date-time and links a task", () => {
    const t = call("task-add", ctxA, { content: "Demo" }).result.task;
    assert.equal(call("reminder-add", ctxA, { taskId: t.id, remindAt: "not-a-date" }).ok, false);
    const r = call("reminder-add", ctxA, { taskId: t.id, remindAt: dayOffset(-1) + "T09:00", note: "ring me" });
    assert.equal(r.ok, true);
    assert.equal(r.result.reminder.taskId, t.id);
    assert.equal(call("reminder-list", ctxA, {}).result.count, 1);
  });

  it("reminders-due surfaces past-due time reminders and marks them fired", () => {
    const t = call("task-add", ctxA, { content: "Ping" }).result.task;
    call("reminder-add", ctxA, { taskId: t.id, remindAt: dayOffset(-1) + "T09:00" });
    call("reminder-add", ctxA, { taskId: t.id, remindAt: dayOffset(5) + "T09:00" });
    const due = call("reminders-due", ctxA, { markFired: true });
    assert.equal(due.result.count, 1);
    assert.equal(call("reminders-due", ctxA, {}).result.count, 0);
  });

  it("reminder-delete removes a reminder", () => {
    const t = call("task-add", ctxA, { content: "Z" }).result.task;
    const r = call("reminder-add", ctxA, { taskId: t.id, remindAt: dayOffset(2) }).result.reminder;
    assert.equal(call("reminder-delete", ctxA, { id: r.id }).result.deleted, r.id);
    assert.equal(call("reminder-list", ctxA, {}).result.count, 0);
  });
});

describe("productivity saved smart filters", () => {
  it("filter-save + filter-run query tasks by priority and due", () => {
    call("task-add", ctxA, { content: "Hot", priority: 1, dueDate: dayOffset(-1) });
    call("task-add", ctxA, { content: "Cold", priority: 4, dueDate: dayOffset(20) });
    const f = call("filter-save", ctxA, { name: "Overdue P1", query: { priority: 1, due: "overdue" } }).result.filter;
    const run = call("filter-run", ctxA, { id: f.id });
    assert.equal(run.result.count, 1);
    assert.equal(run.result.tasks[0].content, "Hot");
  });

  it("filter-list reports match counts; filter-delete removes", () => {
    call("task-add", ctxA, { content: "Searchable widget" });
    const f = call("filter-save", ctxA, { name: "Widgets", query: { search: "widget" } }).result.filter;
    assert.equal(call("filter-list", ctxA, {}).result.filters[0].matchCount, 1);
    assert.equal(call("filter-delete", ctxA, { id: f.id }).result.deleted, f.id);
    assert.equal(call("filter-list", ctxA, {}).result.count, 0);
  });

  it("filter-run accepts an ad-hoc query without saving", () => {
    call("task-add", ctxA, { content: "Adhoc", priority: 2 });
    const run = call("filter-run", ctxA, { query: { priority: 2 } });
    assert.equal(run.result.count, 1);
  });
});

describe("productivity calendar sync + view", () => {
  it("calendar-view builds a month grid keyed to scheduled tasks", () => {
    call("task-add", ctxA, { content: "Meeting", dueDate: today() });
    const cv = call("calendar-view", ctxA, { month: today() });
    assert.equal(cv.result.days.length, cv.result.daysInMonth);
    const todayCell = cv.result.days.find((d) => d.date === today());
    assert.ok(todayCell && todayCell.tasks.length === 1);
  });

  it("calendar-export-ics emits a valid VCALENDAR with one VEVENT per dated task", () => {
    call("task-add", ctxA, { content: "Exportable", dueDate: dayOffset(3) });
    const ex = call("calendar-export-ics", ctxA, {});
    assert.equal(ex.result.eventCount, 1);
    assert.ok(ex.result.ics.includes("BEGIN:VCALENDAR"));
    assert.ok(ex.result.ics.includes("BEGIN:VEVENT"));
  });

  it("calendar-import-ics parses ICS text into tasks and dedupes by uid", async () => {
    const ics = [
      "BEGIN:VCALENDAR", "VERSION:2.0",
      "BEGIN:VEVENT", "UID:evt-1@x", "DTSTART:20300115T140000", "SUMMARY:Imported call", "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    const r1 = await call("calendar-import-ics", ctxA, { ics });
    assert.equal(r1.result.importedCount, 1);
    assert.equal(r1.result.imported[0].dueDate, "2030-01-15");
    const r2 = await call("calendar-import-ics", ctxA, { ics });
    assert.equal(r2.result.importedCount, 0, "uid dedupe");
  });
});

describe("productivity task collaboration", () => {
  it("project-share + project-collaborators + project-unshare", () => {
    const p = call("project-create", ctxA, { name: "Shared" }).result.project;
    assert.equal(call("project-share", ctxA, { projectId: p.id, collaboratorId: "user_a" }).ok, false);
    const sh = call("project-share", ctxA, { projectId: p.id, collaboratorId: "user_b", role: "viewer" });
    assert.equal(sh.result.share.role, "viewer");
    assert.equal(call("project-collaborators", ctxA, { projectId: p.id }).result.count, 1);
    call("project-unshare", ctxA, { projectId: p.id, collaboratorId: "user_b" });
    assert.equal(call("project-collaborators", ctxA, { projectId: p.id }).result.count, 0);
  });

  it("task-assign + task-comment-add + task-comments", () => {
    const t = call("task-add", ctxA, { content: "Collab task" }).result.task;
    assert.equal(call("task-assign", ctxA, { taskId: t.id, assigneeId: "user_b" }).result.task.assigneeId, "user_b");
    call("task-comment-add", ctxA, { taskId: t.id, body: "Looks good" });
    const cm = call("task-comments", ctxA, { taskId: t.id });
    assert.equal(cm.result.count, 1);
    assert.equal(cm.result.comments[0].body, "Looks good");
  });
});

describe("productivity subtask hierarchy parity", () => {
  it("subtask-add carries its own priority and due date", () => {
    const t = call("task-add", ctxA, { content: "Epic" }).result.task;
    const sub = call("subtask-add", ctxA, { taskId: t.id, content: "Phase 1", priority: 2, dueDate: dayOffset(4) }).result.subtask;
    assert.equal(sub.priority, 2);
    assert.equal(sub.dueDate, dayOffset(4));
  });

  it("subtask-update edits content, priority, due date and done state", () => {
    const t = call("task-add", ctxA, { content: "Epic2" }).result.task;
    const sub = call("subtask-add", ctxA, { taskId: t.id, content: "Phase A" }).result.subtask;
    const up = call("subtask-update", ctxA, { taskId: t.id, id: sub.id, content: "Phase A revised", priority: 1, dueDate: dayOffset(2), done: true });
    assert.equal(up.result.subtask.content, "Phase A revised");
    assert.equal(up.result.subtask.priority, 1);
    assert.equal(up.result.subtask.dueDate, dayOffset(2));
    assert.equal(up.result.subtask.done, true);
  });
});
