// server/tests/wave-b-affect-gates.test.js
//
// Wave B / B3 — affect-behavior gates. Pure functions over an affect
// state E with v/a/c/g/t/f in [-1, +1]. Plus the npc-routines override
// integration: grief/fear flip getActiveRoutine to a `rest` block.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import {
  shouldSkipRoutine, canAcceptQuest, pickSkillBias, dialogueToneOverride,
  classifyMood, GATE_THRESHOLDS,
} from "../lib/affect-behavior-gates.js";
import { getActiveRoutine } from "../lib/npc-routines.js";

const calm = { v: 0.2, a: 0.0, c: 0.4, g: 0.5, t: 0.4, f: 0.5 };
// Grief that's not despair: low v, low a, but calmness and groundedness above 0.
const griefState = { v: -0.5, a: 0.05, c: 0.1, g: 0.1, t: 0.0, f: 0.2 };
// Fear: low v, high a, but slightly-better calmness than rage.
const fearState  = { v: -0.4, a: 0.6,  c: 0.1, g: 0.1, t: 0.0, f: 0.4 };
// Despair: all three "down" signals.
const despair    = { v: -0.7, a: 0.0,  c: -0.2, g: -0.3, t: -0.2, f: 0.1 };
// Rage: mid-low v, high a, distinctly-low calmness.
const rage       = { v: 0.0,  a: 0.7,  c: -0.4, g: 0.0, t: -0.2, f: 0.4 };
const joy        = { v: 0.7,  a: 0.4,  c: 0.5,  g: 0.5, t: 0.6, f: 0.5 };

describe("shouldSkipRoutine", () => {
  it("calm state continues routine", () => {
    assert.equal(shouldSkipRoutine(calm), false);
  });
  it("grief skips routine", () => {
    assert.equal(shouldSkipRoutine(griefState), true);
  });
  it("fear skips routine", () => {
    assert.equal(shouldSkipRoutine(fearState), true);
  });
  it("joy does not skip", () => {
    assert.equal(shouldSkipRoutine(joy), false);
  });
  it("null safe", () => {
    assert.equal(shouldSkipRoutine(null), false);
  });
});

describe("canAcceptQuest", () => {
  it("despair refuses with mood grieving", () => {
    const r = canAcceptQuest(despair);
    assert.equal(r.allow, false);
    assert.equal(r.reason, "despair");
  });
  it("grief refuses with mood grieving", () => {
    const r = canAcceptQuest(griefState);
    assert.equal(r.allow, false);
    assert.equal(r.mood, "grieving");
  });
  it("fear refuses with mood fearful", () => {
    const r = canAcceptQuest(fearState);
    assert.equal(r.allow, false);
    assert.equal(r.mood, "fearful");
  });
  it("calm allows", () => {
    assert.equal(canAcceptQuest(calm).allow, true);
  });
});

describe("pickSkillBias", () => {
  it("rage biases offense", () => {
    const b = pickSkillBias(rage);
    assert.ok(b.offense > b.defense);
    assert.ok(b.offense > b.utility);
  });
  it("fear biases defense", () => {
    const b = pickSkillBias(fearState);
    assert.ok(b.defense > b.offense);
  });
  it("joy biases utility", () => {
    const b = pickSkillBias(joy);
    assert.ok(b.utility >= b.offense);
    assert.ok(b.utility >= b.defense);
  });
  it("calm balanced", () => {
    const b = pickSkillBias(calm);
    assert.ok(Math.abs(b.offense - b.defense) < 0.1);
  });
});

describe("dialogueToneOverride", () => {
  it("returns prose for grief", () => {
    assert.ok(dialogueToneOverride(griefState).includes("quiet"));
  });
  it("returns prose for despair", () => {
    assert.ok(dialogueToneOverride(despair).includes("hollow"));
  });
  it("empty string for calm", () => {
    assert.equal(dialogueToneOverride(calm), "");
  });
});

describe("classifyMood", () => {
  it("matches dialogue endpoint moods", () => {
    assert.equal(classifyMood(griefState), "grieving");
    assert.equal(classifyMood(fearState), "fearful");
    assert.equal(classifyMood(joy), "friendly");
    assert.equal(classifyMood(rage), "hostile");
    assert.equal(classifyMood(calm), "neutral");
  });
});

describe("GATE_THRESHOLDS export", () => {
  it("is frozen", () => {
    assert.ok(Object.isFrozen(GATE_THRESHOLDS));
  });
});

// ── npc-routines integration ──────────────────────────────────────────

describe("getActiveRoutine + affect override", () => {
  let db;
  before(() => {
    db = new Database(":memory:");
    db.exec(`
      CREATE TABLE npc_routine_state (
        npc_id TEXT PRIMARY KEY,
        block_idx INTEGER,
        activity_kind TEXT,
        location_kind TEXT
      );
      CREATE TABLE affect_state (
        entity_id TEXT PRIMARY KEY,
        world_id TEXT,
        v REAL DEFAULT 0, a REAL DEFAULT 0, s REAL DEFAULT 0,
        c REAL DEFAULT 0, g REAL DEFAULT 0, t REAL DEFAULT 0, f REAL DEFAULT 0,
        ts INTEGER, momentum_json TEXT
      );
    `);
    db.prepare(`INSERT INTO npc_routine_state (npc_id, block_idx, activity_kind, location_kind) VALUES
      ('npc_calm',  3, 'train', 'training_ground'),
      ('npc_griev', 3, 'train', 'training_ground'),
      ('npc_no',    3, 'train', 'training_ground')
    `).run();
    db.prepare(`INSERT INTO affect_state (entity_id, v, a, c, g, t, f) VALUES
      ('npc_calm',  0.2, 0.0, 0.4, 0.5, 0.4, 0.5),
      ('npc_griev', -0.5, 0.05, 0.1, 0.1, 0.0, 0.2)
    `).run();
  });
  after(() => { db?.close(); });

  it("calm NPC routine unchanged", () => {
    const r = getActiveRoutine(db, "npc_calm");
    assert.equal(r.activity_kind, "train");
    assert.ok(!r.affect_override);
  });

  it("grieving NPC routine overridden to rest", () => {
    const r = getActiveRoutine(db, "npc_griev");
    assert.equal(r.activity_kind, "rest");
    assert.equal(r.affect_override, true);
    assert.equal(r.affect_mood, "grieving");
  });

  it("NPC with no affect row falls through to baseline", () => {
    const r = getActiveRoutine(db, "npc_no");
    assert.equal(r.activity_kind, "train");
    assert.ok(!r.affect_override);
  });
});
