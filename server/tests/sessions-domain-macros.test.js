// Behavioral macro tests for server/domains/sessions.js — the cross-lens
// multi-step workflow session substrate (Phase 5).
//
// Drives each registered macro the way runMacro would — a (ctx, input) call —
// against a REAL in-memory better-sqlite3 carrying the migration-195 schema.
// These are NOT shape-only assertions: every test asserts ACTUAL values +
// multi-step round-trips (start → list_mine shows it → advance/update_state
// mutate the persisted state → close terminates it), search filtering + sort,
// per-user scoping (one user never sees another's sessions), and the
// fail-CLOSED numeric guards the macro-assassin's V2 vector probes.
//
// Hermetic — no server boot, only migration 195. Runs in <1s.
// Run: node --test server/tests/sessions-domain-macros.test.js

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import Database from "better-sqlite3";
import { up as migrate195 } from "../migrations/195_lens_sessions.js";
import registerSessionsMacros from "../domains/sessions.js";

function setup() {
  const db = new Database(":memory:");
  migrate195(db);
  const map = new Map();
  registerSessionsMacros((domain, name, handler) => {
    assert.equal(domain, "sessions", `unexpected domain: ${domain}`);
    map.set(name, handler);
  });
  const call = (name, ctx, input = {}) => {
    const fn = map.get(name);
    if (!fn) throw new Error(`sessions.${name} not registered`);
    return fn(ctx, input);
  };
  return { db, call, map };
}

const ctxFor = (db, userId) => ({ db, actor: { userId } });

describe("sessions — registration", () => {
  it("registers the full macro surface", () => {
    const { map } = setup();
    for (const m of [
      "start", "advance", "update_state", "get", "list_mine", "close",
      "search", "pause", "resume", "rename", "annotate", "stale", "bulk_close",
    ]) {
      assert.equal(typeof map.get(m), "function", `missing sessions.${m}`);
    }
  });
});

describe("sessions — start → list_mine → advance → update_state → close round-trip", () => {
  let db, call, ctxA;
  beforeEach(() => { ({ db, call } = setup()); ctxA = ctxFor(db, "alice"); });

  it("opens a session that list_mine surfaces with real values", async () => {
    const started = await call("start", ctxA, {
      lensId: "kingdoms", title: "War campaign", initialStep: "muster",
      initialState: { troops: 100 },
    });
    assert.equal(started.ok, true);
    assert.equal(started.session.status, "open");
    assert.equal(started.session.lensId, "kingdoms");
    assert.equal(started.session.currentStep, "muster");
    assert.equal(started.session.stepCount, 0);
    assert.deepEqual(started.session.state, { troops: 100 });
    const id = started.session.id;

    const listed = await call("list_mine", ctxA, {});
    assert.equal(listed.ok, true);
    assert.equal(listed.total, 1);
    assert.equal(listed.sessions[0].id, id);
    assert.equal(listed.sessions[0].title, "War campaign");
    assert.equal(listed.sessions[0].status, "open");

    // advance mutates the current step + bumps step_count, deep-merges state
    const adv = await call("advance", ctxA, {
      sessionId: id, toStep: "siege", stateMerge: { siege: { turn: 1 } },
    });
    assert.equal(adv.ok, true);
    assert.equal(adv.session.currentStep, "siege");
    assert.equal(adv.session.stepCount, 1);
    assert.deepEqual(adv.session.state, { troops: 100, siege: { turn: 1 } });

    // update_state deep-merges without advancing the step
    const upd = await call("update_state", ctxA, {
      sessionId: id, statePatch: { siege: { turn: 2 }, morale: "high" },
    });
    assert.equal(upd.ok, true);
    assert.deepEqual(upd.state, { troops: 100, siege: { turn: 2 }, morale: "high" });

    // get reflects the merged state + an event ledger (started, advanced, state_merged)
    const got = await call("get", ctxA, { sessionId: id });
    assert.equal(got.ok, true);
    assert.equal(got.session.currentStep, "siege");
    assert.equal(got.session.stepCount, 1);
    assert.deepEqual(got.session.state.siege, { turn: 2 });
    const kinds = got.events.map(e => e.kind).sort();
    assert.deepEqual(kinds, ["advanced", "started", "state_merged"]);

    // close → terminal status, no further mutation
    const closed = await call("close", ctxA, { sessionId: id, outcome: "completed" });
    assert.equal(closed.ok, true);
    assert.equal(closed.status, "completed");
    assert.equal(typeof closed.closedAt, "number");

    const blocked = await call("advance", ctxA, { sessionId: id, toStep: "rout" });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.reason, "session_not_active");

    const reclose = await call("close", ctxA, { sessionId: id, outcome: "abandoned" });
    assert.equal(reclose.ok, false);
    assert.equal(reclose.reason, "already_closed");
  });

  it("rejects writes with missing required fields (real validation reasons)", async () => {
    assert.equal((await call("start", ctxA, {})).reason, "missing_lens_id");
    assert.equal((await call("advance", ctxA, {})).reason, "missing_session_id");
    assert.equal((await call("advance", ctxA, { sessionId: "x" })).reason, "missing_to_step");
    assert.equal((await call("update_state", ctxA, { sessionId: "x" })).reason, "missing_state_patch");
    assert.equal((await call("close", ctxA, { sessionId: "x" })).reason, "invalid_outcome");
    assert.equal((await call("get", ctxA, {})).reason, "missing_session_id");
    // unknown id → not_found, never a leak
    assert.equal((await call("get", ctxA, { sessionId: "nope" })).reason, "not_found");
  });
});

