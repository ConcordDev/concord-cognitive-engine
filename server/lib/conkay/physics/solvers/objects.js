// server/lib/conkay/physics/solvers/objects.js
//
// Physics that decides whether everyday objects work (audit 2026-11-27,
// items 3–4), on any build — not only cars and robots:
//
//   stability.tipping       an assembly's tip-over angle from its real part
//                           masses and its base part's real footprint
//   thermal.vessel-cooling  a hot drink in a revolved vessel cooling over time
//   aero.lifting-line       lift and drag of a lofted NACA wing
//
// Constants are never built in: a property the physics needs (a liquid's
// density and specific heat, a wall's conductivity, emissivity, air's
// density and viscosity) comes from the props or the part's material with its
// source, or the run is NOT_COMPUTED and says which value it needs. Every
// solver states its regime and what it leaves out.

import { registerSolver } from "../registry.js";
import { parseAmount } from "../../units/universal.js";
import { geometryVolumeM3 } from "./mass-cost.js";
import { PROFILE_SHAPES } from "../../geometry/shapes.js";
import { nacaPoints } from "../../geometry/profiles.js";

const G0 = 9.80665;
const SIGMA = 5.670374419e-8; // Stefan–Boltzmann, W/(m²·K⁴) (CODATA 2018)

/** value (number SI | unit string | { value, source }) → { si, source } | { error } | { missing } */
function q(v, dim, what) {
  if (v == null) return { missing: what };
  const raw = typeof v === "object" && !Array.isArray(v) && "value" in v ? v.value : v;
  const source = typeof v === "object" && v?.source ? String(v.source) : null;
  const r = parseAmount(raw, { expectDim: dim });
  if (!r.ok) return { error: `${what}: ${r.error}` };
  return { si: r.si, source };
}
const need = (o, what) => (o.missing ? `needs ${o.missing}` : o.error ? o.error : null);

// ── geometry helpers ─────────────────────────────────────────────────────────
const place = (axis) => (axis === "y" ? (u, a, b) => [a, u, b] : axis === "z" ? (u, a, b) => [a, b, u] : (u, a, b) => [u, a, b]);

/** A part's centre of mass in design coordinates (z up). */
export function partCentroid(n) {
  const p = n.position && [n.position.x, n.position.y, n.position.z].every(Number.isFinite) ? [n.position.x, n.position.y, n.position.z] : [0, 0, 0];
  const g = n.geometry;
  if (!g) return p;
  if (g.shape === "revolve") return [p[0], p[1], p[2] + g.derived.zBar];
  if (g.shape === "extrude") { const c = place(n.props?.axis || "x")(0, g.derived.centroid[0], g.derived.centroid[1]); return [p[0] + c[0], p[1] + c[1], p[2] + c[2]]; }
  return p; // box, plate, rods, tubes, lofts: placed at their centre
}

/** The plan footprint (x, y points) a part stands on, in design coordinates. */
export function footprint(n) {
  const g = n.geometry; if (!g) return null;
  const p = n.position ? [n.position.x || 0, n.position.y || 0] : [0, 0];
  const circle = (r) => Array.from({ length: 72 }, (_, i) => [p[0] + r * Math.cos((2 * Math.PI * i) / 72), p[1] + r * Math.sin((2 * Math.PI * i) / 72)]);
  if (g.shape === "box" || g.shape === "plate") return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => [p[0] + (sx * g.length) / 2, p[1] + (sy * g.width) / 2]);
  if (g.shape === "revolve") {
    const zMin = Math.min(...g.profile.map(([, z]) => z));
    const rBase = Math.max(...g.profile.filter(([, z]) => Math.abs(z - zMin) < 1e-9).map(([r]) => r));
    return rBase > 0 ? circle(rBase) : null;
  }
  if (g.shape === "extrude" && (n.props?.axis || "x") === "z") return g.profile.map(([a, b]) => [p[0] + a, p[1] + b]);
  if ((g.shape === "cylinder" || g.shape === "rod" || g.shape === "round-tube") && n.props?.axis === "z") return circle((g.diameter ?? g.outerDiameter) / 2);
  return null;
}

