#!/usr/bin/env node
// scripts/audit/gates/animation-transitions.mjs
//
// GATE SUITE — animation-transition graph integrity (no pop / no T-pose).
// Static check over the avatar animation state machine in AnimationManager.tsx:
// every animation state must have a valid outgoing transition entry, every
// transition TARGET must be a real state (no dangling edge → T-pose), and every
// state must be reachable from `idle` (no island a player can enter but the
// machine can't blend into). Pure parse; pattern C (registry cross-check).
// Floor 0 (graph integrity must be perfect). `--ci` exits 1 on any violation.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const SRC = path.join(ROOT, "concord-frontend/components/world-lens/AnimationManager.tsx");
const CI = process.argv.includes("--ci");
const ROOT_STATE = "idle";

// AnimationManager.tsx was retired in the combat-polish refactor (live anim path
// is now the baked biomechanics clip map). No state machine -> nothing to check.
if (!fs.existsSync(SRC)) {
  console.log("animation-transitions: AnimationManager.tsx not present (state machine retired) - graph check skipped.");
  process.exit(0);
}

const text = fs.readFileSync(SRC, "utf8");

// 1) the AvatarAnimation union
const unionM = text.match(/export type AvatarAnimation\s*=\s*([^;]+);/);
const states = new Set([...(unionM?.[1] || "").matchAll(/'([a-z][a-z-]*)'/g)].map((m) => m[1]));

// 2) the avatarTransitions table
const transM = text.match(/const avatarTransitions[^{]*\{([\s\S]*?)\n\};/);
const transitions = {};
if (transM) {
  for (const line of transM[1].split("\n")) {
    const km = line.match(/^\s*'?([a-z][a-z-]*)'?\s*:\s*\[(.*)\]/);
    if (!km) continue;
    transitions[km[1]] = [...km[2].matchAll(/'([a-z][a-z-]*)'/g)].map((m) => m[1]);
  }
}

// 3) timings (informational — locomotion uses defaults)
const timeM = text.match(/const animationTimings[^{]*\{([\s\S]*?)\n\};/);
const timed = new Set(timeM ? [...timeM[1].matchAll(/^\s*'?([a-z][a-z-]*)'?\s*:/gm)].map((m) => m[1]) : []);

// ── checks ───────────────────────────────────────────────────────────────────
const violations = [];
// (a) every union state has a transitions entry (orphan → pops on exit)
for (const s of states) if (!(s in transitions)) violations.push({ kind: "orphan_state", state: s, note: "no outgoing transition entry" });
// (b) every transition target is a real state (dangling → blends to nothing)
for (const [from, tos] of Object.entries(transitions)) {
  if (!states.has(from)) violations.push({ kind: "unknown_source", state: from, note: "transition source not in AvatarAnimation union" });
  for (const to of tos) if (!states.has(to)) violations.push({ kind: "dangling_target", state: `${from}→${to}`, note: "transition target not a real state" });
}
// (c) reachability from idle (BFS) — no island
const seen = new Set([ROOT_STATE]);
const q = [ROOT_STATE];
while (q.length) { const n = q.shift(); for (const to of transitions[n] || []) if (!seen.has(to)) { seen.add(to); q.push(to); } }
for (const s of states) if (!seen.has(s)) violations.push({ kind: "unreachable", state: s, note: `not reachable from '${ROOT_STATE}'` });

const report = {
  generatedAt: new Date().toISOString(),
  states: states.size,
  transitionEntries: Object.keys(transitions).length,
  timedStates: timed.size,
  untimed: [...states].filter((s) => !timed.has(s)), // informational (default-blend)
  violations,
};
fs.mkdirSync(path.join(ROOT, "audit"), { recursive: true });
fs.writeFileSync(path.join(ROOT, "audit/gate-animation-transitions.json"), JSON.stringify(report, null, 2));

console.log(`[anim-transitions] ${states.size} states, ${Object.keys(transitions).length} transition entries`);
console.log(`[anim-transitions] violations: ${violations.length} (target 0)`);
for (const v of violations) console.log(`   ✗ ${v.kind}: ${v.state} — ${v.note}`);
if (violations.length === 0) console.log(`[anim-transitions] ✓ graph integrity clean (all reachable from '${ROOT_STATE}', no dangling/orphan)`);

if (CI && violations.length > 0) { console.error(`[anim-transitions] GATE FAIL: ${violations.length} violation(s)`); process.exit(1); }
