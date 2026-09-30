/**
 * 12-axis relationships. Coexists with character_opinions (scalar score).
 * Axes are -1..+1. Someone can respect you and not trust you.
 */
const AXES = [
  "trust", "respect", "fear", "love", "hatred", "gratitude",
  "jealousy", "loyalty", "attraction", "debt", "dependency", "ideological_alignment",
];

function clamp(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.max(-1, Math.min(1, v));
}

function empty() {
  const o = {};
  for (const a of AXES) o[a] = 0;
  return o;
}

function ensure(db, npcId, targetKind, targetId) {
  db.prepare(`
    INSERT INTO npc_relation_axes (npc_id, target_kind, target_id, updated_at)
    VALUES (?, ?, ?, unixepoch())
    ON CONFLICT(npc_id, target_kind, target_id) DO NOTHING
  `).run(npcId, targetKind, targetId);
}

export function getAxes(db, npcId, targetKind, targetId) {
  if (!db || !npcId) return empty();
  const row = db.prepare(`
    SELECT * FROM npc_relation_axes
    WHERE npc_id = ? AND target_kind = ? AND target_id = ?
  `).get(npcId, targetKind, targetId);
  if (!row) return empty();
  const out = empty();
  for (const a of AXES) out[a] = clamp(row[a]);
  return out;
}

export function applyAxes(db, { npcId, targetKind, targetId }, deltas = {}) {
  if (!db || !npcId || !targetKind || !targetId) return { ok: false, reason: "missing" };
  ensure(db, npcId, targetKind, targetId);
  const cur = getAxes(db, npcId, targetKind, targetId);
  const next = { ...cur };
  for (const a of AXES) {
    if (deltas[a] != null) next[a] = clamp(cur[a] + Number(deltas[a]));
  }
  db.prepare(`
    UPDATE npc_relation_axes SET
      trust=?, respect=?, fear=?, love=?, hatred=?, gratitude=?,
      jealousy=?, loyalty=?, attraction=?, debt=?, dependency=?,
      ideological_alignment=?, updated_at=unixepoch()
    WHERE npc_id=? AND target_kind=? AND target_id=?
  `).run(
    next.trust, next.respect, next.fear, next.love, next.hatred, next.gratitude,
    next.jealousy, next.loyalty, next.attraction, next.debt, next.dependency,
    next.ideological_alignment, npcId, targetKind, targetId,
  );
  return { ok: true, axes: next };
}

/** One-line for dialogue / inspector. */
export function describeAxes(axes) {
  const a = axes || empty();
  const bits = [];
  if (a.respect > 0.4 && a.trust < 0.2) bits.push("capable, untrusted");
  if (a.fear > 0.4) bits.push("afraid");
  if (a.gratitude > 0.4) bits.push("grateful");
  if (a.hatred > 0.4) bits.push("hates");
  if (a.love > 0.4) bits.push("loves");
  if (a.debt > 0.3) bits.push("owes");
  return bits.length ? bits.join("; ") : "neutral";
}

export const RELATION_AXES = AXES;
