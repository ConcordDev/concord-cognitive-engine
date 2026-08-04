// server/lib/compute/engineering-compute.js
/**
 * Engineering Compute — Structural, electrical, thermal, hydraulic.
 *
 * Real engineering calculations for building, mechanical, electrical,
 * and civil engineering applications. Called by the Oracle Engine for
 * deeper domain computation beyond the lightweight handlers in
 * server/domains/engineering.js.
 *
 * Each function is pure, takes plain parameters, and returns a result
 * of the form { value, unit, formula, inputs, margin?, warnings? }.
 * Edge cases return { error, inputs } instead of throwing.
 *
 * No external dependencies — only the native Math object.
 */

// --------------------------------------------------------------------
// Shared helpers
// --------------------------------------------------------------------

const PI = Math.PI;

function isNum(n) {
  return typeof n === "number" && Number.isFinite(n);
}

function err(message, inputs) {
  return { error: message, inputs };
}

function ok(value, unit, formula, inputs, extra = {}) {
  return { value, unit, formula, inputs, warnings: [], ...extra };
}

function pushWarn(result, msg) {
  if (!Array.isArray(result.warnings)) result.warnings = [];
  result.warnings.push(msg);
  return result;
}

// --------------------------------------------------------------------
// Reference tables (conservative, code-aware but not code-certified)
// --------------------------------------------------------------------

// NEC-style AWG → copper/aluminum resistance (ohms per 1000 ft, 75°C).
const AWG_OHMS_PER_KFT = {
  copper: {
    14: 3.07, 12: 1.93, 10: 1.21, 8: 0.764, 6: 0.491,
    4: 0.308, 3: 0.245, 2: 0.194, 1: 0.154,
    "1/0": 0.122, "2/0": 0.0967, "3/0": 0.0766, "4/0": 0.0608,
    250: 0.0515, 300: 0.0429, 350: 0.0367, 400: 0.0321, 500: 0.0258,
  },
  aluminum: {
    14: 5.06, 12: 3.18, 10: 2.00, 8: 1.26, 6: 0.808,
    4: 0.508, 3: 0.403, 2: 0.319, 1: 0.253,
    "1/0": 0.201, "2/0": 0.159, "3/0": 0.126, "4/0": 0.100,
    250: 0.0847, 300: 0.0707, 350: 0.0605, 400: 0.0529, 500: 0.0424,
  },
};

// Wire ampacity (60°C insulation, copper) — rough NEC Table 310.16.
const AWG_AMPACITY_COPPER = {
  14: 15, 12: 20, 10: 30, 8: 40, 6: 55, 4: 70, 3: 85, 2: 95, 1: 110,
  "1/0": 125, "2/0": 145, "3/0": 165, "4/0": 195,
  250: 215, 300: 240, 350: 260, 400: 280, 500: 320,
};

// Standard breaker sizes (amps).
const STANDARD_BREAKERS = [
  15, 20, 25, 30, 35, 40, 45, 50, 60, 70, 80, 90, 100, 110, 125, 150,
  175, 200, 225, 250, 300, 350, 400, 450, 500, 600,
];

// Wire cross-section areas for conduit fill (sq-in, THHN, approximate).
const THHN_AREA_SQIN = {
  14: 0.0097, 12: 0.0133, 10: 0.0211, 8: 0.0366, 6: 0.0507,
  4: 0.0824, 3: 0.0973, 2: 0.1158, 1: 0.1562,
  "1/0": 0.1855, "2/0": 0.2223, "3/0": 0.2679, "4/0": 0.3237,
};

// EMT internal area (sq-in) for 40% fill rule.
const EMT_AREA_SQIN = {
  "1/2": 0.304, "3/4": 0.533, 1: 0.864, "1-1/4": 1.496,
  "1-1/2": 2.036, 2: 3.356, "2-1/2": 5.858, 3: 8.846,
};

// --------------------------------------------------------------------
// STRUCTURAL
// --------------------------------------------------------------------

/**
 * Preliminary sizing of a reinforced concrete wall against lateral
 * wind load. Returns a factor of safety plus required thickness if
 * the provided section is insufficient.
 *
 * Units: imperial (mph, ft, in, psi).
 */
