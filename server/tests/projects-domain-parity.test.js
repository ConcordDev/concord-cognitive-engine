// Contract tests for the projects Linear + Asana + Jira 2026-parity
// project management lens (projects, issue board, sprints + burndown,
// milestones, members, comments).

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerProjectsActions from "../domains/projects.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`projects.${name}`);
  assert.ok(fn, `projects.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerProjectsActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

function newProject(ctx = ctxA) {
  const r = call("project-create", ctx, { name: "Apollo", key: "APO" });
  assert.equal(r.ok, true);
  return r.result.project.id;
}

describe("projects.project-*", () => {
  it("creates, lists with task rollups, updates and deletes with cascade", () => {
    const pid = newProject();
    call("task-create", ctxA, { projectId: pid, title: "First" });
    const list = call("project-list", ctxA, {});
    assert.equal(list.result.projects[0].taskCount, 1);
    call("project-update", ctxA, { id: pid, name: "Apollo 2" });
    assert.equal(call("project-get", ctxA, { id: pid }).result.project.name, "Apollo 2");
    call("project-delete", ctxA, { id: pid });
    assert.equal(call("project-list", ctxA, {}).result.count, 0);
    assert.equal(call("task-list", ctxA, { projectId: pid }).result.count, 0);
  });

  it("isolates projects per user", () => {
    newProject(ctxA);
    assert.equal(call("project-list", ctxB, {}).result.count, 0);
  });
});

describe("projects tasks & board", () => {
  it("creates tasks with sequential refs and a status workflow", () => {
    const pid = newProject();
    const t1 = call("task-create", ctxA, { projectId: pid, title: "Build" }).result.task;
    const t2 = call("task-create", ctxA, { projectId: pid, title: "Test" }).result.task;
    assert.equal(t1.ref, "APO-1");
    assert.equal(t2.ref, "APO-2");
    call("task-move-status", ctxA, { id: t1.id, status: "done" });
    const board = call("board", ctxA, { projectId: pid });
    const doneCol = board.result.columns.find((c) => c.status === "done");
    assert.equal(doneCol.tasks.length, 1);
    assert.ok(doneCol.tasks[0].completedAt);
  });

  it("filters tasks by status and updates fields", () => {
    const pid = newProject();
    const t = call("task-create", ctxA, { projectId: pid, title: "X", priority: "low" }).result.task;
    call("task-update", ctxA, { id: t.id, priority: "urgent", points: 5, labels: ["bug", "bug"] });
    const got = call("task-list", ctxA, { projectId: pid }).result.tasks[0];
    assert.equal(got.priority, "urgent");
    assert.equal(got.points, 5);
    assert.deepEqual(got.labels, ["bug"]);
  });

  it("threads comments on a task", () => {
    const pid = newProject();
    const t = call("task-create", ctxA, { projectId: pid, title: "Discuss" }).result.task;
    call("task-comment-add", ctxA, { taskId: t.id, body: "Looks good", author: "Sam" });
    const cs = call("task-comments", ctxA, { taskId: t.id });
    assert.equal(cs.result.count, 1);
    assert.equal(cs.result.comments[0].author, "Sam");
  });

  it("rejects an empty task title", () => {
    const pid = newProject();
    assert.equal(call("task-create", ctxA, { projectId: pid, title: "" }).ok, false);
  });
});

describe("projects sprints & burndown", () => {
  it("creates a sprint, assigns tasks and computes burndown", () => {
    const pid = newProject();
    const sprint = call("sprint-create", ctxA, {
      projectId: pid, name: "Cycle 1", startDate: "2026-05-01", endDate: "2026-05-11",
    }).result.sprint;
    const t1 = call("task-create", ctxA, { projectId: pid, title: "A", sprintId: sprint.id, points: 3 }).result.task;
    call("task-create", ctxA, { projectId: pid, title: "B", sprintId: sprint.id, points: 5 });
    call("task-move-status", ctxA, { id: t1.id, status: "done" });
    const bd = call("sprint-burndown", ctxA, { id: sprint.id });
    assert.equal(bd.result.totalPoints, 8);
    assert.equal(bd.result.donePoints, 3);
    assert.ok(bd.result.series.length > 1);
    assert.equal(bd.result.series[0].remaining, 8);
  });

  it("sprint-complete carries unfinished tasks back to the backlog", () => {
    const pid = newProject();
    const sprint = call("sprint-create", ctxA, { projectId: pid, name: "C" }).result.sprint;
    const t = call("task-create", ctxA, { projectId: pid, title: "Unfinished", sprintId: sprint.id }).result.task;
    const r = call("sprint-complete", ctxA, { id: sprint.id });
    assert.equal(r.result.carriedOver, 1);
    const got = call("task-list", ctxA, { projectId: pid }).result.tasks.find((x) => x.id === t.id);
    assert.equal(got.sprintId, null);
  });
});

describe("projects members & milestones", () => {
  it("adds members and assigns tasks to them", () => {
    const pid = newProject();
    const m = call("member-add", ctxA, { projectId: pid, name: "Dev One", role: "engineer" }).result.member;
    call("task-create", ctxA, { projectId: pid, title: "Assigned", assigneeId: m.id });
    const members = call("member-list", ctxA, { projectId: pid });
    assert.equal(members.result.members[0].assigned, 1);
  });

  it("tracks milestone progress", () => {
    const pid = newProject();
    const mil = call("milestone-create", ctxA, { projectId: pid, name: "v1.0" }).result.milestone;
    const t1 = call("task-create", ctxA, { projectId: pid, title: "A", milestoneId: mil.id }).result.task;
    call("task-create", ctxA, { projectId: pid, title: "B", milestoneId: mil.id });
    call("task-move-status", ctxA, { id: t1.id, status: "done" });
    const list = call("milestone-list", ctxA, { projectId: pid });
    assert.equal(list.result.milestones[0].progressPct, 50);
  });
});

describe("projects.project-dashboard", () => {
  it("rolls up status, priority and completion", () => {
    const pid = newProject();
    const t1 = call("task-create", ctxA, { projectId: pid, title: "A", priority: "high" }).result.task;
    call("task-create", ctxA, { projectId: pid, title: "B" });
    call("task-move-status", ctxA, { id: t1.id, status: "done" });
    const d = call("project-dashboard", ctxA, { projectId: pid });
    assert.equal(d.result.totalTasks, 2);
    assert.equal(d.result.done, 1);
    assert.equal(d.result.completionPct, 50);
    assert.equal(d.result.byPriority.high, 1);
  });
});

describe("projects — project depth & portfolio", () => {
  it("carries status, health, dates and archive", () => {
    const pid = newProject();
    call("project-update", ctxA, { id: pid, status: "started", health: "at_risk", targetDate: "2026-09-01" });
    const p = call("project-get", ctxA, { id: pid }).result.project;
    assert.equal(p.status, "started");
    assert.equal(p.health, "at_risk");
    assert.equal(p.targetDate, "2026-09-01");
    call("project-archive", ctxA, { id: pid, archived: true });
    assert.equal(call("project-list", ctxA, {}).result.count, 0);
    assert.equal(call("project-list", ctxA, { includeArchived: true }).result.count, 1);
  });

  it("portfolio rolls up health and progress", () => {
    const pid = newProject();
    const t = call("task-create", ctxA, { projectId: pid, title: "A" }).result.task;
    call("task-move-status", ctxA, { id: t.id, status: "done" });
    const port = call("portfolio", ctxA, {});
    assert.equal(port.result.active, 1);
    assert.equal(port.result.projects[0].progressPct, 100);
    assert.equal(port.result.byHealth.on_track, 1);
  });
});

describe("projects — sub-issues, relations, detail", () => {
  it("creates subtasks and rolls up progress in task-detail", () => {
    const pid = newProject();
    const epic = call("task-create", ctxA, { projectId: pid, title: "Epic", type: "epic" }).result.task;
    const c1 = call("task-create", ctxA, { projectId: pid, title: "Child 1", parentId: epic.id }).result.task;
    call("task-create", ctxA, { projectId: pid, title: "Child 2", parentId: epic.id });
    call("task-move-status", ctxA, { id: c1.id, status: "done" });
    const detail = call("task-detail", ctxA, { id: epic.id });
    assert.equal(detail.result.subtasks.length, 2);
    assert.equal(detail.result.subtaskProgress, 50);
  });

  it("links blocks/relates dependencies and surfaces direction", () => {
    const pid = newProject();
    const a = call("task-create", ctxA, { projectId: pid, title: "A" }).result.task;
    const b = call("task-create", ctxA, { projectId: pid, title: "B" }).result.task;
    call("relation-add", ctxA, { fromTaskId: a.id, toTaskId: b.id, kind: "blocks" });
    assert.equal(call("relation-list", ctxA, { taskId: a.id }).result.count, 1);
    const bd = call("task-detail", ctxA, { id: b.id });
    assert.equal(bd.result.relations[0].kind, "blocked_by");
  });

  it("rejects a self relation and a duplicate", () => {
    const pid = newProject();
    const a = call("task-create", ctxA, { projectId: pid, title: "A" }).result.task;
    const b = call("task-create", ctxA, { projectId: pid, title: "B" }).result.task;
    assert.equal(call("relation-add", ctxA, { fromTaskId: a.id, toTaskId: a.id, kind: "blocks" }).ok, false);
    call("relation-add", ctxA, { fromTaskId: a.id, toTaskId: b.id, kind: "blocks" });
    assert.equal(call("relation-add", ctxA, { fromTaskId: a.id, toTaskId: b.id, kind: "blocks" }).ok, false);
  });
});

describe("projects — labels & custom fields", () => {
  it("manages first-class labels", () => {
    const pid = newProject();
    const l = call("label-create", ctxA, { projectId: pid, name: "bug", color: "red" }).result.label;
    call("label-update", ctxA, { id: l.id, color: "rose" });
    assert.equal(call("label-list", ctxA, { projectId: pid }).result.labels[0].color, "rose");
    call("label-delete", ctxA, { id: l.id });
    assert.equal(call("label-list", ctxA, { projectId: pid }).result.count, 0);
  });

  it("defines custom fields and sets values on tasks", () => {
    const pid = newProject();
    const f = call("custom-field-create", ctxA, { projectId: pid, name: "Component", type: "select", options: ["api", "ui"] }).result.field;
    const t = call("task-create", ctxA, { projectId: pid, title: "X" }).result.task;
    call("task-set-field", ctxA, { taskId: t.id, fieldId: f.id, value: "api" });
    const got = call("task-detail", ctxA, { id: t.id }).result.task;
    assert.equal(got.customFields[f.id], "api");
  });
});

describe("projects — comments, attachments, activity", () => {
  it("threads comments and parses @mentions", () => {
    const pid = newProject();
    const t = call("task-create", ctxA, { projectId: pid, title: "X" }).result.task;
    const root = call("task-comment-add", ctxA, { taskId: t.id, body: "ping @alice please" }).result.comment;
    assert.deepEqual(root.mentions, ["alice"]);
    const reply = call("task-comment-add", ctxA, { taskId: t.id, body: "done", parentCommentId: root.id }).result.comment;
    assert.equal(reply.parentCommentId, root.id);
  });

  it("attaches links and records activity", () => {
    const pid = newProject();
    const t = call("task-create", ctxA, { projectId: pid, title: "X" }).result.task;
    call("attachment-add", ctxA, { taskId: t.id, url: "https://example.com/spec.pdf", name: "Spec" });
    assert.equal(call("attachment-list", ctxA, { taskId: t.id }).result.count, 1);
    call("task-move-status", ctxA, { id: t.id, status: "in_progress" });
    const act = call("activity-list", ctxA, { taskId: t.id });
    assert.ok(act.result.activity.some((a) => a.action === "status"));
    assert.equal(call("attachment-add", ctxA, { taskId: t.id, url: "ftp://x" }).ok, false);
  });
});

describe("projects — saved views & filters", () => {
  it("saves a view and runs it with filters + sort", () => {
    const pid = newProject();
    call("task-create", ctxA, { projectId: pid, title: "Low", priority: "low" });
    const hi = call("task-create", ctxA, { projectId: pid, title: "Hi", priority: "urgent" }).result.task;
    const v = call("view-create", ctxA, { projectId: pid, name: "Urgent", filters: { priority: "urgent" } }).result.view;
    const run = call("view-run", ctxA, { id: v.id });
    assert.equal(run.result.count, 1);
    assert.equal(run.result.tasks[0].id, hi.id);
  });

  it("task-list supports query and priority sort", () => {
    const pid = newProject();
    call("task-create", ctxA, { projectId: pid, title: "alpha", priority: "low" });
    call("task-create", ctxA, { projectId: pid, title: "beta", priority: "urgent" });
    assert.equal(call("task-list", ctxA, { projectId: pid, query: "alpha" }).result.count, 1);
    const sorted = call("task-list", ctxA, { projectId: pid, sort: "priority" }).result.tasks;
    assert.equal(sorted[0].priority, "urgent");
  });
});

describe("projects — automation rules", () => {
  it("fires a rule on status change", () => {
    const pid = newProject();
    call("rule-create", ctxA, {
      projectId: pid, name: "Urgent on review", trigger: "status_changed",
      action: "set_priority", actionValue: "urgent",
      condition: { field: "status", equals: "in_review" },
    });
    const t = call("task-create", ctxA, { projectId: pid, title: "X" }).result.task;
    call("task-move-status", ctxA, { id: t.id, status: "in_review" });
    assert.equal(call("task-detail", ctxA, { id: t.id }).result.task.priority, "urgent");
  });

  it("a disabled rule does not fire", () => {
    const pid = newProject();
    const r = call("rule-create", ctxA, {
      projectId: pid, name: "R", trigger: "task_created", action: "set_priority", actionValue: "high",
    }).result.rule;
    call("rule-toggle", ctxA, { id: r.id, enabled: false });
    const t = call("task-create", ctxA, { projectId: pid, title: "X" }).result.task;
    assert.equal(t.priority, "none");
  });
});

describe("projects — templates & bulk ops", () => {
  it("applies a template to seed a task tree", () => {
    const pid = newProject();
    const tpl = call("template-create", ctxA, {
      projectId: pid, name: "Feature", taskDefaults: { title: "New feature", points: 5 },
      subtasks: ["Design", "Build", "Test"],
    }).result.template;
    const applied = call("template-apply", ctxA, { id: tpl.id });
    assert.equal(applied.result.subtasks.length, 3);
    assert.equal(applied.result.task.points, 5);
  });

  it("bulk-updates and bulk-deletes tasks", () => {
    const pid = newProject();
    const a = call("task-create", ctxA, { projectId: pid, title: "A" }).result.task;
    const b = call("task-create", ctxA, { projectId: pid, title: "B" }).result.task;
    call("task-bulk-update", ctxA, { ids: [a.id, b.id], patch: { priority: "high" } });
    assert.equal(call("task-list", ctxA, { projectId: pid }).result.tasks.every((t) => t.priority === "high"), true);
    call("task-bulk-delete", ctxA, { ids: [a.id, b.id] });
    assert.equal(call("task-list", ctxA, { projectId: pid }).result.count, 0);
  });
});

describe("projects — board swimlanes & WIP", () => {
  it("groups the board into swimlanes", () => {
    const pid = newProject();
    const m = call("member-add", ctxA, { projectId: pid, name: "Dev" }).result.member;
    call("task-create", ctxA, { projectId: pid, title: "A", assigneeId: m.id });
    call("task-create", ctxA, { projectId: pid, title: "B" });
    const sl = call("board-swimlanes", ctxA, { projectId: pid, groupBy: "assignee" });
    assert.equal(sl.result.swimlanes.length, 2);
  });

  it("sets WIP limits", () => {
    const pid = newProject();
    call("wip-set", ctxA, { projectId: pid, status: "in_progress", limit: 3 });
    assert.equal(call("wip-list", ctxA, { projectId: pid }).result.limits[0].limit, 3);
  });
});

describe("projects — reporting", () => {
  it("reports velocity across completed sprints", () => {
    const pid = newProject();
    const sp = call("sprint-create", ctxA, { projectId: pid, name: "S1", startDate: "2026-05-01", endDate: "2026-05-14" }).result.sprint;
    const t = call("task-create", ctxA, { projectId: pid, title: "A", sprintId: sp.id, points: 8 }).result.task;
    call("task-move-status", ctxA, { id: t.id, status: "done" });
    call("sprint-complete", ctxA, { id: sp.id, carryOver: false });
    const v = call("report-velocity", ctxA, { projectId: pid });
    assert.equal(v.result.avgVelocity, 8);
  });

  it("reports cumulative flow and forecast", () => {
    const pid = newProject();
    call("task-create", ctxA, { projectId: pid, title: "A", points: 10 });
    const flow = call("report-flow", ctxA, { projectId: pid, days: 14 });
    assert.equal(flow.result.series.length, 14);
    const fc = call("report-forecast", ctxA, { projectId: pid });
    assert.equal(fc.result.remainingPoints, 10);
  });

  it("reports cycle time for completed tasks", () => {
    const pid = newProject();
    const t = call("task-create", ctxA, { projectId: pid, title: "A" }).result.task;
    call("task-move-status", ctxA, { id: t.id, status: "in_progress" });
    call("task-move-status", ctxA, { id: t.id, status: "done" });
    const ct = call("report-cycle-time", ctxA, { projectId: pid });
    assert.equal(ct.result.completedTasks, 1);
  });
});

describe("projects — risk register, goals, timeline", () => {
  it("scores risks by likelihood × impact", () => {
    const pid = newProject();
    call("risk-add", ctxA, { projectId: pid, name: "Vendor delay", likelihood: 4, impact: 5 });
    const list = call("risk-list", ctxA, { projectId: pid });
    assert.equal(list.result.risks[0].score, 20);
    assert.equal(list.result.risks[0].severity, "critical");
  });

  it("tracks goal progress", () => {
    const pid = newProject();
    const g = call("goal-create", ctxA, { projectId: pid, name: "Ship v1", target: 100, current: 25 }).result.goal;
    call("goal-update-progress", ctxA, { id: g.id, current: 60 });
    assert.equal(call("goal-list", ctxA, { projectId: pid }).result.goals[0].progressPct, 60);
  });

  it("builds a timeline from task dates", () => {
    const pid = newProject();
    call("task-create", ctxA, { projectId: pid, title: "Scheduled", startDate: "2026-06-01", dueDate: "2026-06-10" });
    const tl = call("timeline", ctxA, { projectId: pid });
    assert.equal(tl.result.tasks.length, 1);
    assert.equal(tl.result.tasks[0].start, "2026-06-01");
  });
});

// ════════════════════════════════════════════════════════════════════
//  2026 PARITY BACKLOG — Linear / Asana feature gaps
// ════════════════════════════════════════════════════════════════════

describe("projects — real-time multiplayer sync", () => {
  it("presence-ping records a collaborator and presence-list returns them", () => {
    const pid = newProject();
    const ping = call("presence-ping", ctxA, { projectId: pid, collaborator: "Ada", cursorX: 40, cursorY: 60, viewing: "board" });
    assert.equal(ping.ok, true);
    assert.equal(ping.result.collaborator, "Ada");
    const list = call("presence-list", ctxA, { projectId: pid });
    assert.equal(list.result.count, 1);
    assert.equal(list.result.collaborators[0].collaborator, "Ada");
    assert.equal(list.result.collaborators[0].cursorX, 40);
  });

  it("presence-ping rejects an unknown project", () => {
    assert.equal(call("presence-ping", ctxA, { projectId: "nope" }).ok, false);
  });

  it("sync-since returns only tasks updated after a timestamp", () => {
    const pid = newProject();
    const t = call("task-create", ctxA, { projectId: pid, title: "Synced" }).result.task;
    const all = call("sync-since", ctxA, { projectId: pid });
    assert.equal(all.result.count, 1);
    // A timestamp in the future excludes everything.
    const future = new Date(Date.now() + 60_000).toISOString();
    assert.equal(call("sync-since", ctxA, { projectId: pid, since: future }).result.count, 0);
    // Backdate the task's updatedAt, then a since before that returns it.
    const state = globalThis._concordSTATE.projectsLens.tasks.get("user_a");
    state.find((x) => x.id === t.id).updatedAt = "2026-05-21T00:00:00.000Z";
    assert.equal(call("sync-since", ctxA, { projectId: pid, since: "2026-05-20T00:00:00.000Z" }).result.count, 1);
    assert.equal(call("sync-since", ctxA, { projectId: pid, since: "2026-05-22T00:00:00.000Z" }).result.count, 0);
  });
});

describe("projects — binary file attachments", () => {
  it("uploads a base64 binary file and downloads it back", () => {
    const pid = newProject();
    const t = call("task-create", ctxA, { projectId: pid, title: "Has file" }).result.task;
    const payload = Buffer.from("hello concord").toString("base64");
    const up = call("attachment-upload", ctxA, {
      taskId: t.id, fileName: "notes.txt", mimeType: "text/plain", data: payload,
    });
    assert.equal(up.ok, true);
    assert.equal(up.result.attachment.kind, "binary");
    assert.equal(up.result.attachment.fileName, "notes.txt");
    assert.ok(up.result.attachment.bytes > 0);
    assert.equal(up.result.attachment.data, undefined);
    const dl = call("attachment-download", ctxA, { id: up.result.attachment.id });
    assert.equal(dl.ok, true);
    assert.equal(Buffer.from(dl.result.data, "base64").toString(), "hello concord");
  });

  it("rejects a non-base64 payload and a download of a non-binary attachment", () => {
    const pid = newProject();
    const t = call("task-create", ctxA, { projectId: pid, title: "X" }).result.task;
    assert.equal(call("attachment-upload", ctxA, { taskId: t.id, fileName: "f", data: "@@@" }).ok, false);
    const link = call("attachment-add", ctxA, { taskId: t.id, url: "https://example.com/x" }).result.attachment;
    assert.equal(call("attachment-download", ctxA, { id: link.id }).ok, false);
  });
});

describe("projects — GitHub / Slack / CI integrations", () => {
  it("connects an integration and links an artifact to a task", () => {
    const pid = newProject();
    const itg = call("integration-connect", ctxA, { projectId: pid, kind: "github", target: "acme/app" }).result.integration;
    assert.equal(itg.kind, "github");
    const t = call("task-create", ctxA, { projectId: pid, title: "PR work" }).result.task;
    const linked = call("integration-link", ctxA, {
      taskId: t.id, integrationId: itg.id, url: "https://github.com/acme/app/pull/7", label: "PR #7",
    });
    assert.equal(linked.ok, true);
    assert.equal(call("integration-list", ctxA, { projectId: pid }).result.integrations[0].linkCount, 1);
  });

  it("a passing CI link auto-advances an in-review task to done", () => {
    const pid = newProject();
    const itg = call("integration-connect", ctxA, { projectId: pid, kind: "ci", target: "build" }).result.integration;
    const t = call("task-create", ctxA, { projectId: pid, title: "Ship", status: "in_review" }).result.task;
    const linked = call("integration-link", ctxA, {
      taskId: t.id, integrationId: itg.id, url: "https://ci.example.com/run/1", ciStatus: "passed",
    });
    assert.equal(linked.result.autoAdvanced, true);
    assert.equal(call("task-detail", ctxA, { id: t.id }).result.task.status, "done");
  });

  it("toggles and deletes an integration", () => {
    const pid = newProject();
    const itg = call("integration-connect", ctxA, { projectId: pid, kind: "slack", target: "#dev" }).result.integration;
    call("integration-toggle", ctxA, { id: itg.id, enabled: false });
    assert.equal(call("integration-list", ctxA, { projectId: pid }).result.integrations[0].enabled, false);
    call("integration-delete", ctxA, { id: itg.id });
    assert.equal(call("integration-list", ctxA, { projectId: pid }).result.count, 0);
  });
});

describe("projects — notification inbox", () => {
  it("collects notifications and marks them read", () => {
    const pid = newProject();
    call("triage-submit", ctxA, { projectId: pid, title: "Crash on save" });
    const inbox = call("notifications-list", ctxA, {});
    assert.ok(inbox.result.count >= 1);
    assert.ok(inbox.result.unread >= 1);
    const first = inbox.result.notifications[0];
    call("notification-mark-read", ctxA, { id: first.id });
    assert.equal(call("notifications-list", ctxA, { unreadOnly: true }).result.notifications.every((n) => n.read), true);
  });

  it("mark-all-read and clear empty the inbox state", () => {
    const pid = newProject();
    call("triage-submit", ctxA, { projectId: pid, title: "Issue A" });
    call("triage-submit", ctxA, { projectId: pid, title: "Issue B" });
    const marked = call("notification-mark-read", ctxA, { all: true });
    assert.ok(marked.result.marked >= 2);
    call("notification-clear", ctxA, {});
    assert.equal(call("notifications-list", ctxA, {}).result.count, 0);
  });
});

describe("projects — keyboard command bar", () => {
  it("command-search resolves projects, tasks and create intents", () => {
    const pid = newProject();
    call("task-create", ctxA, { projectId: pid, title: "Refactor auth" });
    const r = call("command-search", ctxA, { query: "Refactor", projectId: pid });
    assert.ok(r.result.results.some((x) => x.kind === "task" && x.label === "Refactor auth"));
    assert.ok(r.result.commands.some((c) => c.action === "task-create"));
  });

  it("command-search with an empty query lists projects", () => {
    newProject();
    const r = call("command-search", ctxA, { query: "" });
    assert.ok(r.result.results.some((x) => x.kind === "project"));
  });
});

describe("projects — triage / inbox workflow", () => {
  it("submits to triage, queues it and accepts into the backlog", () => {
    const pid = newProject();
    const sub = call("triage-submit", ctxA, { projectId: pid, title: "Login fails", type: "bug" });
    assert.equal(sub.result.task.isTriage, true);
    const queue = call("triage-queue", ctxA, { projectId: pid });
    assert.equal(queue.result.count, 1);
    const accepted = call("triage-accept", ctxA, { id: sub.result.task.id, priority: "high", status: "todo" });
    assert.equal(accepted.result.task.isTriage, false);
    assert.equal(accepted.result.task.priority, "high");
    assert.equal(call("triage-queue", ctxA, { projectId: pid }).result.count, 0);
  });

  it("declines a triaged issue and removes it entirely", () => {
    const pid = newProject();
    const sub = call("triage-submit", ctxA, { projectId: pid, title: "Spam report" });
    const dec = call("triage-decline", ctxA, { id: sub.result.task.id });
    assert.equal(dec.ok, true);
    assert.equal(call("triage-queue", ctxA, { projectId: pid }).result.count, 0);
    assert.equal(call("task-list", ctxA, { projectId: pid }).result.count, 0);
  });
});

describe("projects — SLA / due-date escalation", () => {
  it("sets a policy and escalates a breached task", () => {
    const pid = newProject();
    const policy = call("sla-policy-set", ctxA, {
      projectId: pid, priority: "low", responseDays: 0, escalateTo: "urgent",
    });
    assert.equal(policy.result.policy.responseDays, 0);
    const t = call("task-create", ctxA, { projectId: pid, title: "Stale ticket", priority: "low" }).result.task;
    // Backdate the task so the 0-day SLA has already lapsed.
    const state = globalThis._concordSTATE.projectsLens.tasks.get("user_a");
    state.find((x) => x.id === t.id).createdAt = "2020-01-01T00:00:00.000Z";
    const sweep = call("sla-escalate", ctxA, { projectId: pid });
    assert.equal(sweep.result.breachedCount, 1);
    assert.equal(sweep.result.escalated, 1);
    assert.equal(call("task-detail", ctxA, { id: t.id }).result.task.priority, "urgent");
  });

  it("lists and deletes SLA policies", () => {
    const pid = newProject();
    const policy = call("sla-policy-set", ctxA, { projectId: pid, priority: "high", responseDays: 2 }).result.policy;
    assert.equal(call("sla-policy-list", ctxA, { projectId: pid }).result.count, 1);
    call("sla-policy-delete", ctxA, { id: policy.id });
    assert.equal(call("sla-policy-list", ctxA, { projectId: pid }).result.count, 0);
  });
});