/** The lowest point of a part (z up), where it meets the floor. */
export function bottomZ(n) {
  const g = n.geometry; const z = n.position?.z ?? 0; const axis = n.props?.axis;
  if (g.shape === "box") return z - g.height / 2;
  if (g.shape === "plate") return z - g.thickness / 2;
  if (g.shape === "revolve") return z + Math.min(...g.profile.map(([, pz]) => pz));
  if (g.shape === "extrude") { if ((axis || "x") === "z") return z - g.length / 2; const bs = g.profile.map(([, b]) => b); return z + Math.min(...bs); }
  if (["cylinder", "rod", "round-tube"].includes(g.shape)) return axis === "z" ? z - g.length / 2 : z - (g.diameter ?? g.outerDiameter) / 2;
  return NaN;
}

/** Convex hull (Andrew's monotone chain), counter-clockwise. */
export function convexHull(pts) {
  const s = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], hi = [];
  for (const p of s) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (const p of s.slice().reverse()) { while (hi.length >= 2 && cr(hi[hi.length - 2], hi[hi.length - 1], p) <= 0) hi.pop(); hi.push(p); }
  return lo.slice(0, -1).concat(hi.slice(0, -1));
}

/** Signed distance from a point to each edge of a CCW hull (positive = inside); the edges. */
function edgeDistances(hull, [x, y]) {
  return hull.map((a, i) => {
    const b = hull[(i + 1) % hull.length];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    return { d: ((b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0])) / L, a, b, n: [(b[1] - a[1]) / L, -(b[0] - a[0]) / L] };
  });
}

