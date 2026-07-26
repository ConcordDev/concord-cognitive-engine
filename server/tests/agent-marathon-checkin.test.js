// server/tests/agent-marathon-checkin.test.js
//
// Periodic check-in nudge for long-running marathon sessions
// (server/lib/agent-marathon.js#maybeFireMarathonCheckIn).
//
// Gap this closes: initiative-engine.js's TRIGGER_TYPES already lists
// "check_in" but nothing in the codebase ever inserted one — a marathon
// could run for days past a completion/block signal with no "here's
// where things stand" nudge. This is a SEPARATE mechanism from the
// existing Sprint-13 terminal-status hooks (which fire on
// completed/paused/revoked/failed only): it fires (at most once EVER per
// session) once a still-`running` session crosses a wall-clock age
// threshold.
//
// Idempotency is the load-bearing contract under test: it must be
// impossible to fire twice for the same session, whether called directly
// back-to-back, or through repeated tickMarathon calls simulating time
// advancing past the threshold.
//
// Run: node --test server/tests/agent-marathon-checkin.test.js

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { up as upMig029 } from "../migrations/029_initiative.js";
import { up as upMig171 } from "../migrations/171_agent_marathon_sessions.js";
import { up as upMig379 } from "../migrations/379_agent_marathon_governance.js";
import {
  startMarathon, tickMarathon, getMarathon,
  maybeFireMarathonCheckIn, MARATHON_CHECKIN_AGE_S,
} from "../lib/agent-marathon.js";

function setup() {
  const db = new Database(":memory:");
  upMig171(db);
  upMig379(db);
  upMig029(db);
  return db;
}

function backdateSession(db, sessionId, ageSeconds) {
  const createdAt = Math.floor(Date.now() / 1000) - ageSeconds;
  db.prepare(`UPDATE agent_marathon_sessions SET created_at = ? WHERE id = ?`).run(createdAt, sessionId);
}

function checkinRowsFor(db, sessionId) {
  return db.prepare(`
    SELECT * FROM initiatives
    WHERE trigger_type = 'check_in' AND json_extract(metadata_json, '$.sessionId') = ?
  `).all(sessionId);
}

function noopHarvest(real) {
  return async (domain, name, input, ctx) => {
    if (domain === "chat" && name === "harvest") return { ok: true, dtus: [] };
    return real(domain, name, input, ctx);
  };
}

function scriptedBrain(responses) {
  return async () => {
    const text = responses.shift() ?? "still working.";
    return { ok: true, text, provider: "test", model: "test", tokensIn: 1, tokensOut: 1 };
  };
}

describe("maybeFireMarathonCheckIn — direct unit tests", () => {
  let db;
  beforeEach(() => { db = setup(); });
  afterEach(() => { db.close(); });

  it("does not fire below the age threshold", () => {
    const { sessionId } = startMarathon(db, "alice", { goal: "goal" });
    const session = getMarathon(db, sessionId);
    const r = maybeFireMarathonCheckIn(db, session, 3);
    assert.equal(r.fired, false);
    assert.equal(r.reason, "below_threshold");
    assert.equal(checkinRowsFor(db, sessionId).length, 0);
  });

  it("fires exactly once when past the threshold", () => {
    const { sessionId } = startMarathon(db, "alice", { goal: "goal", title: "Long Task" });
    backdateSession(db, sessionId, MARATHON_CHECKIN_AGE_S + 60);
    const session = getMarathon(db, sessionId);

    const r1 = maybeFireMarathonCheckIn(db, session, 10);
    assert.equal(r1.fired, true);
    const rows = checkinRowsFor(db, sessionId);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].user_id, "alice");
    assert.equal(rows[0].status, "pending");
    assert.match(rows[0].message, /Long Task|check-in/i);
    assert.deepEqual(JSON.parse(rows[0].metadata_json).sessionId, sessionId);
  });

  it("never fires twice for the same session — repeated calls are a no-op", () => {
    const { sessionId } = startMarathon(db, "alice", { goal: "goal" });
    backdateSession(db, sessionId, MARATHON_CHECKIN_AGE_S + 100);
    const session = getMarathon(db, sessionId);

    const r1 = maybeFireMarathonCheckIn(db, session, 10);
    const r2 = maybeFireMarathonCheckIn(db, session, 15);
    const r3 = maybeFireMarathonCheckIn(db, session, 20);
    assert.equal(r1.fired, true);
    assert.equal(r2.fired, false);
    assert.equal(r2.reason, "already_fired");
    assert.equal(r3.fired, false);
    assert.equal(checkinRowsFor(db, sessionId).length, 1, "must never insert more than one check-in row per session");
  });

  it("is scoped per-session — a second session gets its own independent check-in", () => {
    const { sessionId: s1 } = startMarathon(db, "alice", { goal: "goal one" });
    const { sessionId: s2 } = startMarathon(db, "alice", { goal: "goal two" });
    backdateSession(db, s1, MARATHON_CHECKIN_AGE_S + 10);
    backdateSession(db, s2, MARATHON_CHECKIN_AGE_S + 10);

    maybeFireMarathonCheckIn(db, getMarathon(db, s1), 5);
    maybeFireMarathonCheckIn(db, getMarathon(db, s2), 5);

    assert.equal(checkinRowsFor(db, s1).length, 1);
    assert.equal(checkinRowsFor(db, s2).length, 1);
  });

  it("never throws on missing inputs or a missing initiatives table", () => {
    const bareDb = new Database(":memory:");
    upMig171(bareDb);
    upMig379(bareDb);
    const { sessionId } = startMarathon(bareDb, "alice", { goal: "goal" });
    backdateSession(bareDb, sessionId, MARATHON_CHECKIN_AGE_S + 10);
    const session = getMarathon(bareDb, sessionId);
    assert.doesNotThrow(() => {
      const r = maybeFireMarathonCheckIn(bareDb, session, 1);
      assert.equal(r.fired, false);
      assert.equal(r.reason, "initiatives_table_missing");
    });
    bareDb.close();

    assert.doesNotThrow(() => {
      const r = maybeFireMarathonCheckIn(null, null, 1);
      assert.equal(r.fired, false);
    });
  });
});

