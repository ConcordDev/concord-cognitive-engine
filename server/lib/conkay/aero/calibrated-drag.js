// server/lib/conkay/aero/calibrated-drag.js
//
// Screening drag build-up 1.1. The 1.0 envelope stacked every coefficient's
// extreme, including a reentry-vehicle base coefficient and an unsourced
// cooling high of 0.05. This version transfers the Ahmed body's measured
// base pressure and slant contribution, and it drops those two extremes.
// It is still not CFD and not a wind-tunnel value for the car.
//
// Ahmed geometry:
//   Guilmineau, SAE 2018-01-0720: length 1044 mm, width 389 mm, height 288 mm,
//   ground clearance 50 mm (the PDF text extraction writes "1044 m" / "389 m"
//   beside "288 mm"; the figure is in mm, and the JWEIA paper below states
//   the same three lengths in mm).
//   Minguez, Pasquetti & Serre, J. Wind Eng. Ind. Aerodyn. 96 (2008) 934-944
//   (doi:10.1016/j.jweia.2007.06.041): "1044 mm long, 288 mm high and 389 mm
//   width. The slant part is 222 mm long, whatever the angle. ... 50 mm above
//   the ground."
//   ERCOFTAC classic case 082: slant length 222 mm at both 25 deg and 35 deg,
//   ground clearance 50 mm, stilt diameter 30 mm.
//
// Ahmed drag readings (not averaged where they disagree):
//   Gant, PhD thesis, Tables 7.3 and 7.4, taken from Ahmed, Ramm & Faltin,
//   SAE 840300, Fig. 7.2. At 25 deg: nose 0.020, slant 0.140, base 0.070,
//   friction 0.055, total 0.285. Ahmed measured components only at 5, 12.5
//   and 30 deg; 25 deg is their interpolation. Friction is the residual of
//   the total minus those three pressure components.
//   Lienhart, Becker & Stoots, as tabulated by Gant Table 7.4 at 25 deg:
//   slant 0.158, base 0.116. No total.
//   Guilmineau Table 4 rows labeled "Ahmed et al.": 25 deg base 0.086 and
//   slant 0.141; 30 deg base 0.090 and slant 0.213; 35 deg base 0.089 and
//   slant 0.097. Guilmineau Table 3 (0.380 at 25 deg) is that paper's IDDES,
//   not the experiment, and is not used.

import { cfTurbulent, ISA_SEA_LEVEL } from "./drag-buildup.js";

export const CALIBRATED_DRAG_VERSION = "1.1.0";

export const AHMED_GEOMETRY = Object.freeze({
  lengthM: 1.044,
  widthM: 0.389,
  heightM: 0.288,
  slantLengthM: 0.222,
  groundClearanceM: 0.05,
  Re: 4.29e6,
});

export const AHMED_GANT_25 = Object.freeze({ nose: 0.020, slant: 0.140, base: 0.070, friction: 0.055, total: 0.285 });
export const AHMED_LIENHART_25 = Object.freeze({ slant: 0.158, base: 0.116 });
export const AHMED_GUILMINEAU = Object.freeze({
  25: { base: 0.086, slant: 0.141 },
  30: { base: 0.090, slant: 0.213 },
  35: { base: 0.089, slant: 0.097 },
});

// SAE reference cars that this build-up is NOT run on: their wetted area and
// base area were not in the sources read. The two papers assign 0.254 and
// 0.258 to opposite rear ends.
export const SAE_NOT_COMPARED = Object.freeze([
  {
    body: "DrivAer fastback and notchback, smooth underbody, with side mirrors",
    cd: [
      { rear: "fastback", cd: 0.258, rearHeft: "notchback" },
      { rear: "notchback", cd: 0.254, rearHeft: "fastback" },
    ],
    source: "Wieser, Nayeri et al., SAE 2014-01-0613, zero yaw, Re 3.2e6: fastback 0.258, notchback 0.254. Heft, Indinger & Adams, SAE 2012-01-0168, same geometry: notchback 0.258, fastback 0.254. The two papers swap the rear ends.",
    status: "sourced, not compared: no wetted area or base area in the sources read, so the build-up is not applied",
  },
]);

const DEG = Math.PI / 180;

export function ahmedFrontalArea() {
  return AHMED_GEOMETRY.widthM * AHMED_GEOMETRY.heightM;
}

/** Box wetted area 2 L (W+H). The rounded nose and the slant face are not in it. */
export function ahmedWettedBox() {
  const g = AHMED_GEOMETRY;
  return 2 * g.lengthM * (g.widthM + g.heightM);
}

