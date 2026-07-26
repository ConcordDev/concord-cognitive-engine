// server/lib/compute/physics-compute.js
/**
 * Physics Compute — Classical mechanics, thermodynamics, EM, fluid, waves.
 *
 * Extends server/domains/physics.js with deeper physics calculations.
 * All functions are pure: they take parameters and return a structured
 * result of the form { value, unit, formula, inputs } (plus extras for
 * multi-valued outputs). Edge cases return { error, inputs } instead
 * of throwing, so the Oracle Engine can surface problems gracefully.
 *
 * No external dependencies — only the native Math object.
 */

// --------------------------------------------------------------------
// Shared helpers
// --------------------------------------------------------------------

const G_EARTH = 9.80665;          // m/s²
const R_GAS = 8.314462618;        // J/(mol·K)
const K_COULOMB = 8.9875517923e9; // N·m²/C²
const C_LIGHT = 299792458;        // m/s

function isNum(n) {
  return typeof n === "number" && Number.isFinite(n);
}

function err(message, inputs) {
  return { error: message, inputs };
}

function ok(value, unit, formula, inputs, extra = {}) {
  return { value, unit, formula, inputs, ...extra };
}

// --------------------------------------------------------------------
// Classical Mechanics
// --------------------------------------------------------------------

/**
 * Wind load against a flat area. Uses F = 0.5 · ρ · v² · Cd · A.
 * Imperial by default (mph, ft², slugs/ft³ air density).
 */
export function windLoad({ velocityMph, areaSqft, dragCoeff = 1.2, airDensity = 0.0765 }) {
  const inputs = { velocityMph, areaSqft, dragCoeff, airDensity };
  if (!isNum(velocityMph) || velocityMph < 0) return err("velocityMph must be non-negative", inputs);
  if (!isNum(areaSqft) || areaSqft <= 0) return err("areaSqft must be positive", inputs);

  // Convert air density lb/ft³ → slugs/ft³ (divide by g = 32.174)
  const rhoSlug = airDensity / 32.174;
  // Convert mph → ft/s
  const vFtS = velocityMph * 1.46667;

  const pressurePsf = 0.5 * rhoSlug * vFtS * vFtS * dragCoeff;
  const forcePounds = pressurePsf * areaSqft;

  return {
    value: forcePounds,
    unit: "lbf",
    formula: "F = 0.5 · ρ · v² · Cd · A",
    inputs,
    pressurePsf,
    velocityFtPerSec: vFtS,
  };
}

/**
 * Moment of inertia for simple shapes. Returns result in the unit
 * system implied by the inputs (caller must stay consistent).
 */
