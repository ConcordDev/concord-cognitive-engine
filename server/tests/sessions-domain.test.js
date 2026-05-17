/**
 * Tier-2 contract test for the sessions domain (Phase 5 — multi-step
 * workflow sessions).
 *
 * Pins:
 *   - all 6 macros register
 *   - auth contract: anonymous callers always get reason:'no_user'
 *   - start → advance → update_state → get round-trip
 *   - state cap (1 MiB) enforced
 *   - deep-merge semantics for update_state
 *   - close transitions to completed/abandoned, blocks further mutation
 *   - list_mine filters by lensId + status
 *   - event ledger appends one row per transition
 *
 * Uses an in-memory better-sqlite3 with the real migration 195 schema.
 *
 * Run: node --test server/tests/sessions-domain.test.js
 */

import { describe, it, beforeEach } from "node:test";
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

describe("sessions domain registration", () => {
  it("registers all 6 macros", () => {
    const { registry } = setup();
    for (const name of ["start", "advance", "update_state", "get", "list_mine", "close"]) {
      assert.ok(registry.map.has(`sessions.${name}`), `missing sessions.${name}`);
    }
  });
});

describe("sessions auth gate", () => {
  it("every macro rejects anonymous callers", async () => {
    const { db, call } = setup();
    for (const name of ["start", "advance", "update_state", "get", "list_mine", "close"]) {
      const res = await call(name, ANON(db), { lensId: "kingdoms", sessionId: "x" });
      assert.equal(res.ok, false, `${name} should reject anon`);
      assert.equal(res.reason, "no_user");
    }
  });

  it("requires db on every macro", async () => {
    const { call } = setup();
    for (const name of ["start", "advance", "update_state", "get", "list_mine", "close"]) {
      const res = await call(name, { actor: { userId: "alice" } }, { lensId: "kingdoms", sessionId: "x" });
      assert.equal(res.ok, false);
      assert.equal(res.reason, "no_db");
    }
  });
});

describe("sessions.start", () => {
  it("creates a session and a 'started' event", async () => {
    const { db, call } = setup();
    const res = await call("start", AUTH(db), {
      lensId: "kingdoms",
      title: "Iron Crown campaign",
      initialStep: "plan",
      initialState: { ally: "Stormhold" },
    });
    assert.equal(res.ok, true);
    assert.equal(res.session.lensId, "kingdoms");
    assert.equal(res.session.currentStep, "plan");
    assert.deepEqual(res.session.state, { ally: "Stormhold" });
    assert.equal(res.session.stepCount, 0);
    assert.ok(res.session.id);

    const events = db.prepare("SELECT * FROM lens_session_events WHERE session_id = ?").all(res.session.id);
    assert.equal(events.length, 1);
    assert.equal(events[0].event_kind, "started");
  });

  it("rejects missing lensId", async () => {
    const { db, call } = setup();
    const res = await call("start", AUTH(db), {});
    assert.equal(res.ok, false);
    assert.equal(res.reason, "missing_lens_id");
  });

  it("rejects oversized state (>1 MiB)", async () => {
    const { db, call } = setup();
    const big = { blob: "x".repeat(1024 * 1024 + 100) };
    const res = await call("start", AUTH(db), { lensId: "kingdoms", initialState: big });
    assert.equal(res.ok, false);
    assert.equal(res.reason, "state_too_large");
  });
});

describe("sessions.advance", () => {
  it("transitions step and merges state", async () => {
    const { db, call } = setup();
    const startRes = await call("start", AUTH(db), { lensId: "kingdoms", initialStep: "plan", initialState: { phase: 1, troops: { archers: 50 } } });
    const id = startRes.session.id;

    const advRes = await call("advance", AUTH(db), {
      sessionId: id, toStep: "muster", note: "Allies confirmed",
      stateMerge: { phase: 2, troops: { cavalry: 20 } },
    });
    assert.equal(advRes.ok, true);
    assert.equal(advRes.session.currentStep, "muster");
    assert.equal(advRes.session.stepCount, 1);
    // Deep-merge: troops.archers preserved + cavalry added.
    assert.deepEqual(advRes.session.state, { phase: 2, troops: { archers: 50, cavalry: 20 } });

    const events = db.prepare("SELECT * FROM lens_session_events WHERE session_id = ? ORDER BY id").all(id);
    assert.equal(events.length, 2);
    assert.equal(events[1].event_kind, "advanced");
    assert.equal(events[1].from_step, "plan");
    assert.equal(events[1].to_step, "muster");
  });

  it("rejects advance on missing session", async () => {
    const { db, call } = setup();
    const res = await call("advance", AUTH(db), { sessionId: "nonexistent", toStep: "x" });
    assert.equal(res.ok, false);
    assert.equal(res.reason, "not_found");
  });

  it("rejects advance on session from another user", async () => {
    const { db, call } = setup();
    const start = await call("start", AUTH(db), { lensId: "kingdoms" });
    const bobCtx = { db, actor: { userId: "bob" } };
    const res = await call("advance", bobCtx, { sessionId: start.session.id, toStep: "muster" });
    assert.equal(res.ok, false);
    assert.equal(res.reason, "not_found");
  });

  it("rejects missing toStep", async () => {
    const { db, call } = setup();
    const start = await call("start", AUTH(db), { lensId: "kingdoms" });
    const res = await call("advance", AUTH(db), { sessionId: start.session.id });
    assert.equal(res.ok, false);
    assert.equal(res.reason, "missing_to_step");
  });
});

