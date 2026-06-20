#!/usr/bin/env node
// scripts/loadtest/worldbots.mjs
//
// MMO player-bot swarm — stresses the WORLD-SIMULATION heartbeat (not just HTTP).
// Each bot registers, travels into a world (→ active world_visits row, which is how
// signal-propagation / creature-flock / fauna-spawner / social-bridge discover work),
// then loops: move (frequent) + gather + attack — the actions that write embodied
// signals, damage_events, pain_signals, and keep the world "active".
//
// Reports action throughput/errors AND — the whole point — scrapes /metrics for
// heartbeat ticks fired vs SKIPPED + module timeouts over the run (the clog signal).
//
// Optional creature pre-seed (SEED_CREATURES=N): clones an existing world_npcs row into
// N `creature:%` rows per active world via a 2nd better-sqlite3 connection, so
// creature-flock-cycle (which reads world_npcs WHERE archetype LIKE 'creature:%') has
// thousands to process WITHOUT waiting ~7.5min for the fauna-spawner.
//
// Run the server with CONCORD_DISABLE_CSRF=true (dev) so world POSTs don't need a CSRF
// token — we're measuring the sim, not CSRF (prod CSRF is validated separately).
//
//   BASE=http://localhost:5050 BOTS=40 DURATION_S=120 MOVE_MS=150 \
//   WORLDS=tunya,crime,cyber,fantasy SEED_CREATURES=2000 \
//   DB=server/data/concord.db node scripts/loadtest/worldbots.mjs

import { createRequire } from "node:module";
import path from "node:path";
const require = createRequire(import.meta.url);

const BASE = process.env.BASE || "http://localhost:5050";
const BOTS = Number(process.env.BOTS || 40);
const DURATION_S = Number(process.env.DURATION_S || 120);
const MOVE_MS = Number(process.env.MOVE_MS || 150);
const WORLDS = (process.env.WORLDS || "tunya,crime,cyber,fantasy,sovereign-ruins").split(",").map((s) => s.trim()).filter(Boolean);
const SEED_CREATURES = Number(process.env.SEED_CREATURES || 0);
const DB_PATH = process.env.DB || "server/data/concord.db";
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 WorldBot";
const H = { "Content-Type": "application/json", "Origin": "http://localhost:3000", "User-Agent": UA };

const stats = { move: 0, gather: 0, attack: 0, travel: 0, errors: 0, byErr: {} };

async function jfetch(path, opts = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetch(BASE + path, { ...opts, signal: ctrl.signal, headers: { ...H, ...(opts.headers || {}) } });
    const body = await res.text();
    let json; try { json = JSON.parse(body); } catch { json = null; }
    return { ok: res.ok, status: res.status, json, body };
  } catch (e) { return { ok: false, status: 0, body: String(e?.name === "AbortError" ? "timeout" : e?.message || e) }; }
  finally { clearTimeout(t); }
}

function note(r, label) {
  if (!r.ok) { stats.errors++; const k = `${label}:${r.status || r.body}`; stats.byErr[k] = (stats.byErr[k] || 0) + 1; }
}

async function scrapeMetrics() {
  const r = await jfetch("/metrics");
  const out = {};
  if (!r.ok) return out;
  for (const m of ["concord_heartbeat_ticks_total", "concord_heartbeat_skipped_total", "concord_heartbeat_module_timeout_total"]) {
    const line = r.body.split("\n").find((l) => l.startsWith(m + " "));
    if (line) out[m] = Number(line.trim().split(/\s+/).pop());
  }
  const heap = r.body.split("\n").find((l) => l.includes('concord_process_memory_bytes{type="heapUsed"}'));
  if (heap) out.heapUsedMB = Math.round(Number(heap.trim().split(/\s+/).pop()) / 1048576);
  return out;
}