describe("tickMarathon integration — check-in fires through the real tick path, never spams", () => {
  let db;
  beforeEach(() => { db = setup(); });
  afterEach(() => { db.close(); });

  it("a still-running session past the threshold gets exactly one check-in across repeated ticks", async () => {
    const { sessionId } = startMarathon(db, "alice", { goal: "do the long thing" });
    backdateSession(db, sessionId, MARATHON_CHECKIN_AGE_S + 500);

    const runMacro = noopHarvest(async () => ({ ok: true, result: {} }));
    const brain = scriptedBrain(["still working on it, no markers here."]);

    const r1 = await tickMarathon({ db, sessionId, runMacro, lensActions: new Map(), opts: { brainChat: brain, tickTurns: 2 } });
    assert.equal(r1.ok, true);
    assert.equal(r1.status, "running");
    assert.equal(checkinRowsFor(db, sessionId).length, 1, "first tick past threshold should fire the check-in");

    // Simulate time continuing to advance / the heartbeat ticking again —
    // must NOT insert a second row.
    const brain2 = scriptedBrain(["continuing, still no markers."]);
    const r2 = await tickMarathon({ db, sessionId, runMacro, lensActions: new Map(), opts: { brainChat: brain2, tickTurns: 2 } });
    assert.equal(r2.ok, true);
    assert.equal(r2.status, "running");
    assert.equal(checkinRowsFor(db, sessionId).length, 1, "a later tick of the same still-running session must never re-fire");

    const brain3 = scriptedBrain(["and again, still going."]);
    await tickMarathon({ db, sessionId, runMacro, lensActions: new Map(), opts: { brainChat: brain3, tickTurns: 2 } });
    assert.equal(checkinRowsFor(db, sessionId).length, 1, "a third tick still must not spam a second check-in");
  });

  it("a fresh (below-threshold) running session gets no check-in yet", async () => {
    const { sessionId } = startMarathon(db, "alice", { goal: "do a quick thing" });
    const runMacro = noopHarvest(async () => ({ ok: true, result: {} }));
    const brain = scriptedBrain(["working on it."]);

    const r = await tickMarathon({ db, sessionId, runMacro, lensActions: new Map(), opts: { brainChat: brain, tickTurns: 2 } });
    assert.equal(r.ok, true);
    assert.equal(r.status, "running");
    assert.equal(checkinRowsFor(db, sessionId).length, 0);
  });

  it("a tick that completes the session does not ALSO fire a check-in nudge", async () => {
    const { sessionId } = startMarathon(db, "alice", { goal: "finish fast" });
    backdateSession(db, sessionId, MARATHON_CHECKIN_AGE_S + 10);
    const runMacro = noopHarvest(async () => ({ ok: true, result: {} }));
    const brain = scriptedBrain(["All done. [TASK_COMPLETE]"]);

    const r = await tickMarathon({ db, sessionId, runMacro, lensActions: new Map(), opts: { brainChat: brain, tickTurns: 2 } });
    assert.equal(r.ok, true);
    assert.equal(r.status, "completed");
    assert.equal(checkinRowsFor(db, sessionId).length, 0, "terminal-status hooks and the check-in nudge are mutually exclusive by nextStatus branch");

    // The terminal-status hook still fired its own (different trigger_type) row.
    const terminalRows = db.prepare(`SELECT * FROM initiatives WHERE user_id = 'alice'`).all();
    assert.ok(terminalRows.some((r2) => r2.trigger_type === "pending_work"));
  });
});
