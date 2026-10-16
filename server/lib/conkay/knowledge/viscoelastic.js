// server/lib/conkay/knowledge/viscoelastic.js
//
// Blend D brief item 5: linear viscoelastic SCREENING with a Prony series
// (generalized Maxwell / Wiechert model), SI units, no defaults.
//
//   E(t) = E∞ + Σ E_q exp(−t/(a_T τ_q))
//   constant strain rate ε̇ from rest:
//     σ(t) = ε̇ [E∞ t + Σ E_q a_T τ_q (1 − exp(−t/(a_T τ_q)))]
//   (Pacheco, Bavastri, Pereira, Lat. Am. J. Solids Struct. 2015, 12, 420, eqs. 11–14)
//   sinusoid ε = ε0 sin ωt: E′ = E∞ + Σ E_q ω²τ²/(1 + ω²τ²), E″ = Σ E_q ωτ/(1 + ω²τ²),
//     energy dissipated per cycle π ε0² E″, peak stored energy ½ ε0² E′ (per unit volume).
//   Shift factors: WLF log10 a_T = −C1 (T − Ts)/(C2 + T − Ts) (eq. 12 of the same
//   paper); Arrhenius ln a_T = (Ea/R)(1/T − 1/Tref). Neither is supplied for HDPE
//   here: no HDPE α-relaxation activation energy was read, so another temperature
//   is NOT computed unless the caller gives the shift.

const R = 8.314462618;
const finitePos = (v) => Number.isFinite(v) && v > 0;
function need(c, m) { if (!c) throw new RangeError(m); }

function checkProny(p) {
  need(p && Number.isFinite(p.Einf) && p.Einf >= 0, "E∞ ≥ 0");
  need(Array.isArray(p.terms) && p.terms.length > 0, "at least one Prony term");
  for (const q of p.terms) { need(Number.isFinite(q.E) && q.E >= 0, "every E_q ≥ 0"); need(finitePos(q.tau), "every τ_q > 0"); }
}

export function relaxationModulus(p, t, aT = 1) {
  checkProny(p);
  need(Number.isFinite(t) && t >= 0, "t ≥ 0");
  need(finitePos(aT), "a_T > 0");
  return p.Einf + p.terms.reduce((s, q) => s + q.E * Math.exp(-t / (aT * q.tau)), 0);
}

export function constantRateStress(p, { rate, t, aT = 1 }) {
  checkProny(p);
  need(finitePos(rate), "strain rate > 0");
  need(Number.isFinite(t) && t >= 0, "t ≥ 0");
  return rate * (p.Einf * t + p.terms.reduce((s, q) => s + q.E * aT * q.tau * (1 - Math.exp(-t / (aT * q.tau))), 0));
}

export function dynamicModuli(p, omega, aT = 1) {
  checkProny(p);
  need(finitePos(omega), "ω > 0");
  let Es = p.Einf, El = 0;
  for (const q of p.terms) {
    const wt = omega * aT * q.tau;
    Es += (q.E * wt * wt) / (1 + wt * wt);
    El += (q.E * wt) / (1 + wt * wt);
  }
  return { storage: Es, loss: El, tanDelta: El / Es };
}

/** Energies per unit volume for ε = ε0 sin ωt (J/m³ for moduli in Pa). */
export function cycleEnergy(p, { strainAmplitude, omega, aT = 1 }) {
  need(finitePos(strainAmplitude), "strain amplitude > 0");
  const m = dynamicModuli(p, omega, aT);
  const dissipated = Math.PI * strainAmplitude ** 2 * m.loss;
  const stored = 0.5 * strainAmplitude ** 2 * m.storage;
  return { ...m, dissipatedPerCycle: dissipated, peakStored: stored, lossRatio: dissipated / (2 * Math.PI * stored) };
}

export function wlfShift({ C1, C2, Ts }, T) {
  need([C1, C2, Ts, T].every(Number.isFinite), "C1, C2, Ts, T finite");
  need(C2 + T - Ts > 0, "C2 + (T − Ts) must be > 0 (WLF singular)");
  return 10 ** ((-C1 * (T - Ts)) / (C2 + T - Ts));
}

export function arrheniusShift({ Ea, Tref }, T) {
  need(finitePos(Ea) && finitePos(Tref) && finitePos(T), "Ea, Tref, T > 0 (K)");
  return Math.exp((Ea / R) * (1 / T - 1 / Tref));
}

/**
 * HDPE two-term Prony (parallel Maxwell, no equilibrium term) from stress-relaxation steps of 1000 s at
 * 0.5 / 1 / 5 / 10 % strain: Segura-Méndez, Puente-Córdova, Rentería-Baltiérrez, et al., "Modeling of Stress
 * Relaxation Behavior in HDPE and PP Using Fractional Derivatives", Polymers 2025, 17(4), 453,
 * doi:10.3390/polym17040453, Table 6. Injection-moulded ASTM D638 Type I bars (commercial HDPE, CYPMA, México);
 * test temperature not stated. The modulus falls with strain (E(0) 613.9 → 208.1 MPa from 0.5 to 10 %), so
 * linearity is not shown even at the lowest strain tested; τ7 ≈ 5.9 × 10³ s lies beyond the 1000 s steps.
 */
export const HDPE_PRONY_SEGURA_2025 = Object.freeze({
  source: "Segura-Méndez et al., Polymers 2025, 17(4), 453, Table 6 (parallel Maxwell, HDPE)",
  stepDurationS: 1000,
  temperature: "not stated (ambient)",
  sets: Object.freeze([
    { strain: 0.005, Einf: 0, terms: [{ E: 170.4e6, tau: 57.8 }, { E: 443.5e6, tau: 5941.77 }], R2: 0.9925 },
    { strain: 0.01, Einf: 0, terms: [{ E: 132.2e6, tau: 48.008 }, { E: 387.5e6, tau: 5733.90 }], R2: 0.9778 },
    { strain: 0.05, Einf: 0, terms: [{ E: 89.71e6, tau: 69.93 }, { E: 209.8e6, tau: 6119.95 }], R2: 0.99 },
    { strain: 0.1, Einf: 0, terms: [{ E: 67.27e6, tau: 48.1 }, { E: 140.8e6, tau: 5945.3 }], R2: 0.9836 },
  ]),
});

/** The lowest tested strain: the largest strain at which the series is used as linear (linearity itself not shown). */
export const HDPE_LINEAR_STRAIN_LIMIT = 0.005;
/** HDPE tensile strain at yield, 10 % (ExxonMobil HMA 016, ISO 527-2; LyondellBasell Alathon H6011). */
export const HDPE_YIELD_STRAIN = 0.1;
