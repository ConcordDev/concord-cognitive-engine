// server/lib/viability/climate-energy-budget.js
//
// Engines #25 (planetary energy budget) + #27 (tipping points / hysteresis).
// Real Stefan-Boltzmann radiative balance: σT⁴ = absorbed insolation, with a
// greenhouse factor that traps part of the re-radiation. Plus the bistable
// snowball/warm hysteresis — the ice-albedo feedback makes two stable climate
// branches for the same forcing, flipped only when the forcing crosses a
// branch-specific threshold (path-dependent, irreversible-feeling). Pure math.
//
// Layers ON TOP of the authored climate (environment-sensor) when enabled —
// replaces only the thermal baseline; weather.js Markov deltas ride on top.

const SIGMA = 5.670374419e-8; // Stefan-Boltzmann constant, W·m⁻²·K⁻⁴
const SOLAR_CONSTANT = 1361;  // Earth's, W·m⁻² (default)

/**
 * Equilibrium surface temperature from the energy balance.
 *   σ·T⁴·(1 − g/2) = (S/4)·(1 − albedo)
 * → a higher greenhouse `g` (0..1) traps more re-radiation → warmer.
 * Earth: albedo 0.3, g 0 → ≈ −18 °C; g ≈ 0.78 → ≈ +15 °C.
 *
 * @returns {{ kelvin:number, celsius:number }}
 */
export function equilibriumTemp({ solarConstant = SOLAR_CONSTANT, albedo = 0.3, greenhouse = 0 } = {}) {
  const S = Math.max(0, Number(solarConstant) || 0);
  const a = Math.max(0, Math.min(1, Number(albedo) || 0));
  const g = Math.max(0, Math.min(0.99, Number(greenhouse) || 0));
  const absorbed = (S * (1 - a)) / 4;                 // W·m⁻² averaged over the sphere
  const effSigma = SIGMA * (1 - g / 2);               // greenhouse reduces effective emission
  const kelvin = Math.pow(absorbed / effSigma, 0.25);
  return { kelvin, celsius: kelvin - 273.15 };
}

/** The two forcing thresholds that bound the bistable region (#27). */
export function tippingPoints(params = {}) {
  return {
    iceThreshold: Number(params.iceThreshold ?? 0.9),   // warm→ice flip below this insolation factor
    warmThreshold: Number(params.warmThreshold ?? 1.1), // ice→warm flip above this
  };
}

/**
 * Advance the climate one step under `forcing` (an insolation multiplier, 1 =
 * nominal). Bistable + path-dependent: a warm planet stays warm until forcing
 * drops below iceThreshold (then snowballs); a frozen planet stays frozen until
 * forcing rises above warmThreshold (> iceThreshold) — so between the thresholds
 * the SAME forcing yields a different temperature depending on history.
 *
 * @param {{branch?:'ice'|'warm', temperature?:number}} prev
 * @param {number} forcing
 * @param {object} params { solarConstant, iceAlbedo, warmAlbedo, greenhouse, iceThreshold, warmThreshold }
 * @returns {{ branch:'ice'|'warm', temperature:number, kelvin:number, tipped:boolean }}
 */
export function steppedClimate(prev = {}, forcing = 1, params = {}) {
  const { iceThreshold, warmThreshold } = tippingPoints(params);
  const iceAlbedo = Number(params.iceAlbedo ?? 0.6);
  const warmAlbedo = Number(params.warmAlbedo ?? 0.3);
  const greenhouse = Number(params.greenhouse ?? 0.4);
  const solarConstant = Number(params.solarConstant ?? SOLAR_CONSTANT);
  const f = Math.max(0, Number(forcing) || 0);

  let branch = prev?.branch === "ice" ? "ice" : "warm";
  let tipped = false;
  if (branch === "warm" && f < iceThreshold) { branch = "ice"; tipped = true; }
  else if (branch === "ice" && f > warmThreshold) { branch = "warm"; tipped = true; }

  const albedo = branch === "ice" ? iceAlbedo : warmAlbedo;
  const t = equilibriumTemp({ solarConstant: solarConstant * f, albedo, greenhouse });
  return { branch, temperature: t.celsius, kelvin: t.kelvin, tipped };
}
