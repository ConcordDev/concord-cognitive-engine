/**
 * DEAD-SUBSCRIPTION Class B — the four `system:*` System-window events.
 *
 * concord-frontend/components/world/SystemFeed.tsx (mounted in the world lens
 * at app/lenses/world/page.tsx:5751) has subscribed to four events since it
 * was written, and nothing server-side ever emitted any of them
 * (docs/DEAD_SUBSCRIPTION_AUDIT.md, Class B; found by
 * scripts/verify-client-event-contracts.mjs):
 *
 *   SystemFeed.tsx:77  system:level-up        reads  detail  ?? skill
 *   SystemFeed.tsx:78  system:skill-acquired  reads  name    ?? skill
 *   SystemFeed.tsx:79  system:skill-evolved   reads  name    ?? skill
 *   SystemFeed.tsx:86  system:notice          reads  title, detail
 *
 * This file pins the emit AND its exact field names — a wired emit whose
 * payload the listener can't read is a new contract bug, not a fix. It also
 * pins that each one is scoped to the acting user's own `user:<id>` room
 * (these are personal progression beats, never global broadcasts) and that a
 * missing realtime emitter can never break the underlying gameplay write.
 *
 * The emitter is injected via globalThis (the same best-effort hook the
 * production code reads) — no socket is opened.
 *
 * Run: node --test tests/system-feed-emits.test.js
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { up as up064 } from "../migrations/064_crafting_and_skills.js";
import { up as up126 } from "../migrations/126_skill_evolution.js";
import { gainSkillXP } from "../lib/skills/skill-engine.js";
import { composeDeterministicEvolution, applyEvolution } from "../lib/skill-evolution.js";
import { grantQuestRewards } from "../lib/quest-rewards.js";

// ── emitter spy ─────────────────────────────────────────────────────────────

let emitted;
let prevConcordEmit;
let prevRealtimeEmit;

function installSpy() {
  emitted = [];
  prevConcordEmit = globalThis._concordRealtimeEmit;
  prevRealtimeEmit = globalThis.realtimeEmit;
  const spy = (name, payload, opts) => emitted.push({ name, payload, opts });
  globalThis._concordRealtimeEmit = spy;
  globalThis.realtimeEmit = spy;
}

function restoreSpy() {
  globalThis._concordRealtimeEmit = prevConcordEmit;
  globalThis.realtimeEmit = prevRealtimeEmit;
}

function only(name) {
  return emitted.filter((e) => e.name === name);
}

/** The exact reader SystemFeed.tsx uses: strings and numbers, nothing else. */
function str(v) {
  return typeof v === "string" ? v : typeof v === "number" ? String(v) : undefined;
}

// ── system:level-up + system:skill-acquired (lib/skills/skill-engine.js) ─────

describe("skill-engine.gainSkillXP — system:skill-acquired + system:level-up", () => {
  let db;

  beforeEach(() => {
    db = new Database(":memory:");
    up064(db);
    installSpy();
  });

  afterEach(() => {
    restoreSpy();
    db.close();
  });

  it("emits system:skill-acquired the first time a user gains a skill, with the fields SystemFeed reads", () => {
    gainSkillXP(db, "u_acq", "magic", "fantasy", 10);

    const acquired = only("system:skill-acquired");
    assert.equal(acquired.length, 1, "exactly one acquisition beat");

    // SystemFeed.tsx:78 → push('power', 'POWER ACQUIRED', str(p.name) || str(p.skill))
    const p = acquired[0].payload;
    assert.equal(str(p.name), "magic");
    assert.equal(str(p.skill), "magic");
    assert.ok(str(p.name) || str(p.skill), "the detail line must be renderable");

    // Personal beat — scoped to the acquiring user's own room.
    assert.deepEqual(acquired[0].opts, { userId: "u_acq" });
  });

  it("does NOT re-emit system:skill-acquired for a skill the user already has", () => {
    gainSkillXP(db, "u_acq", "magic", "fantasy", 10);
    emitted = [];
    gainSkillXP(db, "u_acq", "magic", "fantasy", 10);
    assert.equal(only("system:skill-acquired").length, 0);
  });

  it("emits system:level-up only when a level actually lands, with a renderable detail", () => {
    // 99 XP is not a level (xp_to_next is 100 at level 1).
    gainSkillXP(db, "u_lvl", "combat", "military", 99);
    assert.equal(only("system:level-up").length, 0, "no level, no LEVEL UP window");

    emitted = [];
    const r = gainSkillXP(db, "u_lvl", "combat", "military", 1); // 99 + 1 = 100 → level 2
    assert.equal(r.leveled, true);
    assert.equal(r.newLevel, 2);

    const levelUps = only("system:level-up");
    assert.equal(levelUps.length, 1);

    // SystemFeed.tsx:77 → push('level', 'LEVEL UP', str(p.detail) || str(p.skill))
    const p = levelUps[0].payload;
    assert.equal(str(p.detail), "combat reached Lv 2");
    assert.equal(str(p.skill), "combat");
    assert.deepEqual(levelUps[0].opts, { userId: "u_lvl" });
  });

  it("still grants XP when no realtime emitter is installed", () => {
    globalThis._concordRealtimeEmit = undefined;
    globalThis.realtimeEmit = undefined;
    const r = gainSkillXP(db, "u_noemit", "stealth", "military", 100);
    assert.equal(r.leveled, true);
    assert.equal(r.newLevel, 2);
  });
});

