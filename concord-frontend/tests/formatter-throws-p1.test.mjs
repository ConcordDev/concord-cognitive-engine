// Formatter P1 — THROWS class (Lead-priced 2026-11-03 from B6's
// local-formatter census; register §6/B4; claim Mac ledger line 181).
//
// The census's THROWS class: 13 local numeric formatters dereferenced
// their argument unguarded (.toFixed / .toLocaleString / .toString on
// the raw value), so an absent value (null/undefined from JSON data)
// crashed the call — and, in a render, took the panel down. P1 applies
// ONE guard idiom across all thirteen: absence (null/undefined) or a
// non-finite number renders the guarded set's honest absence '—';
// present values render exactly as before (a present 0 still renders
// as a figure — TrackCard's 'Free' included).
//
// These pins are source pins in node:test form (the commonsense-build
// precedent): each row asserts the guard line stands in the defining
// file ahead of the dereference. On the pristine tree every row fails
// (no guard exists); that is the negative control.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(join(here, "..", rel), "utf8");

const GUARD = /== null \|\| !Number\.isFinite\(/;

// [file, definition anchor] — the census's 13 THROWS rows, file:line
// of record at the census (main 0513f2ad6), all re-verified at
// 1f7a2f925. The anchor is the DEFINITION site (a bare name would match
// an earlier call site or comment in the same file).
const ROWS = [
  ["components/concordia/world/LeaderboardPanel.tsx", "const formatScore = (score"],
  ["components/finance/OverviewPanel.tsx", "const fmtPct = (v"],
  ["components/law/BillingCalculator.tsx", "const fmtUsd = (v"],
  ["components/trades/ProjectDeskPanel.tsx", "const fmtCurrency = (v"],
  ["components/markets/MarketsQuoteDetail.tsx", "function formatCurrency(n"],
  ["components/markets/MarketsQuoteDetail.tsx", "function formatCompact(n"],
  ["components/media/UniversalPlayer.tsx", "function formatViewCount(count"],
  ["components/music/TrackCard.tsx", "function formatPrice(price"],
  ["components/sim/SimConsole.tsx", "function formatNumber(n"],
  ["components/lens/IndicatorChart.tsx", "function formatValue(v"],
  ["components/lens/IndicatorChart.tsx", "function formatValueShort(v"],
  ["components/tick/TickStreamContext.tsx", "const formatMs = useCallback"],
  ["components/studio/EffectsPanel.tsx", "function formatParamValue(key"],
];

test("P1: every THROWS formatter carries the absence guard idiom", () => {
  for (const [file, anchor] of ROWS) {
    const src = read(file);
    const defAt = src.indexOf(anchor);
    assert.ok(defAt >= 0, `${file}: definition anchor missing (${anchor})`);
    const body = src.slice(defAt, defAt + 700);
    assert.ok(GUARD.test(body), `${file}: ${anchor} lacks the absence guard (== null || !Number.isFinite)`);
    assert.ok(body.includes("return '—'") || body.includes("? '—'"), `${file}: ${anchor} guard does not render the honest absence '—'`);
  }
});

test("P1: the guard precedes the dereference in the largest surface (ProjectDeskPanel fmtCurrency, 32 sites)", () => {
  const src = read("components/trades/ProjectDeskPanel.tsx");
  const defAt = src.indexOf("const fmtCurrency");
  const body = src.slice(defAt, defAt + 300);
  const guardAt = body.search(GUARD);
  const derefAt = body.indexOf(".toLocaleString");
  assert.ok(guardAt >= 0 && derefAt >= 0 && guardAt < derefAt, "guard must stand before .toLocaleString in fmtCurrency");
});

test("P1: present values keep their shipped renders (the guard is absence-only)", () => {
  // TrackCard: a present 0 is 'Free', not an absence.
  const track = read("components/music/TrackCard.tsx");
  assert.ok(track.includes("price === 0 ? 'Free'"), "TrackCard present-zero render changed");
  // OverviewPanel: the signed-percent shape stands behind the guard.
  const overview = read("components/finance/OverviewPanel.tsx");
  assert.ok(overview.includes("${v.toFixed(2)}%"), "OverviewPanel fmtPct present render changed");
  // IndicatorChart: the GDP branch fabricates nothing new — the guard
  // stands ahead of it and the branch itself is untouched.
  const chart = read("components/lens/IndicatorChart.tsx");
  assert.ok(chart.includes("code?.includes('GDP')"), "IndicatorChart GDP branch changed");
});

test("P1: the exported row (TickStreamContext formatMs) guards inside the callback its consumers call", () => {
  const src = read("components/tick/TickStreamContext.tsx");
  const defAt = src.indexOf("const formatMs = useCallback");
  assert.ok(defAt >= 0, "formatMs useCallback definition missing");
  const body = src.slice(defAt, defAt + 260);
  assert.ok(GUARD.test(body), "formatMs lacks the absence guard");
  assert.ok(body.indexOf("return '—'") >= 0, "formatMs guard does not render '—'");
});
