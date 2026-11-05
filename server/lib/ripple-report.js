// server/lib/ripple-report.js
// Shaping for observer empirical reports (Observe lens, F2).
//
// narrative.ripple_report returns four raw arrays (grudges, factionMoves,
// regionsSpawned, latticeQuests) read from the world's substrate tables
// over a time window. observer.compose_report used to embed them in the
// report DTU untouched:
//   - the composer's Focus input changed nothing but a summary label —
//     it never shaped the ripple it named;
//   - an empty window rendered as four naked empty arrays, with no
//     statement of what the window had actually covered, so a quiet hour
//     in the substrate read as a ripple-free world.
// This module makes the report say what it observed:
//   - focus: the focus text is matched against every row (case-insensitive
//     term overlap over the row's own fields); matching rows are tagged
//     `focusMatch` and moved first in their array, and the outcome is
//     counted per source and stated in words.
//   - coverage: the window, the four sources by their table names, and
//     the per-source counts — an empty report then reads as "0 recorded
//     in the window" per source, a true statement about the recorded
//     substrate.
// Pure and deterministic: no I/O, no clock reads beyond the caller's
// window, no generated content — it only orders, tags, counts, states.

export const RIPPLE_SOURCES = [
  { key: "grudges", label: "grudges", table: "npc_grudges" },
  { key: "factionMoves", label: "faction moves", table: "faction_strategy_log" },
  { key: "regionsSpawned", label: "regions spawned", table: "procgen_regions" },
  { key: "latticeQuests", label: "lattice quests", table: "lattice_born_quests" },
];

/** Lowercase match terms from a focus string (tokens of length ≥ 3). */
export function focusTerms(focus) {
  if (!focus) return [];
  return [...new Set(String(focus).toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 3))];
}

function rowText(row) {
  if (!row || typeof row !== "object") return "";
  const parts = [];
  for (const v of Object.values(row)) {
    if (typeof v === "string" || typeof v === "number") parts.push(String(v));
  }
  return parts.join(" ").toLowerCase();
}

/**
 * Shape a ripple_report payload for the empirical report.
 * input:  the `ripples` object ({ grudges, factionMoves, regionsSpawned, latticeQuests })
 * opts:   { focus, worldId, sinceTs, untilTs } — timestamps in unix seconds.
 * Returns { ripples, focus, coverage } where ripples' arrays are focus-ordered
 * and tagged, focus is the focus outcome (null when no focus was given), and
 * coverage states the window, sources, and counts in data + words.
 */
export function shapeRippleReport(ripples, opts = {}) {
  const src = ripples && typeof ripples === "object" ? ripples : {};
  const terms = focusTerms(opts.focus);
  const shaped = {};
  const counts = {};
  const matched = {};
  let matchedTotal = 0;
  let total = 0;
  for (const { key } of RIPPLE_SOURCES) {
    const rows = Array.isArray(src[key]) ? src[key] : [];
    counts[key] = rows.length;
    total += rows.length;
    if (terms.length === 0) {
      shaped[key] = rows;
      matched[key] = 0;
      continue;
    }
    const hit = [];
    const miss = [];
    for (const row of rows) {
      const text = rowText(row);
      if (terms.some((t) => text.includes(t))) hit.push({ ...row, focusMatch: true });
      else miss.push(row);
    }
    matched[key] = hit.length;
    matchedTotal += hit.length;
    shaped[key] = [...hit, ...miss];
  }

  const sinceTs = Number.isFinite(opts.sinceTs) ? opts.sinceTs : null;
  const untilTs = Number.isFinite(opts.untilTs) ? opts.untilTs : (sinceTs != null ? sinceTs + 3600 : null);
  const countsText = RIPPLE_SOURCES.map(({ key, label }) => `${label} ${counts[key]}`).join(" · ");
  const sourcesText = RIPPLE_SOURCES.map(({ table }) => table).join(", ");
  const windowText = sinceTs != null && untilTs != null
    ? `the hour ${new Date(sinceTs * 1000).toISOString()} → ${new Date(untilTs * 1000).toISOString()}`
    : "the stated window";
  const coverage = {
    worldId: opts.worldId || "concordia-hub",
    sinceTs,
    untilTs,
    windowSeconds: sinceTs != null && untilTs != null ? untilTs - sinceTs : null,
    sources: RIPPLE_SOURCES.map(({ key, label, table }) => ({ key, label, table, count: counts[key] })),
    total,
    statement: `Coverage: ${windowText} in world ${opts.worldId || "concordia-hub"} — ${countsText} (sources: ${sourcesText}). Counts are rows the world engines recorded in that window; an empty source means nothing was recorded, not that the world was inactive.`,
  };

  let focus = null;
  if (opts.focus) {
    const perSourceText = RIPPLE_SOURCES
      .filter(({ key }) => matched[key] > 0)
      .map(({ key, label }) => `${label} ${matched[key]}`)
      .join(" · ");
    focus = {
      text: String(opts.focus),
      terms,
      matchedTotal,
      perSource: matched,
      statement: matchedTotal > 0
        ? `Focus "${opts.focus}": ${matchedTotal} of ${total} recorded rows match (${perSourceText}); matching rows are listed first in their arrays and tagged focusMatch.`
        : `Focus "${opts.focus}": no recorded row in the window matches it; the report below is the window's full record.`,
    };
  }

  return { ripples: shaped, focus, coverage };
}