/** Vertical base area at a slant angle. Slant length is fixed (222 mm). */
export function ahmedBaseArea(slantDeg) {
  const drop = AHMED_GEOMETRY.slantLengthM * Math.sin((slantDeg * Math.PI) / 180);
  const height = AHMED_GEOMETRY.heightM - drop;
  if (!(height > 0)) throw new Error(`slant ${slantDeg} deg drops more than the body height`);
  return { dropM: drop, heightM: height, areaM2: AHMED_GEOMETRY.widthM * height };
}

/** -Cp on the vertical base, from a Cd contribution and the 25 deg base area. */
export function ahmedBaseCp25() {
  const A = ahmedFrontalArea();
  const Ab = ahmedBaseArea(25).areaM2;
  const cp = (cd) => (cd * A) / Ab;
  const gant = cp(AHMED_GANT_25.base);
  const lienhart = cp(AHMED_LIENHART_25.base);
  const guilmineau = cp(AHMED_GUILMINEAU[25].base);
  return {
    A, Ab,
    low: Math.min(gant, lienhart),
    high: Math.max(gant, lienhart),
    gant, lienhart, guilmineau,
    status: "derived from sourced Cd contributions and the 222 mm slant. Gant and Lienhart disagree; both are kept. Guilmineau's 25 deg reading is a check, not a third bound.",
  };
}

/** Flat-plate friction Cd on the Ahmed box at Ahmed's Reynolds number, and the factor by which Ahmed's residual friction exceeds it. */
export function ahmedFrictionCheck(Re = AHMED_GEOMETRY.Re) {
  const S = ahmedWettedBox();
  const A = ahmedFrontalArea();
  const cf = cfTurbulent(Re);
  const flatCd = (cf * S) / A;
  return { cf, wettedBoxM2: S, frontalAreaM2: A, flatCd, residualCd: AHMED_GANT_25.friction, factor: AHMED_GANT_25.friction / flatCd };
}

/**
 * Hoerner base Cd on the Ahmed 25 deg body. Reported so the test can show
 * the residual. Not used as the car's base term.
 */
export function hoernerAhmedBase(K, Re = AHMED_GEOMETRY.Re) {
  const A = ahmedFrontalArea();
  const Ab = ahmedBaseArea(25).areaM2;
  const fore = ahmedFrictionCheck(Re).flatCd; // friction only, the low forebody
  const cpb = K / Math.sqrt((fore * A) / Ab);
  return { K, minusCp: cpb, cd: (cpb * Ab) / A, ahmedGant: AHMED_GANT_25.base };
}

const COOLING = Object.freeze({
  low: 0.003,
  high: 0.017,
  basis: "low: 0.003 measured with ducted outlets (Garrone, quoted by Hobeika, Sebben & Lofdahl, Proc. IMechE D 231(9) 2017). high: 0.017, the cooling-package figure in that same sentence, which was larger than the measured 0.003. The 1.0 estimate of 0.05 had no source and is not used.",
  status: "sourced",
});
const WHEELS = Object.freeze({
  low: 0.20,
  high: 0.30,
  centre: 0.25,
  basis: "Brandt et al., SAE 2019-01-0662: wheels about 25% of the drag of a passenger vehicle. The +/- 0.05 band is an estimate.",
  status: "sourced centre, estimated band",
});

/**
 * geom: { lengthM, wettedAreaM2, frontalAreaM2, baseAreaM2, rearSlantDeg }
 * flow: { speedMs, rho, mu }
 * opt.cooling / opt.wheels: false omits that term (the Ahmed body has neither).
 */
