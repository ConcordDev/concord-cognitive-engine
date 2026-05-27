// Contract test for the romance-engine Phase II Wave 25 substrate.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import {
  courtInteraction, getCourtship, listMyCourtships,
  propose, wed, dissolveMarriage, listMyMarriages,
  conceive, birthChild, listChildren, advanceChildMaturity,
  selectHeir, ROMANCE_CONSTANTS,
} from "../lib/romance-engine.js";
import registerRomanceMacros from "../domains/romance.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, input = {}) {
  const fn = ACTIONS.get(`romance.${name}`);
  assert.ok(fn, `romance.${name} not registered`);
  return fn(ctx, input);
}

let db;
before(() => { registerRomanceMacros(register); });

beforeEach(() => {
  db = new Database(":memory:");
  db.exec(`
    CREATE TABLE player_courtship (
      player_user_id TEXT NOT NULL,
      partner_kind TEXT NOT NULL,
      partner_id TEXT NOT NULL,
      affinity REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'acquainted',
      started_at INTEGER NOT NULL DEFAULT (unixepoch()),
      last_interaction INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (player_user_id, partner_kind, partner_id)
    );
    CREATE TABLE player_marriages (
      id TEXT PRIMARY KEY,
      player_user_id TEXT NOT NULL,
      partner_kind TEXT NOT NULL,
      partner_id TEXT NOT NULL,
      married_at INTEGER NOT NULL DEFAULT (unixepoch()),
      dissolved_at INTEGER,
      dissolved_reason TEXT
    );
    CREATE UNIQUE INDEX idx_player_marriages_active
      ON player_marriages (player_user_id, partner_kind, partner_id) WHERE dissolved_at IS NULL;
    CREATE TABLE player_pregnancies (
      id TEXT PRIMARY KEY,
      carrier_user_id TEXT NOT NULL,
      partner_kind TEXT NOT NULL,
      partner_id TEXT NOT NULL,
      conceived_at INTEGER NOT NULL DEFAULT (unixepoch()),
      due_at INTEGER NOT NULL,
      born_at INTEGER,
      complications_json TEXT NOT NULL DEFAULT '[]'
    );
    CREATE TABLE player_children (
      id TEXT PRIMARY KEY,
      parent_user_id TEXT NOT NULL,
      other_parent_kind TEXT NOT NULL,
      other_parent_id TEXT,
      name TEXT NOT NULL,
      born_at INTEGER NOT NULL DEFAULT (unixepoch()),
      age_days INTEGER NOT NULL DEFAULT 0,
      maturity TEXT NOT NULL DEFAULT 'infant',
      inherited_skills_json TEXT NOT NULL DEFAULT '{}',
      personality_json TEXT NOT NULL DEFAULT '{}'
    );
  `);
});

const ctxAlice = () => ({ actor: { userId: "alice" }, userId: "alice", db });

function pumpAffinity(playerId, target, iters) {
  for (let i = 0; i < iters; i++) {
    courtInteraction(db, playerId, "npc", target, 1);
  }
}

