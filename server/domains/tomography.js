// server/domains/tomography.js
//
// Signal Tomography (#23) — macros over lib/signal-tomography.js. Reconstructs
// the sensed spatial field from REAL embodied_signal_log cell readings into a
// voxel grid (occupied cells measured, interior gaps inverse-distance
// interpolated and flagged). Read-only.
//
// Registered from server.js: registerTomographyMacros(register).

import { reconstructChannel, reconstructVoxels } from "../lib/signal-tomography.js";

export default function registerTomographyMacros(register) {
  register("tomography", "reconstruct", async (ctx, input = {}) => {
    const db = ctx?.db; if (!db) return { ok: false, reason: "no_db" };
    if (!input.worldId) return { ok: false, reason: "no_world" };
    if (input.channel) return reconstructChannel(db, input.worldId, input.channel, { nowTs: input.nowTs });
    return reconstructVoxels(db, input.worldId, { channels: input.channels, nowTs: input.nowTs });
  }, { note: "reconstruct the sensed field into a voxel grid from real cell readings (#23)" });

  register("tomography", "channels", async (ctx, input = {}) => {
    const db = ctx?.db; if (!db) return { ok: false, reason: "no_db" };
    if (!input.worldId) return { ok: false, reason: "no_world" };
    try {
      const chans = db.prepare(`SELECT DISTINCT channel FROM embodied_signal_log WHERE world_id = ? LIMIT 64`).all(input.worldId).map((r) => r.channel);
      return { ok: true, channels: chans };
    } catch { return { ok: true, channels: [] }; }
  }, { note: "list the sensed channels available to reconstruct for a world (#23)" });
}