// ── stability.tipping ────────────────────────────────────────────────────────
export const tipping = registerSolver({
  id: "stability.tipping",
  version: "1.0.0",
  domain: "stability.tipping",
  domains: ["stability.tipping", "stability.static"],
  fidelity: 1,
  method: "Rigid-body static tipping: centre of gravity from each contained part's volume × density at its real centroid (plus stated extra masses); support polygon = convex hull of the base part's footprint; tip angle about the nearest edge = atan(d / h); a stated push tips it when its overturning moment about that edge exceeds the weight's restoring moment",
  reference: "statics (e.g. Meriam & Kraige, Engineering Mechanics: Statics, ch. 3 and 6)",
  regime: "rigid, on a level rigid floor, no sliding (friction assumed enough), quasi-static",
  units: { inputs: "kg, m", outputs: "deg, m, N" },
  targets: (g) => [...g.nodes.values()].filter((n) => n.props?.tipping && typeof n.props.tipping === "object").map((n) => n.id),
  run(ctx, id) {
    const t = ctx.get(id, "props.tipping");
    // every part under the assembly (nested assemblies included)
    const ids = [];
    const walk = (nid, depth) => { if (depth > 8) return; for (const k of ctx.children(nid)) { ids.push(k.id); walk(k.id, depth + 1); } };
    walk(id, 0);
    const masses = []; const missing = [];
    for (const pid of ids) {
      const geometry = ctx.get(pid, "geometry");
      if (!geometry) continue;
      const mat = ctx.material(pid);
      const V = geometryVolumeM3(geometry);
      if (!(mat?.densityKgM3 > 0) || !(V > 0)) { missing.push(`${ctx.get(pid, "name") || pid}: its material density`); continue; }
      masses.push({ name: ctx.get(pid, "name") || pid, m: V * mat.densityKgM3, c: partCentroid({ geometry, position: ctx.get(pid, "position"), props: { axis: ctx.get(pid, "props.axis") } }) });
    }
    for (const [i, e] of (t.masses || []).entries()) {
      const m = q(e.mass, "mass", `masses[${i}].mass`);
      const at = Array.isArray(e.at) ? e.at.map((v, j) => q(v, "length", `masses[${i}].at[${j}]`)) : null;
      if (m.error || m.missing || !at || at.some((a) => a.error || a.missing)) { missing.push(`${e.name || `extra mass ${i + 1}`}: mass and at [x, y, z]`); continue; }
      masses.push({ name: e.name || `extra mass ${i + 1}`, m: m.si, c: at.map((a) => a.si) });
    }
    if (missing.length) return { notComputed: `needs ${missing.join("; ")}` };
    const M = masses.reduce((s, x) => s + x.m, 0);
    if (!(M > 0)) return { notComputed: "needs parts with geometry and material (or stated masses)" };
    const cg = [0, 1, 2].map((a) => masses.reduce((s, x) => s + x.m * x.c[a], 0) / M);
    const basePart = t.base ? { geometry: ctx.get(t.base, "geometry"), position: ctx.get(t.base, "position"), props: { axis: ctx.get(t.base, "props.axis") } } : null;
    let fp = Array.isArray(t.footprint) ? t.footprint.map(([x, y]) => [q(x, "length", "footprint").si, q(y, "length", "footprint").si]) : basePart ? footprint(basePart) : null;
    if (!fp || fp.length < 3) return { notComputed: t.base ? `the base part's footprint is not known for its shape (give props.tipping.footprint as [[x, y], ...])` : "needs props.tipping.base (the part it stands on) or a footprint" };
    const hull = convexHull(fp);
    const floorZ = basePart?.geometry ? bottomZ(basePart) : (t.floorZ != null ? q(t.floorZ, "length", "floorZ").si : 0);
    if (!Number.isFinite(floorZ)) return { notComputed: "the base part's underside height is not known for its shape (give props.tipping.floorZ)" };
    const h = cg[2] - floorZ;
    const edges = edgeDistances(hull, cg);
    const worst = edges.reduce((w, e) => (e.d < w.d ? e : w));
    const outputs = {
      mass: { value: M, unit: "kg" }, cgHeight: { value: h, unit: "m" }, cg: { value: cg, unit: "m" },
      tipAngle: { value: worst.d > 0 ? (Math.atan2(worst.d, h) * 180) / Math.PI : 0, unit: "deg" },
      edgeDistance: { value: worst.d, unit: "m" },
    };
    const margins = []; const warnings = [];
    if (worst.d <= 0) return { inputs: {}, outputs, margins: [{ check: "centre of gravity inside the base", demand: 0, capacity: worst.d, unit: "m", basis: "statics" }], warnings: ["the centre of gravity is outside the base: it falls over on its own"], assumptions: [] };
    if (t.tiltRequired != null) {
      const req = q(t.tiltRequired, "angle", "tiltRequired");
      if (req.si > 0) margins.push({ check: "tilts at least the required angle before it tips", demand: (req.si * 180) / Math.PI, capacity: outputs.tipAngle.value, unit: "deg", basis: t.tiltRequired?.source || "stated" });
    } else warnings.push("no required tilt was given, so the tip angle is computed but not checked");
    for (const [i, push] of (t.pushes || []).entries()) {
      const at = (push.at || []).map((v, j) => q(v, "length", `pushes[${i}].at[${j}]`).si);
      const F = (push.force || []).map((v, j) => q(v, "force", `pushes[${i}].force[${j}]`).si);
      if (at.length !== 3 || F.length !== 3 || [...at, ...F].some((v) => !Number.isFinite(v))) { warnings.push(`push ${i + 1}: needs at [x, y, z] and force [Fx, Fy, Fz]`); continue; }
      // worst edge for this push: the overturning moment about each edge vs the weight's restoring moment
      let worstRatio = 0, worstEdge = null;
      for (const e of edges) {
        const r = [at[0] - e.a[0], at[1] - e.a[1], at[2] - floorZ];
        const ax = [e.b[0] - e.a[0], e.b[1] - e.a[1], 0]; const L = Math.hypot(ax[0], ax[1]); ax[0] /= L; ax[1] /= L;
        const mom = [r[1] * F[2] - r[2] * F[1], r[2] * F[0] - r[0] * F[2], r[0] * F[1] - r[1] * F[0]];
        const over = -(mom[0] * ax[0] + mom[1] * ax[1]); // tipping outward over this edge is positive
        const restoring = M * G0 * e.d;
        const ratio = over / restoring;
        if (ratio > worstRatio) { worstRatio = ratio; worstEdge = e; }
      }
      margins.push({ check: `${push.name || `push ${i + 1}`}: overturning moment ≤ restoring moment`, demand: worstRatio, capacity: 1, unit: "ratio", basis: push.source || "stated" });
      void worstEdge;
    }
    return {
      inputs: { parts: { value: masses.map((x) => ({ name: x.name, mass: x.m, at: x.c })) } },
      outputs, margins, warnings,
      assumptions: ["rigid body on a level, rigid floor; it does not slide first"],
    };
  },
});

