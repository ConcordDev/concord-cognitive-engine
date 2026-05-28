/**
 * T1.5 — Creature baseline feed coverage.
 *
 * procedural-creature.js grounded generated creatures against
 * content/world/<world>/creatures.json only. tunya (the flagship) keeps its
 * fauna in bestiary.json, and 4 worlds had no creatures.json at all — so 5 of
 * 9 worlds silently spawned ungrounded generic creatures.
 *
 * The loader now reads creatures.json AND bestiary.json (normalized), and the
 * 4 empty worlds were authored. This test asserts every authored world resolves
 * >= 1 baseline, and that tunya specifically grounds from its bestiary.
 *
 * Run: node --test tests/integration/creature-baseline-feed.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { listBaselines, matchBaseline } from "../../lib/procedural-creature.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WORLD_ROOT = path.resolve(HERE, "..", "..", "..", "content", "world");

function authoredWorlds() {
  return readdirSync(WORLD_ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith("_"))
    .map((d) => d.name)
    .filter((w) => existsSync(path.join(WORLD_ROOT, w, "npcs.json")));
}

describe("T1.5 — every authored world grounds creatures", () => {
  it("resolves >= 1 baseline for every world (no silent-empty worlds)", () => {
    const worlds = authoredWorlds();
    assert.ok(worlds.length >= 9, `expected the 9 authored worlds, found ${worlds.length}`);
    const empty = worlds.filter((w) => listBaselines(w).length === 0);
    assert.deepEqual(empty, [], `these worlds still ground zero creatures: ${empty.join(", ")}`);
  });

  it("baselines expose name + description so matchBaseline can score them", () => {
    for (const w of authoredWorlds()) {
      for (const c of listBaselines(w)) {
        assert.ok(c.name && typeof c.name === "string", `${w}: baseline missing name`);
        assert.equal(typeof c.description, "string", `${w}: baseline ${c.name} description must be a string`);
      }
    }
  });

  it("tunya grounds from bestiary.json (the flagship-gap regression)", () => {
    const tunya = listBaselines("tunya");
    assert.ok(tunya.length > 0, "tunya must ground creatures from its bestiary");
    // at least one came through the bestiary normalizer
    assert.ok(tunya.some((c) => c._source === "bestiary"), "tunya baselines should include normalized bestiary fauna");
  });

  it("matchBaseline still works against a real authored creature", () => {
    const crime = listBaselines("crime");
    assert.ok(crime.length > 0);
    const sample = crime[0];
    const hit = matchBaseline("crime", sample.name);
    assert.ok(hit, `matchBaseline should find '${sample.name}' by name`);
  });
});
