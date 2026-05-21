// server/lib/foundry/builder-extras.js
//
// Foundry — Phase 8 builder extensions. Pure helpers + the shared
// in-memory state container for the seven Roblox-Studio-parity
// features added in this phase:
//
//   1. Visual scripting / blueprint editor   (blueprints)
//   2. In-builder playtest mode + hot-reload  (playtest sessions)
//   3. Asset library (3D models / sprites / audio)
//   4. Multiplayer lobby + matchmaking config (worldspec.multiplayer)
//   5. Games marketplace (discovery + ratings)
//   6. Game analytics dashboard (plays / retention / completion)
//   7. Collaborative multi-builder editing (collaborators + presence)
//
// Per-builder/per-world data persists in globalThis._concordSTATE so it
// survives across macro calls within a process. DB-backed foundry_worlds
// rows remain the source of truth for the worldspec itself; this module
// only owns the auxiliary builder-side state that has no migration yet.

import { randomUUID } from "node:crypto";

/** Lazily-built shared state container. */
export function foundryState() {
  const S = globalThis._concordSTATE || (globalThis._concordSTATE = {});
  if (!S.foundry) {
    S.foundry = {
      blueprints: new Map(),     // worldId -> { nodes, edges, updatedAt }
      playtests: new Map(),      // sessionId -> session record
      assets: new Map(),         // assetId  -> asset record
      ratings: new Map(),        // worldId  -> Map(userId -> { stars, review, at })
      analytics: new Map(),      // worldId  -> { plays:[], completions:[], sessions:[] }
      collaborators: new Map(),  // worldId  -> Map(userId -> { role, addedAt, addedBy })
      presence: new Map(),       // worldId  -> Map(userId -> { node, at })
    };
  }
  return S.foundry;
}

// ── Visual scripting / blueprints ───────────────────────────────────────────

export const BLUEPRINT_NODE_KINDS = [
  "event",      // on_start / on_player_join / on_interact ...
  "condition",  // branch on a predicate
  "action",     // spawn / award / teleport / message ...
  "variable",   // read/write a named blueprint variable
  "math",       // arithmetic on numbers
  "delay",      // wait N seconds
];

export const BLUEPRINT_EVENT_TYPES = [
  "on_start", "on_player_join", "on_player_leave",
  "on_interact", "on_timer", "on_death", "on_score",
];
export const BLUEPRINT_ACTION_TYPES = [
  "spawn", "award_points", "teleport", "message",
  "play_sound", "set_variable", "end_game", "open_gate",
];

/** Validate a blueprint graph — structural, never throws. */
export function validateBlueprint(graph) {
  const errors = [];
  const warnings = [];
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  const edges = Array.isArray(graph?.edges) ? graph.edges : [];
  if (nodes.length === 0) errors.push("blueprint has no nodes");
  const ids = new Set();
  let eventCount = 0;
  for (const n of nodes) {
    if (!n || typeof n !== "object") { errors.push("malformed node"); continue; }
    if (typeof n.id !== "string" || !n.id) { errors.push("node missing id"); continue; }
    if (ids.has(n.id)) errors.push(`duplicate node id ${n.id}`);
    ids.add(n.id);
    if (!BLUEPRINT_NODE_KINDS.includes(n.kind)) {
      errors.push(`node ${n.id}: unknown kind '${n.kind}'`);
    }
    if (n.kind === "event") eventCount += 1;
  }
  for (const e of edges) {
    if (!e || typeof e !== "object") { errors.push("malformed edge"); continue; }
    if (!ids.has(e.from)) errors.push(`edge from unknown node ${e.from}`);
    if (!ids.has(e.to)) errors.push(`edge to unknown node ${e.to}`);
  }
  if (eventCount === 0 && nodes.length > 0) {
    warnings.push("blueprint has no event node — it will never run");
  }
  return { ok: errors.length === 0, errors, warnings, nodeCount: nodes.length, edgeCount: edges.length };
}

/** Normalize a blueprint graph into the canonical persisted shape. */
export function normalizeBlueprint(graph) {
  const nodes = (Array.isArray(graph?.nodes) ? graph.nodes : [])
    .filter((n) => n && typeof n === "object" && typeof n.id === "string")
    .map((n) => ({
      id: n.id,
      kind: BLUEPRINT_NODE_KINDS.includes(n.kind) ? n.kind : "action",
      type: typeof n.type === "string" ? n.type : "",
      label: typeof n.label === "string" ? n.label.slice(0, 120) : "",
      x: Number.isFinite(n.x) ? n.x : 0,
      y: Number.isFinite(n.y) ? n.y : 0,
      params: n.params && typeof n.params === "object" ? n.params : {},
    }));
  const edges = (Array.isArray(graph?.edges) ? graph.edges : [])
    .filter((e) => e && typeof e === "object" && typeof e.from === "string" && typeof e.to === "string")
    .map((e) => ({ id: typeof e.id === "string" ? e.id : randomUUID().slice(0, 12), from: e.from, to: e.to }));
  return { nodes, edges };
}

