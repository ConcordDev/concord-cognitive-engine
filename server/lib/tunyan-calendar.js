// server/lib/tunyan-calendar.js
//
// Concordia Phase 9 — Tunyan 18-month calendar overlay on the existing
// 6-season × 7-day = 42-day Concordia year (seasons.js, mig 134).
//
// Each Concordia season → 3 Tunyan months. 7 days per season ÷ 3
// months = ~2.33 day/month. We bucket as 2/2/3 — the third month
// always gets the extra day so the harvest / wound / cull months
// (peak agricultural beats) get a slightly longer beat to play in.
//
// Month names from the player-experience spec:
//   Arbor   Cares   Wound       (peak heat season)
//   Prail   Harvest Pisces      (harvest season)
//   Brine   Cull    Hearth      (cure / preserve season)
//   Frost   Hollow  Embers      (winter season)
//   Quicken Thaw    Bloom       (spring season)
//   Lull    Tide    Zenith      (high-summer season)
//
// Indexing: month 1..18 starting from year-day 0. `monthFor(yearDay)`
// returns { monthIndex, monthName, dayInMonth, daysInMonth, seasonId }.

const MONTH_LADDER = Object.freeze([
  // [name, dayCount]
  ["Arbor",   2], ["Cares",   2], ["Wound",   3],     // season 1
  ["Prail",   2], ["Harvest", 2], ["Pisces",  3],     // season 2
  ["Brine",   2], ["Cull",    2], ["Hearth",  3],     // season 3
  ["Frost",   2], ["Hollow",  2], ["Embers",  3],     // season 4
  ["Quicken", 2], ["Thaw",    2], ["Bloom",   3],     // season 5
  ["Lull",    2], ["Tide",    2], ["Zenith",  3],     // season 6
]);

// Precompute starts for fast lookup.
const MONTH_STARTS = (() => {
  const starts = [];
  let acc = 0;
  for (const [, len] of MONTH_LADDER) {
    starts.push(acc);
    acc += len;
  }
  return Object.freeze(starts);
})();

export const YEAR_DAYS = 42;

/**
 * Resolve a Concordia year-day (0..41) into the Tunyan calendar.
 * Returns { monthIndex (1..18), monthName, dayInMonth (1..N),
 * daysInMonth, seasonIndex (1..6) }.
 */
export function monthFor(yearDay) {
  const d = Math.max(0, Math.min(YEAR_DAYS - 1, Math.floor(yearDay)));
  // Find the largest start ≤ d.
  let idx = 0;
  for (let i = 0; i < MONTH_LADDER.length; i++) {
    if (MONTH_STARTS[i] <= d) idx = i;
    else break;
  }
  const [name, len] = MONTH_LADDER[idx];
  const dayInMonth = d - MONTH_STARTS[idx] + 1;
  return {
    monthIndex: idx + 1,
    monthName: name,
    dayInMonth,
    daysInMonth: len,
    seasonIndex: Math.floor(idx / 3) + 1,
  };
}

/** All months as a static manifest (for the calendar overlay UI). */
export function monthsList() {
  return MONTH_LADDER.map(([name, days], i) => ({
    index: i + 1,
    name,
    days,
    seasonIndex: Math.floor(i / 3) + 1,
    startsAtYearDay: MONTH_STARTS[i],
  }));
}

/** Inverse: month index (1..18) + day-in-month → year-day (0..41). */
export function yearDayFor(monthIndex, dayInMonth = 1) {
  const idx = Math.max(0, Math.min(17, Math.floor(monthIndex) - 1));
  const [, len] = MONTH_LADDER[idx];
  const d = Math.max(1, Math.min(len, Math.floor(dayInMonth)));
  return MONTH_STARTS[idx] + d - 1;
}

export const TUNYAN_CALENDAR_CONSTANTS = Object.freeze({
  YEAR_DAYS, MONTH_LADDER, MONTH_STARTS,
});
