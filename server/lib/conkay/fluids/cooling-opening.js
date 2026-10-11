// server/lib/conkay/fluids/cooling-opening.js
//
// The cooling opening is the air path through the radiator core that is
// actually in the library. The area is that core face. A larger hole does
// not raise the fan's published flow, and a grille loss coefficient is not
// published, so a smaller hole is not sized.
//
// The air temperature rise that would carry the coolant heat at that flow
// is m_dot = rho * V_dot,  Q = m_dot * cp * dT. Properties are dry air at
// 300 K and 1 atm (Incropera et al., 7th ed., Table A.4). This is an energy
// balance. It is not a prediction of the core's exit temperature: the
// radiator's heat rejection is not published, and the tube wall and fin
// geometry the conduction solver would need are not published either.

export const COOLING_OPENING_VERSION = "1.0.0";

/** 1 ft = 0.3048 m exactly. */
const FT3 = 0.3048 ** 3;
const IN = 0.0254;

export const AIR_300K = Object.freeze({
  T: 300,
  rho: 1.1614,
  cp: 1007,
  k: 0.0263,
  mu: 184.6e-7,
  Pr: 0.707,
  source: "F. P. Incropera, D. P. DeWitt, T. L. Bergman and A. S. Lavine, Fundamentals of Heat and Mass Transfer, 7th ed. (Wiley, 2011), Table A.4, dry air at atmospheric pressure, 300 K: rho 1.1614 kg/m³, cp 1.007 kJ/kg·K, k 26.3×10⁻³ W/m·K, mu 184.6×10⁻⁷ N·s/m², Pr 0.707",
});

/**
 * @param {object} spec
 * @param {number} spec.heatW estimated heat the air would have to carry
 * @param {string} spec.heatBasis
 * @param {number} spec.fanCfm published fan volume flow
 * @param {string} spec.fanSource
 * @param {number} spec.coreWidthIn
 * @param {number} spec.coreHeightIn
 * @param {string} spec.coreSource
 * @param {string|null} spec.heatRejectionNote
 */
export function coolingOpening(spec) {
  const warnings = [];
  if (!(spec.fanCfm > 0) || !(spec.coreWidthIn > 0) || !(spec.coreHeightIn > 0) || !(spec.heatW > 0)) {
    return { ok: false, reason: "need a positive heat load, fan flow and core face" };
  }
  const widthM = spec.coreWidthIn * IN;
  const heightM = spec.coreHeightIn * IN;
  const areaM2 = widthM * heightM;
  const flowM3s = spec.fanCfm * FT3 / 60;
  const faceVelocityMs = flowM3s / areaM2;
  const mdot = AIR_300K.rho * flowM3s;
  const wattsPerKelvin = mdot * AIR_300K.cp;
  const riseK = spec.heatW / wattsPerKelvin;
  warnings.push("The opening area is the sourced core face. It is not a grille sized to a pressure drop: no grille loss coefficient is published.");
  warnings.push("The conduction solver is not used. It needs a wall thickness, a conductivity and a convection coefficient. The radiator listing publishes none of those, and its heat rejection is unpublished, so a fin model would be an invented wall.");
  warnings.push("The air temperature rise is the rise that would carry the estimated coolant heat if the core transferred all of it at the published fan flow. It is not a measured or predicted exit temperature.");
  warnings.push(`Dry-air properties are Table A.4 at 300 K. The coolant screen's design temperature is 90 °C on the liquid side. The two states are not the same fluid.`);
  return {
    ok: true,
    version: COOLING_OPENING_VERSION,
    opening: {
      areaM2,
      widthM,
      heightM,
      basis: "sourced radiator core face (width × height). The air that can cross the core is limited by that face and by the published fan flow.",
    },
    fan: {
      cfm: spec.fanCfm,
      flowM3s,
      source: spec.fanSource,
      faceVelocityMs,
    },
    air: AIR_300K,
    heatW: spec.heatW,
    heatBasis: spec.heatBasis,
    wattsPerKelvin,
    riseK,
    heatRejectionNote: spec.heatRejectionNote || "not published",
    conductionUsed: false,
    conductionReason: "solve1D needs L, k and a convection coefficient. The listing has no tube-wall thickness, fin pitch or conductivity. Heat rejection is unpublished.",
    warnings,
    assumptions: [
      "Energy balance Q = m cp dT on the published fan volume flow. Capture, ram pressure and grille loss are not modelled.",
      "Dry air at 300 K, 1 atm, Incropera et al. Table A.4. Constant properties.",
      "The opening is the core face. No metal and no skin cut was added.",
      "Pipe flow sizes the liquid hoses. It is not a model of this air opening.",
    ],
  };
}
