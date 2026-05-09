/**
 * Tier-2 contract tests for Phase 5c — Seasons.
 *
 * Run: node --test tests/seasons.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  SEASONS,
  seasonFor,
  yearFor,
  advanceSeasonForWorld,
  seasonalBias,
  seasonalYieldMultiplier,
  getRecentSeasonEvents,
} from "../lib/seasons.js";
import { runSeasonCycle } from "../emergent/season-cycle.js";

function makeFakeDb() {
  const tables = { world_seasons: new Map(), season_events: new Map(), worlds: new Map(), world_npcs: new Map() };
  function prepare(sql) {
    const s = sql.replace(/\s+/g, " ").trim();
    return { run: (...a) => runStmt(s, a), get: (...a) => getStmt(s, a), all: (...a) => allStmt(s, a) };
  }
  function runStmt(sql, args) {
    if (sql.startsWith("INSERT INTO world_seasons")) {
      const [worldId, idx, year] = args;
      tables.world_seasons.set(worldId, { world_id: worldId, season_idx: idx, year_n: year, transitioned_at: Math.floor(Date.now() / 1000) });
      return { changes: 1 };
    }
    if (sql.startsWith("UPDATE world_seasons")) {
      const [idx, year, worldId] = args;
      const r = tables.world_seasons.get(worldId);
      if (r) { r.season_idx = idx; r.year_n = year; r.transitioned_at = Math.floor(Date.now() / 1000); return { changes: 1 }; }
      return { changes: 0 };
    }
    if (sql.startsWith("INSERT INTO season_events")) {
      const [id, worldId, idx, year, kind, narrative] = args;
      tables.season_events.set(id, { id, world_id: worldId, season_idx: idx, year_n: year, event_kind: kind, narrative, occurred_at: Math.floor(Date.now() / 1000) });
      return { changes: 1 };
    }
    return { changes: 0 };
  }
  function getStmt(sql, args) {
    if (sql.startsWith("SELECT * FROM world_seasons WHERE world_id = ?")) {
      return tables.world_seasons.get(args[0]) || null;
    }
    return null;
  }
  function allStmt(sql, args) {
    if (sql.startsWith("SELECT id FROM worlds")) return Array.from(tables.worlds.values()).map(w => ({ id: w.id }));
    if (sql.startsWith("SELECT DISTINCT world_id FROM world_npcs")) {
      const seen = new Set();
      for (const n of tables.world_npcs.values()) if (!n.is_dead) seen.add(n.world_id);
      return Array.from(seen).map(w => ({ world_id: w }));
    }
    if (sql.startsWith("SELECT id, world_id, season_idx, year_n, event_kind, narrative, occurred_at FROM season_events")) {
      const [worldId, limit] = args;
      return Array.from(tables.season_events.values())
        .filter(e => e.world_id === worldId).sort((a, b) => b.occurred_at - a.occurred_at).slice(0, limit);
    }
    return [];
  }
  return { prepare, _tables: tables };
}

describe("seasonFor / yearFor", () => {
  it("6 seasons cycle deterministically", () => {
    const day0 = 0;
    const day7 = 7 * 86400000;
    const day42 = 42 * 86400000;
    assert.equal(seasonFor(day0).idx, 0);
    assert.equal(seasonFor(day7).idx, 1);
    assert.equal(seasonFor(day42).idx, 0); // wraps
  });
  it("year increments every 42 days", () => {
    assert.equal(yearFor(0), 1);
    assert.equal(yearFor(42 * 86400000), 2);
    assert.equal(yearFor(84 * 86400000), 3);
  });
  it("SEASONS has 6 entries", () => {
    assert.equal(SEASONS.length, 6);
  });
});

describe("advanceSeasonForWorld", () => {
  it("first call inserts row + emits 'season:enter'", () => {
    const db = makeFakeDb();
    const r = advanceSeasonForWorld(db, "w");
    assert.equal(r.ok, true);
    assert.equal(r.transitioned, true);
    assert.ok(r.season);
    assert.ok(r.year >= 1);
    assert.equal(db._tables.world_seasons.size, 1);
    assert.equal(Array.from(db._tables.season_events.values())[0].event_kind, "season:enter");
  });

  it("second call within same season is no-op", () => {
    const db = makeFakeDb();
    advanceSeasonForWorld(db, "w");
    const r = advanceSeasonForWorld(db, "w");
    assert.equal(r.transitioned, false);
  });

  it("crossing boundary triggers transition + event", () => {
    const db = makeFakeDb();
    const day0 = 0;
    advanceSeasonForWorld(db, "w", { now: day0 });
    const day10 = 10 * 86400000;
    const r = advanceSeasonForWorld(db, "w", { now: day10 });
    assert.equal(r.transitioned, true);
    const events = getRecentSeasonEvents(db, "w");
    assert.ok(events.some(e => e.event_kind === "season:transition"));
  });

  it("crossing year boundary emits 'year:begin'", () => {
    const db = makeFakeDb();
    advanceSeasonForWorld(db, "w", { now: 0 });
    advanceSeasonForWorld(db, "w", { now: 42 * 86400000 });
    const events = getRecentSeasonEvents(db, "w");
    assert.ok(events.some(e => e.event_kind === "year:begin"));
  });
});

describe("seasonalBias + seasonalYieldMultiplier", () => {
  it("seasonalBias matches the season's table", () => {
    const summer = seasonalBias(null, "w", 7 * 86400000);
    assert.equal(summer.season, "summer");
    assert.equal(summer.tempBias, 6);
  });

  it("seasonalYieldMultiplier modulates herb across seasons", () => {
    const dwHerb = seasonalYieldMultiplier("herb", 5 * 7 * 86400000);
    const harvestHerb = seasonalYieldMultiplier("herb", 3 * 7 * 86400000);
    assert.ok(dwHerb < 1.0, "deep_winter herb should be ≤ 1");
    assert.ok(harvestHerb > 1.0, "harvest herb should be ≥ 1");
  });

  it("falls back to 'default' multiplier for unknown resource", () => {
    const m = seasonalYieldMultiplier("unknown_kind", 0);
    assert.ok(m > 0);
  });
});

describe("season-cycle heartbeat", () => {
  it("returns no_db with no DB", async () => {
    const r = await runSeasonCycle({});
    assert.equal(r.ok, false);
    assert.equal(r.reason, "no_db");
  });

  it("respects CONCORD_SEASONS=0", async () => {
    const prev = process.env.CONCORD_SEASONS;
    process.env.CONCORD_SEASONS = "0";
    try {
      const r = await runSeasonCycle({ db: makeFakeDb() });
      assert.equal(r.ok, false);
      assert.equal(r.reason, "disabled");
    } finally {
      if (prev === undefined) delete process.env.CONCORD_SEASONS;
      else process.env.CONCORD_SEASONS = prev;
    }
  });

  it("advances seasons across worlds", async () => {
    const db = makeFakeDb();
    db._tables.worlds.set("w1", { id: "w1" });
    db._tables.worlds.set("w2", { id: "w2" });
    const r = await runSeasonCycle({ db });
    assert.equal(r.ok, true);
    assert.equal(r.scanned, 2);
    assert.ok(r.advanced >= 2);
  });
});
