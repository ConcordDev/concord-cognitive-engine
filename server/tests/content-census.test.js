/**
 * Content census guard — the authored content (per-world NPCs/factions + minigame
 * libs) is AT TARGET. Fails if any surface regresses below its curated target, so
 * content can't be silently removed. Mirrors `node scripts/author/census.mjs --ci`.
 * Run: node --test server/tests/content-census.test.js
 */
import { describe, it } from "node:test";
import assert from "node:assert";
import { census } from "../../scripts/author/census.mjs";

describe("content census", () => {
  it("is AT TARGET (no world gaps, no lib gaps)", () => {
    const r = census();
    assert.deepEqual(r.worldGaps, [], `world gaps: ${r.worldGaps.join(", ")}`);
    assert.deepEqual(r.libGaps, [], `lib gaps: ${r.libGaps.join(", ")}`);
    assert.equal(r.ok, true);
  });
});
