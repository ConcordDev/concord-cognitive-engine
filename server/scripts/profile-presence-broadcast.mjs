/**
 * One-shot profiler for city-presence broadcastPositions.
 * Run: node scripts/profile-presence-broadcast.mjs
 *
 * Measures sync cost / payload bytes / emits for 50 / 200 / 1000 occupants
 * in one city, plus idle (no-move) and no-client-connected scenarios.
 */
import {
  configurePresence,
  updateUserPosition,
  removeUser,
  spawnNpc,
  despawnNpc,
  broadcastPositions,
  startPresenceBroadcast,
  sweepStalePresence,
} from "../lib/city-presence.js";
import {
  markActivity,
  shouldRunHeavyMaintenance,
} from "../lib/presence-idle.js";

const CITY = "profile_city_broadcast";
const CHUNK_SIZE = 100;

function clearCity() {
  // Prune everything by sweeping far into the future after removing known ids.
  sweepStalePresence(Date.now() + 1e12);
}

function seedOccupants(n, { spreadChunks = true, npcFraction = 0.3 } = {}) {
  const ids = [];
  const npcCount = Math.floor(n * npcFraction);
  const playerCount = n - npcCount;
  for (let i = 0; i < playerCount; i++) {
    const id = `p_${i}`;
    const chunkIdx = spreadChunks ? Math.floor(i / 20) : 0; // ~20 per chunk
    const x = (chunkIdx % 10) * CHUNK_SIZE + (i % 20) * 3;
    const z = Math.floor(chunkIdx / 10) * CHUNK_SIZE + (i % 20) * 3;
    updateUserPosition(id, { cityId: CITY, x, y: 0, z, direction: 0, action: "walk" });
    ids.push(id);
  }
  for (let i = 0; i < npcCount; i++) {
    // NPCs via spawnNpc live in _npcState and are NOT in broadcastPositions
    // (city:npcs emit retired). Also seed npc_* ids into the presence map so
    // the "occupants including NPCs" load hits the same serialize path players do
    // (world NPCs that share spatial presence).
    const id = `npc_${i}`;
    const chunkIdx = spreadChunks ? Math.floor((playerCount + i) / 20) : 0;
    const x = (chunkIdx % 10) * CHUNK_SIZE + ((playerCount + i) % 20) * 3;
    const z = Math.floor(chunkIdx / 10) * CHUNK_SIZE + ((playerCount + i) % 20) * 3;
    updateUserPosition(id, { cityId: CITY, x, y: 0, z, direction: 0, action: "idle" });
    spawnNpc({ cityId: CITY, id: `spawned_${id}`, name: id, x, y: 0, z });
    ids.push(id);
  }
  return ids;
}

function teardown(ids) {
  for (const id of ids) {
    try { removeUser(id); } catch { /* ignore */ }
    try { despawnNpc(`spawned_${id}`); } catch { /* ignore */ }
    try { despawnNpc(id); } catch { /* ignore */ }
  }
  clearCity();
}

function measureBroadcast(label) {
  const emits = [];
  const t0 = process.hrtime.bigint();
  broadcastPositions(CITY, (event, data, opts) => {
    emits.push({
      event,
      bytes: Buffer.byteLength(JSON.stringify(data), "utf8"),
      users: data.users?.length ?? 0,
      chunks: data.chunks ?? 0,
      opts,
    });
  });
  const t1 = process.hrtime.bigint();
  const ms = Number(t1 - t0) / 1e6;
  const totalBytes = emits.reduce((s, e) => s + e.bytes, 0);
  return {
    label,
    syncMs: Number(ms.toFixed(3)),
    emits: emits.length,
    totalBytes,
    usersInPayload: emits[0]?.users ?? 0,
    chunksField: emits[0]?.chunks ?? 0,
  };
}