export function momentOfInertia(shape, params = {}) {
  const inputs = { shape, ...params };
  if (typeof shape !== "string") return err("shape must be a string", inputs);

  switch (shape.toLowerCase()) {
    case "rectangle": {
      // I = (b · h³) / 12 about centroidal axis parallel to base b
      const { base, height } = params;
      if (!isNum(base) || !isNum(height)) return err("rectangle needs base, height", inputs);
      return ok((base * Math.pow(height, 3)) / 12, "length⁴", "I = b·h³/12", inputs);
    }
    case "circle": {
      // I = π·r⁴ / 4 (solid circle centroidal)
      const { radius } = params;
      if (!isNum(radius)) return err("circle needs radius", inputs);
      return ok((Math.PI * Math.pow(radius, 4)) / 4, "length⁴", "I = π·r⁴/4", inputs);
    }
    case "hollow_cylinder": {
      // I (area) = π(ro⁴ - ri⁴) / 4
      const { outerRadius, innerRadius } = params;
      if (!isNum(outerRadius) || !isNum(innerRadius)) return err("hollow_cylinder needs outerRadius, innerRadius", inputs);
      if (innerRadius >= outerRadius) return err("innerRadius must be less than outerRadius", inputs);
      const val = (Math.PI * (Math.pow(outerRadius, 4) - Math.pow(innerRadius, 4))) / 4;
      return ok(val, "length⁴", "I = π(ro⁴-ri⁴)/4", inputs);
    }
    case "sphere": {
      // Mass moment of inertia about diameter: I = (2/5)·m·r²
      const { mass, radius } = params;
      if (!isNum(mass) || !isNum(radius)) return err("sphere needs mass, radius", inputs);
      return ok((2 / 5) * mass * radius * radius, "mass·length²", "I = (2/5)·m·r²", inputs);
    }
    case "rhombus":
    case "diamond": {
      // Centroidal second moment of area of a rhombus (diamond) section
      // with diagonals `base` (b, in-plane width) and `height` (h,
      // perpendicular thickness), about the centroidal axis parallel to
      // the `base` diagonal: I = b·h³/48.
      //
      // Derivation: split the rhombus along its `base` diagonal (which
      // lies ON the neutral axis) into two congruent triangles, each with
      // base b and height h/2, one above the axis and one below. A
      // triangle's own centroidal second moment about an axis parallel to
      // its base is b·(h/2)³/36 = b·h³/288, and its centroid sits (h/2)/3
      // = h/6 from that base — i.e. from the rhombus's neutral axis. By
      // the parallel-axis theorem, this triangle's moment ABOUT the
      // neutral axis is b·h³/288 + A·d² where A = ½·b·(h/2) = b·h/4 and
      // d = h/6: b·h³/288 + (b·h/4)·(h²/36) = b·h³/288 + b·h³/144 =
      // b·h³/96. The two triangles are mirror images through the same
      // axis (equal contribution by symmetry), so the rhombus total is
      // 2·(b·h³/96) = b·h³/48 — the standard textbook rhombus-about-
      // centroidal-axis result, exactly 1/4 of the same b×h bounding-box
      // RECTANGLE's I = b·h³/12 (a rhombus has half the rectangle's area,
      // packed closer to the neutral axis).
      const { base, height } = params;
      if (!isNum(base) || !isNum(height)) return err("rhombus needs base, height", inputs);
      return ok((base * Math.pow(height, 3)) / 48, "length⁴", "I = b·h³/48", inputs);
    }
    default:
      return err(`unknown shape: ${shape}`, inputs);
  }
}

/**
 * Max deflection of a beam under a central point load (simple support)
 * or cantilever with end load. Imperial units (lbs, ft, psi, in⁴).
 */
export function beamDeflection({ loadLbs, lengthFt, modulusE, momentI, supportType = "simple" }) {
  const inputs = { loadLbs, lengthFt, modulusE, momentI, supportType };
  if (!isNum(loadLbs) || !isNum(lengthFt) || !isNum(modulusE) || !isNum(momentI)) {
    return err("loadLbs, lengthFt, modulusE, momentI must be numeric", inputs);
  }
  if (modulusE <= 0 || momentI <= 0 || lengthFt <= 0) return err("positive values required", inputs);

  const L = lengthFt * 12; // → inches
  let deltaIn;
  let formula;
  if (supportType === "simple") {
    // δ = P·L³ / (48·E·I)
    deltaIn = (loadLbs * Math.pow(L, 3)) / (48 * modulusE * momentI);
    formula = "δ = P·L³ / (48·E·I)";
  } else if (supportType === "cantilever") {
    // δ = P·L³ / (3·E·I)
    deltaIn = (loadLbs * Math.pow(L, 3)) / (3 * modulusE * momentI);
    formula = "δ = P·L³ / (3·E·I)";
  } else if (supportType === "fixed") {
    // Fixed-fixed with central load: δ = P·L³ / (192·E·I)
    deltaIn = (loadLbs * Math.pow(L, 3)) / (192 * modulusE * momentI);
    formula = "δ = P·L³ / (192·E·I)";
  } else {
    return err(`unknown supportType: ${supportType}`, inputs);
  }

  return ok(deltaIn, "in", formula, inputs);
}

