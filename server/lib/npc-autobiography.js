// server/lib/npc-autobiography.js
//
// Phase 9.1 (idea #5) — NPC autobiography compose.
//
// Mirrors `dream-engine.js`'s composeDeterministic shape: gather
// fragments from the NPC's accumulated state (grudges, schemes,
// schedule history, dreams co-authored, opinions), stitch into
// grounded prose, mint as kind='npc_autobiography' DTU.
//
// Trigger thresholds (any one):
//   - ≥10 npc_grudges entries
//   - ≥5 completed npc_schemes
//   - ≥3 npc_inheritance_links recorded
//   - ≥365 days since last autobiography (generation N → N+1)
//
// Idempotent on (npc_id, generation) via mig 161 UNIQUE.

import crypto from "node:crypto";
import { npcNameFromRow } from "./npc-name.js";

const MIN_GRUDGES = 10;
const MIN_SCHEMES = 5;
const MIN_INHERITANCES = 3;
const REGEN_DAYS = 365;

export function gatherFragments(db, npcId) {
  const out = { grudges: [], schemes: [], schedule_blocks: [], opinions: [], deaths_witnessed: [] };
  try {
    out.grudges = db.prepare(`
      SELECT target_kind, target_id, severity, created_at
      FROM npc_grudges WHERE npc_id = ? ORDER BY created_at ASC LIMIT 50
    `).all(npcId);
  } catch { /* table optional */ }
  try {
    out.schemes = db.prepare(`
      SELECT kind, phase, created_at
      FROM npc_schemes WHERE plotter_kind = 'npc' AND plotter_id = ?
      ORDER BY created_at ASC LIMIT 30
    `).all(npcId);
  } catch { /* optional */ }
  try {
    out.schedule_blocks = db.prepare(`
      SELECT block_idx, activity_kind, location_kind
      FROM npc_schedules WHERE npc_id = ? ORDER BY block_idx ASC
    `).all(npcId);
  } catch { /* optional */ }
  try {
    out.opinions = db.prepare(`
      SELECT subject_kind, subject_id, score
      FROM character_opinions WHERE holder_npc_id = ? LIMIT 30
    `).all(npcId);
  } catch { /* optional */ }
  return out;
}

export function shouldCompose(db, npcId) {
  const f = gatherFragments(db, npcId);
  const reasons = [];
  if (f.grudges.length >= MIN_GRUDGES) reasons.push("grudge_threshold");
  if (f.schemes.length >= MIN_SCHEMES) reasons.push("scheme_threshold");
  // Last autobiography age
  let lastGen = 0;
  let lastAt = 0;
  try {
    const row = db.prepare(`
      SELECT MAX(generation) as gen, MAX(composed_at) as at
      FROM npc_autobiography_dtus WHERE npc_id = ?
    `).get(npcId);
    lastGen = row?.gen || 0;
    lastAt = row?.at || 0;
  } catch { /* table may not exist yet */ }
  const daysSince = lastAt ? (Date.now() / 1000 - lastAt) / 86400 : Infinity;
  if (lastGen > 0 && daysSince >= REGEN_DAYS) reasons.push("regen_window");
  if (lastGen === 0 && reasons.length > 0) reasons.push("first_autobiography");
  return { compose: reasons.length > 0, generation: lastGen + 1, reasons, fragments: f };
}

export function composeDeterministic({ npc, generation, fragments }) {
  const lines = [];
  const name = npc?.name || npc?.id || "An NPC";
  lines.push(`The Life of ${name}, vol. ${generation}`);
  lines.push("");
  if (fragments.grudges?.length) {
    lines.push(`I held grudges against ${fragments.grudges.length} souls.`);
    const top = fragments.grudges.sort((a, b) => (b.severity || 0) - (a.severity || 0))[0];
    if (top) lines.push(`The deepest cut was a ${top.severity}/10 against ${top.target_kind} ${top.target_id}.`);
  }
  if (fragments.schemes?.length) {
    const completed = fragments.schemes.filter(s => s.phase === "complete").length;
    lines.push(`I plotted ${fragments.schemes.length} schemes; ${completed} reached completion.`);
  }
  if (fragments.schedule_blocks?.length) {
    const activities = fragments.schedule_blocks.map(b => b.activity_kind).join(" → ");
    lines.push(`My days followed a rhythm: ${activities}.`);
  }
  if (fragments.opinions?.length) {
    lines.push(`I formed opinions about ${fragments.opinions.length} entities — many warm, some cold.`);
  }
  lines.push("");
  lines.push(`This is the ${generation === 1 ? "first" : generation === 2 ? "second" : `${generation}th`} volume.`);
  return lines.join("\n");
}

export async function tryComposeForNpc(db, npcId) {
  if (!db || !npcId) return { ok: false, reason: "missing_inputs" };
  const decision = shouldCompose(db, npcId);
  if (!decision.compose) return { ok: true, composed: false, reason: "thresholds_not_met" };

  let npc = null;
  try {
    npc = db.prepare(`SELECT id, archetype, npc_type, state FROM world_npcs WHERE id = ?`).get(npcId);
    if (npc) npc.name = npcNameFromRow(npc); // world_npcs has no `name` column — derive from state
  } catch { /* world_npcs optional in minimal builds */ }
  if (!npc) return { ok: false, reason: "npc_not_found" };

  const prose = composeDeterministic({ npc, generation: decision.generation, fragments: decision.fragments });
  const dtuId = `npc_autobio:${npcId}:${decision.generation}:${crypto.randomBytes(4).toString("hex")}`;
  const meta = {
    skill_kind: "npc_autobiography",
    npc_id: npcId,
    generation: decision.generation,
    reasons: decision.reasons,
    grudge_count: decision.fragments.grudges?.length || 0,
    scheme_count: decision.fragments.schemes?.length || 0,
  };
  try {
    db.prepare(`
      INSERT INTO dtus (id, type, title, creator_id, data, skill_level, total_experience, created_at)
      VALUES (?, 'npc_autobiography', ?, ?, ?, 1, 0, unixepoch())
    `).run(dtuId, `Life of ${npc.name || npcId}, vol. ${decision.generation}`, "system", JSON.stringify({ ...meta, body: prose }));
    db.prepare(`
      INSERT INTO npc_autobiography_dtus (npc_id, generation, dtu_id, composer)
      VALUES (?, ?, ?, 'deterministic')
    `).run(npcId, decision.generation, dtuId);
  } catch (err) { return { ok: false, error: String(err?.message || err) }; }
  return { ok: true, composed: true, dtuId, generation: decision.generation };
}

export function getRecent(db, npcId, limit = 5) {
  if (!db) return [];
  try {
    return db.prepare(`
      SELECT a.id, a.npc_id, a.generation, a.dtu_id, a.composed_at,
             d.title, d.meta_json
      FROM npc_autobiography_dtus a
      LEFT JOIN dtus d ON d.id = a.dtu_id
      WHERE a.npc_id = ? ORDER BY a.generation DESC LIMIT ?
    `).all(npcId, limit);
  } catch { return []; }
}
