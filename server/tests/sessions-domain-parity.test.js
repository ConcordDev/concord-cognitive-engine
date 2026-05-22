/**
 * Tier-2 feature-parity contract test for the sessions domain.
 *
 * Covers the Phase 5 feature-parity backlog macros added on top of the
 * original 6-macro substrate:
 *
 *   sessions.search      — search + sort caller's sessions
 *   sessions.pause       — open → paused
 *   sessions.resume      — paused → open
 *   sessions.rename      — change a session title
 *   sessions.annotate    — append a free-text annotation event
 *   sessions.stale       — list long-idle sessions
 *   sessions.bulk_close  — close many sessions in one sweep
 *
 * Uses an in-memory better-sqlite3 with the real migration 195 schema.
 *
 * Run: node --test server/tests/sessions-domain-parity.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import Database from "better-sqlite3";
import { up as migrate195 } from "../migrations/195_lens_sessions.js";
import registerSessionsMacros from "../domains/sessions.js";

function makeRegistry() {
  const map = new Map();
  const register = (domain, name, handler, meta) => {
    map.set(`${domain}.${name}`, { handler, meta });
  };
  return { register, map };
}

function setup() {
  const db = new Database(":memory:");
  migrate195(db);
  const r = makeRegistry();
  registerSessionsMacros(r.register);
  const call = (name, ctx, input) => r.map.get(`sessions.${name}`).handler(ctx, input);
  return { db, call, registry: r };
}

const AUTH = (db) => ({ db, actor: { userId: "alice" } });
const ANON = (db) => ({ db, actor: {} });

// Backdate a session's updated_at by N days (used to forge stale state).
function ageSession(db, sessionId, days) {
  const ts = Math.floor(Date.now() / 1000) - days * 86400;
  db.prepare("UPDATE lens_sessions SET updated_at = ?, created_at = ? WHERE id = ?")
    .run(ts, ts, sessionId);
}

describe("sessions parity — registration", () => {
  it("registers all 7 new backlog macros", () => {
    const { registry } = setup();
    for (const name of ["search", "pause", "resume", "rename", "annotate", "stale", "bulk_close"]) {
      assert.ok(registry.map.has(`sessions.${name}`), `missing sessions.${name}`);
    }
  });

  it("every new macro rejects anonymous callers", async () => {
    const { db, call } = setup();
    for (const name of ["search", "pause", "resume", "rename", "annotate", "stale", "bulk_close"]) {
      const res = await call(name, ANON(db), { sessionId: "x", outcome: "completed" });
      assert.equal(res.ok, false, `${name} should reject anon`);
      assert.equal(res.reason, "no_user");
    }
  });

  it("every new macro requires a db", async () => {
    const { call } = setup();
    for (const name of ["search", "pause", "resume", "rename", "annotate", "stale", "bulk_close"]) {
      const res = await call(name, { actor: { userId: "alice" } }, { sessionId: "x", outcome: "completed" });
      assert.equal(res.ok, false);
      assert.equal(res.reason, "no_db");
    }
  });
});

describe("sessions.search", () => {
  it("matches title or lens id and respects sort order", async () => {
    const { db, call } = setup();
    const a = await call("start", AUTH(db), { lensId: "kingdoms", title: "Iron Crown campaign" });
    await call("start", AUTH(db), { lensId: "paper", title: "Research arc" });
    await call("advance", AUTH(db), { sessionId: a.session.id, toStep: "muster" });

    const byTitle = await call("search", AUTH(db), { query: "iron" });
    assert.equal(byTitle.ok, true);
    assert.equal(byTitle.sessions.length, 1);
    assert.equal(byTitle.sessions[0].lensId, "kingdoms");

    const byLens = await call("search", AUTH(db), { query: "paper" });
    assert.equal(byLens.sessions.length, 1);
    assert.equal(byLens.sessions[0].lensId, "paper");

    const bySteps = await call("search", AUTH(db), { sort: "steps" });
    assert.equal(bySteps.sessions[0].lensId, "kingdoms"); // highest step_count first
  });

  it("filters by status and never leaks other users", async () => {
    const { db, call } = setup();
    const s = await call("start", AUTH(db), { lensId: "kingdoms" });
    await call("close", AUTH(db), { sessionId: s.session.id, outcome: "completed" });
    const open = await call("search", AUTH(db), { status: "open" });
    assert.equal(open.sessions.length, 0);

    const bob = await call("search", { db, actor: { userId: "bob" } }, {});
    assert.equal(bob.sessions.length, 0);
  });
});

describe("sessions.pause / resume", () => {
  it("pauses an open session and resumes it, logging events", async () => {
    const { db, call } = setup();
    const s = await call("start", AUTH(db), { lensId: "kingdoms", initialStep: "plan" });
    const id = s.session.id;

    const paused = await call("pause", AUTH(db), { sessionId: id, note: "stepping away" });
    assert.equal(paused.ok, true);
    assert.equal(paused.status, "paused");

    const resumed = await call("resume", AUTH(db), { sessionId: id });
    assert.equal(resumed.ok, true);
    assert.equal(resumed.status, "open");

    const kinds = db.prepare("SELECT event_kind FROM lens_session_events WHERE session_id = ? ORDER BY id").all(id)
      .map(e => e.event_kind);
    assert.ok(kinds.includes("paused"));
    assert.ok(kinds.includes("resumed"));
  });

  it("rejects double-pause and resume of an open session", async () => {
    const { db, call } = setup();
    const s = await call("start", AUTH(db), { lensId: "kingdoms" });
    await call("pause", AUTH(db), { sessionId: s.session.id });
    const dbl = await call("pause", AUTH(db), { sessionId: s.session.id });
    assert.equal(dbl.ok, false);
    assert.equal(dbl.reason, "already_paused");

    await call("resume", AUTH(db), { sessionId: s.session.id });
    const dblResume = await call("resume", AUTH(db), { sessionId: s.session.id });
    assert.equal(dblResume.ok, false);
    assert.equal(dblResume.reason, "already_open");
  });

  it("rejects pause/resume on a missing session", async () => {
    const { db, call } = setup();
    const p = await call("pause", AUTH(db), { sessionId: "nope" });
    assert.equal(p.reason, "not_found");
    const r = await call("resume", AUTH(db), { sessionId: "nope" });
    assert.equal(r.reason, "not_found");
  });
});

describe("sessions.rename", () => {
  it("renames a session and logs an annotated event", async () => {
    const { db, call } = setup();
    const s = await call("start", AUTH(db), { lensId: "kingdoms", title: "old" });
    const res = await call("rename", AUTH(db), { sessionId: s.session.id, title: "Iron Crown War" });
    assert.equal(res.ok, true);
    assert.equal(res.title, "Iron Crown War");

    const row = db.prepare("SELECT title FROM lens_sessions WHERE id = ?").get(s.session.id);
    assert.equal(row.title, "Iron Crown War");

    const ev = db.prepare("SELECT event_kind FROM lens_session_events WHERE session_id = ? AND event_kind = 'annotated'").all(s.session.id);
    assert.equal(ev.length, 1);
  });

  it("rejects an empty title", async () => {
    const { db, call } = setup();
    const s = await call("start", AUTH(db), { lensId: "kingdoms" });
    const res = await call("rename", AUTH(db), { sessionId: s.session.id, title: "   " });
    assert.equal(res.ok, false);
    assert.equal(res.reason, "missing_title");
  });
});

describe("sessions.annotate", () => {
  it("appends an annotation event readable via get", async () => {
    const { db, call } = setup();
    const s = await call("start", AUTH(db), { lensId: "kingdoms" });
    const res = await call("annotate", AUTH(db), { sessionId: s.session.id, note: "allies wavering" });
    assert.equal(res.ok, true);
    assert.ok(res.eventId);

    const got = await call("get", AUTH(db), { sessionId: s.session.id });
    const ann = got.events.find(e => e.kind === "annotated" && e.note === "allies wavering");
    assert.ok(ann, "annotation event should surface in get");
  });

  it("rejects an empty note and a missing session", async () => {
    const { db, call } = setup();
    const s = await call("start", AUTH(db), { lensId: "kingdoms" });
    const empty = await call("annotate", AUTH(db), { sessionId: s.session.id, note: "" });
    assert.equal(empty.reason, "missing_note");
    const missing = await call("annotate", AUTH(db), { sessionId: "nope", note: "x" });
    assert.equal(missing.reason, "not_found");
  });
});

describe("sessions.stale", () => {
  it("lists only sessions idle past the threshold", async () => {
    const { db, call } = setup();
    const fresh = await call("start", AUTH(db), { lensId: "kingdoms", title: "fresh" });
    const old = await call("start", AUTH(db), { lensId: "paper", title: "old" });
    ageSession(db, old.session.id, 30);

    const res = await call("stale", AUTH(db), { idleDays: 7 });
    assert.equal(res.ok, true);
    assert.equal(res.sessions.length, 1);
    assert.equal(res.sessions[0].id, old.session.id);
    assert.ok(res.sessions[0].idleDays >= 29);

    // Fresh session is excluded.
    assert.ok(!res.sessions.some(x => x.id === fresh.session.id));
  });

  it("excludes already-closed sessions", async () => {
    const { db, call } = setup();
    const s = await call("start", AUTH(db), { lensId: "kingdoms" });
    ageSession(db, s.session.id, 60);
    await call("close", AUTH(db), { sessionId: s.session.id, outcome: "completed" });
    const res = await call("stale", AUTH(db), { idleDays: 7 });
    assert.equal(res.sessions.length, 0);
  });
});

describe("sessions.bulk_close", () => {
  it("closes an explicit list of session ids", async () => {
    const { db, call } = setup();
    const a = await call("start", AUTH(db), { lensId: "kingdoms" });
    const b = await call("start", AUTH(db), { lensId: "paper" });
    const res = await call("bulk_close", AUTH(db), {
      sessionIds: [a.session.id, b.session.id],
      outcome: "abandoned",
    });
    assert.equal(res.ok, true);
    assert.equal(res.closed, 2);

    for (const id of [a.session.id, b.session.id]) {
      const row = db.prepare("SELECT status FROM lens_sessions WHERE id = ?").get(id);
      assert.equal(row.status, "abandoned");
    }
  });

  it("closes every stale session when scope='stale'", async () => {
    const { db, call } = setup();
    const old = await call("start", AUTH(db), { lensId: "kingdoms" });
    const fresh = await call("start", AUTH(db), { lensId: "paper" });
    ageSession(db, old.session.id, 30);

    const res = await call("bulk_close", AUTH(db), { scope: "stale", idleDays: 7, outcome: "abandoned" });
    assert.equal(res.ok, true);
    assert.equal(res.closed, 1);
    assert.deepEqual(res.sessionIds, [old.session.id]);

    const freshRow = db.prepare("SELECT status FROM lens_sessions WHERE id = ?").get(fresh.session.id);
    assert.equal(freshRow.status, "open");
  });

  it("rejects invalid outcome and no targets", async () => {
    const { db, call } = setup();
    const bad = await call("bulk_close", AUTH(db), { sessionIds: ["x"], outcome: "lost" });
    assert.equal(bad.reason, "invalid_outcome");
    const none = await call("bulk_close", AUTH(db), { outcome: "completed" });
    assert.equal(none.reason, "no_targets");
  });

  it("never closes another user's sessions", async () => {
    const { db, call } = setup();
    const s = await call("start", AUTH(db), { lensId: "kingdoms" });
    const res = await call("bulk_close", { db, actor: { userId: "bob" } }, {
      sessionIds: [s.session.id], outcome: "abandoned",
    });
    assert.equal(res.ok, true);
    assert.equal(res.closed, 0);
    const row = db.prepare("SELECT status FROM lens_sessions WHERE id = ?").get(s.session.id);
    assert.equal(row.status, "open");
  });
});
