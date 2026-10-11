// server/lib/conkay/physics/solvers/aero-shape.js
//
// aero.shape: whether the smaller Kamm face lowered the v1 drag range
// without entering Ahmed's slant band. It reads aero.drag-buildup's
// geometry and re-evaluates the v1 build-up on it, so the comparison with the
// kamm-ratio 0.5 baseline (also v1) stays like for like now that the reported
// Cd is the calibrated build-up 1.1 (PR 1067). It does not run CFD.

import { registerSolver } from "../registry.js";
import { AERO_FROM } from "./aero-drag.js";
import { dragBuildup } from "../../aero/drag-buildup.js";
import { shapeVerdict, KAMM50_BASELINE, NOT_COPIED, AERO_SHAPE_VERSION } from "../../aero/shape.js";

const vehicles = (g) => g.nodesOfKind("Assembly").filter((n) => n.props?.vehicle?.dragCoefficientFrom === AERO_FROM).map((n) => n.id);

export const aeroShape = registerSolver({
  id: "aero.shape",
  version: AERO_SHAPE_VERSION,
  domain: "aero.drag",
  fidelity: 1,
  screening: true,
  method: "Compare the v1 drag build-up of this solid with the kamm-ratio 0.5 solid: base area, base term, and the low, centre and high Cd. A reduction counts only while the rear slant stays at or below Ahmed's 12.5 deg onset, so the slant term stays 0. Section lift is the existing 2D panel sign. Not CFD. The reported Cd is the calibrated build-up (1.1); this check re-evaluates v1 on the same areas and slant, because the baseline is a v1 figure.",
  reference: "Saltzman, Wang and Iliff, AIAA 99-0383 eq. 14; Ahmed, Ramm and Faltin, SAE 840300; drag-buildup.js",
  targets: vehicles,
  run(ctx, id) {
    const aero = ctx.result(AERO_FROM, id);
    if (!aero || aero.status === "NOT_COMPUTED" || aero.status === "ERROR" || !aero.outputs?.dragCoefficient) {
      return { notComputed: `aero.drag-buildup did not return a coefficient (${aero?.reason || aero?.error || "no run"})` };
    }
    const gin = (k) => aero.inputs?.[k]?.value;
    const geom = { lengthM: gin("lengthM"), wettedAreaM2: gin("wettedAreaM2"), frontalAreaM2: gin("frontalAreaM2"), baseAreaM2: gin("baseAreaM2"), rearSlantDeg: gin("rearSlantDeg") };
    const air = gin("air");
    if (![geom.lengthM, geom.wettedAreaM2, geom.frontalAreaM2, geom.baseAreaM2, geom.rearSlantDeg, gin("referenceSpeed"), air?.rho, air?.mu].every(Number.isFinite)) {
      return { notComputed: "aero.drag-buildup did not report the geometry and air needed to re-evaluate the v1 build-up" };
    }
    const v1 = dragBuildup(geom, { speedMs: gin("referenceSpeed"), rho: air.rho, mu: air.mu });
    const cd = { low: v1.low.cd, high: v1.high.cd, centre: v1.centre };
    const t = (side) => ({ friction: side.friction, nose: side.nose, base: side.base, slant: side.slant, cooling: side.cooling, wheelsShare: side.wheelsShare, cd: side.cd });
    const terms = { low: t(v1.low), high: t(v1.high) };
    const reported = aero.outputs.dragCoefficient.value;
    const lift = aero.outputs.sectionLift.value;
    const measured = {
      rearSlantDeg: aero.inputs.rearSlantDeg.value,
      baseAreaM2: aero.inputs.baseAreaM2.value,
      cd,
      terms,
      sectionLiftSign: lift.sign,
    };
    const verdict = shapeVerdict(measured);
    const warnings = [
      "screening comparison of two v1 build-ups, not CFD and not a wind-tunnel value",
      `Kamm's cited truncation is 50 percent. This face ratio is ${verdict.kammAreaRatio}.`,
    ];
    if (!verdict.slantOk || !verdict.slantTermClear) warnings.push(`rear slant ${measured.rearSlantDeg} deg is past ${verdict.ahmedOnsetDeg} deg, so the slant term is not zero and this cut is not counted as a reduction`);
    if (!verdict.centreLower) warnings.push("the centre Cd is not below the kamm-ratio 0.5 solid");
    if (!verdict.liftDetermined) warnings.push("the 2D section-lift sign is indeterminate (the two Kutta corners disagree). No 3D lift coefficient is computed.");
    return {
      inputs: {
        dragRun: { value: aero.runId },
        baseline: { value: KAMM50_BASELINE.cacheHash, note: "kamm area ratio 0.5 solid" },
        dragModel: { value: v1.version, note: `v1 drag build-up re-evaluated on aero.drag-buildup's areas and slant. The reported Cd is ${aero.solver?.version || "the solver's"} (calibrated build-up); the kamm-ratio 0.5 baseline is a v1 figure, so v1 is compared with v1.` },
      },
      outputs: {
        verdict: { value: verdict },
        measured: { value: measured },
        baselineCd: { value: KAMM50_BASELINE.cd },
        reportedCd: { value: reported, note: "the calibrated build-up aero.drag-buildup reports for this solid. Not compared with the v1 baseline." },
        sectionLift: { value: lift, note: "copied from aero.drag-buildup. A sign only when both Kutta corners agree. Not a 3D coefficient." },
        notCopied: { value: NOT_COPIED },
        v2Stacked: { value: true },
      },
      warnings,
      assumptions: [
        "The forebody, cooling and wheel-share coefficients are the v1 table. Only the solid's areas and slant changed.",
        "A smaller base area lowers the Hoerner base term when the forebody term does not rise enough to cancel it. The comparison uses the solver's own terms, not that proportionality alone.",
      ],
    };
  },
});