export function calibratedDrag(geom, flow, opt = {}) {
  const flags = [];
  const { lengthM: L, wettedAreaM2: S, frontalAreaM2: A, baseAreaM2: Ab, rearSlantDeg: slant } = geom;
  for (const [k, v] of Object.entries({ L, S, A })) if (!(v > 0)) throw new Error(`geometry ${k} must be positive`);
  if (!(Ab >= 0)) throw new Error("base area must be >= 0");
  if (!(slant >= 0)) throw new Error("rear slant must be >= 0");
  const Re = (flow.rho * flow.speedMs * L) / flow.mu;
  const mach = flow.speedMs / 340.29;
  if (Re < 1e6 || Re > 1e9) flags.push(`Re_L ${Re.toExponential(2)} outside 1e6..1e9`);
  if (mach > 0.3) flags.push(`Mach ${mach.toFixed(2)} > 0.3: compressibility not modelled`);
  const fric = (cfTurbulent(Re) * S) / A;
  const fr = ahmedFrictionCheck();
  const nose = { low: 0, high: AHMED_GANT_25.nose, status: "crude transfer of Ahmed's 25 deg nose Cd (0.020). One body." };
  const cp = ahmedBaseCp25();
  const base = {
    low: Ab > 0 ? (cp.low * Ab) / A : 0,
    high: Ab > 0 ? (cp.high * Ab) / A : 0,
    minusCpLow: cp.low,
    minusCpHigh: cp.high,
    status: "25 deg Ahmed base pressure (Gant 0.070 and Lienhart 0.116, as -Cp on the 222 mm geometry) times this body's Ab/A. Not Hoerner.",
  };
  let slantTerm = { low: 0, high: 0, status: "not applied" };
  let inRange = true;
  if (slant > 25) {
    inRange = false;
    flags.push(`rear slant ${slant.toFixed(1)} deg > 25 deg: the 30 deg drag crisis is not modelled (Guilmineau's Ahmed slant Cd is 0.213 at 30 deg and 0.097 at 35 deg). OUT OF VALIDITY RANGE`);
  } else if (slant >= 24) {
    slantTerm = { low: AHMED_GANT_25.slant, high: AHMED_LIENHART_25.slant, status: "sourced at 25 deg: Gant 0.140 to Lienhart 0.158" };
  } else if (slant > 12.5) {
    slantTerm = {
      low: 0,
      high: AHMED_LIENHART_25.slant,
      status: "estimated upper bound: Lienhart's 25 deg slant Cd, while Gant says total drag is still rising from 15 deg toward 30 deg. Not a measured value at this angle.",
    };
    flags.push(`rear slant ${slant.toFixed(1)} deg is between 12.5 and 25: slant Cd bounded by 0..${AHMED_LIENHART_25.slant} (Lienhart at 25 deg). Crude transfer.`);
  } else {
    flags.push(`rear slant ${slant.toFixed(1)} deg <= 12.5: no slant increment. Gant: Ahmed's total drag falls from 0 to 15 deg. A component figure at this angle was not read, so the omitted slant drag is unknown.`);
  }
  const cool = opt.cooling === false ? { low: 0, high: 0, status: "omitted (this body has no cooling duct)" } : { ...COOLING };
  const wheels = opt.wheels === false ? { low: 0, high: 0, status: "omitted (this body has no wheels)" } : { ...WHEELS };
  const side = (fricCd, noseCd, baseCd, slantCd, coolCd, fw) => {
    const body = fricCd + noseCd + baseCd + slantCd + coolCd;
    return { friction: fricCd, nose: noseCd, base: baseCd, slant: slantCd, cooling: coolCd, wheelsShare: fw, cd: fw >= 1 ? NaN : body / (1 - fw) };
  };
  const low = side(fric, nose.low, base.low, slantTerm.low, cool.low, wheels.low);
  const high = side(fric * fr.factor, nose.high, base.high, slantTerm.high, cool.high, wheels.high);
  const centre = Math.sqrt(low.cd * high.cd);
  return {
    version: CALIBRATED_DRAG_VERSION,
    Re, mach, cf: cfTurbulent(Re), frictionCd: fric, frictionFactor: fr.factor,
    low, high, centre,
    centreNote: "geometric centre of the low and high bounds: a midpoint of the envelope, not a best estimate",
    inRange, flags,
    terms: { nose, base, slant: slantTerm, cooling: cool, wheels },
    notModelled: [
      "separation on the slant (bounded by the Ahmed readings, not resolved)",
      "underbody roughness, mirrors, gaps, yaw, wheel rotation, moving ground",
      "interference between the terms",
      "the 30 deg Ahmed drag crisis",
    ],
    notCompared: SAE_NOT_COMPARED,
    hoernerNotUsed: {
      k0029: hoernerAhmedBase(0.029),
      k010: hoernerAhmedBase(0.10),
      note: "Hoerner K = 0.029 (models) and 0.10 (Saltzman flight vehicles) evaluated on the Ahmed 25 deg box. They are not the car's base term.",
    },
  };
}

/** The build-up on the Ahmed 25 deg body, with no wheels and no cooling. */
export function ahmedBenchmark() {
  const A = ahmedFrontalArea();
  const V = (AHMED_GEOMETRY.Re * ISA_SEA_LEVEL.mu) / (ISA_SEA_LEVEL.rho * AHMED_GEOMETRY.lengthM);
  const r = calibratedDrag(
    {
      lengthM: AHMED_GEOMETRY.lengthM,
      wettedAreaM2: ahmedWettedBox(),
      frontalAreaM2: A,
      baseAreaM2: ahmedBaseArea(25).areaM2,
      rearSlantDeg: 25,
    },
    { speedMs: V, ...ISA_SEA_LEVEL },
    { cooling: false, wheels: false },
  );
  return { ...r, target: AHMED_GANT_25, speedMs: V };
}
