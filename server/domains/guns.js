// server/domains/guns.js
//
// Universal Move System Phase 3 — gun macros. Read-only ballistics surface over
// server/lib/firearms.js + ammunition.js so a lens/UI can preview a gun's
// profile, falloff curve, and reload plan. Pure compute (no DB writes), safe for
// publicReadDomains. The combat-route damage application is wired separately.

import {
  GUN_ARCHETYPES, RANGED_PARRY_WINDOW_MS, getGunProfile, damageAtRange, spreadAt,
} from "../lib/firearms.js";
import { ammoItemFor, planReload } from "../lib/ammunition.js";

export default function registerGunMacros(register) {
  register("guns", "list", async () => {
    return { ok: true, archetypes: Object.keys(GUN_ARCHETYPES), rangedParryWindowMs: RANGED_PARRY_WINDOW_MS };
  }, { note: "list firearm archetypes + the ranged parry-window invariant (0)" });

  register("guns", "profile", async (_ctx, input = {}) => {
    const archetype = input.archetype || "pistol";
    return { ok: true, archetype, profile: getGunProfile(archetype), ammoItem: ammoItemFor(archetype) };
  }, { note: "ballistic profile for a gun archetype" });

  register("guns", "damage_at_range", async (_ctx, input = {}) => {
    const archetype = input.archetype || "pistol";
    const distanceM = Number(input.distanceM ?? 0);
    return { ok: true, archetype, distanceM, damage: damageAtRange(archetype, distanceM, { tierMultiplier: input.tierMultiplier }) };
  }, { note: "two-point-linear falloff damage at a distance (UI preview)" });

  register("guns", "spread_at", async (_ctx, input = {}) => {
    return { ok: true, spread: spreadAt(input.archetype || "pistol", Number(input.consecutiveShots ?? 0)) };
  }, { note: "recoil-bloom spread after N consecutive shots" });

  register("guns", "plan_reload", async (_ctx, input = {}) => {
    return { ok: true, ...planReload(input.archetype || "pistol", Number(input.ownedRounds ?? 0)) };
  }, { note: "how many rounds a reload loads given owned ammo (scarcity)" });
}
