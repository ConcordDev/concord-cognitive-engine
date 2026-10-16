// server/lib/conkay/knowledge/multiphase-conduction.js
//
// Effective thermal conductivity of an N-phase composite (any recipe):
//
// 1. Wiener bounds — parallel Σφ_i k_i (upper) and series 1/Σ(φ_i/k_i) (lower); Chaudhry et al. 2020 eqs. 7–8.
// 2. Hashin–Shtrikman bounds for a statistically isotropic mixture of isotropic phases:
//      k± = [Σ φ_i/(k_i + 2k₀)]⁻¹ − 2k₀,   k₀ = k_max (upper) or k_min (lower).
//    Both rise with every k_i, so a k interval maps exactly (upper at all highs, lower at all lows). For two
//    phases with the matrix the less conductive, the lower bound IS Maxwell's sphere formula (tests).
// 3. Mean-field estimate for randomly oriented spheroids in one matrix (the conduction analogue of the
//    multi-phase Mori–Tanaka; Nan's effective-medium form): each inclusion, with conductivity k₁₁ across its
//    symmetry axis and k₃₃ along it, has field concentration T_jj = k_m / (k_m + L_jj (k_e,jj − k_m)) along
//    its axes; random orientation averages the trace. With matrix fraction f_m,
//      k* = [f_m k_m + Σ φ_r ⟨k_e T⟩_r] / [f_m + Σ φ_r ⟨T⟩_r],  ⟨X⟩ = (2X₁₁ + X₃₃)/3.
//    Depolarization factors L (Akhtar et al. 2021 eq. 10); the interface (Kapitza) resistance enters as
//    k_e = k_p / (1 + γ L k_p / k_m), γ = (2 + 1/ξ) α (ξ ≥ 1) or (1 + 2ξ) α (ξ < 1), α = k_m R / a
//    (eqs. 9, 11 — the platelet's in-plane k_e uses L₃₃, as printed). In the dilute limit this reduces to the
//    paper's eq. 2 with ⟨cos²θ⟩ = 1/3.

export function wiener(phases) {
  check(phases);
  return { upper: phases.reduce((a, p) => a + p.phi * p.k.hi, 0), lower: 1 / phases.reduce((a, p) => a + p.phi / p.k.lo, 0) };
}

function check(phases) {
  const s = phases.reduce((a, p) => a + p.phi, 0);
  if (!phases.length || phases.some((p) => !(p.phi >= 0)) || Math.abs(s - 1) > 1e-9) throw new RangeError(`volume fractions must be ≥ 0 and sum to 1 (got ${s})`);
  for (const p of phases) if (!(p.k?.lo >= 0 && p.k.hi >= p.k.lo)) throw new RangeError("each phase needs a k interval 0 ≤ lo ≤ hi");
}

const hsAt = (phases, ks, k0) => 1 / phases.reduce((a, p, i) => a + p.phi / (ks[i] + 2 * k0), 0) - 2 * k0;

/** HS bounds; a phase k of 0 is allowed (a lower bound with an unknown conductivity taken as 0 is still rigorous). */
export function hashinShtrikmanK(phases) {
  check(phases);
  const hi = phases.map((p) => p.k.hi), lo = phases.map((p) => p.k.lo);
  return { upper: hsAt(phases, hi, Math.max(...hi)), lower: hsAt(phases, lo, Math.min(...lo)) };
}

/** Depolarization factors of a spheroid, aspect ξ = r3/r1 (Akhtar 2021 eq. 10). L33 = 1 − 2 L11. */
export function depolarization(xi) {
  if (!(xi > 0) || !Number.isFinite(xi)) throw new RangeError("aspect ratio must be a positive number");
  if (Math.abs(xi - 1) < 1e-6) return { L11: 1 / 3, L33: 1 / 3 };
  const x2 = xi * xi;
  const L11 = xi > 1
    ? x2 / (2 * (x2 - 1)) - (xi / (2 * Math.pow(x2 - 1, 1.5))) * Math.acosh(xi)
    : x2 / (2 * (x2 - 1)) + (xi / (2 * Math.pow(1 - x2, 1.5))) * Math.acos(xi);
  return { L11, L33: 1 - 2 * L11 };
}

/** Equivalent conductivities with an interface resistance (eq. 9, 11); R = 0 → k_e = k_p. */
function equivalent({ k11, k33, aspect, R = 0, a11, a33 }, km, L) {
  if (!R) return { e11: k11, e33: k33 };
  const g = (alpha) => (aspect >= 1 ? (2 + 1 / aspect) * alpha : (1 + 2 * aspect) * alpha);
  const platelet = aspect < 1, cyl = aspect > 1;
  const e11 = k11 / (1 + g((km * R) / a11) * (platelet ? L.L33 : L.L11) * (k11 / km));
  const e33 = k33 / (1 + g((km * R) / a33) * (cyl ? L.L11 : L.L33) * (k33 / km));
  return { e11, e33 };
}

/**
 * Random-spheroid mean-field estimate. matrix: k_m (point). inclusions: [{ phi, k11, k33, aspect, R?, a11?, a33? }].
 */
export function randomSpheroidsK(km, inclusions) {
  if (!(km > 0)) throw new RangeError("matrix k must be > 0");
  const fm = 1 - inclusions.reduce((a, p) => a + p.phi, 0);
  if (!(fm > 0) || inclusions.some((p) => !(p.phi >= 0 && p.k11 >= 0 && p.k33 >= 0))) throw new RangeError("fractions must be ≥ 0 and sum below 1; conductivities ≥ 0");
  let num = fm * km, den = fm;
  for (const p of inclusions) {
    const L = depolarization(p.aspect), { e11, e33 } = equivalent(p, km, L);
    const T11 = km / (km + L.L11 * (e11 - km)), T33 = km / (km + L.L33 * (e33 - km));
    num += (p.phi * (2 * e11 * T11 + e33 * T33)) / 3;
    den += (p.phi * (2 * T11 + T33)) / 3;
  }
  return num / den;
}

/** Extremes over the corners of every interval (k11, k33, aspect, matrix k). Exact where monotone. */
export function randomSpheroidsKBand(km, inclusions) {
  const pick = (iv) => (iv.lo === iv.hi ? [iv.lo] : [iv.lo, iv.hi]);
  const dims = [pick(km), ...inclusions.flatMap((p) => [pick(p.k11), pick(p.k33), pick(p.aspect)])];
  const total = dims.reduce((a, d) => a * d.length, 1);
  if (total > 1 << 18) throw new RangeError("too many interval corners");
  let lo = Infinity, hi = -Infinity;
  for (let m = 0; m < total; m++) {
    let r = m;
    const v = dims.map((d) => { const x = d[r % d.length]; r = Math.floor(r / d.length); return x; });
    const k = randomSpheroidsK(v[0], inclusions.map((p, i) => ({ phi: p.phi, k11: v[1 + 3 * i], k33: v[2 + 3 * i], aspect: v[3 + 3 * i], R: p.R, a11: p.a11, a33: p.a33 })));
    lo = Math.min(lo, k); hi = Math.max(hi, k);
  }
  return { low: lo, high: hi, corners: total };
}
