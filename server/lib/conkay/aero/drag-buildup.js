// server/lib/conkay/aero/drag-buildup.js
//
// Screening-level drag build-up for a road-vehicle body, as a BOUNDED range
// (low / high) with a stated centre, never a single "computed" Cd:
//
//   Cd = [ Cd_forebody + Cd_base + Cd_slant + dCd_cooling ] / (1 - f_wheels)
//
//   Cd_forebody = k_fore * Cf(Re_L) * S_wet / A        turbulent flat-plate friction on the wetted area,
//                                                       times a forebody factor k_fore (pressure on the nose)
//   Cd_base     = (-Cp_b) * A_base / A,   -Cp_b = K / sqrt(Cd_fore,b),   Cd_fore,b = Cd_forebody * A / A_base
//                                                       (Hoerner's 3D base-pressure relation, as given by
//                                                       Saltzman, Wang & Iliff, AIAA 99-0383, eq. 14)
//   Cd_slant    = 0 .. Ahmed's 25 deg slant contribution, only when the rear slant is 12.5..25 deg
//   f_wheels    = share of total drag from wheels and wheelhouses
//
// Every coefficient carries its source and its status (sourced, derived,
// estimated). This is NOT CFD and NOT a wind-tunnel value: separation,
// underbody roughness, mirrors, gaps, yaw and ground/wheel rotation effects are
// not computed, and the range is wide because of it.

export const DRAG_BUILDUP_VERSION = "1.0.0";

// ---- sources (read 2026-10-10)
export const AERO_SOURCES = Object.freeze({
  schlichting: { title: "H. Schlichting, Boundary-Layer Theory (7th ed., McGraw-Hill 1979), ch. XXI: Prandtl-Schlichting turbulent flat-plate skin friction, cf = 0.455 / (log10 Re)^2.58", status: "standard textbook correlation" },
  schoenherr: { title: "K. E. Schoenherr, Resistance of flat surfaces moving through a fluid, Trans. SNAME 40 (1932) 279-313: 0.242 / sqrt(cf) = log10(Re cf)", status: "standard correlation (used only as an independent check)" },
  blasius: { title: "H. Blasius (1908): laminar flat plate, cf = 1.328 / sqrt(Re) (exact similarity solution)", status: "exact (laminar)" },
  saltzman: {
    title: "E. J. Saltzman, K. C. Wang, K. W. Iliff, Flight-determined subsonic lift and drag characteristics of seven lifting-body and wing-body reentry vehicle configurations with truncated bases, AIAA 99-0383 (1999)",
    url: "http://mae-nas.eng.usu.edu/MAE_6530_Web/New_Course/launch_design/Saltzman_10.1.1.6.7613.pdf",
    quotes: [
      "Hoerner's equation for three-dimensional axisymmetric bodies of revolution is as follows (where K = 0.029 ): -C_Pb = K / sqrt(C_D,fore,b) (14)",
      "A tentative range of values for the numerator coefficient is from 0.09 to 0.10 rather than 0.029, which is based on small-scale model data.",
    ],
    status: "sourced (read)",
  },
  ahmed: {
    title: "S. R. Ahmed, G. Ramm, G. Faltin, Some salient features of the time-averaged ground vehicle wake, SAE 840300 (1984): 25 deg body, drag breakdown nose 0.020, slant 0.140, base 0.070, friction 0.055 (total 0.285), Re_L 4.29e6",
    via: "as tabulated in S. E. Gant, PhD thesis, ch. 7 'Ahmed Body Flow', Table 7.4 (http://www.gant.org.uk/research/THESIS/ahmed.pdf), values read from Ahmed et al.'s Fig. (interpolated by Ahmed et al. between measured angles); the friction value was derived by Ahmed et al. by subtracting the measured pressure drag from the total",
    note: "drag 'fall[s] from 0 to 15 deg and then rise[s] to a maximum at 30 deg' (same source, sec. 7.2)",
    status: "sourced (secondary tabulation of the original)",
  },
  brandt: {
    title: "A. Brandt, H. Berg, M. Bolzon et al., The effects of wheel design on the aerodynamic drag of passenger vehicles, SAE 2019-01-0662 (2019)",
    url: "https://research.chalmers.se/publication/510629/file/510629_Fulltext.pdf",
    quotes: ["The wheels of a vehicle account for approximately 25% of the overall drag coefficient of a passenger vehicle"],
    status: "sourced (read)",
  },
  hobeika: {
    title: "T. Hobeika, S. Sebben, L. Lofdahl, Experimental and numerical investigations of cooling drag, Proc. IMechE D 231(9) (2017) 1203-1210",
    url: "https://research.chalmers.se/publication/249590/file/249590_Fulltext.pdf",
    quotes: ["In his comparison the cooling package drag contribution of 17 count (0.017 Cd ) was significantly larger that the 3 count cooling drag measured on the vehicle."],
    status: "sourced (read): a 3-count (0.003) measured cooling drag with ducted outlets is the low bound",
  },
  isa: { title: "ISO 2533:1975 Standard Atmosphere, sea level: rho 1.225 kg/m3, mu 1.7894e-5 Pa s", status: "standard" },
});

export const ISA_SEA_LEVEL = Object.freeze({ rho: 1.225, mu: 1.7894e-5 });