export function reinforcedConcreteWall({
  windMph,
  wallHeightFt,
  wallThicknessIn,
  concreteFc = 4000,
  rebarSpacingIn = 12,
  rebarSize = 5,
}) {
  const inputs = { windMph, wallHeightFt, wallThicknessIn, concreteFc, rebarSpacingIn, rebarSize };
  if (!isNum(windMph) || windMph < 0) return err("windMph must be ≥ 0", inputs);
  if (!isNum(wallHeightFt) || wallHeightFt <= 0) return err("wallHeightFt must be > 0", inputs);
  if (!isNum(wallThicknessIn) || wallThicknessIn <= 0) return err("wallThicknessIn must be > 0", inputs);
  if (!isNum(concreteFc) || concreteFc <= 0) return err("concreteFc must be > 0", inputs);

  // Velocity pressure (ASCE simplified): qz ≈ 0.00256 · V²  (psf)
  const qz = 0.00256 * windMph * windMph;
  // Assume Cp = 1.0 windward, GCf ≈ 0.85. Net pressure on wall:
  const loadPsf = qz * 1.0 * 0.85;

  // Shear capacity of concrete: Vc = 2·√fc' · b · d   (ACI 318, lb)
  // For a 12-inch strip (b = 12"), d = thickness − 1.5" cover.
  const b = 12;
  const d = Math.max(wallThicknessIn - 1.5, 0.1);
  const sqrtFc = Math.sqrt(concreteFc);
  const vcPerFt = 2 * sqrtFc * b * d; // lbf per 12" strip

  // Rebar contribution: As·fy, with #5 bar area 0.31 in², fy = 60000 psi.
  const rebarAreaTable = { 3: 0.11, 4: 0.20, 5: 0.31, 6: 0.44, 7: 0.60, 8: 0.79 };
  const As = rebarAreaTable[rebarSize] ?? 0.31;
  const fy = 60000;
  const barsPerFt = 12 / rebarSpacingIn;
  const vsPerFt = As * fy * barsPerFt * 0.6; // shear component (phi ≈ 0.6)

  const capacityLbPerFt = vcPerFt + vsPerFt;
  // Shear demand on a 1-ft strip over the full height.
  const demandLbPerFt = loadPsf * wallHeightFt;

  const factorOfSafety = demandLbPerFt > 0 ? capacityLbPerFt / demandLbPerFt : Infinity;
  // Back-solve required thickness for FoS = 2.0 from concrete alone.
  const targetVcPerFt = 2 * demandLbPerFt - vsPerFt;
  const requiredD = targetVcPerFt > 0 ? targetVcPerFt / (2 * sqrtFc * b) : 0;
  const requiredThickness = Math.max(requiredD + 1.5, 6);

  const result = ok(
    factorOfSafety,
    "ratio",
    "FoS = (Vc + Vs) / (q · h)",
    inputs,
    {
      loadPsf,
      capacityPsf: capacityLbPerFt / (wallHeightFt || 1),
      requiredThickness,
      shearDemandLbPerFt: demandLbPerFt,
      shearCapacityLbPerFt: capacityLbPerFt,
    },
  );
  if (factorOfSafety < 1) pushWarn(result, "wall fails under specified wind load");
  else if (factorOfSafety < 1.5) pushWarn(result, "factor of safety below 1.5 — consider thicker wall");
  if (wallThicknessIn < 6) pushWarn(result, "wall thinner than 6 in minimum for structural concrete");
  return result;
}

/**
 * Euler critical buckling load for a slender column.
 * Pcr = π² · E · I / (k·L)²
 * Inputs: kips, ft, psi, in⁴.
 */
export function columnBuckling({ loadKips, lengthFt, modulusE, momentI, kFactor = 1 }) {
  const inputs = { loadKips, lengthFt, modulusE, momentI, kFactor };
  if (!isNum(lengthFt) || !isNum(modulusE) || !isNum(momentI) || !isNum(kFactor)) {
    return err("lengthFt, modulusE, momentI, kFactor required", inputs);
  }
  if (lengthFt <= 0 || modulusE <= 0 || momentI <= 0 || kFactor <= 0) {
    return err("positive values required", inputs);
  }
  const Lin = lengthFt * 12;
  const effective = kFactor * Lin;
  const pcrLb = (PI * PI * modulusE * momentI) / (effective * effective);
  const pcrKips = pcrLb / 1000;

  let factorOfSafety = null;
  if (isNum(loadKips) && loadKips > 0) factorOfSafety = pcrKips / loadKips;

  const result = ok(pcrKips, "kips", "Pcr = π²EI/(kL)²", inputs, {
    criticalLoadLb: pcrLb,
    effectiveLengthIn: effective,
    factorOfSafety,
  });
  if (factorOfSafety !== null && factorOfSafety < 1.67) {
    pushWarn(result, "below AISC recommended FS of 1.67");
  }
  return result;
}

/**
 * Fillet weld strength, AWS D1.1. Allowable = 0.3 · Fexx · throat · length.
 * weldSize: leg size in inches, length: inches.
 */
export function weldStrength({ weldSize, length, material = "e70xx" }) {
  const inputs = { weldSize, length, material };
  if (!isNum(weldSize) || !isNum(length)) return err("numeric required", inputs);
  if (weldSize <= 0 || length <= 0) return err("positive values required", inputs);
  const fExxTable = { e60xx: 60, e70xx: 70, e80xx: 80, e90xx: 90 };
  const fExx = fExxTable[String(material).toLowerCase()] ?? 70; // ksi
  const throat = 0.707 * weldSize;
  const allowablePerInchKips = 0.3 * fExx * throat;
  const totalKips = allowablePerInchKips * length;
  return ok(totalKips, "kips", "V = 0.3·Fexx·0.707·w·L", inputs, {
    throatIn: throat,
    allowablePerInchKips,
    fExxKsi: fExx,
  });
}

