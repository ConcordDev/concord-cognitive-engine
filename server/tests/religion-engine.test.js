// Contract test for the religion-engine Phase II Wave 24 substrate.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import {
  foundFaith, getFaith, listFaiths,
  join, leave,
  pray, sermon, convert,
  accuseHeresy, excommunicate,
  getWorshipper, listWorshippersForActor,
  tickFaiths, listRecentEvents,
  RELIGION_CONSTANTS,
} from "../lib/religion-engine.js";
import registerReligionMacros from "../domains/religion.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, input = {}) {
  const fn = ACTIONS.get(`religion.${name}`);
  assert.ok(fn, `religion.${name} not registered`);
  return fn(ctx, input);
}

let db;
before(() => { registerReligionMacros(register); });

beforeEach(() => {
  db = new Database(":memory:");
  db.exec(`
    CREATE TABLE faiths (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      doctrine_json TEXT NOT NULL DEFAULT '{}',
      founder_kind TEXT NOT NULL,
      founder_id TEXT,
      tenet_count INTEGER NOT NULL DEFAULT 0,
      total_worshippers INTEGER NOT NULL DEFAULT 0,
      founded_at INTEGER NOT NULL DEFAULT (unixepoch()),
      schism_parent_id TEXT
    );
    CREATE TABLE worshippers (
      faith_id TEXT NOT NULL,
      actor_kind TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      faith_strength REAL NOT NULL DEFAULT 0.1,
      joined_at INTEGER NOT NULL DEFAULT (unixepoch()),
      left_at INTEGER,
      role TEXT NOT NULL DEFAULT 'lay',
      PRIMARY KEY (faith_id, actor_kind, actor_id)
    );
    CREATE TABLE faith_events (
      id TEXT PRIMARY KEY,
      faith_id TEXT NOT NULL,
      actor_kind TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      event_kind TEXT NOT NULL,
      target_actor_id TEXT,
      payload_json TEXT NOT NULL DEFAULT '{}',
      ts INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `);
});

const ctxAlice = () => ({ actor: { userId: "user_alice" }, userId: "user_alice", db });

