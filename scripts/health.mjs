#!/usr/bin/env node
// scripts/health.mjs
//
// The unified health report — "is Concordia present, alive, and legible?"
// Runs the self-deriving gates (Instrument 1) and prints ONE composite number +
// the per-gate gap list. Designed to grow: as the agent-playtest harness
// (Instrument 2) and the remaining gates land, add them to GATES below and they
// join the dashboard automatically. Trust this over the docs.
//
// Each gate is wrapped so one failure never crashes the dashboard (graceful
// floor). Usage: node scripts/health.mjs [--ci]

import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ci = process.argv.includes('--ci');

// Every call site passes a fixed, space-separated `node scripts/X.mjs [--json]`
// literal (no shell metacharacters), so split-and-execFile is equivalent and
// removes the shell entirely — no injection surface.
function run(cmd) {
  const [bin, ...args] = cmd.split(' ');
  try { return execFileSync(bin, args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); }
  catch (e) { return (e.stdout || '') + (e.stderr || ''); }
}
function readJson(rel) { try { return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8')); } catch { return null; } }

// Each gate: { name, pct (0..100|null), floor, detail } — pct null = unavailable.
const gates = [];

// 1. Move-render coverage
try {
  const j = JSON.parse(run('node scripts/verify-move-render-coverage.mjs --json'));
  gates.push({ name: 'move-render', pct: j.overall, floor: 100,
    detail: `arch ${j.layers.archetype} / vfx ${j.layers.vfx} / sfx ${j.layers.sfx}; ${j.findings.length} fallbacks` });
} catch { gates.push({ name: 'move-render', pct: null, floor: 100, detail: 'gate errored' }); }

// 2. Event-consumer (legibility)
try {
  const j = JSON.parse(run('node scripts/verify-event-consumers.mjs --json'));
  gates.push({ name: 'event-consumer', pct: j.consumedPct, floor: 64,
    detail: `${j.consumed}/${j.emitted} consumed; ${j.silent} silent events` });
} catch { gates.push({ name: 'event-consumer', pct: null, floor: 64, detail: 'gate errored' }); }

// 3. Lens-backend wiring (existing verifier; tolerant text parse)
try {
  const out = run('node scripts/verify-lens-backends.mjs');
  const w = out.match(/"?WIRED"?\s*[:=]\s*(\d+)/) || out.match(/(\d+)\s+WIRED/i);
  const wired = w ? Number(w[1]) : null;
  gates.push({ name: 'lens-backend', pct: wired != null && wired >= 234 ? 100 : (wired != null ? 90 : null),
    floor: 100, detail: wired != null ? `${wired} WIRED (need ≥234)` : 'unparsed' });
} catch { gates.push({ name: 'lens-backend', pct: null, floor: 100, detail: 'verifier errored' }); }

// 3b. Economic invariants (the exploit gate, static half)
try {
  const j = JSON.parse(run("node scripts/verify-economic-invariants.mjs --json"));
  const bad = j.invariants.filter((i) => !i.ok).length + j.derived.filter((d) => !d.ok).length;
  gates.push({ name: "economic-inv", pct: j.ok ? 100 : 0, floor: 100,
    detail: j.ok ? "all constitutional constants hold" : `${bad} drifted` });
} catch { gates.push({ name: "economic-inv", pct: null, floor: 100, detail: "gate errored" }); }

// 3d. Schema/query drift (informational — a triage backlog, not a %; ratchets down)
try {
  const j = JSON.parse(run("node scripts/verify-schema-drift.mjs --json"));
  gates.push({ name: "schema-drift", pct: null, floor: 0,
    detail: `${j.drift} drift candidates (triage queue; ${j.checked} checks, ${j.unverified} skipped) — runtime-confirm each` });
} catch { gates.push({ name: "schema-drift", pct: null, floor: 0, detail: "gate errored" }); }

// 3c. Render-parity (static appearance layer)
try {
  const j = JSON.parse(run("node scripts/verify-render-parity.mjs --json"));
  gates.push({ name: "render-parity", pct: j.overall, floor: 100,
    detail: `static appearance layer; ${j.stationGaps.length} station-interior gaps` });
} catch { gates.push({ name: "render-parity", pct: null, floor: 100, detail: "gate errored" }); }

// 4. Macro depth (reads the grader's last output file)
{
  const j = readJson('audit/macro-depth.json');
  gates.push({ name: 'macro-depth', pct: j ? Math.round(j.weightedScore * 1000) / 10 : null,
    floor: 100, detail: j ? `weighted ${j.weightedScore}` : 'run grade-macro-depth.mjs to populate' });
}

// ── composite + report ───────────────────────────────────────────────────────
const scored = gates.filter((g) => g.pct != null);
const composite = scored.length ? Math.round((scored.reduce((s, g) => s + g.pct, 0) / scored.length) * 10) / 10 : 0;

console.log('\n┌─ Concordia Health ─ "is it present, alive, and legible?" ─────────────');
console.log(`│  COMPOSITE: ${composite}%   (${scored.length}/${gates.length} gates reporting)`);
console.log('├───────────────────────────────────────────────────────────────────────');
for (const g of gates) {
  const val = g.pct == null ? ' n/a ' : `${String(g.pct).padStart(5)}%`;
  const flag = g.pct == null ? '·' : (g.pct >= g.floor ? '✓' : '✗');
  console.log(`│  ${flag} ${g.name.padEnd(16)} ${val}  (floor ${g.floor})  — ${g.detail}`);
}
console.log('└───────────────────────────────────────────────────────────────────────');
console.log('  Instrument 2 (agent playtest: liveness · shared-parity · exploit · naive · render-parity)');
console.log('  + Instrument 3 (you, weekly, on the keystones) are not in this number — by design.\n');

if (ci) {
  const failures = gates.filter((g) => g.pct != null && g.pct < g.floor);
  if (failures.length) {
    console.error(`[health] FAIL: ${failures.map((f) => `${f.name} ${f.pct}%<${f.floor}`).join(', ')}`);
    process.exit(1);
  }
}
