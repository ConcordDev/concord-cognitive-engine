/**
 * E2 — economy-anomaly cycle.
 *
 * Pins: the cycle rolls detectPathologies economy findings + the wash-trade rollup into a
 * counter, routes Critical kinds (negative_balance, wash_trade) to the pager via bug-triage,
 * respects the kill-switch, and NEVER mutates the db (observe-only). I/O is injected.
 *
 * Run: node --test tests/economy-anomaly-cycle.test.js
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { runEconomyAnomalyCycle } from "../emergent/economy-anomaly-cycle.js";

function mocks() {
  const counted = [];
  const paged = [];
  return {
    counted, paged,
    incCounter: (kind) => counted.push(kind),
    alert: async (p) => { paged.push(p); },
  };
}

test("kill-switch CONCORD_ECON_ANOMALY=0 → disabled no-op", async () => {
  const prev = process.env.CONCORD_ECON_ANOMALY;
  process.env.CONCORD_ECON_ANOMALY = "0";
  const r = await runEconomyAnomalyCycle({ db: new Database(":memory:"), ...mocks() });
  assert.equal(r.disabled, true);
  assert.equal(r.counted, 0);
  if (prev === undefined) delete process.env.CONCORD_ECON_ANOMALY; else process.env.CONCORD_ECON_ANOMALY = prev;
});

test("no db → ok:false, no throw", async () => {
  const r = await runEconomyAnomalyCycle({ db: null, ...mocks() });
  assert.equal(r.ok, false);
});

test("a negative balance is counted AND paged (Critical)", async () => {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE user_wallets (user_id TEXT);`);
  db.exec(`CREATE TABLE users (id TEXT PRIMARY KEY, concordia_credits REAL);`);
  db.prepare(`INSERT INTO users (id, concordia_credits) VALUES ('u1', -500)`).run();
  const m = mocks();
  const r = await runEconomyAnomalyCycle({ db, incCounter: m.incCounter, alert: m.alert });
  assert.equal(r.ok, true);
  assert.equal(r.byKind.negative_balance, 1);
  assert.ok(m.counted.includes("negative_balance"));
  assert.equal(r.paged >= 1, true, "negative_balance must page");
  assert.ok(m.paged.some((p) => p.fields?.kind === "negative_balance"));
});

test("wash-trade rollup is counted + paged (advisory, never blocks)", async () => {
  const db = new Database(":memory:");
  const m = mocks();
  const r = await runEconomyAnomalyCycle({ db, incCounter: m.incCounter, alert: m.alert, washTradeCount: 7 });
  assert.equal(r.byKind.wash_trade, 1);
  assert.ok(m.counted.includes("wash_trade"));
  assert.ok(m.paged.some((p) => p.fields?.kind === "wash_trade" && p.fields?.suspected === 7));
});

test("observe-only — the cycle does not mutate the db", async () => {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE user_wallets (user_id TEXT);`);
  db.exec(`CREATE TABLE users (id TEXT PRIMARY KEY, concordia_credits REAL);`);
  db.prepare(`INSERT INTO users (id, concordia_credits) VALUES ('u1', -500)`).run();
  const before = db.prepare(`SELECT concordia_credits FROM users WHERE id='u1'`).get().concordia_credits;
  await runEconomyAnomalyCycle({ db, ...mocks() });
  const after = db.prepare(`SELECT concordia_credits FROM users WHERE id='u1'`).get().concordia_credits;
  assert.equal(before, after, "balance must be untouched (observe-only)");
});
