// INC-35 — crisis roster authorization, existence checks, and actor-id redaction.
//
// Repro (2026-10-11, two signed-in accounts via POST /api/lens/run):
//   A assigns onto a crisis id, B reads the roster and timeline and sees A's
//   raw user id, B logs onto any crisis id, B unassigns A's entry.
//
// This file drives the macros the way those calls do (ctx + input), on a
// hermetic world_crises table. Anonymous 401 at /api/lens/run is unchanged
// and is not re-tested here.
//
// Removal rule (see mayUnassign in server/domains/crisis.js):
//   the assigner of that entry, OR the account that appointed the current
//   incident_commander, OR the account that declared the crisis.

import { describe, it, before, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import registerCrisisMacros from "../domains/crisis.js";

const ACTIONS = new Map();
function register(domain, name, fn) {
  assert.equal(domain, "crisis");
  ACTIONS.set(name, fn);
}
function call(name, ctx, input = {}) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`crisis.${name} not registered`);
  return fn(ctx, input);
}

const USER_A = "496291b0-7c3a-4e1d-9f20-deadbeef0001";
const USER_B = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const USER_C = "cccccccc-dddd-eeee-ffff-000000000001";

function bootDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE world_crises (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      description TEXT,
      origin_world_id TEXT,
      started_at INTEGER,
      ends_at INTEGER,
      status TEXT DEFAULT 'active',
      resolved_by TEXT,
      outcome TEXT,
      resolved_at INTEGER
    );
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      username TEXT,
      email TEXT,
      password_hash TEXT,
      created_at TEXT,
      display_name TEXT
    );
  `);
  const ins = db.prepare(`INSERT INTO users (id, username, email, password_hash, created_at, display_name) VALUES (?, ?, ?, 'x', datetime('now'), ?)`);
  ins.run(USER_A, "ada-handle", "a@crisis.test", "Ada Lovelace");
  ins.run(USER_B, "grace-handle", "b@crisis.test", "Grace Hopper");
  ins.run(USER_C, "chris-handle", "c@crisis.test", "Chris");
  return db;
}

function ctxFor(db, userId) {
  return { db, actor: { userId }, userId };
}

function insertCrisis(db, id = "r59-watchdog-test-crisis") {
  const now = Math.floor(Date.now() / 1000);
  db.prepare(`INSERT INTO world_crises (id, type, description, origin_world_id, started_at, ends_at, status)
    VALUES (?, 'flood', 'watchdog', 'concordia-hub', ?, ?, 'active')`).run(id, now, now + 86400);
  return id;
}

function assertNoRawIds(value, ids) {
  const blob = JSON.stringify(value);
  for (const id of ids) {
    assert.equal(blob.includes(id), false, `raw id leaked: ${id}`);
  }
}

before(() => { registerCrisisMacros(register); });

let db;
beforeEach(() => {
  db = bootDb();
  globalThis._concordSTATE = {};
});
afterEach(() => { try { db.close(); } catch { /* noop */ } });

describe("INC-35 crisis roster authz", () => {
  it("walks the six repro steps: redacted reads, shared log on a real crisis, foreign unassign refused, missing crisis refused", async () => {
    const ctxA = ctxFor(db, USER_A);
    const ctxB = ctxFor(db, USER_B);
    const missingId = "r59-no-such-crisis";

    const ghostAssign = await call("assign", ctxA, {
      crisisId: missingId, responder: "r59 watchdog-test responder", role: "logistics_chief",
    });
    assert.equal(ghostAssign.ok, false);
    assert.equal(ghostAssign.error, "crisis_not_found");
    assert.equal(ghostAssign.result, undefined);

    const ghostLog = await call("log_event", ctxB, { crisisId: missingId, note: "intrusion" });
    assert.equal(ghostLog.ok, false);
    assert.equal(ghostLog.error, "crisis_not_found");

    const ghostUn = await call("unassign", ctxB, { crisisId: missingId, entryId: "nope" });
    assert.equal(ghostUn.ok, false);
    assert.equal(ghostUn.error, "crisis_not_found");
    assert.notEqual(ghostUn.result?.removed, true);

    const crisisId = insertCrisis(db);
    const assigned = await call("assign", ctxA, {
      crisisId, responder: "r59 watchdog-test responder", role: "logistics_chief",
    });
    assert.equal(assigned.ok, true);
    assert.equal(assigned.result.entry.role, "logistics_chief");
    assert.equal(assigned.result.entry.assignedByName, "Ada Lovelace");
    assert.equal(assigned.result.entry.assignedByIsMe, true);
    assert.equal(Object.hasOwn(assigned.result.entry, "assignedBy"), false);
    assertNoRawIds(assigned, [USER_A, USER_B]);

    const teamB = await call("team", ctxB, { crisisId });
    assert.equal(teamB.ok, true);
    assert.equal(teamB.result.count, 1);
    const row = teamB.result.team[0];
    assert.equal(row.responder, "r59 watchdog-test responder");
    assert.equal(row.assignedByName, "Ada Lovelace");
    assert.equal(row.assignedByIsMe, false);
    assert.equal(row.canUnassign, false);
    assert.equal(Object.hasOwn(row, "assignedBy"), false);
    assertNoRawIds(teamB, [USER_A, USER_B]);

    const tlB = await call("timeline", ctxB, { crisisId });
    assert.equal(tlB.ok, true);
    const assignment = tlB.result.events.find((e) => e.kind === "assignment");
    assert.ok(assignment);
    assert.equal(assignment.byName, "Ada Lovelace");
    assert.equal(assignment.byIsMe, false);
    assert.equal(Object.hasOwn(assignment, "by"), false);
    assert.equal(Object.hasOwn(assignment, "authority"), false);
    assertNoRawIds(tlB, [USER_A, USER_B]);

    const logged = await call("log_event", ctxB, { crisisId, note: "B status on a real crisis" });
    assert.equal(logged.ok, true);
    assert.equal(logged.result.entry.byName, "Grace Hopper");
    assert.equal(logged.result.entry.byIsMe, true);
    assert.equal(Object.hasOwn(logged.result.entry, "by"), false);
    assertNoRawIds(logged, [USER_A, USER_B]);

    const tlA = await call("timeline", ctxA, { crisisId });
    const fromB = tlA.result.events.find((e) => e.note === "B status on a real crisis");
    assert.ok(fromB);
    assert.equal(fromB.byName, "Grace Hopper");
    assert.equal(fromB.byIsMe, false);
    assertNoRawIds(tlA, [USER_A, USER_B]);

    const stolen = await call("unassign", ctxB, { crisisId, entryId: assigned.result.entry.id });
    assert.equal(stolen.ok, false);
    assert.equal(stolen.error, "not_authorized");
    assert.equal(stolen.result, undefined);
    assert.notEqual(stolen.result?.removed, true);
    const still = await call("team", ctxA, { crisisId });
    assert.equal(still.result.count, 1);
    assert.equal(still.result.team[0].id, assigned.result.entry.id);

    const forged = await call("log_event", ctxB, { crisisId, kind: "started", note: "I declare this" });
    assert.equal(forged.ok, true);
    const stillStolen = await call("unassign", ctxB, { crisisId, entryId: assigned.result.entry.id });
    assert.equal(stillStolen.ok, false);
    assert.equal(stillStolen.error, "not_authorized");
    assert.equal((await call("team", ctxA, { crisisId })).result.count, 1);
  });

  it("the assigner can unassign their own entry", async () => {
    const ctxA = ctxFor(db, USER_A);
    const crisisId = insertCrisis(db, "cr-owner");
    const assigned = await call("assign", ctxA, { crisisId, responder: "Ada", role: "responder" });
    const un = await call("unassign", ctxA, { crisisId, entryId: assigned.result.entry.id });
    assert.equal(un.ok, true);
    assert.equal(un.result.removed, true);
    assert.equal(un.result.teamSize, 0);
    assert.equal((await call("team", ctxA, { crisisId })).result.count, 0);
  });

  it("the account that appointed the incident commander can remove someone else's entry; a third player cannot", async () => {
    const ctxA = ctxFor(db, USER_A);
    const ctxB = ctxFor(db, USER_B);
    const ctxC = ctxFor(db, USER_C);
    const crisisId = insertCrisis(db, "cr-ic");
    await call("assign", ctxA, { crisisId, responder: "Maya", role: "incident_commander" });
    const logistics = await call("assign", ctxB, { crisisId, responder: "Lee", role: "logistics_chief" });
    const entryId = logistics.result.entry.id;

    const stranger = await call("unassign", ctxC, { crisisId, entryId });
    assert.equal(stranger.ok, false);
    assert.equal(stranger.error, "not_authorized");
    assert.equal((await call("team", ctxC, { crisisId })).result.count, 2);

    const byIc = await call("unassign", ctxA, { crisisId, entryId });
    assert.equal(byIc.ok, true);
    assert.equal(byIc.result.removed, true);
    const left = await call("team", ctxA, { crisisId });
    assert.equal(left.result.team.some((m) => m.responder === "Lee"), false);
    assert.equal(left.result.team.some((m) => m.role === "incident_commander"), true);
    assertNoRawIds(left, [USER_A, USER_B, USER_C]);
  });

  it("the declarer can remove an entry they did not assign", async () => {
    const ctxA = ctxFor(db, USER_A);
    const ctxB = ctxFor(db, USER_B);
    const declared = await call("declare", ctxA, { type: "faction_war", worldId: "concordia-hub" });
    assert.equal(declared.ok, true, JSON.stringify(declared));
    const crisisId = declared.result.crisisId;
    const assigned = await call("assign", ctxB, { crisisId, responder: "Sam", role: "planning_chief" });
    assert.equal(assigned.ok, true);

    const byDeclarer = await call("unassign", ctxA, { crisisId, entryId: assigned.result.entry.id });
    assert.equal(byDeclarer.ok, true);
    assert.equal(byDeclarer.result.removed, true);
    assert.equal((await call("team", ctxB, { crisisId })).result.count, 0);

    const tl = await call("timeline", ctxB, { crisisId });
    assert.equal(tl.result.events.some((e) => e.authority), false);
    assertNoRawIds(tl, [USER_A, USER_B]);
  });

  it("a username that is only the raw user id is not echoed", async () => {
    db.prepare(`UPDATE users SET username = ?, display_name = NULL WHERE id = ?`).run(USER_A, USER_A);
    const ctxA = ctxFor(db, USER_A);
    const ctxB = ctxFor(db, USER_B);
    const crisisId = insertCrisis(db, "cr-idname");
    const assigned = await call("assign", ctxA, { crisisId, responder: "Ada", role: "responder" });
    assert.equal(assigned.result.entry.assignedByName, null);
    assert.equal(assigned.result.entry.assignedByIsMe, true);
    const seen = await call("team", ctxB, { crisisId });
    assert.equal(seen.result.team[0].assignedByName, null);
    assert.equal(seen.result.team[0].assignedByIsMe, false);
    assertNoRawIds(seen, [USER_A]);
  });

  it("a missing roster entry is entry_not_found and does not report removed", async () => {
    const ctxA = ctxFor(db, USER_A);
    const crisisId = insertCrisis(db, "cr-missing-entry");
    const un = await call("unassign", ctxA, { crisisId, entryId: "00000000-0000-0000-0000-000000000000" });
    assert.equal(un.ok, false);
    assert.equal(un.error, "entry_not_found");
    assert.notEqual(un.result?.removed, true);
  });

  it("unassign without an actor is refused", async () => {
    const un = await call("unassign", { db, actor: {} }, { crisisId: "cr", entryId: "e" });
    assert.equal(un.ok, false);
    assert.equal(un.error, "no_actor");
  });
});