// ── Asset library ───────────────────────────────────────────────────────────

export const ASSET_KINDS = ["model", "sprite", "audio", "texture"];

/** Validate an asset import payload. */
export function validateAsset(input) {
  const errors = [];
  if (!ASSET_KINDS.includes(input?.kind)) errors.push(`kind must be one of ${ASSET_KINDS.join(", ")}`);
  const name = String(input?.name || "").trim();
  if (!name) errors.push("name is required");
  if (name.length > 160) errors.push("name too long");
  const url = String(input?.url || "").trim();
  if (!url) errors.push("url is required");
  else if (!/^https?:\/\//i.test(url) && !url.startsWith("/")) {
    errors.push("url must be an http(s) link or an absolute path");
  }
  return { ok: errors.length === 0, errors };
}

// ── Multiplayer / matchmaking ───────────────────────────────────────────────

export const MATCHMAKING_MODES = ["open", "skill_based", "private", "lobby"];

/** Coerce a raw multiplayer config block to the canonical shape. */
export function normalizeMultiplayer(raw = {}) {
  const r = raw && typeof raw === "object" ? raw : {};
  const mode = MATCHMAKING_MODES.includes(r.matchmaking) ? r.matchmaking : "open";
  return {
    enabled: r.enabled !== false,
    minPlayers: clampInt(r.minPlayers, 1, 64, 1),
    maxPlayers: clampInt(r.maxPlayers, 1, 256, 16),
    matchmaking: mode,
    lobbyCountdownSec: clampInt(r.lobbyCountdownSec, 0, 600, 30),
    teamCount: clampInt(r.teamCount, 0, 16, 0),
    fillBots: r.fillBots === true,
  };
}

function clampInt(v, lo, hi, dflt) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return dflt;
  return Math.min(Math.max(n, lo), hi);
}

// ── Analytics ───────────────────────────────────────────────────────────────

/** Roll an analytics bucket up into dashboard-ready stats. */
export function summarizeAnalytics(bucket) {
  const plays = Array.isArray(bucket?.plays) ? bucket.plays : [];
  const completions = Array.isArray(bucket?.completions) ? bucket.completions : [];
  const sessions = Array.isArray(bucket?.sessions) ? bucket.sessions : [];
  const totalPlays = plays.length;
  const totalCompletions = completions.length;
  const uniquePlayers = new Set(plays.map((p) => p.userId)).size;
  const completionRate = totalPlays > 0 ? totalCompletions / totalPlays : 0;

  // Day-1 retention: of players whose first play was ≥24h ago, how many
  // came back at least once after their first session.
  const byUser = new Map();
  for (const p of plays) {
    const arr = byUser.get(p.userId) || [];
    arr.push(Number(p.at) || 0);
    byUser.set(p.userId, arr);
  }
  let retEligible = 0;
  let retReturned = 0;
  const dayMs = 86_400_000;
  const now = Date.now();
  for (const times of byUser.values()) {
    times.sort((a, b) => a - b);
    if (now - times[0] < dayMs) continue; // not eligible yet
    retEligible += 1;
    if (times.some((t) => t - times[0] >= dayMs)) retReturned += 1;
  }
  const retention = retEligible > 0 ? retReturned / retEligible : 0;

  const durations = sessions.map((s) => Number(s.durationSec) || 0).filter((d) => d > 0);
  const avgSessionSec = durations.length
    ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
    : 0;

  // Plays per day, last 7 days, oldest-first.
  const playsByDay = [];
  for (let d = 6; d >= 0; d--) {
    const start = now - (d + 1) * dayMs;
    const end = now - d * dayMs;
    const count = plays.filter((p) => { const t = Number(p.at) || 0; return t >= start && t < end; }).length;
    playsByDay.push({ day: new Date(end).toISOString().slice(0, 10), plays: count });
  }

  return {
    totalPlays,
    uniquePlayers,
    totalCompletions,
    completionRate: Math.round(completionRate * 1000) / 1000,
    retentionDay1: Math.round(retention * 1000) / 1000,
    avgSessionSec,
    playsByDay,
  };
}

// ── Collaboration ───────────────────────────────────────────────────────────

export const COLLAB_ROLES = ["editor", "viewer"];
