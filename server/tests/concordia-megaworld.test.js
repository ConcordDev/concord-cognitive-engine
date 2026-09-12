/**
 * Persistent megaworld spine: topology laws, abandon-not-delete, whyPlace honesty.
 *
 *   cd server && node --test tests/concordia-megaworld.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { up as up287 } from "../migrations/287_settlements.js";
import { up as up286 } from "../migrations/286_chronicle.js";
import { up as up416 } from "../migrations/416_world_consequences.js";
import { up as up446 } from "../migrations/446_settlement_identity.js";
import {
  flowerLawGoverns,
  intendedTravelMode,
  currentTravelMode,
  CURRENT_TRAVEL_MODE,
  foundSettlement,
  abandonSettlement,
  whyPlace,
  presentationForSettlement,
  countPopulation,
  getSettlement,
} from "../lib/concordia-megaworld.js";
import { composeEntry } from "../lib/chronicle/compose.js";
import { decaySettlementForRegion, spawnSettlementForRegion } from "../lib/procgen-settlements.js";
import { listConsequences } from "../lib/world-consequence.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

function mkDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE world_npcs (
      id TEXT PRIMARY KEY, world_id TEXT, name TEXT, archetype TEXT,
      npc_type TEXT, state TEXT, is_dead INTEGER DEFAULT 0
    );
  `);
  up287(db);
  up286(db);
  up416(db);
  up446(db);
  return db;
}

describe("megaworld topology laws", () => {
  it("Flower Law governs only the Hub", () => {
    assert.equal(flowerLawGoverns("concordia-hub"), true);
    assert.equal(flowerLawGoverns("Hub"), true);
    assert.equal(flowerLawGoverns("fantasy"), false);
    assert.equal(flowerLawGoverns("sere"), false);
    assert.equal(flowerLawGoverns("tunya"), false);
  });

  it("current travel is region_rebuild; overland is intended, not claimed", () => {
    assert.equal(currentTravelMode().mode, CURRENT_TRAVEL_MODE);
    assert.equal(CURRENT_TRAVEL_MODE, "region_rebuild");
    assert.equal(intendedTravelMode("fantasy", "fantasy").mode, "stay");
    assert.equal(intendedTravelMode("concordia-hub", "fantasy").mode, "link_gate");
    assert.equal(intendedTravelMode("fantasy", "tunya").mode, "overland");
    const canon = readFileSync(
      join(root, "apps/concordia-living-world/unity-client/Assets/Concordia/Scripts/Canon.cs"),
      "utf8",
    );
    assert.match(canon, /steelLive = false/);
    assert.match(canon, /Flower-law is the Court only/);
  });
});

describe("settlement identity", () => {
  it("founding writes a row and a place beat; whyPlace does not invent a mill", () => {
    const db = mkDb();
    const r = foundSettlement(db, { worldId: "fantasy", name: "Harrow", centerX: 12, centerZ: -4 });
    assert.equal(r.ok, true);
    const why = whyPlace(db, r.id);
    assert.equal(why.ok, true);
    assert.equal(why.settlement.name, "Harrow");
    assert.equal(why.settlement.status, "active");
    assert.equal(why.settlement.population, 0);
    assert.deepEqual(why.settlement.founders, []);
    assert.equal(why.history.length, 1);
    assert.equal(why.history[0].kind, "settlement_founded");
    assert.doesNotMatch(why.history[0].body, /mill|spring|plague/i);
    const card = presentationForSettlement(db, r.id);
    assert.equal(card.livePopulation, 0);
  });

  it("abandon sets status and keeps the row", () => {
    const db = mkDb();
    const r = foundSettlement(db, { worldId: "fantasy", name: "Old Harrow" });
    const gone = abandonSettlement(db, r.id, { reason: "Red Fever" });
    assert.equal(gone.ok, true);
    assert.equal(gone.status, "abandoned");
    const row = getSettlement(db, r.id);
    assert.ok(row, "abandoned settlement is still a row");
    assert.equal(row.status, "abandoned");
    assert.ok(row.abandoned_at > 0);
    const n = db.prepare(`SELECT COUNT(*) AS n FROM settlements WHERE id = ?`).get(r.id).n;
    assert.equal(n, 1);
    const why = whyPlace(db, r.id);
    assert.equal(why.settlement.status, "abandoned");
    assert.equal(why.history.length, 2);
    assert.match(why.history[1].body, /Red Fever/);
    assert.match(why.history[1].body, /row remains/);
    const settled = listConsequences(db, { action: "settle", worldId: "fantasy" });
    const abandoned = listConsequences(db, { action: "abandon", worldId: "fantasy" });
    assert.equal(settled.length, 1);
    assert.equal(abandoned.length, 1);
    assert.equal(abandoned[0].longTerm.buildings_remain, true);
  });

  it("whyPlace on a missing id is not_found, not a fabricated town", () => {
    const db = mkDb();
    const why = whyPlace(db, "stl_nobody");
    assert.equal(why.ok, false);
    assert.equal(why.reason, "not_found");
  });

  it("population is a live count, never a made-up census", () => {
    const db = mkDb();
    const r = foundSettlement(db, { worldId: "tunya", name: "Reedford" });
    assert.equal(countPopulation(db, r.id), 0);
    db.prepare(`
      INSERT INTO world_npcs (id, world_id, name, archetype, npc_type, state, is_dead, settlement_id)
      VALUES ('n1','tunya','Asha','farmer','npc','{}',0,?)
    `).run(r.id);
    db.prepare(`
      INSERT INTO world_npcs (id, world_id, name, archetype, npc_type, state, is_dead, settlement_id)
      VALUES ('n2','tunya','dead','farmer','npc','{}',1,?)
    `).run(r.id);
    assert.equal(countPopulation(db, r.id), 1);
  });
});

describe("composers refuse empty place myths", () => {
  it("place_event without a body is not composed", () => {
    const c = composeEntry("place_event", {});
    assert.equal(c.ok, false);
  });

  it("place_event uses only the supplied line", () => {
    const c = composeEntry("place_event", { name: "Harrow", body: "A mill was built.", title: "Mill" });
    assert.equal(c.ok, true);
    assert.equal(c.body, "A mill was built.");
    assert.equal(c.title, "Mill");
  });
});

describe("procgen decay tombstones, it does not DELETE", () => {
  it("decayed NPCs remain queryable by count", () => {
    const db = new Database(":memory:");
    const spawned = spawnSettlementForRegion(db, {
      id: "reg_1",
      world_id: "fantasy",
      anchor_x: 0,
      anchor_z: 0,
      radius_m: 80,
    });
    assert.equal(spawned.ok, true);
    assert.ok(spawned.npcs.length >= 3);
    const before = db.prepare(`SELECT COUNT(*) AS n FROM procgen_settlement_npcs`).get().n;
    const d = decaySettlementForRegion(db, "reg_1");
    assert.equal(d.ok, true);
    const after = db.prepare(`SELECT COUNT(*) AS n FROM procgen_settlement_npcs`).get().n;
    assert.equal(after, before);
    const live = db.prepare(`SELECT COUNT(*) AS n FROM procgen_settlement_npcs WHERE decayed_at IS NULL`).get().n;
    assert.equal(live, 0);
  });
});
