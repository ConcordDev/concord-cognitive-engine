// server/lib/conkay/physics/solvers/cooling-opening.js
//
// fluid.cooling-opening: the radiator core face as the cooling opening,
// and the air temperature rise that would carry the coolant heat at the
// published fan flow.

import { registerSolver } from "../registry.js";
import { getComponent } from "../../components/index.js";
import { LOOP_CHOICES } from "../../fluids/coolant-loop.js";
import { coolingOpening } from "../../fluids/cooling-opening.js";

export const coolingOpeningSolver = registerSolver({
  id: "fluid.cooling-opening",
  version: "1.0.0",
  domain: "thermal.cooling",
  domains: ["thermal.cooling", "fluid.internal"],
  fidelity: 1,
  method: "opening area = sourced radiator core face; air temperature rise from Q = rho * V_fan * cp * dT with dry air at 300 K (Incropera Table A.4) and the coolant-loop heat load. Not a heat-exchanger rating.",
  reference: "server/lib/conkay/fluids/cooling-opening.js",
  regime: "steady energy balance at one air state; no grille loss, no ram, no fin conduction",
  units: { inputs: "W, in, ft^3/min", outputs: "m^2, m/s, K" },
  screening: true,
  targets: (g) => [...g.nodes.values()]
    .filter((n) => String(n.props?.component || "").startsWith("cooling."))
    .map((n) => n.id),
  run(ctx, id) {
    const rad = getComponent(ctx.get(id, "props.component"));
    const dims = rad?.dimensions;
    const cfm = rad?.ratings?.fanAirflowCfm?.value;
    if (!(dims?.coreWidthIn > 0) || !(dims?.coreHeightIn > 0)) return { notComputed: `${id} has no sourced core face` };
    if (!(cfm > 0)) return { notComputed: `${id} has no published fan flow` };

    const loop = ctx.result("fluid.coolant-loop", id);
    let heatW = loop?.outputs?.heatToCoolant?.value;
    let heatBasis;
    if (heatW > 0) {
      heatBasis = "fluid.coolant-loop heatToCoolant on this radiator";
    } else {
      const engine = getComponent(ctx.get("ENGINE", "props.component"));
      const powerW = engine?.ratings?.peakPowerW?.value;
      if (!(powerW > 0)) return { notComputed: "no coolant-loop heat and the engine has no sourced peak power" };
      const frac = LOOP_CHOICES.heatToCoolantFraction;
      heatW = powerW * frac.value;
      heatBasis = `${frac.value} × engine peak power ${powerW} W. ${frac.basis} The coolant-loop solver was not on this run, so the liquid flow was not re-solved.`;
    }
    const rejection = rad.ratings?.heatRejectionKw;
    const result = coolingOpening({
      heatW,
      heatBasis,
      fanCfm: cfm,
      fanSource: rad.ratings.fanAirflowCfm.published || rad.dimensions.source?.title || rad.id,
      coreWidthIn: dims.coreWidthIn,
      coreHeightIn: dims.coreHeightIn,
      coreSource: dims.source?.url || rad.id,
      heatRejectionNote: rejection?.note || (rejection?.value == null ? "not published" : `${rejection.value} kW`),
    });
    if (!result.ok) return { notComputed: result.reason };
    return {
      inputs: {
        heatW: { value: heatW, unit: "W", source: heatBasis },
        fanCfm: { value: cfm, unit: "ft^3/min", source: result.fan.source },
        coreIn: { value: { width: dims.coreWidthIn, height: dims.coreHeightIn }, source: result.opening.basis },
      },
      outputs: {
        openingAreaM2: { value: result.opening.areaM2, unit: "m^2", note: result.opening.basis },
        faceVelocityMs: { value: result.fan.faceVelocityMs, unit: "m/s", note: "published fan flow divided by the core face" },
        riseK: { value: result.riseK, unit: "K", note: "air rise that would carry the heat at the fan flow if the core transferred all of it" },
        conductionUsed: { value: false, note: result.conductionReason },
        opening: { value: result },
      },
      margins: [],
      warnings: result.warnings,
      assumptions: result.assumptions,
    };
  },
});
