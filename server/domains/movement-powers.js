// server/domains/movement-powers.js
//
// Universal Move System Phase 4 — movement-power macros. Read-only surface over
// server/lib/movement-powers.js so a lens/UI can list powers, preview tier-scaled
// speed/drain, and check whether the player can activate one (level + gauge +
// Pillar-2 world availability + flight⊥speed non-stack). Pure compute.

import {
  MOVEMENT_POWERS, getMovementPower, conflicts, speedFor, drainPerSecFor, tierForLevel, canActivate,
} from "../lib/movement-powers.js";

export default function registerMovementPowerMacros(register) {
  register("movement", "list", async () => {
    return { ok: true, powers: Object.keys(MOVEMENT_POWERS) };
  }, { note: "list movement powers" });

  register("movement", "profile", async (_ctx, input = {}) => {
    const power = input.power || "flight";
    const p = getMovementPower(power);
    if (!p) return { ok: false, reason: "unknown_power" };
    const level = Number(input.skillLevel ?? 1);
    return { ok: true, power, profile: p, tier: tierForLevel(level), speedMs: speedFor(power, level), drainPerSec: drainPerSecFor(power, level) };
  }, { note: "tier-scaled speed/drain for a power at a skill level" });

  register("movement", "can_activate", async (_ctx, input = {}) => {
    return { ok: true, ...canActivate({
      power: input.power, skillLevel: Number(input.skillLevel ?? 0),
      gauge: Number(input.gauge ?? 0), activeNow: input.activeNow ?? null,
      worldAvailable: input.worldAvailable !== false,
    }) };
  }, { note: "level + gauge + world + non-stack activation check" });

  register("movement", "conflicts", async (_ctx, input = {}) => {
    return { ok: true, conflicts: conflicts(input.a, input.b) };
  }, { note: "do two powers conflict (flight ⊥ super-speed)" });
}
