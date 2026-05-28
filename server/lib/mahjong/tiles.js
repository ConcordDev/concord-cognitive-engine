// server/lib/mahjong/tiles.js
//
// Phase E4 — mahjong tile definitions.
//
// 144 tiles total:
//   - manzu (characters): m1..m9 × 4 copies = 36
//   - pinzu (circles):    p1..p9 × 4 copies = 36
//   - souzu (bamboo):     s1..s9 × 4 copies = 36
//   - winds: E S W N      × 4 copies each = 16
//   - dragons: R G W      × 4 copies each = 12 (W = white)
//   - flowers / seasons: 8 (not used in standard play; we omit for simplicity)
//     Wait — 36 + 36 + 36 + 16 + 12 = 136. Standard riichi uses 136, not 144.
//     We'll go with 136 (riichi-canonical). The plan said 144; that's the
//     Hong Kong / classical count which includes flowers. We use 136.
//
// Tile string format:
//   "m1" .. "m9", "p1" .. "p9", "s1" .. "s9"
//   "wE", "wS", "wW", "wN"
//   "dR", "dG", "dW"

export const SUIT_TILES = (() => {
  const arr = [];
  for (const s of ["m", "p", "s"]) {
    for (let n = 1; n <= 9; n++) arr.push(`${s}${n}`);
  }
  return arr;
})();

export const WIND_TILES = ["wE", "wS", "wW", "wN"];
export const DRAGON_TILES = ["dR", "dG", "dW"];
export const HONOR_TILES = [...WIND_TILES, ...DRAGON_TILES];

export const ALL_DISTINCT_TILES = [...SUIT_TILES, ...HONOR_TILES]; // 34
export const COPIES_PER_TILE = 4;
export const TOTAL_TILES = ALL_DISTINCT_TILES.length * COPIES_PER_TILE; // 136

/** Build a fresh 136-tile array (4 copies of each distinct tile). */
export function buildFreshDeck() {
  const deck = [];
  for (const t of ALL_DISTINCT_TILES) {
    for (let c = 0; c < COPIES_PER_TILE; c++) deck.push(t);
  }
  return deck;
}

/** Deterministic Fisher-Yates with a seeded LCG so replays are reproducible. */
export function shuffleDeterministic(arr, seed = 1) {
  const out = arr.slice();
  let s = seed >>> 0;
  function next() {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  }
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Numeric tile? (m/p/s suits with 1..9 value) */
export function isNumberTile(tile) {
  return /^[mps][1-9]$/.test(tile);
}

/** Numeric value of a number tile (1..9), or 0 for honors. */
export function tileValue(tile) {
  return isNumberTile(tile) ? Number(tile[1]) : 0;
}

/** Suit char (m/p/s) for a number tile, or null for honors. */
export function tileSuit(tile) {
  return isNumberTile(tile) ? tile[0] : null;
}

/** True if tile is a wind. */
export function isWind(tile) { return /^w[ESWN]$/.test(tile); }
/** True if tile is a dragon. */
export function isDragon(tile) { return /^d[RGW]$/.test(tile); }
/** True if tile is an honor (wind or dragon). */
export function isHonor(tile) { return isWind(tile) || isDragon(tile); }
/** Terminal = 1 or 9 of a number suit. */
export function isTerminal(tile) {
  if (!isNumberTile(tile)) return false;
  const v = tileValue(tile);
  return v === 1 || v === 9;
}
