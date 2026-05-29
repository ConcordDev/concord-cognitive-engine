/**
 * D6 — run-mode payout-on-loss + risk-scaled spikes.
 *
 * Pins: every run mode now grants persistent meta-progress on a LOSS, payout
 * scales with the risk gradient (roguelite tier, horde wave, extraction loot),
 * and the extraction final-stretch dread read escalates near timeout.
 *
 * Run: node --test tests/run-mode-payout.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { up as up241 } from "../migrations/241_difficulty_tiers.js";
import { up as up245 } from "../migrations/245_roguelite_runs.js";
import { up as up246 } from "../migrations/246_horde_mode.js";
import { up as up258 } from "../migrations/258_extraction_runs.js";

import { lootMultFor, grantRunMeta } from "../lib/run-difficulty.js";
import { startRun as rglStart, endRun as rglEnd, getBalance } from "../lib/roguelite.js";
import { startHorde, endHorde } from "../lib/horde-mode.js";
import { startRun as extrStart, pickupLoot, declareExtractionZone, extract, dieDuringRun, extractionDanger } from "../lib/extraction.js";

function db241() { const db = new Database(":memory:"); up241(db); up245(db); up246(db); up258(db); return db; }

describe("D6 — shared run-meta helpers", () => {
  it("lootMultFor is identity for no modifier, scales for a real one", () => {
    assert.equal(lootMultFor(null), 1.0);
    assert.equal(lootMultFor({ loot_mult: 2.5 }), 2.5);
    assert.equal(lootMultFor({ loot_mult: 0 }), 1.0); // guard against zero
  });

  it("grantRunMeta banks into roguelite_meta_currency and no-ops on a missing table", () => {
    const db = db241();
    const r = grantRunMeta(db, "u1", 40);
    assert.equal(r.granted, 40);
    assert.equal(getBalance(db, "u1").balance, 40);
    // missing table → guarded no-op, never throws
    const bare = new Database(":memory:");
    const r2 = grantRunMeta(bare, "u1", 40);
    assert.equal(r2.ok, false);
  });
});

describe("D6 — roguelite payout scales with tier (finder unchanged)", () => {
  it("finder death still banks the base half-currency (no regression)", () => {
    const db = db241();
    const s = rglStart(db, "u1", { worldId: "w", regionId: "r1" });
    const e = rglEnd(db, s.runId, { reason: "death", depthReached: 4 });
    assert.equal(e.earned, 10); // 4*5*0.5, finder loot_mult 1.0
  });

  it("a heroic-tier extract pays a multiplied spike", () => {
    const db = db241();
    // bump the heroic modifier's loot multiplier + unlock the chain
    db.prepare(`UPDATE difficulty_modifiers SET loot_mult = 3.0 WHERE tier = 'heroic'`).run();
    db.prepare(`INSERT OR IGNORE INTO difficulty_clears (user_id, encounter_id, tier) VALUES ('u2','run:roguelite','normal')`).run();
    const s = rglStart(db, "u2", { worldId: "w", regionId: "r1", tier: "heroic" });
    assert.equal(s.ok, true);
    const e = rglEnd(db, s.runId, { reason: "extract", depthReached: 4, tier: "heroic" });
    // base extract = 4*5*1.25 = 25; × heroic loot_mult 3.0 = 75
    assert.equal(e.earned, 75);
  });
});

describe("D6 — horde pays out on death (the run IS the reward)", () => {
  it("endHorde banks wave/kill yield even on a wipe", () => {
    const db = db241();
    const s = startHorde(db, "u3", { worldId: "w" });
    db.prepare(`UPDATE horde_runs SET wave_reached = 12, kills = 40 WHERE id = ?`).run(s.runId);
    const e = endHorde(db, s.runId, { reason: "death" });
    assert.equal(e.ok, true);
    // 12*8 + 40*0.25 = 96 + 10 = 106
    assert.equal(e.earned, 106);
    assert.equal(getBalance(db, "u3").balance, 106);
  });
});

describe("D6 — extraction: extract pays, death consoles", () => {
  function seedRunWithLoot(db, userId) {
    const s = extrStart(db, userId, { worldId: "w" });
    pickupLoot(db, s.runId, { itemId: "a", x: 0, z: 0 });
    pickupLoot(db, s.runId, { itemId: "b", x: 0, z: 0 });
    return s;
  }

  it("extract banks full reward (flat + per-item)", () => {
    const db = db241();
    const s = seedRunWithLoot(db, "u4");
    declareExtractionZone(db, { worldId: "w", x: 100, z: 100, radiusM: 10, durationS: 600 });
    const ex = extract(db, s.runId, { x: 100, z: 100 });
    assert.equal(ex.extracted, true);
    // flat 10 + 2 items * 6 = 22
    assert.equal(ex.earned, 22);
    assert.equal(getBalance(db, "u4").balance, 22);
  });

  it("death loses loot but pays a consolation so the loss still advances", () => {
    const db = db241();
    const s = seedRunWithLoot(db, "u5");
    const d = dieDuringRun(db, s.runId, { position: { x: 1, z: 1 } });
    assert.equal(d.ok, true);
    assert.equal(d.lostLoot.length, 2);
    assert.equal(d.consolation, 2); // 2 items * 1
    assert.equal(getBalance(db, "u5").balance, 2);
  });
});

describe("D6 — extraction final-stretch dread escalation", () => {
  it("dread rises as the timeout window closes", () => {
    const db = db241();
    const s = extrStart(db, "u6", { worldId: "w", timeoutSeconds: 900 });
    const run = db.prepare(`SELECT started_at, timeout_at FROM extraction_runs WHERE id = ?`).get(s.runId);
    // early (full window): calm
    const early = extractionDanger(db, s.runId, { now: run.started_at + 10 });
    assert.equal(early.band, "calm");
    assert.equal(early.dread, 0);
    // near the very end: terror
    const late = extractionDanger(db, s.runId, { now: run.timeout_at - 5 });
    assert.ok(late.dread > 0.9, `expected high dread, got ${late.dread}`);
    assert.equal(late.band, "terror");
  });

  it("a nearby pursuer drives dread independent of the clock", () => {
    const db = db241();
    const s = extrStart(db, "u7", { worldId: "w", timeoutSeconds: 3600 });
    const run = db.prepare(`SELECT started_at FROM extraction_runs WHERE id = ?`).get(s.runId);
    const d = extractionDanger(db, s.runId, { now: run.started_at + 10, pursuerDistance: 4 });
    assert.ok(d.dread > 0.5, `expected proximity dread, got ${d.dread}`);
    assert.equal(d.inChase, true);
  });
});