function seedCreatures(worlds, perWorld) {
  let Database;
  // better-sqlite3 lives in server/node_modules — resolve it from the DB's server dir.
  const serverDir = path.resolve(path.dirname(DB_PATH), "..");
  for (const cand of [path.join(serverDir, "node_modules", "better-sqlite3"), "better-sqlite3"]) {
    try { Database = require(cand); break; } catch { /* try next */ }
  }
  if (!Database) { console.log("  (better-sqlite3 not resolvable — skipping creature seed)"); return 0; }
  let db;
  try { db = new Database(DB_PATH, { timeout: 8000 }); } catch (e) { console.log("  (cannot open DB:", e.message, "— skipping seed)"); return 0; }
  try {
    const cols = db.prepare("PRAGMA table_info(world_npcs)").all().map((c) => c.name);
    if (!cols.length) { console.log("  (world_npcs not found — skipping)"); return 0; }
    const template = db.prepare("SELECT * FROM world_npcs LIMIT 1").get();
    if (!template) { console.log("  (no template world_npcs row to clone — skipping; bots will rely on natural fauna spawn)"); return 0; }
    const species = ["wolf", "deer", "boar", "hawk", "fox", "rabbit"];
    const insertCols = cols.filter((c) => c in template || c === "id");
    const stmt = db.prepare(`INSERT INTO world_npcs (${insertCols.join(",")}) VALUES (${insertCols.map(() => "?").join(",")})`);
    let n = 0;
    const tx = db.transaction((worldId) => {
      for (let i = 0; i < perWorld; i++) {
        const row = { ...template };
        row.id = `botcreature_${worldId}_${Date.now().toString(36)}_${i}_${Math.random().toString(36).slice(2, 6)}`;
        if ("world_id" in row) row.world_id = worldId;
        if ("species_id" in row) row.species_id = species[i % species.length];
        if ("archetype" in row) row.archetype = `creature:${species[i % species.length]}`;
        if ("is_dead" in row) row.is_dead = 0;
        if ("x" in row) row.x = Math.random() * 800 - 400;
        if ("z" in row) row.z = Math.random() * 800 - 400;
        if ("y" in row) row.y = 0;
        stmt.run(insertCols.map((c) => row[c] ?? null));
        n++;
      }
    });
    for (const w of worlds) tx(w);
    return n;
  } catch (e) { console.log("  (seed error:", e.message, ")"); return 0; }
  finally { try { db.close(); } catch { /* ignore */ } }
}

async function registerBot(i) {
  const s = Date.now().toString(36) + i;
  const r = await jfetch("/api/auth/register", { method: "POST", body: JSON.stringify({ email: `wb_${s}@ex.com`, password: "WorldBot1234!", username: `wb_${s}`.slice(0, 20), dateOfBirth: "1990-01-01" }) });
  return r.json?.token || null;
}

async function botLoop(token, worldId, deadline) {
  const hh = { Authorization: `Bearer ${token}` };
  let npcId = null;
  // Enter the world (→ active world_visits)
  const tr = await jfetch("/api/worlds/travel", { method: "POST", headers: hh, body: JSON.stringify({ worldId }) });
  note(tr, "travel"); if (tr.ok) stats.travel++;
  // Find an NPC target for combat (best-effort)
  const npcs = await jfetch(`/api/worlds/${worldId}/npcs`, { headers: hh });
  if (npcs.ok && Array.isArray(npcs.json?.npcs) && npcs.json.npcs.length) npcId = npcs.json.npcs[Math.floor(Math.random() * npcs.json.npcs.length)]?.id || null;

  let i = 0;
  let px = Math.random() * 200, pz = Math.random() * 200;
  while (Date.now() < deadline) {
    i++;
    px += (Math.random() - 0.5) * 20; pz += (Math.random() - 0.5) * 20;
    const mv = await jfetch(`/api/worlds/${worldId}/move`, { method: "POST", headers: hh, body: JSON.stringify({ x: px, z: pz, y: 5 }) });
    note(mv, "move"); if (mv.ok) stats.move++;
    // Gather every ~8 moves
    if (i % 8 === 0) {
      const nodes = await jfetch(`/api/worlds/${worldId}/nodes?x=${px.toFixed(0)}&z=${pz.toFixed(0)}&radius=300`, { headers: hh });
      const node = nodes.ok && Array.isArray(nodes.json?.nodes) ? nodes.json.nodes[0] : null;
      if (node?.id) {
        const g = await jfetch(`/api/worlds/${worldId}/nodes/${node.id}/gather`, { method: "POST", headers: hh, body: JSON.stringify({ element: "physical", x: px, z: pz }) });
        note(g, "gather"); if (g.ok) stats.gather++;
      }
    }
    // Attack every ~12 moves (writes embodied signals + damage)
    if (i % 12 === 0 && npcId) {
      const a = await jfetch(`/api/worlds/${worldId}/combat/attack`, { method: "POST", headers: hh, body: JSON.stringify({ npcId }) });
      note(a, "attack"); if (a.ok) stats.attack++;
    }
    await new Promise((r) => setTimeout(r, MOVE_MS));
  }
}