describe("sessions.update_state", () => {
  it("deep-merges patch and appends state_merged event", async () => {
    const { db, call } = setup();
    const start = await call("start", AUTH(db), { lensId: "kingdoms", initialState: { resources: { gold: 100, food: 50 } } });
    const id = start.session.id;

    const res = await call("update_state", AUTH(db), {
      sessionId: id,
      statePatch: { resources: { gold: 150 } },
    });
    assert.equal(res.ok, true);
    assert.deepEqual(res.state, { resources: { gold: 150, food: 50 } });

    const events = db.prepare("SELECT event_kind FROM lens_session_events WHERE session_id = ?").all(id);
    const kinds = events.map(e => e.event_kind);
    assert.ok(kinds.includes("state_merged"));
  });

  it("deletes keys via null in patch", async () => {
    const { db, call } = setup();
    const start = await call("start", AUTH(db), { lensId: "kingdoms", initialState: { a: 1, b: 2 } });
    const res = await call("update_state", AUTH(db), { sessionId: start.session.id, statePatch: { b: null } });
    assert.equal(res.ok, true);
    assert.deepEqual(res.state, { a: 1 });
  });

  it("rejects missing patch", async () => {
    const { db, call } = setup();
    const start = await call("start", AUTH(db), { lensId: "kingdoms" });
    const res = await call("update_state", AUTH(db), { sessionId: start.session.id });
    assert.equal(res.ok, false);
    assert.equal(res.reason, "missing_state_patch");
  });
});

describe("sessions.get + list_mine", () => {
  it("get returns session + events", async () => {
    const { db, call } = setup();
    const start = await call("start", AUTH(db), { lensId: "kingdoms", initialStep: "plan" });
    await call("advance", AUTH(db), { sessionId: start.session.id, toStep: "muster" });
    const res = await call("get", AUTH(db), { sessionId: start.session.id });
    assert.equal(res.ok, true);
    assert.equal(res.session.currentStep, "muster");
    assert.equal(res.events.length, 2);
    // Latest first.
    assert.equal(res.events[0].kind, "advanced");
    assert.equal(res.events[1].kind, "started");
  });

  it("list_mine returns my sessions filtered by status", async () => {
    const { db, call } = setup();
    const s1 = await call("start", AUTH(db), { lensId: "kingdoms" });
    const s2 = await call("start", AUTH(db), { lensId: "forge" });
    await call("close", AUTH(db), { sessionId: s2.session.id, outcome: "completed" });

    const all = await call("list_mine", AUTH(db), {});
    assert.equal(all.sessions.length, 2);

    const onlyOpen = await call("list_mine", AUTH(db), { status: "open" });
    assert.equal(onlyOpen.sessions.length, 1);
    assert.equal(onlyOpen.sessions[0].id, s1.session.id);

    const onlyForge = await call("list_mine", AUTH(db), { lensId: "forge" });
    assert.equal(onlyForge.sessions.length, 1);
    assert.equal(onlyForge.sessions[0].id, s2.session.id);
  });

  it("list_mine does not leak other users' sessions", async () => {
    const { db, call } = setup();
    await call("start", AUTH(db), { lensId: "kingdoms" });
    const bobCtx = { db, actor: { userId: "bob" } };
    const res = await call("list_mine", bobCtx, {});
    assert.equal(res.sessions.length, 0);
  });
});

describe("sessions.close", () => {
  it("transitions open → completed", async () => {
    const { db, call } = setup();
    const start = await call("start", AUTH(db), { lensId: "kingdoms" });
    const res = await call("close", AUTH(db), { sessionId: start.session.id, outcome: "completed" });
    assert.equal(res.ok, true);
    assert.equal(res.status, "completed");

    // Further advance is blocked.
    const adv = await call("advance", AUTH(db), { sessionId: start.session.id, toStep: "next" });
    assert.equal(adv.ok, false);
    assert.equal(adv.reason, "session_not_active");
  });

  it("rejects invalid outcome", async () => {
    const { db, call } = setup();
    const start = await call("start", AUTH(db), { lensId: "kingdoms" });
    const res = await call("close", AUTH(db), { sessionId: start.session.id, outcome: "lost" });
    assert.equal(res.ok, false);
    assert.equal(res.reason, "invalid_outcome");
  });

  it("rejects double-close", async () => {
    const { db, call } = setup();
    const start = await call("start", AUTH(db), { lensId: "kingdoms" });
    await call("close", AUTH(db), { sessionId: start.session.id, outcome: "completed" });
    const res = await call("close", AUTH(db), { sessionId: start.session.id, outcome: "abandoned" });
    assert.equal(res.ok, false);
    assert.equal(res.reason, "already_closed");
  });

  it("emits 'completed' event in the ledger", async () => {
    const { db, call } = setup();
    const start = await call("start", AUTH(db), { lensId: "kingdoms" });
    await call("close", AUTH(db), { sessionId: start.session.id, outcome: "completed", note: "victory" });
    const events = db.prepare("SELECT event_kind, note FROM lens_session_events WHERE session_id = ? ORDER BY id").all(start.session.id);
    assert.equal(events[1].event_kind, "completed");
    assert.equal(events[1].note, "victory");
  });
});
