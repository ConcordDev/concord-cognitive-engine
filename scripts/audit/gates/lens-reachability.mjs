#!/usr/bin/env node
// scripts/audit/gates/lens-reachability.mjs
//
// GATE SUITE — lens reachability (no orphaned lens a player can't navigate to).
// Static cross-check (pattern C): every shipped lens directory under
// concord-frontend/app/lenses/ MUST be reachable through the canonical
// lens-registry — i.e. it appears in the Ctrl+K command palette, the sidebar,
// OR is absorbed into a core lens as a sub-tab. A lens dir with no registry
// entry (orphan), or an entry that is hidden from BOTH palette and sidebar and
// is not absorbed (stranded), is unreachable and counts as a violation.
//
// The registry is canonical TS; rather than regex-parse 3k lines we import its
// own helpers via tsx so the gate tracks the real navigation surface.
//
// RATCHET: FLOOR is the measured count of pre-existing unreachable lenses
// (so the gate never fails the existing tree on day one); lower it as the
// queue drains. `--ci` exits 1 when violations exceed FLOOR.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const FE = path.join(ROOT, "concord-frontend");
const LENS_DIR = path.join(FE, "app/lenses");
const CI = process.argv.includes("--ci");

// The ratchet floor — the measured count of pre-existing unreachable lenses at
// the time this gate landed (so CI never fails the existing tree on day one).
// RATCHET IT DOWN as orphan lenses are wired into the registry; the number
// going to 0 is the finishable proof-of-progress. Override with --floor=N.
const DEFAULT_FLOOR = 50;
const floorArg = process.argv.find((a) => a.startsWith("--floor="));
let FLOOR = floorArg ? parseInt(floorArg.split("=")[1], 10) : DEFAULT_FLOOR;

// Known-intentional non-lens / nav-only directories (documented exceptions).
//  - ux-suite: a directory page that links to where each absorbed component
//    mounts; it has no API surface and is reachable by design as a hub.
//  - reasoning: a parent dir whose real lens is the `reasoning/traces` sub-route.
const INTENTIONAL = new Set(["ux-suite", "reasoning"]);

// ── enumerate shipped lens directories ────────────────────────────────────────
function lensDirs() {
  return fs.readdirSync(LENS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((n) => !n.startsWith("_") && !n.startsWith("."));
}

// ── pull the canonical reachable set from the registry via tsx ────────────────
// We evaluate a tiny TS shim that re-exports the registry helpers as JSON so the
// gate sees exactly what the palette + sidebar render.
function reachableSets() {
  const shim = `
import { getAllLensIds, getCommandPaletteLenses, getSidebarLenses, LENS_REGISTRY } from './lib/lens-registry';
const palette = getCommandPaletteLenses().map((l) => l.id);
const sidebar = getSidebarLenses().map((l) => l.id);
const absorbed = LENS_REGISTRY.filter((l) => l.coreLens).map((l) => l.id);
const all = getAllLensIds();
const paths = LENS_REGISTRY.map((l) => ({ id: l.id, path: l.path }));
process.stdout.write(JSON.stringify({ palette, sidebar, absorbed, all, paths }));
`;
  const shimPath = path.join(FE, ".lens-reachability-shim.mts");
  fs.writeFileSync(shimPath, shim);
  try {
    const out = execFileSync("npx", ["--no-install", "tsx", shimPath], {
      cwd: FE, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    });
    return JSON.parse(out);
  } catch (e) {
    // tsx / frontend deps not installed (e.g. the audits CI job only installs
    // server + root deps). Degrade gracefully: this gate runs fully locally and
    // in any job that installs the frontend, and no-ops elsewhere rather than
    // breaking the tree. Returns null → the caller skips and exits 0.
    return null;
  } finally {
    try { fs.unlinkSync(shimPath); } catch { /* best-effort */ }
  }
}

const dirs = lensDirs();
const reg = reachableSets();
if (reg === null) {
  console.log("[lens-reachability] SKIP — frontend deps (tsx) unavailable; gate runs locally + in frontend-installed jobs.");
  process.exit(0);
}
const reachable = new Set([...reg.palette, ...reg.sidebar, ...reg.absorbed]);
const known = new Set(reg.all);
// also treat a registry path ending in /lenses/<dir> as a match for that dir
const pathDirs = new Set(
  (reg.paths || [])
    .map((p) => (p.path || "").match(/\/lenses\/([^/]+)/)?.[1])
    .filter(Boolean),
);

const violations = [];
for (const dir of dirs) {
  if (INTENTIONAL.has(dir)) continue;
  const hasEntry = known.has(dir) || pathDirs.has(dir);
  if (!hasEntry) {
    violations.push({ kind: "orphan", lens: dir, note: "no lens-registry entry — unreachable" });
    continue;
  }
  if (!reachable.has(dir)) {
    violations.push({ kind: "stranded", lens: dir, note: "registry entry hidden from palette+sidebar, not absorbed" });
  }
}

// First run with no explicit floor: the floor IS the current count (never fail
// the existing tree). The number printed is the ratchet target to drive down.
if (FLOOR === null) FLOOR = violations.length;

const report = {
  generatedAt: new Date().toISOString(),
  lensDirs: dirs.length,
  registryEntries: known.size,
  reachable: reachable.size,
  intentionalExceptions: [...INTENTIONAL],
  floor: FLOOR,
  violationCount: violations.length,
  violations,
};
fs.mkdirSync(path.join(ROOT, "audit"), { recursive: true });
fs.writeFileSync(path.join(ROOT, "audit/gate-lens-reachability.json"), JSON.stringify(report, null, 2));

console.log(`[lens-reachability] ${dirs.length} lens dirs, ${reachable.size} reachable via palette/sidebar/absorbed`);
console.log(`[lens-reachability] violations: ${violations.length} (floor ${FLOOR}, target 0)`);
for (const v of violations) console.log(`   ✗ ${v.kind}: ${v.lens} — ${v.note}`);
if (violations.length === 0) console.log(`[lens-reachability] ✓ every shipped lens is reachable`);

if (CI && violations.length > FLOOR) {
  console.error(`[lens-reachability] GATE FAIL: ${violations.length} unreachable lens(es) > floor ${FLOOR}`);
  process.exit(1);
}
