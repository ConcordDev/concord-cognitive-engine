// Hermetic lifecycle tests for server/domains/crisis.js — the operational
// crisis surface backing the crisis-ops lens.
//
// LIGHTWEIGHT + HERMETIC: a real better-sqlite3 :memory: DB with ONLY the
// world_crises table the macros touch (the exact schema from migration 046 +
// the resolved_at column migration 298 adds). NO server boot. Drives each
// macro the way runMacro would — a (ctx, input) call with a real db + actor —
// and asserts ACTUAL values + multi-step round-trips, not shapes:
//
//   • declare → active_for_player surfaces the new crisis (real INSERT round-trip)
//   • declare → resolve → active_for_player no longer surfaces it (lifecycle)
//   • log_event → timeline shows the entry (in-memory store round-trip)
//   • assign → team → unassign roster lifecycle (incident_commander singularity)
//   • playbook returns the REAL typed steps + playbook_step toggles completion
//   • triage ranks by computed score; alerts escalates + acknowledge clears it
//   • resource_upsert → resources totals → resource_deploy availability math
//   • fail-CLOSED numeric guards reject NaN/Infinity/over-cap
//
// Run: node --test tests/crisis-ops-lifecycle.test.js

import { describe, it, before, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import registerCrisisMacros from "../domains/crisis.js";

// ---- local register harness ------------------------------------------------
const ACTIONS = new Map();
function register(domain, name, fn) {
  assert.equal(domain, "crisis", `unexpected domain: ${domain}`);
  ACTIONS.set(name, fn);
}
function call(name, ctx, input = {}) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`crisis.${name} not registered`);
  return fn(ctx, input);
}