// ── thermal.vessel-cooling ───────────────────────────────────────────────────
/** Air properties at the film temperature need a source: the caller gives them. */
function churchillChuVertical(Ra, Pr) {
  // Churchill & Chu (1975), vertical plate, all Ra: Nu = {0.825 + 0.387 Ra^(1/6) / [1 + (0.492/Pr)^(9/16)]^(8/27)}²
  return (0.825 + (0.387 * Ra ** (1 / 6)) / (1 + (0.492 / Pr) ** (9 / 16)) ** (8 / 27)) ** 2;
}
function upperHotPlate(Ra) {
  // hot surface facing up (Incropera, Fundamentals of Heat and Mass Transfer, Eqs. 9.30–9.31)
  return Ra < 1e7 ? 0.54 * Ra ** 0.25 : 0.15 * Ra ** (1 / 3);
}

export const vesselCooling = registerSolver({
  id: "thermal.vessel-cooling",
  version: "1.0.0",
  domain: "thermal.transient",
  domains: ["thermal.transient", "thermal.temperature"],
  fidelity: 1,
  method: "Lumped liquid (well mixed) losing heat through the wall (conduction in series with outside natural convection, Churchill–Chu vertical-cylinder correlation, and radiation) and through the open top (natural convection, hot surface facing up, and radiation); integrated in time (RK4)",
  reference: "Incropera et al., Fundamentals of Heat and Mass Transfer, 7th ed., §9.6 (Eq. 9.26 Churchill–Chu, Eqs. 9.30–9.31), §1.2 radiation",
  regime: "still room air, liquid well mixed, wall thin next to the radius (planar conduction), vertical side treated as a vertical plate (valid while D ≥ 35 L / Gr^(1/4)); EVAPORATION from the open surface is NOT modelled — for hot water it is a large share of the loss, so the real cooling is faster than computed",
  units: { inputs: "K, m, W/(m·K)", outputs: "s, K" },
  targets: (g) => [...g.nodes.values()].filter((n) => n.props?.cooling && n.geometry?.shape === "revolve" && n.geometry.derived?.capacity > 0).map((n) => n.id),
  run(ctx, id) {
    const c = ctx.get(id, "props.cooling");
    const g = ctx.get(id, "geometry");
    const mat = ctx.material(id);
    const v = {};
    const take = (k, val, dim, what) => { const r = q(val, dim, what); v[k] = r; return r; };
    take("T0", c.startTemperature, "temperature", "startTemperature");
    take("Ta", c.ambient?.temperature, "temperature", "ambient.temperature");
    take("rhoL", c.liquid?.density, "density", "liquid.density");
    take("cpL", c.liquid?.specificHeat, "specific_heat", "liquid.specificHeat");
    take("kAir", c.ambient?.conductivity, "thermal_conductivity", "ambient.conductivity (air)");
    take("nuAir", c.ambient?.kinematicViscosity, "kinematic_viscosity", "ambient.kinematicViscosity (air)");
    take("PrAir", c.ambient?.prandtl != null ? { value: c.ambient.prandtl } : null, "ratio", "ambient.prandtl (air)");
    take("eps", c.emissivity != null ? { value: typeof c.emissivity === "object" ? c.emissivity.value : c.emissivity, source: c.emissivity?.source } : null, "ratio", "emissivity of the outside (with its source)");
    const kWall = c.wallConductivity != null ? q(c.wallConductivity, "thermal_conductivity", "wallConductivity") : mat?.conductivityWmK > 0 ? { si: mat.conductivityWmK, source: mat.sources?.conductivity || mat.source } : { missing: "the wall's thermal conductivity (wallConductivity, or conductivity on the material)" };
    v.kWall = kWall;
    const bad = Object.entries(v).map(([, r]) => need(r)).filter(Boolean);
    if (bad.length) return { notComputed: bad.join("; ") };
    const fill = c.fill != null ? Number(typeof c.fill === "object" ? c.fill.value : c.fill) : 1;
    if (!(fill > 0 && fill <= 1)) return { notComputed: "fill is a fraction of the capacity, 0..1" };
    const target = c.targetTemperature != null ? q(c.targetTemperature, "temperature", "targetTemperature") : null;
    // geometry: outer radius at the side and the liquid height from the capacity profile
    const R = g.derived.bbox.r, Ri = Math.max(...g.inner.map(([r]) => r));
    const Hrim = g.inner[g.inner.length - 1][1] - g.inner[0][1];
    const Vl = g.derived.capacity * fill;
    const Hl = Hrim * fill; // straight-sided approximation for the wetted height (said in assumptions)
    const ml = v.rhoL.si * Vl;
    const Aside = 2 * Math.PI * R * Hl, Abase = Math.PI * R * R, Atop = Math.PI * Ri * Ri;
    const tWall = g.wall;
    const beta = (T) => 1 / T; // ideal-gas air: β = 1/T_film (K)
    const hSide = (Ts) => { const Tf = (Ts + v.Ta.si) / 2; const Ra = (G0 * beta(Tf) * Math.max(1e-6, Ts - v.Ta.si) * Hl ** 3) / (v.nuAir.si ** 2) * v.PrAir.si; return (churchillChuVertical(Ra, v.PrAir.si) * v.kAir.si) / Hl; };
    const hTop = (Ts) => { const Tf = (Ts + v.Ta.si) / 2; const Lc = Ri / 2; const Ra = (G0 * beta(Tf) * Math.max(1e-6, Ts - v.Ta.si) * Lc ** 3) / (v.nuAir.si ** 2) * v.PrAir.si; return (upperHotPlate(Ra) * v.kAir.si) / Lc; };
    const hRad = (Ts) => v.eps.si * SIGMA * (Ts * Ts + v.Ta.si ** 2) * (Ts + v.Ta.si);
    // wall: the outer surface temperature Ts solves q = kA(T − Ts)/t = (h_conv + h_rad) A (Ts − Ta)
    const outerTs = (T) => { let Ts = (T + v.Ta.si) / 2; for (let i = 0; i < 60; i++) { const hc = hSide(Ts) + hRad(Ts); const next = (v.kWall.si / tWall * T + hc * v.Ta.si) / (v.kWall.si / tWall + hc); if (Math.abs(next - Ts) < 1e-9) return next; Ts = next; } return Ts; };
    const loss = (T) => { const Ts = outerTs(T); const qSide = (hSide(Ts) + hRad(Ts)) * (Ts - v.Ta.si) * (Aside + Abase * 0); const qTop = c.lid ? 0 : (hTop(T) + hRad(T)) * (T - v.Ta.si) * Atop; return { q: qSide + qTop, Ts, qSide, qTop }; };
    // integrate dT/dt = −q / (m c) with RK4 until the target or 4 h
    const f = (T) => -loss(T).q / (ml * v.cpL.si);
    let T = v.T0.si, t = 0; const dt = 5; let tTarget = null; const trace = [];
    while (t < 4 * 3600) {
      if (target?.si && tTarget == null && T <= target.si) tTarget = t;
      if (t % 300 === 0) trace.push([t, T]);
      const k1 = f(T), k2 = f(T + (dt / 2) * k1), k3 = f(T + (dt / 2) * k2), k4 = f(T + dt * k3);
      T += (dt / 6) * (k1 + 2 * k2 + 2 * k3 + k4); t += dt;
      if (tTarget != null && t > tTarget + 600) break;
    }
    const start = loss(v.T0.si);
    const outputs = {
      liquidMass: { value: ml, unit: "kg" },
      startHeatLoss: { value: start.q, unit: "W" },
      startOuterTemperature: { value: start.Ts, unit: "K" },
      temperatureAfter10min: { value: trace.find(([s]) => s === 600)?.[1] ?? null, unit: "K" },
      ...(tTarget != null ? { timeToTarget: { value: tTarget, unit: "s" } } : {}),
    };
    const margins = []; const warnings = [];
    if (c.maxOuterTemperature != null) {
      const lim = q(c.maxOuterTemperature, "temperature", "maxOuterTemperature");
      if (lim.si > 0) margins.push({ check: "outside of the wall at most the hand-contact limit (at the start)", demand: start.Ts, capacity: lim.si, unit: "K", basis: c.maxOuterTemperature?.source || "stated" });
    }
    if (c.minTimeAbove != null && target?.si) {
      const need = q(c.minTimeAbove, "time", "minTimeAbove");
      if (need.si > 0) margins.push({ check: "stays above the target temperature at least the required time", demand: need.si, capacity: tTarget ?? 4 * 3600, unit: "s", basis: c.minTimeAbove?.source || "stated" });
    }
    if (!c.lid) warnings.push("evaporation from the open surface is not modelled: hot drinks lose a large share of their heat that way, so they cool faster than this");
    return {
      inputs: { wallConductivity: { value: v.kWall.si, unit: "W/(m·K)", source: v.kWall.source || null } },
      outputs, margins, warnings,
      assumptions: ["the liquid stays well mixed", "still room air", `fill ${Math.round(fill * 100)} % of capacity; the wetted wall height taken as that share of the inside height`, "the base sits on a surface and is not counted as losing heat"],
    };
  },
});

