// tests/depth/mentorship-group-session-behavior.test.js — REAL behavioral
// tests for the `mentorship` domain's group-session macros
// (`group-session-create`, `group-session-list`, `group-session-join`,
// `group-session-leave`, `group-session-update`), the ENGINEERING
// gap-closure for the previously "GENUINELY MISSING" group-sessions
// capability (docs/lens-specs/mentorship-capability-map.md, checklist
// item #4: "Group sessions (many mentees, one mentor)").
//
// `session-book` (the pre-existing 1:1 macro) mirrors a second copy of the
// session onto the partner's own per-user `s.sessions` bucket — a trick
// that only works for exactly two parties. Group sessions instead use a
// SEPARATE entity, `s.groupSessions`, keyed DIRECTLY BY sessionId
// (Map<sessionId, session>) rather than per-user like `sessions`/`goals`
// (Map<userId, Array>), because a group session must be discoverable both
// by its host AND by any current attendee. These tests exercise that
// entity end-to-end with real multi-user scenarios (a host + several
// distinct attendee identities via `depthCtx(label)`, which stamps
// `ctx.actor.userId = label`).
//
// lens.run UNWRAPS a handler's `{ok:true, result:X}` → r.result === X (read
// r.result.<field>). A handler `{ok:false, error}` (no result key) is NOT
// unwrapped → r.result.ok === false + r.result.error carries the message.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { lensRun, depthCtx } from "./_harness.js";

const FUTURE = "2099-01-01T10:00:00.000Z";
const PAST = "2001-01-01T10:00:00.000Z";

describe("mentorship — group-session-create", () => {
  let host;
  before(async () => { host = await depthCtx("gsc-host-" + randomUUID()); });

  it("creates a session with the expected shape and defaults", async () => {
    const r = await lensRun("mentorship", "group-session-create", {
      params: { title: "Resume Review Workshop", startAt: FUTURE, capacity: 8, agenda: "Bring your latest draft" },
    }, host);
    assert.equal(r.ok, true);
    const { session } = r.result;
    assert.ok(typeof session.id === "string" && session.id.length > 0);
    assert.equal(session.hostId, host.actor.userId);
    assert.equal(session.hostName, "Mentor");
    assert.equal(session.title, "Resume Review Workshop");
    assert.equal(session.startAt, FUTURE);
    assert.equal(session.capacity, 8);
    assert.equal(session.durationMin, 45);
    assert.equal(session.agenda, "Bring your latest draft");
    assert.equal(session.status, "scheduled");
    assert.equal(session.notes, "");
    assert.ok(typeof session.createdAt === "string");
  });

  it("does NOT auto-add the host to attendees (host runs it, doesn't fill a slot)", async () => {
    const r = await lensRun("mentorship", "group-session-create", {
      params: { title: "Mock Interview Circle", startAt: FUTURE, capacity: 4 },
    }, host);
    assert.deepEqual(r.result.session.attendees, []);
  });

  it("rejects a missing title", async () => {
    const r = await lensRun("mentorship", "group-session-create", { params: { startAt: FUTURE, capacity: 4 } }, host);
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /title required/);
  });

  it("rejects a missing startAt", async () => {
    const r = await lensRun("mentorship", "group-session-create", { params: { title: "No Start", capacity: 4 } }, host);
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /startAt required/);
  });

  it("rejects capacity < 2 (a group implies more than one seat)", async () => {
    const r = await lensRun("mentorship", "group-session-create", { params: { title: "Solo?", startAt: FUTURE, capacity: 1 } }, host);
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /capacity/);
  });

  it("rejects an omitted capacity (defaults to 0, which is < 2)", async () => {
    const r = await lensRun("mentorship", "group-session-create", { params: { title: "No Capacity", startAt: FUTURE } }, host);
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /capacity/);
  });

  it("rejects a non-numeric capacity", async () => {
    const r = await lensRun("mentorship", "group-session-create", { params: { title: "Bad Capacity", startAt: FUTURE, capacity: "lots" } }, host);
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /capacity/);
  });

  it("floors durationMin at 15, matching session-book's own floor", async () => {
    const r = await lensRun("mentorship", "group-session-create", {
      params: { title: "Quick Sync", startAt: FUTURE, capacity: 3, durationMin: 5 },
    }, host);
    assert.equal(r.result.session.durationMin, 15);
  });

  it("accepts explicit hostName, topic, description, videoLink", async () => {
    const r = await lensRun("mentorship", "group-session-create", {
      params: {
        title: "Career Panel", startAt: FUTURE, capacity: 10,
        hostName: "Dr. Ada", topic: "career-transitions", description: "Open Q&A panel",
        videoLink: "https://meet.example/panel",
      },
    }, host);
    assert.equal(r.result.session.hostName, "Dr. Ada");
    assert.equal(r.result.session.topic, "career-transitions");
    assert.equal(r.result.session.description, "Open Q&A panel");
    assert.equal(r.result.session.videoLink, "https://meet.example/panel");
  });
});

