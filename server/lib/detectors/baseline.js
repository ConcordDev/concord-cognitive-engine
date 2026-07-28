// server/lib/detectors/baseline.js
//
// Baseline + history + diff infrastructure for the detector suite.
//
//   audit/detectors/BASELINE.json — committed snapshot of accepted findings,
//     fingerprinted as sha256(detector + path + line + ruleId).
//   audit/detectors/history.jsonl — append-only one-line-per-run record.
//   audit/detectors/BUDGET.json   — total finding count cap (Phase 10).
//
// CI fails on NEW critical/high findings; baseline-known findings are
// "acknowledged" and pass.

import { readFile, writeFile, mkdir, appendFile } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

export function fingerprint(finding, detectorId) {
  const loc = finding.location || "";
  const rule = finding.id || "";
  const sev = finding.severity || "";
  const h = crypto.createHash("sha256");
  h.update(`${detectorId}|${rule}|${loc}|${sev}`);
  return h.digest("hex").slice(0, 16);
}

export function reportFingerprints(report) {
  const out = new Map();
  for (const r of report?.reports || []) {
    for (const f of r.findings || []) {
      const fp = fingerprint(f, r.id);
      out.set(fp, { detector: r.id, finding: f });
    }
  }
  return out;
}

export async function loadBaseline(rootDir) {
  const p = path.join(rootDir, "audit", "detectors", "BASELINE.json");
  try {
    const raw = await readFile(p, "utf-8");
    return JSON.parse(raw);
  } catch {
    return { version: 1, generatedAt: null, fingerprints: {}, totals: null };
  }
}

export async function saveBaseline(rootDir, report) {
  const fps = reportFingerprints(report);
  const baseline = {
    version: 1,
    generatedAt: new Date().toISOString(),
    totals: report.totals,
    detectorCount: report.detectorCount,
    fingerprints: Object.fromEntries(
      [...fps.entries()].map(([fp, v]) => [
        fp,
        {
          detector: v.detector,
          id: v.finding.id,
          severity: v.finding.severity,
          kind: v.finding.kind,
          location: v.finding.location || null,
          message: (v.finding.message || "").slice(0, 200),
        },
      ]),
    ),
  };
  const p = path.join(rootDir, "audit", "detectors", "BASELINE.json");
  await mkdir(path.dirname(p), { recursive: true });
  await writeFile(p, JSON.stringify(baseline, null, 2));
  return { ok: true, fingerprintCount: fps.size, path: p };
}

/**
 * Strip the `:line` (and optional `:col`) suffix off a location, leaving the
 * file. `server/server.js:75506` -> `server/server.js`.
 */
function locationFile(loc) {
  return String(loc || "").replace(/:\d+(?::\d+)?$/, "");
}

/**
 * Identity of a finding IGNORING its line number.
 *
 * The fingerprint is sha256(detector|rule|location|severity) and `location`
 * carries the line, so ANY commit that shifts lines re-fingerprints findings
 * that did not change — they then present as "added" and, if high/critical,
 * redden the ratchet. That is not a hypothetical: a +1061-line diff in
 * server.js re-fingerprinted `creditWallet` (74445 -> 75506), `debitWallet`
 * (74505 -> 75566) and `requestAccountDeletion` (42 -> 43), all with byte-
 * identical messages, and CLAUDE.md already documents the property as "the
 * reason a red ratchet carries less signal than it looks like it does".
 *
 * A gate that fires on non-events trains people to re-baseline past it, which
 * is the exact goalpost-moving this whole subsystem exists to prevent. So a
 * moved finding is now recognised as moved rather than new. Note this does NOT
 * relax what counts as new: the message and the FILE must both still match, so
 * a genuinely new finding — new file, new rule, or changed message — is
 * unaffected.
 */
function movedKey(detector, id, severity, location, message) {
  // Baseline stores message truncated to 200; truncate both sides to compare.
  return [detector, id || "", severity || "", locationFile(location), String(message || "").slice(0, 200)].join("|");
}

