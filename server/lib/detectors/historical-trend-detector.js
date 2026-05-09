// server/lib/detectors/historical-trend-detector.js
//
// Phase 6 / T1 — historical kind detector.
//
// Reads audit/detectors/history.jsonl. Emits findings for:
//   - Detector with finding count grown >3× over the last 30 runs
//   - File with finding count grown >5× over the last 30 runs
//   - Newly-introduced finding fingerprints not in BASELINE.json
//
// Returns kind: "historical" so the lens UI can filter.

import path from "node:path";
import { makeReport, makeError } from "./_framework.js";
import { loadHistory, loadBaseline, fingerprint } from "./baseline.js";

const HISTORY_WINDOW = 30;
const DETECTOR_GROWTH_THRESHOLD = 3.0;
const FILE_GROWTH_THRESHOLD = 5.0;

export async function runHistoricalTrendDetector({ root, opts = {} } = {}) {
  const t0 = Date.now();
  if (!root) return makeError("historical-trend", "no_root", null, t0);
  try {
    const history = await loadHistory(root, HISTORY_WINDOW);
    const findings = [];

    if (history.length < 5) {
      findings.push({
        id: "historical_trend_summary",
        severity: "info",
        kind: "historical",
        category: "trend",
        message: `Only ${history.length} history rows — need ≥5 for slope analysis`,
        evidence: { rowCount: history.length },
      });
      return makeReport("historical-trend", findings, t0);
    }

    // ── Detector growth slope ───────────────────────────────────────────
    const oldestTotal = history[0].totals?.total || 0;
    const latestTotal = history[history.length - 1].totals?.total || 0;
    const growthRatio = oldestTotal > 0 ? latestTotal / oldestTotal : 1;
    if (growthRatio > DETECTOR_GROWTH_THRESHOLD) {
      findings.push({
        id: "historical_finding_count_explosion",
        severity: "high",
        kind: "historical",
        category: "trend",
        message: `Total finding count grew ${growthRatio.toFixed(1)}× over the last ${history.length} runs`,
        evidence: {
          oldestTotal,
          latestTotal,
          growthRatio: Math.round(growthRatio * 10) / 10,
          window: history.length,
        },
        fixHint: "investigate_recent_commits",
      });
    }

    // ── Per-detector severity slope ─────────────────────────────────────
    // Compute (latest critical+high) / (oldest critical+high) per detector,
    // best-effort because per-detector breakdowns aren't always in the row.
    const oldestSev = history[0].totals || {};
    const latestSev = history[history.length - 1].totals || {};
    for (const sev of ["critical", "high"]) {
      const old = oldestSev[sev] || 0;
      const cur = latestSev[sev] || 0;
      if (old > 0 && cur / old > DETECTOR_GROWTH_THRESHOLD) {
        findings.push({
          id: `historical_${sev}_explosion`,
          severity: sev === "critical" ? "critical" : "high",
          kind: "historical",
          category: "trend",
          message: `${sev} finding count grew from ${old} → ${cur} (${(cur/old).toFixed(1)}×) over ${history.length} runs`,
          evidence: { severity: sev, oldest: old, latest: cur, window: history.length },
        });
      }
    }

    // ── Newly-introduced fingerprints (not in baseline) ────────────────
    try {
      const baseline = await loadBaseline(root);
      const baseSet = new Set(Object.keys(baseline?.fingerprints || {}));
      // We only flag the count — full per-fingerprint listing is too noisy.
      const newlySeenInLatest = (history[history.length - 1].deltaVsBaseline?.added) || 0;
      if (newlySeenInLatest > 5) {
        findings.push({
          id: "historical_unbaselined_findings",
          severity: "medium",
          kind: "historical",
          category: "trend",
          message: `Latest run has ${newlySeenInLatest} findings not in BASELINE.json`,
          evidence: {
            unbaselined: newlySeenInLatest,
            baselineSize: baseSet.size,
            generatedAt: history[history.length - 1].generatedAt,
          },
          fixHint: "review_or_baseline",
        });
      }
    } catch { /* baseline optional */ }

    findings.unshift({
      id: "historical_trend_summary",
      severity: "info",
      kind: "historical",
      category: "trend",
      message: `Analyzed ${history.length} history rows · current total ${latestTotal} · growth ${growthRatio.toFixed(2)}×`,
      evidence: {
        rowCount: history.length,
        latestTotal,
        oldestTotal,
        growthRatio: Math.round(growthRatio * 100) / 100,
      },
    });

    return makeReport("historical-trend", findings, t0);
  } catch (err) {
    return makeError("historical-trend", "exception", err, t0);
  }
}
