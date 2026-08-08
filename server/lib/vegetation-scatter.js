// server/lib/vegetation-scatter.js
//
// Phase M2 (Godot vegetation instancing) — deterministic scatter of
// vegetation entries within a world's REAL authored district boundary
// polygons (server/lib/districts.js), seeded via world-terrain.js's
// hashSeed. No hand-authored vegetation placement data exists anywhere in
// this codebase — server/lib/scene-export.js had no such field before this
// unit, and content/world/*/city-layout.json carries none either — and the
// Three.js client's own vegetation renderer
// (concord-frontend/components/world-lens/TreeLayer.tsx) invents positions
// 100% client-side with zero server authority. This module is the honest
// middle path: real positions grounded in real per-district geometry, not
// fabricated from nothing, reusing the same deterministic-hash technique
// TreeLayer.tsx's own client-side hashU() already uses (server-side here,
// so it can be shared by any client, not re-derived per renderer).
//
// A world with no recorded districts (every world but concordia-hub today
// — see districts.js#seedDefaultDistricts's own
// "no_authored_layout_for_world" path) honestly returns [], never
// fabricated placements.

import { listDistricts, pointInPolygon } from "./districts.js";
import { hashSeed } from "./world-terrain.js";

// Real on-disk vegetation GLBs (concord-frontend/public/models/vegetation/).
// concordia-hub has no meta.json/biome data to weight species by, so this
// is deliberately a uniform mix — a documented simplification, not a
// silently-applied one. Revisit if per-district species variation is ever
// wanted for a world with real biome data.
export const VEGETATION_SPECIES = ["tree_01", "tree_02", "tree_03", "tree_04", "bush_01", "flower_01"];

// A concave/thin district could reject many rejection-sampled candidates in
// a row; capped so a pathological polygon can't spin forever. An exhausted
// budget is an honest skip for that slot, not a fallback guess.
const MAX_PLACEMENT_ATTEMPTS = 20;

function unitFloat(seed) {
  return hashSeed(seed) / 0xffffffff;
}

/**
 * Deterministically scatter vegetation entries inside each real district
 * boundary polygon for `worldId`. Pure with respect to `db` state (reads
 * only, no writes) — the same (db content, worldId, opts) always yields
 * byte-identical output, since every random draw comes from hashSeed over a
 * salted string, never a shared/mutable PRNG stream.
 *
 * @param {object} db
 * @param {string} worldId
 * @param {object} [opts]
 * @param {number} [opts.densityPerM2=0.00035] entries per m^2 of a
 *   district's AABB (used for sizing only — real containment is still
 *   enforced per-point via pointInPolygon, so density is an honest upper
 *   bound, never a claim every candidate lands).
 * @param {number} [opts.maxPerDistrict=40] hard cap per district, regardless
 *   of area, so an unusually large future district can't spawn hundreds of
 *   individual nodes.
 * @returns {Array<{id,species,x,y,z,rotationY,scale,districtId}>}
 */
export function scatterVegetationForWorld(db, worldId, { densityPerM2 = 0.00035, maxPerDistrict = 40 } = {}) {
  let districts = [];
  try {
    districts = listDistricts(db, worldId);
  } catch {
    return [];
  }
  if (!Array.isArray(districts) || districts.length === 0) return [];

  const out = [];
  for (const d of districts) {
    if (!Array.isArray(d.boundary) || d.boundary.length < 3) continue;

    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const v of d.boundary) {
      const x = Number(v.x) || 0, z = Number(v.z) || 0;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
    if (!Number.isFinite(minX) || !Number.isFinite(maxX) || !Number.isFinite(minZ) || !Number.isFinite(maxZ)) continue;
    const width = maxX - minX, depth = maxZ - minZ;
    if (width <= 0 || depth <= 0) continue;

    const aabbArea = width * depth;
    const count = Math.min(maxPerDistrict, Math.round(aabbArea * densityPerM2));

    for (let i = 0; i < count; i++) {
      for (let attempt = 0; attempt < MAX_PLACEMENT_ATTEMPTS; attempt++) {
        const ux = unitFloat(`${d.id}:${i}:${attempt}:x`);
        const uz = unitFloat(`${d.id}:${i}:${attempt}:z`);
        const x = minX + ux * width;
        const z = minZ + uz * depth;
        if (!pointInPolygon(x, z, d.boundary)) continue;

        const speciesIdx = Math.min(
          VEGETATION_SPECIES.length - 1,
          Math.floor(unitFloat(`${d.id}:${i}:species`) * VEGETATION_SPECIES.length)
        );
        const rotationY = unitFloat(`${d.id}:${i}:rot`) * Math.PI * 2;
        const scale = 0.8 + unitFloat(`${d.id}:${i}:scale`) * 0.5;

        out.push({
          id: `${d.id}:veg:${i}`,
          species: VEGETATION_SPECIES[speciesIdx],
          x: Math.round(x * 1000) / 1000,
          y: Number(d.elevationHint) || 0,
          z: Math.round(z * 1000) / 1000,
          rotationY: Math.round(rotationY * 1000) / 1000,
          scale: Math.round(scale * 1000) / 1000,
          districtId: d.id,
        });
        break;
      }
      // An exhausted retry budget for this slot (e.g. a thin/concave
      // polygon) is an honest skip — never a placement outside the real
      // boundary — the loop simply moves on to the next slot.
    }
  }
  return out;
}

export default { scatterVegetationForWorld, VEGETATION_SPECIES };