// ── system:skill-evolved (lib/skill-evolution.js#applyEvolution) ─────────────

function evolutionDb() {
  const db = new Database(":memory:");
  up126(db);
  // Minimal `dtus` shape for the columns applyEvolution touches. (getRecipe
  // reads meta_json; the apply path writes the updated meta back to `data` —
  // a pre-existing quirk of that file, mirrored here as-is.)
  db.exec(`
    CREATE TABLE dtus (
      id          TEXT PRIMARY KEY,
      title       TEXT,
      type        TEXT,
      creator_id  TEXT,
      meta_json   TEXT,
      data        TEXT,
      skill_level REAL DEFAULT 1
    );
  `);
  db.prepare(`
    INSERT INTO dtus (id, title, type, creator_id, meta_json, skill_level)
    VALUES (?, ?, 'skill', ?, ?, ?)
  `).run(
    "recipe_water_gun",
    "Water Gun",
    "u_evo",
    JSON.stringify({
      skill_kind: "spell",
      element: "water",
      name: "water_gun",
      current_name: "water_gun",
      max_damage: 20,
      range_m: 8,
      costs: { mana: 10, cooldown_s: 4 },
      revision_num: 0,
      revision_history: [],
    }),
    10,
  );
  return db;
}

describe("skill-evolution.applyEvolution — system:skill-evolved", () => {
  let db;

  beforeEach(() => {
    db = evolutionDb();
    installSpy();
  });

  afterEach(() => {
    restoreSpy();
    db.close();
  });

  it("emits system:skill-evolved on a committed player revision, with the fields SystemFeed reads", () => {
    const recipe = db.prepare("SELECT * FROM dtus WHERE id = ?").get("recipe_water_gun");
    const evolution = composeDeterministicEvolution(recipe, 10, "tighter pressure", [], "player");

    const result = applyEvolution(db, "player", "u_evo", evolution);
    assert.equal(result.ok, true, result.reason);

    const evolved = only("system:skill-evolved");
    assert.equal(evolved.length, 1);

    // SystemFeed.tsx:79 → push('power', 'POWER EVOLVED', str(p.name) || str(p.skill))
    const p = evolved[0].payload;
    assert.equal(str(p.name), evolution.nameAfter);
    assert.equal(str(p.skill), evolution.nameAfter);
    assert.ok(str(p.name), "the detail line must be renderable");
    assert.equal(p.previousName, "water_gun");
    assert.equal(p.recipeId, "recipe_water_gun");

    // Personal beat — scoped to the evolving player's own room.
    assert.deepEqual(evolved[0].opts, { userId: "u_evo" });
  });

  it("does NOT emit for an NPC revision (no UI, thousands run on the heartbeat)", () => {
    const recipe = db.prepare("SELECT * FROM dtus WHERE id = ?").get("recipe_water_gun");
    const evolution = composeDeterministicEvolution(recipe, 10, "npc drill", [], "npc");
    const result = applyEvolution(db, "npc", "npc_1", evolution);
    assert.equal(result.ok, true, result.reason);
    assert.equal(only("system:skill-evolved").length, 0);
  });

  it("does NOT emit when the apply fails (nothing was committed)", () => {
    const recipe = db.prepare("SELECT * FROM dtus WHERE id = ?").get("recipe_water_gun");
    const evolution = composeDeterministicEvolution(recipe, 10, "x", [], "player");
    evolution.recipeId = "recipe_does_not_exist";
    const result = applyEvolution(db, "player", "u_evo", evolution);
    assert.equal(result.ok, false);
    assert.equal(only("system:skill-evolved").length, 0);
  });

  it("still commits the revision when no realtime emitter is installed", () => {
    globalThis._concordRealtimeEmit = undefined;
    globalThis.realtimeEmit = undefined;
    const recipe = db.prepare("SELECT * FROM dtus WHERE id = ?").get("recipe_water_gun");
    const evolution = composeDeterministicEvolution(recipe, 10, "no emitter", [], "player");
    const result = applyEvolution(db, "player", "u_evo", evolution);
    assert.equal(result.ok, true, result.reason);
    const row = db.prepare("SELECT COUNT(*) AS n FROM skill_revisions").get();
    assert.equal(row.n, 1);
  });
});