describe("mentorship — group-session-join / group-session-leave", () => {
  let host, attendeeA, attendeeB, attendeeC, outsider;
  let sessionId;

  before(async () => {
    const suffix = randomUUID();
    host = await depthCtx("gsj-host-" + suffix);
    attendeeA = await depthCtx("gsj-a-" + suffix);
    attendeeB = await depthCtx("gsj-b-" + suffix);
    attendeeC = await depthCtx("gsj-c-" + suffix);
    outsider = await depthCtx("gsj-outsider-" + suffix);
    const created = await lensRun("mentorship", "group-session-create", {
      params: { title: "Capacity Test Session", startAt: FUTURE, capacity: 2 },
    }, host);
    sessionId = created.result.session.id;
  });

  it("rejects join against a fabricated sessionId", async () => {
    const r = await lensRun("mentorship", "group-session-join", { params: { sessionId: "nope_" + randomUUID() } }, attendeeA);
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /session not found/);
  });

  it("rejects the host joining their own session", async () => {
    const r = await lensRun("mentorship", "group-session-join", { params: { sessionId } }, host);
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /cannot join your own session/);
  });

  it("a first attendee joins successfully, spotsRemaining reflects capacity - attendees", async () => {
    const r = await lensRun("mentorship", "group-session-join", { params: { sessionId } }, attendeeA);
    assert.equal(r.ok, true);
    assert.ok(r.result.session.attendees.includes(attendeeA.actor.userId));
    assert.equal(r.result.spotsRemaining, 1);
  });

  it("rejects a duplicate join from the same attendee (idempotency guard, not a silent no-op)", async () => {
    const r = await lensRun("mentorship", "group-session-join", { params: { sessionId } }, attendeeA);
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /already joined/);
  });

  it("a second attendee fills the session to capacity", async () => {
    const r = await lensRun("mentorship", "group-session-join", { params: { sessionId } }, attendeeB);
    assert.equal(r.ok, true);
    assert.equal(r.result.spotsRemaining, 0);
    assert.equal(r.result.session.attendees.length, 2);
  });

  it("rejects a third attendee once the session is full", async () => {
    const r = await lensRun("mentorship", "group-session-join", { params: { sessionId } }, attendeeC);
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /session is full/);
  });

  it("rejects leave against a fabricated sessionId", async () => {
    const r = await lensRun("mentorship", "group-session-leave", { params: { sessionId: "nope_" + randomUUID() } }, attendeeA);
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /session not found/);
  });

  it("rejects leave from someone who was never attending", async () => {
    const r = await lensRun("mentorship", "group-session-leave", { params: { sessionId } }, outsider);
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /not attending this session/);
  });

  it("attendeeA leaves successfully, freeing a spot", async () => {
    const r = await lensRun("mentorship", "group-session-leave", { params: { sessionId } }, attendeeA);
    assert.equal(r.ok, true);
    assert.ok(!r.result.session.attendees.includes(attendeeA.actor.userId));
    assert.equal(r.result.session.attendees.length, 1);
  });

  it("the freed spot can be filled by a new attendee (join is re-enterable after leave)", async () => {
    const r = await lensRun("mentorship", "group-session-join", { params: { sessionId } }, attendeeC);
    assert.equal(r.ok, true);
    assert.equal(r.result.spotsRemaining, 0);
    assert.equal(r.result.session.attendees.length, 2);
  });

  it("a repeat leave by attendeeA (who already left) is rejected, not a silent success", async () => {
    const r = await lensRun("mentorship", "group-session-leave", { params: { sessionId } }, attendeeA);
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /not attending this session/);
  });
});

