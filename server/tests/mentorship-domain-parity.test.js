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
  // Fresh state per test + users-table stub for lookupUserIdentity (INC-77).
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
const RAW_IDS = ["user_mentor", "user_mentee"];
function assertNoRawUserIds(value, ids = RAW_IDS) {
  const blob = JSON.stringify(value);
  for (const id of ids) {
    assert.equal(blob.includes(id), false, `response leaked ${id}: ${blob}`);
  }
}

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

  it("F7 headline-only re-publish keeps experienceYears", () => {
    call("mentor-register", ctxM, {
      name: "Ada", headline: "Original", bio: "Bio stays",
      skills: ["rust"], experienceYears: 4, hourlyFocus: "career",
    });
    const edit = call("mentor-register", ctxM, {
      name: "Ada", headline: "Edited headline",
      // omit experienceYears / bio / skills — patch keeps stored values
    });
    assert.equal(edit.ok, true);
    assert.equal(edit.result.mentor.headline, "Edited headline");
    assert.equal(edit.result.mentor.experienceYears, 4);
    assert.equal(edit.result.mentor.bio, "Bio stays");
    assert.deepEqual(edit.result.mentor.skills, ["rust"]);
    const reload = call("mentor-profile", ctxE, { mentorId: "user_mentor" });
    assert.equal(reload.result.mentor.experienceYears, 4);
    assert.equal(reload.result.mentor.headline, "Edited headline");
  });
});

describe("mentorship request → accept flow", () => {
  beforeEach(() => { call("mentor-register", ctxM, { name: "Ada", skills: ["rust"] }); });

  const validReq = {
    mentorId: "user_mentor",
    topic: "Rust",
    message: "I want to learn systems programming.",
    menteeName: "Eve",
  };

  it("request-send creates a pending request", () => {
    const r = call("request-send", ctxE, validReq);
    assert.equal(r.ok, true);
    assert.equal(r.result.request.status, "pending");
  });

  it("F1 blank topic/message/name are refused and store no pending row", () => {
    const before = call("request-list", ctxM, {});
    assert.equal(before.result.pendingIncoming, 0);
    for (const bad of [
      { ...validReq, topic: "" },
      { ...validReq, topic: "   " },
      { ...validReq, message: "" },
      { ...validReq, menteeName: "" },
    ]) {
      const r = call("request-send", ctxE, bad);
      assert.equal(r.ok, false);
      assert.ok(r.status === 400 || /required/i.test(r.error || ""));
    }
    const after = call("request-list", ctxM, {});
    assert.equal(after.result.pendingIncoming, 0);
    assert.equal(after.result.incoming.length, 0);
    const out = call("request-list", ctxE, {});
    assert.equal(out.result.outgoing.length, 0);
  });

  it("F1 withdrawn blank-style failure does not block a later real request", () => {
    // Simulate a prior withdrawn row (the old bug left a pending phantom).
    const phantom = call("request-send", ctxE, validReq);
    assert.equal(phantom.ok, true);
    call("request-withdraw", ctxE, { requestId: phantom.result.request.id });
    const again = call("request-send", ctxE, {
      ...validReq,
      topic: "Advanced Rust",
      message: "Ready for a real request after withdraw.",
    });
    assert.equal(again.ok, true);
    assert.equal(again.result.request.status, "pending");
    assert.equal(again.result.request.topic, "Advanced Rust");
  });

  it("request-send rejects duplicate pending requests", () => {
    call("request-send", ctxE, validReq);
    const dup = call("request-send", ctxE, validReq);
    assert.equal(dup.ok, false);
  });

  it("request-list shows incoming + outgoing", () => {
    call("request-send", ctxE, validReq);
    const inbox = call("request-list", ctxM, {});
    assert.equal(inbox.result.pendingIncoming, 1);
    const sent = call("request-list", ctxE, {});
    assert.equal(sent.result.outgoing.length, 1);
  });

  it("request-respond accept bumps mentee count", () => {
    const send = call("request-send", ctxE, validReq);
    const r = call("request-respond", ctxM, { requestId: send.result.request.id, decision: "accept" });
    assert.equal(r.ok, true);
    assert.equal(r.result.request.status, "accepted");
    const prof = call("mentor-profile", ctxE, { mentorId: "user_mentor" });
    assert.equal(prof.result.mentor.menteeCount, 1);
  });

  it("request-withdraw cancels a pending request", () => {
    const send = call("request-send", ctxE, validReq);
    const r = call("request-withdraw", ctxE, { requestId: send.result.request.id });
    assert.equal(r.ok, true);
    assert.equal(r.result.request.status, "withdrawn");
  });
});

