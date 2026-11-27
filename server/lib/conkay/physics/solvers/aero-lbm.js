// server/lib/conkay/physics/solvers/aero-lbm.js
//
// aero.lbm: the drag of the CAD body (cad.body) from a recorded GPU lattice-Boltzmann run.
//
// The run (OpenLB on one CUDA GPU, tens of minutes) happens on a separate machine, so this solver
// never starts it. It looks up the run recorded for this exact body (cfd/lbm/run-store.js: keyed by
// the cad.body kernel request hash, checked against the STEP file's sha256) and re-derives the drag
// from the copied force series: the mean over the last 24 flow-throughs, with a settled check
// (cfd/lbm/force-series.js LBM_LIMITS).
//
// It reports NOT_COMPUTED when: no run is recorded; the record does not match the body or its files;
// the run did not settle; the run was made from a case other than the validated template; or the
// template's own Ahmed 25 deg validation is not accepted (cfd/lbm/validation.js).
//
// The case: OpenLB 1.9r0, D3Q19, float, Smagorinsky BGK LES, Bouzidi interpolated bounce-back walls
// (no wall model), 40 m/s, moving ground (cfd/lbm/aero_lbm.cpp). The body is the outer skin only:
// no wheels, mirrors, underbody detail or cooling flow.
//
// Targets: vehicles with props.vehicle.cfd = "aero.lbm" and props.vehicle.frontalAreaFrom naming a
// cad-body node.

import fs from "node:fs";
import { registerSolver } from "../registry.js";
import { sha256File } from "../../cfd/run-store.js";
import { readLbmRun } from "../../cfd/lbm/run-store.js";
import { windowStatistics, lbmVerdict, blockHistory, LBM_LIMITS, LBM_SERIES_VERSION } from "../../cfd/lbm/force-series.js";
import { LBM_AHMED_VALIDATION, AHMED_TOLERANCE, lbmValidationAccepted, currentTemplate } from "../../cfd/lbm/validation.js";

export const AERO_LBM = "aero.lbm";
export const AERO_LBM_VERSION = "1.0.0";

const NOT_MODELLED = [
  "wheels and tyres (open wheel wells in the body are voxelised; the wheels are not)",
  "mirrors, wipers, antennas, panel gaps, underbody components, exhaust",
  "cooling airflow through radiators and ducts",
  "crosswind (zero yaw only)",
  "a wall model: walls are interpolated bounce-back at the cell size, far from resolving the boundary layer at this Reynolds number",
];

