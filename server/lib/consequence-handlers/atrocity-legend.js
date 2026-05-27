// server/lib/consequence-handlers/atrocity-legend.js
//
// Wave C / C1 — handles the mass_atrocity cascade's first two steps.
// Wave D will own the legend composition + bard performance machinery
// in detail; this handler emits the placeholder events + writes a row
// into world_legends if the table exists.

import crypto from "crypto";

export default async function handleAtrocityLegend(db, consequence) {
  if (!db || !consequence) return { ok: false, reason: "missing_args" };
  const p = consequence.payload || {};
  const worldId = consequence.worldId;
  const kind = consequence.kind;

  // For both legend + news steps: write a world_legends row when
  // the table is present (Wave D will populate this table fully).
  // News step also emits a wider-radius opinion shift.
  let legendId = null;
  try {
    legendId = `lg_${crypto.randomBytes(6).toString("hex")}`;
    db.prepare(`
      INSERT OR IGNORE INTO world_legends
        (id, world_id, subject_kind, subject_id, title, body, sentiment, severity)
      VALUES (?, ?, 'user', ?, ?, ?, ?, ?)
    `).run(
      legendId, worldId, p.actorUserId,
      `The Atrocity at ${p.location ? `(${Math.round(p.location.x)}, ${Math.round(p.location.z)})` : 'an unnamed place'}`,
      `${p.meta?.name || p.actorUserId} slaughtered the ${p.meta?.archetype || 'innocent'} ${p.victimNpcId ? `(${p.victimNpcId})` : ''}. The world remembers.`,
      -0.8,
      kind === "mass_atrocity_legend" ? 5 : 8,  // news step has higher severity
    );
  } catch { legendId = null; /* world_legends table absent; Wave D will ship */ }

  // Broadcast a -15 (legend) or -25 (news) opinion event across a wide radius.
  let opinionAffected = 0;
  try {
    const { broadcastOpinionEvent } = await import("../npc-relations.js");
    const delta = kind === "mass_atrocity_legend" ? -15 : -25;
    broadcastOpinionEvent?.(db, worldId, p.actorUserId, "player",
      kind === "mass_atrocity_legend" ? "atrocity_witnessed" : "atrocity_heard",
      p.location || { x: 0, z: 0 },
      { radius: kind === "mass_atrocity_legend" ? 60 : 1000, context: kind });
    opinionAffected = delta;
  } catch { /* relations optional */ }

  try {
    globalThis._concordRealtimeEmit?.(
      kind === "mass_atrocity_legend" ? "world:legend-composed" : "world:atrocity-news-spread",
      { worldId, legendId, actorUserId: p.actorUserId, victim: p.victimNpcId, opinionDelta: opinionAffected },
    );
  } catch { /* ok */ }

  return { ok: true, legendId, opinionAffected, kind };
}
