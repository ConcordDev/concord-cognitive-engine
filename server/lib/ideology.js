// server/lib/ideology.js
//
// Living Society — Phase 12: ideology as a structured POSITION that recruits.
//
// Every world has a few authored political axes; every faction holds a position
// vector (professed) on them; an NPC's personal position derives from its
// faction + grudges + archetype. Ideology is the RECRUITMENT ATTRACTOR for the
// Phase-5 movement engine — a grudge-holder recruits people who share the
// position, not at random. A hypocrisy gap (professed vs revealed strategy moves)
// is a Goodhart guardrail a rival can expose.

import crypto from "node:crypto";

// Authored per-world political axes. Each axis is a [-1, +1] spectrum.
export const WORLD_AXES = Object.freeze({
  "concordia-hub": ["order_freedom", "tradition_progress", "collective_individual"],
  tunya:           ["order_freedom", "tradition_progress", "isolation_openness"],
  cyber:           ["corporate_grassroots", "augmentation_purity", "order_freedom"],
  crime:           ["loyalty_ambition", "order_freedom"],
  fantasy:         ["tradition_progress", "order_freedom", "faith_reason"],
  superhero:       ["registration_liberty", "order_freedom"],
  "sovereign-ruins": ["order_freedom", "memory_oblivion"],
  "lattice-crucible": ["stability_transformation", "collective_individual"],
});

export function axesForWorld(worldId) {
  return WORLD_AXES[worldId] || ["order_freedom", "tradition_progress", "collective_individual"];
}

// Map a faction-strategy move → which axis it reveals + direction. Used for the
// hypocrisy gap (revealed position vs professed).
const MOVE_AXIS_REVEAL = Object.freeze({
  DECLARE_WAR:       { order_freedom: +0.4, loyalty_ambition: +0.4 },
  DECLARE_REBELLION: { order_freedom: -0.6 },
  PROPOSE_ALLIANCE:  { collective_individual: -0.3, isolation_openness: +0.3 },
  SEEK_TRUCE:        { order_freedom: -0.2 },
  PROCLAIM_EXPANSION:{ tradition_progress: +0.3, loyalty_ambition: +0.3 },
  FORTIFY:           { order_freedom: +0.3, tradition_progress: -0.2 },
  WITHDRAW:          { isolation_openness: -0.4 },
});

function clampAxis(v) { return Math.max(-1, Math.min(1, v)); }

/** Persist a faction's professed position vector. */
export function setFactionIdeology(db, worldId, factionId, axes = {}) {
  if (!db || !worldId || !factionId) return { ok: false, reason: "missing_inputs" };
  const allowed = axesForWorld(worldId);
  const vec = {};
  for (const a of allowed) vec[a] = clampAxis(Number(axes[a]) || 0);
  try {
    db.prepare(`
      INSERT INTO faction_ideology (faction_id, world_id, axes_json, updated_at)
      VALUES (?, ?, ?, unixepoch())
      ON CONFLICT(faction_id, world_id) DO UPDATE SET axes_json = excluded.axes_json, updated_at = unixepoch()
    `).run(factionId, worldId, JSON.stringify(vec));
    return { ok: true, axes: vec };
  } catch (e) { return { ok: false, reason: "persist_failed", error: e?.message }; }
}

export function positionFor(db, worldId, factionId) {
  try {
    const row = db.prepare(`SELECT axes_json FROM faction_ideology WHERE faction_id = ? AND world_id = ?`).get(factionId, worldId);
    if (row) return JSON.parse(row.axes_json);
  } catch { /* absent */ }
  // Neutral default.
  const vec = {}; for (const a of axesForWorld(worldId)) vec[a] = 0; return vec;
}

/** Euclidean distance between two position vectors over a world's axes. */
export function ideologicalDistance(a = {}, b = {}, worldId = "concordia-hub") {
  let sum = 0;
  for (const ax of axesForWorld(worldId)) {
    const d = (Number(a[ax]) || 0) - (Number(b[ax]) || 0);
    sum += d * d;
  }
  return Math.round(Math.sqrt(sum) * 1000) / 1000;
}

/**
 * An NPC's personal position: its faction's professed vector, nudged by its
 * archetype (a guard leans order, a mystic leans tradition) — derived, cheap.
 */
