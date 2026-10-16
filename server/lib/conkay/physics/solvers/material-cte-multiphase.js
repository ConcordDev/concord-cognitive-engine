// server/lib/conkay/physics/solvers/material-cte-multiphase.js
//
// material.cte-multiphase on a formulated Material node (any recipe, any number of constituents):
//   Turner (uniform strain) — needs E, ν, α of every phase; and the thermoelastic Mori–Tanaka estimate with
//   randomly oriented spheroids — also needs every inclusion's shape (props.micromechanics.phases.<id>.aspectRatio,
//   or derived from a sourced thickness and lateral size).
// An anisotropic phase's expansion enters over its directional interval (graphene: in-plane to through-plane);
// both estimates rise with every phase α (positive weights), so that interval maps exactly. The K intervals do
// not map monotonically: extremes over the corners.

import { registerSolver } from "../registry.js";
import { setup, blocked, formulated, span, modulusOf } from "./material-stiffness.js";
import { kgFromENu, turnerCte, moriTanakaRandomCte } from "../../knowledge/multiphase-elasticity.js";

function alphaOf(c) {
  const p = c.properties;
  if (p.cte) return { ...span(p.cte), basis: "cited CTE" };
  if (p.cteInPlane && p.cteThroughPlane) return { lo: Math.min(span(p.cteInPlane).lo, span(p.cteThroughPlane).lo), hi: Math.max(span(p.cteInPlane).hi, span(p.cteThroughPlane).hi), basis: "anisotropic: in-plane to through-plane" };
  return null;
}

function corners(dims, f) {
  const total = dims.reduce((a, d) => a * d.length, 1);
  if (total > 1 << 18) throw new RangeError("too many interval corners");
  let lo = Infinity, hi = -Infinity;
  for (let m = 0; m < total; m++) {
    let r = m;
    const v = dims.map((d) => { const x = d[r % d.length]; r = Math.floor(r / d.length); return x; });
    const y = f(v);
    lo = Math.min(lo, y); hi = Math.max(hi, y);
  }
  return { low: lo, high: hi, corners: total };
}
const pick = (iv) => (iv.lo === iv.hi ? [iv.lo] : [iv.lo, iv.hi]);

