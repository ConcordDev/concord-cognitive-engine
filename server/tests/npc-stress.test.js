/**
 * Tier-2 contract tests for Sprint C / Track A1 — NPC stress + coping trait.
 *
 * Pins:
 *   - bumpStress accrues correctly per eventKind
 *   - mental break at 80+ locks coping_trait deterministically
 *   - coping_trait persists for COPING_DAYS then clears
 *   - decayStress drifts toward 30 baseline
 *   - copingMoveBias / copingTraitLine helpers
 *
 * Run: node --test tests/npc-stress.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import {
  bumpStress,
  decayStress,
  getStress,
  copingMoveBias,
  copingTraitLine,
  STRESS_CONSTANTS,
} from "../lib/npc-stress.js";
import { up as up152 } from "../migrations/152_npc_stress.js";

function setupDb() {
  const db = new Database(":memory:");
  up152(db);
  return db;
}

describe("Sprint C / A1 — bumpStress accrual", () => {
  it("creates a baseline row on first call and bumps by event delta", () => {
    const db = setupDb();
    const r = bumpStress(db, "npc-1", "grudge_severe");
    assert.equal(r.ok, true);
    assert.equal(r.stress, 35); // 30 baseline + 5 delta
    const row = getStress(db, "npc-1");
    assert.equal(row.stress, 35);
    assert.equal(row.coping_trait, null);
  });

  it("noop on unknown event kind", () => {
    const db = setupDb();
    const r = bumpStress(db, "npc-1", "definitely_not_real");
    assert.equal(r.action, "noop");
  });

  it("respects magnitude override", () => {
    const db = setupDb();
    const r = bumpStress(db, "npc-1", "custom_event", 25);
    assert.equal(r.stress, 55);
  });

  it("clamps to 0..100", () => {
    const db = setupDb();
    bumpStress(db, "npc-1", "custom_event", 200);
    assert.equal(getStress(db, "npc-1").stress, 100);
    bumpStress(db, "npc-1", "custom_event", -300);
    assert.equal(getStress(db, "npc-1").stress, 0);
  });
});

describe("Sprint C / A1 — mental break + coping_trait", () => {
  it("locks a coping_trait when stress crosses BREAK_THRESHOLD", () => {
    const db = setupDb();
    bumpStress(db, "npc-2", "custom_event", 49); // 79
    let row = getStress(db, "npc-2");
    assert.equal(row.stress, 79);
    assert.equal(row.coping_trait, null);

    const r = bumpStress(db, "npc-2", "grudge_severe"); // +5 → 84 → break
    assert.equal(r.broke, true);
    assert.ok(STRESS_CONSTANTS.COPING_TRAITS.includes(r.copingTrait));
    row = getStress(db, "npc-2");
    assert.equal(row.coping_trait, r.copingTrait);
    assert.ok(row.coping_until > Math.floor(Date.now() / 1000));
  });

  it("does not re-lock while existing coping_trait window is active", () => {
    const db = setupDb();
    bumpStress(db, "npc-3", "custom_event", 90); // breaks
    const first = getStress(db, "npc-3");
    bumpStress(db, "npc-3", "grudge_severe"); // already in coping
    const second = getStress(db, "npc-3");
    assert.equal(second.coping_trait, first.coping_trait);
    assert.equal(second.coping_until, first.coping_until);
  });
});

describe("Sprint C / A1 — decayStress", () => {
  it("drifts stress 1/day toward baseline", () => {
    const db = setupDb();
    bumpStress(db, "npc-4", "custom_event", 50); // 80 → break + coping
    // Backdate last_decay_at by >24h
    db.prepare(`UPDATE npc_stress SET last_decay_at = unixepoch() - 86500 WHERE npc_id = ?`).run("npc-4");
    const before = getStress(db, "npc-4").stress;
    decayStress(db);
    const after = getStress(db, "npc-4").stress;
    assert.equal(after, before - 1);
  });

  it("expires coping_trait when coping_until < now", () => {
    const db = setupDb();
    bumpStress(db, "npc-5", "custom_event", 60); // break
    db.prepare(`UPDATE npc_stress SET coping_until = unixepoch() - 1 WHERE npc_id = ?`).run("npc-5");
    decayStress(db);
    const row = getStress(db, "npc-5");
    assert.equal(row.coping_trait, null);
    assert.equal(row.coping_until, null);
  });
});

describe("Sprint C / A1 — coping bias helpers", () => {
  it("copingMoveBias returns trait-specific delta map", () => {
    const paranoid = copingMoveBias("paranoid");
    assert.ok(paranoid.RAID > 0);
    assert.ok(paranoid.SEEK_TRUCE < 0);
    const reckless = copingMoveBias("reckless");
    assert.ok(reckless.EXPAND > 0);
    const none = copingMoveBias(null);
    assert.deepEqual(none, {});
  });

  it("copingTraitLine returns a string per active trait, null when expired", () => {
    const now = Math.floor(Date.now() / 1000);
    assert.equal(typeof copingTraitLine({ coping_trait: "drink", coping_until: now + 1000 }), "string");
    assert.equal(copingTraitLine({ coping_trait: "drink", coping_until: now - 1 }), null);
    assert.equal(copingTraitLine({ coping_trait: null }), null);
  });
});