async function main() {
  console.log(`\n=== Concordia world-bot swarm ===\nTarget: ${BASE}  Bots: ${BOTS}  Duration: ${DURATION_S}s  Worlds: ${WORLDS.join(", ")}  Move cadence: ${MOVE_MS}ms\n`);
  const h = await jfetch("/health"); if (!h.ok) { console.error("Server not healthy — aborting."); process.exit(1); }

  process.stdout.write(`Registering ${BOTS} bots... `);
  const tokens = (await Promise.all(Array.from({ length: BOTS }, (_, i) => registerBot(i)))).filter(Boolean);
  console.log(`${tokens.length} ready`);
  if (!tokens.length) { console.error("No tokens — aborting."); process.exit(1); }

  if (SEED_CREATURES > 0) {
    process.stdout.write(`Seeding ${SEED_CREATURES} creatures/world into world_npcs (${WORLDS.length} worlds)... `);
    const n = seedCreatures(WORLDS, SEED_CREATURES);
    console.log(`inserted ${n}`);
  }

  const before = await scrapeMetrics();
  const t0 = Date.now();
  const deadline = t0 + DURATION_S * 1000;
  // Spread bots across worlds
  await Promise.all(tokens.map((tok, i) => botLoop(tok, WORLDS[i % WORLDS.length], deadline)));
  const elapsed = (Date.now() - t0) / 1000;
  const after = await scrapeMetrics();

  const ticks = (after.concord_heartbeat_ticks_total || 0) - (before.concord_heartbeat_ticks_total || 0);
  const skips = (after.concord_heartbeat_skipped_total || 0) - (before.concord_heartbeat_skipped_total || 0);
  const tmo = (after.concord_heartbeat_module_timeout_total || 0) - (before.concord_heartbeat_module_timeout_total || 0);
  const totalActions = stats.move + stats.gather + stats.attack + stats.travel;

  console.log(`\n--- Actions (${elapsed.toFixed(0)}s) ---`);
  console.log(`travel ${stats.travel}  move ${stats.move}  gather ${stats.gather}  attack ${stats.attack}  | ${(totalActions / elapsed).toFixed(0)} actions/s`);
  console.log(`Errors: ${stats.errors}${Object.keys(stats.byErr).length ? "  " + JSON.stringify(stats.byErr) : ""}`);
  console.log(`\n--- Heartbeat under WORLD-SIM load ---`);
  console.log(`Ticks fired:     ${ticks}  (expected ~${Math.floor(elapsed / 15)} at 15s cadence)`);
  console.log(`Ticks SKIPPED:   ${skips}  ${skips > 0 ? "⚠ the world tick is overrunning 15s — sim is clogging" : "✓ no clog"}`);
  console.log(`Module timeouts: ${tmo}  ${tmo > 0 ? "⚠ a module exceeded its 30s budget" : ""}`);
  console.log(`Heap: ${before.heapUsedMB ?? "?"}MB → ${after.heapUsedMB ?? "?"}MB\n`);
}

main().catch((e) => { console.error("worldbots error:", e); process.exit(1); });
