// server/lib/world-legends.js
//
// Wave D / D1 — legend composition + bard repertoire propagation.
//
// composeLegend({worldId, subjectKind, subjectId, eventKind, eventContext})
//   - Deterministic title + body composition (no LLM in v1; the
//     subconscious-brain composer can layer on top by reading + rewriting
//     the body field). Sentiment + severity derived from eventKind.
//   - Inserts into world_legends + attaches to every bard-NPC in the
//     world via bard_repertoire (so the bard cycle has something to sing).
//
// listLegends(db, worldId, opts) — newest-first read for the
//   BardSongOverlay frontend.

import crypto from "crypto";

// Sentiment + severity per event kind. Hand-tuned so the visceral
// stuff lands cleanly.
const EVENT_KIND_CONFIG = Object.freeze({
  royal_kill:            { sentiment: -0.7, severity: 9, titleVerb: "regicide" },
  mass_atrocity:         { sentiment: -0.9, severity: 10, titleVerb: "slaughter" },
  betrayal:              { sentiment: -0.5, severity: 6, titleVerb: "betrayal" },
  dynasty_succession:    { sentiment: 0.2,  severity: 4, titleVerb: "passing of the crown" },
  legendary_victory:     { sentiment: 0.8,  severity: 8, titleVerb: "triumph" },
  great_taming:          { sentiment: 0.4,  severity: 5, titleVerb: "great taming" },
  refusal_dome_collapse: { sentiment: 0.6,  severity: 9, titleVerb: "breaking of the dome" },
  default:               { sentiment: 0.0,  severity: 3, titleVerb: "deed" },
});

/**
 * Compose a legend + attach to all bards in the world.
 * Returns { ok, legendId, bardsAttached }.
 */
export function composeLegend(db, { worldId, subjectKind, subjectId, eventKind, eventContext = {} } = {}) {
  if (!db || !worldId || !subjectKind || !subjectId || !eventKind) {
    return { ok: false, reason: "missing_args" };
  }
  const cfg = EVENT_KIND_CONFIG[eventKind] || EVENT_KIND_CONFIG.default;
  const legendId = `lg_${crypto.randomBytes(6).toString("hex")}`;

  // Title is composed deterministically — Wave E2 can swap to LLM phrasing later.
  const subjectName = eventContext.subjectName || subjectId;
  const place = eventContext.location ?
    `at (${Math.round(eventContext.location.x ?? 0)}, ${Math.round(eventContext.location.z ?? 0)})` :
    "in an unnamed place";
  const title = _composeTitle(subjectName, cfg.titleVerb, eventContext);
  const body = _composeBody(subjectName, cfg.titleVerb, place, eventContext, cfg.sentiment);

  try {
    db.prepare(`
      INSERT INTO world_legends (id, world_id, subject_kind, subject_id, title, body, sentiment, severity)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(legendId, worldId, subjectKind, subjectId, title, body, cfg.sentiment, cfg.severity);
  } catch (err) {
    return { ok: false, reason: "persist_failed", message: err?.message };
  }

  // Attach to every bard NPC in the world. The bard cycle picks the
  // top-severity legend in each bard's repertoire when performing.
  let bardsAttached = 0;
  try {
    const bards = db.prepare(`
      SELECT id FROM world_npcs
      WHERE world_id = ?
        AND COALESCE(is_dead, 0) = 0
        AND (archetype = 'bard' OR archetype = 'entertainer' OR archetype = 'storyteller'
             OR archetype LIKE 'bard:%')
      LIMIT 100
    `).all(worldId);
    for (const b of bards) {
      try {
        db.prepare(`
          INSERT OR IGNORE INTO bard_repertoire (bard_npc_id, legend_id)
          VALUES (?, ?)
        `).run(b.id, legendId);
        bardsAttached++;
      } catch { /* skip */ }
    }
  } catch { /* world_npcs absent on minimal builds */ }

  return { ok: true, legendId, title, sentiment: cfg.sentiment, severity: cfg.severity, bardsAttached };
}

/** Read recent legends for a world (newest first). UI / digest consumer. */
export function listLegends(db, worldId, { limit = 50, sentimentMin = null, sentimentMax = null } = {}) {
  if (!db || !worldId) return [];
  try {
    const clauses = ["world_id = ?"];
    const args = [worldId];
    if (sentimentMin != null) { clauses.push("sentiment >= ?"); args.push(sentimentMin); }
    if (sentimentMax != null) { clauses.push("sentiment <= ?"); args.push(sentimentMax); }
    args.push(limit);
    return db.prepare(`
      SELECT * FROM world_legends WHERE ${clauses.join(" AND ")}
      ORDER BY composed_at DESC LIMIT ?
    `).all(...args);
  } catch { return []; }
}

function _composeTitle(subjectName, verb, ctx) {
  if (ctx.factionName)   return `The ${_capitalize(verb)} at ${ctx.factionName}`;
  if (ctx.placeName)     return `The ${_capitalize(verb)} at ${ctx.placeName}`;
  return `The ${_capitalize(verb)} of ${subjectName}`;
}

function _composeBody(subjectName, verb, place, ctx, sentiment) {
  const judgment = sentiment <= -0.6 ? "an abomination"
                  : sentiment <= -0.2 ? "a grim deed"
                  : sentiment <= 0.2 ? "a notable thing"
                  : sentiment <= 0.6 ? "a noble act"
                  : "a triumph remembered in song";
  const witness = ctx.witnessCount ? `${ctx.witnessCount} watched` : "few saw it firsthand";
  return [
    `${_capitalize(subjectName)} stood ${place}. What followed was ${judgment}.`,
    ctx.detail ? `${ctx.detail}` : null,
    `${_capitalize(witness)}, but the song will outlive every witness.`,
  ].filter(Boolean).join(" ");
}

function _capitalize(s) {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export const _internal = { EVENT_KIND_CONFIG, _composeTitle, _composeBody };
