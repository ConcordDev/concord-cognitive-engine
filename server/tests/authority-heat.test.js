/**
 * Tier-2 contract tests for Phase 3 of the Temperament engine — the two-meter
 * authority machine.
 *
 * Pins:
 *   - HEAT: fills, clamps at HEAT_MAX, time-decays to zero, clears.
 *   - suspicionState FSM thresholds (idle/suspicious/search/alert).
 *   - bountyTier names (clean/wanted/notorious/fugitive) off wanted_level 0–5.
 *   - responderTier escalation (local/elite/army) by wanted + repeat.
 *   - arrestOffer: offered at THREATENING for wanted, kill-on-sight for fugitive,
 *     null for clean / wrong rung.
 *   - resolveArrestResponse: comply stands down, resist escalates to hostile.
 *   - authorityPressure combines the slow wanted scalar + fast heat from the DB.
 *
 * Run: node --test server/tests/authority-heat.test.js
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import {
  getHeat,
  addHeat,
  clearHeat,
  _resetHeat,
  suspicionState,
  bountyTier,
  responderTier,
  arrestOffer,
  resolveArrestResponse,
  wantedLevelFor,
  authorityPressure,
  HEAT_MAX,
  SUSPICION_STATES,
  BOUNTY_TIERS,
} from "../lib/authority-heat.js";

describe("HEAT fast meter", () => {
  beforeEach(() => _resetHeat());

  it("is zero when unset", () => {
    assert.equal(getHeat("w1", "userA"), 0);
  });

  it("fills and clamps at HEAT_MAX", () => {
    const t = 1_000_000;
    addHeat("w1", "userA", 60, t);
    assert.equal(getHeat("w1", "userA", t), 60);
    addHeat("w1", "userA", 80, t);
    assert.equal(getHeat("w1", "userA", t), HEAT_MAX);
  });

  it("time-decays toward zero", () => {
    const t = 1_000_000;
    addHeat("w1", "userA", 100, t);
    // default decay 2/sec → 100 cools in ~50s
    assert.ok(getHeat("w1", "userA", t + 10_000) < 100); // 10s later, lower
    assert.equal(getHeat("w1", "userA", t + 60_000), 0); // 60s later, fully cool
  });

  it("clears on demand and isolates by (world,entity)", () => {
    const t = 1_000_000;
    addHeat("w1", "userA", 50, t);
    addHeat("w2", "userA", 30, t);
    clearHeat("w1", "userA");
    assert.equal(getHeat("w1", "userA", t), 0);
    assert.equal(getHeat("w2", "userA", t), 30);
  });
});

describe("suspicionState FSM", () => {
  it("crosses thresholds idle → suspicious → search → alert", () => {
    assert.equal(suspicionState(0), "idle");
    assert.equal(suspicionState(24), "idle");
    assert.equal(suspicionState(25), "suspicious");
    assert.equal(suspicionState(55), "search");
    assert.equal(suspicionState(80), "alert");
    assert.equal(SUSPICION_STATES.length, 4);
  });
});

describe("bountyTier", () => {
  it("names the slow wanted scalar 0–5", () => {
    assert.equal(bountyTier(0), "clean");
    assert.equal(bountyTier(1), "wanted");
    assert.equal(bountyTier(2), "wanted");
    assert.equal(bountyTier(3), "notorious");
    assert.equal(bountyTier(4), "notorious");
    assert.equal(bountyTier(5), "fugitive");
    assert.equal(BOUNTY_TIERS.length, 4);
  });
});

describe("responderTier", () => {
  it("escalates the responder by wanted + repeat", () => {
    assert.equal(responderTier(0), "local");
    assert.equal(responderTier(3), "elite");
    assert.equal(responderTier(5), "army");
    assert.equal(responderTier(2, 3), "elite"); // +1 from repeat/3
    assert.equal(responderTier(4, 3), "army");
  });
});

describe("arrestOffer", () => {
  it("offers arrest at THREATENING for a wanted target", () => {
    const o = arrestOffer("threatening", "wanted");
    assert.equal(o.offer, true);
    assert.deepEqual(o.options, ["pay", "jail", "yield", "resist"]);
  });

  it("a fugitive is kill-on-sight (no offer)", () => {
    const o = arrestOffer("threatening", "fugitive");
    assert.equal(o.offer, false);
    assert.equal(o.killOnSight, true);
  });

  it("no offer for clean targets or the wrong rung", () => {
    assert.equal(arrestOffer("threatening", "clean"), null);
    assert.equal(arrestOffer("warning", "wanted"), null);
    assert.equal(arrestOffer("hostile", "notorious"), null);
  });
});

describe("resolveArrestResponse", () => {
  it("comply paths stand the NPC down", () => {
    assert.equal(resolveArrestResponse("pay").standDown, true);
    assert.equal(resolveArrestResponse("jail").standDown, true);
    assert.equal(resolveArrestResponse("yield").standDown, true);
  });

  it("resisting flips to hostile", () => {
    const r = resolveArrestResponse("resist");
    assert.equal(r.standDown, false);
    assert.equal(r.escalateTo, "hostile");
  });

  it("unknown verb is a no-op", () => {
    assert.equal(resolveArrestResponse("flirt").outcome, "none");
  });
});

describe("authorityPressure (slow + fast, DB-backed)", () => {
  let db;
  beforeEach(() => {
    _resetHeat();
    db = new Database(":memory:");
    db.exec(`CREATE TABLE player_wanted (
      user_id TEXT, world_id TEXT, wanted_level INTEGER, notoriety INTEGER,
      PRIMARY KEY (user_id, world_id)
    );`);
  });
  afterEach(() => db.close());

  it("reads the slow wanted scalar from the DB", () => {
    db.prepare(`INSERT INTO player_wanted (user_id, world_id, wanted_level) VALUES (?,?,?)`)
      .run("userA", "w1", 5);
    assert.equal(wantedLevelFor(db, "w1", "userA"), 5);
    assert.ok(Math.abs(authorityPressure(db, "w1", "userA", 0) - 0.7) < 1e-9); // 5/5*0.7
  });

  it("combines bounty (0.7) and heat (0.3), clamped to 1", () => {
    db.prepare(`INSERT INTO player_wanted (user_id, world_id, wanted_level) VALUES (?,?,?)`)
      .run("userA", "w1", 5);
    addHeat("w1", "userA", HEAT_MAX, 0);
    assert.equal(authorityPressure(db, "w1", "userA", 0), 1); // 0.7 + 0.3
  });

  it("is zero for a clean, cool target and never throws on a bare DB", () => {
    assert.equal(authorityPressure(db, "w1", "userB", 0), 0);
    const bare = new Database(":memory:");
    assert.equal(authorityPressure(bare, "w1", "userB", 0), 0); // no player_wanted table
    bare.close();
  });
});
