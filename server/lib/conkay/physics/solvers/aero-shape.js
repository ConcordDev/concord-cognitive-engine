// server/lib/conkay/physics/solvers/aero-shape.js
//
// aero.shape: whether the smaller Kamm face lowered the v1 drag range
// without entering Ahmed's slant band. It reads aero.drag-buildup.
// It does not run CFD, and it does not use calibrated drag v2.

import { registerSolver } from "../registry.js";
import { AERO_FROM } from "./aero-drag.js";
import { shapeVerdict, KAMM50_BASELINE, NOT_COPIED, AERO_SHAPE_VERSION } from "../../aero/shape.js";

const vehicles = (g) => g.nodesOfKind("Assembly").filter((n) => n.props?.vehicle?.dragCoefficientFrom === AERO_FROM).map((n) => n.id);

export const aeroShape = registerSolver({
  id: "aero.shape",
  version: AERO_SHAPE_VERSION,
  domain: "aero.drag",
  fidelity: 1,
  screening: true,
  method: "Compare the v1 drag build-up of this solid with the kamm-ratio 0.5 solid: base area, base term, and the low, centre and high Cd. A reduction counts only while the rear slant stays at or below Ahmed's 12.5 deg onset, so the slant term stays 0. Section lift is the existing 2D panel sign. Not CFD. Calibrated drag v2 is not on this branch.",
  reference: "Saltzman, Wang and Iliff, AIAA 99-0383 eq. 14; Ahmed, Ramm and Faltin, SAE 840300; drag-buildup.js",
  targets: vehicles,
  run(ctx, id) {
    const aero = ctx.result(AERO_FROM, id);
    if (!aero || aero.status === "NOT_COMPUTED" || aero.status === "ERROR" || !aero.outputs?.dragCoefficient) {
      return { notComputed: `aero.drag-buildup did not return a coefficient (${aero?.reason || aero?.error || "no run"})` };
    }
    const cd = aero.outputs.dragCoefficient.value;
    const terms = aero.outputs.terms.value;
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
        dragModel: { value: "1.0.0", note: "v1 drag build-up. Calibrated drag v2 (PR 1067) is not on this branch." },
      },
      outputs: {
        verdict: { value: verdict },
        measured: { value: measured },
        baselineCd: { value: KAMM50_BASELINE.cd },
        sectionLift: { value: lift, note: "copied from aero.drag-buildup. A sign only when both Kutta corners agree. Not a 3D coefficient." },
        notCopied: { value: NOT_COPIED },
        v2Stacked: { value: false },
      },
      warnings,
      assumptions: [
        "The forebody, cooling and wheel-share coefficients are the v1 table. Only the solid's areas and slant changed.",
        "A smaller base area lowers the Hoerner base term when the forebody term does not rise enough to cancel it. The comparison uses the solver's own terms, not that proportionality alone.",
      ],
    };
  },
});