/**
 * Bolted connection, AISC allowable shear. A325 group with ≈ 48 ksi
 * allowable shear (bearing type, threads included).
 */
export function boltedConnection({ boltDiameter, boltGrade = "a325", numBolts, loadType = "single" }) {
  const inputs = { boltDiameter, boltGrade, numBolts, loadType };
  if (!isNum(boltDiameter) || !isNum(numBolts)) return err("numeric required", inputs);
  if (boltDiameter <= 0 || numBolts <= 0) return err("positive values required", inputs);
  const fvTable = { a307: 24, a325: 48, a490: 60 }; // ksi, threads included
  const fv = fvTable[String(boltGrade).toLowerCase()] ?? 48;
  const area = (PI * boltDiameter * boltDiameter) / 4;
  const planes = loadType === "double" ? 2 : 1;
  const perBoltKips = fv * area * planes;
  const totalKips = perBoltKips * numBolts;
  return ok(totalKips, "kips", "R = Fv·Ab·n·planes", inputs, {
    shearPlanes: planes,
    perBoltKips,
    boltAreaSqIn: area,
  });
}

// --------------------------------------------------------------------
// ELECTRICAL
// --------------------------------------------------------------------

/**
 * Voltage drop along a conductor. Uses AWG resistance tables and
 * simple V = 2·I·R·L (single-phase round-trip).
 */
export function voltageDrop({ current, length, awg, material = "copper", voltage = 120, phase = 1 }) {
  const inputs = { current, length, awg, material, voltage, phase };
  if (!isNum(current) || !isNum(length)) return err("current, length numeric", inputs);
  if (current < 0 || length < 0) return err("non-negative required", inputs);
  const table = AWG_OHMS_PER_KFT[String(material).toLowerCase()];
  if (!table) return err(`unknown material: ${material}`, inputs);
  const key = typeof awg === "number" ? awg : String(awg);
  const rPerKft = table[key];
  if (!isNum(rPerKft)) return err(`unknown awg: ${awg}`, inputs);
  const rTotal = (rPerKft * length) / 1000;
  // Factor = 2 for single-phase round-trip, √3 for three-phase
  const factor = phase === 3 ? Math.sqrt(3) : 2;
  const vDrop = factor * current * rTotal;
  const percent = voltage > 0 ? (vDrop / voltage) * 100 : null;

  const result = ok(vDrop, "V", phase === 3 ? "Vd = √3·I·R·L" : "Vd = 2·I·R·L", inputs, {
    percent,
    resistanceOhms: rTotal,
    phase,
  });
  if (percent !== null && percent > 5) pushWarn(result, "voltage drop exceeds 5% (NEC recommendation)");
  else if (percent !== null && percent > 3) pushWarn(result, "voltage drop exceeds 3% on feeder (NEC suggestion)");
  return result;
}

/**
 * Size an overcurrent breaker for a given load. Continuous loads get
 * the 125 % factor per NEC 210.20.
 */
export function breakerSizing({ loadAmps, continuous = false, factor = 1.25 }) {
  const inputs = { loadAmps, continuous, factor };
  if (!isNum(loadAmps) || loadAmps < 0) return err("loadAmps ≥ 0 required", inputs);
  const mult = continuous ? factor : 1;
  const required = loadAmps * mult;
  const breaker = STANDARD_BREAKERS.find(b => b >= required) ?? STANDARD_BREAKERS[STANDARD_BREAKERS.length - 1];
  const result = ok(breaker, "A", continuous ? "I·1.25 → next standard" : "I → next standard", inputs, {
    requiredAmps: required,
    selectedBreakerAmps: breaker,
  });
  if (required > breaker) pushWarn(result, "load exceeds largest standard breaker in table");
  return result;
}

/**
 * Conduit fill, NEC chapter 9. Simple 40% fill check for three or more
 * current-carrying conductors.
 */
export function conduitFill({ wireCount, wireAWG, conduitType = "EMT", conduitSize = "1/2" }) {
  const inputs = { wireCount, wireAWG, conduitType, conduitSize };
  if (!isNum(wireCount) || wireCount <= 0) return err("wireCount > 0 required", inputs);
  const key = typeof wireAWG === "number" ? wireAWG : String(wireAWG);
  const wireArea = THHN_AREA_SQIN[key];
  if (!isNum(wireArea)) return err(`unknown wireAWG: ${wireAWG}`, inputs);
  const conduitArea = EMT_AREA_SQIN[String(conduitSize)];
  if (!isNum(conduitArea)) return err(`unknown conduitSize: ${conduitSize}`, inputs);
  const usedArea = wireArea * wireCount;
  const allowed = conduitArea * (wireCount >= 3 ? 0.40 : (wireCount === 2 ? 0.31 : 0.53));
  const fillPct = (usedArea / conduitArea) * 100;
  const ok_ = usedArea <= allowed;
  const result = ok(fillPct, "%", "usedArea / conduitArea", inputs, {
    usedSqIn: usedArea,
    allowedSqIn: allowed,
    conduitAreaSqIn: conduitArea,
    withinCode: ok_,
  });
  if (!ok_) pushWarn(result, "exceeds NEC chapter 9 fill limits");
  return result;
}

