// server/tests/emergent-store-hydration.test.js
//
//   cd server && node --test tests/emergent-store-hydration.test.js
//
// getEmergentState() used to re-read the whole emergent_registry table on
// every call; recordTick calls it twice per emergent per heartbeat tick, which
// froze the heartbeat backend's event loop for 1.2-2.8s every 15s (measured
// live 2026-09-27 via CPU profile). Pins: one full read, no reads inside the
// interval, and later-registered rows still arrive incrementally.

import { test } from "node:test";
import assert from "node:assert/strict";
import { getEmergentState } from "../emergent/store.js";

function fakeDb(rows) {
  const queries = [];
  return {
    queries,
    rows,
    prepare(sql) {
      return {
        all: (...args) => {
          queries.push({ sql, args });
          if (/updated_at > \?/.test(sql)) return rows.filter((r) => r.updated_at > args[0]);
          return rows.slice();
        },
      };
    },
  };
}

const row = (id, updated_at) => ({ emergent_id: id, name: id, role: "builder", active: 1, created_at: updated_at, updated_at });

test("hydrates once, then stays off the DB inside the interval", () => {
  const db = fakeDb([row("e1", 100), row("e2", 200)]);
  const STATE = { db };
  const es = getEmergentState(STATE);
  assert.equal(es.emergents.size, 2);
  assert.equal(db.queries.length, 1, "first call does one full read");
  for (let i = 0; i < 2000; i++) getEmergentState(STATE);
  assert.equal(db.queries.length, 1, "2,000 hot-path calls must not re-read the table");
});

test("rows registered later (e.g. by the sibling backend) still arrive, incrementally", () => {
  const db = fakeDb([row("e1", 100)]);
  const STATE = { db };
  getEmergentState(STATE);
  db.rows.push(row("e9", 900));
  const realNow = Date.now;
  try {
    Date.now = () => realNow() + 6000; // past HYDRATE_INTERVAL_MS
    const es = getEmergentState(STATE);
    assert.equal(es.emergents.has("e9"), true);
    const last = db.queries.at(-1);
    assert.match(last.sql, /updated_at > \?/, "follow-up reads are incremental, not full-table");
    assert.equal(last.args[0], 100);
  } finally {
    Date.now = realNow;
  }
});

test("hydration bookkeeping never lands on the persisted STATE object", () => {
  const STATE = { db: fakeDb([row("e1", 1)]) };
  getEmergentState(STATE);
  assert.deepEqual(Object.keys(STATE).sort(), ["__emergent", "db"]);
});
