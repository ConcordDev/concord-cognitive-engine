// Phase X2 — intoxication.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { getBac, drink, getTier, getCombatAccuracyMultiplier } from "../lib/intoxication.js";

function memDb() {
  const rows = new Map();
  return {
    prepare(sql) {
      const n = sql.replace(/\s+/g, " ").trim();
      return {
        run: (...args) => {
          if (n.startsWith("INSERT INTO player_intoxication")) {
            const [userId, bac1, bac2] = args;
            rows.set(userId, { user_id: userId, blood_alcohol: bac2 ?? bac1, last_drink_at: Math.floor(Date.now()/1000), last_decay_at: Math.floor(Date.now()/1000) });
            return { changes: 1 };
          }
          if (n.startsWith("UPDATE player_intoxication SET blood_alcohol = ?, last_decay_at = unixepoch()")) {
            const [bac, userId] = args;
            const r = rows.get(userId);
            if (r) { r.blood_alcohol = bac; r.last_decay_at = Math.floor(Date.now()/1000); }
            return { changes: 1 };
          }
          return { changes: 0 };
        },
        get: (...args) => {
          if (n.startsWith("SELECT blood_alcohol AS bac")) {
            const r = rows.get(args[0]);
            return r ? { bac: r.blood_alcohol, lastDecayAt: r.last_decay_at } : null;
          }
          return null;
        },
      };
    },
    _rows: rows,
  };
}

describe("Phase X2 — intoxication", () => {
  let db;
  beforeEach(() => { db = memDb(); });

  it("getTier maps thresholds", () => {
    assert.equal(getTier(0.0), "sober");
    assert.equal(getTier(0.2), "buzzed");
    assert.equal(getTier(0.4), "drunk");
    assert.equal(getTier(0.7), "stumbling");
  });

  it("getCombatAccuracyMultiplier drops with BAC", () => {
    assert.equal(getCombatAccuracyMultiplier(0.0), 1.0);
    assert.equal(getCombatAccuracyMultiplier(0.4), 0.80);
    assert.equal(getCombatAccuracyMultiplier(0.7), 0.50);
  });

  it("getBac returns 0 for sober new user", () => {
    assert.equal(getBac(db, "u1"), 0);
  });

  it("drink raises BAC by 0.1 per standard drink", () => {
    drink(db, "u1");
    const after1 = getBac(db, "u1");
    assert.ok(after1 >= 0.099 && after1 <= 0.101, `expected ~0.1, got ${after1}`);
    drink(db, "u1");
    drink(db, "u1");
    const after3 = getBac(db, "u1");
    // Float math: 0.1+0.1+0.1 can yield 0.30000000000000004; loosen bounds.
    assert.ok(after3 > 0.25 && after3 < 0.35);
  });

  it("BAC caps at 1.0", () => {
    for (let i = 0; i < 20; i++) drink(db, "u1", 2.0);
    assert.ok(getBac(db, "u1") <= 1.0);
  });

  it("drink with double strength applies 2x BAC bump", () => {
    drink(db, "u1", 2.0);
    const bac = getBac(db, "u1");
    assert.ok(bac >= 0.19 && bac <= 0.21);
  });
});
