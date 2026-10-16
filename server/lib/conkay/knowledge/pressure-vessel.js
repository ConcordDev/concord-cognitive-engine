// server/lib/conkay/knowledge/pressure-vessel.js
//
// Blend D brief item 9: a pressure chamber's wall stresses, burst margin and a
// crash screen. SI units, no defaults.
//
//   thin wall (t/r ≤ 0.1): σθ = p·r/t, σz = p·r/(2t) (closed ends)
//   thick wall (Lamé, internal pressure p, radii a < b):
//     σθ(r) = p a²/(b² − a²) · (1 + b²/r²),  σr(r) = p a²/(b² − a²) · (1 − b²/r²),  σz = p a²/(b² − a²)
//   burst (hoop stress at the bore reaching the wall strength S): p_b = S (b² − a²)/(b² + a²)
//   Requirement (UN Regulation No. 134, 02 series, Amend. 3, 2024, §5.1.1): burst ≥ BPmin = 200 % NWP;
//   containers with glass-fibre composite as the primary constituent > 350 % NWP.
// Roark and ASME VIII were not read (not open); the checks are Lamé's exact identities and the thin-wall limit.

const finitePos = (v) => Number.isFinite(v) && v > 0;
function need(c, m) { if (!c) throw new RangeError(m); }

export const THIN_WALL_LIMIT = 0.1;

export function thinWall({ p, r, t }) {
  need([p, r, t].every(finitePos), "p, r, t > 0");
  return { hoop: (p * r) / t, axial: (p * r) / (2 * t) };
}

export function lame({ p, a, b }, r = a) {
  need([p, a, b, r].every(finitePos) && b > a, "p > 0 and 0 < a < b");
  need(r >= a - 1e-15 && r <= b + 1e-15, "a ≤ r ≤ b");
  const k = (p * a * a) / (b * b - a * a);
  return { hoop: k * (1 + (b * b) / (r * r)), radial: k * (1 - (b * b) / (r * r)), axial: k };
}

/** Wall stresses at the bore, by the thin-wall formula when t/r ≤ 0.1 (mean radius), else Lamé. */
export function wallStress({ p, innerRadius, thickness }) {
  need([p, innerRadius, thickness].every(finitePos), "p, inner radius, thickness > 0");
  const ratio = thickness / innerRadius;
  if (ratio <= THIN_WALL_LIMIT) {
    const s = thinWall({ p, r: innerRadius + thickness / 2, t: thickness });
    return { method: "thin wall (t/r ≤ 0.1, mean radius)", ratio, hoop: s.hoop, axial: s.axial, radial: -p };
  }
  const s = lame({ p, a: innerRadius, b: innerRadius + thickness });
  return { method: "Lamé thick wall (t/r > 0.1)", ratio, hoop: s.hoop, axial: s.axial, radial: s.radial };
}

export function burstPressure({ strength, innerRadius, thickness }) {
  need([strength, innerRadius, thickness].every(finitePos), "strength, inner radius, thickness > 0");
  const a = innerRadius, b = innerRadius + thickness;
  return (strength * (b * b - a * a)) / (b * b + a * a);
}

/** UN R134 minimum burst ratio (× NWP). */
export function requiredBurstRatio({ glassFibrePrimary = false } = {}) {
  return glassFibrePrimary ? 3.5 : 2.0;
}

/** Wall thickness at which Lamé burst reaches ratio × NWP (closed form), or Infinity when S ≤ ratio × NWP. */
export function thicknessForBurst({ strength, innerRadius, nwp, ratio }) {
  need([strength, innerRadius, nwp, ratio].every(finitePos), "inputs > 0");
  const q = (ratio * nwp) / strength;
  if (q >= 1) return Infinity;
  return innerRadius * (Math.sqrt((1 + q) / (1 - q)) - 1);
}

/** Uniform strain-energy screen: mean strain = √(2U/(E·V)). Screening only: real crush is local and non-uniform. */
export function crashStrain({ energyJ, modulusPa, wallVolumeM3 }) {
  need([energyJ, modulusPa, wallVolumeM3].every(finitePos), "energy, modulus, wall volume > 0");
  return Math.sqrt((2 * energyJ) / (modulusPa * wallVolumeM3));
}

export const R134_BURST = Object.freeze({
  minRatio: 2.0, glassFibreRatio: 3.5, spread: 0.1,
  source: "UN Regulation No. 134 (02 series, Amend. 3, 27 Sept 2024, E/ECE/324/Rev.2/Add.133/Rev.1/Amend.3), §5.1.1: 'burst pressure within ±10 per cent of BPO and greater than or equal to a minimum BPmin of 200 per cent NWP. Containers having glass-fibre composite as a primary constituent shall have a minimum burst pressure greater than 350 per cent NWP.'",
});

/** Append a pressure-chamber node to any design IR (vehicle, Sentinel, …). */
export function withPressureVessel(ir, { id = "H2_CHAMBER", name = "Pressure chamber", material, innerRadiusM, wallThicknessM, lengthM, nwpPa, ...rest }) {
  need(finitePos(innerRadiusM) && finitePos(wallThicknessM) && finitePos(lengthM), "chamber radius, wall and length > 0");
  return {
    ...ir,
    nodes: [...ir.nodes, {
      id, kind: "Part", name, ...(material ? { material } : {}),
      geometry: { shape: "cylinder", diameter: `${2 * (innerRadiusM + wallThicknessM)} m`, length: `${lengthM} m` },
      props: { pressureVessel: { innerRadiusM, wallThicknessM, lengthM, nwpPa, ...rest } },
    }],
  };
}
