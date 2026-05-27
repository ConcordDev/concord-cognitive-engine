// Contract test for the survival-engine Phase II Wave 20 substrate.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import {
  ensureBudget,
  tickSurvival,
  eat,
  drink,
  sleepRestore,
  contractDisease,
  tickDiseases,
  listActiveDiseases,
  curePartial,
} from "../lib/survival-engine.js";
import registerSurvivalMacros from "../domains/survival.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, input = {}) {
  const fn = ACTIONS.get(`survival.${name}`);
  assert.ok(fn, `survival.${name} not registered`);
  return fn(ctx, input);
}

let db;

before(() => { registerSurvivalMacros(register); });

beforeEach(() => {
  db = new Database(":memory:");
  db.exec(`
    CREATE TABLE pain_signals (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      world_id TEXT,
      region TEXT NOT NULL,
      intensity REAL NOT NULL,
      source TEXT NOT NULL,
      source_id TEXT,
      element TEXT,
      recorded_at INTEGER NOT NULL DEFAULT (unixepoch()),
      processed_at INTEGER
    );
    CREATE TABLE player_survival_budgets (
      user_id TEXT PRIMARY KEY,
      hunger REAL NOT NULL DEFAULT 100,
      thirst REAL NOT NULL DEFAULT 100,
      sleep REAL NOT NULL DEFAULT 100,
      body_temp_c REAL NOT NULL DEFAULT 37,
      last_tick_at INTEGER NOT NULL DEFAULT (unixepoch()),
      last_meal_at INTEGER,
      last_drink_at INTEGER,
      last_sleep_at INTEGER
    );
    CREATE TABLE player_diseases (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      disease_id TEXT NOT NULL,
      severity REAL NOT NULL DEFAULT 0.1,
      contagion_radius_m REAL NOT NULL DEFAULT 5,
      contracted_at INTEGER NOT NULL DEFAULT (unixepoch()),
      recovered_at INTEGER,
      symptoms_json TEXT NOT NULL DEFAULT '[]'
    );
  `);
});

const ctxAlice = () => ({ actor: { userId: "user_alice" }, userId: "user_alice", db });