/**
 * Transformer sizing. Returns the required kVA plus a next-standard
 * kVA from the ANSI size ladder.
 */
export function transformerSizing({ loadKva, voltage, phase = 3, powerFactor = 0.9, growthFactor = 1.25 }) {
  const inputs = { loadKva, voltage, phase, powerFactor, growthFactor };
  if (!isNum(loadKva) || loadKva <= 0) return err("loadKva must be > 0", inputs);
  if (!isNum(voltage) || voltage <= 0) return err("voltage must be > 0", inputs);
  const required = loadKva * growthFactor;
  const ladder = [15, 30, 45, 75, 112.5, 150, 225, 300, 500, 750, 1000, 1500, 2000, 2500];
  const selected = ladder.find(k => k >= required) ?? ladder[ladder.length - 1];
  // Primary current from selected kVA.
  const primaryAmps =
    phase === 3
      ? (selected * 1000) / (Math.sqrt(3) * voltage)
      : (selected * 1000) / voltage;
  return ok(selected, "kVA", "kVA = loadKva · growth", inputs, {
    requiredKva: required,
    selectedKva: selected,
    primaryAmps,
    powerFactor,
  });
}

// --------------------------------------------------------------------
// THERMAL / HVAC
// --------------------------------------------------------------------

/**
 * Sensible heat load on a space. Q = (A / R) · ΔT + solarGain (BTU/h).
 */
export function heatLoadCalc({ areaSqft, rValue, deltaTemp, solarGain = 0 }) {
  const inputs = { areaSqft, rValue, deltaTemp, solarGain };
  if (!isNum(areaSqft) || !isNum(rValue) || !isNum(deltaTemp)) return err("numeric required", inputs);
  if (rValue <= 0) return err("rValue must be > 0", inputs);
  const conductive = (areaSqft * Math.abs(deltaTemp)) / rValue;
  const total = conductive + (isNum(solarGain) ? solarGain : 0);
  return ok(total, "BTU/h", "Q = A·ΔT/R + solar", inputs, {
    conductiveBtuH: conductive,
    solarBtuH: solarGain,
    tons: total / 12000,
  });
}

/**
 * Duct sizing from CFM and target velocity. A = CFM / v (ft²),
 * then convert to round diameter. Round + velocity-method only — kept
 * for backward compatibility with existing callers (engineering.thermalAnalysis).
 * For the full ductulator (round+rectangular, velocity+friction-rate
 * methods, real Darcy-Weisbach/Colebrook friction physics), see
 * ductSizingFull below — it shares this same diameter-from-velocity
 * closed form via ductDiameterForVelocity, so the two never drift.
 */
export function ductSizing({ cfm, velocity = 1200 }) {
  const inputs = { cfm, velocity };
  if (!isNum(cfm) || cfm <= 0) return err("cfm must be > 0", inputs);
  if (!isNum(velocity) || velocity <= 0) return err("velocity must be > 0", inputs);
  const areaFt2 = cfm / velocity;
  const areaIn2 = areaFt2 * 144;
  const diameterIn = ductDiameterForVelocity(cfm, velocity);
  const result = ok(diameterIn, "in", "D = √(4·A/π)", inputs, {
    areaSqFt: areaFt2,
    areaSqIn: areaIn2,
    velocityFpm: velocity,
  });
  if (velocity > 2000) pushWarn(result, "velocity above 2000 fpm — expect noise");
  if (velocity < 600) pushWarn(result, "velocity below 600 fpm — oversized duct");
  return result;
}

// --------------------------------------------------------------------
// Ductulator — full round+rectangular, velocity+friction-rate duct
// sizing. Physics: Darcy-Weisbach pressure-loss equation with the
// Colebrook equation (solved iteratively, Haaland-seeded) for the
// friction factor, over standard air (rho=0.075 lbm/ft^3, kinematic
// viscosity=1.6e-4 ft^2/s @ ~70F). Rectangular<->round equivalence via
// the Huebscher (1948) equation, De = 1.30*(a*b)^0.625/(a+b)^0.250.
// Verified against a published friction-chart reference point (1000
// CFM @ 0.1 in.wg/100ft -> ~13.5in published vs 13.65in computed here,
// 1.1% off). This is the shared, canonical source of these formulas —
// server/domains/hvac.js's ductulator macro is a thin wrapper over
// ductSizingFull() below, and any other domain that needs duct/pipe
// friction physics should import from here rather than re-deriving it.
// --------------------------------------------------------------------

