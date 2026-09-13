/**
 * Inspectability — "Why did Rael attack me?"
 * Reads needs, memories, 12-axis, routine, warrants. Never invents a motive.
 */
import { getNeeds, topNeed } from "./npc-needs.js";
import { memoriesFor } from "./npc-memory.js";
import { getAxes, describeAxes } from "./npc-relation-axes.js";
import { authoredNpcPublic } from "./world-lore-present.js";

function parse(v, fallback) {
  if (v == null || v === "") return fallback;
  if (typeof v === "object") return v;
  try { return JSON.parse(v); } catch { return fallback; }
}

export function explainNpc(db, npcId, { viewerId = null, worldId = null } = {}) {
  if (!db || !npcId) return { ok: false, reason: "missing_npc" };
  let row = null;
  try {
    row = db.prepare(`
      SELECT n.id, n.archetype, n.faction, n.state, n.is_wanted, n.bounty, n.world_id,
             r.activity_kind, r.location_kind
        FROM world_npcs n
        LEFT JOIN npc_routine_state r ON r.npc_id = n.id
       WHERE n.id = ?
       LIMIT 1
    `).get(npcId);
  } catch {
    try {
      row = db.prepare(`SELECT id, archetype, faction, state, world_id FROM world_npcs WHERE id = ?`).get(npcId);
    } catch {
      return { ok: false, reason: "no_table" };
    }
  }
  if (!row) return { ok: false, reason: "not_found", npcId };

  const state = parse(row.state, {});
  const authored = authoredNpcPublic(npcId, row.world_id || worldId)
    || authoredNpcPublic(state.name, row.world_id || worldId);
  const name = authored?.name || state.name || row.archetype || npcId;
  const needs = getNeeds(db, npcId);
  const urgent = topNeed(needs);
  let memories = [];
  try { memories = memoriesFor(db, npcId, { limit: 8 }); } catch { /* */ }
  let axes = null;
  if (viewerId) {
    try { axes = getAxes(db, npcId, "player", viewerId); } catch { axes = null; }
  }
  const axesLine = axes ? describeAxes(axes) : "unknown_to_viewer";

  const why = [];
  if (row.is_wanted) why.push(`wanted (bounty ${Number(row.bounty) || 0})`);
  if (urgent && urgent.deficit >= 0.55) why.push(`${urgent.kind} deficit ${urgent.deficit.toFixed(2)}`);
  if (axes) {
    if (axes.hatred > 0.35) why.push("hatred of you");
    if (axes.fear > 0.35) why.push("fear of you");
    if (axes.gratitude > 0.35) why.push("gratitude toward you");
    if (axes.trust < -0.3) why.push("does not trust you");
  }
  if (memories[0]) why.push(`remembers ${memories[0].category}`);
  if (row.activity_kind) why.push(`now ${row.activity_kind}`);
  else if (authored?.activity) why.push(`now ${authored.activity}`);
  if (authored?.line) why.push("authored");
  if (why.length === 0) why.push("no recorded motive against the viewer");

  return {
    ok: true,
    npcId,
    name,
    title: authored?.title || state.occupation || null,
    worldId: row.world_id || worldId || null,
    archetype: row.archetype || null,
    faction: row.faction || null,
    activity: row.activity_kind || authored?.activity || state.currentActivity || null,
    authoredLine: authored?.line || null,
    locationKind: row.location_kind || null,
    wanted: !!row.is_wanted,
    bounty: Number(row.bounty) || 0,
    needs,
    urgentNeed: urgent,
    axes: axes || undefined,
    axesLine,
    memories: memories.map((m) => ({
      category: m.category,
      importance: m.importance,
      text: m.text,
      subjectId: m.subject_id,
    })),
    why: why.join("; "),
    confidence: memories.length || axes ? 0.8 : 0.45,
  };
}
