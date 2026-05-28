// server/lib/mahjong/npc-discard.js
//
// Phase E4 — NPC discard heuristics (3 styles).
//
// Each style returns the index of the tile to discard from a 14-tile
// hand. Selection is deterministic given (sessionSeed, npcId, turn) so
// replays are stable.

import { isHonor, isTerminal, isNumberTile, tileSuit, tileValue } from "./tiles.js";
import { tileCount } from "./hand.js";

/**
 * Style 'safe' — defensive. Discards the tile most likely to be safe
 * against the visible discards across all opponents.
 */
export function discardSafe(hand14, ctx = {}) {
  const allDiscards = (ctx.allDiscards || []).flat();
  const seenCount = tileCount(allDiscards);
  let bestIdx = 0;
  let bestSafety = -1;
  for (let i = 0; i < hand14.length; i++) {
    const t = hand14[i];
    const sc = seenCount.get(t) || 0;
    // Higher seen count → safer (since fewer can win on it).
    const safety = sc * 10 + (isHonor(t) ? 3 : 0);
    if (safety > bestSafety) { bestSafety = safety; bestIdx = i; }
  }
  return bestIdx;
}

/**
 * Style 'tempai' — greedy. Discards whatever doesn't contribute to a
 * meld (triplet potential or sequence potential).
 */
export function discardTempai(hand14, _ctx = {}) {
  const counts = tileCount(hand14);
  let bestIdx = 0;
  let worstScore = Infinity;
  for (let i = 0; i < hand14.length; i++) {
    const t = hand14[i];
    let score = 0;
    // Triplet potential.
    const c = counts.get(t) || 0;
    score += (c - 1) * 3; // 0 for solo, 3 for pair, 6 for triplet etc.
    // Sequence potential for number tiles.
    if (isNumberTile(t)) {
      const s = tileSuit(t);
      const v = tileValue(t);
      for (const off of [-2, -1, 1, 2]) {
        const nv = v + off;
        if (nv < 1 || nv > 9) continue;
        if ((counts.get(`${s}${nv}`) || 0) > 0) score++;
      }
    }
    if (score < worstScore) { worstScore = score; bestIdx = i; }
  }
  return bestIdx;
}

/**
 * Style 'yakuhunt' — picks a target yaku (e.g. honitsu) and discards
 * tiles not contributing. For v1 we pick honitsu: discard tiles outside
 * the dominant suit (or honors).
 */
export function discardYakuhunt(hand14, _ctx = {}) {
  // Identify dominant suit.
  const suitCounts = { m: 0, p: 0, s: 0 };
  for (const t of hand14) {
    if (isNumberTile(t)) suitCounts[tileSuit(t)]++;
  }
  const dominant = Object.entries(suitCounts).sort((a, b) => b[1] - a[1])[0][0];
  for (let i = 0; i < hand14.length; i++) {
    const t = hand14[i];
    if (isNumberTile(t) && tileSuit(t) !== dominant) return i;
  }
  // Fallback: tempai discard.
  return discardTempai(hand14);
}

const STYLES = {
  safe: discardSafe,
  tempai: discardTempai,
  yakuhunt: discardYakuhunt,
};

/** Public dispatch. */
export function discardByStyle(style, hand14, ctx = {}) {
  const fn = STYLES[style] || discardTempai;
  return fn(hand14, ctx);
}

export const NPC_STYLES = Object.freeze(["safe", "tempai", "yakuhunt"]);
