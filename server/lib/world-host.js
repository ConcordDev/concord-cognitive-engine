// server/lib/world-host.js
//
// Shared-world host registry — World lens step 3 ("Host behind Concord").
//
// One headless Unity 6 instance per world runs the world's NPCs/creatures and
// connects to the Unity gateway like any client, then registers as that
// world's HOST. It publishes:
//   host:manifest  — the population (id, name, look), on join and on change
//   host:snapshot  — positions/animation state at ~5-10 Hz
// This module decides who may host (operator accounts only — a random player
// must never be able to become the authority for everyone's world), keeps the
// latest manifest so a player who joins later gets the population at once,
// rate-limits snapshots, and forgets the host when its socket closes so players
// fall back to their local simulation instead of freezing.
//
// Pure state + decisions; server.js wires the actual socket sends.
// Pinned by tests/world-host.test.js.

import { isOperator } from "./runtime/operator-gate.js";

const WORLD_RE = /^[A-Za-z0-9_.-]{1,64}$/;
const MAX_ENTITIES = 512;
const MIN_SNAPSHOT_INTERVAL_MS = 60; // ≤ ~16 Hz accepted; a host sending faster is throttled

/** worldId → { client, userId, since, manifest, manifestAt, lastSnapshotAt, snapshots } */
const hosts = new Map();

export function worldRoom(worldId) {
  return `world:${worldId}`;
}

/**
 * @param {{userId:string, role?:string}} actor  the socket's authenticated account
 * @returns {{ok:true, replaced:boolean} | {ok:false, reason:string}}
 */
export function registerHost(client, actor, worldId, now = Date.now()) {
  if (!WORLD_RE.test(String(worldId || ""))) return { ok: false, reason: "invalid_world" };
  if (!actor?.userId) return { ok: false, reason: "not_authenticated" };
  if (!isOperator({ actor })) return { ok: false, reason: "operator_only" };
  const prev = hosts.get(worldId);
  hosts.set(worldId, { client, userId: actor.userId, since: now, manifest: null, manifestAt: 0, lastSnapshotAt: 0, snapshots: 0 });
  return { ok: true, replaced: !!prev && prev.client !== client };
}

export function hostFor(worldId) {
  return hosts.get(worldId) || null;
}

function isHost(client, worldId) {
  const h = hosts.get(worldId);
  return !!h && h.client === client;
}

function cleanEntities(list, fields) {
  if (!Array.isArray(list)) return null;
  const out = [];
  for (const e of list.slice(0, MAX_ENTITIES)) {
    if (!e || typeof e !== "object") continue;
    const id = String(e.id ?? "").slice(0, 64);
    if (!id) continue;
    const row = { id };
    for (const [k, kind] of fields) {
      const v = e[k];
      if (kind === "num" && Number.isFinite(v)) row[k] = Math.round(v * 100) / 100;
      else if (kind === "str" && typeof v === "string") row[k] = v.slice(0, 64);
      else if (kind === "json" && typeof v === "string") row[k] = v.slice(0, 4096);
    }
    out.push(row);
  }
  return out;
}

/**
 * The gateway caps frames at 64 KB, so a big population arrives in chunks:
 * the first with `append:false` replaces the manifest, the rest append.
 * @returns {{ok:true, manifest:object, chunk:object[]} | {ok:false, reason:string}}
 */
export function acceptManifest(client, worldId, entities, { append = false } = {}, now = Date.now()) {
  if (!isHost(client, worldId)) return { ok: false, reason: "not_host" };
  const clean = cleanEntities(entities, [["name", "str"], ["kind", "str"], ["look", "json"]]);
  if (!clean) return { ok: false, reason: "invalid_entities" };
  const h = hosts.get(worldId);
  if (!append || !h.manifest) h.manifest = { worldId, entities: [], at: now };
  const byId = new Map(h.manifest.entities.map((e) => [e.id, e]));
  for (const e of clean) byId.set(e.id, e);
  h.manifest.entities = [...byId.values()].slice(0, MAX_ENTITIES);
  h.manifest.at = now;
  h.manifestAt = now;
  return { ok: true, manifest: h.manifest, chunk: clean };
}

/** @returns {{ok:true, snapshot:object} | {ok:false, reason:string}} */
export function acceptSnapshot(client, worldId, entities, now = Date.now()) {
  if (!isHost(client, worldId)) return { ok: false, reason: "not_host" };
  const h = hosts.get(worldId);
  if (now - h.lastSnapshotAt < MIN_SNAPSHOT_INTERVAL_MS) return { ok: false, reason: "throttled" };
  const clean = cleanEntities(entities, [["x", "num"], ["y", "num"], ["z", "num"], ["yaw", "num"], ["speed", "num"], ["act", "str"]]);
  if (!clean) return { ok: false, reason: "invalid_entities" };
  h.lastSnapshotAt = now;
  h.snapshots++;
  return { ok: true, snapshot: { worldId, t: now, entities: clean } };
}

export function manifestFor(worldId) {
  return hosts.get(worldId)?.manifest || null;
}

/** Forget every world this socket was hosting. @returns {string[]} worldIds it released */
export function releaseClient(client) {
  const released = [];
  for (const [worldId, h] of hosts) {
    if (h.client === client) { hosts.delete(worldId); released.push(worldId); }
  }
  return released;
}

export function hostStatus() {
  return [...hosts.entries()].map(([worldId, h]) => ({
    worldId, userId: h.userId, since: h.since, entities: h.manifest?.entities?.length ?? 0, snapshots: h.snapshots,
  }));
}

/** @internal tests */
export function _resetWorldHosts() { hosts.clear(); }