const DUCT_RHO = 0.075;         // lbm/ft^3, standard air density
const DUCT_NU = 1.6e-4;         // ft^2/s, kinematic viscosity of standard air (~70F)
const DUCT_GC = 32.174;         // lbm*ft/(lbf*s^2)
const LBFFT2_TO_INWG = 0.19223; // 1 lbf/ft^2 = 0.19223 in. w.g.

export const DUCT_ROUGHNESS_FT = {
  // galvanized steel — verified against a published friction-rate chart point (see header note)
  galvanized: 0.0003,
  // PVC / smooth aluminum
  smooth: 0.0001,
  // flexible duct, fully extended — ASHRAE-cited absolute-roughness range is
  // 0.0035-0.015 ft (varies ~4x by product); this is the range midpoint, not
  // a precise per-product figure. Pass an explicit roughnessFt to override.
  flexible: 0.009,
};

export function ductColebrookFrictionFactor(re, relRoughness) {
  if (!(re > 0)) return 0.02;
  let f = Math.pow(-1.8 * Math.log10(Math.pow(relRoughness / 3.7, 1.11) + 6.9 / re), -2);
  for (let i = 0; i < 50; i++) {
    const rhs = -2 * Math.log10(relRoughness / 3.7 + 2.51 / (re * Math.sqrt(f)));
    const fNew = Math.pow(1 / rhs, 2);
    if (Math.abs(fNew - f) < 1e-12) { f = fNew; break; }
    f = fNew;
  }
  return f;
}

export function ductFrictionRatePer100ft({ diameterIn, velocityFpm, roughnessFt = DUCT_ROUGHNESS_FT.galvanized }) {
  const D = diameterIn / 12; // ft
  const V = velocityFpm / 60; // ft/s
  const re = (V * D) / DUCT_NU;
  const relRoughness = roughnessFt / D;
  const f = ductColebrookFrictionFactor(re, relRoughness);
  const dPdL_lbfft2 = f * (1 / D) * (DUCT_RHO * V * V) / (2 * DUCT_GC);
  return dPdL_lbfft2 * LBFFT2_TO_INWG * 100; // in.wg per 100 ft
}

export function ductVelocityFpm(cfm, diameterIn) {
  const areaFt2 = (Math.PI / 4) * Math.pow(diameterIn / 12, 2);
  return cfm / areaFt2;
}

export function ductDiameterForVelocity(cfm, velocityFpm) {
  const areaFt2 = cfm / velocityFpm;
  return Math.sqrt(4 * areaFt2 / Math.PI) * 12; // inches
}