describe("mentorship — group-session-update", () => {
  let host, attendee, otherUser;
  let sessionId;

  before(async () => {
    const suffix = randomUUID();
    host = await depthCtx("gsu-host-" + suffix);
    attendee = await depthCtx("gsu-attendee-" + suffix);
    otherUser = await depthCtx("gsu-other-" + suffix);
    const created = await lensRun("mentorship", "group-session-create", {
      params: { title: "Update Test Session", startAt: FUTURE, capacity: 5 },
    }, host);
    sessionId = created.result.session.id;
    await lensRun("mentorship", "group-session-join", { params: { sessionId } }, attendee);
  });

  it("rejects update against a fabricated sessionId", async () => {
    const r = await lensRun("mentorship", "group-session-update", { params: { sessionId: "nope_" + randomUUID(), status: "completed" } }, host);
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /session not found/);
  });

  it("rejects a non-host attempting to update (an attendee is not the host)", async () => {
    const r = await lensRun("mentorship", "group-session-update", { params: { sessionId, status: "completed" } }, attendee);
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /only the host can update/);
  });

  it("rejects an uninvolved user attempting to update", async () => {
    const r = await lensRun("mentorship", "group-session-update", { params: { sessionId, status: "completed" } }, otherUser);
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /only the host can update/);
  });

  it("the host can update status, videoLink, agenda, and notes in one call", async () => {
    const r = await lensRun("mentorship", "group-session-update", {
      params: { sessionId, status: "completed", videoLink: "https://meet.example/updated", agenda: "Wrap-up", notes: "Great turnout" },
    }, host);
    assert.equal(r.ok, true);
    assert.equal(r.result.session.status, "completed");
    assert.equal(r.result.session.videoLink, "https://meet.example/updated");
    assert.equal(r.result.session.agenda, "Wrap-up");
    assert.equal(r.result.session.notes, "Great turnout");
  });

  it("an invalid status value is silently ignored (not written), matching session-update's own contract", async () => {
    const before2 = await lensRun("mentorship", "group-session-update", { params: { sessionId, videoLink: "https://noop.example" } }, host);
    const prevStatus = before2.result.session.status;
    const r = await lensRun("mentorship", "group-session-update", { params: { sessionId, status: "not-a-real-status" } }, host);
    assert.equal(r.ok, true);
    assert.equal(r.result.session.status, prevStatus);
  });

  it("the host can reschedule startAt", async () => {
    const newTime = "2099-06-15T09:00:00.000Z";
    const r = await lensRun("mentorship", "group-session-update", { params: { sessionId, startAt: newTime } }, host);
    assert.equal(r.result.session.startAt, newTime);
  });
});

