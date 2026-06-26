#!/usr/bin/env node
// H4+ — headless bot-swarm load harness. Spins up N socket.io clients that
// connect, spawn into the coordinate grid, move in circles, and fire combat
// messages — to find the CCU bottleneck (event-loop saturation, heap growth,
// broadcast fan-out). This is a MANUAL ops tool run against a live deploy, not a
// CI gate: watch the server's CPU profile / heap / `concord_heartbeat_skipped_total`
// and the per-bot ack/nack rates printed here.
//
// Usage (from concord-frontend/, where socket.io-client resolves):
//   node scripts/load/bot-swarm.mjs --url http://localhost:5050 --bots 500 --seconds 60
// Env equivalents: SWARM_URL, SWARM_BOTS, SWARM_SECONDS, SWARM_MOVE_HZ, SWARM_TOKEN
//
// SWARM_TOKEN (optional) is a bearer/cookie auth token; without it bots connect
// anonymously (the server may reject authed actions — that's a valid signal too).

import { io } from 'socket.io-client';

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return def;
}

const URL      = arg('url', process.env.SWARM_URL || 'http://localhost:5050');
const BOTS     = Number(arg('bots', process.env.SWARM_BOTS || 200));
const SECONDS  = Number(arg('seconds', process.env.SWARM_SECONDS || 60));
const MOVE_HZ  = Number(arg('move-hz', process.env.SWARM_MOVE_HZ || 10));
const TOKEN    = process.env.SWARM_TOKEN || null;
const RAMP_MS  = Number(arg('ramp-ms', process.env.SWARM_RAMP_MS || 5000)); // stagger connects

const stats = {
  connected: 0, connectErrors: 0, disconnects: 0,
  movesSent: 0, moveAcks: 0, moveNacks: 0, attacksSent: 0, hits: 0,
  antiCheatDropped: 0, errors: 0,
};
const latencies = []; // move round-trip samples (ms)

function pct(arr, p) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return Math.round(s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]);
}

function spawnBot(idx) {
  const opts = { transports: ['websocket'], reconnection: false, forceNew: true };
  if (TOKEN) opts.auth = { token: TOKEN, userId: `bot_${idx}` };
  const socket = io(URL, opts);

  // Each bot orbits a point on the grid so they spread across chunks.
  const cx = (idx % 20) * 40 - 400;
  const cz = Math.floor(idx / 20) * 40 - 400;
  const r = 15 + (idx % 5) * 5;
  let theta = (idx / BOTS) * Math.PI * 2;
  let moveTimer = null;
  const pendingMove = new Map(); // seq -> sentAt
  let seq = 0;

  socket.on('connect', () => {
    stats.connected++;
    try { socket.emit('player:load'); } catch { /* */ }
    moveTimer = setInterval(() => {
      theta += 0.15;
      const x = cx + Math.cos(theta) * r;
      const z = cz + Math.sin(theta) * r;
      const s = ++seq;
      pendingMove.set(s, performance.now());
      stats.movesSent++;
      socket.emit('player:move', { cityId: 'concordia-hub', x, y: 40, z, direction: theta, seq: s, action: 'walk' });
      // ~1 in 8 frames, throw a punch at a phantom target (server validates).
      if (Math.random() < 0.12) {
        stats.attacksSent++;
        socket.emit('combat:attack', { targetId: `bot_${(idx + 1) % BOTS}`, baseDamage: 10, range: 3, seq: s });
      }
    }, Math.max(20, Math.round(1000 / MOVE_HZ)));
  });

  socket.on('player:move:ack', () => {
    stats.moveAcks++;
    // Approximate RTT from the most recent pending move.
    const last = [...pendingMove.values()].pop();
    if (last) latencies.push(performance.now() - last);
    pendingMove.clear();
  });
  socket.on('player:move:nack', () => { stats.moveNacks++; });
  socket.on('combat:hit', () => { stats.hits++; });
  socket.on('anti-cheat:dropped', () => { stats.antiCheatDropped++; });
  socket.on('connect_error', () => { stats.connectErrors++; });
  socket.on('error', () => { stats.errors++; });
  socket.on('disconnect', () => { stats.disconnects++; if (moveTimer) clearInterval(moveTimer); });

  return () => { if (moveTimer) clearInterval(moveTimer); try { socket.close(); } catch { /* */ } };
}

console.log(`[swarm] ${BOTS} bots → ${URL} for ${SECONDS}s (move ${MOVE_HZ}Hz, ramp ${RAMP_MS}ms, auth=${TOKEN ? 'token' : 'anon'})`);

const closers = [];
const startHeap = process.memoryUsage().rss;
// Stagger connections over the ramp so we don't thundering-herd the handshake.
for (let i = 0; i < BOTS; i++) {
  setTimeout(() => closers.push(spawnBot(i)), Math.round((i / BOTS) * RAMP_MS));
}

const report = setInterval(() => {
  console.log(`[swarm] conn=${stats.connected}/${BOTS} moves=${stats.movesSent} ack=${stats.moveAcks} nack=${stats.moveNacks} atk=${stats.attacksSent} hit=${stats.hits} p50=${pct(latencies, 50)}ms p95=${pct(latencies, 95)}ms err=${stats.connectErrors + stats.errors} dropped=${stats.antiCheatDropped}`);
}, 5000);

setTimeout(() => {
  clearInterval(report);
  for (const close of closers) close();
  const heapMb = ((process.memoryUsage().rss - startHeap) / 1e6).toFixed(1);
  console.log('\n[swarm] ── final ───────────────────────────────');
  console.log(`  peak connected   : ${stats.connected}/${BOTS}`);
  console.log(`  moves sent/ack/nack: ${stats.movesSent} / ${stats.moveAcks} / ${stats.moveNacks}`);
  console.log(`  attacks / hits   : ${stats.attacksSent} / ${stats.hits}`);
  console.log(`  move RTT p50/p95 : ${pct(latencies, 50)}ms / ${pct(latencies, 95)}ms`);
  console.log(`  connect errors   : ${stats.connectErrors}, socket errors: ${stats.errors}, disconnects: ${stats.disconnects}`);
  console.log(`  anti-cheat drops : ${stats.antiCheatDropped}`);
  console.log(`  client RSS delta : ${heapMb}MB (the SERVER's heap/CPU is the real signal — watch its metrics)`);
  setTimeout(() => process.exit(0), 500);
}, SECONDS * 1000 + RAMP_MS);
