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
import { up as up447 } from "../migrations/447_settlement_region.js";
import { foundSettlement, abandonSettlement } from "../lib/concordia-megaworld.js";
import { buildKingdomSnapshot, resolveWorldKey, KINGDOM_FORMAT } from "../lib/concordia-kingdom-snapshot.js";

const src = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../lib/concordia-kingdom-snapshot.js"),
  "utf8",
);

describe("concordia kingdom snapshot — authored graph only", () => {
  it("resolves folder, enum, and alias to the same world", () => {
    assert.equal(resolveWorldKey("Hub"), "concordia-hub");
    assert.equal(resolveWorldKey("concordia-hub"), "concordia-hub");
    assert.equal(resolveWorldKey("Tunya"), "tunya");
    assert.equal(resolveWorldKey("not-a-world"), null);
  });

  it("Hub: Court is the city, eight Ring doors, Watch ownership, empty caravans", () => {
    const s = buildKingdomSnapshot(null, "concordia-hub");
    assert.equal(s.ok, true);
    assert.equal(s.format, KINGDOM_FORMAT);
    assert.equal(s.title, "The Unburned Court");
    assert.equal(s.kingdom.staple, "lanterns");
    assert.equal(s.kingdom.stock, null);
    assert.equal(s.settlements.length, 0);
    assert.ok(s.notes.some((n) => /Court is the city/i.test(n)));
    assert.equal(s.gates.length, 8);
    assert.ok(s.gates.every((g) => g.ownerFaction === "Concordant Watch"));
    assert.deepEqual(s.caravans, []);
    assert.deepEqual(s.tariffs, []);
    assert.ok(s.factions.some((f) => f.id === "concordant_watch"));
    assert.ok(s.actors.some((a) => a.id === "lord_curator_asbir_thelane"));
  });

  it("Sere is a waystone, not a ninth Refusal gate", () => {
    const s = buildKingdomSnapshot(null, "Sere");
    assert.equal(s.ok, true);
    assert.equal(s.kingdom.staple, "marks");
    assert.equal(s.gates.length, 1);
    assert.equal(s.gates[0].waystone, true);
    assert.equal(s.gates[0].ninthRefusal, false);
    assert.match(s.gates[0].note, /not a ninth Refusal gate/);
  });

  it("Tunya settlements come from authored countries, not invented names", () => {
    const s = buildKingdomSnapshot(null, "tunya");
    assert.equal(s.ok, true);
    assert.equal(s.kingdom.staple, "harvest");
    assert.ok(s.settlements.some((c) => c.id === "dinye" && c.name === "Dinye Gate"));
    assert.ok(!s.settlements.some((c) => /Aurelia/i.test(c.name)));
    assert.ok(s.factions.some((f) => f.id === "sandrun_sanguire"));
  });

  it("unknown world is an honest failure", () => {
    const s = buildKingdomSnapshot(null, "made-up-kingdom");
    assert.equal(s.ok, false);
    assert.equal(s.reason, "unknown_world");
  });

  it("never authors Aurelia or a spoken confession", () => {
    assert.doesNotMatch(src, /Aurelia/);
    assert.doesNotMatch(src, /Concord admits he loves her/);
    const hub = JSON.stringify(buildKingdomSnapshot(null, "hub"));
    assert.doesNotMatch(hub, /Aurelia/);
    assert.doesNotMatch(hub, /Concord admits he loves her/);
  });

  it("kernel overlay stamps abandoned status onto the authored name; does not invent a mill", () => {
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
    up447(db);
    const authored = buildKingdomSnapshot(null, "tunya");
    assert.ok(authored.settlements.some((c) => c.name === "Dinye Gate"));
    const found = foundSettlement(db, { worldId: "tunya", name: "Dinye Gate", centerX: 0, centerZ: 0 });
    assert.equal(found.ok, true);
    abandonSettlement(db, found.id, { reason: "the grove went quiet" });
    const live = buildKingdomSnapshot(db, "tunya");
    const row = live.settlements.find((s) => s.name === "Dinye Gate");
    assert.ok(row);
    assert.equal(row.status, "abandoned");
    assert.ok(live.abandonedCount >= 1);
    assert.ok(live.notes.some((n) => /abandoned/i.test(n)));
    assert.doesNotMatch(JSON.stringify(live), /mill was built/i);
    db.close();
  });
});
