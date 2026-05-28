// server/lib/mahjong/hand.js
//
// Phase E4 — hand state utilities + standard 14-tile win detection.
//
// A winning hand decomposes into 4 melds (each a triplet OR a sequence)
// + 1 pair. We implement a recursive backtracker that tries every
// possible decomposition. There are also special hands (kokushi musou
// = 13 orphans) handled separately.

import { isNumberTile, isHonor, tileSuit, tileValue, isTerminal } from "./tiles.js";

/** Count occurrences of each tile in the hand. Returns Map<tile, count>. */
export function tileCount(tiles) {
  const m = new Map();
  for (const t of tiles) m.set(t, (m.get(t) || 0) + 1);
  return m;
}

/**
 * Returns true if `tiles` (length 14) decomposes into 4 melds + 1 pair.
 * Tries every possible pair, then recursively tries to find 4 melds in
 * the rest.
 */
export function isStandardWinningHand(tiles) {
  if (!Array.isArray(tiles) || tiles.length !== 14) return false;
  const counts = tileCount(tiles);
  // Try each tile as the pair.
  for (const [t, c] of counts) {
    if (c >= 2) {
      const remaining = new Map(counts);
      remaining.set(t, c - 2);
      if (canFormMelds(remaining, 4)) return true;
    }
  }
  return false;
}

/** Returns true if the count map decomposes into N melds with no leftovers. */
function canFormMelds(counts, meldsRemaining) {
  if (meldsRemaining === 0) {
    for (const c of counts.values()) if (c > 0) return false;
    return true;
  }
  // Find the first tile with count > 0 (in canonical order).
  const firstTile = findFirstNonZero(counts);
  if (!firstTile) return false;

  // Option A: triplet (3 of a kind).
  if (counts.get(firstTile) >= 3) {
    const next = new Map(counts);
    next.set(firstTile, counts.get(firstTile) - 3);
    if (canFormMelds(next, meldsRemaining - 1)) return true;
  }

  // Option B: sequence (only for number tiles, suit + n, n+1, n+2).
  if (isNumberTile(firstTile)) {
    const suit = tileSuit(firstTile);
    const v = tileValue(firstTile);
    if (v <= 7) {
      const t2 = `${suit}${v + 1}`;
      const t3 = `${suit}${v + 2}`;
      if ((counts.get(t2) || 0) >= 1 && (counts.get(t3) || 0) >= 1) {
        const next = new Map(counts);
        next.set(firstTile, counts.get(firstTile) - 1);
        next.set(t2, next.get(t2) - 1);
        next.set(t3, next.get(t3) - 1);
        if (canFormMelds(next, meldsRemaining - 1)) return true;
      }
    }
  }
  return false;
}

function findFirstNonZero(counts) {
  // Canonical order: m1..m9, p1..p9, s1..s9, then honors.
  for (const suit of ["m", "p", "s"]) {
    for (let n = 1; n <= 9; n++) {
      const t = `${suit}${n}`;
      if ((counts.get(t) || 0) > 0) return t;
    }
  }
  for (const w of ["wE", "wS", "wW", "wN"]) {
    if ((counts.get(w) || 0) > 0) return w;
  }
  for (const d of ["dR", "dG", "dW"]) {
    if ((counts.get(d) || 0) > 0) return d;
  }
  return null;
}

/**
 * Special hand — kokushi musou (13 orphans): one of each terminal/honor
 * (m1, m9, p1, p9, s1, s9, wE, wS, wW, wN, dR, dG, dW) + one duplicate.
 */
export function isKokushiHand(tiles) {
  if (!Array.isArray(tiles) || tiles.length !== 14) return false;
  const ORPHANS = ["m1", "m9", "p1", "p9", "s1", "s9", "wE", "wS", "wW", "wN", "dR", "dG", "dW"];
  const counts = tileCount(tiles);
  let pair = 0;
  for (const o of ORPHANS) {
    const c = counts.get(o) || 0;
    if (c === 0) return false;
    if (c >= 2) pair++;
  }
  // exactly one of the 13 must be present twice.
  return pair === 1;
}

/** Returns true if any winning shape (standard or kokushi) holds. */
export function isWinningHand(tiles) {
  return isKokushiHand(tiles) || isStandardWinningHand(tiles);
}

/**
 * Sort tiles in canonical order — useful for stable display and
 * deterministic decomposition.
 */
export function sortTiles(tiles) {
  const order = (t) => {
    if (isNumberTile(t)) {
      const suitIdx = { m: 0, p: 1, s: 2 }[t[0]];
      return suitIdx * 10 + tileValue(t);
    }
    const honors = ["wE", "wS", "wW", "wN", "dR", "dG", "dW"];
    return 100 + honors.indexOf(t);
  };
  return tiles.slice().sort((a, b) => order(a) - order(b));
}

/** Decompose a winning hand into melds + pair for yaku detection. */
export function decomposeWinningHand(tiles) {
  if (!isStandardWinningHand(tiles)) return null;
  const counts = tileCount(tiles);
  for (const [t, c] of counts) {
    if (c >= 2) {
      const remaining = new Map(counts);
      remaining.set(t, c - 2);
      const melds = [];
      if (findMelds(remaining, 4, melds)) {
        return { pair: t, melds };
      }
    }
  }
  return null;
}

function findMelds(counts, meldsRemaining, accum) {
  if (meldsRemaining === 0) {
    for (const c of counts.values()) if (c > 0) return false;
    return true;
  }
  const firstTile = findFirstNonZero(counts);
  if (!firstTile) return false;
  // Triplet.
  if (counts.get(firstTile) >= 3) {
    const next = new Map(counts);
    next.set(firstTile, counts.get(firstTile) - 3);
    accum.push({ kind: "triplet", tile: firstTile });
    if (findMelds(next, meldsRemaining - 1, accum)) return true;
    accum.pop();
  }
  // Sequence.
  if (isNumberTile(firstTile)) {
    const suit = tileSuit(firstTile);
    const v = tileValue(firstTile);
    if (v <= 7) {
      const t2 = `${suit}${v + 1}`;
      const t3 = `${suit}${v + 2}`;
      if ((counts.get(t2) || 0) >= 1 && (counts.get(t3) || 0) >= 1) {
        const next = new Map(counts);
        next.set(firstTile, counts.get(firstTile) - 1);
        next.set(t2, next.get(t2) - 1);
        next.set(t3, next.get(t3) - 1);
        accum.push({ kind: "sequence", tiles: [firstTile, t2, t3] });
        if (findMelds(next, meldsRemaining - 1, accum)) return true;
        accum.pop();
      }
    }
  }
  return false;
}

export { isTerminal, isHonor };
