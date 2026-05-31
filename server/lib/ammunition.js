// server/lib/ammunition.js
//
// Universal Move System — Phase 3 ammo economy. Pure helpers; the route layer
// reads/writes player_inventory. Ammo scarcity + reload recovery are the gun
// balance levers (range-vs-power being the other), so a gun is strong but
// finite, never a free infinite-DPS weapon.

import { GUN_ARCHETYPES } from "./firearms.js";

// archetype → the inventory item_id its magazine consumes.
export const AMMO_ITEM = {
  pistol: "ammo_pistol",
  smg: "ammo_pistol",       // pistol-calibre
  rifle: "ammo_rifle",
  shotgun: "ammo_shell",
  sniper: "ammo_rifle",
  energy: "cell_energy",
};

export function ammoItemFor(archetype) {
  return AMMO_ITEM[archetype] || "ammo_pistol";
}

/**
 * How many rounds a reload can actually load, given how many the player owns.
 * @returns {{ loaded:number, consumed:number, shortfall:number }}
 */
export function planReload(archetype, ownedRounds) {
  const cap = (GUN_ARCHETYPES[archetype] || GUN_ARCHETYPES.pistol).magazine;
  const owned = Math.max(0, Math.floor(Number(ownedRounds) || 0));
  const loaded = Math.min(cap, owned);
  return { loaded, consumed: loaded, shortfall: Math.max(0, cap - owned) };
}

/** True when the player can fire at all (has a loaded round or reserve ammo). */
export function canFire({ magazineRounds = 0, reserveRounds = 0 } = {}) {
  return magazineRounds > 0 || reserveRounds > 0;
}
