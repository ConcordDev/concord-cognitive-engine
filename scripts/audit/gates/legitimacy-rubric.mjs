#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// GATE — Temperament P6 legitimacy rubric (Graham v. Connor 3-factor).
//
// Pins the use-of-force verdict math so a regression in scoreEncounter (the
// proportionality core the restraint system + the kill-route spare gate lean on)
// fails CI instead of silently legalising excessive force. Runs the rubric
// against canonical encounters and asserts the verdict + ceiling.
//
// Run: node scripts/audit/gates/legitimacy-rubric.mjs [--ci]
// ─────────────────────────────────────────────────────────────────────────────

import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const { scoreEncounter } = await import(path.join(here, "../../../server/lib/legitimacy.js"));

// [label, input, expectedVerdict, expectedCeiling]
const CASES = [
  ["lethal vs warned immediate threat", { crimeSeverity: 0.9, immediateThreat: 1, activeResistance: 1, forceUsed: "lethal", warned: true }, "legitimate", "lethal"],
  ["lethal vs no-threat non-resisting", { crimeSeverity: 0, immediateThreat: 0, activeResistance: 0, forceUsed: "lethal", warned: true }, "unlawful", "none"],
  ["lethal without warning", { crimeSeverity: 0.6, immediateThreat: 0.6, activeResistance: 0.6, forceUsed: "lethal", warned: false }, "excessive", "lethal"],
  ["nonlethal vs resister", { crimeSeverity: 0.5, immediateThreat: 0.2, activeResistance: 0.8, forceUsed: "nonlethal" }, "legitimate", "nonlethal"],
  ["none vs calm civilian", { crimeSeverity: 0, immediateThreat: 0, activeResistance: 0, forceUsed: "none" }, "legitimate", "none"],
  ["nonlethal vs calm civilian", { crimeSeverity: 0, immediateThreat: 0, activeResistance: 0, forceUsed: "nonlethal" }, "excessive", "none"],
];

const fails = [];
for (const [label, input, wantV, wantC] of CASES) {
  const r = scoreEncounter(input);
  if (r.verdict !== wantV) fails.push(`${label}: verdict ${r.verdict} ≠ ${wantV}`);
  if (r.justifiedCeiling !== wantC) fails.push(`${label}: ceiling ${r.justifiedCeiling} ≠ ${wantC}`);
}

const ci = process.argv.includes("--ci");
if (fails.length) {
  console.error(`[legitimacy-rubric] ${fails.length} rubric regression(s):`);
  for (const f of fails) console.error("  ✗ " + f);
  process.exit(ci ? 1 : 0);
} else {
  console.log(`[legitimacy-rubric] OK — ${CASES.length}/${CASES.length} canonical encounters score correctly.`);
  process.exit(0);
}
