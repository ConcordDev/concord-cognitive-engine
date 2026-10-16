// server/lib/conkay/knowledge/basis-discrimination.js
//
// A formulation that gives percentages without saying "by mass" or "by volume"
// (USB Blend D) cannot be read either way from its own text. This module predicts
// what each reading implies for a moulded batch — density and inorganic ash
// residue — exactly over the composition ranges, so one measurement decides.
//
//   composition: every x with lo_i ≤ x_i ≤ hi_i and Σx = 100. Density and residue
//   are linear or linear-fractional in x, so their extremes are at the vertices of
//   that polytope (at most one coordinate off its bounds): enumerated exactly.
//   densities: each constituent's cited interval; extremes over the density box
//   are found by enumerating its corners (64 for six constituents).
//   mass basis:   1/ρ = Σ w_i/ρ_i;  residue = Σ_res w_i·f_i
//   volume basis: ρ = Σ φ_i ρ_i;    residue = Σ_res φ_i ρ_i f_i / Σ φ_j ρ_j
// f_i is the fraction of a constituent's mass left after ashing: 1 for basalt and
// silica (assumed: their loss on ignition is not read), CaCO3 → CaO at
// M(CaO)/M(CaCO3) when the ashing temperature decomposes it, graphene 0 or 1
// (whether it burns at the ashing temperature is unknown). The residue band
// brackets those unknowns.

const AW = Object.freeze({ Ca: 40.078, C: 12.011, O: 15.999, source: "CIAAW abridged standard atomic weights (ciaaw.org/abridged-atomic-weights.htm): Ca 40.078 ± 0.004, C 12.011 ± 0.002, O 15.999 ± 0.001" });
export const M_CACO3 = AW.Ca + AW.C + 3 * AW.O;
export const M_CAO = AW.Ca + AW.O;
export const CAO_FROM_CACO3 = M_CAO / M_CACO3;
export const ATOMIC_WEIGHTS = AW;

/** Every vertex of { lo ≤ x ≤ hi, Σx = 100 } (percent). */
export function compositionVertices(ranges) {
  const n = ranges.length;
  if (!n || ranges.some((r) => !(Number.isFinite(r.min) && Number.isFinite(r.max) && r.min <= r.max))) throw new RangeError("ranges must be {min ≤ max}");
  if (n > 16) throw new RangeError("too many constituents to enumerate");
  const out = [];
  for (let f = 0; f < n; f++) {
    for (let m = 0; m < 1 << (n - 1); m++) {
      const x = new Array(n);
      let s = 0, b = 0;
      for (let i = 0; i < n; i++) {
        if (i === f) continue;
        x[i] = (m >> b) & 1 ? ranges[i].max : ranges[i].min;
        s += x[i]; b++;
      }
      x[f] = 100 - s;
      if (x[f] >= ranges[f].min - 1e-9 && x[f] <= ranges[f].max + 1e-9) out.push(x);
    }
  }
  return out;
}

function densityCorners(dens) {
  const n = dens.length, out = [];
  const free = dens.map((d, i) => (d.lo === d.hi ? -1 : i)).filter((i) => i >= 0);
  if (free.length > 12) throw new RangeError("too many density intervals to enumerate");
  for (let m = 0; m < 1 << free.length; m++) {
    const r = dens.map((d) => d.lo);
    free.forEach((i, b) => { r[i] = (m >> b) & 1 ? dens[i].hi : dens[i].lo; });
    out.push(r);
  }
  return n ? out : [];
}

const band = (vals) => ({ low: Math.min(...vals), high: Math.max(...vals) });

/**
 * Density band (kg/m³, no voids) for one basis. dens: [{lo, hi}] or null entries (→ missing).
 */
export function densityBand(ranges, dens, basis) {
  const missing = dens.map((d, i) => (d ? null : i)).filter((i) => i != null);
  if (missing.length) return { computed: false, missing };
  const V = compositionVertices(ranges), C = densityCorners(dens), vals = [];
  if (!V.length) return { computed: false, infeasible: true };
  for (const x of V) for (const r of C) vals.push(basis === "mass" ? 100 / x.reduce((a, w, i) => a + w / r[i], 0) : x.reduce((a, p, i) => a + (p / 100) * r[i], 0));
  return { computed: true, ...band(vals) };
}

/**
 * Ash residue band (% of the compound's mass). keep[i]: [fLow, fHigh] retained mass fraction per constituent.
 * Mass basis needs no densities. Volume basis needs every density.
 */
export function residueBand(ranges, dens, basis, keep) {
  const V = compositionVertices(ranges), vals = [];
  if (!V.length) return { computed: false, infeasible: true };
  for (const which of [0, 1]) {
    const f = keep.map((k) => k[which]);
    if (basis === "mass") { for (const x of V) vals.push(x.reduce((a, w, i) => a + w * f[i], 0)); continue; }
    const missing = dens.map((d, i) => (d ? null : i)).filter((i) => i != null);
    if (missing.length) return { computed: false, missing };
    const C = densityCorners(dens);
    for (const x of V) {
      for (const r of C) {
        const den = x.reduce((a, p, i) => a + p * r[i], 0);
        vals.push((100 * x.reduce((a, p, i) => a + p * r[i] * f[i], 0)) / den);
      }
    }
  }
  return { computed: true, ...band(vals) };
}

/** Retained mass fraction bracket per constituent class after ashing (see header). */
export function ashRetention(classId) {
  switch (classId) {
    case "basalt_fiber": case "silica": return { keep: [1, 1], basis: "assumed retained (loss on ignition not read)" };
    case "caco3": return { keep: [CAO_FROM_CACO3, 1], basis: `CaCO3 → CaO + CO2 if the ashing temperature decomposes it: M(CaO)/M(CaCO3) = ${CAO_FROM_CACO3.toFixed(5)} (${AW.source})` };
    case "graphene": return { keep: [0, 1], basis: "unknown whether graphene burns off at the ashing temperature: 0 to 1" };
    default: return { keep: [0, 0], basis: "organic: burns off" };
  }
}

/** The two readings' predictions and whether a measurement separates them. */
export function discriminateBasis(constituents) {
  const ranges = constituents.map((c) => c.fraction);
  const dens = constituents.map((c) => (c.properties?.density ? { lo: c.properties.density.lo, hi: c.properties.density.hi } : null));
  const keep = constituents.map((c) => ashRetention(c.classId).keep);
  const out = {};
  for (const basis of ["mass", "volume"]) out[basis] = { density: densityBand(ranges, dens, basis), residue: residueBand(ranges, dens, basis, keep) };
  const sep = (a, b) => {
    if (!a.computed || !b.computed) return { decides: null, reason: a.infeasible || b.infeasible ? "not computed: the ranges cannot sum to 100 %" : "not computed: a density is missing" };
    const overlap = a.low <= b.high && b.low <= a.high;
    return { decides: !overlap, gap: overlap ? 0 : Math.max(b.low - a.high, a.low - b.high) };
  };
  const density = sep(out.mass.density, out.volume.density);
  if (density.decides && out.mass.density.high < out.volume.density.low) {
    density.voidFractionToBlur = 1 - out.mass.density.high / out.volume.density.low;
    density.note = `voids lower a measured density: a volume-basis batch with ≥ ${(100 * density.voidFractionToBlur).toFixed(2)} % voids would read inside the mass-basis band, so density alone decides only with a void measurement`;
  }
  const residue = sep(out.mass.residue, out.volume.residue);
  return { ...out, separation: { density, residue }, retention: constituents.map((c) => ({ id: c.id, ...ashRetention(c.classId) })) };
}
