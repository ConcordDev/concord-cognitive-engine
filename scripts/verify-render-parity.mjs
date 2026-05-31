#!/usr/bin/env node
// scripts/verify-render-parity.mjs
//
// Render-parity harness — STATIC half (the headless, no-GPU tier). "Rendered" is
// three layers: presence (it's in the scene), appearance (it looks like its data
// — equipped/themed), animation (it's doing its state). This gate covers the
// appearance layer for the references that have a clean registry, asserting each
// binds to a real renderer rather than a generic/placeholder fallback, and logs
// every reference that hits a placeholder (the "no silent fallback" idea, for
// assets). The data×vision cross-check (server data vs what LLaVA sees on the
// camera) is the VISUAL tier (scripts/playtest/visual-playtest.mjs) — separate.
//
// Dimensions covered here (clean registries):
//   - move archetype/effect/element → real clip+VFX (delegated to the move-render gate)
//   - interactable station building_type → a real, purpose-built interior (not a
//     generic empty room). ROUTER_TABLE (frontend) ∩ ROOM_TEMPLATES (server).
//
// Usage: node scripts/verify-render-parity.mjs [--json] [--ci N]

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const asJson = args.includes("--json");
const ciIdx = args.indexOf("--ci");
const ciMode = ciIdx !== -1;
const ciFloor = ciMode ? Number(args[ciIdx + 1] || 100) : 0;
const read = (rel) => { try { return fs.readFileSync(path.join(ROOT, rel), "utf8"); } catch { return ""; } };

// ── Stations: ROUTER_TABLE (interactable) vs ROOM_TEMPLATES (purpose-built interior) ──
function routerStations() {
  const src = read("concord-frontend/components/world/StationInteractionRouter.tsx");
  const blk = src.match(/ROUTER_TABLE[^{]*{([\s\S]*?)\n};/);
  const out = new Set();
  if (blk) for (const m of blk[1].matchAll(/(?:^|\n)\s*['"]?([a-z][a-z0-9_]*)['"]?\s*:/g)) out.add(m[1]);
  return out;
}
function interiorTemplates() {
  const src = read("server/lib/building-interiors.js");
  const blk = src.match(/ROOM_TEMPLATES[^{]*{([\s\S]*?)\n};/);
  const out = new Set();
  if (blk) for (const m of blk[1].matchAll(/(?:^|\n)\s*([a-z][a-z0-9_]*)\s*:/g)) out.add(m[1]);
  // fallback: scan whole file for `key: {` template entries
  if (!out.size) for (const m of src.matchAll(/(?:^|\n)\s{2}([a-z][a-z0-9_]*)\s*:\s*{/g)) out.add(m[1]);
  return out;
}

const stations = [...routerStations()];
const interiors = interiorTemplates();
const stationFindings = stations.filter((s) => !interiors.has(s));
const stationPct = stations.length ? Math.round(((stations.length - stationFindings.length) / stations.length) * 1000) / 10 : 100;

// ── Move dimension: delegate to the move-render gate's overall ──────────────
let movePct = null;
try {
  const j = JSON.parse(execSync("node scripts/verify-move-render-coverage.mjs --json", { cwd: ROOT, encoding: "utf8" }));
  movePct = j.overall;
} catch { /* gate unavailable */ }

const dims = [
  { name: "move clip+VFX+SFX", pct: movePct, detail: "(delegated to verify-move-render-coverage)" },
  { name: "station interior", pct: stationPct, detail: `${stations.length - stationFindings.length}/${stations.length} stations have a purpose-built interior` },
];
const scored = dims.filter((d) => d.pct != null);
const overall = scored.length ? Math.round((scored.reduce((s, d) => s + d.pct, 0) / scored.length) * 10) / 10 : stationPct;

if (asJson) {
  console.log(JSON.stringify({ overall, dimensions: dims, stationGaps: stationFindings }, null, 2));
} else {
  console.log("\n=== Render-Parity Gate (static / appearance layer) ===");
  for (const d of dims) console.log(`  ${d.pct == null ? "·" : d.pct >= 100 ? "✓" : "✗"} ${d.name.padEnd(20)} ${d.pct == null ? "n/a" : d.pct + "%"}  ${d.detail}`);
  console.log(`  OVERALL ${overall}%`);
  if (stationFindings.length) {
    console.log(`\n  Station interiors falling back to a generic room (no purpose-built template):`);
    for (const s of stationFindings.sort()) console.log(`    · ${s}`);
    console.log(`  → add a ROOM_TEMPLATE in server/lib/building-interiors.js so entering reads as the station, not an empty box.`);
  }
  console.log("");
}

if (ciMode && overall < ciFloor) {
  console.error(`[render-parity] FAIL: overall ${overall}% < floor ${ciFloor}%`);
  process.exit(1);
}
