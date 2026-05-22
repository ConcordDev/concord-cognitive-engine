// Contract tests for server/domains/mentorship.js — pure-compute analytics
// plus the full mentoring-platform surface (directory, matching, scheduling,
// notes, goals, reviews, program reporting, messaging).

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
  // Fresh state per test.
  globalThis._concordSTATE = {};
});

const ctxM = { actor: { userId: "user_mentor" }, userId: "user_mentor" };
const ctxE = { actor: { userId: "user_mentee" }, userId: "user_mentee" };

describe("mentorship pure-compute analytics", () => {
  it("matchScore grades compatibility", () => {
    const r = call("matchScore", ctxM, { data: {
      mentor: { name: "M", skills: ["react", "node"], availability: "weekly", experience: true },
      mentee: { name: "E", goals: ["learn react"], preferredSchedule: "weekly" },
    } }, {});
    assert.equal(r.ok, true);
    assert.ok(r.result.matchScore > 0);
    assert.ok(["excellent", "good", "fair"].includes(r.result.compatibility));
  });

  it("progressTrack rolls up goals + sessions", () => {
    const r = call("progressTrack", ctxM, { data: {
      goals: [{ completed: true }, { status: "done" }, {}],
      sessions: [{ duration: 1 }, { duration: 2 }],
    } }, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.completed, 2);
    assert.equal(r.result.completionRate, 67);
  });

  it("feedbackSummary averages ratings", () => {
    const r = call("feedbackSummary", ctxM, { data: {
      feedback: [{ rating: 5, tags: ["helpful"] }, { rating: 4, tags: ["helpful"] }],
    } }, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.avgRating, 4.5);
    assert.equal(r.result.topThemes[0].theme, "helpful");
  });

  it("developmentPlan returns 26-week roadmap", () => {
    const r = call("developmentPlan", ctxM, { data: { targetRole: "Lead", skillGaps: ["a"] } }, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.timelineWeeks, 26);
    assert.equal(r.result.milestones.length, 4);
  });
});

describe("mentorship directory / discovery", () => {
  it("mentor-register requires a name", () => {
    const r = call("mentor-register", ctxM, {});
    assert.equal(r.ok, false);
  });

  it("mentor-register + mentor-directory round-trip", () => {
    const reg = call("mentor-register", ctxM, { name: "Ada", skills: ["rust", "systems"], experienceYears: 8 });
    assert.equal(reg.ok, true);
    assert.equal(reg.result.mentor.name, "Ada");
    const dir = call("mentor-directory", ctxE, {});
    assert.equal(dir.ok, true);
    assert.equal(dir.result.count, 1);
    assert.ok(dir.result.skills.includes("rust"));
  });

  it("mentor-directory filters by skill", () => {
    call("mentor-register", ctxM, { name: "Ada", skills: ["rust"] });
    call("mentor-register", ctxE, { name: "Bob", skills: ["design"] });
    const r = call("mentor-directory", ctxM, { skill: "design" });
    assert.equal(r.result.count, 1);
    assert.equal(r.result.mentors[0].name, "Bob");
  });

  it("mentor-profile returns reviews + open slots", () => {
    call("mentor-register", ctxM, { name: "Ada", capacity: 4 });
    const r = call("mentor-profile", ctxE, { mentorId: "user_mentor" });
    assert.equal(r.ok, true);
    assert.equal(r.result.openSlots, 4);
  });
});

describe("mentorship request → accept flow", () => {
  beforeEach(() => { call("mentor-register", ctxM, { name: "Ada", skills: ["rust"] }); });

  it("request-send creates a pending request", () => {
    const r = call("request-send", ctxE, { mentorId: "user_mentor", topic: "Rust", menteeName: "Eve" });
    assert.equal(r.ok, true);
    assert.equal(r.result.request.status, "pending");
  });

  it("request-send rejects duplicate pending requests", () => {
    call("request-send", ctxE, { mentorId: "user_mentor" });
    const dup = call("request-send", ctxE, { mentorId: "user_mentor" });
    assert.equal(dup.ok, false);
  });

  it("request-list shows incoming + outgoing", () => {
    call("request-send", ctxE, { mentorId: "user_mentor" });
    const inbox = call("request-list", ctxM, {});
    assert.equal(inbox.result.pendingIncoming, 1);
    const sent = call("request-list", ctxE, {});
    assert.equal(sent.result.outgoing.length, 1);
  });

  it("request-respond accept bumps mentee count", () => {
    const send = call("request-send", ctxE, { mentorId: "user_mentor" });
    const r = call("request-respond", ctxM, { requestId: send.result.request.id, decision: "accept" });
    assert.equal(r.ok, true);
    assert.equal(r.result.request.status, "accepted");
    const prof = call("mentor-profile", ctxE, { mentorId: "user_mentor" });
    assert.equal(prof.result.mentor.menteeCount, 1);
  });

  it("request-withdraw cancels a pending request", () => {
    const send = call("request-send", ctxE, { mentorId: "user_mentor" });
    const r = call("request-withdraw", ctxE, { requestId: send.result.request.id });
    assert.equal(r.ok, true);
    assert.equal(r.result.request.status, "withdrawn");
  });
});

