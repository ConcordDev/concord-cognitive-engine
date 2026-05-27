// server/lib/consequence-handlers/atrocity-legend.js
//
// Wave C / C1 — handles the mass_atrocity cascade's first two steps.
// Wave D will own the legend composition + bard performance machinery
// in detail; this handler emits the placeholder events + writes a row
// into world_legends if the table exists.

export default async function handleAtrocityLegend(db, consequence) {
  if (!db || !consequence) return { ok: false, reason: "missing_args" };
  const p = consequence.payload || {};
  const worldId = consequence.worldId;
  const kind = consequence.kind;

  // Wave D — compose a real legend via the composer so it also fans
  // out to every bard in the world via bard_repertoire.
  let legendId = null;
  let bardsAttached = 0;
  try {
    const { composeLegend } = await import("../world-legends.js");
    const r = composeLegend(db, {
      worldId,
      subjectKind: "user",
      subjectId: p.actorUserId,
      eventKind: "mass_atrocity",
      eventContext: {
        subjectName: p.meta?.name || p.actorUserId,
        location: p.location || null,
        detail: p.victimNpcId ? `Victim: ${p.victimNpcId}.` : null,
      },
    });
    if (r?.ok) {
      legendId = r.legendId;
      bardsAttached = r.bardsAttached ?? 0;
    }
  } catch { /* composer optional */ }

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

  return { ok: true, legendId, bardsAttached, opinionAffected, kind };
}
