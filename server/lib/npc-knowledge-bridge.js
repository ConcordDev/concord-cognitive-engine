// server/lib/npc-knowledge-bridge.js
//
// v2.0 instantiation: medical / research DTUs influence NPC dialogue.
// DTUs tagged 'medical' (or any of MEDICAL_TAGS) and visible (not private)
// are mirrored into npc_knowledge with a role mapping (e.g. 'medical' →
// 'doctor', 'engineering' → 'engineer'). NPCs with that role pull the
// summaries via getKnowledgeForRole() during dialogue generation.
//
// Idempotent: keyed (world_id, role, dtu_id), so re-runs are no-ops.

const MEDICAL_TAGS = new Set(["medical", "surgery", "diagnostics"]);
const RESEARCH_TAGS = new Set(["research", "study", "findings"]);
const ENGINEERING_TAGS = new Set(["engineering", "blueprint", "schematic"]);

// Tag → NPC role. Adding more roles is a one-line change.
function tagsToRoles(tags) {
  const roles = new Set();
  for (const tag of tags) {
    if (MEDICAL_TAGS.has(tag)) roles.add("doctor");
    if (RESEARCH_TAGS.has(tag)) roles.add("scholar");
    if (ENGINEERING_TAGS.has(tag)) roles.add("engineer");
  }
  return Array.from(roles);
}

const SUMMARY_MAX_CHARS = 240;
// Bumped from 100 → 1000 for 32GB-heap deployments. Per-tick cap on how many
// medical/research/engineering DTUs we mirror into npc_knowledge in one pass.
const BATCH_LIMIT = Number(process.env.CONCORD_NPC_KNOWLEDGE_BATCH) || 1000;

/**
 * Run one pass: scan recent DTUs tagged medical/research/engineering and
 * mirror them into npc_knowledge. Designed to be wired into the heartbeat
 * registry every N ticks.
 *
 * @param {{ state: object, db: object, tickCount: number }} ctx
 */
export function runNpcKnowledgeBridge({ state, db }) {
  if (!db) return { ok: false, reason: "no_db" };
  if (!state) return { ok: false, reason: "no_state" };

  const cursor = state._npcKnowledgeBridgeCursor || "1970-01-01T00:00:00.000Z";

  const rows = db.prepare(`
    SELECT id, owner_user_id, title, body_json, tags_json, created_at
    FROM dtus
    WHERE created_at > ?
      AND visibility != 'private'
      AND (tags_json LIKE '%medical%' OR tags_json LIKE '%research%' OR tags_json LIKE '%engineering%')
    ORDER BY created_at ASC
    LIMIT ?
  `).all(cursor, BATCH_LIMIT);

  let inserted = 0;
  let lastSeenAt = cursor;

  const insert = db.prepare(`
    INSERT OR IGNORE INTO npc_knowledge
      (id, world_id, role, dtu_id, summary, domain)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  for (const row of rows) {
    try {
      let tags = [];
      try { tags = JSON.parse(row.tags_json || "[]"); } catch { /* malformed */ }
      if (!Array.isArray(tags)) { lastSeenAt = row.created_at; continue; }

      const roles = tagsToRoles(tags);
      if (roles.length === 0) { lastSeenAt = row.created_at; continue; }

      let body = {};
      try { body = JSON.parse(row.body_json || "{}"); } catch { /* malformed */ }
      const summary = (body.content ?? row.title ?? "").toString().slice(0, SUMMARY_MAX_CHARS);
      if (!summary.trim()) { lastSeenAt = row.created_at; continue; }

      const worldId = body.worldId ?? "concordia-hub";
      const domain = tags.find((t) => t.startsWith("domain:"))?.slice(7) ?? null;

      for (const role of roles) {
        const id = `nk_${role}_${row.id}`;
        const r = insert.run(id, worldId, role, row.id, summary, domain);
        if (r.changes > 0) inserted++;
      }
      lastSeenAt = row.created_at;
    } catch {
      lastSeenAt = row.created_at || lastSeenAt;
    }
  }

  state._npcKnowledgeBridgeCursor = lastSeenAt;
  return { ok: true, inserted, scanned: rows.length };
}

/**
 * Pull recent knowledge entries for an NPC role in a world. Used by
 * narrative-bridge to enrich oracle dialogue context.
 */
export function getKnowledgeForRole(db, { worldId, role, limit = 5 }) {
  if (!db || !role) return [];
  return db.prepare(`
    SELECT dtu_id, summary, domain, created_at
    FROM npc_knowledge
    WHERE world_id = ? AND role = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(worldId || "concordia-hub", role, limit);
}