describe("survival-engine library", () => {
  it("ensureBudget creates row with 100/100/100", () => {
    const b = ensureBudget(db, "user_alice");
    assert.equal(b.hunger, 100);
    assert.equal(b.thirst, 100);
    assert.equal(b.sleep, 100);
    assert.equal(b.body_temp_c, 37);
  });

  it("ensureBudget is idempotent", () => {
    ensureBudget(db, "user_alice");
    const b2 = ensureBudget(db, "user_alice");
    assert.equal(b2.hunger, 100);
    const count = db.prepare("SELECT COUNT(*) AS n FROM player_survival_budgets").get().n;
    assert.equal(count, 1);
  });

  it("tickSurvival decays budgets over real time", () => {
    ensureBudget(db, "user_alice");
    // Backdate last_tick_at by 60 minutes
    db.prepare("UPDATE player_survival_budgets SET last_tick_at = ? WHERE user_id = ?")
      .run(Math.floor(Date.now() / 1000) - 3600, "user_alice");
    const r = tickSurvival(db, "user_alice");
    assert.ok(r.delta.hunger < 0);
    assert.ok(r.delta.thirst < 0);
    assert.ok(r.delta.sleep < 0);
    assert.ok(r.newBudget.hunger < 100);
    assert.ok(r.newBudget.thirst < 100);
  });

  it("tickSurvival emits pain when hunger drops below threshold", () => {
    db.prepare(`
      INSERT INTO player_survival_budgets (user_id, hunger, thirst, sleep, last_tick_at)
      VALUES ('u', 20, 80, 80, ?)
    `).run(Math.floor(Date.now() / 1000) - 60);
    const r = tickSurvival(db, "u");
    assert.ok(r.painEvents.some((e) => e.source === "hunger"));
  });

  it("tickSurvival emits cold pain when body temp falls below 35", () => {
    db.prepare(`
      INSERT INTO player_survival_budgets (user_id, body_temp_c, last_tick_at)
      VALUES ('u', 36, ?)
    `).run(Math.floor(Date.now() / 1000) - 600);
    const r = tickSurvival(db, "u", { ambientTempC: -5 });
    // After 10 minutes tracking toward -5°C, body temp drops by 2°C → 34°C < 35
    assert.ok(r.painEvents.some((e) => e.source === "cold"));
    assert.ok(r.newBudget.body_temp_c < 36);
  });

  it("tickSurvival emits heat pain in hot ambient", () => {
    db.prepare(`
      INSERT INTO player_survival_budgets (user_id, body_temp_c, last_tick_at)
      VALUES ('u', 38, ?)
    `).run(Math.floor(Date.now() / 1000) - 600);
    const r = tickSurvival(db, "u", { ambientTempC: 45 });
    assert.ok(r.painEvents.some((e) => e.source === "heat"));
  });

  it("eat restores hunger budget", () => {
    ensureBudget(db, "u");
    db.prepare("UPDATE player_survival_budgets SET hunger = 30 WHERE user_id = 'u'").run();
    const r = eat(db, "u", 25);
    assert.equal(r.ok, true);
    assert.equal(r.gained, 25);
    assert.equal(r.newHunger, 55);
  });

  it("drink restores thirst with cap at 100", () => {
    ensureBudget(db, "u");
    db.prepare("UPDATE player_survival_budgets SET thirst = 80 WHERE user_id = 'u'").run();
    const r = drink(db, "u", 50);
    assert.equal(r.newThirst, 100);
    assert.equal(r.gained, 20);
  });

  it("sleepRestore quality differs: inn > cot > ground", () => {
    ensureBudget(db, "u");
    db.prepare("UPDATE player_survival_budgets SET sleep = 50 WHERE user_id = 'u'").run();
    const ground = sleepRestore(db, "u", "ground", 10);
    assert.equal(ground.gained, 5);
    db.prepare("UPDATE player_survival_budgets SET sleep = 50 WHERE user_id = 'u'").run();
    const cot = sleepRestore(db, "u", "cot", 10);
    assert.equal(cot.gained, 10);
    db.prepare("UPDATE player_survival_budgets SET sleep = 50 WHERE user_id = 'u'").run();
    const inn = sleepRestore(db, "u", "inn", 10);
    assert.equal(inn.gained, 15);
  });

  it("contractDisease + listActive + cure", () => {
    const c = contractDisease(db, "u", "plague", { severity: 0.4 });
    assert.equal(c.ok, true);
    const active = listActiveDiseases(db, "u");
    assert.equal(active.length, 1);
    assert.equal(active[0].disease_id, "plague");
    const cure = curePartial(db, "u", "plague", 0.2);
    assert.equal(cure.ok, true);
    const after = listActiveDiseases(db, "u")[0];
    assert.ok(after.severity < 0.4);
  });

  it("contractDisease is idempotent for the same active disease", () => {
    contractDisease(db, "u", "flu");
    const second = contractDisease(db, "u", "flu");
    assert.equal(second.alreadyContracted, true);
  });

  it("tickDiseases advances severity then triggers pain at high severity", () => {
    contractDisease(db, "u", "plague", { severity: 0.6 });
    const events = tickDiseases(db, "u");
    // severity > 0.5 → pain event
    assert.ok(events.some((e) => e.kind === "pain"));
  });
});

describe("survival domain macros", () => {
  it("rejects no_user / no_db", async () => {
    let r = await call("get_budget", { actor: { userId: null }, userId: null });
    assert.equal(r.ok, false);
    r = await call("get_budget", { actor: { userId: "u" }, userId: "u" });
    assert.equal(r.ok, false);
  });

  it("summary returns budget + diseases", async () => {
    const r = await call("summary", ctxAlice());
    assert.equal(r.ok, true);
    assert.ok(r.budget);
    assert.equal(r.diseaseCount, 0);
  });

  it("eat + drink + sleep through the macro surface", async () => {
    ensureBudget(db, "user_alice");
    db.prepare("UPDATE player_survival_budgets SET hunger = 20, thirst = 30, sleep = 40 WHERE user_id = 'user_alice'").run();
    const meal = await call("eat",   ctxAlice(), { nutritionValue: 30 });
    const sip  = await call("drink", ctxAlice(), { hydrationValue: 40 });
    const nap  = await call("sleep", ctxAlice(), { quality: "inn", minutes: 30 });
    assert.equal(meal.newHunger, 50);
    assert.equal(sip.newThirst, 70);
    assert.equal(nap.gained, 45);
  });

  it("constants macro returns SURVIVAL_CONSTANTS", async () => {
    const r = await call("constants", ctxAlice());
    assert.equal(r.ok, true);
    assert.ok(r.constants.HUNGER_DECAY_PER_MIN > 0);
  });

  it("contract_disease + tick_diseases + list_diseases", async () => {
    const c = await call("contract_disease", ctxAlice(), { diseaseId: "plague", severity: 0.6 });
    assert.equal(c.ok, true);
    const t = await call("tick_diseases", ctxAlice());
    assert.equal(t.ok, true);
    const l = await call("list_diseases", ctxAlice());
    assert.equal(l.diseases.length, 1);
  });
});
