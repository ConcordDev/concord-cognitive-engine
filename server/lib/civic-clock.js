// server/lib/civic-clock.js
//
// Concordia Phase 9 — civic clock overlay on NPC routines.
//
// NPC routines (mig 130) give each NPC 8 three-hour blocks per day.
// The Tunyan civic clock per the player spec uses "Nsun" notation:
//   5sun-7sun  morning open (theaters, post collection)
//   7sun-9sun  early work
//   9sun-11sun mid-morning work
//  11sun-13sun mid-diurnal meal
//  13sun-15sun afternoon work
//  15sun-17sun afternoon trade
//  17sun-19sun evening / tea
//  19sun-22sun late / amphitheater
//
// `blockToCivic(blockIndex)` maps a routine block to the civic
// window label. `civicNowFor(yearDay, blockIndex)` is the player-
// facing summary string.

const CIVIC_BLOCKS = Object.freeze([
  { idx: 0, range: "5sun-7sun",   label: "morning open" },
  { idx: 1, range: "7sun-9sun",   label: "early work" },
  { idx: 2, range: "9sun-11sun",  label: "mid work" },
  { idx: 3, range: "11sun-13sun", label: "mid-diurnal meal" },
  { idx: 4, range: "13sun-15sun", label: "afternoon work" },
  { idx: 5, range: "15sun-17sun", label: "trade" },
  { idx: 6, range: "17sun-19sun", label: "tea" },
  { idx: 7, range: "19sun-22sun", label: "amphitheater" },
]);

const ACTIVITY_BY_BLOCK = Object.freeze({
  vendor:   ["stall_open", "stall_open", "stall_open", "first_meal", "stall_open", "stall_open", "stall_closing", "rest"],
  fisherman:["boat_launch","fish","fish","mid_meal","fish","market_sell","rest","rest"],
  guard:    ["patrol","patrol","patrol","mid_meal","patrol","patrol","watch","watch"],
  scholar:  ["read","write","write","mid_meal","didactic_hall","write","conversation","rest"],
});

export function blockToCivic(blockIndex) {
  const idx = Math.max(0, Math.min(7, Math.floor(blockIndex)));
  return CIVIC_BLOCKS[idx];
}

export function civicBlocksList() {
  return CIVIC_BLOCKS.slice();
}

export function activityForRole(role, blockIndex) {
  const list = ACTIVITY_BY_BLOCK[role];
  if (!list) return null;
  const idx = Math.max(0, Math.min(7, Math.floor(blockIndex)));
  return list[idx];
}

export const CIVIC_CLOCK_CONSTANTS = Object.freeze({
  CIVIC_BLOCKS, ACTIVITY_BY_BLOCK,
});
