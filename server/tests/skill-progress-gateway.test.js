/**
 * Aura roadmap A-32 — server-authored player progression for game clients.
 *
 * gainSkillXP (lib/skills/skill-engine.js) is the one place player skill XP
 * lands (quests, crafting, gathering, occupations, the pain → XP repair
 * cycle). Its web beats (system:level-up, character:updated) never reach
 * /unity-ws or /godot-ws, so it mirrors one `skill:progress` event per grant
 * to the player's own gateway user room. This pins the payload, the scoping
 * and that a missing gateway hook never breaks the grant.
 *
 * Run: node --test tests/skill-progress-gateway.test.js
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { up as up064 } from "../migrations/064_crafting_and_skills.js";
import { gainSkillXP } from "../lib/skills/skill-engine.js";

let mirrored;
let prevMirror;

describe("gainSkillXP → skill:progress on the game gateways", () => {
  let db;

  beforeEach(() => {
    db = new Database(":memory:");
    up064(db);
    mirrored = [];
    prevMirror = globalThis._concordGatewayMirror;
    globalThis._concordGatewayMirror = (event, payload, opts) => mirrored.push({ event, payload, opts });
  });

  afterEach(() => {
    globalThis._concordGatewayMirror = prevMirror;
    db.close();
  });

  const progress = () => mirrored.filter((m) => m.event === "skill:progress");

  it("a first grant reports the new skill, its running xp and the user room", () => {
    gainSkillXP(db, "u_a32", "combat", "standard", 40);
    const [m] = progress();
    assert.ok(m, "skill:progress was mirrored");
    assert.deepEqual(m.opts, { userId: "u_a32" });
    assert.equal(m.payload.userId, "u_a32");
    assert.equal(m.payload.skill, "combat");
    assert.equal(m.payload.worldType, "standard");
    assert.equal(m.payload.level, 1);
    assert.equal(m.payload.xp, 40);
    assert.equal(m.payload.xpToNext, 100);
    assert.equal(m.payload.xpGain, 40);
    assert.equal(m.payload.leveled, false);
    assert.equal(m.payload.acquired, true);
    assert.equal(m.payload.atCap, false);
  });

  it("a level-up reports the new level and the carried-over xp from the table", () => {
    gainSkillXP(db, "u_a32", "combat", "standard", 40);
    gainSkillXP(db, "u_a32", "combat", "standard", 90);
    const m = progress().at(-1);
    const row = db.prepare("SELECT level, xp, xp_to_next FROM player_skill_levels WHERE user_id = 'u_a32'").get();
    assert.equal(m.payload.leveled, true);
    assert.equal(m.payload.levelsGained, 1);
    assert.equal(m.payload.acquired, false);
    assert.equal(m.payload.level, row.level);
    assert.equal(m.payload.xp, row.xp);
    assert.equal(m.payload.xpToNext, row.xp_to_next);
  });

  it("a missing gateway hook never breaks the grant", () => {
    globalThis._concordGatewayMirror = undefined;
    const r = gainSkillXP(db, "u_a32b", "crafting", "standard", 150);
    assert.equal(r.leveled, true);
    assert.equal(r.newLevel, 2);
  });
});