export const cteMultiphase = registerSolver({
  id: "material.cte-multiphase",
  version: "1.0.0",
  domain: "material.cte",
  fidelity: 1,
  method: "Turner (uniform strain) and thermoelastic Mori–Tanaka (Benveniste–Dvorak, random spheroids) for N phases at the nominal volume fractions; extremes over the corners of the E, ν (and aspect) intervals, α at its interval ends",
  reference: "server/lib/conkay/knowledge/multiphase-elasticity.js",
  regime: "linear thermoelasticity below the matrix's transitions; perfect bond; one continuous matrix for Mori–Tanaka; isotropic phase expansions (anisotropic ones over their directional interval)",
  units: { inputs: "Pa, 1, 1/K", outputs: "1/K" },
  tolerance: "estimates, not bounds; Turner weights the stiff phases and runs low for a soft matrix (Yun 2023 benchmark: 14.2 vs FEA 62.9 ppm/K), Mori–Tanaka matched that FEA to 0.8 %",
  screening: true,
  targets: formulated,
  run(ctx, id) {
    const s = setup(ctx, id);
    if (s.notComputed) return s;
    const rows = s.ir.constituents.map((c, i) => ({ id: c.id, c, phi: s.phi ? s.phi[i] : null, E: modulusOf(c), nu: c.properties.poisson ? span(c.properties.poisson) : null, alpha: alphaOf(c) }));
    const miss = [];
    for (const r of rows) for (const [k, n] of [["E", "Young's modulus"], ["nu", "Poisson's ratio"], ["alpha", "CTE"]]) if (!r[k]) miss.push(`${r.id} (${n})`);
    if (miss.length) s.blockers.push(`no cited ${miss.join(", ")}`);
    if (s.blockers.length) return blocked(s.blockers);
    const t = rows.reduce((a, r) => a + r.phi, 0), phi = rows.map((r) => r.phi / t);
    const kOf = (E, nu) => kgFromENu(E, nu).K;
    const tDims = rows.flatMap((r) => [pick(r.E), pick(r.nu)]);
    const turnerAt = (pickA) => corners(tDims, (v) => turnerCte(rows.map((r, i) => ({ phi: phi[i], K: kOf(v[2 * i], v[2 * i + 1]), alpha: pickA(r.alpha) }))));
    const tl = turnerAt((a) => a.lo), th = turnerAt((a) => a.hi);
    const outputs = { turner: { value: { low: tl.low, high: th.high }, unit: "1/K", basis: "uniform-strain estimate (stiff phases dominate; runs low for a soft matrix)" } };
    const warnings = ["Turner is not a bound; for a soft polymer matrix it underestimates (Yun 2023 FEA: 62.9 vs Turner 14.2 ppm/K at 35 vol % basalt)"];
    const mi = rows.reduce((b, r, i) => (r.phi > rows[b].phi ? i : b), 0);
    const shapes = { ...(s.micro.phases || {}) };
    for (const r of rows) {
      const th2 = span(r.c.properties.thickness), D = span(r.c.properties.lateralSize);
      if (!shapes[r.id]?.aspectRatio && th2 && D) shapes[r.id] = { aspectRatio: { lo: th2.lo / D.hi, hi: th2.hi / D.lo }, source: "sourced: platelet thickness / lateral size" };
    }
    const needShape = rows.filter((_, i) => i !== mi).filter((r) => !(span(shapes[r.id]?.aspectRatio)?.lo > 0)).map((r) => r.id);
    if (needShape.length) outputs.moriTanaka = { value: null, basis: `not computed: no shape (props.micromechanics.phases.<id>.aspectRatio) for ${needShape.join(", ")}` };
    else {
      const inc = rows.map((r, i) => ({ r, i })).filter(({ i }) => i !== mi);
      const dims = [pick(rows[mi].E), pick(rows[mi].nu), ...inc.flatMap(({ r }) => [pick(r.E), pick(r.nu), pick(span(shapes[r.id].aspectRatio))])];
      const at = (pickA) => corners(dims, (v) => {
        const m = { ...kgFromENu(v[0], v[1]), alpha: pickA(rows[mi].alpha) };
        return moriTanakaRandomCte(m, inc.map(({ r, i }, j) => ({ phi: phi[i], ...kgFromENu(v[2 + 3 * j], v[3 + 3 * j]), aspect: v[4 + 3 * j], alpha: pickA(r.alpha) })));
      });
      const ml = at((a) => a.lo), mh = at((a) => a.hi);
      outputs.moriTanaka = { value: { low: ml.low, high: mh.high, matrix: rows[mi].id }, unit: "1/K", basis: `thermoelastic Mori–Tanaka, random spheroids; ${ml.corners} corners` };
    }
    const aniso = rows.filter((r) => r.alpha.basis.startsWith("anisotropic")).map((r) => r.id);
    if (aniso.length) warnings.push(`${aniso.join(", ")} expand anisotropically; they enter over their directional interval`);
    const generic = rows.filter((r) => r.c.properties.cte?.flags?.includes("virgin-pp")).map((r) => r.id);
    if (generic.length) warnings.push(`${generic.join(", ")}: a generic PP's CTE stands in for the recycled grade's`);
    if (s.ir.basis === "unknown") warnings.push(`basis unknown (${s.ir.basisNote}): read as mass fractions`);
    return { inputs: { volumeFractions: { value: Object.fromEntries(rows.map((r, i) => [r.id, phi[i]])) }, alphas: { value: Object.fromEntries(rows.map((r) => [r.id, r.alpha])) }, shapes: { value: shapes } }, outputs, warnings };
  },
});