describe("mentorship session scheduling + notes", () => {
  it("session-book is visible to both parties from one shared record", () => {
    const r = call("session-book", ctxM, { partnerId: "user_mentee", startAt: "2030-01-01T10:00:00Z", title: "Kickoff" });
    assert.equal(r.ok, true);
    const mentorList = call("session-list", ctxM, {});
    const menteeList = call("session-list", ctxE, {});
    assert.equal(mentorList.result.count, 1);
    assert.equal(menteeList.result.count, 1);
    assert.equal(mentorList.result.sessions[0].id, menteeList.result.sessions[0].id);
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

  it("F2 complete as owner is visible to partner list + program-report", () => {
    const b = call("session-book", ctxM, { partnerId: "user_mentee", startAt: "2030-01-01T10:00:00Z", title: "Sync" });
    const id = b.result.session.id;
    call("session-update", ctxM, { sessionId: id, status: "completed", rating: 5 });
    const partnerList = call("session-list", ctxE, {});
    const partnerRow = partnerList.result.sessions.find((x) => x.id === id);
    assert.ok(partnerRow);
    assert.equal(partnerRow.status, "completed");
    assert.equal(partnerRow.rating, 5);
    const report = call("program-report", ctxM, {});
    assert.equal(report.result.sessions.total, 1);
    assert.equal(report.result.sessions.completed, 1);
    assert.equal(report.result.avgSessionRating, 5);
  });

  it("F2 note-save by either party is identical on both lists", () => {
    const b = call("session-book", ctxM, { partnerId: "user_mentee", startAt: "2030-01-01T10:00:00Z" });
    const id = b.result.session.id;
    call("session-note-save", ctxE, { sessionId: id, notes: "Partner wrote this" });
    const owner = call("session-list", ctxM, {}).result.sessions.find((x) => x.id === id);
    const partner = call("session-list", ctxE, {}).result.sessions.find((x) => x.id === id);
    assert.equal(owner.notes, "Partner wrote this");
    assert.equal(partner.notes, "Partner wrote this");
  });

  it("F2 RESTART-PERSISTENCE: shared session survives serialize/hydrate for both", () => {
    const b = call("session-book", ctxM, { partnerId: "user_mentee", startAt: "2030-01-01T10:00:00Z", title: "Persist" });
    const id = b.result.session.id;
    call("session-update", ctxM, { sessionId: id, status: "completed", rating: 4 });
    call("session-note-save", ctxE, { sessionId: id, notes: "survives restart" });
    // Simulate disk snapshot: Maps → plain objects → Maps (same path STATE hydrate uses).
    const snap = JSON.parse(JSON.stringify({
      sessions: Object.fromEntries(globalThis._concordSTATE.mentorshipLens.sessions),
    }));
    globalThis._concordSTATE = { mentorshipLens: { sessions: new Map(Object.entries(snap.sessions)) } };
    const owner = call("session-list", ctxM, {}).result.sessions.find((x) => x.id === id);
    const partner = call("session-list", ctxE, {}).result.sessions.find((x) => x.id === id);
    assert.equal(owner.status, "completed");
    assert.equal(partner.status, "completed");
    assert.equal(owner.notes, "survives restart");
    assert.equal(partner.notes, "survives restart");
    assert.equal(owner.rating, 4);
    assert.equal(partner.rating, 4);
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
  it("program-report aggregates the caller's matches", () => {
    call("mentor-register", ctxM, { name: "Ada", capacity: 3 });
    const send = call("request-send", ctxE, {
      mentorId: "user_mentor", topic: "Rust", message: "Please mentor me.", menteeName: "Eve",
    });
    call("request-respond", ctxM, { requestId: send.result.request.id, decision: "accept" });
    const r = call("program-report", ctxM, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.mentors, 1);
    assert.equal(r.result.activeMatches, 1);
    assert.equal(r.result.matchAcceptanceRate, 100);
    assert.ok(Array.isArray(r.result.cohort));
  });

  it("F5 goals/sessions totals are caller-scoped (no foreign private goals)", () => {
    call("mentor-register", ctxM, { name: "Ada" });
    call("goal-create", ctxM, { title: "Owner goal one" });
    call("goal-create", ctxM, { title: "Owner goal two" });
    call("session-book", ctxM, { partnerId: "user_mentee", startAt: "2030-01-01T10:00:00Z" });
    // acct2 (mentee) owns 0 goals; is party to 1 session
    const rE = call("program-report", ctxE, {});
    assert.equal(rE.result.goals.total, 0);
    assert.equal(rE.result.goals.done, 0);
    assert.equal(rE.result.sessions.total, 1);
    const rM = call("program-report", ctxM, {});
    assert.equal(rM.result.goals.total, 2);
    assert.equal(rM.result.sessions.total, 1);
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

  it("F6 inbox row title is a display name; payloads carry no raw user ids", () => {
    call("message-send", ctxM, { toId: "user_mentee", body: "Hi", fromName: "Ada" });
    const inbox = call("message-inbox", ctxM, {});
    assert.equal(inbox.ok, true);
    assert.equal(inbox.result.count, 1);
    assert.equal(inbox.result.threads[0].partnerName, "Eve Mentee");
    assert.ok(String(inbox.result.threads[0].partnerId).startsWith("u_"));
    assertNoRawUserIds(inbox.result);
    const inboxE = call("message-inbox", ctxE, {});
    assert.equal(inboxE.result.threads[0].partnerName, "Ada Mentor");
    assertNoRawUserIds(inboxE.result);
    const threadE = call("message-thread", ctxE, { partnerId: inboxE.result.threads[0].partnerId });
    assert.equal(threadE.ok, true);
    assert.equal(threadE.result.count, 1);
    assertNoRawUserIds(threadE.result);
    assert.equal(threadE.result.messages[0].fromName, "Ada");
    assert.equal(threadE.result.messages[0].fromMe, false);
  });

  it("message-inbox lists conversation threads", () => {
    call("message-send", ctxM, { toId: "user_mentee", body: "Hi" });
    const r = call("message-inbox", ctxM, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.count, 1);
    assert.ok(String(r.result.threads[0].partnerId).startsWith("u_"));
  });
});