/** Compute new vs. retired vs. moved vs. unchanged findings against the baseline. */
export function diffAgainstBaseline(report, baseline) {
  const current = reportFingerprints(report);
  const baseFps = new Set(Object.keys(baseline.fingerprints || {}));

  const added = []; // findings in current that weren't in baseline
  const removed = []; // fingerprints in baseline that aren't in current
  const unchanged = [];
  const moved = []; // same finding, different line — NOT new

  const pendingCurrent = [];
  for (const [fp, v] of current.entries()) {
    if (baseFps.has(fp)) unchanged.push({ fp, ...v });
    else pendingCurrent.push({ fp, ...v });
  }
  const pendingBase = [];
  for (const fp of baseFps) {
    if (!current.has(fp)) pendingBase.push({ fp, ...baseline.fingerprints[fp] });
  }

  // Second pass over the leftovers only: pair a current finding with a
  // baseline finding that is identical apart from its line. Matching is
  // STRICTLY ONE-TO-ONE (each baseline entry is consumed at most once), so if
  // the baseline held one occurrence and the tree now has two, exactly one is
  // "moved" and the other is correctly still "added".
  const baseByKey = new Map();
  for (const b of pendingBase) {
    const k = movedKey(b.detector, b.id, b.severity, b.location, b.message);
    if (!baseByKey.has(k)) baseByKey.set(k, []);
    baseByKey.get(k).push(b);
  }
  for (const c of pendingCurrent) {
    const k = movedKey(c.detector, c.finding?.id, c.finding?.severity, c.finding?.location, c.finding?.message);
    const bucket = baseByKey.get(k);
    if (bucket && bucket.length) {
      const from = bucket.shift();
      moved.push({ ...c, fromFingerprint: from.fp, fromLocation: from.location });
    } else {
      added.push(c);
    }
  }
  // A baseline entry that got paired is not "removed" — it is still present,
  // just at a new line. Only genuinely-gone entries remain.
  const movedFrom = new Set(moved.map((m) => m.fromFingerprint));
  for (const b of pendingBase) {
    if (!movedFrom.has(b.fp)) removed.push(b);
  }

  // Severity-bucketed summaries for quick CLI output
  const addedBySeverity = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const a of added) {
    const s = a.finding?.severity || "info";
    addedBySeverity[s] = (addedBySeverity[s] || 0) + 1;
  }
  return {
    added, removed, unchanged, moved,
    addedCount: added.length,
    removedCount: removed.length,
    unchangedCount: unchanged.length,
    movedCount: moved.length,
    addedBySeverity,
  };
}

/** Append a line to history.jsonl. Idempotent — caller decides cadence. */
export async function appendHistory(rootDir, report, opts = {}) {
  const p = path.join(rootDir, "audit", "detectors", "history.jsonl");
  await mkdir(path.dirname(p), { recursive: true });
  const line = JSON.stringify({
    generatedAt: report.generatedAt,
    totals: report.totals,
    detectorCount: report.detectorCount,
    durationMs: report.durationMs,
    gitSha: opts.gitSha || null,
    deltaVsBaseline: opts.delta ? {
      added: opts.delta.addedCount,
      removed: opts.delta.removedCount,
    } : null,
  }) + "\n";
  await appendFile(p, line, "utf-8");
  return { ok: true, path: p };
}

/** Read recent history (last N rows). */
export async function loadHistory(rootDir, n = 30) {
  const p = path.join(rootDir, "audit", "detectors", "history.jsonl");
  try {
    const raw = await readFile(p, "utf-8");
    const lines = raw.split("\n").filter(Boolean);
    return lines.slice(-n).map(l => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(Boolean);
  } catch {
    return [];
  }
}

/** Load the debt budget — Phase 10 permanence-layer gate. */
export async function loadBudget(rootDir) {
  const p = path.join(rootDir, "audit", "detectors", "BUDGET.json");
  try {
    const raw = await readFile(p, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Decide if CI should fail given a delta + budget. */
export function ciDecision(delta, totals, budget) {
  // Hard fail on any new critical or high findings
  const newCriticalOrHigh = (delta.addedBySeverity.critical || 0) + (delta.addedBySeverity.high || 0);
  if (newCriticalOrHigh > 0) {
    return { pass: false, reason: "new_high_or_critical", count: newCriticalOrHigh };
  }
  // Budget gate (Phase 10): fail if total exceeds budget × 1.05
  if (budget?.maxTotal && totals.total > budget.maxTotal * 1.05) {
    return {
      pass: false,
      reason: "budget_exceeded",
      total: totals.total,
      budget: budget.maxTotal,
      threshold: Math.round(budget.maxTotal * 1.05),
    };
  }
  return { pass: true };
}
