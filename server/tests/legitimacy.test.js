// Temperament P6 contract — Graham 3-factor rubric + the legitimacy ledger.

import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { up } from "../migrations/319_legitimacy_events.js";
import { scoreEncounter, recordLegitimacyEvent, legitimacyStanding } from "../lib/legitimacy.js";

function withTemp(on, fn) {
  const prev = process.env.CONCORD_TEMPERAMENT;
  process.env.CONCORD_TEMPERAMENT = on ? "1" : "0";
  try { return fn(); } finally { if (prev === undefined) delete process.env.CONCORD_TEMPERAMENT; else process.env.CONCORD_TEMPERAMENT = prev; }
}
function db0() { const db = new Database(":memory:"); up(db); return db; }

test("lethal force against a real immediate threat (warned) is legitimate", () => {
  const r = scoreEncounter({ crimeSeverity: 0.9, immediateThreat: 1, activeResistance: 1, forceUsed: "lethal", warned: true });
  assert.equal(r.verdict, "legitimate");
  assert.equal(r.score, 1);
  assert.equal(r.justifiedCeiling, "lethal");
});

test("lethal force on a no-threat, non-resisting subject is UNLAWFUL", () => {
  const r = scoreEncounter({ crimeSeverity: 0, immediateThreat: 0, activeResistance: 0, forceUsed: "lethal", warned: true });
  assert.equal(r.verdict, "unlawful");
  assert.ok(r.score < 0.5);
  assert.equal(r.justifiedCeiling, "none");
});

test("lethal force without a warning (no overriding immediate threat) is excessive", () => {
  const r = scoreEncounter({ crimeSeverity: 0.6, immediateThreat: 0.6, activeResistance: 0.6, forceUsed: "lethal", warned: false });
  assert.equal(r.verdict, "excessive");
  assert.ok(r.reasons.includes("lethal_without_warning"));
});

test("nonlethal force on a resisting subject is legitimate", () => {
  const r = scoreEncounter({ crimeSeverity: 0.5, immediateThreat: 0.2, activeResistance: 0.8, forceUsed: "nonlethal" });
  assert.equal(r.verdict, "legitimate");
  assert.equal(r.justifiedCeiling, "nonlethal");
});

test("immediate threat is weighted highest in the Graham aggregate", () => {
  const threat = scoreEncounter({ immediateThreat: 1, forceUsed: "none" }).graham;
  const resist = scoreEncounter({ activeResistance: 1, forceUsed: "none" }).graham;
  const crime = scoreEncounter({ crimeSeverity: 1, forceUsed: "none" }).graham;
  assert.ok(threat > resist && resist > crime);
});

test("ledger: off → no write", () => {
  withTemp(false, () => {
    assert.equal(recordLegitimacyEvent(db0(), { kind: "execute_hors_de_combat" }).ok, false);
  });
});

test("ledger: execute_hors_de_combat records as unlawful; standing reflects it", () => {
  withTemp(true, () => {
    const db = db0();
    recordLegitimacyEvent(db, { actorId: "p1", npcId: "n1", kind: "execute_hors_de_combat", combatState: "surrendered" });
    recordLegitimacyEvent(db, { actorId: "p1", npcId: "n2", kind: "use_of_force", factors: { immediateThreat: 1, activeResistance: 1, forceUsed: "lethal", warned: true } });
    const s = legitimacyStanding(db, "p1");
    assert.equal(s.events, 2);
    assert.equal(s.unlawfulRate, 0.5);
    assert.ok(s.meanScore > 0 && s.meanScore < 1);
  });
});

test("standing is graceful for an unknown actor", () => {
  withTemp(true, () => {
    const s = legitimacyStanding(db0(), "nobody");
    assert.equal(s.events, 0);
    assert.equal(s.meanScore, 1);
  });
});