// ---- minimal hermetic DB: only world_crises (migration 046 + 298 column) ----
function bootDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE world_crises (
      id               TEXT PRIMARY KEY,
      type             TEXT NOT NULL,
      description      TEXT,
      origin_world_id  TEXT,
      started_at       INTEGER,
      ends_at          INTEGER,
      status           TEXT DEFAULT 'active',
      resolved_by      TEXT,
      outcome          TEXT,
      resolved_at      INTEGER
    );
  `);
  return db;
}

const WORLD = "w_test";
const ctxFor = (db, userId = "op_1") => ({ db, actor: { userId }, userId });

before(() => { registerCrisisMacros(register); });

let db;
beforeEach(() => {
  db = bootDb();
  // fresh per-user in-memory stores each test
  globalThis._concordSTATE = {};
  // disable network so crisis.map exercises its graceful-degrade path
  globalThis.fetch = async () => { throw new Error("network disabled in tests"); };
});
afterEach(() => { try { db.close(); } catch { /* noop */ } });

describe("crisis — registration", () => {
  it("registers every macro the crisis-ops lens calls", () => {
    for (const m of [
      "active_for_player", "resolve", "declare", "map", "triage",
      "playbook", "playbook_step", "assign", "team", "unassign",
      "log_event", "timeline", "alerts", "acknowledge_alert",
      "resources", "resource_upsert", "resource_deploy",
    ]) {
      assert.equal(typeof ACTIONS.get(m), "function", `missing crisis.${m}`);
    }
  });
});

describe("crisis — declare → active_for_player → resolve lifecycle (real DB)", () => {
  it("declares a crisis that then surfaces in active_for_player, then disappears on resolve", async () => {
    const ctx = ctxFor(db);

    // nothing active yet
    let active = await call("active_for_player", ctx, { worldId: WORLD });
    assert.equal(active.ok, true);
    assert.equal(active.crises.length, 0);

    // declare a real civilization-level crisis (delegates to triggerCrisis → real INSERT)
    const dec = await call("declare", ctx, { type: "faction_war", worldId: WORLD });
    assert.equal(dec.ok, true, JSON.stringify(dec));
    const crisisId = dec.result.crisisId;
    assert.equal(typeof crisisId, "string");
    assert.equal(dec.result.type, "faction_war");

    // it is now in the DB and surfaces to the player
    const row = db.prepare("SELECT id, type, resolved_at FROM world_crises WHERE id = ?").get(crisisId);
    assert.equal(row.type, "faction_war");
    assert.equal(row.resolved_at, null);

    active = await call("active_for_player", ctx, { worldId: WORLD });
    assert.equal(active.crises.length, 1);
    assert.equal(active.crises[0].id, crisisId);

    // resolve it — stamps resolved_at + resolved_by, echoed back
    const res = await call("resolve", ctx, { crisisId });
    assert.equal(res.ok, true);
    assert.equal(res.crisisId, crisisId);
    assert.equal(res.resolvedBy, "op_1");
    const after = db.prepare("SELECT resolved_at, resolved_by FROM world_crises WHERE id = ?").get(crisisId);
    assert.ok(after.resolved_at > 0);
    assert.equal(after.resolved_by, "op_1");

    // no longer active
    active = await call("active_for_player", ctx, { worldId: WORLD });
    assert.equal(active.crises.length, 0);

    // double-resolve is rejected (UPDATE matched 0 rows)
    const again = await call("resolve", ctx, { crisisId });
    assert.equal(again.ok, false);
    assert.equal(again.reason, "not_found_or_already_resolved");
  });

  it("rejects an unknown crisis type + a missing world id without touching the DB", async () => {
    const ctx = ctxFor(db);
    const bad = await call("declare", ctx, { type: "godzilla", worldId: WORLD });
    assert.equal(bad.ok, false);
    assert.equal(bad.reason, "unknown_crisis_type");
    assert.equal(db.prepare("SELECT COUNT(*) c FROM world_crises").get().c, 0);

    const noWorld = await call("active_for_player", ctx, {});
    assert.equal(noWorld.ok, false);
    assert.equal(noWorld.reason, "missing_world_id");
  });

  it("declines a duplicate active crisis of the same type (lib idempotency guard)", async () => {
    const ctx = ctxFor(db);
    const first = await call("declare", ctx, { type: "dark_world", worldId: WORLD });
    assert.equal(first.ok, true);
    const dup = await call("declare", ctx, { type: "dark_world", worldId: WORLD });
    assert.equal(dup.ok, false);
    assert.equal(db.prepare("SELECT COUNT(*) c FROM world_crises WHERE type='dark_world'").get().c, 1);
  });
});

describe("crisis — log_event → timeline round-trip (real values)", () => {
  it("appends events and reads them back in chronological order, with a DB-seeded head", async () => {
    const ctx = ctxFor(db);
    const dec = await call("declare", ctx, { type: "emergent_uprising", worldId: WORLD });
    const crisisId = dec.result.crisisId;

    const e1 = await call("log_event", ctx, { crisisId, kind: "update", note: "Shelter opened" });
    assert.equal(e1.ok, true);
    const e2 = await call("log_event", ctx, { crisisId, kind: "update", note: "Roads cleared" });
    assert.equal(e2.ok, true);

    const tl = await call("timeline", ctx, { crisisId });
    assert.equal(tl.ok, true);
    // includes the DB-seeded 'started' head + the declare-seeded entry + 2 logged
    const notes = tl.result.events.map((x) => x.note);
    assert.ok(notes.includes("Shelter opened"));
    assert.ok(notes.includes("Roads cleared"));
    assert.ok(tl.result.events.some((x) => x.kind === "started"));
    // chronological
    for (let i = 1; i < tl.result.events.length; i++) {
      assert.ok(tl.result.events[i].at >= tl.result.events[i - 1].at);
    }

    // missing note is rejected
    const bad = await call("log_event", ctx, { crisisId });
    assert.equal(bad.ok, false);
    assert.equal(bad.error, "missing_crisis_or_note");
  });
});

describe("crisis — assign → team → unassign roster lifecycle", () => {
  it("assigns responders, enforces single incident_commander, then unassigns", async () => {
    const ctx = ctxFor(db);
    const crisisId = "cr_roster";

    const a1 = await call("assign", ctx, { crisisId, responder: "Maya", role: "incident_commander" });
    assert.equal(a1.ok, true);
    assert.equal(a1.result.entry.role, "incident_commander");

    // a second IC demotes the first to operations_chief
    const a2 = await call("assign", ctx, { crisisId, responder: "Lee", role: "incident_commander" });
    assert.equal(a2.ok, true);

    const team = await call("team", ctx, { crisisId });
    assert.equal(team.ok, true);
    assert.equal(team.result.count, 2);
    assert.equal(team.result.byRole.incident_commander.length, 1, "only one IC");
    assert.equal(team.result.byRole.incident_commander[0].responder, "Lee");
    assert.equal(team.result.byRole.operations_chief.length, 1);

    // an unknown role coerces to 'responder'
    const a3 = await call("assign", ctx, { crisisId, responder: "Sam", role: "wizard" });
    assert.equal(a3.result.entry.role, "responder");

    // unassign Lee → roster shrinks
    const un = await call("unassign", ctx, { crisisId, entryId: a2.result.entry.id });
    assert.equal(un.ok, true);
    assert.equal(un.result.teamSize, 2);

    const bad = await call("assign", ctx, { crisisId, role: "responder" });
    assert.equal(bad.ok, false);
    assert.equal(bad.error, "missing_crisis_or_responder");
  });
});

describe("crisis — playbook returns real typed steps + playbook_step toggles", () => {
  it("returns the wildfire checklist and tracks per-user completion", async () => {
    const ctx = ctxFor(db);
    const crisisId = "cr_fire";

    const pb = await call("playbook", ctx, { crisisType: "wildfire", crisisId });
    assert.equal(pb.ok, true);
    assert.equal(pb.result.playbookKey, "wildfire");
    assert.equal(pb.result.title, "Wildfire Response");
    assert.ok(pb.result.steps.length >= 6);
    assert.equal(pb.result.steps[0].label, "Map fire perimeter and wind vector");
    assert.equal(pb.result.completed, 0);

    // toggle step_0 done
    const toggled = await call("playbook_step", ctx, { crisisId, stepId: "step_0", done: true });
    assert.equal(toggled.ok, true);
    assert.equal(toggled.result.done, true);
    assert.equal(toggled.result.completed, 1);

    // re-read reflects completion
    const pb2 = await call("playbook", ctx, { crisisType: "wildfire", crisisId });
    assert.equal(pb2.result.steps[0].done, true);
    assert.equal(pb2.result.completed, 1);
    assert.ok(pb2.result.progressPct > 0);

    // unknown type → default playbook
    const generic = await call("playbook", ctx, { crisisType: "alien_invasion", crisisId: "cr_x" });
    assert.equal(generic.result.playbookKey, "default");
  });
});

describe("crisis — triage ranks by score; alerts escalate + acknowledge", () => {
  it("ranks an earthquake above a stale storm and surfaces an escalated alert", async () => {
    const ctx = ctxFor(db);
    // earthquake (high weight, fresh) vs storm declared via direct row (old)
    await call("declare", ctx, { type: "knowledge_extinction", worldId: WORLD });
    // direct-insert a fresh + an old crisis to control triage scoring
    const now = Math.floor(Date.now() / 1000);
    db.prepare(`INSERT INTO world_crises (id,type,description,origin_world_id,started_at,ends_at,status) VALUES ('cq','earthquake','quake','${WORLD}',?,?, 'active')`).run(now - 60, now + 86400);
    db.prepare(`INSERT INTO world_crises (id,type,description,origin_world_id,started_at,ends_at,status) VALUES ('cs','storm','storm','${WORLD}',?,?, 'active')`).run(now - 3600 * 40, now + 86400);

    const tri = await call("triage", ctx, { worldId: WORLD });
    assert.equal(tri.ok, true);
    assert.ok(tri.result.total >= 2);
    // ranked descending by score
    for (let i = 1; i < tri.result.ranked.length; i++) {
      assert.ok(tri.result.ranked[i - 1].triage.score >= tri.result.ranked[i].triage.score);
    }
    // earthquake outranks the stale storm
    const eq = tri.result.ranked.find((r) => r.id === "cq");
    const st = tri.result.ranked.find((r) => r.id === "cs");
    assert.ok(eq.triage.score > st.triage.score);

    // alerts surfaces escalated crises; acknowledge clears the unacked count
    const al = await call("alerts", ctx, { worldId: WORLD, sinceMs: 0 });
    assert.equal(al.ok, true);
    assert.ok(al.result.alerts.length >= 1);
    const escalated = al.result.alerts.find((a) => a.escalated);
    assert.ok(escalated, "expected at least one escalated alert");
    const beforeUnack = al.result.unacknowledged;
    const ack = await call("acknowledge_alert", ctx, { alertId: escalated.alertId });
    assert.equal(ack.ok, true);
    const al2 = await call("alerts", ctx, { worldId: WORLD, sinceMs: 0 });
    assert.ok(al2.result.unacknowledged < beforeUnack);
  });

  it("triage rejects a missing world id (NOT no_db) on a live db", async () => {
    const r = await call("triage", ctxFor(db), {});
    assert.equal(r.ok, false);
    assert.equal(r.error, "missing_world_id");
    assert.notEqual(r.error, "no_db");
  });
});

describe("crisis — resource inventory + deploy availability math", () => {
  it("upserts, lists totals, deploys, and recomputes available", async () => {
    const ctx = ctxFor(db);
    const u = await call("resource_upsert", ctx, { name: "Rescue boat", category: "vehicles", quantity: 4, unit: "boats" });
    assert.equal(u.ok, true);
    const resId = u.result.resource.id;
    assert.equal(u.result.resource.quantity, 4);
    assert.equal(u.result.resource.deployed, 0);

    let list = await call("resources", ctx, {});
    assert.equal(list.ok, true);
    assert.equal(list.result.totals.total, 4);
    assert.equal(list.result.totals.available, 4);

    // deploy 3 → available 1
    const dep = await call("resource_deploy", ctx, { resourceId: resId, crisisId: "cr_x", amount: 3 });
    assert.equal(dep.ok, true);
    assert.equal(dep.result.available, 1);

    // can't deploy more than available
    const over = await call("resource_deploy", ctx, { resourceId: resId, amount: 5 });
    assert.equal(over.ok, false);
    assert.equal(over.error, "insufficient_available");

    // recall 1 → available 2
    const recall = await call("resource_deploy", ctx, { resourceId: resId, amount: -1 });
    assert.equal(recall.ok, true);
    assert.equal(recall.result.available, 2);

    list = await call("resources", ctx, {});
    assert.equal(list.result.totals.deployed, 2);
  });
});

describe("crisis — fail-CLOSED numeric guards (assassin V2 parity)", () => {
  it("rejects poisoned numerics instead of letting them through", async () => {
    const ctx = ctxFor(db);
    // resource_upsert.quantity
    const q = await call("resource_upsert", ctx, { name: "x", quantity: Infinity });
    assert.equal(q.ok, false);
    assert.equal(q.error, "bad_numeric_field");
    assert.equal(q.field, "quantity");

    // resource_deploy.amount (magnitude over cap)
    const u = await call("resource_upsert", ctx, { name: "y", quantity: 5 });
    const d = await call("resource_deploy", ctx, { resourceId: u.result.resource.id, amount: 1e308 });
    assert.equal(d.ok, false);
    assert.equal(d.error, "bad_numeric_field");

    // alerts.sinceMs
    const a = await call("alerts", ctx, { worldId: WORLD, sinceMs: NaN });
    assert.equal(a.ok, false);
    assert.equal(a.reason, "bad_numeric_field");
  });
});

describe("crisis — map degrades gracefully with no network", () => {
  it("returns ok with an incidents array even when both feeds fail", async () => {
    const r = await call("map", ctxFor(db), {});
    assert.equal(r.ok, true);
    assert.ok(Array.isArray(r.result.incidents));
    assert.equal(typeof r.result.count, "number");
  });
});
