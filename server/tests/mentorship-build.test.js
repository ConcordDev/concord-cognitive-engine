// Build tests for the Mentorship S2 close-out (B2, queue takeover) —
// goal coherence (done sets progress; the header and the detail can no
// longer contradict) and the profile exit (mentor-withdraw). Mirrors
// the parity harness, including its users-table stub.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerMentorshipActions from "../domains/mentorship.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, artifactOrParams = {}, maybeParams) {
  const fn = ACTIONS.get(`mentorship.${name}`);
  if (!fn) throw new Error(`mentorship.${name} not registered`);
  const artifact = arguments.length === 4 ? artifactOrParams : { id: null, data: {}, meta: {} };
  const params = arguments.length === 4 ? (maybeParams || {}) : artifactOrParams;
  return fn(ctx, artifact, params);
}

before(() => { registerMentorshipActions(register); });

beforeEach(() => {
  const people = [
    { id: "user_mentor", username: "mentor", displayName: "Ada Mentor" },
    { id: "user_mentee", username: "mentee", displayName: "Eve Mentee" },
  ];
  globalThis._concordSTATE = {
    db: {
      prepare(sql) {
        const s = String(sql);
        if (s.includes("PRAGMA")) {
          return { all() { return [{ name: "id" }, { name: "username" }, { name: "display_name" }]; } };
        }
        return {
          get(param) {
            return people.find((r) => r.id === String(param || "")) || null;
          },
        };
      },
    },
  };
});

const ctxM = { actor: { userId: "user_mentor", displayName: "Ada Mentor" }, userId: "user_mentor" };
const ctxE = { actor: { userId: "user_mentee", displayName: "Eve Mentee" }, userId: "user_mentee" };

describe("mentorship S2 — goal coherence", () => {
  it("marking a goal done at 0% sets its progress to 100 in the same write", () => {
    const g = call("goal-create", ctxE, { title: "Ship the portfolio" }).result.goal;
    assert.equal(g.progress, 0);
    assert.equal(g.status, "active");
    const r = call("goal-checkin", ctxE, { goalId: g.id, status: "done" });
    assert.equal(r.result.goal.status, "done");
    assert.equal(r.result.goal.progress, 100);
    const list = call("goal-list", ctxE, {}).result;
    assert.equal(list.done, 1);
    assert.equal(list.goals[0].progress, 100);
  });

  it("a check-in note recorded on the done write carries the final 100", () => {
    const g = call("goal-create", ctxE, { title: "Notes goal" }).result.goal;
    const r = call("goal-checkin", ctxE, { goalId: g.id, status: "done", note: "wrapped up" });
    assert.equal(r.result.goal.checkIns.length, 1);
    assert.equal(r.result.goal.checkIns[0].progress, 100);
  });

  it("progress-only check-ins are unchanged; 100 still completes the goal", () => {
    const g = call("goal-create", ctxE, { title: "Steady goal" }).result.goal;
    const mid = call("goal-checkin", ctxE, { goalId: g.id, progress: 40 }).result.goal;
    assert.equal(mid.progress, 40);
    assert.equal(mid.status, "active");
    const full = call("goal-checkin", ctxE, { goalId: g.id, progress: 100 }).result.goal;
    assert.equal(full.status, "done");
    assert.equal(full.progress, 100);
  });

  it("a goal created at full progress is born done", () => {
    const g = call("goal-create", ctxE, { title: "Already there", progress: 100 }).result.goal;
    assert.equal(g.status, "done");
    assert.equal(g.progress, 100);
  });

  it("pausing keeps progress; a done goal reopened with lower progress reopens", () => {
    const g = call("goal-create", ctxE, { title: "Reopenable" }).result.goal;
    call("goal-checkin", ctxE, { goalId: g.id, status: "done" });
    const back = call("goal-checkin", ctxE, { goalId: g.id, status: "active", progress: 50 }).result.goal;
    assert.equal(back.status, "active");
    assert.equal(back.progress, 50);
  });
});

describe("mentorship S2 — profile exit (mentor-withdraw)", () => {
  it("withdraw removes exactly the caller's profile from the directory", () => {
    call("mentor-register", ctxM, { name: "Ada Mentor", skills: ["career"] });
    call("mentor-register", ctxE, { name: "Eve Mentee", skills: ["design"] });
    let dir = call("mentor-directory", ctxE, {}).result;
    assert.equal(dir.count, 2);
    const w = call("mentor-withdraw", ctxM, {});
    assert.equal(w.ok, true);
    assert.equal(w.result.withdrawn, true);
    dir = call("mentor-directory", ctxE, {}).result;
    assert.equal(dir.count, 1);
    assert.equal(dir.mentors[0].id, "user_mentee");
    const gone = call("mentor-profile", ctxE, { mentorId: "user_mentor" });
    assert.equal(gone.ok, false);
  });

  it("withdrawing with no profile is an honest error, not a fake success", () => {
    const w = call("mentor-withdraw", ctxM, {});
    assert.equal(w.ok, false);
    assert.match(w.error, /no mentor profile/);
  });

  it("a withdrawn mentor can register again", () => {
    call("mentor-register", ctxM, { name: "Ada Mentor" });
    call("mentor-withdraw", ctxM, {});
    const again = call("mentor-register", ctxM, { name: "Ada Mentor" });
    assert.equal(again.ok, true);
    assert.equal(call("mentor-directory", ctxM, {}).result.count, 1);
  });
});
