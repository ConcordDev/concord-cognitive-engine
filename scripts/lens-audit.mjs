#!/usr/bin/env node
// scripts/lens-audit.mjs
//
// Deterministic, all-lens, CODE-GROUNDED feature-depth scorecard. The cheap
// triage layer of the lens-audit methodology (see docs/LENS_AUDIT_METHODOLOGY.md):
// it covers every lens from code alone, so the expensive LLM feature-parity
// deep-dive can be aimed where it matters.
//
// Per lens (= backend domain) it assembles, from sources that already exist:
//   • rival app           — scripts/lens-rivals.json (hand-maintained map)
//   • backend substance    — audit/macro-depth-honest.json: macro count + the
//                            substantive tiers (production+utility+functional =
//                            real feature code) vs stub (placeholder). NOTE this
//                            is FEATURE depth, not test depth — "functional" here
//                            means "substantive code, just not behaviorally
//                            tested," which for feature-presence counts as real.
//   • frontend surface     — file count under concord-frontend/app/lenses/<lens>/
//
// Verdict band (deterministic):
//   parity-candidate  big substantive backend (≥60) + real frontend (≥3 files)
//   deep              ≥40 substantive + a frontend
//   facade-risk       UI present (≥3 files) but backend thin (<10 substantive),
//                     OR substantial backend (≥30) with NO frontend surface
//   thin              mostly stub or <10 substantive
//   moderate          everything else
//
// HONEST LIMITATION (state it, don't hide it): this catches "backend deep / no
// UI" and "UI / no backend" facades, but NOT the music-style facade where both
// exist yet the frontend never APPLIES the backend output (EQ stored-but-unwired).
// That requires the LLM deep-dive or a wiring check — the scorecard only triages.
//
//   node scripts/lens-audit.mjs            # ranked table
//   node scripts/lens-audit.mjs --json     # audit/lens-audit.json shape to stdout
//   node scripts/lens-audit.mjs --band facade-risk   # filter

import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const JSON_OUT = process.argv.includes("--json");
const bandFilter = (() => { const i = process.argv.indexOf("--band"); return i >= 0 ? process.argv[i + 1] : null; })();

const gradePath = path.join(ROOT, "audit", "macro-depth-honest.json");
if (!existsSync(gradePath)) { console.error("Run `npm run grade-macros:honest` first."); process.exit(1); }
const grade = JSON.parse(readFileSync(gradePath, "utf8"));
const rivals = JSON.parse(readFileSync(path.join(ROOT, "scripts", "lens-rivals.json"), "utf8"));

// Per-domain tier tally.
const dom = new Map();
for (const m of grade.macros) {
  const d = dom.get(m.domain) || { domain: m.domain, total: 0, production: 0, utility: 0, functional: 0, stub: 0 };
  d.total++; d[m.tier === "production-grade" ? "production" : m.tier]++;
  dom.set(m.domain, d);
}

// Frontend surface: count .ts(x)/.js(x) files under BOTH the lens page dir
// (app/lenses/<lens>/) and its component dir (components/<lens>/) — the real UI
// usually lives in the latter, so counting only the page undercounts badly.
function countFrontend(lens) {
  let n = 0;
  const walk = (p) => {
    if (!existsSync(p)) return;
    for (const e of readdirSync(p, { withFileTypes: true })) {
      if (e.isDirectory()) walk(path.join(p, e.name));
      else if (/\.(tsx?|jsx?)$/.test(e.name)) n++;
    }
  };
  try {
    walk(path.join(ROOT, "concord-frontend", "app", "lenses", lens));
    walk(path.join(ROOT, "concord-frontend", "components", lens));
  } catch { /* noop */ }
  return n;
}

function band(substantive, stubRatio, fe) {
  if (fe >= 3 && substantive < 10) return "facade-risk";        // UI, no backend
  if (substantive >= 30 && fe === 0) return "facade-risk";       // backend, no UI
  if (substantive >= 60 && fe >= 3) return "parity-candidate";
  if (substantive >= 40 && fe >= 1) return "deep";
  if (stubRatio > 0.5 || substantive < 10) return "thin";
  return "moderate";
}

const rows = [];
for (const d of dom.values()) {
  const substantive = d.production + d.utility + d.functional; // real feature code
  const stubRatio = d.total ? d.stub / d.total : 0;
  const fe = countFrontend(d.domain);
  rows.push({
    lens: d.domain,
    rival: rivals[d.domain] ?? null,
    macros: d.total,
    substantive,
    stub: d.stub,
    behaviorallyTested: d.production + d.utility, // honest test-depth, for reference
    frontendFiles: fe,
    band: band(substantive, stubRatio, fe),
  });
}
rows.sort((a, b) => b.substantive - a.substantive);

const out = { generatedAt: new Date().toISOString(), lensCount: rows.length, mappedRivals: rows.filter(r => r.rival).length, lenses: rows };

if (JSON_OUT) { process.stdout.write(JSON.stringify(out, null, 2) + "\n"); }
else {
  const outPath = path.join(ROOT, "audit", "lens-audit.json");
  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n");
  const counts = rows.reduce((a, r) => (a[r.band] = (a[r.band] || 0) + 1, a), {});
  console.log(`Lens feature-depth scorecard — ${rows.length} lenses · ${out.mappedRivals} rivals mapped · wrote audit/lens-audit.json`);
  console.log(`Bands: ${Object.entries(counts).map(([b, n]) => `${b}=${n}`).join("  ")}\n`);
  const show = bandFilter ? rows.filter(r => r.band === bandFilter) : rows.slice(0, 30);
  console.log(`${"lens".padEnd(18)}${"band".padEnd(18)}macros  substv  tested  fe   rival`);
  console.log("─".repeat(92));
  for (const r of show) {
    console.log(`${r.lens.padEnd(18)}${r.band.padEnd(18)}${String(r.macros).padStart(5)}  ${String(r.substantive).padStart(6)}  ${String(r.behaviorallyTested).padStart(6)}  ${String(r.frontendFiles).padStart(3)}   ${r.rival ?? "—"}`);
  }
  if (!bandFilter && rows.length > 30) console.log(`\n…and ${rows.length - 30} more. Filter: --band facade-risk | parity-candidate | thin | deep`);
  console.log(`\nTriage: deep-dive (LLM) the parity-candidates to confirm depth; fix the facade-risk + thin. See docs/LENS_AUDIT_METHODOLOGY.md.`);
}
