// server/lib/conkay/physics/solvers/aero-cfd.js
//
// aero.cfd: the drag of the CAD body (cad.body) from a recorded OpenFOAM run.
//
// OpenFOAM runs on a separate machine for hours, so this solver never starts it. It looks up
// the run recorded for this exact body (cfd/run-store.js: keyed by the cad.body kernel request
// hash, checked against the STEP file's sha256) and re-derives the drag from the copied
// forceCoeffs files: the mean over the last 500 iterations, with a settled check
// (cfd/force-coeffs.js CONVERGENCE_LIMITS).
//
// It reports NOT_COMPUTED when: no run is recorded; the record does not match the body or its
// files; the run did not settle; the run was made from a case other than the validated
// template; or the template's own Ahmed 25 deg validation is not accepted (cfd/validation.js).
//
// The case: OpenFOAM 12 foamRun incompressibleFluid, steady SIMPLE, k-omega SST with wall
// functions, snappyHexMesh with 3 layers, 40 m/s, moving ground (cfd/openfoam_case.py).
// The body is the outer skin only: no wheels, mirrors, underbody detail or cooling flow.
//
// Targets: vehicles with props.vehicle.cfd = "aero.cfd" and props.vehicle.frontalAreaFrom
// naming a cad-body node.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { registerSolver } from "../registry.js";
import { readRun, sha256File } from "../../cfd/run-store.js";
import { tailStatistics, convergenceVerdict, CONVERGENCE_LIMITS, FORCE_COEFFS_VERSION } from "../../cfd/force-coeffs.js";
import { AHMED_CFD_VALIDATION, AHMED_TOLERANCE, validationAccepted } from "../../cfd/validation.js";

export const AERO_CFD = "aero.cfd";
export const AERO_CFD_VERSION = "1.0.0";
const CASE_KERNEL = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../cfd/openfoam_case.py");
export const CASE_KERNEL_SHA256 = sha256File(CASE_KERNEL);

const NOT_MODELLED = [
  "wheels and tyres (open wheel wells in the body are meshed; the wheels are not)",
  "mirrors, wipers, antennas, panel gaps, underbody components, exhaust",
  "cooling airflow through radiators and ducts",
  "crosswind (zero yaw only)",
];

