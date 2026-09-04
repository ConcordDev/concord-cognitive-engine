import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
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
});