export function shearStress({ forcePounds, areaSqin }) {
  const inputs = { forcePounds, areaSqin };
  if (!isNum(forcePounds) || !isNum(areaSqin) || areaSqin <= 0) {
    return err("forcePounds numeric, areaSqin > 0", inputs);
  }
  return ok(forcePounds / areaSqin, "psi", "τ = V/A", inputs);
}

export function bendingStress({ moment, momentI, distance }) {
  const inputs = { moment, momentI, distance };
  if (!isNum(moment) || !isNum(momentI) || !isNum(distance)) return err("numeric inputs required", inputs);
  if (momentI <= 0) return err("momentI must be positive", inputs);
  // σ = M·c / I
  return ok((moment * distance) / momentI, "stress", "σ = M·c/I", inputs);
}

// --------------------------------------------------------------------
// Thermodynamics
// --------------------------------------------------------------------

/**
 * Ideal gas law PV = nRT. Exactly one of { pressure, volume, moles,
 * temperatureK } may be null/undefined; the function solves for it.
 * SI units: Pa, m³, mol, K. R = 8.314.
 */
export function idealGasLaw({ pressure, volume, moles, temperatureK }) {
  const inputs = { pressure, volume, moles, temperatureK };
  const given = { pressure, volume, moles, temperatureK };
  const missing = Object.keys(given).filter(k => !isNum(given[k]));
  if (missing.length !== 1) return err(`need exactly 3 knowns, missing: ${missing.join(",") || "none"}`, inputs);

  let solved, unit, formula;
  if (missing[0] === "pressure") {
    solved = (moles * R_GAS * temperatureK) / volume;
    unit = "Pa";
    formula = "P = nRT/V";
  } else if (missing[0] === "volume") {
    solved = (moles * R_GAS * temperatureK) / pressure;
    unit = "m³";
    formula = "V = nRT/P";
  } else if (missing[0] === "moles") {
    solved = (pressure * volume) / (R_GAS * temperatureK);
    unit = "mol";
    formula = "n = PV/(RT)";
  } else {
    solved = (pressure * volume) / (moles * R_GAS);
    unit = "K";
    formula = "T = PV/(nR)";
  }
  return ok(solved, unit, formula, inputs, { solvedFor: missing[0] });
}

/** Q = m·c·ΔT */
export function heatTransfer({ mass, specificHeat, deltaTemp }) {
  const inputs = { mass, specificHeat, deltaTemp };
  if (!isNum(mass) || !isNum(specificHeat) || !isNum(deltaTemp)) return err("numeric inputs required", inputs);
  return ok(mass * specificHeat * deltaTemp, "J", "Q = m·c·ΔT", inputs);
}

/** Fourier conduction: Q = k·A·ΔT / L (watts). */
export function thermalConductivity({ k, area, deltaTemp, thickness }) {
  const inputs = { k, area, deltaTemp, thickness };
  if (!isNum(k) || !isNum(area) || !isNum(deltaTemp) || !isNum(thickness)) return err("numeric inputs required", inputs);
  if (thickness <= 0) return err("thickness must be positive", inputs);
  return ok((k * area * deltaTemp) / thickness, "W", "Q = k·A·ΔT/L", inputs);
}

/** Carnot efficiency η = 1 − Tc/Th. Temperatures in kelvin. */
export function carnotEfficiency({ hotK, coldK }) {
  const inputs = { hotK, coldK };
  if (!isNum(hotK) || !isNum(coldK)) return err("hotK, coldK numeric required", inputs);
  if (hotK <= 0 || coldK <= 0) return err("temperatures must be > 0 K", inputs);
  if (coldK >= hotK) return err("coldK must be less than hotK", inputs);
  const eta = 1 - coldK / hotK;
  return ok(eta, "fraction", "η = 1 − Tc/Th", inputs, { percent: eta * 100 });
}

// --------------------------------------------------------------------
// Electromagnetism
// --------------------------------------------------------------------