export const aeroCfd = registerSolver({
  id: AERO_CFD,
  version: AERO_CFD_VERSION,
  domain: "aero.drag",
  fidelity: 4,
  screening: false,
  regime: "incompressible (40 m/s), steady RANS, zero yaw, moving ground; body without wheels",
  method: "recorded OpenFOAM 12 run (foamRun incompressibleFluid, steady SIMPLE, k-omega SST, wall functions, snappyHexMesh with 3 prism layers) on the cad.body STEP surface; drag = mean of the last 500 iterations, accepted only when settled; the template is gated on its Ahmed 25 deg validation",
  reference: "Menter 1994 (k-omega SST); OpenFOAM 12 (openfoam.org); Ahmed, Ramm & Faltin SAE 840300 via Gant Tables 7.3-7.4 for the acceptance case",
  units: { outputs: { dragCoefficient: "1", dragArea: "m2", liftCoefficient: "1" } },
  tolerance: `template: Ahmed 25 deg total within ${AHMED_TOLERANCE.relError * 100} % (${AHMED_TOLERANCE.basis}); run: sd/mean <= ${CONVERGENCE_LIMITS.maxRelSd * 100} % and half-window drift <= ${CONVERGENCE_LIMITS.maxRelDrift * 100} % over ${CONVERGENCE_LIMITS.window} iterations`,
  targets: (g) => g.nodesOfKind("Assembly").filter((n) => n.props?.vehicle?.cfd === AERO_CFD).map((n) => n.id),
  run(ctx, id) {
    const from = ctx.get(id, "props.vehicle.frontalAreaFrom");
    if (!from || ctx.get(from, "geometry")?.shape !== "cad-body") return { notComputed: "aero.cfd needs props.vehicle.frontalAreaFrom naming a cad-body node" };
    const cad = ctx.result("cad.body", from);
    if (!cad || cad.status === "NOT_COMPUTED" || cad.status === "ERROR") return { notComputed: `the CAD body ${from} is not computed (${cad?.reason || cad?.error || "no run"})` };
    const key = cad.outputs.kernel?.value?.requestHash;
    if (!key) return { notComputed: `cad.body@${from} has no kernel request hash to look a CFD run up by` };
    const how = `write the case with \`node scripts/conkay-cfd.mjs case --body ${key}\`, run it on a CFD machine, then \`node scripts/conkay-cfd.mjs import --body ${key} --run <dir>\` (docs/CONKAY-AERO-CFD.md)`;

    let run;
    try { run = readRun(key); } catch (e) { return { notComputed: `cannot look up a CFD run (${e.message})` }; }
    if (!run) return { notComputed: `no OpenFOAM run is recorded for cad.body request ${key}: ${how}` };
    if (run.error) return { notComputed: `the recorded CFD run for ${key} is unusable: ${run.error}` };
    const { record, forces, snappy } = run;

    const step = cad.outputs.files?.value?.step;
    if (!step?.path || !fs.existsSync(step.path)) return { notComputed: `cad.body@${from} has no STEP file to check the recorded run against` };
    const stepSha = sha256File(step.path);
    if (record.stepSha256 !== stepSha) return { notComputed: `the recorded CFD run was made on STEP ${String(record.stepSha256).slice(0, 12)}…, the body's STEP is ${stepSha.slice(0, 12)}…` };
    if (record.case?.kernelSha256 !== CASE_KERNEL_SHA256) return { notComputed: `the recorded run's case kernel (${String(record.case?.kernelSha256).slice(0, 12)}…) is not the validated template (${CASE_KERNEL_SHA256.slice(0, 12)}…)` };

    const inputs = {
      cadBody: { value: cad.runId, source: cad.runId },
      run: { value: { cadRequestHash: key, stepSha256: stepSha, caseSha256: record.case.caseSha256, preset: record.case.preset, endTime: record.case.endTime, host: record.host, importedAt: record.importedAt }, source: `cfd run store ${key}` },
      surface: { value: record.surface, note: "the STEP re-tessellated for snappyHexMesh" },
      mesh: { value: snappy, note: "snappyHexMesh: cells and prism-layer coverage per patch" },
      referenceArea: { value: record.case.aref, unit: "m2", basis: record.frontalAreaBasis || "as recorded" },
      referenceLength: { value: record.case.lref, unit: "m" },
    };

    const fc = forces.fc_total;
    let stats;
    try { stats = tailStatistics(fc.rows, "Cd", CONVERGENCE_LIMITS.window); } catch (e) { return { notComputed: `the recorded run is too short: ${e.message}`, inputs }; }
    const lift = tailStatistics(fc.rows, "Cl", CONVERGENCE_LIMITS.window);
    const verdict = convergenceVerdict(stats);
    if (fc.header.Aref !== record.case.aref) return { notComputed: `forceCoeffs Aref ${fc.header.Aref} differs from the recorded case Aref ${record.case.aref}`, inputs };
    const history = blockMeans(fc.rows, 250);
    if (!verdict.settled) {
      return {
        notComputed: `the recorded run did not settle: ${verdict.reasons.join("; ")}`,
        inputs,
        outputs: { unsettled: { value: { meanCd: stats.mean, sd: stats.sd, relDrift: stats.relDrift, window: [stats.fromTime, stats.toTime] }, status: "not_a_result", note: "the last-window statistics of a run that is still changing; not a drag coefficient" }, history: { value: history } },
      };
    }
    const accepted = validationAccepted(AHMED_CFD_VALIDATION);
    if (!accepted.accepted) {
      return {
        notComputed: accepted.reason,
        inputs,
        outputs: { unvalidated: { value: { meanCd: stats.mean, dragArea: stats.mean * record.case.aref }, status: "not_a_result", note: "a settled run on a template that has not passed its Ahmed acceptance" } },
      };
    }
    return {
      inputs,
      outputs: {
        dragCoefficient: { value: stats.mean, sd: stats.sd, unit: "1", basis: `computed: mean Cd of iterations ${stats.fromTime}..${stats.toTime} (sd/mean ${(stats.relSd * 100).toFixed(2)} %, half-window drift ${(stats.relDrift * 100).toFixed(2)} %)`, note: "body without wheels: lower than the full car's" },
        dragArea: { value: stats.mean * record.case.aref, unit: "m2", basis: "computed: Cd x the recorded reference area" },
        liftCoefficient: { value: lift.mean, sd: lift.sd, unit: "1", note: "zero yaw, moving ground, no wheels" },
        history: { value: history, note: "250-iteration block means of Cd" },
        ahmedValidation: { value: { target: AHMED_CFD_VALIDATION.target, computed: AHMED_CFD_VALIDATION.total.mean, relError: accepted.relError, components: AHMED_CFD_VALIDATION.components }, note: "the same template on the Ahmed 25 deg body: the total is the acceptance; the component split is reported, not accepted" },
        notModelled: { value: NOT_MODELLED },
        parser: { value: FORCE_COEFFS_VERSION },
      },
      warnings: [
        "body without wheels, mirrors or cooling flow: compare designs by this drag area; it is not the car's drag coefficient",
        "steady RANS (k-omega SST) on a single mesh: no grid-convergence study",
      ],
      assumptions: [
        "Air at 40 m/s, kinematic viscosity 1.5e-5 m2/s (Re about 1.4e7 on a 5.2 m body); the road moves with the air.",
        "Inlet turbulence intensity 0.5 % with a 0.1 m length scale (a choice).",
      ],
    };
  },
});

/** Mean of `key` in consecutive blocks of `size` iterations, as [{ to, mean }]. */
export function blockMeans(rows, size, key = "Cd") {
  const out = [];
  for (let i = 0; i + size <= rows.length; i += size) {
    const blk = rows.slice(i, i + size);
    out.push({ to: blk.at(-1).Time, mean: blk.reduce((s, r) => s + r[key], 0) / size });
  }
  return out;
}
