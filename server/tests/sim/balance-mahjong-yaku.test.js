// Phase G3.3 — mahjong yaku distribution sim.
//
// Seeds 500 deterministic mahjong hands using the existing wall +
// hand utilities. For each, generates a random "winning hand" by
// drawing 14 tiles and checking if it's a standard winning shape.
// Tallies the detected yaku frequencies and computes recommended
// scoring adjustments for any class > 2× mean or < 0.5× mean.
//
// Writes audit/balance/mahjong-yaku.json.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import { newWall, dealInitialHands } from "../../lib/mahjong/wall.js";
import { isStandardWinningHand, isKokushiHand, sortTiles } from "../../lib/mahjong/hand.js";
import { detectYaku } from "../../lib/mahjong/yaku-detect.js";
import { discardByStyle } from "../../lib/mahjong/npc-discard.js";

const SIM_GAMES = 500;
const ROOT = join(import.meta.dirname, "..", "..", "..");

function simulateOneGame(seed) {
  const wallState = newWall(seed);
  const dealt = dealInitialHands(wallState.wall);
  // Play out the dealer's hand only — draw, discard, repeat until
  // either a winning hand emerges or wall is exhausted.
  let hand = sortTiles([...dealt.hands[0]]);
  let drawIdx = dealt.drawIdx;
  let turns = 0;
  while (drawIdx < wallState.wall.length && turns < 80) {
    const drawn = wallState.wall[drawIdx++];
    hand = sortTiles([...hand, drawn]);
    if (hand.length === 14) {
      if (isStandardWinningHand(hand) || isKokushiHand(hand)) {
        const yaku = detectYaku(hand, { roundWind: "east", seatWind: "east", opened: false });
        return { won: true, yaku, turns };
      }
      // Discard worst tile (use the tempai heuristic).
      const idx = discardByStyle("tempai", hand);
      hand = hand.filter((_, i) => i !== idx);
    }
    turns++;
  }
  return { won: false, yaku: [], turns };
}

describe("Phase G3.3 — mahjong yaku distribution sim", () => {
  it("simulates 500 dealer-hand games + writes audit/balance/mahjong-yaku.json", () => {
    const yakuCounts = new Map();
    let won = 0, lost = 0;
    let totalTurns = 0;
    for (let g = 0; g < SIM_GAMES; g++) {
      const r = simulateOneGame(g + 1);
      if (r.won) {
        won++;
        for (const y of r.yaku) yakuCounts.set(y, (yakuCounts.get(y) || 0) + 1);
      } else lost++;
      totalTurns += r.turns;
    }
    const yakuArray = [...yakuCounts.entries()]
      .map(([yaku, count]) => ({ yaku, count, frequency: count / Math.max(1, won) }))
      .sort((a, b) => b.count - a.count);

    const meanFreq = yakuArray.reduce((a, b) => a + b.frequency, 0) / Math.max(1, yakuArray.length);
    const outliers = yakuArray.filter((y) => y.frequency > 2 * meanFreq || y.frequency < 0.5 * meanFreq);

    const outDir = join(ROOT, "audit", "balance");
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, "mahjong-yaku.json"), JSON.stringify({
      sprint: "G3.3",
      games: SIM_GAMES,
      gamesWon: won,
      gamesLost: lost,
      winRate: Math.round((won / SIM_GAMES) * 1000) / 1000,
      avgTurnsToTerminal: Math.round((totalTurns / SIM_GAMES) * 10) / 10,
      yakuDistribution: yakuArray,
      meanFrequency: Math.round(meanFreq * 1000) / 1000,
      outliers,
      note: outliers.length === 0
        ? "All yaku within balanced range (0.5×-2× mean frequency)"
        : "Outlier yaku detected — consider re-weighting scoring",
    }, null, 2));
    assert.ok(true);
  });
});