describe("mentorship — group-session-list: filters + aggregates (multi-user)", () => {
  let host, attendeeA, attendeeB, uninvolved;
  let hostedFuture, hostedPast, attendingOnly;

  before(async () => {
    const suffix = randomUUID();
    host = await depthCtx("gsl-host-" + suffix);
    attendeeA = await depthCtx("gsl-a-" + suffix);
    attendeeB = await depthCtx("gsl-b-" + suffix);
    uninvolved = await depthCtx("gsl-uninvolved-" + suffix);

    const c1 = await lensRun("mentorship", "group-session-create", { params: { title: "Hosted Future", startAt: FUTURE, capacity: 3 } }, host);
    hostedFuture = c1.result.session.id;

    const c2 = await lensRun("mentorship", "group-session-create", { params: { title: "Hosted Past", startAt: PAST, capacity: 3 } }, host);
    hostedPast = c2.result.session.id;
    // mark the past one completed so it's unambiguously not "upcoming"
    await lensRun("mentorship", "group-session-update", { params: { sessionId: hostedPast, status: "completed" } }, host);

    // A third session hosted by attendeeA that attendeeA (as an attendee
    // elsewhere) and host both participate in different roles for.
    const c3 = await lensRun("mentorship", "group-session-create", { params: { title: "Attending Only", startAt: FUTURE, capacity: 5 } }, attendeeA);
    attendingOnly = c3.result.session.id;

    // host joins attendeeA's session as an attendee (host in one session,
    // attendee in another — exercises both roles for the same identity).
    await lensRun("mentorship", "group-session-join", { params: { sessionId: attendingOnly } }, host);
    // attendeeB joins host's future session.
    await lensRun("mentorship", "group-session-join", { params: { sessionId: hostedFuture } }, attendeeB);
  });

  it("host's default (no filter) list includes both sessions they host AND the one they attend", async () => {
    const r = await lensRun("mentorship", "group-session-list", { params: {} }, host);
    const ids = r.result.sessions.map((s) => s.id);
    assert.ok(ids.includes(hostedFuture));
    assert.ok(ids.includes(hostedPast));
    assert.ok(ids.includes(attendingOnly));
    assert.equal(r.result.count, 3);
    assert.equal(r.result.hostingCount, 2);
    assert.equal(r.result.attendingCount, 1);
  });

  it("filter=hosting narrows to only sessions the caller hosts", async () => {
    const r = await lensRun("mentorship", "group-session-list", { params: { filter: "hosting" } }, host);
    const ids = r.result.sessions.map((s) => s.id);
    assert.ok(ids.includes(hostedFuture));
    assert.ok(ids.includes(hostedPast));
    assert.ok(!ids.includes(attendingOnly));
    assert.equal(r.result.count, 2);
    assert.equal(r.result.hostingCount, 2);
    assert.equal(r.result.attendingCount, 0);
  });

  it("filter=attending narrows to only sessions the caller attends", async () => {
    const r = await lensRun("mentorship", "group-session-list", { params: { filter: "attending" } }, host);
    const ids = r.result.sessions.map((s) => s.id);
    assert.deepEqual(ids, [attendingOnly]);
    assert.equal(r.result.count, 1);
    assert.equal(r.result.hostingCount, 0);
    assert.equal(r.result.attendingCount, 1);
  });

  it("filter=upcoming excludes the completed past session and includes future ones the caller is involved with", async () => {
    const r = await lensRun("mentorship", "group-session-list", { params: { filter: "upcoming" } }, host);
    const ids = r.result.sessions.map((s) => s.id);
    assert.ok(ids.includes(hostedFuture));
    assert.ok(ids.includes(attendingOnly));
    assert.ok(!ids.includes(hostedPast));
  });

  it("attendeeB (joined only hostedFuture) sees exactly that one session, correctly tagged as attending", async () => {
    const r = await lensRun("mentorship", "group-session-list", { params: {} }, attendeeB);
    assert.equal(r.result.count, 1);
    assert.equal(r.result.sessions[0].id, hostedFuture);
    assert.equal(r.result.hostingCount, 0);
    assert.equal(r.result.attendingCount, 1);
  });

  it("attendeeA (hosts attendingOnly) sees it tagged as hosting, not attending", async () => {
    const r = await lensRun("mentorship", "group-session-list", { params: {} }, attendeeA);
    assert.equal(r.result.count, 1);
    assert.equal(r.result.sessions[0].id, attendingOnly);
    assert.equal(r.result.hostingCount, 1);
    assert.equal(r.result.attendingCount, 0);
  });

  it("an uninvolved user sees no sessions at all", async () => {
    const r = await lensRun("mentorship", "group-session-list", { params: {} }, uninvolved);
    assert.equal(r.result.count, 0);
    assert.deepEqual(r.result.sessions, []);
    assert.equal(r.result.hostingCount, 0);
    assert.equal(r.result.attendingCount, 0);
  });
});
