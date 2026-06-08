// tests/depth/cobuild-behavior.test.js — REAL behavioral tests for the cobuild
// (co-build collaboration) domain. Exact-value + round-trip + status-transition
// + validation-rejection per macro.
//
// LOCAL SHIM: the domain is registered directly into a private Map (no server
// boot, no LENS_ACTIONS dependency). Each handler is invoked exactly as the
// macro dispatcher would: handler(ctx, artifact, params). The `run` helper feeds
// the data object as the artifact and the params object as params.
import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import register from "../../domains/cobuild.js";

const H = new Map();
register((d, a, fn) => H.set(a, fn));
const run = (a, data = {}, params = {}, ctx = { actor: { userId: "u1" } }) =>
  H.get(a)(ctx, { data }, params);

// Fresh STATE between describe blocks so counts/round-trips don't leak.
function resetState() {
  globalThis._concordSTATE = {};
}

describe("cobuild — all macros registered", () => {
  it("registers the full macro set", () => {
    const expected = [
      "session-create", "session-list", "session-join", "session-leave",
      "task-create", "task-list", "task-update-status",
      "annotation-add", "annotations-list", "annotation-resolve",
      "cobuild-summary",
    ];
    for (const m of expected) {
      assert.ok(H.has(m), `macro ${m} must be registered`);
    }
    // substantive: a freshly-registered domain lists zero sessions
    assert.deepEqual(run("session-list").result.sessions, []);
  });
});

describe("cobuild — session lifecycle (create / list / join / leave)", () => {
  before(resetState);

  it("session-create returns a session owned by the actor with self as participant", () => {
    const r = run("session-create", {}, { name: "Bridge Build", goal: "raise the span" });
    assert.equal(r.ok, true);
    assert.equal(r.result.session.name, "Bridge Build");
    assert.equal(r.result.session.goal, "raise the span");
    assert.equal(r.result.session.ownerId, "u1");
    assert.ok(r.result.session.participants.includes("u1"));
  });

  it("session-create rejects an empty name", () => {
    const r = run("session-create", {}, { name: "   " });
    assert.equal(r.ok, false);
    assert.match(r.error, /name required/);
  });

  it("session-list shows the creator's session and excludes non-joined ones", () => {
    // u2 has no sessions of their own yet
    const u2 = { actor: { userId: "u2" } };
    const own = run("session-list", {}, {});
    assert.equal(own.ok, true);
    assert.ok(own.result.sessions.find((s) => s.name === "Bridge Build"));
    const u2list = run("session-list", {}, {}, u2);
    assert.equal(u2list.result.count, 0);
  });

  it("session-join adds a new participant and round-trips into their session-list", () => {
    const create = run("session-create", {}, { name: "Tower Build" });
    const sessionId = create.result.session.id;
    const u2 = { actor: { userId: "u2" } };
    const join = run("session-join", {}, { sessionId }, u2);
    assert.equal(join.ok, true);
    assert.equal(join.result.joined, true);
    assert.equal(join.result.alreadyMember, false);
    assert.equal(join.result.participantCount, 2);
    const u2list = run("session-list", {}, {}, u2);
    assert.ok(u2list.result.sessions.find((s) => s.id === sessionId));
  });

  it("session-join is idempotent — re-joining flags alreadyMember and does not duplicate", () => {
    const create = run("session-create", {}, { name: "Wall Build" });
    const sessionId = create.result.session.id;
    const first = run("session-join", {}, { sessionId });
    assert.equal(first.result.alreadyMember, true); // u1 is the owner/participant
    assert.equal(first.result.participantCount, 1);
  });

  it("session-leave removes the participant and is reflected in participantCount", () => {
    const create = run("session-create", {}, { name: "Moat Build" });
    const sessionId = create.result.session.id;
    const u2 = { actor: { userId: "u2" } };
    run("session-join", {}, { sessionId }, u2);
    const leave = run("session-leave", {}, { sessionId }, u2);
    assert.equal(leave.ok, true);
    assert.equal(leave.result.left, true);
    assert.equal(leave.result.participantCount, 1);
    assert.ok(!leave.result.session.participants.includes("u2"));
  });

  it("session-leave rejects a non-participant and missing session", () => {
    const create = run("session-create", {}, { name: "Gate Build" });
    const sessionId = create.result.session.id;
    const u3 = { actor: { userId: "u3" } };
    const leave = run("session-leave", {}, { sessionId }, u3);
    assert.equal(leave.ok, false);
    assert.match(leave.error, /not a participant/);
    const missing = run("session-leave", {}, { sessionId: "nope" });
    assert.equal(missing.ok, false);
    assert.match(missing.error, /session not found/);
  });
});

