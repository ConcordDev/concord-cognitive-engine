// server/lib/npc-dossier.js
//
// The single read-only window onto an NPC's political life. The trait inspector
// showed grudge/preoccupation/desire/hook; this aggregates the WHOLE CK3 dossier
// from the substrate that already exists — active schemes (by/against them),
// secrets the viewer has discovered, stress + coping, their opinion score of YOU,
// faction stance, and held/over hooks — so a player can read a character's whole
// political life from one panel. Powers the NPCTraitInspector dossier, the
// Concord Link political view, and the scheme barge-in context.
//
// Read-only, every section table-guarded (a missing table/column degrades to
// empty, never throws), viewer-scoped (secrets must be DISCOVERED by the viewer;
// NPC secret contents never leak — only the fact a discovered secret exists).

import { resolveCollectiveFace } from "./collective-face.js";

function safe(fn, fallback) { try { return fn(); } catch { return fallback; } }

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string} npcId
 * @param {string} viewerId  the looking player (for opinion-of-you + secret scoping)
 * @returns {{ok:boolean, npcId:string, schemes:object[], secretsDiscovered:object[], stress:object|null, opinionOfYou:object|null, faction:object|null, hooks:object, lineage:object|null}}
 */
export function buildDossier(db, npcId, viewerId = null) {
  if (!db || !npcId) return { ok: false, reason: "missing_inputs" };
  const id = String(npcId);

  // Active schemes the NPC is plotting OR is the target of (the live intrigue).
  const schemes = safe(() => db.prepare(
    `SELECT id, plotter_kind, plotter_id, target_kind, target_id, kind, phase AS status,
            COALESCE(success_pct, 0) AS successPct
       FROM npc_schemes
      WHERE (plotter_id = ? OR target_id = ?) AND phase NOT IN ('complete', 'abandoned', 'exposed')
      ORDER BY rowid DESC LIMIT 20`
  ).all(id, id).map((s) => {
    const role = s.plotter_id === id ? "plotter" : "target";
    // Resolve the OTHER party to a confrontable person: if it's a faction/kingdom
    // (correctly not walkable) surface its embodied leader as the face.
    const cpKind = role === "plotter" ? s.target_kind : s.plotter_kind;
    const cpId = role === "plotter" ? s.target_id : s.plotter_id;
    const counterpartyFace = (cpKind === "faction" || cpKind === "kingdom" || cpKind === "realm")
      ? safe(() => resolveCollectiveFace(db, cpKind, cpId), null)
      : { kind: cpKind, id: cpId, face: { kind: cpKind, id: cpId, via: "self" }, collective: false };
    return { ...s, role, counterpartyFace };
  }), []);

  // Secrets about this NPC that the VIEWER has discovered (fact + severity only —
  // never the secret's contents to the LLM/UI per the NPC-secret invariant).
  const secretsDiscovered = viewerId ? safe(() => db.prepare(
    `SELECT s.id, s.kind, s.discovery_difficulty AS severity
       FROM secrets s JOIN secret_discoveries d ON d.secret_id = s.id
      WHERE s.subject_kind = 'npc' AND s.subject_id = ? AND d.user_id = ?
      ORDER BY s.discovery_difficulty DESC LIMIT 20`
  ).all(id, String(viewerId)), []) : [];

  const stress = safe(() => db.prepare(
    `SELECT stress, coping_trait AS coping FROM npc_stress WHERE npc_id = ?`
  ).get(id) || null, null);

  // The NPC's opinion of the looking player — the "do they like you" read.
  const opinionOfYou = viewerId ? safe(() => db.prepare(
    `SELECT score, kind FROM character_opinions
      WHERE npc_id = ? AND target_kind = 'player' AND target_id = ?`
  ).get(id, String(viewerId)) || null, null) : null;

  // Faction stance + the grief/radicalized political flags.
  const faction = safe(() => {
    const cols = db.prepare(`PRAGMA table_info(world_npcs)`).all().map((c) => c.name);
    const fcol = cols.includes("faction_id") ? "faction_id" : cols.includes("faction") ? "faction" : null;
    const sel = ["id"];
    if (fcol) sel.push(`${fcol} AS faction`);
    if (cols.includes("grief_level")) sel.push("grief_level AS grief");
    if (cols.includes("radicalized")) sel.push("radicalized");
    const row = db.prepare(`SELECT ${sel.join(", ")} FROM world_npcs WHERE id = ?`).get(id);
    return row ? { faction: row.faction ?? null, grief: row.grief ?? 0, radicalized: !!row.radicalized } : null;
  }, null);

  // Hooks — leverage the NPC holds over others vs leverage held over them.
  const hooks = safe(() => {
    const held = db.prepare(`SELECT COUNT(*) n FROM npc_hooks WHERE holder_kind='npc' AND holder_id=? AND (expires_at IS NULL OR expires_at > unixepoch())`).get(id)?.n ?? 0;
    const over = db.prepare(`SELECT COUNT(*) n FROM npc_hooks WHERE target_kind='npc' AND target_id=? AND (expires_at IS NULL OR expires_at > unixepoch())`).get(id)?.n ?? 0;
    return { heldByThem: held, overThem: over };
  }, { heldByThem: 0, overThem: 0 });

  // Lineage (light — dynasty / parent if the bloodline table is present).
  const lineage = safe(() => {
    const row = db.prepare(`SELECT dynasty_id AS dynasty, parent_a_id AS parentA, parent_b_id AS parentB FROM npc_bloodline WHERE npc_id = ?`).get(id);
    return row || null;
  }, null);

  return { ok: true, npcId: id, schemes, secretsDiscovered, stress, opinionOfYou, faction, hooks, lineage };
}

export default buildDossier;