describe("religion-engine library", () => {
  it("foundFaith creates a row + adds founder as prophet", () => {
    const f = foundFaith(db, { actorKind: "player", actorId: "u1", name: "Path of Concord" });
    assert.equal(f.ok, true);
    const faith = getFaith(db, f.faithId);
    assert.equal(faith.name, "Path of Concord");
    assert.equal(faith.total_worshippers, 1);
    const w = getWorshipper(db, f.faithId, "player", "u1");
    assert.equal(w.role, "prophet");
    assert.equal(w.faith_strength, 0.9);
  });

  it("join + leave manage total_worshippers correctly", () => {
    const f = foundFaith(db, { actorKind: "player", actorId: "u1", name: "F" });
    join(db, f.faithId, "player", "u2");
    const faith = getFaith(db, f.faithId);
    assert.equal(faith.total_worshippers, 2);
    leave(db, f.faithId, "player", "u2");
    assert.equal(getFaith(db, f.faithId).total_worshippers, 1);
  });

  it("join is idempotent", () => {
    const f = foundFaith(db, { actorKind: "player", actorId: "u1", name: "F" });
    const j1 = join(db, f.faithId, "player", "u2");
    const j2 = join(db, f.faithId, "player", "u2");
    assert.equal(j1.ok, true);
    assert.equal(j2.alreadyJoined, true);
  });

  it("pray increments faith_strength and may advance role", () => {
    const f = foundFaith(db, { actorKind: "player", actorId: "u1", name: "F" });
    join(db, f.faithId, "player", "u2");
    const before = getWorshipper(db, f.faithId, "player", "u2");
    for (let i = 0; i < 5; i++) pray(db, f.faithId, "player", "u2");
    const after = getWorshipper(db, f.faithId, "player", "u2");
    assert.ok(after.faith_strength > before.faith_strength);
    assert.equal(after.role, "novice");
  });

  it("sermon rejects when preacher is too weak", () => {
    const f = foundFaith(db, { actorKind: "player", actorId: "u1", name: "F" });
    join(db, f.faithId, "player", "u2");
    const r = sermon(db, f.faithId, "player", "u2");
    assert.equal(r.ok, false);
    assert.equal(r.reason, "preacher_not_strong_enough");
  });

  it("sermon by prophet returns audienceSize + recruited", () => {
    const f = foundFaith(db, { actorKind: "player", actorId: "u1", name: "F" });
    const r = sermon(db, f.faithId, "player", "u1", { audienceSize: 10 });
    assert.equal(r.ok, true);
    assert.equal(r.audienceSize, 10);
    assert.ok(r.recruited >= 0);
  });

  it("convert by strong preacher joins target to faith + leaves prior", () => {
    const a = foundFaith(db, { actorKind: "player", actorId: "u1", name: "A" });
    const b = foundFaith(db, { actorKind: "player", actorId: "u2", name: "B" });
    join(db, a.faithId, "player", "target");
    const conv = convert(db, b.faithId, "player", "target", "player", "u2");
    assert.equal(conv.ok, true);
    assert.equal(conv.converted, true);
    assert.equal(conv.fromFaithCount, 1);
    const wB = getWorshipper(db, b.faithId, "player", "target");
    assert.ok(wB);
    const wA = getWorshipper(db, a.faithId, "player", "target");
    assert.equal(wA, null);
  });

  it("accuseHeresy marks target role as heretic", () => {
    const f = foundFaith(db, { actorKind: "player", actorId: "u1", name: "F" });
    join(db, f.faithId, "player", "u2");
    const r = accuseHeresy(db, f.faithId, "player", "u1", "player", "u2");
    assert.equal(r.ok, true);
    assert.equal(getWorshipper(db, f.faithId, "player", "u2").role, "heretic");
  });

  it("excommunicate by prophet removes target from worshippers", () => {
    const f = foundFaith(db, { actorKind: "player", actorId: "u1", name: "F" });
    join(db, f.faithId, "player", "u2");
    const r = excommunicate(db, f.faithId, "player", "u1", "player", "u2");
    assert.equal(r.ok, true);
    const w = db.prepare("SELECT * FROM worshippers WHERE actor_id = 'u2'").get();
    assert.ok(w.left_at);
  });

  it("excommunicate rejects non-priest", () => {
    const f = foundFaith(db, { actorKind: "player", actorId: "u1", name: "F" });
    join(db, f.faithId, "player", "u2");
    join(db, f.faithId, "player", "u3");
    const r = excommunicate(db, f.faithId, "player", "u2", "player", "u3");
    assert.equal(r.ok, false);
    assert.equal(r.reason, "council_not_authorised");
  });

  it("listFaiths sorts by total_worshippers DESC", () => {
    const a = foundFaith(db, { actorKind: "player", actorId: "u1", name: "Small" });
    const b = foundFaith(db, { actorKind: "player", actorId: "u2", name: "Big" });
    join(db, b.faithId, "player", "u3");
    join(db, b.faithId, "player", "u4");
    const list = listFaiths(db);
    assert.equal(list[0].name, "Big");
    void a;
  });

  it("listRecentEvents returns events DESC by ts", () => {
    const f = foundFaith(db, { actorKind: "player", actorId: "u1", name: "F" });
    pray(db, f.faithId, "player", "u1");
    pray(db, f.faithId, "player", "u1");
    const events = listRecentEvents(db, f.faithId);
    assert.ok(events.length >= 3); // founding + 2 prayers
  });

  it("tickFaiths decays lapsed worshippers", () => {
    const f = foundFaith(db, { actorKind: "player", actorId: "u1", name: "F" });
    join(db, f.faithId, "player", "u2");
    // u2 has no recent events → ticking should decay them
    db.prepare("UPDATE worshippers SET faith_strength = 0.5 WHERE actor_id = 'u2'").run();
    const r = tickFaiths(db);
    assert.equal(r.ok, true);
    assert.ok(r.lapsed >= 1);
    const w = getWorshipper(db, f.faithId, "player", "u2");
    assert.ok(w.faith_strength < 0.5);
  });

  it("constants exposed for UI", () => {
    assert.ok(RELIGION_CONSTANTS.FERVOR_STEP > 0);
    assert.ok(RELIGION_CONSTANTS.ROLE_THRESHOLDS.prophet === 0.85);
  });
});

describe("religion domain macros", () => {
  it("rejects no_user / no_db", async () => {
    let r = await call("found", { actor: { userId: null }, userId: null }, { name: "X" });
    assert.equal(r.ok, false);
    r = await call("found", { actor: { userId: "u" }, userId: "u" }, { name: "X" });
    assert.equal(r.ok, false);
  });

  it("end-to-end: found → list → pray → my_worship", async () => {
    const r = await call("found", ctxAlice(), { name: "Path", doctrine: { tenets: ["one","two"] } });
    assert.equal(r.ok, true);
    const list = await call("list", ctxAlice());
    assert.equal(list.faiths.length, 1);
    const prayed = await call("pray", ctxAlice(), { faithId: r.faithId });
    assert.equal(prayed.ok, true);
    const my = await call("my_worship", ctxAlice());
    assert.equal(my.worship.length, 1);
  });

  it("constants macro", async () => {
    const r = await call("constants", ctxAlice());
    assert.equal(r.ok, true);
    assert.ok(r.constants.FERVOR_STEP > 0);
  });
});