// ── system:notice (lib/quest-rewards.js#grantQuestRewards) ───────────────────

function questRewardDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (
      id                TEXT PRIMARY KEY,
      concordia_credits REAL DEFAULT 0,
      sparks            INTEGER DEFAULT 0
    );
    CREATE TABLE player_inventory (
      id          TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL,
      item_type   TEXT,
      item_id     TEXT,
      item_name   TEXT,
      quantity    INTEGER DEFAULT 1,
      quality     TEXT,
      acquired_at INTEGER
    );
    -- quest-rewards.js#ensureSchema creates this itself, but memoizes on a
    -- MODULE-level flag — harmless with one long-lived DB in production, but
    -- it means only the first in-memory DB in a test process gets the table.
    -- Created here so each case starts from the same real schema.
    CREATE TABLE IF NOT EXISTS quest_reward_grants (
      id            TEXT PRIMARY KEY,
      user_id       TEXT NOT NULL,
      quest_id      TEXT NOT NULL,
      granted_at    INTEGER NOT NULL DEFAULT (unixepoch()),
      gold          REAL NOT NULL DEFAULT 0,
      sparks        INTEGER NOT NULL DEFAULT 0,
      skill_xp_json TEXT NOT NULL DEFAULT '{}',
      items_json    TEXT NOT NULL DEFAULT '[]',
      UNIQUE(user_id, quest_id)
    );
  `);
  db.prepare("INSERT INTO users (id) VALUES (?)").run("u_quest");
  return db;
}

describe("quest-rewards.grantQuestRewards — system:notice", () => {
  let db;

  beforeEach(() => {
    db = questRewardDb();
    installSpy();
  });

  afterEach(() => {
    restoreSpy();
    db.close();
  });

  it("emits system:notice with the title + detail SystemFeed reads, built only from what was granted", () => {
    const res = grantQuestRewards(db, "u_quest", "q_first_cycle", {
      gold: 120,
      sparks: 3,
      named_items: [{ id: "sealed_glyph", name: "Vela's Sealed Glyph", type: "trinket" }],
    });
    assert.equal(res.ok, true);

    const notices = only("system:notice");
    assert.equal(notices.length, 1);

    // SystemFeed.tsx:86 → push('notice', str(p.title) || 'SYSTEM', str(p.detail))
    const p = notices[0].payload;
    assert.equal(str(p.title), "QUEST REWARD");
    assert.equal(str(p.detail), "120 CC · 3 sparks · Vela's Sealed Glyph");
    assert.equal(p.questId, "q_first_cycle");

    // Personal beat — scoped to the earning user's own room.
    assert.deepEqual(notices[0].opts, { userId: "u_quest" });
  });

  it("does NOT emit when nothing was actually granted (no fabricated notice)", () => {
    const res = grantQuestRewards(db, "u_quest", "q_empty", {});
    assert.equal(res.ok, true);
    assert.equal(only("system:notice").length, 0);
  });

  it("does NOT re-emit on an already-granted quest (idempotent grant)", () => {
    grantQuestRewards(db, "u_quest", "q_once", { gold: 10 });
    assert.equal(only("system:notice").length, 1);
    emitted = [];
    const again = grantQuestRewards(db, "u_quest", "q_once", { gold: 10 });
    assert.equal(again.alreadyGranted, true);
    assert.equal(only("system:notice").length, 0);
  });

  it("still grants the reward when no realtime emitter is installed", () => {
    globalThis._concordRealtimeEmit = undefined;
    globalThis.realtimeEmit = undefined;
    const res = grantQuestRewards(db, "u_quest", "q_noemit", { gold: 25 });
    assert.equal(res.ok, true);
    assert.equal(res.granted.gold, 25);
    const row = db.prepare("SELECT concordia_credits AS cc FROM users WHERE id = ?").get("u_quest");
    assert.equal(row.cc, 25);
  });
});
