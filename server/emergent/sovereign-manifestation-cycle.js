// server/emergent/sovereign-manifestation-cycle.js
//
// DET-C batch 7 — wire-the-unwired (Layer-12 pattern: lazy-import target +
// try/catch + always-return-{ok,...}, never edit the engine itself).
//
// draftSovereignManifestation() (lib/sovereign/refusal-archive.js) is a
// real, tested engine — it fuses N recorded player powers (via
// recordPlayerPowerForArchive, called from the skill:use socket handler
// in server.js) into a single limit-refused combat blueprint. It has
// existed since the Sovereign Refusal Archive shipped, with a real
// contract test (tests/sovereign-raid-archive.test.js) and a manual
// GET /api/world/sovereign/manifestation/preview route for on-demand
// inspection. But nothing ever CALLED it on a schedule, and nothing ever
// broadcast the result — concord-frontend/components/concordia/HUD/
// SovereignManifestationToast.tsx has listened for the realtime
// 'world:sovereign-manifest' event since it was written ("fired by raid
// combat when the Sovereign draws a fused power"), and no server code
// path ever emitted it.
//
// This module does NOT invent raid combat/damage logic — raid-event.js's
// own header explicitly scopes that out ("Phase progression and damage
// logic are out of scope for this drop — they slot in when raid combat
// is wired"), and inventing that mechanic here would repeat the mistake
// CLAUDE.md warns against (batch 3's 'concordia:stealth'/'concordia:
// discovery' were correctly left dead rather than have a wire-fix invent
// a mechanic). What this DOES do is give the raid's already-real, already-
// tested "the Sovereign shows a fused power" beat an actual scheduled
// trigger instead of leaving it reachable only via a manual admin/preview
// fetch: while a Sovereign Mass Raid is open, periodically draft one real
// manifestation from the same archive the preview endpoint reads, and
// broadcast it to the raid's world room.

import { draftSovereignManifestation } from "../lib/sovereign/refusal-archive.js";

// One manifestation per ~5 real minutes per open raid — frequent enough to
// feel alive during a raid that stays open for up to 48 hours, infrequent
// enough that it reads as an event, not a firehose.
const MIN_INTERVAL_MS = 5 * 60 * 1000;

export async function runSovereignManifestationCycle({ state, io } = {}) {
  try {
    const raid = state?.activeSovereignRaid;
    if (!raid || !raid.worldId) return { ok: true, reason: "no_active_raid" };
    if (raid.closesAt && raid.closesAt < Date.now()) return { ok: true, reason: "raid_closed" };

    const now = Date.now();
    if (raid._lastManifestAt && now - raid._lastManifestAt < MIN_INTERVAL_MS) {
      return { ok: true, reason: "cooldown" };
    }

    const manifest = draftSovereignManifestation(state, { draws: 3 });
    // Honest-empty: no archived shadows yet (fresh raid, nobody has used a
    // recorded power) means nothing to manifest — never fabricate one.
    if (!manifest?.name) return { ok: true, reason: "no_shadows_to_draw" };

    raid._lastManifestAt = now;

    try {
      io?.to?.(`world:${raid.worldId}`)?.emit?.("world:sovereign-manifest", manifest);
    } catch { /* realtime emit is best-effort — never blocks the tick */ }

    return { ok: true, manifest };
  } catch (e) {
    return { ok: false, reason: "exception", error: String(e?.message || e) };
  }
}