describe("sessions — pause / resume lifecycle", () => {
  let db, call, ctxA;
  beforeEach(() => { ({ db, call } = setup()); ctxA = ctxFor(db, "alice"); });

  it("pauses an open session and resumes it back to open", async () => {
    const s = await call("start", ctxA, { lensId: "paper" });
    const id = s.session.id;

    const paused = await call("pause", ctxA, { sessionId: id });
    assert.equal(paused.ok, true);
    assert.equal(paused.status, "paused");
    assert.equal((await call("pause", ctxA, { sessionId: id })).reason, "already_paused");

    const resumed = await call("resume", ctxA, { sessionId: id });
    assert.equal(resumed.ok, true);
    assert.equal(resumed.status, "open");
    assert.equal((await call("resume", ctxA, { sessionId: id })).reason, "already_open");
  });
});

describe("sessions — rename + annotate write to the event ledger", () => {
  let db, call, ctxA;
  beforeEach(() => { ({ db, call } = setup()); ctxA = ctxFor(db, "alice"); });

  it("renames a session and appends an annotation event", async () => {
    const s = await call("start", ctxA, { lensId: "podcast", title: "Old" });
    const id = s.session.id;

    const renamed = await call("rename", ctxA, { sessionId: id, title: "New" });
    assert.equal(renamed.ok, true);
    assert.equal(renamed.title, "New");

    const ann = await call("annotate", ctxA, { sessionId: id, note: "remember the cold open" });
    assert.equal(ann.ok, true);
    assert.equal(typeof ann.eventId, "number");
    assert.equal(ann.note, "remember the cold open");

    const got = await call("get", ctxA, { sessionId: id });
    assert.equal(got.session.title, "New");
    const annotated = got.events.filter(e => e.kind === "annotated");
    assert.equal(annotated.length, 2); // rename + annotate both log 'annotated'
  });
});

describe("sessions — search filters + sorts by real fields", () => {
  let db, call, ctxA;
  beforeEach(() => { ({ db, call } = setup()); ctxA = ctxFor(db, "alice"); });

  it("filters by query/lens/status and sorts deterministically", async () => {
    const a = await call("start", ctxA, { lensId: "kingdoms", title: "Alpha war" });
    await call("start", ctxA, { lensId: "paper", title: "Beta research" });
    const c = await call("start", ctxA, { lensId: "kingdoms", title: "Gamma war" });
    // advance one to give it more steps + close one
    await call("advance", ctxA, { sessionId: c.session.id, toStep: "x" });
    await call("close", ctxA, { sessionId: a.session.id, outcome: "completed" });

    // free-text query matches title OR lens (case-insensitive substring)
    let r = await call("search", ctxA, { query: "war" });
    assert.equal(r.ok, true);
    assert.equal(r.total, 2);
    assert.ok(r.sessions.every(s => /war/i.test(s.title)));

    // lens filter
    r = await call("search", ctxA, { lensId: "paper" });
    assert.equal(r.total, 1);
    assert.equal(r.sessions[0].title, "Beta research");

    // status filter
    r = await call("search", ctxA, { status: "completed" });
    assert.equal(r.total, 1);
    assert.equal(r.sessions[0].status, "completed");

    // sort by steps desc — the advanced session leads
    r = await call("search", ctxA, { sort: "steps" });
    assert.equal(r.sort, "steps");
    assert.equal(r.sessions[0].id, c.session.id);

    // sort by title A→Z
    r = await call("search", ctxA, { sort: "title" });
    assert.deepEqual(r.sessions.map(s => s.title), ["Alpha war", "Beta research", "Gamma war"]);
  });
});

