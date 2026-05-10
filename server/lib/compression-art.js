// server/lib/compression-art.js
//
// Phase 9.1 (idea #24) — DTU compression art.
//
// MEGA / HYPER tier DTUs are compressed knowledge artifacts. Visualise
// each as a deterministic 3D sigil derived from the source-DTU
// embeddings cluster. Each MEGA → unique procedural shape descriptor:
//   { seed, vertex_count, branch_factor, dominant_color, twist_rate }
// The frontend consumes this descriptor and renders via Three.js
// procedural geometry — sigil rotates, hovers in a gallery.

import crypto from "node:crypto";

const PALETTE = [
  "#7c3aed", "#06b6d4", "#10b981", "#f59e0b", "#ef4444",
  "#ec4899", "#8b5cf6", "#3b82f6", "#84cc16", "#a855f7",
];

export function computeShapeFor(megaId, { sourceCount = 0, dominantElement = null } = {}) {
  const seed = crypto.createHash("sha256").update(String(megaId)).digest("hex");
  const buf = Buffer.from(seed, "hex");
  const vertex_count = 7 + (buf[0] % 17);              // 7..23 vertices
  const branch_factor = 3 + (buf[1] % 5);              // 3..7
  const twist_rate = ((buf[2] / 255) * 2 - 1).toFixed(3); // -1..+1
  const palette_idx = buf[3] % PALETTE.length;
  const radius = 1 + (buf[4] / 255) * 1.5;             // 1..2.5
  const layers = 1 + Math.min(4, Math.floor(sourceCount / 5));
  return {
    seed, vertex_count, branch_factor,
    twist_rate: Number(twist_rate),
    dominant_color: PALETTE[palette_idx],
    radius,
    layers,
    dominant_element: dominantElement || null,
  };
}

export function recordSigil(db, megaId, tier, shape, centroid = null) {
  if (!db || !megaId) return { ok: false, reason: "missing_inputs" };
  try {
    db.prepare(`
      INSERT OR REPLACE INTO compression_art_sigils
        (mega_dtu_id, tier, shape_seed, cluster_centroid_json, dominant_element)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      megaId, tier, shape.seed,
      centroid ? JSON.stringify(centroid) : null,
      shape.dominant_element || null,
    );
    return { ok: true };
  } catch (err) { return { ok: false, error: String(err?.message || err) }; }
}

export function listSigilsForUser(db, userId, limit = 100) {
  if (!db || !userId) return [];
  try {
    return db.prepare(`
      SELECT s.id, s.mega_dtu_id, s.tier, s.shape_seed, s.dominant_element, s.created_at,
             d.title, d.meta_json
      FROM compression_art_sigils s
      JOIN dtus d ON d.id = s.mega_dtu_id
      WHERE d.creator_id = ?
      ORDER BY s.created_at DESC LIMIT ?
    `).all(userId, limit);
  } catch { return []; }
}
