#!/usr/bin/env node
// scripts/depth-backlog.mjs
//
// Pick the next behavioral-test batch by LEVERAGE. Reads the honest grade
// (audit/macro-depth-honest.json) and ranks lens-action domains by how much
// testing their untested macros would move the honest floor — so each session
// grabs the highest-value 3–5 domains instead of guessing.
//
// "Leverage" is computed by projecting each untested macro's tier IF it were
// behaviorally tested (mirrors grade-macro-depth.mjs#classifyTier with
// exercised=true) and summing (projected_weight − current_weight) / total. That
// is the literal honest-floor delta the domain's batch would deliver.
//
// Read-only. Run `npm run grade-macros:honest` first if the grade is stale.
//   node scripts/depth-backlog.mjs            # top domains
//   node scripts/depth-backlog.mjs --all      # every domain with untested macros
//   node scripts/depth-backlog.mjs --json

import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ALL = process.argv.includes("--all");
const JSON_OUT = process.argv.includes("--json");

const W = { stub: 0.0, functional: 0.4, utility: 0.6, "production-grade": 1.0 };

// Mirror grade-macro-depth.mjs#classifyTier, assuming the macro becomes
// exercised (a real behavioral test is added). Order matters — utility (≤40)
// is checked before the production paths, exactly as the grader does.
function projectedTier(m) {
  const robustness = m.tryCatch || m.realtimeEmit || m.runsOtherMacro || m.externalIO || m.heartbeatDelegate || m.artifactWrite;
  // delegates && hasTest → production (rule D) — but the ≤40 utility check fires first.
  if (m.combinedLoc <= 40 && !m.externalIO) return "utility";
  if (m.combinedLoc >= 40 && m.stateTouch && robustness) return "production-grade";
  if (m.externalIO && m.tryCatch) return "production-grade";
  if (m.combinedLoc >= 40 && m.tryCatch) return "production-grade";
  if (m.delegates) return "production-grade";
  return "functional";
}

function isLensActionDomain(domain) {
  const f = path.join(ROOT, "server", "domains", `${domain}.js`);
  if (!existsSync(f)) return false;
  try { return new RegExp(`registerLensAction\\(\\s*["'\`]${domain.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}["'\`]`).test(readFileSync(f, "utf8")); }
  catch { return false; }
}

const jsonPath = path.join(ROOT, "audit", "macro-depth-honest.json");
if (!existsSync(jsonPath)) {
  console.error("No audit/macro-depth-honest.json — run `npm run grade-macros:honest` first.");
  process.exit(1);
}
const j = JSON.parse(readFileSync(jsonPath, "utf8"));
const total = j.total;

const byDom = new Map();
for (const m of j.macros) {
  if (m.hasTest) continue; // already credited
  if (m.tier !== "functional" && m.tier !== "stub") continue; // only untested-and-uncredited
  const d = byDom.get(m.domain) || { domain: m.domain, untested: 0, projProd: 0, projUtil: 0, gain: 0 };
  d.untested++;
  const pt = projectedTier(m);
  if (pt === "production-grade") d.projProd++; else if (pt === "utility") d.projUtil++;
  d.gain += (W[pt] - W[m.tier]) / total; // honest-floor delta this macro would add
  byDom.set(m.domain, d);
}

let rows = [...byDom.values()].map((d) => ({ ...d, lensAction: isLensActionDomain(d.domain) }));
rows = rows.filter((d) => d.lensAction); // the multiplier's addressable set
rows.sort((a, b) => b.gain - a.gain);

if (JSON_OUT) {
  process.stdout.write(JSON.stringify({ honestFloor: j.weightedScore, total, domains: rows }, null, 2) + "\n");
  process.exit(0);
}

const show = ALL ? rows : rows.slice(0, 15);
const totalGain = rows.reduce((s, d) => s + d.gain, 0);
console.log(`Honest depth floor: ${j.weightedScore}  ·  ${rows.length} lens-action domains have untested macros`);
console.log(`If ALL of them were behaviorally tested, the floor would rise ~+${totalGain.toFixed(3)} (toward the ceiling).\n`);
console.log(`${"domain".padEnd(20)} untested  →prod  →util   floor-gain`);
console.log("─".repeat(64));
for (const d of show) {
  console.log(`${d.domain.padEnd(20)} ${String(d.untested).padStart(6)}  ${String(d.projProd).padStart(5)}  ${String(d.projUtil).padStart(5)}   +${d.gain.toFixed(4)}`);
}
const batch = rows.slice(0, 5);
console.log(`\nSuggested next batch (top 5 by leverage): ${batch.map((d) => d.domain).join(", ")}`);
console.log(`  → ~+${batch.reduce((s, d) => s + d.gain, 0).toFixed(3)} to the honest floor.`);
console.log(`Next: npm run depth:scaffold ${batch[0]?.domain}`);