// ── aero.lifting-line ────────────────────────────────────────────────────────
/** Zero-lift angle of a NACA 4-digit section by thin-airfoil theory (rad). */
export function nacaZeroLift(code) {
  const s = String(code).padStart(4, "0"); const m = Number(s[0]) / 100, p = Number(s[1]) / 10;
  if (!(m > 0 && p > 0)) return 0;
  // α_L0 = −(1/π) ∫₀^π (dz/dx)(cos θ − 1) dθ, x = (1 − cos θ)/2  (Anderson, Fundamentals of Aerodynamics, Eq. 4.61)
  const N = 4000; let s2 = 0;
  for (let i = 0; i < N; i++) {
    const th = ((i + 0.5) * Math.PI) / N, x = (1 - Math.cos(th)) / 2;
    const dz = x < p ? ((2 * m) / (p * p)) * (p - x) : ((2 * m) / ((1 - p) ** 2)) * (p - x);
    s2 += dz * (Math.cos(th) - 1) * (Math.PI / N);
  }
  return -s2 / Math.PI;
}

/**
 * Prandtl lifting line (Glauert's Fourier solution) for a wing of span b with chord c(y) and
 * geometric angle α(y) (incl. twist) and zero-lift angle α_L0(y). Returns CL, CDi, e, AR, Γ coefficients.
 */
