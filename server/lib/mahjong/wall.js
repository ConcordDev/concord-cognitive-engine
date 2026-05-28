// server/lib/mahjong/wall.js
//
// Phase E4 — mahjong wall management.
//
// Initial deal: 13 tiles per seat × 4 seats = 52 tiles. Dealer (seat 0)
// then draws one more to bring their starting hand to 14 — the turn
// begins on the dealer's discard.
//
// Dead wall: last 14 tiles of the shuffled deck. The dora indicator is
// the top tile of the dead wall. We don't simulate kan replacement
// (simplification — no kan declarations in v1).

import { buildFreshDeck, shuffleDeterministic } from "./tiles.js";

export const DEAD_WALL_SIZE = 14;
export const HAND_SIZE = 13;
export const SEAT_COUNT = 4;

/**
 * Build a fresh shuffled wall.
 * Returns { wall, deadWall, doraIndicator }.
 * wall is an array indexed [0..(122)]; deadWall has DEAD_WALL_SIZE tiles.
 */
export function newWall(seed) {
  const fresh = buildFreshDeck();
  const shuffled = shuffleDeterministic(fresh, seed);
  // Dead wall = last 14 tiles. Live wall = the rest.
  const deadWall = shuffled.slice(-DEAD_WALL_SIZE);
  const wall = shuffled.slice(0, shuffled.length - DEAD_WALL_SIZE);
  // Dora indicator is the top tile of the dead wall (index 0).
  const doraIndicator = deadWall[0];
  return { wall, deadWall, doraIndicator };
}

/**
 * Deal initial hands. Each seat gets 13 tiles drawn from the live wall.
 * Returns { hands, wallRemaining }.
 */
export function dealInitialHands(wall) {
  if (wall.length < SEAT_COUNT * HAND_SIZE) {
    throw new Error("wall too small for initial deal");
  }
  const hands = Array.from({ length: SEAT_COUNT }, () => []);
  // Standard mahjong deal: 4 tiles at a time × 3 rounds, then 1 each.
  // We simplify: sequential 13-tile blocks per seat. Distribution doesn't
  // affect game outcome under deterministic shuffle.
  let idx = 0;
  for (let seat = 0; seat < SEAT_COUNT; seat++) {
    for (let i = 0; i < HAND_SIZE; i++) {
      hands[seat].push(wall[idx++]);
    }
  }
  return { hands, wallRemaining: wall.length - idx, drawIdx: idx };
}

/**
 * Draw the next tile from the live wall.
 * Returns { tile, drawIdx } or { tile: null, drawIdx } if exhausted.
 */
export function drawNext(wall, drawIdx) {
  if (drawIdx >= wall.length) return { tile: null, drawIdx };
  return { tile: wall[drawIdx], drawIdx: drawIdx + 1 };
}

/** Seat-wind table indexed by seat (0=east, 1=south, 2=west, 3=north). */
export const SEAT_WINDS = ["east", "south", "west", "north"];
