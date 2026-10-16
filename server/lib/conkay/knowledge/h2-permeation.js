// server/lib/conkay/knowledge/h2-permeation.js
//
// Blend D brief item 6: hydrogen permeation screening. SI-ish units as the
// sources print them: permeability P in cm³(STP)·cm/(cm²·s·Pa).
//
//   flux through a wall: Q = P · A · Δp / L           [cm³(STP)/s]
//   time lag:            D = l² / (6 θ)                (Dong et al. 2023, eq. 2)
//   solubility:          S = P / D
//   temperature:         P(T) = P(Tref) · exp(−(Ep/R)(1/T − 1/Tref))
//   platelet barrier:    P_c / P_m = (1 − φ) / τ,  τ = 1 + (α/2) φ   (Nielsen; as stated by
//                        Merlonghi et al., Membranes 2025, 15(3), 76, eq. 12) — perfectly aligned,
//                        impermeable, overlapping platelets: an upper bound on the barrier.

const R = 8.314462618;
const finitePos = (v) => Number.isFinite(v) && v > 0;
function need(c, m) { if (!c) throw new RangeError(m); }

export function timeLagDiffusivity({ thicknessCm, lagS }) {
  need(finitePos(thicknessCm) && finitePos(lagS), "thickness and lag time > 0");
  return thicknessCm ** 2 / (6 * lagS);
}

export function arrheniusPermeability({ P, Tref, Ep }, T) {
  need(finitePos(P) && finitePos(Tref) && finitePos(T), "P, Tref, T > 0");
  need(Number.isFinite(Ep) && Ep >= 0, "Ep ≥ 0 (J/mol)");
  return P * Math.exp(-(Ep / R) * (1 / T - 1 / Tref));
}

/** Ep (J/mol) from two (T, P) points. */
export function activationEnergy([T1, P1], [T2, P2]) {
  need([T1, P1, T2, P2].every(finitePos) && T1 !== T2, "two distinct positive (T, P) points");
  return (R * Math.log(P2 / P1)) / (1 / T1 - 1 / T2);
}

export function nielsenRatio({ phi, aspect }) {
  need(Number.isFinite(phi) && phi >= 0 && phi < 1, "0 ≤ φ < 1");
  need(finitePos(aspect), "aspect ratio > 0");
  return (1 - phi) / (1 + (aspect / 2) * phi);
}

/** Steady permeation through a liner wall, NmL/h (cm³ at standard conditions per hour). */
export function wallLeakRate({ P, areaCm2, deltaPPa, thicknessCm }) {
  need([P, areaCm2, deltaPPa, thicknessCm].every(finitePos), "P, area, Δp, thickness > 0");
  return ((P * areaCm2 * deltaPPa) / thicknessCm) * 3600;
}

/**
 * Measured H2 permeation (Dong, Liu, Li, et al., "Hydrogen Permeability of Polyamide 6 Used as Liner Material for
 * Type IV On-Board Hydrogen Storage Cylinders", Polymers 2023, 15(18), 3715, doi:10.3390/polym15183715, Table 4:
 * 288 K, 70 MPa). Units cm³·cm/(cm²·s·Pa); D cm²/s.
 */
export const DONG_2023_TABLE4 = Object.freeze({
  conditions: { T: 288, pressurePa: 70e6 },
  HDPE: { P: 5.88e-14, D: 9.73e-7, S: 6.05e-8 },
  PA6: { P: 1.72e-14, D: 2.19e-7, S: 7.85e-8 },
  PA11: { P: 1.87e-14, D: 2.43e-7, S: 7.71e-8 },
});

/**
 * Limits as quoted by Li, Huang, Liu, Zhao, Li, "Review of the Hydrogen Permeation Test of the Polymer Liner Material
 * of Type IV On-Board Hydrogen Storage Cylinders", Materials 2023, 16(15), 5366, doi:10.3390/ma16155366:
 * ISO 19881 (cylinder, §1 ¶2): < 46 NmL/(h·L) at 1.15 NWP and 55 °C; < 6 NmL/(h·L) at NWP and 15 °C.
 * T/CATSI 02 007 (liner material, Table 5): P ≤ 1 × 10⁻¹³ at 15 °C; ≤ 1 × 10⁻¹² at 55 °C.
 */
export const H2_LIMITS = Object.freeze({
  iso19881: Object.freeze([
    { label: "NWP, 15 °C", T: 288.15, pressureFactor: 1.0, limitNmLPerHPerL: 6 },
    { label: "1.15 NWP, 55 °C", T: 328.15, pressureFactor: 1.15, limitNmLPerHPerL: 46 },
  ]),
  tcatsi: Object.freeze([
    { label: "15 °C", T: 288.15, limitP: 1e-13 },
    { label: "55 °C", T: 328.15, limitP: 1e-12 },
  ]),
  source: "Li et al., Materials 2023, 16(15), 5366: ISO 19881 limits (§1 ¶2, citing the standard) and T/CATSI 02 007 material limits (Table 5)",
});

export const TYPE_IV_NOTE = "A polymer chamber does not hold compressed hydrogen on its own: a Type IV cylinder is a polymer liner (the permeation barrier) inside a carbon-fibre composite overwrap that carries the pressure (Li et al. 2023 §1). A monolithic HDPE-blend chamber would need both a liner function and an overwrap; its burst and permeation are vessel-level tests (ISO 19881 / SAE J2579).";
