#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// GATE — Temperament P4/P5 restraint wire intact.
//
// The restraint system is only load-bearing if its outcome gate stays wired into
// the live kill path. This static gate asserts:
//   1. the kill route (routes/worlds.js) still calls shouldSpareExecution before
//      triggerNPCDeath — i.e. a surrendered/downed/arrested NPC can't be executed;
//   2. combat-restraint.js still exports the contract surface (shouldSpareExecution,
//      applyCombatHit, nextCombatState) the rest of the system depends on.
// If a refactor silently removes the gate, CI fails instead of quietly
// re-enabling the execute-the-surrendered war-crime path.
//
// Run: node scripts/audit/gates/restraint-wire.mjs [--ci]
// ─────────────────────────────────────────────────────────────────────────────

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "../../..");
const read = (p) => { try { return fs.readFileSync(path.join(root, p), "utf8"); } catch { return ""; } };

const fails = [];

const worlds = read("server/routes/worlds.js");
// The spare gate must appear, and before the (first) triggerNPCDeath call.
const spareIdx = worlds.indexOf("shouldSpareExecution");
const killIdx = worlds.indexOf("triggerNPCDeath");
if (spareIdx === -1) fails.push("kill route no longer calls shouldSpareExecution");
else if (killIdx !== -1 && spareIdx > killIdx) fails.push("shouldSpareExecution runs AFTER triggerNPCDeath (gate is dead code)");

const lib = read("server/lib/combat-restraint.js");
for (const sym of ["shouldSpareExecution", "applyCombatHit", "nextCombatState", "assessForce"]) {
  if (!new RegExp(`export\\s+function\\s+${sym}\\b`).test(lib)) fails.push(`combat-restraint.js no longer exports ${sym}`);
}

const ci = process.argv.includes("--ci");
if (fails.length) {
  console.error(`[restraint-wire] ${fails.length} regression(s):`);
  for (const f of fails) console.error("  ✗ " + f);
  process.exit(ci ? 1 : 0);
} else {
  console.log("[restraint-wire] OK — kill route gates on shouldSpareExecution; restraint contract surface intact.");
  process.exit(0);
}
