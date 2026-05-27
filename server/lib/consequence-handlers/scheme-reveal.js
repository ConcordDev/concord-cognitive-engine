// server/lib/consequence-handlers/scheme-reveal.js
//
// Wave B / B2 — handles `scheme:reveal` consequences. When fired:
//   1. Emit a `scheme:revealed` realtime event so frontends within the
//      same world room show the cinematic reveal
//   2. Insert a synthetic secret about the scheme so players who pay
//      close attention can stumble onto the conspiracy
//   3. Apply opinion deltas to the plotter (everyone now knows what
//      they did, even if the scheme succeeded)
//
// Invoked by consequence-dispatcher-cycle.

export default async function handleSchemeReveal(db, consequence) {
  if (!db || !consequence) return { ok: false, reason: "missing_args" };
  const p = consequence.payload || {};
  const { schemeId, plotterKind, plotterId, targetKind, targetId, kind, phase } = p;
  const worldId = consequence.worldId;
  if (!schemeId) return { ok: false, reason: "missing_schemeId" };

  // 1. Emit realtime. Frontends in world:<id> + user:<plotter|target> get it.
  try {
    const realtime = globalThis._concordRealtimeEmit;
    if (typeof realtime === "function") {
      realtime("scheme:revealed", {
        schemeId,
        worldId,
        plotterKind, plotterId,
        targetKind, targetId,
        kind,
        phase,                  // 'complete' | 'exposed'
        accompliceCount: p.accompliceCount ?? 0,
        discoveryPct: p.discoveryPct ?? 0,
        revealedAt: Math.floor(Date.now() / 1000),
      });
    }
  } catch { /* realtime optional */ }

  // 2. Insert a synthetic secret so PIs / observers can stumble onto it.
  let secretInserted = false;
  try {
    const { insertSyntheticSecret } = await import("../secrets.js");
    if (insertSyntheticSecret) {
      insertSyntheticSecret(db, plotterId, targetKind, targetId,
        `${plotterId} schemed (${kind}) against ${targetId}; phase=${phase}`,
        // Difficulty: harder when fewer accomplices (less to overhear)
        Math.max(3, 10 - (p.accompliceCount ?? 0)));
      secretInserted = true;
    }
  } catch { /* secrets optional */ }

  // 3. Opinion delta on plotter. Both success and exposure carry
  // narrative weight — success means people fear them, exposure means
  // people distrust them.
  let opinionDelta = 0;
  try {
    if (plotterKind === "npc") {
      const delta = phase === "exposed" ? -25 : -10; // exposure is worse
      const { recordOpinionEvent } = await import("../npc-opinions.js");
      if (recordOpinionEvent) {
        recordOpinionEvent(db, { npcId: plotterId, targetKind, targetId },
          delta, `scheme_${phase}_${kind}`);
        opinionDelta = delta;
      }
    }
  } catch { /* npc-relations optional */ }

  return {
    ok: true,
    schemeId,
    revealEmitted: true,
    secretInserted,
    opinionDelta,
  };
}