describe("romance-engine library", () => {
  it("courtInteraction creates an acquainted row + accumulates affinity", () => {
    const r = courtInteraction(db, "alice", "npc", "bob", 1);
    assert.equal(r.ok, true);
    assert.equal(r.status, "acquainted");
    const c = getCourtship(db, "alice", "npc", "bob");
    assert.ok(c.affinity > 0);
  });

  it("auto-promotes to courting at affinity > 0.30", () => {
    pumpAffinity("alice", "bob", 8);
    const c = getCourtship(db, "alice", "npc", "bob");
    assert.equal(c.status, "courting");
  });

  it("propose requires affinity > 0.70", () => {
    pumpAffinity("alice", "bob", 5);
    const fail = propose(db, "alice", "npc", "bob");
    assert.equal(fail.ok, false);
    pumpAffinity("alice", "bob", 20);
    const ok = propose(db, "alice", "npc", "bob");
    assert.equal(ok.ok, true);
    assert.equal(getCourtship(db, "alice", "npc", "bob").status, "engaged");
  });

  it("wed transitions engaged → married and creates a marriage row", () => {
    pumpAffinity("alice", "bob", 25);
    propose(db, "alice", "npc", "bob");
    const w = wed(db, "alice", "npc", "bob");
    assert.equal(w.ok, true);
    const marriages = listMyMarriages(db, "alice");
    assert.equal(marriages.length, 1);
    assert.equal(marriages[0].partner_id, "bob");
  });

  it("wed rejects if not engaged", () => {
    pumpAffinity("alice", "bob", 25);
    const r = wed(db, "alice", "npc", "bob");
    assert.equal(r.ok, false);
    assert.equal(r.reason, "not_engaged");
  });

  it("dissolveMarriage updates status to widowed/estranged", () => {
    pumpAffinity("alice", "bob", 25);
    propose(db, "alice", "npc", "bob");
    const w = wed(db, "alice", "npc", "bob");
    const d = dissolveMarriage(db, w.marriageId, "widowed");
    assert.equal(d.ok, true);
    assert.equal(d.courtStatus, "widowed");
    assert.equal(getCourtship(db, "alice", "npc", "bob").status, "widowed");
  });

  it("conceive requires active marriage", () => {
    const fail = conceive(db, "alice", "npc", "bob");
    assert.equal(fail.ok, false);
    assert.equal(fail.reason, "must_be_married_to_conceive");

    pumpAffinity("alice", "bob", 25);
    propose(db, "alice", "npc", "bob");
    wed(db, "alice", "npc", "bob");
    const ok = conceive(db, "alice", "npc", "bob");
    assert.equal(ok.ok, true);
    assert.ok(ok.dueAt > Math.floor(Date.now() / 1000));
  });

  it("conceive blocks a second pregnancy until birth", () => {
    pumpAffinity("alice", "bob", 25);
    propose(db, "alice", "npc", "bob");
    wed(db, "alice", "npc", "bob");
    conceive(db, "alice", "npc", "bob");
    const second = conceive(db, "alice", "npc", "bob");
    assert.equal(second.ok, false);
    assert.equal(second.reason, "already_pregnant");
  });

  it("birthChild creates a child row + inherits parent skills at 80%", () => {
    pumpAffinity("alice", "bob", 25);
    propose(db, "alice", "npc", "bob");
    wed(db, "alice", "npc", "bob");
    const p = conceive(db, "alice", "npc", "bob");
    const b = birthChild(db, p.pregnancyId, {
      name: "Aria",
      parentSkills: { alice: { swords: 100, crafting: 50 }, bob: { swords: 60, music: 80 } },
    });
    assert.equal(b.ok, true);
    assert.equal(b.name, "Aria");
    assert.equal(b.inheritedSkills.swords, 80);   // 100 × 0.80
    assert.equal(b.inheritedSkills.music, 64);    // 80 × 0.80
    assert.equal(b.inheritedSkills.crafting, 40); // 50 × 0.80
    const children = listChildren(db, "alice");
    assert.equal(children.length, 1);
  });

  it("advanceChildMaturity transitions infant → adult by age", () => {
    pumpAffinity("alice", "bob", 25);
    propose(db, "alice", "npc", "bob");
    wed(db, "alice", "npc", "bob");
    const p = conceive(db, "alice", "npc", "bob");
    const b = birthChild(db, p.pregnancyId, { name: "Aria" });
    // Backdate the child's birth by 200 days (> ADULT_DAYS=180)
    db.prepare("UPDATE player_children SET born_at = ? WHERE id = ?")
      .run(Math.floor(Date.now() / 1000) - 200 * 86400, b.childId);
    const adv = advanceChildMaturity(db, b.childId);
    assert.equal(adv.maturity, "adult");
  });

  it("selectHeir picks the adult child first", () => {
    pumpAffinity("alice", "bob", 25);
    propose(db, "alice", "npc", "bob");
    wed(db, "alice", "npc", "bob");
    // Insert two children manually with distinct ages
    const now = Math.floor(Date.now() / 1000);
    db.prepare(`INSERT INTO player_children (id, parent_user_id, other_parent_kind, other_parent_id, name, born_at, age_days, maturity)
      VALUES ('c1','alice','npc','bob','Older', ?, 200, 'adult')`).run(now - 200 * 86400);
    db.prepare(`INSERT INTO player_children (id, parent_user_id, other_parent_kind, other_parent_id, name, born_at, age_days, maturity)
      VALUES ('c2','alice','npc','bob','Young', ?, 5, 'infant')`).run(now - 5 * 86400);
    const heir = selectHeir(db, "alice");
    assert.equal(heir.id, "c1");
  });

  it("listMyCourtships filters by status", () => {
    pumpAffinity("alice", "bob", 10);
    pumpAffinity("alice", "carol", 25);
    propose(db, "alice", "npc", "carol");
    const courting = listMyCourtships(db, "alice", "courting");
    const engaged  = listMyCourtships(db, "alice", "engaged");
    assert.equal(courting.length, 1);
    assert.equal(engaged.length, 1);
  });

  it("constants exposed", () => {
    assert.ok(ROMANCE_CONSTANTS.MARRY_THRESHOLD > ROMANCE_CONSTANTS.ENGAGE_THRESHOLD);
  });
});

describe("romance domain macros", () => {
  it("rejects no_user / no_db", async () => {
    let r = await call("court", { actor: { userId: null }, userId: null }, { partnerId: "x" });
    assert.equal(r.ok, false);
    r = await call("court", { actor: { userId: "u" }, userId: "u" }, { partnerId: "x" });
    assert.equal(r.ok, false);
  });

  it("end-to-end court → propose → wed → conceive → birth → children", async () => {
    // 25 calls to court to push affinity past MARRY_THRESHOLD
    for (let i = 0; i < 25; i++) await call("court", ctxAlice(), { partnerId: "bob" });
    const p = await call("propose", ctxAlice(), { partnerId: "bob" });
    assert.equal(p.ok, true);
    const w = await call("wed", ctxAlice(), { partnerId: "bob" });
    assert.equal(w.ok, true);
    const c = await call("conceive", ctxAlice(), { partnerId: "bob" });
    assert.equal(c.ok, true);
    const b = await call("birth", ctxAlice(), { pregnancyId: c.pregnancyId, name: "Aria" });
    assert.equal(b.ok, true);
    const kids = await call("children", ctxAlice());
    assert.equal(kids.children.length, 1);
  });

  it("select_heir macro uses ctx user when no deceasedUserId given", async () => {
    db.prepare(`INSERT INTO player_children (id, parent_user_id, other_parent_kind, other_parent_id, name, born_at, age_days, maturity)
      VALUES ('h1','alice','npc','bob','HeirOne', ?, 200, 'adult')`).run(Math.floor(Date.now() / 1000) - 200 * 86400);
    const r = await call("select_heir", ctxAlice(), {});
    assert.equal(r.ok, true);
    assert.equal(r.heir.id, "h1");
  });
});