/** Solve V = IR for the missing of { voltage, current, resistance }. */
export function ohmsLaw({ voltage, current, resistance }) {
  const inputs = { voltage, current, resistance };
  const given = { voltage, current, resistance };
  const missing = Object.keys(given).filter(k => !isNum(given[k]));
  if (missing.length !== 1) return err(`need exactly 2 knowns, missing: ${missing.join(",") || "none"}`, inputs);
  if (missing[0] === "voltage") return ok(current * resistance, "V", "V = I·R", inputs, { solvedFor: "voltage" });
  if (missing[0] === "current") {
    if (resistance === 0) return err("resistance is zero", inputs);
    return ok(voltage / resistance, "A", "I = V/R", inputs, { solvedFor: "current" });
  }
  if (current === 0) return err("current is zero", inputs);
  return ok(voltage / current, "Ω", "R = V/I", inputs, { solvedFor: "resistance" });
}

/**
 * Electrical power. Accepts any two of (voltage, current, resistance)
 * and returns P with the corresponding formula.
 */
export function power({ voltage, current, resistance }) {
  const inputs = { voltage, current, resistance };
  if (isNum(voltage) && isNum(current)) return ok(voltage * current, "W", "P = V·I", inputs);
  if (isNum(current) && isNum(resistance)) return ok(current * current * resistance, "W", "P = I²·R", inputs);
  if (isNum(voltage) && isNum(resistance)) {
    if (resistance === 0) return err("resistance is zero", inputs);
    return ok((voltage * voltage) / resistance, "W", "P = V²/R", inputs);
  }
  return err("need at least two of voltage, current, resistance", inputs);
}

/** Coulomb's law F = k·q1·q2/r² (SI: newtons, coulombs, meters). */
export function coulombForce({ q1, q2, distance }) {
  const inputs = { q1, q2, distance };
  if (!isNum(q1) || !isNum(q2) || !isNum(distance)) return err("numeric inputs required", inputs);
  if (distance <= 0) return err("distance must be > 0", inputs);
  const f = (K_COULOMB * q1 * q2) / (distance * distance);
  return ok(f, "N", "F = k·q1·q2/r²", inputs, { attractive: f < 0 });
}

/** Capacitor stored energy U = 0.5·C·V² (joules). */
export function capacitorEnergy({ capacitance, voltage }) {
  const inputs = { capacitance, voltage };
  if (!isNum(capacitance) || !isNum(voltage)) return err("numeric inputs required", inputs);
  if (capacitance < 0) return err("capacitance must be non-negative", inputs);
  return ok(0.5 * capacitance * voltage * voltage, "J", "U = ½·C·V²", inputs);
}

// --------------------------------------------------------------------
// Fluid Dynamics
// --------------------------------------------------------------------

/**
 * Bernoulli equation check. Given both states, returns the residual
 * between the two sides (should be ~0 for an ideal incompressible
 * flow). Useful for solving unknowns iteratively.
 */
export function bernoulliEquation({
  pressure1, velocity1, height1,
  pressure2, velocity2, height2,
  density = 1000,
}) {
  const inputs = { pressure1, velocity1, height1, pressure2, velocity2, height2, density };
  const vals = [pressure1, velocity1, height1, pressure2, velocity2, height2, density];
  if (!vals.every(isNum)) return err("all inputs must be numeric", inputs);

  const g = G_EARTH;
  const side1 = pressure1 + 0.5 * density * velocity1 * velocity1 + density * g * height1;
  const side2 = pressure2 + 0.5 * density * velocity2 * velocity2 + density * g * height2;
  const residual = side1 - side2;

  return {
    value: residual,
    unit: "Pa",
    formula: "P + ½ρv² + ρgh = const",
    inputs,
    side1,
    side2,
    balanced: Math.abs(residual) < 1e-6 * Math.max(Math.abs(side1), 1),
  };
}

