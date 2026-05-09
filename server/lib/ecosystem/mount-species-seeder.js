// server/lib/ecosystem/mount-species-seeder.js
//
// Seeds `mount_species` + `mount_gait_profiles` from the static JSON
// at `server/seeds/mount_species.json`. Idempotent — INSERT OR IGNORE
// keyed by `species_id` + `gait_profile_id`. Re-running is a no-op.
//
// Called once at server boot from server.js, immediately after the
// migration sweep. Failure here MUST NOT crash the server (CLAUDE.md
// invariant — server boot stays robust).

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SEED_PATH = join(__dirname, "../../seeds/mount_species.json");

let _cachedSeed = null;
function loadSeed() {
  if (_cachedSeed) return _cachedSeed;
  try {
    const raw = readFileSync(SEED_PATH, "utf-8");
    _cachedSeed = JSON.parse(raw);
  } catch (err) {
    console.warn("[mount-species-seeder] load failed:", err.message);
    _cachedSeed = { species: [] };
  }
  return _cachedSeed;
}

/**
 * Insert (or ignore) one mount_species + one mount_gait_profile row per
 * authored species. Returns counts so the boot log can confirm seeding.
 *
 * @param {object} db — better-sqlite3
 * @returns {{ok: boolean, inserted: {species: number, gaits: number}, total: number, reason?: string}}
 */
export function seedMountSpecies(db) {
  if (!db) return { ok: false, reason: "no_db" };
  const seed = loadSeed();
  const species = Array.isArray(seed.species) ? seed.species : [];
  if (species.length === 0) return { ok: true, inserted: { species: 0, gaits: 0 }, total: 0 };

  let speciesInserted = 0;
  let gaitsInserted = 0;

  try {
    const insertSpecies = db.prepare(`
      INSERT OR IGNORE INTO mount_species
        (species_id, display_name, size_class, base_speed_mps, base_stamina, carry_capacity_kg,
         gait_profile_id, rider_seat_offset_json, saddle_anchor_bone, reins_anchor_bone,
         flight_capable, aesthetic_tags_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertGait = db.prepare(`
      INSERT OR IGNORE INTO mount_gait_profiles
        (id, species_id, walk_cycle_json, trot_cycle_json, gallop_cycle_json, turn_radius_m)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const tx = db.transaction((items) => {
      for (const sp of items) {
        if (!sp.species_id) continue;
        const gaitId = `gait_${sp.species_id}`;
        const r1 = insertSpecies.run(
          sp.species_id,
          sp.display_name || sp.species_id,
          sp.size_class || "medium",
          Number(sp.base_speed_mps) || 6.0,
          Number(sp.base_stamina) || 100,
          Number(sp.carry_capacity_kg) || 80,
          gaitId,
          JSON.stringify(sp.rider_seat_offset || { x: 0, y: 1.4, z: 0, yaw: 0 }),
          sp.saddle_anchor_bone || "spine_03",
          sp.reins_anchor_bone || "head",
          sp.flight_capable ? 1 : 0,
          JSON.stringify(sp.aesthetic_tags || []),
        );
        if (r1.changes > 0) speciesInserted++;

        const gait = sp.gait || {};
        const r2 = insertGait.run(
          gaitId,
          sp.species_id,
          JSON.stringify(gait.walk || {}),
          JSON.stringify(gait.trot || {}),
          JSON.stringify(gait.gallop || {}),
          Number(sp.turn_radius_m) || 4.0,
        );
        if (r2.changes > 0) gaitsInserted++;
      }
    });
    tx(species);

    return {
      ok: true,
      inserted: { species: speciesInserted, gaits: gaitsInserted },
      total: species.length,
    };
  } catch (err) {
    console.warn("[mount-species-seeder] seed failed:", err.message);
    return { ok: false, reason: err.message };
  }
}
