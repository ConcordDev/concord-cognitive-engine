/**
 * First-class NPC memory. Categories from the living-world spec.
 * persistence='permanent' never fades; others decay by importance.
 */
import { randomUUID } from "node:crypto";

export const MEMORY_CATEGORIES = Object.freeze([
  "PLAYER_ACTION", "NPC_INTERACTION", "COMBAT", "CRIME", "KINDNESS",
  "BETRAYAL", "PROMISE", "GIFT", "INSULT", "ROMANCE", "LOSS",
  "DISCOVERY", "RUMOR", "POLITICAL_EVENT", "FACTION_EVENT", "WORLD_EVENT",
]);

const CAT = new Set(MEMORY_CATEGORIES);

function clamp01(n) {
  return Math.max(0, Math.min(1, Number(n) || 0));
}

export function recordMemory(db, opts) {
  if (!db || !opts?.npcId) return { ok: false, reason: "missing_npc" };
  const category = String(opts.category || "").toUpperCase();
  if (!CAT.has(category)) return { ok: false, reason: "unknown_category" };
  const importance = clamp01(opts.importance ?? 0.5);
  const persistence = importance >= 0.9 || opts.persistence === "permanent" ? "permanent" : "decay";
  const now = Number(opts.createdAt || Date.now());
  const halfLifeDays = 3 + (1 - importance) * 21;
  const fadesAt = persistence === "permanent" ? null : now + Math.round(halfLifeDays * 86400000);
  const id = opts.id || `nmem_${randomUUID()}`;
  db.prepare(`
    INSERT INTO npc_memories (
      id, npc_id, category, subject_kind, subject_id, importance, emotion, text,
      persistence, consequence_id, created_at, fades_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    id, opts.npcId, category,
    opts.subjectKind || null, opts.subjectId || null,
    importance, opts.emotion || null, opts.text || null,
    persistence, opts.consequenceId || null, now, fadesAt,
  );
  return { ok: true, id, persistence };
}

export function memoriesFor(db, npcId, { includeFaded = false, limit = 40 } = {}) {
  const now = Date.now();
  const rows = db.prepare(`
    SELECT * FROM npc_memories WHERE npc_id = ?
    ORDER BY importance DESC, created_at DESC LIMIT ?
  `).all(npcId, Math.min(200, limit));
  if (includeFaded) return rows;
  return rows.filter((r) => r.persistence === "permanent" || !r.fades_at || r.fades_at > now);
}

export function inheritMemories(db, fromNpcId, toNpcId, factor = 0.6) {
  const src = memoriesFor(db, fromNpcId, { includeFaded: false, limit: 20 });
  let n = 0;
  for (const m of src) {
    if (m.importance < 0.7) continue;
    recordMemory(db, {
      npcId: toNpcId,
      category: m.category,
      subjectKind: m.subject_kind,
      subjectId: m.subject_id,
      importance: Math.min(1, m.importance * factor),
      emotion: m.emotion,
      text: m.text ? `inherited: ${m.text}` : null,
      persistence: m.importance >= 0.9 ? "permanent" : "decay",
    });
    n++;
  }
  return n;
}

export function sweepFadedMemories(db, now = Date.now()) {
  const info = db.prepare(`
    DELETE FROM npc_memories
    WHERE persistence = 'decay' AND fades_at IS NOT NULL AND fades_at <= ?
  `).run(now);
  return { ok: true, deleted: info.changes };
}