export function liftingLine({ span, chordAt, alphaAt, alphaL0At, a0 = 2 * Math.PI, N = 40 }) {
  const ths = Array.from({ length: N }, (_, i) => ((i + 1) * Math.PI) / (N + 1));
  const A = []; const rhs = [];
  for (const th of ths) {
    const y = (-span / 2) * Math.cos(th), c = chordAt(y);
    const row = [];
    for (let n = 1; n <= N; n++) row.push(((4 * span) / (a0 * c)) * Math.sin(n * th) + (n * Math.sin(n * th)) / Math.sin(th));
    A.push(row); rhs.push(alphaAt(y) - alphaL0At(y));
  }
  const An = solve(A, rhs);
  let S = 0; const M = 400; for (let i = 0; i < M; i++) { const y = -span / 2 + ((i + 0.5) * span) / M; S += chordAt(y) * (span / M); }
  const AR = span * span / S;
  const CL = Math.PI * AR * An[0];
  let delta = 0; for (let n = 2; n <= N; n++) delta += n * (An[n - 1] / An[0]) ** 2;
  const CDi = (CL * CL) / (Math.PI * AR) * (1 + delta);
  return { CL, CDi, e: 1 / (1 + delta), AR, S };
}
function solve(A, b) {
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
  }
  return M.map((r, i) => r[n] / r[i]);
}