function measureFullTick(label, { markAuthed = true } = {}) {
  // Simulate startPresenceBroadcast body for one tick.
  if (markAuthed) markActivity({ authed: true });
  const emits = [];
  const t0 = process.hrtime.bigint();
  const gateOpen = shouldRunHeavyMaintenance();
  if (gateOpen) {
    // Distinct cities from positions — only CITY seeded.
    broadcastPositions(CITY, (event, data) => {
      emits.push({ bytes: Buffer.byteLength(JSON.stringify(data), "utf8") });
    });
  }
  const t1 = process.hrtime.bigint();
  return {
    label,
    gateOpen,
    syncMs: Number((Number(t1 - t0) / 1e6).toFixed(3)),
    emits: emits.length,
    totalBytes: emits.reduce((s, e) => s + e.bytes, 0),
  };
}

configurePresence({ db: null, fireTrigger: null });
clearCity();

const results = { scenarios: [], idleNoMove: [], noClient: [], notes: [] };

for (const n of [50, 200, 1000]) {
  const ids = seedOccupants(n);
  // Warm once (JIT / maps)
  measureBroadcast(`warm_${n}`);
  const samples = [];
  for (let i = 0; i < 5; i++) samples.push(measureBroadcast(`n=${n} sample ${i}`));
  const syncMs = samples.map((s) => s.syncMs);
  const median = [...syncMs].sort((a, b) => a - b)[Math.floor(syncMs.length / 2)];
  const mean = syncMs.reduce((a, b) => a + b, 0) / syncMs.length;
  const one = samples[0];
  results.scenarios.push({
    occupants: n,
    medianSyncMs: Number(median.toFixed(3)),
    meanSyncMs: Number(mean.toFixed(3)),
    maxSyncMs: Number(Math.max(...syncMs).toFixed(3)),
    emitsPerCall: one.emits,
    payloadBytes: one.totalBytes,
    usersInPayload: one.usersInPayload,
    chunksField: one.chunksField,
    samples: syncMs,
  });

  // (b) no occupant moved — second call immediately, nothing changed
  const idle1 = measureBroadcast(`idle_after_${n}`);
  const idle2 = measureBroadcast(`idle_after_${n}_again`);
  results.idleNoMove.push({
    occupants: n,
    firstIdleSyncMs: idle1.syncMs,
    secondIdleSyncMs: idle2.syncMs,
    emitsEach: idle1.emits,
    note: "BEFORE fix: still rebuilds+emits even when nothing moved",
  });

  teardown(ids);
}

// (a) no client connected: idle gate closed → tick body should skip
{
  const ids = seedOccupants(200);
  // Force idle: don't mark activity; presence-idle starts at 0 → isIdle true
  // unless CONCORD_IDLE_DISABLED=1
  process.env.CONCORD_IDLE_DISABLED = "0";
  // Reset activity by not calling markActivity; if prior markActivity ran,
  // wait isn't practical — instead call measure with markAuthed false and
  // temporarily rely on shouldRunHeavyMaintenance. After markActivity above
  // in the loop, gate is open. Call markActivity never and check:
  // We can't easily clear activity timestamps without a test hook.
  // Measure broadcastPositions itself with a no-op emit (the function does
  // not check room subscribers — "no client" cost === full serialize cost).
  const noSub = measureBroadcast("no_socket_subscribers_n=200");
  results.noClient.push({
    ...noSub,
    note: "broadcastPositions has no room-subscriber check; serialize+emit always runs when called. Idle gate is only in startPresenceBroadcast timer.",
  });
  const tickWhenAuthed = measureFullTick("tick_authed_n=200", { markAuthed: true });
  results.noClient.push(tickWhenAuthed);
  teardown(ids);
}

results.notes.push(
  "NPCs from spawnNpc() are NOT included in city:positions (city:npcs emit retired). Synthetic npc_* occupants were seeded via updateUserPosition to load the serialize path.",
);
results.notes.push(
  "Wire format today: 1 emit per city per tick (chunk:null, users:[...]).",
);

console.log(JSON.stringify(results, null, 2));