describe("mentorship session scheduling + notes", () => {
  it("session-book mirrors onto both parties", () => {
    const r = call("session-book", ctxM, { partnerId: "user_mentee", startAt: "2030-01-01T10:00:00Z", title: "Kickoff" });
    assert.equal(r.ok, true);
    const mentorList = call("session-list", ctxM, {});
    const menteeList = call("session-list", ctxE, {});
    assert.equal(mentorList.result.count, 1);
    assert.equal(menteeList.result.count, 1);
  });

  it("session-book rejects missing fields", () => {
    assert.equal(call("session-book", ctxM, { partnerId: "x" }).ok, false);
    assert.equal(call("session-book", ctxM, { startAt: "2030-01-01" }).ok, false);
  });

  it("session-update completes a session with rating", () => {
    const b = call("session-book", ctxM, { partnerId: "user_mentee", startAt: "2030-01-01T10:00:00Z" });
    const r = call("session-update", ctxM, { sessionId: b.result.session.id, status: "completed", rating: 5 });
    assert.equal(r.ok, true);
    assert.equal(r.result.session.status, "completed");
    assert.equal(r.result.session.rating, 5);
  });

  it("session-note-save adds notes + action items", () => {
    const b = call("session-book", ctxM, { partnerId: "user_mentee", startAt: "2030-01-01T10:00:00Z" });
    const r = call("session-note-save", ctxM, { sessionId: b.result.session.id, notes: "Great chat", actionItem: "Read docs" });
    assert.equal(r.ok, true);
    assert.equal(r.result.session.notes, "Great chat");
    assert.equal(r.result.openActionItems, 1);
    const toggle = call("session-note-save", ctxM, { sessionId: b.result.session.id, toggleItemId: r.result.session.actionItems[0].id });
    assert.equal(toggle.result.openActionItems, 0);
  });
});

describe("mentorship goal workspace", () => {
  it("goal-create requires a title", () => {
    assert.equal(call("goal-create", ctxE, {}).ok, false);
  });

  it("goal-create + goal-list round-trip", () => {
    call("goal-create", ctxE, { title: "Ship a project", targetDate: "2030-06-01" });
    const r = call("goal-list", ctxE, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.count, 1);
    assert.equal(r.result.active, 1);
  });

  it("goal-checkin records progress + auto-completes at 100", () => {
    const g = call("goal-create", ctxE, { title: "Learn Rust" });
    const r = call("goal-checkin", ctxE, { goalId: g.result.goal.id, progress: 100, note: "done!" });
    assert.equal(r.ok, true);
    assert.equal(r.result.goal.status, "done");
    assert.equal(r.result.goal.checkIns.length, 1);
  });
});

describe("mentorship reviews", () => {
  beforeEach(() => { call("mentor-register", ctxM, { name: "Ada" }); });

  it("review-add requires a rating", () => {
    assert.equal(call("review-add", ctxE, { mentorId: "user_mentor" }).ok, false);
  });

  it("review-add updates mentor aggregate rating", () => {
    const r = call("review-add", ctxE, { mentorId: "user_mentor", rating: 5, comment: "Brilliant" });
    assert.equal(r.ok, true);
    assert.equal(r.result.mentorRating, 5);
    assert.equal(r.result.reviewCount, 1);
  });

  it("review-list returns histogram", () => {
    call("review-add", ctxE, { mentorId: "user_mentor", rating: 4 });
    const r = call("review-list", ctxM, { mentorId: "user_mentor" });
    assert.equal(r.ok, true);
    assert.equal(r.result.avgRating, 4);
    assert.equal(r.result.histogram.length, 5);
  });
});

describe("mentorship program report", () => {
  it("program-report aggregates the whole platform", () => {
    call("mentor-register", ctxM, { name: "Ada", capacity: 3 });
    const send = call("request-send", ctxE, { mentorId: "user_mentor" });
    call("request-respond", ctxM, { requestId: send.result.request.id, decision: "accept" });
    const r = call("program-report", ctxM, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.mentors, 1);
    assert.equal(r.result.activeMatches, 1);
    assert.equal(r.result.matchAcceptanceRate, 100);
    assert.ok(Array.isArray(r.result.cohort));
  });
});

describe("mentorship messaging", () => {
  it("message-send requires body + recipient", () => {
    assert.equal(call("message-send", ctxM, { toId: "x" }).ok, false);
    assert.equal(call("message-send", ctxM, { body: "hi" }).ok, false);
  });

  it("message-send + message-thread converge on one thread", () => {
    call("message-send", ctxM, { toId: "user_mentee", body: "Welcome!", fromName: "Ada" });
    call("message-send", ctxE, { toId: "user_mentor", body: "Thanks!", fromName: "Eve" });
    const thread = call("message-thread", ctxM, { partnerId: "user_mentee" });
    assert.equal(thread.ok, true);
    assert.equal(thread.result.count, 2);
  });

  it("message-inbox lists conversation threads", () => {
    call("message-send", ctxM, { toId: "user_mentee", body: "Hi" });
    const r = call("message-inbox", ctxM, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.count, 1);
    assert.equal(r.result.threads[0].partnerId, "user_mentee");
  });
});