/** Reynolds number Re = ρ·v·L/μ. Dimensionless. */
export function reynoldsNumber({ velocity, length, density, viscosity }) {
  const inputs = { velocity, length, density, viscosity };
  if (!isNum(velocity) || !isNum(length) || !isNum(density) || !isNum(viscosity)) return err("numeric required", inputs);
  if (viscosity <= 0) return err("viscosity must be positive", inputs);
  const re = (density * velocity * length) / viscosity;
  let regime = "laminar";
  if (re > 4000) regime = "turbulent";
  else if (re > 2300) regime = "transitional";
  return ok(re, "dimensionless", "Re = ρvL/μ", inputs, { regime });
}

/**
 * Hagen–Poiseuille laminar pipe flow rate. Returns volumetric flow
 * in m³/s given diameter (m), length (m), pressure drop (Pa),
 * viscosity (Pa·s).
 */
export function pipeFlow({ diameter, lengthM, pressureDropPa, viscosity }) {
  const inputs = { diameter, lengthM, pressureDropPa, viscosity };
  if (!isNum(diameter) || !isNum(lengthM) || !isNum(pressureDropPa) || !isNum(viscosity)) return err("numeric required", inputs);
  if (diameter <= 0 || lengthM <= 0 || viscosity <= 0) return err("positive required", inputs);
  const r = diameter / 2;
  const q = (Math.PI * Math.pow(r, 4) * pressureDropPa) / (8 * viscosity * lengthM);
  return ok(q, "m³/s", "Q = πr⁴ΔP/(8μL)", inputs);
}

/** Drag force F = 0.5·ρ·v²·Cd·A. */
export function dragForce({ velocity, area, dragCoeff, density }) {
  const inputs = { velocity, area, dragCoeff, density };
  if (!isNum(velocity) || !isNum(area) || !isNum(dragCoeff) || !isNum(density)) return err("numeric required", inputs);
  if (area < 0 || density < 0) return err("area, density must be non-negative", inputs);
  return ok(0.5 * density * velocity * velocity * dragCoeff * area, "N", "F = ½ρv²CdA", inputs);
}

// --------------------------------------------------------------------
// Wave Physics
// --------------------------------------------------------------------

/** λ = v/f (meters if inputs SI). */
export function wavelength({ frequency, waveSpeed }) {
  const inputs = { frequency, waveSpeed };
  if (!isNum(frequency) || !isNum(waveSpeed)) return err("numeric required", inputs);
  if (frequency <= 0) return err("frequency must be positive", inputs);
  return ok(waveSpeed / frequency, "m", "λ = v/f", inputs);
}

/**
 * Doppler effect for a moving source and observer in a medium.
 * f' = f · (v + vo) / (v − vs). Positive vo means observer moves
 * toward source, positive vs means source moves toward observer.
 */
export function dopplerEffect({ sourceFreq, sourceVel, observerVel, waveSpeed }) {
  const inputs = { sourceFreq, sourceVel, observerVel, waveSpeed };
  if (![sourceFreq, sourceVel, observerVel, waveSpeed].every(isNum)) return err("numeric required", inputs);
  if (waveSpeed <= 0) return err("waveSpeed must be > 0", inputs);
  if (waveSpeed - sourceVel === 0) return err("source velocity equals wave speed (shock)", inputs);
  const observed = sourceFreq * ((waveSpeed + observerVel) / (waveSpeed - sourceVel));
  return ok(observed, "Hz", "f' = f·(v+vo)/(v−vs)", inputs, { shiftHz: observed - sourceFreq });
}

// --------------------------------------------------------------------
// Default export — registry of all functions for Oracle introspection
// --------------------------------------------------------------------

export default {
  windLoad,
  momentOfInertia,
  beamDeflection,
  shearStress,
  bendingStress,
  idealGasLaw,
  heatTransfer,
  thermalConductivity,
  carnotEfficiency,
  ohmsLaw,
  power,
  coulombForce,
  capacitorEnergy,
  bernoulliEquation,
  reynoldsNumber,
  pipeFlow,
  dragForce,
  wavelength,
  dopplerEffect,
  constants: { G_EARTH, R_GAS, K_COULOMB, C_LIGHT },
};