describe("cobuild — kanban tasks (create / list / status transitions)", () => {
  let sessionId;
  beforeEach(() => {
    resetState();
    const c = run("session-create", {}, { name: "Task Session" });
    sessionId = c.result.session.id;
  });

  it("task-create starts at todo and reads back via task-list", () => {
    const t = run("task-create", {}, { sessionId, title: "Pour foundation", description: "deep footing" });
    assert.equal(t.ok, true);
    assert.equal(t.result.task.status, "todo");
    assert.equal(t.result.task.title, "Pour foundation");
    const list = run("task-list", {}, { sessionId });
    assert.equal(list.result.count, 1);
    assert.ok(list.result.tasks.find((x) => x.id === t.result.task.id));
    assert.equal(list.result.byStatus.todo, 1);
  });

  it("task-create rejects empty title and unknown session", () => {
    const empty = run("task-create", {}, { sessionId, title: "" });
    assert.equal(empty.ok, false);
    assert.match(empty.error, /title required/);
    const noSession = run("task-create", {}, { sessionId: "ghost", title: "x" });
    assert.equal(noSession.ok, false);
    assert.match(noSession.error, /session not found/);
  });

  it("task-update-status advances todo → doing → done", () => {
    const t = run("task-create", {}, { sessionId, title: "Frame walls" });
    const taskId = t.result.task.id;
    const doing = run("task-update-status", {}, { sessionId, taskId, status: "doing" });
    assert.equal(doing.ok, true);
    assert.equal(doing.result.task.status, "doing");
    const done = run("task-update-status", {}, { sessionId, taskId, status: "done" });
    assert.equal(done.result.task.status, "done");
    const list = run("task-list", {}, { sessionId });
    assert.equal(list.result.byStatus.done, 1);
  });

  it("task-update-status rejects an invalid status", () => {
    const t = run("task-create", {}, { sessionId, title: "Roof" });
    const bad = run("task-update-status", {}, { sessionId, taskId: t.result.task.id, status: "shipping" });
    assert.equal(bad.ok, false);
    assert.match(bad.error, /invalid status/);
  });

  it("task-update-status rejects a missing task", () => {
    const bad = run("task-update-status", {}, { sessionId, taskId: "nope", status: "doing" });
    assert.equal(bad.ok, false);
    assert.match(bad.error, /task not found/);
  });

  it("task-list filters by status", () => {
    const a = run("task-create", {}, { sessionId, title: "A" });
    run("task-create", {}, { sessionId, title: "B" });
    run("task-update-status", {}, { sessionId, taskId: a.result.task.id, status: "doing" });
    const doing = run("task-list", {}, { sessionId, status: "doing" });
    assert.equal(doing.result.count, 1);
    assert.equal(doing.result.tasks[0].title, "A");
  });
});

describe("cobuild — design-review annotations (add / list / resolve)", () => {
  let sessionId;
  beforeEach(() => {
    resetState();
    const c = run("session-create", {}, { name: "Review Session" });
    sessionId = c.result.session.id;
  });

  it("annotation-add stores a typed unresolved annotation and reads back", () => {
    const a = run("annotation-add", {}, { sessionId, kind: "issue", content: "load-bearing wall too thin" });
    assert.equal(a.ok, true);
    assert.equal(a.result.annotation.kind, "issue");
    assert.equal(a.result.annotation.resolved, false);
    const list = run("annotations-list", {}, { sessionId });
    assert.equal(list.result.count, 1);
    assert.equal(list.result.openCount, 1);
    assert.ok(list.result.annotations.find((x) => x.id === a.result.annotation.id));
  });

  it("annotation-add rejects empty content and unknown kind falls back to suggestion", () => {
    const empty = run("annotation-add", {}, { sessionId, content: "  " });
    assert.equal(empty.ok, false);
    assert.match(empty.error, /content required/);
    const weird = run("annotation-add", {}, { sessionId, kind: "rant", content: "consider symmetry" });
    assert.equal(weird.result.annotation.kind, "suggestion");
  });

  it("annotation-resolve flips resolved and updates openCount", () => {
    const a = run("annotation-add", {}, { sessionId, content: "add a railing" });
    const res = run("annotation-resolve", {}, { sessionId, annotationId: a.result.annotation.id });
    assert.equal(res.ok, true);
    assert.equal(res.result.annotation.resolved, true);
    assert.ok(res.result.annotation.resolvedAt);
    const open = run("annotations-list", {}, { sessionId, resolved: false });
    assert.equal(open.result.count, 0);
    const resolved = run("annotations-list", {}, { sessionId, resolved: true });
    assert.equal(resolved.result.count, 1);
  });

  it("annotation-resolve rejects a missing annotation", () => {
    const bad = run("annotation-resolve", {}, { sessionId, annotationId: "nope" });
    assert.equal(bad.ok, false);
    assert.match(bad.error, /annotation not found/);
  });
});

describe("cobuild — summary counts", () => {
  before(resetState);

  it("cobuild-summary tallies participants, open tasks, and annotations", () => {
    const c = run("session-create", {}, { name: "Summary Session" });
    const sessionId = c.result.session.id;
    const u2 = { actor: { userId: "u2" } };
    run("session-join", {}, { sessionId }, u2);

    const t1 = run("task-create", {}, { sessionId, title: "T1" });
    run("task-create", {}, { sessionId, title: "T2" });
    run("task-update-status", {}, { sessionId, taskId: t1.result.task.id, status: "done" });

    const ann = run("annotation-add", {}, { sessionId, content: "tighten the joins" });
    run("annotation-add", {}, { sessionId, content: "nice arch", kind: "praise" });
    run("annotation-resolve", {}, { sessionId, annotationId: ann.result.annotation.id });

    const s = run("cobuild-summary", {}, { sessionId });
    assert.equal(s.ok, true);
    assert.equal(s.result.participantCount, 2);
    assert.equal(s.result.taskCount, 2);
    assert.equal(s.result.openTaskCount, 1);
    assert.equal(s.result.doneTaskCount, 1);
    assert.equal(s.result.annotationCount, 2);
    assert.equal(s.result.openAnnotationCount, 1);
  });

  it("cobuild-summary rejects a missing session", () => {
    const s = run("cobuild-summary", {}, { sessionId: "nope" });
    assert.equal(s.ok, false);
    assert.match(s.error, /session not found/);
  });
});