export function ductDiameterForFriction({ cfm, targetFrictionPer100ft, roughnessFt = DUCT_ROUGHNESS_FT.galvanized }) {
  // Friction rate decreases monotonically as diameter grows (same CFM ->
  // lower velocity), so plain bisection applies. Bounds cover small branch
  // runouts through large commercial trunks.
  let lo = 2, hi = 200;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    const v = ductVelocityFpm(cfm, mid);
    const fr = ductFrictionRatePer100ft({ diameterIn: mid, velocityFpm: v, roughnessFt });
    if (fr > targetFrictionPer100ft) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

export function ductHuebscherEquivDiameter(aIn, bIn) {
  // a, b in inches -> round-equivalent diameter in inches (Huebscher 1948)
  return 1.30 * Math.pow(aIn * bIn, 0.625) / Math.pow(aIn + bIn, 0.25);
}

function ductSolveRectSide(equivDiameterIn, knownSideIn) {
  // Huebscher's De is monotonically increasing in the unknown side, so
  // bisection applies directly.
  let lo = 1, hi = 200;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    const computed = ductHuebscherEquivDiameter(knownSideIn, mid);
    if (computed < equivDiameterIn) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

function ductSolveRectAtAspectRatio(equivDiameterIn, ratio) {
  // a = ratio * b; solve b via bisection since Huebscher(ratio*b, b) is
  // monotonically increasing in b.
  let lo = 1, hi = 200;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    const computed = ductHuebscherEquivDiameter(ratio * mid, mid);
    if (computed < equivDiameterIn) lo = mid; else hi = mid;
  }
  const b = (lo + hi) / 2;
  return { a: ratio * b, b };
}

/**
 * Solve a rectangular duct's two sides for a target round-equivalent
 * diameter — from a known constrained side, or (absent one) at a
 * requested aspect ratio (default 2:1, well under ASHRAE's 4:1 ceiling).
 */
export function ductRectangularFromEquivDiameter({ equivDiameterIn, knownSideIn, aspectRatio }) {
  if (isNum(knownSideIn) && knownSideIn > 0) {
    const b = ductSolveRectSide(equivDiameterIn, knownSideIn);
    return { widthIn: knownSideIn, heightIn: b };
  }
  const ratio = isNum(aspectRatio) && aspectRatio > 0 ? aspectRatio : 2;
  const { a, b } = ductSolveRectAtAspectRatio(equivDiameterIn, ratio);
  return { widthIn: a, heightIn: b };
}

const DUCT_STANDARD_ROUND_IN = [4, 5, 6, 7, 8, 9, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32, 36, 40, 42, 48];
export function ductNearestStandardRound(diameterIn) {
  for (const d of DUCT_STANDARD_ROUND_IN) if (d >= diameterIn) return d;
  return Math.ceil(diameterIn / 2) * 2; // above catalog range — round up to nearest even inch
}

/**
 * The full ductulator: round or rectangular, velocity-method or
 * friction-rate-method, matching what a physical ductulator wheel does
 * on both its scales. See the section header above for the physics.
 */
export function ductSizingFull({
  cfm, shape = "round", method = "velocity", material = "galvanized",
  roughnessFt, velocityFpm = 900, frictionRate = 0.1, aspectRatio, knownSideIn,
} = {}) {
  const inputs = { cfm, shape, method, material, roughnessFt, velocityFpm, frictionRate, aspectRatio, knownSideIn };
  if (!isNum(cfm) || cfm <= 0) return err("cfm must be > 0", inputs);
  const knownMaterial = Object.prototype.hasOwnProperty.call(DUCT_ROUGHNESS_FT, material);
  const rFt = isNum(roughnessFt) && roughnessFt > 0
    ? roughnessFt
    : (knownMaterial ? DUCT_ROUGHNESS_FT[material] : DUCT_ROUGHNESS_FT.galvanized);

  let equivDiameterIn, achievedVelocityFpm, achievedFrictionPer100ft;
  if (method === "friction") {
    equivDiameterIn = ductDiameterForFriction({ cfm, targetFrictionPer100ft: frictionRate, roughnessFt: rFt });
    achievedVelocityFpm = ductVelocityFpm(cfm, equivDiameterIn);
    achievedFrictionPer100ft = frictionRate;
  } else {
    equivDiameterIn = ductDiameterForVelocity(cfm, velocityFpm);
    achievedVelocityFpm = velocityFpm;
    achievedFrictionPer100ft = ductFrictionRatePer100ft({ diameterIn: equivDiameterIn, velocityFpm, roughnessFt: rFt });
  }

  const nearestStandardRoundIn = ductNearestStandardRound(equivDiameterIn);
  const velocityAtStandardFpm = ductVelocityFpm(cfm, nearestStandardRoundIn);
  const frictionAtStandardPer100ft = ductFrictionRatePer100ft({ diameterIn: nearestStandardRoundIn, velocityFpm: velocityAtStandardFpm, roughnessFt: rFt });
  const velocityBand = achievedVelocityFpm > 1500 ? "noisy — over typical trunk-duct velocity limit (~1500 fpm)"
    : achievedVelocityFpm > 900 ? "trunk duct range"
    : achievedVelocityFpm > 600 ? "branch duct range"
    : "low velocity — duct is oversized for this CFM";

  const extra = {
    shape, method,
    material: knownMaterial ? material : (isNum(roughnessFt) ? "custom" : "galvanized"),
    roughnessFt: rFt,
    equivalentRoundDiameterIn: equivDiameterIn,
    nearestStandardRoundIn,
    velocityFpm: achievedVelocityFpm,
    velocityAtStandardSizeFpm: velocityAtStandardFpm,
    frictionRatePer100ft: achievedFrictionPer100ft,
    frictionAtStandardSizePer100ft: frictionAtStandardPer100ft,
    velocityBand,
  };

  if (shape === "rectangular") {
    const rect = ductRectangularFromEquivDiameter({ equivDiameterIn, knownSideIn, aspectRatio });
    const areaFt2 = (rect.widthIn * rect.heightIn) / 144;
    extra.rectangular = {
      widthIn: rect.widthIn,
      heightIn: rect.heightIn,
      aspectRatio: rect.widthIn / rect.heightIn,
      equivalentRoundDiameterIn: ductHuebscherEquivDiameter(rect.widthIn, rect.heightIn),
      actualVelocityFpm: cfm / areaFt2,
    };
  }

  const result = ok(nearestStandardRoundIn, "in", "Darcy-Weisbach+Colebrook (round) / Huebscher (rectangular)", inputs, extra);
  if (extra.rectangular && extra.rectangular.widthIn / extra.rectangular.heightIn > 4) {
    pushWarn(result, "Aspect ratio exceeds ASHRAE's recommended 4:1 ceiling — friction loss and fabrication cost rise sharply beyond this.");
  }
  if (achievedVelocityFpm > 1500) pushWarn(result, "velocity above 1500 fpm — expect noise");
  if (achievedVelocityFpm < 600) pushWarn(result, "velocity below 600 fpm — oversized duct");
  return result;
}

/**
 * Room cooling load estimation: a simplified residential approach.
 * Combines envelope, occupant, equipment, and window sensible gains.
 * Returns BTU/h and tons.
 */
export function coolingLoad({ roomSqft, occupants = 0, equipment = 0, windows = 0, deltaTemp = 20, rValue = 13 }) {
  const inputs = { roomSqft, occupants, equipment, windows, deltaTemp, rValue };
  if (!isNum(roomSqft) || roomSqft <= 0) return err("roomSqft > 0 required", inputs);
  if (!isNum(rValue) || rValue <= 0) return err("rValue > 0 required", inputs);
  const envelope = (roomSqft * Math.abs(deltaTemp)) / rValue;
  const people = occupants * 250; // ~250 BTU/h sensible per person
  const equip = equipment; // pass-through BTU/h
  const glassGain = windows * 30 * Math.abs(deltaTemp); // approx. U=0.5 · area · ΔT × factor
  const total = envelope + people + equip + glassGain;
  return ok(total, "BTU/h", "Q_total = envelope + people + equip + glass", inputs, {
    envelopeBtuH: envelope,
    peopleBtuH: people,
    equipBtuH: equip,
    glassBtuH: glassGain,
    tons: total / 12000,
  });
}

// --------------------------------------------------------------------
// HYDRAULIC / PLUMBING
// --------------------------------------------------------------------

/**
 * Pipe size from flow and target velocity.
 * A = Q / v. Returns internal diameter in inches.
 */
export function pipeSize({ flowGpm, velocity = 5 }) {
  const inputs = { flowGpm, velocity };
  if (!isNum(flowGpm) || flowGpm <= 0) return err("flowGpm > 0 required", inputs);
  if (!isNum(velocity) || velocity <= 0) return err("velocity > 0 required", inputs);
  // Q(gpm) → ft³/s : * 0.002228
  const qFt3s = flowGpm * 0.002228;
  const areaFt2 = qFt3s / velocity;
  const diameterFt = Math.sqrt((4 * areaFt2) / PI);
  const diameterIn = diameterFt * 12;
  const result = ok(diameterIn, "in", "D = √(4·Q/(π·v))", inputs, {
    areaSqFt: areaFt2,
    flowFt3PerSec: qFt3s,
    velocityFps: velocity,
  });
  if (velocity > 8) pushWarn(result, "velocity above 8 fps — erosion risk");
  return result;
}

/**
 * Pump brake horsepower: BHP = (Q·H·SG) / (3960·η).
 */
export function pumpHead({ flowGpm, totalDynamicHead, efficiency = 0.7, specificGravity = 1.0 }) {
  const inputs = { flowGpm, totalDynamicHead, efficiency, specificGravity };
  if (!isNum(flowGpm) || !isNum(totalDynamicHead) || !isNum(efficiency)) return err("numeric required", inputs);
  if (efficiency <= 0 || efficiency > 1) return err("efficiency between 0 and 1", inputs);
  if (flowGpm <= 0 || totalDynamicHead <= 0) return err("positive flow and head required", inputs);
  const whp = (flowGpm * totalDynamicHead * specificGravity) / 3960;
  const bhp = whp / efficiency;
  return ok(bhp, "hp", "BHP = Q·H·SG/(3960·η)", inputs, {
    waterHp: whp,
    efficiency,
    kW: bhp * 0.7457,
  });
}

/**
 * Darcy–Weisbach pressure loss in a round pipe. Estimates a friction
 * factor via Swamee–Jain when relative roughness is provided.
 * Units: in, gpm, ft, in → returns psi.
 */
export function pressureLoss({ pipeDiameter, flowGpm, length, roughness = 0.00015 }) {
  const inputs = { pipeDiameter, flowGpm, length, roughness };
  if (!isNum(pipeDiameter) || !isNum(flowGpm) || !isNum(length)) return err("numeric required", inputs);
  if (pipeDiameter <= 0 || length <= 0 || flowGpm < 0) return err("positive required", inputs);

  // Convert to SI for friction factor calc.
  const dM = pipeDiameter * 0.0254;
  const qM3s = flowGpm * 6.309e-5;
  const areaM2 = (PI * dM * dM) / 4;
  const vMs = qM3s / areaM2;

  // Water at 20°C: ρ = 998 kg/m³, μ = 1.002e-3 Pa·s.
  const re = (998 * vMs * dM) / 1.002e-3;
  const eps = roughness; // ft assumed same order of magnitude
  const epsOverD = eps / (pipeDiameter / 12); // both in ft
  // Swamee–Jain explicit friction factor.
  const f =
    re > 4000
      ? 0.25 /
        Math.pow(Math.log10(epsOverD / 3.7 + 5.74 / Math.pow(re, 0.9)), 2)
      : re > 0
      ? 64 / re
      : 0;

  const lengthM = length * 0.3048;
  const dpPa = f * (lengthM / dM) * 0.5 * 998 * vMs * vMs;
  const dpPsi = dpPa * 0.000145038;

  const result = ok(dpPsi, "psi", "ΔP = f·(L/D)·½·ρ·v²", inputs, {
    frictionFactor: f,
    reynolds: re,
    velocityMs: vMs,
    velocityFps: vMs * 3.28084,
  });
  if (vMs * 3.28084 > 8) pushWarn(result, "velocity above 8 fps");
  return result;
}

// --------------------------------------------------------------------
// STRUCTURAL — cross-section properties for CAD/FEA primitives
// --------------------------------------------------------------------
//
// Shared geometry math behind server/domains/engineering.js's
// parametricSolid/partMesh macros (area/Ix/Iy — the section properties a
// beam-frame FEA model needs) — factored out here so any domain can
// generate a correct beam section (e.g. a duct wall's real hollow
// section) without re-deriving or duplicating the formulas. Returns raw
// { area, Ix, Iy } numbers in SI units (m^2, m^4) rather than the
// {value,unit,formula,...} report shape most of this file's functions
// use — this is a low-level geometry primitive meant to feed directly
// into a model builder (parametricSolid, an FEA adapter), not a
// standalone user-facing report.
export function sectionProperties(kind, p = {}) {
  switch (kind) {
    case 'box': {
      const w = p.width || 0.1, h = p.height || 0.1;
      return { area: w * h, Ix: (w * h ** 3) / 12, Iy: (h * w ** 3) / 12 };
    }
    case 'cylinder': {
      const r = p.radius || 0.05;
      return { area: Math.PI * r * r, Ix: (Math.PI * r ** 4) / 4, Iy: (Math.PI * r ** 4) / 4 };
    }
    case 'tube': {
      const ro = p.radius || 0.05;
      const ri = Math.min(p.innerRadius || 0.04, ro - 1e-6);
      return {
        area: Math.PI * (ro * ro - ri * ri),
        Ix: (Math.PI / 4) * (ro ** 4 - ri ** 4),
        Iy: (Math.PI / 4) * (ro ** 4 - ri ** 4),
      };
    }
    case 'rect-tube': {
      // Hollow thin/thick-wall rectangular tube — a rectangular duct's
      // actual cross-section. Outer width/height, wall thickness -> inner
      // width'/height' (clamped >= 0). Standard closed-form (exact, not
      // approximated): area = w*h - w'*h'; Ix = (w*h^3 - w'*h'^3)/12;
      // Iy = (h*w^3 - h'*w'^3)/12.
      const w = p.width || 0.1, h = p.height || 0.1;
      const t = Math.max(0, Math.min(p.wallThickness ?? 0.001, Math.min(w, h) / 2 - 1e-6));
      const wi = Math.max(0, w - 2 * t), hi = Math.max(0, h - 2 * t);
      return {
        area: w * h - wi * hi,
        Ix: (w * h ** 3 - wi * hi ** 3) / 12,
        Iy: (h * w ** 3 - hi * wi ** 3) / 12,
      };
    }
    case 'i-beam': {
      const bf = p.flangeWidth || 0.1;
      const dh = p.height || 0.2;
      const tf = p.flangeThickness || 0.012;
      const tw = p.webThickness || 0.008;
      const area = 2 * bf * tf + (dh - 2 * tf) * tw;
      const Ix = (bf * dh ** 3) / 12 - ((bf - tw) * (dh - 2 * tf) ** 3) / 12;
      const Iy = (2 * tf * bf ** 3) / 12 + ((dh - 2 * tf) * tw ** 3) / 12;
      return { area, Ix, Iy };
    }
    default:
      return null;
  }
}

// --------------------------------------------------------------------
// Default export — Oracle registry
// --------------------------------------------------------------------

export default {
  reinforcedConcreteWall,
  columnBuckling,
  weldStrength,
  boltedConnection,
  voltageDrop,
  breakerSizing,
  conduitFill,
  transformerSizing,
  heatLoadCalc,
  ductSizing,
  ductSizingFull,
  ductColebrookFrictionFactor,
  ductFrictionRatePer100ft,
  ductVelocityFpm,
  ductDiameterForVelocity,
  ductDiameterForFriction,
  ductHuebscherEquivDiameter,
  ductRectangularFromEquivDiameter,
  ductNearestStandardRound,
  sectionProperties,
  coolingLoad,
  pipeSize,
  pumpHead,
  pressureLoss,
  tables: {
    AWG_OHMS_PER_KFT,
    AWG_AMPACITY_COPPER,
    STANDARD_BREAKERS,
    THHN_AREA_SQIN,
    EMT_AREA_SQIN,
    DUCT_ROUGHNESS_FT,
  },
};
