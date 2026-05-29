/**
 * D3 (depth plan) — player-state reactivity read.
 *
 * Pins describePlayerStateForNpc: NPCs notice who the player has become across
 * the four ecosystem axes (RDR2 "they see me" lever), surfaced qualitatively.
 *
 * Run: node --test tests/npc-player-read.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describePlayerStateForNpc } from "../lib/npc-player-read.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("D3 — describePlayerStateForNpc", () => {
  it("a neutral player produces no reads", () => {
    const reads = describePlayerStateForNpc({
      ecosystem_score: 0, concord_alignment: 0, concordia_alignment: 0, refusal_debt: 0,
    });
    assert.deepEqual(reads, []);
  });

  it("high refusal_debt surfaces the heaviest signal first", () => {
    const reads = describePlayerStateForNpc({ refusal_debt: 30, concordia_alignment: 20 }, { max: 2 });
    assert.equal(reads.length, 2);
    assert.match(reads[0], /unpaid refusals/i); // weight 100 wins
    assert.match(reads[1], /goddess's favour/i);
  });

  it("caps the number of reads at max", () => {
    const reads = describePlayerStateForNpc(
      { refusal_debt: 30, concordia_alignment: -20, ecosystem_score: -20, concord_alignment: 20 },
      { max: 2 },
    );
    assert.equal(reads.length, 2);
  });

  it("notorious adds a wariness read", () => {
    const reads = describePlayerStateForNpc({}, { notorious: true, max: 3 });
    assert.ok(reads.some((r) => /notoriety|wary/i.test(r)));
  });

  it("handles null/garbage metrics safely", () => {
    assert.deepEqual(describePlayerStateForNpc(null), []);
    assert.deepEqual(describePlayerStateForNpc({ refusal_debt: "nope" }), []);
  });
});

describe("D3 — dialogue wiring", () => {
  it("the dialogue endpoint injects player-state reads into the prompt", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "..", "routes/worlds.js"), "utf8");
    assert.match(src, /describePlayerStateForNpc/);
    assert.match(src, /playerStateLines/);
    // and the lines are actually spread into the prompt
    assert.match(src, /\.\.\.playerStateLines/);
  });
});