describe("sessions — stale + bulk_close sweep real rows", () => {
  let db, call, ctxA;
  beforeEach(() => { ({ db, call } = setup()); ctxA = ctxFor(db, "alice"); });

  it("finds idle sessions and bulk-closes them", async () => {
    const s1 = await call("start", ctxA, { lensId: "kingdoms", title: "Idle one" });
    const s2 = await call("start", ctxA, { lensId: "paper", title: "Idle two" });
    // backdate both rows to 30 days ago so they qualify as stale
    const old = Math.floor(Date.now() / 1000) - 30 * 86400;
    db.prepare(`UPDATE lens_sessions SET updated_at = ?`).run(old);

    const stale = await call("stale", ctxA, { idleDays: 7 });
    assert.equal(stale.ok, true);
    assert.equal(stale.total, 2);
    assert.ok(stale.sessions.every(s => s.idleDays >= 30));

    const swept = await call("bulk_close", ctxA, { outcome: "abandoned", scope: "stale", idleDays: 7 });
    assert.equal(swept.ok, true);
    assert.equal(swept.closed, 2);
    assert.deepEqual(swept.sessionIds.sort(), [s1.session.id, s2.session.id].sort());

    // both are now abandoned, nothing left stale
    assert.equal((await call("stale", ctxA, { idleDays: 7 })).total, 0);
  });

  it("bulk-closes an explicit id list", async () => {
    const s = await call("start", ctxA, { lensId: "kingdoms" });
    const r = await call("bulk_close", ctxA, { outcome: "completed", sessionIds: [s.session.id] });
    assert.equal(r.ok, true);
    assert.equal(r.closed, 1);
    assert.equal((await call("get", ctxA, { sessionId: s.session.id })).session.status, "completed");
  });
});

describe("sessions — per-user scoping + anonymous guard", () => {
  let db, call;
  beforeEach(() => { ({ db, call } = setup()); });

  it("never leaks one user's sessions to another", async () => {
    const ctxA = ctxFor(db, "alice");
    const ctxB = ctxFor(db, "bob");
    const a = await call("start", ctxA, { lensId: "kingdoms", title: "Alice only" });

    assert.equal((await call("list_mine", ctxA, {})).total, 1);
    assert.equal((await call("list_mine", ctxB, {})).total, 0);
    assert.equal((await call("search", ctxB, {})).total, 0);
    // bob cannot read or mutate alice's session
    assert.equal((await call("get", ctxB, { sessionId: a.session.id })).reason, "not_found");
    assert.equal((await call("advance", ctxB, { sessionId: a.session.id, toStep: "x" })).reason, "not_found");
    assert.equal((await call("close", ctxB, { sessionId: a.session.id, outcome: "completed" })).reason, "not_found");
    // alice's session is untouched
    assert.equal((await call("get", ctxA, { sessionId: a.session.id })).session.status, "open");
  });

  it("rejects anonymous callers on every macro with no_user", async () => {
    const anon = { db, actor: {} };
    for (const m of [
      "start", "advance", "update_state", "get", "list_mine", "close",
      "search", "pause", "resume", "rename", "annotate", "stale", "bulk_close",
    ]) {
      const r = await call(m, anon, {});
      assert.equal(r.ok, false, `sessions.${m} leaked to anon`);
      assert.equal(r.reason, "no_user", `sessions.${m} should reject anon`);
    }
  });
});

describe("sessions — fail-CLOSED numeric guards (assassin V2)", () => {
  let db, call, ctxA;
  beforeEach(() => { ({ db, call } = setup()); ctxA = ctxFor(db, "alice"); });

  it("rejects poisoned limit/eventLimit/idleDays instead of clamping to ok:true", async () => {
    const s = await call("start", ctxA, { lensId: "kingdoms" });
    for (const bad of [NaN, Infinity, -1, 1e308, "abc"]) {
      assert.equal((await call("list_mine", ctxA, { limit: bad })).reason, "invalid_limit", `list_mine limit=${bad}`);
      assert.equal((await call("search", ctxA, { limit: bad })).reason, "invalid_limit", `search limit=${bad}`);
      assert.equal((await call("get", ctxA, { sessionId: s.session.id, eventLimit: bad })).reason, "invalid_eventLimit", `get eventLimit=${bad}`);
      assert.equal((await call("stale", ctxA, { idleDays: bad })).reason, "invalid_idleDays", `stale idleDays=${bad}`);
      assert.equal((await call("bulk_close", ctxA, { outcome: "completed", scope: "stale", idleDays: bad })).reason, "invalid_idleDays", `bulk_close idleDays=${bad}`);
    }
  });

  it("still honours a valid limit", async () => {
    for (let i = 0; i < 5; i++) await call("start", ctxA, { lensId: "kingdoms", title: `T${i}` });
    const r = await call("list_mine", ctxA, { limit: 2 });
    assert.equal(r.ok, true);
    assert.equal(r.sessions.length, 2);
  });
});
