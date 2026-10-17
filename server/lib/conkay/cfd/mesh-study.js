// server/lib/conkay/cfd/mesh-study.js
//
// Grid-convergence study of the total drag coefficient over three recorded OpenFOAM runs of the
// same body: coarse / medium / fine (openfoam_case.py `refinement`, r = sqrt 2 per step), reduced
// with the same tail statistics and settled check as a single run, then Celik et al. (2008)
// GCI (cfd/gci.js).
//
// Representative cell size, Celik Eq. 1 with the domain volume as the sum of cell volumes:
//   h = (V_domain / N_cells)^(1/3)
// V_domain is the blockMesh box (the case kernel reports it as domainVolumeM3; the body's own
// volume, < 0.1 % of it, is not subtracted) and N_cells is snappyHexMesh's final cell count
// (snappy-summary.txt, "Layer mesh : cells:"). Only ratios of h enter the GCI, so the shared
// V_domain cancels; the realised cell counts, not the nominal sqrt 2, set r.
//
// Everything unknown stays unknown: a missing level, a level that did not settle, runs that differ
// in anything but `refinement`, or a series GCI cannot honestly use -> status NOT_COMPUTED with
// the reason. The study never changes a run's own PASS/FAIL.
//
// Limits stated plainly: GCI estimates discretization error of Cd on these three meshes of a
// steady RANS case. The meshes come from snappyHexMesh (octree + snapping + layers), so they are
// not geometrically similar to the degree Celik prefers, and a bluff-body wake does not settle to
// a single value (the settled check allows 2 % sd / 1 % drift), so the iterative error can be of
// the same size as the difference between levels. Not a validation against experiment.

import { readRun } from "./run-store.js";
import { tailStatistics, convergenceVerdict, CONVERGENCE_LIMITS } from "./force-coeffs.js";
import { gci, representativeH, GCI_VERSION } from "./gci.js";

export const MESH_STUDY_VERSION = "1.0.0";
export const LEVELS = Object.freeze(["fine", "medium", "coarse"]); // index 1,2,3 in the GCI
const SAME = ["preset", "aref", "lref", "kernelSha256", "solverSetupSha256", "domainVolumeM3"];

const nc = (reason, extra = {}) => ({ status: "NOT_COMPUTED", reason, ...extra });

/**
 * meshStudy({ fine, medium, coarse }, { key = "Cd" }) where each is a readRun() result
 * ({ record, forces, snappy }). Returns { status, reason?, levels, gci?, basis }.
 */
export function meshStudy(runs, { key = "Cd" } = {}) {
  const basis = {
    h: "(domain volume / snappyHexMesh final cell count)^(1/3), Celik et al. 2008 Eq. 1",
    quantity: `total ${key}: mean of the last ${CONVERGENCE_LIMITS.window} iterations of fc_total`,
    refinement: "blockMesh axis counts scaled by sqrt(2)^(-1,0,+1) with snappy levels unchanged (openfoam_case.py)",
    gciVersion: GCI_VERSION, meshStudyVersion: MESH_STUDY_VERSION,
  };
  const levels = {};
  for (const lv of LEVELS) {
    const run = runs?.[lv];
    if (!run) return nc(`no recorded run for the ${lv} level`, { levels, basis });
    if (run.error) return nc(`the ${lv} run is unusable: ${run.error}`, { levels, basis });
    const { record, forces, snappy } = run;
    const refinement = record.case?.refinement ?? "medium"; // runs recorded before the flag are the medium mesh
    if (refinement !== lv) return nc(`the run supplied as ${lv} was made with refinement ${JSON.stringify(refinement)}`, { levels, basis });
    if (!(snappy?.cells > 0)) return nc(`the ${lv} run has no snappyHexMesh cell count`, { levels, basis });
    let stats;
    try { stats = tailStatistics(forces.fc_total.rows, key, CONVERGENCE_LIMITS.window); } catch (e) { return nc(`the ${lv} run cannot be reduced (${e.message})`, { levels, basis }); }
    const verdict = convergenceVerdict(stats);
    levels[lv] = { cells: snappy.cells, mean: stats.mean, sd: stats.sd, relSd: stats.relSd, relDrift: stats.relDrift, window: [stats.fromTime, stats.toTime], settled: verdict.settled };
    if (!verdict.settled) {
      return nc(`the ${lv} run did not settle (${verdict.reasons.join("; ")}): a drag from an unsettled level is not a grid-convergence input`, { levels, basis });
    }
  }
  // only `refinement` may differ between the levels
  const ref = runs.medium.record;
  for (const lv of ["fine", "coarse"]) {
    const rec = runs[lv].record;
    if (rec.cadRequestHash !== ref.cadRequestHash) return nc(`the ${lv} and medium runs are for different bodies`, { levels, basis });
    if (rec.stepSha256 !== ref.stepSha256) return nc(`the ${lv} and medium runs used different STEP files`, { levels, basis });
    if ((rec.surface?.stlSha256 ?? null) !== (ref.surface?.stlSha256 ?? null) || !ref.surface?.stlSha256) return nc(`the ${lv} and medium runs do not share a recorded tessellation (surface.stlSha256)`, { levels, basis });
    for (const f of SAME) {
      const a = rec.case?.[f], b = ref.case?.[f];
      if (a === undefined || a === null || b === undefined || b === null) return nc(`case.${f} is not recorded for the ${lv} or medium run (re-record with the current conkay-cfd.mjs): cannot show only refinement differs`, { levels, basis });
      if (a !== b) return nc(`the ${lv} and medium cases differ in ${f} (${a} vs ${b}), not only in refinement`, { levels, basis });
    }
  }
  const V = ref.case.domainVolumeM3;
  for (const lv of LEVELS) levels[lv].h = representativeH(levels[lv].cells, V, 3);
  let g;
  try {
    g = gci({ phi: LEVELS.map((lv) => levels[lv].mean), h: LEVELS.map((lv) => levels[lv].h) });
  } catch (e) {
    return nc(`GCI inputs invalid: ${e.message} (cell counts must increase from coarse to fine)`, { levels, basis });
  }
  const out = { status: g.status, levels, gci: g, basis };
  if (g.status === "COMPUTED") {
    out.dragCoefficientFine = levels.fine.mean;
    out.discretizationUncertainty = { gciFine21: g.gciFine21, absolute: g.gciFine21 * Math.abs(levels.fine.mean), unit: "1", extrapolated: g.phiExt21, p: g.p };
  } else out.reason = g.reason;
  return out;
}

/** Load the three levels for a cad.body key from the run store and run the study. null when no non-medium run is recorded. */
export function meshStudyFromStore(cadRequestHash, { dir } = {}) {
  const opt = dir ? { dir } : {};
  const runs = {};
  let any = false;
  for (const lv of LEVELS) {
    runs[lv] = readRun(cadRequestHash, { ...opt, refinement: lv });
    if (lv !== "medium" && runs[lv]) any = true;
  }
  return any ? meshStudy(runs) : null;
}