export const liftingLineSolver = registerSolver({
  id: "aero.lifting-line",
  version: "1.0.0",
  domain: "aero.lift",
  domains: ["aero.lift", "aero.drag"],
  fidelity: 1,
  method: "Prandtl lifting-line theory (Glauert Fourier series) on the loft's own chord and twist distribution; section zero-lift angle from the NACA camber line by thin-airfoil theory, lift slope 2π; profile drag from turbulent flat-plate skin friction (Cf = 0.074 / Re^0.2) × Raymer's form factor × wetted area",
  reference: "Anderson, Fundamentals of Aerodynamics, §4.8 and §5.3; Raymer, Aircraft Design: A Conceptual Approach, §12.5",
  regime: "attached flow (below stall), incompressible (M < 0.3), straight unswept wing of moderate-to-high aspect ratio (AR ≳ 4); no fuselage, tail or interference; profile drag assumes a fully turbulent boundary layer",
  units: { inputs: "m, m/s, kg/m³, m²/s", outputs: "N, 1" },
  targets: (g) => [...g.nodes.values()].filter((n) => n.props?.aero && n.geometry?.shape === "loft" && n.geometry.sections.every((s) => s.shape === "naca")).map((n) => n.id),
  run(ctx, id) {
    const a = ctx.get(id, "props.aero"); const g = ctx.get(id, "geometry");
    const V = q(a.speed, "velocity", "speed"), rho = q(a.air?.density, "density", "air.density"), nu = q(a.air?.kinematicViscosity, "kinematic_viscosity", "air.kinematicViscosity");
    const alpha = q(a.angleOfAttack ?? 0, "angle", "angleOfAttack");
    const bad = [V, rho, nu, alpha].map((r) => need(r)).filter(Boolean);
    if (bad.length) return { notComputed: bad.join("; ") };
    const secs = g.sections; const half = a.halfSpan !== false; // a loft is one half of the wing unless said otherwise
    const y0 = secs[0].at, y1 = secs[secs.length - 1].at, semi = y1 - y0;
    const lerp = (u, k) => { // property k at spanwise distance u from the root
      for (let i = 0; i < secs.length - 1; i++) { const s0 = secs[i], s1 = secs[i + 1]; if (u <= s1.at - y0 + 1e-12) { const f = (u - (s0.at - y0)) / ((s1.at - s0.at) || 1); return s0[k] + (s1[k] - s0[k]) * f; } }
      return secs[secs.length - 1][k];
    };
    const span = half ? 2 * semi : semi;
    const toU = (y) => (half ? Math.abs(y) : y + span / 2);
    const chordAt = (y) => lerp(toU(y), "chord");
    const alphaAt = (y) => alpha.si + (lerp(toU(y), "twist") * Math.PI) / 180;
    const aL0 = secs.map((s) => nacaZeroLift(s.naca));
    const alphaL0At = (y) => { const u = toU(y); for (let i = 0; i < secs.length - 1; i++) if (u <= secs[i + 1].at - y0 + 1e-12) { const f = (u - (secs[i].at - y0)) / ((secs[i + 1].at - secs[i].at) || 1); return aL0[i] + (aL0[i + 1] - aL0[i]) * f; } return aL0[aL0.length - 1]; };
    const ll = liftingLine({ span, chordAt, alphaAt, alphaL0At });
    const q0 = 0.5 * rho.si * V.si * V.si;
    // profile drag: Cf × FF × S_wet, chord-weighted over the span (Raymer Eq. 12.27, 12.30)
    let D0 = 0; const M = 60;
    for (let i = 0; i < M; i++) {
      const u = ((i + 0.5) * semi) / M, c = lerp(u, "chord"), tc = Number(String(secs[0].naca).slice(2)) / 100;
      const Re = (V.si * c) / nu.si, Cf = 0.074 / Re ** 0.2, xm = Number(String(secs[0].naca)[1]) / 10 || 0.3;
      const FF = 1 + (0.6 / xm) * tc + 100 * tc ** 4;
      D0 += q0 * Cf * FF * (2.04 * c) * (semi / M) * (half ? 2 : 1); // wetted ≈ 2.04 × planform (thin section)
    }
    const L = q0 * ll.S * ll.CL, Di = q0 * ll.S * ll.CDi, D = Di + D0;
    const outputs = {
      CL: { value: ll.CL, unit: "1" }, CDi: { value: ll.CDi, unit: "1" }, oswald: { value: ll.e, unit: "1" }, aspectRatio: { value: ll.AR, unit: "1" },
      area: { value: ll.S, unit: "m^2" }, lift: { value: L, unit: "N" }, inducedDrag: { value: Di, unit: "N" }, profileDrag: { value: D0, unit: "N" },
      liftToDrag: { value: L / D, unit: "1" },
    };
    const margins = []; const warnings = [];
    const stall = a.stallAngle != null ? q(a.stallAngle, "angle", "stallAngle") : null;
    const maxSec = alpha.si + Math.max(...secs.map((s) => (s.twist * Math.PI) / 180)) - Math.min(...aL0);
    if (stall?.si > 0) margins.push({ check: "every section below its stall angle (from zero lift)", demand: (maxSec * 180) / Math.PI, capacity: (stall.si * 180) / Math.PI, unit: "deg", basis: a.stallAngle?.source || "stated" });
    else warnings.push("no stall angle was given, so whether the wing is still flying is not checked (lifting-line theory knows nothing about stall)");
    if (a.mustLift != null) {
      const W = q(a.mustLift, "force", "mustLift");
      const Wm = W.error ? q(a.mustLift, "mass", "mustLift") : W;
      const need2 = W.error && Wm.si ? Wm.si * G0 : W.si;
      if (need2 > 0) margins.push({ check: "lift at least the weight it must carry", demand: need2, capacity: L, unit: "N", basis: a.mustLift?.source || "stated" });
    }
    if (ll.AR < 4) warnings.push(`aspect ratio ${ll.AR.toFixed(1)} is low for lifting-line theory: use a vortex-lattice or CFD result`);
    if (V.si > 0.3 * 343) warnings.push("above Mach 0.3: compressibility not modelled");
    return { inputs: { span: { value: span, unit: "m" } }, outputs, margins, warnings, assumptions: [half ? "the loft is one half of a symmetric wing" : "the loft is the whole wing", "section lift slope 2π per radian (thin-airfoil theory)"] };
  },
});

export { PROFILE_SHAPES, nacaPoints };
