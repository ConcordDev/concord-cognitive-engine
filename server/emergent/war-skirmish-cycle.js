// server/emergent/war-skirmish-cycle.js
//
// Heartbeat-driven skirmish advance. Every pass, iterate every
// non-resolved war_campaign whose next_skirmish_at <= now and call
// advanceCampaign(). The lib handles state transitions + skirmish
// resolution + town capture + auto-kidnaps.
//
// Frequency: 2 ticks (~30s) — fast enough that a player declaring war
// sees a skirmish play out within seconds. Bounded by MAX_PER_PASS.
//
// Kill-switch: CONCORD_WAR_SKIRMISH=0.
// Heartbeat invariant: never throws.

import logger from "../logger.js";

const MAX_PER_PASS = 12;

export async function runWarSkirmishCycle({ db, state: _s, tickCount: _t } = {}) {
  if (process.env.CONCORD_WAR_SKIRMISH === "0") return { ok: false, reason: "disabled" };
  if (!db) return { ok: false, reason: "no_db" };

  let rows = [];
  try {
    rows = db.prepare(`
      SELECT * FROM war_campaigns
      WHERE resolved_at IS NULL
        AND (next_skirmish_at IS NULL OR next_skirmish_at <= unixepoch())
      ORDER BY next_skirmish_at ASC
      LIMIT ?
    `).all(MAX_PER_PASS);
  } catch {
    return { ok: true, scanned: 0, advanced: 0, reason: "no_war_table" };
  }

  if (rows.length === 0) return { ok: true, scanned: 0, advanced: 0 };

  const { advanceCampaign } = await import("../lib/war-campaign.js");

  let advanced = 0, errored = 0;
  for (const c of rows) {
    try {
      const r = advanceCampaign(db, c);
      if (r?.transitioned) advanced++;
    } catch (err) {
      errored++;
      logger?.warn?.("war-skirmish-cycle: campaign failed", { id: c.id, err: err?.message });
    }
  }

  return { ok: true, scanned: rows.length, advanced, errored };
}
