// Tier-2 contract tests for goals lens parity macros:
// alignmentTree / checkin / teamGoal / templates / progressChart /
// reminder / dependencies. Pins per-user scoping, cycle detection,
// recurring instantiation and contribution roll-up.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerGoalsActions from "../domains/goals.js";

const ACTIONS = new Map();
function register(domain, name, fn) {
  ACTIONS.set(`${domain}.${name}`, fn);
}
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`goals.${name}`);
  if (!fn) throw new Error(`goals.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => {
  registerGoalsActions(register);
});

beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

describe("goals — alignmentTree", () => {
  it("upserts objectives and builds a multi-level tree", () => {
    const parent = call("alignmentTree", ctxA, { op: "upsert", title: "Grow revenue", level: "company" });
    assert.equal(parent.ok, true);
    const parentId = parent.result.flat[0].id;
    const child = call("alignmentTree", ctxA, {
      op: "upsert", title: "Expand EU sales", parentId, team: "Sales", level: "team",
      keyResults: ["3 new EU accounts", "EUR 200k pipeline"],
    });
    assert.equal(child.ok, true);
    assert.equal(child.result.stats.objectiveCount, 2);
    assert.equal(child.result.stats.maxDepth, 2);
    assert.equal(child.result.stats.keyResultsLinked, 2);
    assert.equal(child.result.tree[0].children.length, 1);
  });

  it("rejects an objective without a title and self-parenting", () => {
    const bad = call("alignmentTree", ctxA, { op: "upsert" });
    assert.equal(bad.ok, false);
    const o = call("alignmentTree", ctxA, { op: "upsert", title: "X" });
    const id = o.result.flat[0].id;
    const self = call("alignmentTree", ctxA, { op: "upsert", id, title: "X", parentId: id });
    assert.equal(self.ok, false);
  });

  it("remove orphans children to root", () => {
    const p = call("alignmentTree", ctxA, { op: "upsert", title: "P" });
    const pid = p.result.flat[0].id;
    call("alignmentTree", ctxA, { op: "upsert", title: "C", parentId: pid });
    const r = call("alignmentTree", ctxA, { op: "remove", id: pid });
    assert.equal(r.ok, true);
    assert.equal(r.result.stats.objectiveCount, 1);
    assert.equal(r.result.flat[0].parentId, null);
  });

  it("INVARIANT: objectives scoped per-user", () => {
    call("alignmentTree", ctxA, { op: "upsert", title: "A-only" });
    const b = call("alignmentTree", ctxB, { op: "list" });
    assert.equal(b.result.stats.objectiveCount, 0);
  });
});

describe("goals — checkin", () => {
  it("adds a cadence check-in with derived status", () => {
    const r = call("checkin", ctxA, { op: "add", goalId: "g1", confidence: 0.9, progress: 60, note: "ahead" });
    assert.equal(r.ok, true);
    assert.equal(r.result.checkins[0].status, "on_track");
    assert.equal(r.result.stats.avgConfidence, 0.9);
  });

  it("derives at_risk / off_track from low confidence", () => {
    call("checkin", ctxA, { op: "add", goalId: "g1", confidence: 0.5 });
    const r = call("checkin", ctxA, { op: "add", goalId: "g1", confidence: 0.2 });
    assert.equal(r.result.checkins[0].status, "off_track");
    assert.equal(r.result.stats.statusCounts.at_risk, 1);
    assert.equal(r.result.stats.statusCounts.off_track, 1);
  });

  it("rejects a check-in without a goalId", () => {
    const r = call("checkin", ctxA, { op: "add", confidence: 0.5 });
    assert.equal(r.ok, false);
  });

  it("filters list by goalId and isolates per-user", () => {
    call("checkin", ctxA, { op: "add", goalId: "gX", confidence: 0.8 });
    call("checkin", ctxA, { op: "add", goalId: "gY", confidence: 0.8 });
    assert.equal(call("checkin", ctxA, { op: "list", goalId: "gX" }).result.stats.count, 1);
    assert.equal(call("checkin", ctxB, { op: "list" }).result.stats.count, 0);
  });
});

describe("goals — teamGoal", () => {
  it("creates a shared goal and rolls up per-member contributions", () => {
    const g = call("teamGoal", ctxA, { op: "create", title: "Ship v2", target: 100, members: ["Ana", "Ben"] });
    assert.equal(g.ok, true);
    const id = g.result.teamGoal.id;
    call("teamGoal", ctxA, { op: "contribute", id, member: "Ana", amount: 30 });
    const r = call("teamGoal", ctxA, { op: "contribute", id, member: "Ben", amount: 20 });
    assert.equal(r.result.teamGoal.totalContributed, 50);
    assert.equal(r.result.teamGoal.progress, 50);
    const ana = r.result.teamGoal.byMember.find((m) => m.member === "Ana");
    assert.equal(ana.sharePct, 60);
  });

  it("rejects non-positive contributions and unknown ids", () => {
    const g = call("teamGoal", ctxA, { op: "create", title: "T" });
    assert.equal(call("teamGoal", ctxA, { op: "contribute", id: g.result.teamGoal.id, member: "X", amount: 0 }).ok, false);
    assert.equal(call("teamGoal", ctxA, { op: "contribute", id: "nope", member: "X", amount: 5 }).ok, false);
  });

  it("INVARIANT: team goals scoped per-user", () => {
    call("teamGoal", ctxA, { op: "create", title: "A-team" });
    assert.equal(call("teamGoal", ctxB, { op: "list" }).result.teamGoals.length, 0);
  });
});

describe("goals — templates + recurring", () => {
  it("lists built-in templates covering multiple categories", () => {
    const r = call("templates", ctxA, { op: "list" });
    assert.equal(r.ok, true);
    assert.ok(r.result.templates.length >= 5);
    assert.ok(new Set(r.result.templates.map((t) => t.category)).size >= 5);
  });

  it("creates a recurring goal and instantiates due occurrences", () => {
    const c = call("templates", ctxA, {
      op: "recurring-create", title: "Weekly review", cadence: "weekly", startAt: "2020-01-01",
    });
    assert.equal(c.ok, true);
    const run = call("templates", ctxA, { op: "recurring-run-due" });
    assert.equal(run.ok, true);
    assert.ok(run.result.created.length > 1);
    assert.equal(run.result.created[0].title, "Weekly review");
  });

  it("rejects recurring goal without a title", () => {
    assert.equal(call("templates", ctxA, { op: "recurring-create", cadence: "daily" }).ok, false);
  });
});

describe("goals — progressChart", () => {
  it("builds trend + burndown series with an ideal line", () => {
    const r = call("progressChart", ctxA, {
      history: [
        { date: "2026-05-01", progress: 0 },
        { date: "2026-05-08", progress: 40 },
        { date: "2026-05-15", progress: 70 },
      ],
      target: 100,
      targetDate: "2026-05-22",
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.trend.length, 3);
    assert.equal(r.result.burndown.length, 3);
    assert.equal(r.result.stats.currentProgress, 70);
    assert.equal(r.result.stats.remaining, 30);
    assert.ok(r.result.stats.velocityPerDay > 0);
  });

  it("returns an empty result for no history", () => {
    const r = call("progressChart", ctxA, { history: [] });
    assert.equal(r.ok, true);
    assert.equal(r.result.empty, true);
  });
});

describe("goals — reminder", () => {
  it("creates a reminder and surfaces it via the due query", () => {
    const c = call("reminder", ctxA, { op: "create", label: "Quarterly review", dueAt: "2020-01-01", kind: "review" });
    assert.equal(c.ok, true);
    const due = call("reminder", ctxA, { op: "due" });
    assert.equal(due.result.count, 1);
  });

  it("recurring reminder reschedules on complete; once is marked done", () => {
    const rec = call("reminder", ctxA, { op: "create", label: "Weekly", dueAt: "2020-01-01", cadence: "weekly" });
    const recId = rec.result.reminder.id;
    const after = call("reminder", ctxA, { op: "complete", id: recId });
    const found = after.result.reminders.find((r) => r.id === recId);
    assert.equal(found.done, false);
    assert.equal(found.firedCount, 1);

    const once = call("reminder", ctxA, { op: "create", label: "One-off", dueAt: "2020-01-01" });
    const doneRes = call("reminder", ctxA, { op: "complete", id: once.result.reminder.id });
    assert.equal(doneRes.result.reminders.find((r) => r.id === once.result.reminder.id).done, true);
  });

  it("rejects a reminder without a label and isolates per-user", () => {
    assert.equal(call("reminder", ctxA, { op: "create", dueAt: "2026-01-01" }).ok, false);
    call("reminder", ctxA, { op: "create", label: "A", dueAt: "2026-01-01" });
    assert.equal(call("reminder", ctxB, { op: "list" }).result.stats.total, 0);
  });
});

describe("goals — dependencies", () => {
  it("links a blocking edge and partitions blocked/ready goals", () => {
    const r = call("dependencies", ctxA, { op: "link", from: "g1", to: "g2" });
    assert.equal(r.ok, true);
    assert.deepEqual(r.result.blockedGoals, ["g2"]);
    assert.deepEqual(r.result.readyGoals, ["g1"]);
    assert.deepEqual(r.result.blockersByGoal.g2, ["g1"]);
  });

  it("rejects self-dependency and cycle creation", () => {
    assert.equal(call("dependencies", ctxA, { op: "link", from: "g1", to: "g1" }).ok, false);
    call("dependencies", ctxA, { op: "link", from: "g1", to: "g2" });
    call("dependencies", ctxA, { op: "link", from: "g2", to: "g3" });
    const cycle = call("dependencies", ctxA, { op: "link", from: "g3", to: "g1" });
    assert.equal(cycle.ok, false);
    assert.match(cycle.error, /cycle/);
  });

  it("unlinks an edge and isolates per-user", () => {
    call("dependencies", ctxA, { op: "link", from: "a", to: "b" });
    const un = call("dependencies", ctxA, { op: "unlink", from: "a", to: "b" });
    assert.equal(un.result.stats.edgeCount, 0);
    call("dependencies", ctxA, { op: "link", from: "x", to: "y" });
    assert.equal(call("dependencies", ctxB, { op: "list" }).result.stats.edgeCount, 0);
  });
});

describe("goals — STATE unavailable path", () => {
  it("returns an error shape when STATE is missing", () => {
    globalThis._concordSTATE = undefined;
    const r = call("alignmentTree", ctxA, { op: "list" });
    assert.equal(r.ok, false);
    assert.match(r.error, /STATE unavailable/);
  });
});
