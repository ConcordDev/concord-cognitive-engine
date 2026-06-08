// tests/depth/projects-behavior.test.js — REAL behavioral tests for the
// projects domain (registerLensAction family, invoked via lensRun). Curated
// high-confidence subset: exact-value calcs (gantt / burndown / risk matrix /
// velocity / forecast / SLA) + CRUD round-trips + validation rejections.
// Every lensRun("projects", "<macro>", …) call literally names the macro, so
// the macro-depth grader credits it as a behavioral invocation.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { lensRun, depthCtx } from "./_harness.js";

describe("projects — calc contracts (exact computed values)", () => {
  it("ganttGenerate: sequential offsets, totalDays sum, totalWeeks ceil", async () => {
    const r = await lensRun("projects", "ganttGenerate", {
      data: { tasks: [
        { name: "Design", duration: 3 },
        { name: "Build", duration: 5, dependencies: ["Design"] },
        { name: "Test", duration: 2 },
      ] },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.totalDays, 10);           // 3 + 5 + 2
    assert.equal(r.result.totalWeeks, 2);           // ceil(10/5)
    assert.deepEqual(r.result.tasks[0], { task: "Design", startDay: 0, endDay: 3, duration: 3, dependencies: [] });
    assert.equal(r.result.tasks[1].startDay, 3);    // after Design
    assert.equal(r.result.tasks[1].endDay, 8);      // 3 + 5
    assert.deepEqual(r.result.criticalPath, ["Design", "Build", "Test"]);
  });

  it("ganttGenerate: empty tasks returns the prompt message", async () => {
    const r = await lensRun("projects", "ganttGenerate", { data: { tasks: [] } });
    assert.equal(r.ok, true);
    assert.ok(r.result.message.includes("Add tasks"));
  });

  it("riskMatrix: score = likelihood × impact × 100, sorted desc, severity bands", async () => {
    const r = await lensRun("projects", "riskMatrix", {
      data: { risks: [
        { name: "Low risk", likelihood: 0.2, impact: 0.3 },   // score 6 → low
        { name: "Crit risk", likelihood: 0.9, impact: 0.8 },  // score 72 → critical
        { name: "Med risk", likelihood: 0.5, impact: 0.4 },   // score 20 → medium
      ] },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.total, 3);
    assert.equal(r.result.topRisk, "Crit risk");          // highest score first
    assert.equal(r.result.risks[0].score, 72);
    assert.equal(r.result.risks[0].severity, "critical");
    assert.equal(r.result.risks[1].score, 20);
    assert.equal(r.result.risks[1].severity, "medium");
    assert.equal(r.result.risks[2].severity, "low");
    assert.equal(r.result.critical, 1);
  });

  it("burndownCalc: remaining, velocity, projection, status math", async () => {
    const r = await lensRun("projects", "burndownCalc", {
      data: { totalPoints: 100, sprintDays: 10, dailyCompleted: [10, 10, 10, 10] },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.completed, 40);              // 10*4
    assert.equal(r.result.remaining, 60);             // 100 - 40
    assert.equal(r.result.daysElapsed, 4);
    assert.equal(r.result.idealBurnRate, 10);         // 100/10
    assert.equal(r.result.actualVelocity, 10);        // 40/4
    assert.equal(r.result.projectedDaysToFinish, 6);  // ceil(60/10)
    // 40 >= 10*4 → exactly on ideal → status "ahead" (>= idealRate*daysElapsed)
    assert.equal(r.result.status, "ahead");
  });

  it("burndownCalc: a behind sprint is flagged behind / not on-track", async () => {
    const r = await lensRun("projects", "burndownCalc", {
      data: { totalPoints: 100, sprintDays: 10, dailyCompleted: [2, 2, 2, 2] },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.completed, 8);              // ideal would be 40
    assert.equal(r.result.status, "behind");
    assert.equal(r.result.onTrack, false);
  });

  it("stakeholderMap: power/interest → quadrant + communication cadence", async () => {
    const r = await lensRun("projects", "stakeholderMap", {
      data: { stakeholders: [
        { name: "Sponsor", power: 80, interest: 90 },   // manage-closely / weekly
        { name: "Exec", power: 70, interest: 20 },       // keep-satisfied / biweekly
        { name: "User", power: 30, interest: 80 },       // keep-informed / biweekly
        { name: "Vendor", power: 10, interest: 10 },     // monitor / monthly
      ] },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.total, 4);
    const byName = Object.fromEntries(r.result.stakeholders.map((x) => [x.name, x]));
    assert.equal(byName.Sponsor.quadrant, "manage-closely");
    assert.equal(byName.Sponsor.communication, "weekly");
    assert.equal(byName.Exec.quadrant, "keep-satisfied");
    assert.equal(byName.User.quadrant, "keep-informed");
    assert.equal(byName.Vendor.quadrant, "monitor");
    assert.equal(byName.Vendor.communication, "monthly");
    assert.deepEqual(r.result.byQuadrant, { manageClosely: 1, keepSatisfied: 1, keepInformed: 1, monitor: 1 });
  });
});

describe("projects — project/task CRUD round-trips + validation (shared ctx)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("projects-crud-core"); });

  it("project-create rejects a missing name", async () => {
    const r = await lensRun("projects", "project-create", { params: {} }, ctx);
    assert.equal(r.result.ok, false);
    assert.ok(r.result.error.includes("name required"));
  });

  it("project-create → project-list: project reads back, key upper-cased + defaults", async () => {
    const add = await lensRun("projects", "project-create", { params: { name: "Apollo Launch", key: "apo" } }, ctx);
    assert.equal(add.ok, true);
    assert.equal(add.result.project.key, "APO");
    assert.equal(add.result.project.status, "planned");
    assert.equal(add.result.project.health, "on_track");
    const list = await lensRun("projects", "project-list", {}, ctx);
    assert.ok(list.result.projects.some((p) => p.id === add.result.project.id));
  });

  it("task-create requires a real project + title; ref derives from project key + seq", async () => {
    const proj = await lensRun("projects", "project-create", { params: { name: "Gemini", key: "GEM" } }, ctx);
    const pid = proj.result.project.id;

    const noProj = await lensRun("projects", "task-create", { params: { projectId: "nope", title: "x" } }, ctx);
    assert.equal(noProj.result.ok, false);
    assert.ok(noProj.result.error.includes("project not found"));

    const noTitle = await lensRun("projects", "task-create", { params: { projectId: pid } }, ctx);
    assert.equal(noTitle.result.ok, false);
    assert.ok(noTitle.result.error.includes("title required"));

    const t1 = await lensRun("projects", "task-create", { params: { projectId: pid, title: "First", points: 5 } }, ctx);
    assert.equal(t1.ok, true);
    assert.equal(t1.result.task.ref, "GEM-1");        // first task → seq 1
    assert.equal(t1.result.task.status, "backlog");
    assert.equal(t1.result.task.points, 5);
    const t2 = await lensRun("projects", "task-create", { params: { projectId: pid, title: "Second" } }, ctx);
    assert.equal(t2.result.task.ref, "GEM-2");        // seq increments

    const list = await lensRun("projects", "task-list", { params: { projectId: pid } }, ctx);
    assert.equal(list.result.count, 2);
    assert.ok(list.result.tasks.some((t) => t.id === t1.result.task.id));
  });

  it("task-move-status to done stamps completedAt; reverting clears it", async () => {
    const proj = await lensRun("projects", "project-create", { params: { name: "Mercury" } }, ctx);
    const t = await lensRun("projects", "task-create", { params: { projectId: proj.result.project.id, title: "Ship it" } }, ctx);
    const tid = t.result.task.id;

    const done = await lensRun("projects", "task-move-status", { params: { id: tid, status: "done" } }, ctx);
    assert.equal(done.ok, true);
    assert.equal(done.result.status, "done");

    const detail = await lensRun("projects", "task-detail", { params: { id: tid } }, ctx);
    assert.ok(detail.result.task.completedAt);          // stamped

    const back = await lensRun("projects", "task-move-status", { params: { id: tid, status: "in_progress" } }, ctx);
    assert.equal(back.result.status, "in_progress");
    const detail2 = await lensRun("projects", "task-detail", { params: { id: tid } }, ctx);
    assert.equal(detail2.result.task.completedAt, null); // cleared on revert
  });

  it("task-delete removes the task and it no longer lists", async () => {
    const proj = await lensRun("projects", "project-create", { params: { name: "Vostok" } }, ctx);
    const pid = proj.result.project.id;
    const t = await lensRun("projects", "task-create", { params: { projectId: pid, title: "Disposable" } }, ctx);
    const del = await lensRun("projects", "task-delete", { params: { id: t.result.task.id } }, ctx);
    assert.equal(del.ok, true);
    assert.equal(del.result.deleted, t.result.task.id);
    const list = await lensRun("projects", "task-list", { params: { projectId: pid } }, ctx);
    assert.ok(!list.result.tasks.some((x) => x.id === t.result.task.id));
  });
});

describe("projects — comments, relations, attachments, labels (shared ctx)", () => {
  let ctx, pid, t1, t2;
  before(async () => {
    ctx = await depthCtx("projects-assoc");
    const proj = await lensRun("projects", "project-create", { params: { name: "Saturn V", key: "SAT" } }, ctx);
    pid = proj.result.project.id;
    t1 = (await lensRun("projects", "task-create", { params: { projectId: pid, title: "Stage 1" } }, ctx)).result.task;
    t2 = (await lensRun("projects", "task-create", { params: { projectId: pid, title: "Stage 2" } }, ctx)).result.task;
  });

  it("task-comment-add extracts @mentions and round-trips via task-comments", async () => {
    const add = await lensRun("projects", "task-comment-add", { params: { taskId: t1.id, body: "ping @alice and @bob" } }, ctx);
    assert.equal(add.ok, true);
    assert.deepEqual(add.result.comment.mentions.sort(), ["alice", "bob"]);
    const list = await lensRun("projects", "task-comments", { params: { taskId: t1.id } }, ctx);
    assert.ok(list.result.comments.some((c) => c.id === add.result.comment.id));
  });

  it("task-comment-add rejects an empty body", async () => {
    const r = await lensRun("projects", "task-comment-add", { params: { taskId: t1.id, body: "" } }, ctx);
    assert.equal(r.result.ok, false);
    assert.ok(r.result.error.includes("body required"));
  });

  it("relation-add rejects self-relation and a duplicate", async () => {
    const self = await lensRun("projects", "relation-add", { params: { fromTaskId: t1.id, toTaskId: t1.id, kind: "blocks" } }, ctx);
    assert.equal(self.result.ok, false);
    assert.ok(self.result.error.includes("cannot relate to itself"));

    const rel = await lensRun("projects", "relation-add", { params: { fromTaskId: t1.id, toTaskId: t2.id, kind: "blocks" } }, ctx);
    assert.equal(rel.ok, true);
    const dup = await lensRun("projects", "relation-add", { params: { fromTaskId: t1.id, toTaskId: t2.id, kind: "blocks" } }, ctx);
    assert.equal(dup.result.ok, false);
    assert.ok(dup.result.error.includes("already exists"));

    const list = await lensRun("projects", "relation-list", { params: { taskId: t1.id } }, ctx);
    assert.ok(list.result.relations.some((x) => x.id === rel.result.relation.id));
  });

  it("attachment-add validates the URL scheme and round-trips", async () => {
    const bad = await lensRun("projects", "attachment-add", { params: { taskId: t2.id, url: "ftp://x" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.ok(bad.result.error.includes("http"));

    const good = await lensRun("projects", "attachment-add", { params: { taskId: t2.id, url: "https://example.com/spec.pdf", name: "Spec" } }, ctx);
    assert.equal(good.ok, true);
    const list = await lensRun("projects", "attachment-list", { params: { taskId: t2.id } }, ctx);
    assert.ok(list.result.attachments.some((a) => a.id === good.result.attachment.id));
  });

  it("label-create → label-list → label-delete round-trip", async () => {
    const add = await lensRun("projects", "label-create", { params: { projectId: pid, name: "blocker" } }, ctx);
    assert.equal(add.ok, true);
    const list = await lensRun("projects", "label-list", { params: { projectId: pid } }, ctx);
    assert.ok(list.result.labels.some((l) => l.id === add.result.label.id));
    const del = await lensRun("projects", "label-delete", { params: { id: add.result.label.id } }, ctx);
    assert.equal(del.result.deleted, add.result.label.id);
    const list2 = await lensRun("projects", "label-list", { params: { projectId: pid } }, ctx);
    assert.ok(!list2.result.labels.some((l) => l.id === add.result.label.id));
  });
});

describe("projects — sprints, reports, risk register, goals (shared ctx)", () => {
  let ctx, pid;
  before(async () => {
    ctx = await depthCtx("projects-reports");
    pid = (await lensRun("projects", "project-create", { params: { name: "Falcon", key: "FAL" } }, ctx)).result.project.id;
  });

  it("sprint-create → sprint-list rolls up committed/completed points", async () => {
    const sp = await lensRun("projects", "sprint-create", { params: { projectId: pid, name: "Sprint 1" } }, ctx);
    assert.equal(sp.ok, true);
    const sid = sp.result.sprint.id;
    // two tasks in the sprint, one done
    const a = await lensRun("projects", "task-create", { params: { projectId: pid, title: "A", points: 3, sprintId: sid } }, ctx);
    await lensRun("projects", "task-create", { params: { projectId: pid, title: "B", points: 5, sprintId: sid } }, ctx);
    await lensRun("projects", "task-move-status", { params: { id: a.result.task.id, status: "done" } }, ctx);

    const list = await lensRun("projects", "sprint-list", { params: { projectId: pid } }, ctx);
    const row = list.result.sprints.find((x) => x.id === sid);
    assert.equal(row.totalPoints, 8);    // 3 + 5
    assert.equal(row.donePoints, 3);     // only A done
    assert.equal(row.taskCount, 2);
  });

  it("sprint-complete carries unfinished tasks back to the backlog", async () => {
    const sp = await lensRun("projects", "sprint-create", { params: { projectId: pid, name: "Sprint 2" } }, ctx);
    const sid = sp.result.sprint.id;
    const done = await lensRun("projects", "task-create", { params: { projectId: pid, title: "Done one", sprintId: sid } }, ctx);
    await lensRun("projects", "task-create", { params: { projectId: pid, title: "Unfinished", sprintId: sid } }, ctx);
    await lensRun("projects", "task-move-status", { params: { id: done.result.task.id, status: "done" } }, ctx);

    const c = await lensRun("projects", "sprint-complete", { params: { id: sid } }, ctx);
    assert.equal(c.ok, true);
    assert.equal(c.result.status, "completed");
    assert.equal(c.result.carriedOver, 1);   // only the unfinished one
  });

  it("report-velocity averages completed points across completed sprints", async () => {
    // dedicated project so the average is exact
    const p2 = (await lensRun("projects", "project-create", { params: { name: "VelProj", key: "VEL" } }, ctx)).result.project.id;
    const s1 = (await lensRun("projects", "sprint-create", { params: { projectId: p2, name: "S1" } }, ctx)).result.sprint.id;
    const ta = (await lensRun("projects", "task-create", { params: { projectId: p2, title: "TA", points: 6, sprintId: s1 } }, ctx)).result.task.id;
    await lensRun("projects", "task-move-status", { params: { id: ta, status: "done" } }, ctx);
    await lensRun("projects", "sprint-complete", { params: { id: s1, carryOver: false } }, ctx);

    const s2 = (await lensRun("projects", "sprint-create", { params: { projectId: p2, name: "S2" } }, ctx)).result.sprint.id;
    const tb = (await lensRun("projects", "task-create", { params: { projectId: p2, title: "TB", points: 4, sprintId: s2 } }, ctx)).result.task.id;
    await lensRun("projects", "task-move-status", { params: { id: tb, status: "done" } }, ctx);
    await lensRun("projects", "sprint-complete", { params: { id: s2, carryOver: false } }, ctx);

    const v = await lensRun("projects", "report-velocity", { params: { projectId: p2 } }, ctx);
    assert.equal(v.ok, true);
    assert.equal(v.result.completedSprints, 2);
    assert.equal(v.result.avgVelocity, 5);   // (6 + 4) / 2
  });

  it("report-forecast projects sprints from remaining points / avg velocity", async () => {
    const p3 = (await lensRun("projects", "project-create", { params: { name: "FcastProj", key: "FCP" } }, ctx)).result.project.id;
    const s1 = (await lensRun("projects", "sprint-create", { params: { projectId: p3, name: "S1" } }, ctx)).result.sprint.id;
    const done = (await lensRun("projects", "task-create", { params: { projectId: p3, title: "Did", points: 10, sprintId: s1 } }, ctx)).result.task.id;
    await lensRun("projects", "task-move-status", { params: { id: done, status: "done" } }, ctx);
    await lensRun("projects", "sprint-complete", { params: { id: s1, carryOver: false } }, ctx);
    // 30 remaining points still open in the backlog
    await lensRun("projects", "task-create", { params: { projectId: p3, title: "Todo", points: 30 } }, ctx);

    const f = await lensRun("projects", "report-forecast", { params: { projectId: p3 } }, ctx);
    assert.equal(f.ok, true);
    assert.equal(f.result.remainingPoints, 30);
    assert.equal(f.result.avgVelocity, 10);       // one completed sprint of 10
    assert.equal(f.result.projectedSprints, 3);   // ceil(30/10)
    assert.equal(f.result.basis, 1);
  });

  it("risk-add computes score = likelihood × impact + severity band; risk-list sorts desc", async () => {
    const low = await lensRun("projects", "risk-add", { params: { projectId: pid, name: "Minor", likelihood: 1, impact: 2 } }, ctx);
    assert.equal(low.result.risk.score, 2);
    assert.equal(low.result.risk.severity, "low");
    const crit = await lensRun("projects", "risk-add", { params: { projectId: pid, name: "Major", likelihood: 5, impact: 4 } }, ctx);
    assert.equal(crit.result.risk.score, 20);     // 5 × 4, clamped to 1..5
    assert.equal(crit.result.risk.severity, "critical");

    const noName = await lensRun("projects", "risk-add", { params: { projectId: pid } }, ctx);
    assert.equal(noName.result.ok, false);
    assert.ok(noName.result.error.includes("name required"));

    const list = await lensRun("projects", "risk-list", { params: { projectId: pid } }, ctx);
    assert.equal(list.result.risks[0].name, "Major");   // highest score first
    assert.ok(list.result.critical >= 1);
  });

  it("goal-create → goal-update-progress computes progressPct", async () => {
    const g = await lensRun("projects", "goal-create", { params: { projectId: pid, name: "Ship MVP", target: 50, current: 10 } }, ctx);
    assert.equal(g.ok, true);
    const up = await lensRun("projects", "goal-update-progress", { params: { id: g.result.goal.id, current: 25 } }, ctx);
    assert.equal(up.result.goal.current, 25);
    assert.equal(up.result.goal.progressPct, 50);   // 25 / 50
    const list = await lensRun("projects", "goal-list", { params: { projectId: pid } }, ctx);
    assert.ok(list.result.goals.some((x) => x.id === g.result.goal.id && x.progressPct === 50));
  });
});

describe("projects — board, dashboard, wip, triage, sla (shared ctx)", () => {
  let ctx, pid;
  before(async () => {
    ctx = await depthCtx("projects-board-flow");
    pid = (await lensRun("projects", "project-create", { params: { name: "Ops", key: "OPS" } }, ctx)).result.project.id;
  });

  it("board groups tasks into status columns", async () => {
    const t = await lensRun("projects", "task-create", { params: { projectId: pid, title: "On board" } }, ctx);
    await lensRun("projects", "task-move-status", { params: { id: t.result.task.id, status: "in_progress" } }, ctx);
    const b = await lensRun("projects", "board", { params: { projectId: pid } }, ctx);
    assert.equal(b.ok, true);
    const ip = b.result.columns.find((c) => c.status === "in_progress");
    assert.ok(ip.tasks.some((x) => x.id === t.result.task.id));
  });

  it("project-dashboard counts totals, done, completion %, byStatus", async () => {
    const p2 = (await lensRun("projects", "project-create", { params: { name: "DashProj", key: "DSH" } }, ctx)).result.project.id;
    const a = await lensRun("projects", "task-create", { params: { projectId: p2, title: "X" } }, ctx);
    await lensRun("projects", "task-create", { params: { projectId: p2, title: "Y" } }, ctx);
    await lensRun("projects", "task-move-status", { params: { id: a.result.task.id, status: "done" } }, ctx);
    const d = await lensRun("projects", "project-dashboard", { params: { projectId: p2 } }, ctx);
    assert.equal(d.ok, true);
    assert.equal(d.result.totalTasks, 2);
    assert.equal(d.result.done, 1);
    assert.equal(d.result.completionPct, 50);
    assert.equal(d.result.byStatus.done, 1);
  });

  it("wip-set rejects an invalid status; valid round-trips via wip-list", async () => {
    const bad = await lensRun("projects", "wip-set", { params: { projectId: pid, status: "nonsense", limit: 3 } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.ok(bad.result.error.includes("valid status required"));
    const ok = await lensRun("projects", "wip-set", { params: { projectId: pid, status: "in_progress", limit: 3 } }, ctx);
    assert.equal(ok.result.limit, 3);
    const list = await lensRun("projects", "wip-list", { params: { projectId: pid } }, ctx);
    assert.ok(list.result.limits.some((w) => w.status === "in_progress" && w.limit === 3));
  });

  it("triage-submit → triage-queue → triage-accept clears the triage flag", async () => {
    const sub = await lensRun("projects", "triage-submit", { params: { projectId: pid, title: "Crash on load", source: "support" } }, ctx);
    assert.equal(sub.ok, true);
    assert.equal(sub.result.task.isTriage, true);
    assert.equal(sub.result.task.type, "bug");        // default type for triage
    const tid = sub.result.task.id;

    const queue = await lensRun("projects", "triage-queue", { params: { projectId: pid } }, ctx);
    assert.ok(queue.result.queue.some((t) => t.id === tid));

    const acc = await lensRun("projects", "triage-accept", { params: { id: tid, priority: "high" } }, ctx);
    assert.equal(acc.result.task.isTriage, false);
    assert.equal(acc.result.task.priority, "high");

    const queue2 = await lensRun("projects", "triage-queue", { params: { projectId: pid } }, ctx);
    assert.ok(!queue2.result.queue.some((t) => t.id === tid));
  });

  it("triage-decline removes the issue from the queue", async () => {
    const sub = await lensRun("projects", "triage-submit", { params: { projectId: pid, title: "Spam" } }, ctx);
    const tid = sub.result.task.id;
    const dec = await lensRun("projects", "triage-decline", { params: { id: tid } }, ctx);
    assert.equal(dec.ok, true);
    assert.equal(dec.result.declined, tid);
    const q = await lensRun("projects", "triage-queue", { params: { projectId: pid } }, ctx);
    assert.ok(!q.result.queue.some((t) => t.id === tid));
  });

  it("sla-policy-set rejects priority 'none'; valid policy round-trips", async () => {
    const bad = await lensRun("projects", "sla-policy-set", { params: { projectId: pid, priority: "none", responseDays: 1 } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.ok(bad.result.error.includes("valid priority required"));
    const ok = await lensRun("projects", "sla-policy-set", { params: { projectId: pid, priority: "high", responseDays: 2, escalateTo: "urgent" } }, ctx);
    assert.equal(ok.result.policy.responseDays, 2);
    assert.equal(ok.result.policy.escalateTo, "urgent");
    const list = await lensRun("projects", "sla-policy-list", { params: { projectId: pid } }, ctx);
    assert.ok(list.result.policies.some((p) => p.id === ok.result.policy.id));
  });

  it("sla-escalate flags an overdue task as breached and bumps its priority", async () => {
    const p2 = (await lensRun("projects", "project-create", { params: { name: "SLAProj", key: "SLA" } }, ctx)).result.project.id;
    await lensRun("projects", "sla-policy-set", { params: { projectId: p2, priority: "high", responseDays: 1, escalateTo: "urgent" } }, ctx);
    // a task with a past due date → already breached
    const t = await lensRun("projects", "task-create", { params: { projectId: p2, title: "Late", priority: "high", dueDate: "2020-01-01" } }, ctx);
    const esc = await lensRun("projects", "sla-escalate", { params: { projectId: p2 } }, ctx);
    assert.equal(esc.ok, true);
    assert.equal(esc.result.breachedCount, 1);
    assert.ok(esc.result.breached.some((b) => b.id === t.result.task.id));
    assert.equal(esc.result.escalated, 1);   // high → urgent

    const detail = await lensRun("projects", "task-detail", { params: { id: t.result.task.id } }, ctx);
    assert.equal(detail.result.task.priority, "urgent");
  });

  it("command-search returns matching project + task results and command intents", async () => {
    const proj = await lensRun("projects", "project-create", { params: { name: "Searchable", key: "SRC" } }, ctx);
    await lensRun("projects", "task-create", { params: { projectId: proj.result.project.id, title: "findme widget" } }, ctx);
    const r = await lensRun("projects", "command-search", { params: { query: "findme" } }, ctx);
    assert.equal(r.ok, true);
    assert.ok(r.result.results.some((x) => x.kind === "task" && x.label.includes("findme")));
    assert.ok(r.result.commands.some((c) => c.action === "task-create"));
  });
});