/** Turbulent flat-plate mean skin friction (Prandtl-Schlichting). */
export function cfTurbulent(Re) {
  return 0.455 / Math.log10(Re) ** 2.58;
}
/** Schoenherr (implicit), solved by fixed point; independent check of cfTurbulent. */
export function cfSchoenherr(Re) {
  let cf = 0.003;
  for (let i = 0; i < 200; i++) {
    const n = (0.242 / Math.log10(Re * cf)) ** 2;
    if (Math.abs(n - cf) < 1e-15) return n;
    cf = n;
  }
  return cf;
}
export const cfLaminar = (Re) => 1.328 / Math.sqrt(Re);

// ---- the coefficient choices: each with low / high and where it comes from
export const BUILDUP_COEFFICIENTS = Object.freeze({
  kFore: {
    low: 1.0, high: 1.72,
    basis: "low: friction only (no nose pressure drag, attached flow). high: derived from Ahmed et al. 25 deg: (nose 0.020 + friction 0.055) / turbulent flat-plate friction on the Ahmed box (2 L (W + H) = 1.414 m2, Re 4.29e6: 0.0435) = 1.72",
    status: "derived (one bluff-body data set, not a car)",
  },
  baseK: { low: 0.029, high: 0.10, basis: "Hoerner K = 0.029 (small-scale models) to 0.09-0.10 (full-scale flight vehicles), Saltzman et al. AIAA 99-0383", status: "sourced" },
  slant: { onsetDeg: 12.5, maxDeg: 25, high: 0.14, basis: "Ahmed et al. 25 deg slant contribution 0.140, applied as an upper bound for a rear slant 12.5..25 deg (their drag rises monotonically from 15 to 30 deg); above 25 deg no bound is established", status: "sourced value, crude transfer to another shape" },
  cooling: { low: 0.003, high: 0.05, basis: "low: 3 counts measured with ducted outlets (Garrone, as quoted by Hobeika et al. 2017). high: 0.05 is an ESTIMATE (no read source gives an upper bound)", status: "low sourced / high estimated" },
  wheels: { low: 0.2, high: 0.3, basis: "approximately 25% of overall drag (Brandt et al. 2019); +/- 0.05 band is an estimate", status: "sourced centre / estimated band" },
});

/** Effective rear-slant angle (deg) from a centreline roof line [{ x, z }]: from the roof's highest point to its last point. */
export function rearSlantDeg(roof) {
  let k = 0;
  roof.forEach((p, i) => { if (p.z > roof[k].z) k = i; });
  const a = roof[k], b = roof.at(-1);
  if (b.x <= a.x) return 0;
  return (Math.atan2(a.z - b.z, b.x - a.x) * 180) / Math.PI;
}

/**
 * The build-up. geom: { lengthM, wettedAreaM2, frontalAreaM2, baseAreaM2, rearSlantDeg },
 * flow: { speedMs, rho, mu }. Returns { low, high, centre, terms, flags, validity }.
 */
export function dragBuildup(geom, flow, C = BUILDUP_COEFFICIENTS) {
  const flags = [];
  const { lengthM: L, wettedAreaM2: S, frontalAreaM2: A, baseAreaM2: Ab, rearSlantDeg: slant } = geom;
  for (const [k, v] of Object.entries({ L, S, A })) if (!(v > 0)) throw new Error(`geometry ${k} must be positive`);
  if (!(Ab >= 0)) throw new Error("base area must be >= 0");
  const Re = (flow.rho * flow.speedMs * L) / flow.mu;
  const mach = flow.speedMs / 340.29;
  if (Re < 1e6 || Re > 1e9) flags.push(`Re_L ${Re.toExponential(2)} outside the turbulent-friction range 1e6..1e9`);
  if (mach > 0.3) flags.push(`Mach ${mach.toFixed(2)} > 0.3: compressibility not modelled`);
  const cf = cfTurbulent(Re);
  const fric = (cf * S) / A;
  const side = (kFore, K, cool, fw, slantTerm) => {
    const fore = kFore * fric;
    let base = 0, cpb = null;
    if (Ab > 0) { const foreB = (fore * A) / Ab; cpb = K / Math.sqrt(foreB); base = (cpb * Ab) / A; }
    const body = fore + base + slantTerm + cool;
    return { fore, base, cpb, slant: slantTerm, cooling: cool, wheelsShare: fw, cd: body / (1 - fw) };
  };
  let slantHigh = 0;
  let inRange = true;
  if (slant > C.slant.maxDeg) { inRange = false; flags.push(`rear slant ${slant.toFixed(1)} deg > ${C.slant.maxDeg} deg: no bound on slant drag is established (Ahmed: drag peaks near 30 deg); OUT OF VALIDITY RANGE`); }
  else if (slant > C.slant.onsetDeg) { slantHigh = C.slant.high; flags.push(`rear slant ${slant.toFixed(1)} deg is in the ${C.slant.onsetDeg}..${C.slant.maxDeg} deg band: slant drag bounded by Ahmed's 25 deg value (0..${C.slant.high}); crude transfer`); }
  const low = side(C.kFore.low, C.baseK.low, C.cooling.low, C.wheels.low, 0);
  const high = side(C.kFore.high, C.baseK.high, C.cooling.high, C.wheels.high, slantHigh);
  const centre = Math.sqrt(low.cd * high.cd);
  return {
    version: DRAG_BUILDUP_VERSION, Re, mach, cf, frictionCd: fric, low, high, centre,
    centreNote: "geometric centre of the low and high bounds: a midpoint of the range, not a best estimate",
    inRange, flags,
    notModelled: ["flow separation ahead of the base", "underbody roughness and exposed parts", "mirrors, gaps, antennas, wipers (not in the CAD body)", "yaw, crosswind, wheel rotation and moving ground", "radiator / duct internal losses beyond the cooling increment", "interference between terms"],
  };
}