export const aeroLbm = registerSolver({
  id: AERO_LBM,
  version: AERO_LBM_VERSION,
  domain: "aero.drag",
  fidelity: 4,
  screening: false,
  regime: "weakly compressible lattice Boltzmann (lattice Mach 0.087, 40 m/s), large-eddy simulation, zero yaw, moving ground; body without wheels",
  method: "recorded OpenLB 1.9r0 run (D3Q19, single precision, Smagorinsky-BGK collision with the library-default constant 0.15, Bouzidi interpolated bounce-back on the voxelised STL, momentum-exchange force) on one CUDA GPU; drag = mean of the last 24 flow-throughs, accepted only when settled; the template is gated on its Ahmed 25 deg validation",
  reference: "Krause et al. 2021 (OpenLB, Comput. Math. Appl. 81); Bouzidi, Firdaouss & Lallemand 2001 (Phys. Fluids 13); Smagorinsky 1963; Ahmed, Ramm & Faltin SAE 840300 via Gant Tables 7.3-7.4 for the acceptance case",
  units: { outputs: { dragCoefficient: "1", dragArea: "m2", liftCoefficient: "1" } },
  tolerance: `template: Ahmed 25 deg total within ${AHMED_TOLERANCE.relError * 100} % (${AHMED_TOLERANCE.basis}); run: first/second half of the ${LBM_LIMITS.windowFlowThroughs}-flow-through window within ${LBM_LIMITS.maxRelDrift * 100} %, standard error of the mean <= ${LBM_LIMITS.maxRelSem * 100} % from ${LBM_LIMITS.blockFlowThroughs}-flow-through blocks`,
  targets: (g) => g.nodesOfKind("Assembly").filter((n) => n.props?.vehicle?.cfd === AERO_LBM).map((n) => n.id),
  run(ctx, id) {
    const from = ctx.get(id, "props.vehicle.frontalAreaFrom");
    if (!from || ctx.get(from, "geometry")?.shape !== "cad-body") return { notComputed: "aero.lbm needs props.vehicle.frontalAreaFrom naming a cad-body node" };
    const cad = ctx.result("cad.body", from);
    if (!cad || cad.status === "NOT_COMPUTED" || cad.status === "ERROR") return { notComputed: `the CAD body ${from} is not computed (${cad?.reason || cad?.error || "no run"})` };
    const key = cad.outputs.kernel?.value?.requestHash;
    if (!key) return { notComputed: `cad.body@${from} has no kernel request hash to look an LBM run up by` };
    const how = `write the case with \`node scripts/conkay-lbm.mjs case --body ${key}\`, run it on the GPU machine, then \`node scripts/conkay-lbm.mjs import --body ${key} --run <dir>\` (docs/CONKAY-AERO-LBM.md)`;

    let run;
    try { run = readLbmRun(key); } catch (e) { return { notComputed: `cannot look an LBM run up (${e.message})` }; }
    if (!run) return { notComputed: `no LBM run is recorded for cad.body request ${key}: ${how}` };
    if (run.error) return { notComputed: `the recorded LBM run for ${key} is unusable: ${run.error}` };
    const { record, series } = run;

    const step = cad.outputs.files?.value?.step;
    if (!step?.path || !fs.existsSync(step.path)) return { notComputed: `cad.body@${from} has no STEP file to check the recorded run against` };
    const stepSha = sha256File(step.path);
    if (record.stepSha256 !== stepSha) return { notComputed: `the recorded LBM run was made on STEP ${String(record.stepSha256).slice(0, 12)}…, the body's STEP is ${stepSha.slice(0, 12)}…` };
    const cur = currentTemplate();
    if (record.case?.kernelSha256 !== cur.kernelSha256 || record.case?.sourceSha256 !== cur.sourceSha256) {
      return { notComputed: "the recorded run's case generator or program is not the validated template" };
    }

    const inputs = {
      cadBody: { value: cad.runId, source: cad.runId },
      run: { value: { cadRequestHash: key, stepSha256: stepSha, caseSha256: record.case.caseSha256, preset: record.case.preset, res: record.case.res, host: record.host, gpu: record.gpu, importedAt: record.importedAt }, source: `lbm run store ${key}` },
      surface: { value: record.surface, note: "the STEP re-tessellated for voxelisation" },
      lattice: { value: { openlb: record.openlb, nodes: series.header.nodes, dxM: series.header.dx, dtS: series.header.dt, omega: series.header.omega, ulat: series.header.ulat }, note: "from the run's own header" },
      referenceArea: { value: record.case.aref, unit: "m2", basis: record.frontalAreaBasis || "as recorded" },
      referenceLength: { value: record.case.lref, unit: "m" },
    };

    if (series.header.Aref !== record.case.aref) return { notComputed: `forces.dat Aref ${series.header.Aref} differs from the recorded case Aref ${record.case.aref}`, inputs };
    let stats;
    try { stats = windowStatistics(series, "Cd"); } catch (e) { return { notComputed: `the recorded run is too short: ${e.message}`, inputs }; }
    const lift = windowStatistics(series, "Cl");
    const verdict = lbmVerdict(stats);
    const history = blockHistory(series, "Cd", 2);
    if (!verdict.settled) {
      return {
        notComputed: `the recorded run did not settle: ${verdict.reasons.join("; ")}`,
        inputs,
        outputs: { unsettled: { value: { meanCd: stats.mean, relDrift: stats.relDrift, relSem: stats.relSem, window: [stats.fromT, stats.toT] }, status: "not_a_result", note: "window statistics of a run whose mean is still moving or poorly sampled; not a drag coefficient" }, history: { value: history } },
      };
    }
    const accepted = lbmValidationAccepted(LBM_AHMED_VALIDATION);
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
        dragCoefficient: { value: stats.mean, sd: stats.sd, sem: stats.sem, unit: "1", basis: `computed: mean Cd over t = ${stats.fromT.toFixed(3)}..${stats.toT.toFixed(3)} s (${stats.flowThroughs.toFixed(1)} flow-throughs, ${stats.samples} samples; standard error ${(stats.relSem * 100).toFixed(2)} %, half-window drift ${(stats.relDrift * 100).toFixed(2)} %)`, note: "body without wheels: lower than the full car's" },
        dragArea: { value: stats.mean * record.case.aref, unit: "m2", basis: "computed: Cd x the recorded reference area" },
        liftCoefficient: { value: lift.mean, sd: lift.sd, unit: "1", note: "zero yaw, moving ground, no wheels" },
        history: { value: history, note: "2-flow-through block means of Cd over the whole run" },
        ahmedValidation: { value: { target: LBM_AHMED_VALIDATION.target, computed: LBM_AHMED_VALIDATION.total.mean, relError: accepted.relError, components: LBM_AHMED_VALIDATION.components }, note: "the same template on the Ahmed 25 deg body: the total is the acceptance; the component split is reported, not accepted" },
        notModelled: { value: NOT_MODELLED },
        parser: { value: LBM_SERIES_VERSION },
      },
      warnings: [
        "body without wheels, mirrors or cooling flow: compare designs by this drag area; it is not the car's drag coefficient",
        "wall-resolved boundary layers are not attempted (no wall model): the friction part of the drag is not computed to LES standards; compare variants, not absolute values",
        "single resolution: no grid-convergence study",
      ],
      assumptions: [
        "Air at 40 m/s, kinematic viscosity 1.5e-5 m2/s; the road moves with the air.",
        "Uniform inflow with no imposed turbulence (a choice).",
      ],
    };
  },
});
