// server/lib/conkay/structural/hardpoints.js
//
// The suspension hardpoints that exist in the tub, and the members that
// leave them. The S550 arms, strut towers and subframe mounts are not
// given coordinates: the library record has no published dimensions.

export const HARDPOINTS_VERSION = "1.0.0";

const PICKUPS = [
  { id: "FA.L", axle: "front", side: "L" },
  { id: "FA.R", axle: "front", side: "R" },
  { id: "QA.L", axle: "rear", side: "L" },
  { id: "QA.R", axle: "rear", side: "R" },
];

/**
 * @param {object} spec
 * @param {Array<{id,x,y,z}>} spec.nodes
 * @param {Array<{id,i,j,part}>} spec.members
 * @param {number|null} spec.frontAxleLoadN
 * @param {number|null} spec.rearAxleLoadN
 * @param {string} spec.loadSource
 * @param {Array<{axle, dimensions, springNote, requires}>} spec.suspension
 */
export function hardpoints(spec) {
  const nodes = new Map((spec.nodes || []).map((n) => [n.id, n]));
  const warnings = [];
  const rows = [];
  for (const p of PICKUPS) {
    const node = nodes.get(p.id);
    if (!node) {
      rows.push({ id: p.id, axle: p.axle, side: p.side, located: false });
      continue;
    }
    const path = [];
    for (const m of spec.members || []) {
      if (m.i !== p.id && m.j !== p.id) continue;
      const other = m.i === p.id ? m.j : m.i;
      path.push({ member: m.id, part: m.part, other });
    }
    const axleLoad = p.axle === "front" ? spec.frontAxleLoadN : spec.rearAxleLoadN;
    rows.push({
      id: p.id,
      axle: p.axle,
      side: p.side,
      located: true,
      x: node.x,
      y: node.y,
      z: node.z,
      staticLoadN: Number.isFinite(axleLoad) ? axleLoad / 2 : null,
      loadBasis: "even left-right split of the static axle load. No lateral transfer, no aero, no bump.",
      path,
    });
  }
  const missing = (spec.suspension || []).filter((s) => s.dimensions !== "sourced");
  if (missing.length) {
    warnings.push("The S550 suspension records publish no hardpoint dimensions. Control arms, radius arms, strut towers and subframe mounts are not given coordinates.");
  }
  warnings.push("The tub holds these four axle-line nodes as rigid supports. Springs are not in the frame: the library spring rate is not published.");
  warnings.push("The static load is the support reaction in a level, no-aero balance. It is not a measured link load.");
  return {
    version: HARDPOINTS_VERSION,
    loadSource: spec.loadSource || null,
    hardpoints: rows,
    suspension: spec.suspension || [],
    armsLocated: false,
    warnings,
    assumptions: [
      "Hardpoints are the tub nodes FA.L, FA.R, QA.L and QA.R. No other pickup was added.",
      "Load path is the frame members that meet that node.",
      "Static axle load from vehicle.axle-loads, split evenly left and right.",
      "S550 arm and tower coordinates are not published, so they are not invented.",
    ],
  };
}
