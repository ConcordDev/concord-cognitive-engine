#!/usr/bin/env node
// scripts/verify-event-consumers.mjs
//
// Instrument 1 — the legibility gate. Self-deriving sibling of the move-render
// gate: every realtime event the SERVER emits must have a FRONTEND consumer,
// else the simulation runs but the player never perceives it (the dynamism
// audit's "silent systems" — schemes/needs/momentum/creature-motion ticking
// invisibly). Greps the live emit sites + the live consumable set; prints a
// consumed % + the silent-events list grouped by namespace.
//
// Consumable set (what the frontend can hear):
//   - the SocketEvent union (lib/realtime/socket.ts) — subscribe() is typed to it
//   - EmergentEventFeed TRACKED_EVENTS (incl. `as SocketEvent` casts)
//   - any subscribe('x') / socket.on('x') / *.on('x') string literals
//
// Usage: node scripts/verify-event-consumers.mjs [--json] [--ci N]

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERVER = path.join(ROOT, 'server');
const FE = path.join(ROOT, 'concord-frontend');

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const ciIdx = args.indexOf('--ci');
const ciMode = ciIdx !== -1;
const ciFloor = ciMode ? Number(args[ciIdx + 1] || 100) : 0;

function walk(dir, exts, acc = []) {
  let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
  for (const e of ents) {
    if (['node_modules', '.git', 'tests', 'test', '.next', 'dist', 'build'].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, exts, acc);
    else if (exts.some((x) => e.name.endsWith(x))) acc.push(p);
  }
  return acc;
}

// ── 1. Server emit sites → emitted event names ───────────────────────────────
// Lifecycle / transport events that are not world-legibility surfaces.
const TRANSPORT = new Set(['connection', 'connect', 'disconnect', 'disconnecting',
  'close', 'error', 'reconnect', 'reconnect_attempt', 'ping', 'pong', 'connect_error']);

const emitRe = /(?:realtimeEmit|\.emit)\(\s*['"`]([a-zA-Z0-9:_-]+)['"`]/g;
const emitSites = {}; // event -> count
for (const f of walk(SERVER, ['.js'])) {
  const src = fs.readFileSync(f, 'utf8');
  for (const m of src.matchAll(emitRe)) {
    const ev = m[1];
    if (TRANSPORT.has(ev)) continue;
    emitSites[ev] = (emitSites[ev] || 0) + 1;
  }
}
const emitted = Object.keys(emitSites).sort();

// ── 2. Frontend consumable set ───────────────────────────────────────────────
const consumable = new Set();

// (a) SocketEvent union members
{
  const src = fs.readFileSync(path.join(FE, 'lib/realtime/socket.ts'), 'utf8');
  const blk = src.match(/type SocketEvent\s*=([\s\S]*?);/);
  if (blk) for (const m of blk[1].matchAll(/'([a-zA-Z0-9:_-]+)'/g)) consumable.add(m[1]);
}
// (b)+(c) TRACKED_EVENTS names, subscribe()/socket.on()/.on() literals, anywhere in FE
const subRe = /(?:subscribe|\.on|useSocketEvent)\(\s*['"`]([a-zA-Z0-9:_-]+)['"`]/g;
const trackedRe = /name:\s*'([a-zA-Z0-9:_-]+)'(?:\s+as SocketEvent)?\s*,\s*channel:/g;
for (const f of walk(FE, ['.ts', '.tsx'])) {
  const src = fs.readFileSync(f, 'utf8');
  for (const m of src.matchAll(subRe)) consumable.add(m[1]);
  for (const m of src.matchAll(trackedRe)) consumable.add(m[1]);
}

// ── 3. Classify ──────────────────────────────────────────────────────────────
const silent = emitted.filter((e) => !consumable.has(e));
const consumed = emitted.filter((e) => consumable.has(e));
const pct = emitted.length ? Math.round((consumed.length / emitted.length) * 1000) / 10 : 100;

const nsOf = (e) => (e.includes(':') ? e.split(':')[0] : '(flat)');
const byNs = {};
for (const e of silent) { (byNs[nsOf(e)] ??= []).push(e); }

if (asJson) {
  console.log(JSON.stringify({ consumedPct: pct, emitted: emitted.length,
    consumed: consumed.length, silent: silent.length, silentByNamespace: byNs }, null, 2));
} else {
  console.log('\n=== Event-Consumer (legibility) Gate ===');
  console.log(`server emits ${emitted.length} distinct events · frontend can consume ${consumable.size}`);
  console.log(`\n  consumed (legible) : ${pct}%  (${consumed.length}/${emitted.length})`);
  if (silent.length) {
    console.log(`\n--- Silent events (${silent.length}) — emitted but no UI consumer; close to climb to 100% ---`);
    for (const ns of Object.keys(byNs).sort()) {
      console.log(`\n  [${ns}] ${byNs[ns].length}`);
      console.log('    ' + byNs[ns].sort().join(', '));
    }
  } else {
    console.log('\n✓ Every emitted event has a UI consumer — no silent simulation.');
  }
  console.log('');
}

if (ciMode && pct < ciFloor) {
  console.error(`[event-consumers] FAIL: consumed ${pct}% < floor ${ciFloor}%`);
  process.exit(1);
}
