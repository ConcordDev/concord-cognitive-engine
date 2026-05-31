// server/lib/social/gossip.js
//
// Slice-of-Life SL2 — gossip propagation. A discovered secret seeps NPC→NPC→NPC
// along the npc_relationships social graph — an independent-cascade contagion
// (engine N3) run ONE hop per pass so it spreads gradually, weighted by bond
// strength. When a rumor reaches enough carriers it SURFACES: a carrier gains a
// blackmail hook over the subject (generateHookFromSecretDiscovery) and/or the
// carriers' opinion of the subject drops (→ the SL3 reputation hit). Behind
// CONCORD_GOSSIP. Pure-ish DB; spread takes an injectable rng; surface takes the
// hook/opinion fns injected so it's testable in isolation.

import crypto from "crypto";

export const SURFACE_REACH = 4;     // carriers before it goes public
export const SPREAD_PROB = 0.5;     // base per-edge hop probability (× bond strength)

export function gossipEnabled() { return process.env.CONCORD_GOSSIP === "1"; }
const uid = (p) => `${p}_${crypto.randomUUID().slice(0, 12)}`;

/** Build the NPC social adjacency for a world from npc_relationships (undirected). */
export function buildNpcAdjacency(db, worldId) {
  const adj = {};
  const add = (a, b, s) => { (adj[a] ||= []).push({ id: b, strength: s }); };
  const rows = db.prepare(`
    SELECT r.npc_id, r.related_id, COALESCE(r.strength,1.0) AS strength
    FROM npc_relationships r JOIN world_npcs n ON n.id = r.npc_id
    WHERE n.world_id = ?
  `).all(String(worldId));
  for (const r of rows) { add(r.npc_id, r.related_id, r.strength); add(r.related_id, r.npc_id, r.strength); }
  return adj;
}

/** Start a rumor from `originNpcId` (the first carrier). */
export function seedRumor(db, { secretId, subjectKind = "npc", subjectId, worldId, originNpcId }) {
  if (!db || !secretId || !subjectId || !worldId) return { ok: false, reason: "missing_inputs" };
  const id = uid("rumor");
  db.prepare(`INSERT INTO rumors (id, secret_id, subject_kind, subject_id, world_id, origin_npc_id, reach) VALUES (?,?,?,?,?,?,?)`)
    .run(id, String(secretId), subjectKind, String(subjectId), String(worldId), originNpcId ?? null, originNpcId ? 1 : 0);
  if (originNpcId) db.prepare(`INSERT OR IGNORE INTO rumor_carriers (rumor_id, npc_id) VALUES (?,?)`).run(id, String(originNpcId));
  return { ok: true, rumorId: id };
}

function carriers(db, rumorId) {
  return new Set(db.prepare(`SELECT npc_id FROM rumor_carriers WHERE rumor_id=?`).all(rumorId).map((r) => r.npc_id));
}

/**
 * One spread hop for every still-spreading rumor in the world: each current
 * carrier tells each neighbor with prob = SPREAD_PROB × bondStrength (capped 1).
 * New carriers join; reach/hops bump. Returns { spread } total new carriers.
 */
export function spreadPass(db, worldId, { prob = SPREAD_PROB, rng = Math.random } = {}) {
  const adj = buildNpcAdjacency(db, worldId);
  const rumors = db.prepare(`SELECT id FROM rumors WHERE world_id=? AND surfaced=0`).all(String(worldId));
  let spread = 0;
  for (const { id } of rumors) {
    const known = carriers(db, id);
    const newcomers = new Set();
    for (const c of known) {
      for (const nb of adj[c] || []) {
        if (known.has(nb.id) || newcomers.has(nb.id)) continue;
        const p = Math.min(1, prob * (Number(nb.strength) || 1));
        if (rng() < p) newcomers.add(nb.id);
      }
    }
    for (const nc of newcomers) db.prepare(`INSERT OR IGNORE INTO rumor_carriers (rumor_id, npc_id) VALUES (?,?)`).run(id, nc);
    if (newcomers.size > 0) {
      db.prepare(`UPDATE rumors SET reach = reach + ?, hops = hops + 1, last_spread_at = unixepoch() WHERE id=?`).run(newcomers.size, id);
      spread += newcomers.size;
    }
  }
  return { spread };
}

export function getRumor(db, rumorId) {
  return db.prepare(`SELECT * FROM rumors WHERE id=?`).get(String(rumorId));
}

/**
 * Surface a rumor once it's spread far enough: grant a blackmail hook to a
 * carrier over the subject + (optional) opinion hits. Injectable fns keep it
 * testable. No-op until reach ≥ SURFACE_REACH. Returns { surfaced, hookGranted }.
 */
export function maybeSurface(db, rumorId, { generateHook, recordOpinion, threshold = SURFACE_REACH } = {}) {
  const r = getRumor(db, rumorId);
  if (!r || r.surfaced) return { surfaced: false };
  if (r.reach < threshold) return { surfaced: false, reason: "still_spreading" };
  const cs = [...carriers(db, rumorId)];
  let hookGranted = false;
  if (typeof generateHook === "function" && cs.length) {
    // a carrier now holds leverage over the subject
    generateHook(db, { holderKind: "npc", holderId: cs[cs.length - 1], secretId: r.secret_id, worldId: r.world_id });
    hookGranted = true;
  }
  if (typeof recordOpinion === "function" && r.subject_kind) {
    for (const c of cs) recordOpinion(db, { npcId: c, targetKind: r.subject_kind, targetId: r.subject_id }, -4, `rumor:${rumorId}`);
  }
  db.prepare(`UPDATE rumors SET surfaced=1 WHERE id=?`).run(rumorId);
  return { surfaced: true, hookGranted, carriers: cs.length };
}
