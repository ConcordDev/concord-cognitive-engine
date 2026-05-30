/**
 * Living Society — Phase 10: law, crime & jail-as-a-verb.
 *
 *   - a crime in a sanctuary is REFUSED (prevention, no effect/record);
 *   - in a lawful zone it raises wanted + opens a detention with a sentence;
 *   - in a lawless zone nothing happens;
 *   - sentence math = severity × zone × repeat, capped;
 *   - each jail verb works (bribe / work-off / break-out / sprung).
 *
 * Run: node --test tests/law.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { up as up288 } from "../migrations/288_law.js";
import {
  assessCrime, sentenceFor, commitCrime,
  bribeOut, workOff, breakOut, sprungBy, LAW_CONSTANTS,
} from "../lib/law.js";

const W = "w1", U = "u1";
function mkDb() {
  const db = new Database(":memory:");
  up288(db);
  db.exec(`CREATE TABLE world_npcs (id TEXT PRIMARY KEY, wealth_sparks REAL DEFAULT 0);`);
  return db;
}

describe("Phase 10 — assessment + prevention", () => {
  it("a sanctuary crime is REFUSED (prevention, not punishment)", () => {
    const a = assessCrime("murder", "sanctuary");
    assert.equal(a.isCrime, true);
    assert.equal(a.prevented, true);
    assert.equal(a.mode, "prevention");
  });
  it("a lawless zone imposes nothing (theft is a crime, but unenforced here)", () => {
    // theft applies in lawless too → exercises the zone-weight-0 branch.
    const a = assessCrime("theft", "lawless", { theft: { severityTier: 2, appliesIn: ["lawful", "lawless"] } });
    assert.equal(a.isCrime, false);
    assert.equal(a.reason, "lawless_zone");
    // murder simply isn't enforced in a lawless vacuum either way
    assert.equal(assessCrime("murder", "lawless").isCrime, false);
  });
  it("a lawful zone is reaction", () => {
    assert.equal(assessCrime("theft", "lawful").mode, "reaction");
  });
});

describe("Phase 10 — sentencing (capped, repeat-weighted)", () => {
  it("scales with severity × zone × repeat but never exceeds the cap", () => {
    const s1 = sentenceFor(2, "lawful", 0);
    const s2 = sentenceFor(2, "lawful", 3);
    assert.ok(s2.bailSparks > s1.bailSparks, "repeat raises the penalty");
    const huge = sentenceFor(5, "sanctuary", 5);
    assert.ok(huge.bailSparks <= LAW_CONSTANTS.SENTENCE_CAP, "capped");
  });
});

describe("Phase 10 — commit", () => {
  it("a sanctuary crime leaves no record", () => {
    const db = mkDb();
    const r = commitCrime(db, { userId: U, worldId: W, crime: "murder", zoneLawfulness: "sanctuary" });
    assert.equal(r.outcome, "refused");
    assert.equal(db.prepare(`SELECT COUNT(*) n FROM player_detentions`).get().n, 0);
  });
  it("a lawful crime raises wanted + opens a detention", () => {
    const db = mkDb();
    const r = commitCrime(db, { userId: U, worldId: W, crime: "burglary", zoneLawfulness: "lawful" });
    assert.equal(r.outcome, "detained");
    assert.ok(r.wanted.wanted_level > 0);
    assert.equal(db.prepare(`SELECT state FROM player_detentions WHERE id=?`).get(r.detentionId).state, "detained");
  });
});

describe("Phase 10 — jail is four verbs", () => {
  function detain(db) {
    return commitCrime(db, { userId: U, worldId: W, crime: "burglary", zoneLawfulness: "lawful" }).detentionId;
  }
  it("bribe out → corruption credits the dirty guard", () => {
    const db = mkDb();
    db.prepare(`INSERT INTO world_npcs (id, wealth_sparks) VALUES ('guard', 0)`).run();
    const id = detain(db);
    const r = bribeOut(db, id, { guardNpcId: "guard" });
    assert.equal(r.via, "bribe");
    assert.ok(db.prepare(`SELECT wealth_sparks FROM world_npcs WHERE id='guard'`).get().wealth_sparks > 0);
    assert.equal(db.prepare(`SELECT state FROM player_detentions WHERE id=?`).get(id).state, "bribed_out");
  });
  it("work off frees you after the labor is done", () => {
    const db = mkDb();
    const id = detain(db);
    let r = workOff(db, id, 1);
    while (!r.released) r = workOff(db, id, 1);
    assert.equal(r.via, "labor");
    assert.equal(db.prepare(`SELECT state FROM player_detentions WHERE id=?`).get(id).state, "worked_off");
  });
  it("break out (combat) + sprung (ally) both release", () => {
    const db = mkDb();
    const id1 = detain(db);
    assert.equal(breakOut(db, id1, { success: true }).released, true);
    const id2 = detain(db);
    assert.equal(sprungBy(db, id2, "fantasy_ally").released, true);
    assert.equal(db.prepare(`SELECT released_via FROM player_detentions WHERE id=?`).get(id2).released_via, "ally:fantasy_ally");
  });
});