export function npcPosition(db, worldId, npc) {
  const base = npc?.faction ? positionFor(db, worldId, npc.faction) : (() => { const v = {}; for (const a of axesForWorld(worldId)) v[a] = 0; return v; })();
  const arch = String(npc?.archetype || "").toLowerCase();
  const nudge = { ...base };
  if (nudge.order_freedom != null) {
    if (["guard", "warrior"].includes(arch)) nudge.order_freedom = clampAxis(nudge.order_freedom + 0.2);
    if (["trader", "merchant", "hunter"].includes(arch)) nudge.order_freedom = clampAxis(nudge.order_freedom - 0.2);
  }
  if (nudge.tradition_progress != null && ["mystic", "healer", "scholar"].includes(arch)) {
    nudge.tradition_progress = clampAxis(nudge.tradition_progress - 0.15);
  }
  return nudge;
}

/**
 * THE ATTRACTOR. Given a movement's founder position, rank candidate
 * grudge-holders by ideological proximity — recruit the closest first. Returns
 * the ranked candidate ids (closest = most recruitable).
 */
export function recruitAlongPosition(db, worldId, founderPosition, candidates = []) {
  // candidates: [{ id, faction, archetype }]
  return candidates
    .map((c) => ({ id: c.id, distance: ideologicalDistance(founderPosition, npcPosition(db, worldId, c), worldId) }))
    .sort((a, b) => a.distance - b.distance);
}

/**
 * Hypocrisy / Goodhart gap: a faction's PROFESSED position vs the position
 * REVEALED by its recent strategy moves. A large gap is exposable. Records an
 * ideology_alert. Returns the gap.
 */
export function detectFactionGoodhart(db, worldId, factionId, { threshold = 0.6 } = {}) {
  const professed = positionFor(db, worldId, factionId);
  // Revealed: accumulate axis reveals from recent moves.
  let moves = [];
  try { moves = db.prepare(`SELECT move FROM faction_strategy_log WHERE faction_id = ? ORDER BY occurred_at DESC LIMIT 10`).all(factionId); }
  catch { moves = []; }
  if (moves.length === 0) return { ok: true, gap: 0, hypocrisy: false };
  const revealed = {}; for (const a of axesForWorld(worldId)) revealed[a] = 0;
  let n = 0;
  for (const m of moves) {
    const reveal = MOVE_AXIS_REVEAL[m.move];
    if (!reveal) continue;
    for (const [ax, d] of Object.entries(reveal)) if (revealed[ax] != null) revealed[ax] = clampAxis(revealed[ax] + d);
    n++;
  }
  if (n === 0) return { ok: true, gap: 0, hypocrisy: false };
  const gap = ideologicalDistance(professed, revealed, worldId);
  const hypocrisy = gap >= threshold;
  if (hypocrisy) {
    try {
      db.prepare(`INSERT INTO ideology_alerts (id, world_id, kind, subject_id, severity, detail_json) VALUES (?, ?, 'goodhart_hypocrisy', ?, 'alert', ?)`)
        .run(`ida_${crypto.randomUUID()}`, worldId, factionId, JSON.stringify({ professed, revealed, gap }));
    } catch { /* table absent */ }
  }
  return { ok: true, gap, hypocrisy, professed, revealed };
}

/**
 * Echo-chamber: a cluster of factions whose positions are nearly identical
 * (low average pairwise distance) — politically inbred, exposable by a wedge.
 */
export function detectEchoChamber(db, worldId, { threshold = 0.25 } = {}) {
  let rows = [];
  try { rows = db.prepare(`SELECT faction_id, axes_json FROM faction_ideology WHERE world_id = ?`).all(worldId); }
  catch { return { ok: true, echoChamber: false }; }
  if (rows.length < 3) return { ok: true, echoChamber: false, reason: "too_few" };
  const vecs = rows.map((r) => { try { return JSON.parse(r.axes_json); } catch { return {}; } });
  let total = 0, pairs = 0;
  for (let i = 0; i < vecs.length; i++) for (let j = i + 1; j < vecs.length; j++) { total += ideologicalDistance(vecs[i], vecs[j], worldId); pairs++; }
  const avg = pairs ? total / pairs : 1;
  const echo = avg <= threshold;
  if (echo) {
    try { db.prepare(`INSERT INTO ideology_alerts (id, world_id, kind, subject_id, severity, detail_json) VALUES (?, ?, 'echo_chamber', ?, 'warning', ?)`).run(`ida_${crypto.randomUUID()}`, worldId, worldId, JSON.stringify({ avgDistance: avg, factions: rows.length })); }
    catch { /* noop */ }
  }
  return { ok: true, echoChamber: echo, avgDistance: Math.round(avg * 1000) / 1000 };
}

export const IDEOLOGY_CONSTANTS = Object.freeze({ WORLD_AXES, MOVE_AXIS_REVEAL });
