// server/lib/conkay/geometry/shapes.js
//
// Profile shapes in the Design IR: compiled from quantity strings (any unit),
// with their exact properties and a display mesh.
//
//   { shape: "extrude", length, profile: [[a, b], ...], holes?: [[[a, b], ...] | { circle: { at: [a, b], diameter } }], fillet? }
//       a closed profile in the (a, b) plane pushed `length` along props.axis (default x).
//       Section properties (A, centroid, I) are exact, so an extruded part can be a frame member.
//   { shape: "revolve", profile: [[r, z], ...], angle? }          a closed profile turned about z (degrees, default 360)
//   { shape: "revolve", outline: [[r, z], ...], wall, angle? }    an open outer outline (from the axis outward, then up)
//       with a wall thickness inside it: a cup, a bowl, a lamp shade, a bottle. Reports `capacity`
//       (what it holds up to the rim) when the outline starts on the axis.
//   { shape: "loft", sections: [{ at, shape: "rect"|"ellipse"|"naca", width?, height?, chord?, naca?, twist?, offset?: [a, b] }], skin? }
//       sections blended along props.axis (default x): a wing (NACA sections along the span), a hull, a fuselage.
//       `skin` makes it a thin-walled shell of that thickness (volume = surface × skin, thin-wall).

import { parseAmount } from "../units/universal.js";
import {
  polygonMoments, circleMoments, circlePoints, filletPolygon, offsetPolylineLeft, sectionPoints,
  loftVolume, triangulate, signedArea, ARC_STEP,
} from "./profiles.js";

export const PROFILE_SHAPES = new Set(["extrude", "revolve", "loft"]);

const len = (v, where, errors, { allowZero = true, allowNeg = true } = {}) => {
  const r = parseAmount(v ?? null, { expectDim: "length" });
  if (!r.ok) { errors.push(`${where}: ${r.error}`); return NaN; }
  if (!allowNeg && r.si < 0) { errors.push(`${where}: must not be negative`); return NaN; }
  if (!allowZero && !(r.si > 0)) { errors.push(`${where}: must be more than zero`); return NaN; }
  return r.si;
};
const pts = (arr, where, errors, opts) => {
  if (!Array.isArray(arr) || arr.length < 2) { errors.push(`${where}: a list of [a, b] points`); return []; }
  return arr.map((p, i) => (Array.isArray(p) && p.length === 2 ? [len(p[0], `${where}[${i}][0]`, errors, opts), len(p[1], `${where}[${i}][1]`, errors)] : (errors.push(`${where}[${i}]: a point is [a, b]`), [NaN, NaN])));
};
const selfIntersects = (p) => {
  const n = p.length;
  const cr = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  for (let i = 0; i < n; i++) {for (let j = i + 2; j < n; j++) {
    if (i === 0 && j === n - 1) continue;
    const a = p[i], b = p[(i + 1) % n], c = p[j], d = p[(j + 1) % n];
    const d1 = cr(c, d, a), d2 = cr(c, d, b), d3 = cr(a, b, c), d4 = cr(a, b, d);
    if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  }}
  return false;
};

/** Compile a profile shape: { geometry } (SI + derived) or { errors }. */
export function compileProfileShape(raw, where = "geometry") {
  const errors = [];
  const g = { shape: raw.shape };
  if (raw.shape === "extrude") {
    g.length = len(raw.length, `${where}.length`, errors, { allowZero: false });
    let outer = pts(raw.profile, `${where}.profile`, errors);
    if (outer.length < 3) errors.push(`${where}.profile: at least three points`);
    const holes = []; const circles = [];
    for (const [i, h] of (Array.isArray(raw.holes) ? raw.holes : []).entries()) {
      if (h && h.circle) {
        const at = pts([h.circle.at, h.circle.at], `${where}.holes[${i}].circle.at`, errors)[0];
        const d = len(h.circle.diameter, `${where}.holes[${i}].circle.diameter`, errors, { allowZero: false });
        circles.push({ at, d });
      } else holes.push(pts(h, `${where}.holes[${i}]`, errors));
    }
    if (raw.fillet != null) g.fillet = len(raw.fillet, `${where}.fillet`, errors, { allowZero: false });
    if (errors.length) return { errors };
    if (selfIntersects(outer)) return { errors: [`${where}.profile: the outline crosses itself`] };
    if (Math.abs(signedArea(outer)) < 1e-14) return { errors: [`${where}.profile: encloses no area`] };
    try { if (g.fillet) outer = filletPolygon(outer, g.fillet); } catch (e) { return { errors: [`${where}.fillet: ${e.message}`] }; }
    g.profile = outer; g.holes = holes; g.circles = circles;
    g.derived = extrudeProps(g);
    if (!(g.derived.A > 0)) return { errors: [`${where}: the holes remove the whole profile`] };
    return { geometry: g };
  }
  if (raw.shape === "revolve") {
    g.angle = raw.angle == null ? 360 : Number(raw.angle);
    if (!(g.angle > 0 && g.angle <= 360)) errors.push(`${where}.angle: degrees, more than 0 and at most 360`);
    if (raw.outline != null) {
      const out = pts(raw.outline, `${where}.outline`, errors, { allowNeg: false });
      g.wall = len(raw.wall, `${where}.wall`, errors, { allowZero: false });
      if (errors.length) return { errors };
      const inner = offsetPolylineLeft(out, g.wall);
      if (inner.some(([r]) => r < -1e-9)) return { errors: [`${where}.wall: thicker than the outline allows (the inside would cross the axis)`] };
      g.outline = out; g.inner = inner.map(([r, z]) => [Math.max(0, r), z]);
      g.profile = [...out, ...g.inner.slice().reverse()];
      if (out[0][0] < 1e-9) {
        // what it holds: the region from the axis to the inner surface, up to the rim
        const rimZ = g.inner[g.inner.length - 1][1];
        g.capacityProfile = [[0, g.inner[0][1]], ...g.inner, [0, rimZ]];
      }
    } else {
      g.profile = pts(raw.profile, `${where}.profile`, errors, { allowNeg: false });
      if (g.profile.length < 3) errors.push(`${where}.profile: at least three points`);
    }
    if (errors.length) return { errors };
    if (selfIntersects(g.profile)) return { errors: [`${where}: the profile crosses itself`] };
    g.derived = revolveProps(g);
    if (!(g.derived.volume > 0)) return { errors: [`${where}: the profile encloses no area`] };
    return { geometry: g };
  }
  if (raw.shape === "loft") {
    const secs = Array.isArray(raw.sections) ? raw.sections : [];
    if (secs.length < 2) return { errors: [`${where}.sections: at least two sections`] };
    g.sections = secs.map((s, i) => {
      const w = `${where}.sections[${i}]`;
      const sec = { at: len(s.at, `${w}.at`, errors), shape: s.shape };
      if (s.shape === "rect" || s.shape === "ellipse") { sec.width = len(s.width, `${w}.width`, errors, { allowZero: false }); sec.height = len(s.height, `${w}.height`, errors, { allowZero: false }); }
      else if (s.shape === "naca") { sec.chord = len(s.chord, `${w}.chord`, errors, { allowZero: false }); sec.naca = String(s.naca ?? ""); sec.twist = Number(s.twist ?? 0); if (!/^\d{4}$/.test(sec.naca)) errors.push(`${w}.naca: a 4-digit NACA code like "2412"`); }
      else errors.push(`${w}.shape: rect, ellipse or naca`);
      if (Array.isArray(s.offset)) { sec.offsetA = len(s.offset[0], `${w}.offset[0]`, errors); sec.offsetB = len(s.offset[1], `${w}.offset[1]`, errors); }
      return sec;
    });
    if (raw.skin != null) g.skin = len(raw.skin, `${where}.skin`, errors, { allowZero: false });
    if (errors.length) return { errors };
    g.sections.sort((a, b) => a.at - b.at);
    if (g.sections.some((s, i) => i > 0 && s.at - g.sections[i - 1].at <= 0)) return { errors: [`${where}.sections: two sections at the same station`] };
    try { g.derived = loftProps(g); } catch (e) { return { errors: [`${where}: ${e.message}`] }; }
    return { geometry: g };
  }
  return { errors: [`${where}: unknown profile shape "${raw.shape}"`] };
}

// ── properties ───────────────────────────────────────────────────────────────
function extrudeProps(g) {
  const sum = { A: 0, Sx: 0, Sy: 0, Ixx: 0, Iyy: 0, Ixy: 0 };
  const add = (m, s) => { for (const k of Object.keys(sum)) sum[k] += s * m[k]; };
  add(polygonMoments(g.profile), 1);
  for (const h of g.holes) add(polygonMoments(h), -1);
  for (const c of g.circles) add(circleMoments(c.at[0], c.at[1], c.d), -1);
  const ca = sum.Sx / sum.A, cb = sum.Sy / sum.A;
  // about the centroid: I_aa (bending about the a axis) = ∫(b−cb)², I_bb = ∫(a−ca)²
  const Iaa = sum.Ixx - sum.A * cb * cb, Ibb = sum.Iyy - sum.A * ca * ca, Iab = sum.Ixy - sum.A * ca * cb;
  const allA = [...g.profile.map((p) => p[0])], allB = [...g.profile.map((p) => p[1])];
  const span = (v) => Math.max(...v) - Math.min(...v);
  const Ip = Iaa + Ibb;
  return {
    A: sum.A, centroid: [ca, cb], Iaa, Ibb, Iab,
    // Saint-Venant's estimate for a solid section, J ≈ A⁴ / (4π² Ip): exact for a circle, within ~10 % for
    // compact solid sections; NOT valid for thin-walled open or hollow sections (flagged where used).
    J: (sum.A ** 4) / (4 * Math.PI * Math.PI * Ip), Jexact: false,
    hollow: g.holes.length + g.circles.length > 0,
    cMaxA: Math.max(...allB.map((b) => Math.abs(b - cb))), cMaxB: Math.max(...allA.map((a) => Math.abs(a - ca))),
    depth: Math.max(span(allA), span(allB)),
    volume: sum.A * g.length,
    bbox: { a: [Math.min(...allA), Math.max(...allA)], b: [Math.min(...allB), Math.max(...allB)] },
    notes: g.fillet ? [`fillet arcs drawn in ≤ ${Math.round((ARC_STEP * 180) / Math.PI)}° segments (area low by at most 0.02 % of each fillet's sector)`] : [],
  };
}

function revolveProps(g) {
  const pappus = (poly) => { const m = polygonMoments(poly); return { A: m.A, rBar: m.Sx / m.A, V: (2 * Math.PI * m.Sx * g.angle) / 360 }; };
  const s = pappus(g.profile);
  const out = { volume: s.V, sectionArea: s.A, rBar: s.rBar };
  if (g.capacityProfile) out.capacity = pappus(g.capacityProfile).V;
  const rs = g.profile.map((p) => p[0]), zs = g.profile.map((p) => p[1]);
  out.bbox = { r: Math.max(...rs), z: [Math.min(...zs), Math.max(...zs)] };
  // the solid's centre of mass height (Pappus-weighted): ∫ z · r dA / ∫ r dA
  const m = momentZR(g.profile);
  out.zBar = m.zr / m.r;
  return out;
}
function momentZR(poly) {
  // ∫ r dA and ∫ z r dA over the (r, z) polygon (Green's theorem, exact)
  let r = 0, zr = 0;
  const p = signedArea(poly) < 0 ? poly.slice().reverse() : poly;
  for (let i = 0; i < p.length; i++) {
    const [r0, z0] = p[i], [r1, z1] = p[(i + 1) % p.length];
    const c = r0 * z1 - r1 * z0;
    r += (r0 + r1) * c / 6;
    zr += (2 * r0 * z0 + r0 * z1 + r1 * z0 + 2 * r1 * z1) * c / 24;
  }
  return { r, zr };
}

function loftProps(g) {
  const stations = g.sections.map((s) => ({ at: s.at, pts: sectionPoints(s) }));
  const solid = loftVolume(stations);
  // lateral surface: the ruled quads between stations (exact for planar quads; near-planar otherwise)
  let lateral = 0;
  for (let k = 0; k < stations.length - 1; k++) {
    const P = stations[k].pts, Q = stations[k + 1].pts, dx = stations[k + 1].at - stations[k].at;
    for (let i = 0; i < P.length; i++) {
      const j = (i + 1) % P.length;
      const a = [0, P[i][0], P[i][1]], b = [0, P[j][0], P[j][1]], c = [dx, Q[j][0], Q[j][1]], d = [dx, Q[i][0], Q[i][1]];
      lateral += triArea(a, b, c) + triArea(a, c, d);
    }
  }
  const capA = (p) => Math.abs(signedArea(p));
  const ends = capA(stations[0].pts) + capA(stations[stations.length - 1].pts);
  const out = { solidVolume: solid, lateralArea: lateral, stations: stations.length };
  out.volume = g.skin ? (lateral + ends) * g.skin : solid;
  if (g.skin) out.notes = ["thin-walled skin: volume = surface area × skin (accurate while the skin is thin next to the section)"];
  const as = stations.flatMap((s) => s.pts.map((p) => p[0])), bs = stations.flatMap((s) => s.pts.map((p) => p[1]));
  out.bbox = { u: [stations[0].at, stations[stations.length - 1].at], a: [Math.min(...as), Math.max(...as)], b: [Math.min(...bs), Math.max(...bs)] };
  return out;
}
function triArea(a, b, c) {
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  return Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]) / 2;
}

/** Volume of a compiled profile shape (m³). */
export const profileVolume = (g) => g?.derived?.volume ?? null;

// ── display meshes (local coordinates, metres; z up) ─────────────────────────
/** Map (u along the axis, a, b in the section) to x, y, z. */
const place = (axis) => (axis === "y" ? (u, a, b) => [a, u, b] : axis === "z" ? (u, a, b) => [a, b, u] : (u, a, b) => [u, a, b]);

export function profileMesh(g, axis = "x") {
  const P = [], I = [];
  const push = (v) => { P.push(v[0], v[1], v[2]); return P.length / 3 - 1; };
  if (g.shape === "extrude") {
    const at = place(axis), L = g.length / 2;
    // walls face out of the material: the outline counter-clockwise, every hole clockwise
    const outer = signedArea(g.profile) < 0 ? g.profile.slice().reverse() : g.profile;
    const holes = [...g.holes, ...g.circles.map((c) => circlePoints(c.at[0], c.at[1], c.d, 64))].map((h) => (signedArea(h) > 0 ? h.slice().reverse() : h));
    const { points, triangles } = triangulate(outer, holes);
    const top = points.map(([a, b]) => push(at(L, a, b))), bot = points.map(([a, b]) => push(at(-L, a, b)));
    for (const [i, j, k] of triangles) { I.push(top[i], top[j], top[k]); I.push(bot[k], bot[j], bot[i]); }
    for (const ring of [outer, ...holes]) {
      for (let i = 0; i < ring.length; i++) {
        const p = ring[i], q = ring[(i + 1) % ring.length];
        const a = push(at(-L, p[0], p[1])), b = push(at(-L, q[0], q[1])), c = push(at(L, q[0], q[1])), d = push(at(L, p[0], p[1]));
        I.push(a, b, c, a, c, d);
      }
    }
  } else if (g.shape === "revolve") {
    const seg = Math.max(8, Math.round((64 * g.angle) / 360)), full = g.angle >= 360;
    const ang = (k) => ((g.angle * Math.PI) / 180) * (k / seg);
    // clockwise in (r, z) so the swept faces point out of the material
    const ring = signedArea(g.profile) > 0 ? g.profile.slice().reverse() : g.profile;
    const cols = full ? seg : seg + 1;
    const ids = ring.map(([r, z]) => Array.from({ length: cols }, (_, k) => push([r * Math.cos(ang(k)), r * Math.sin(ang(k)), z])));
    for (let i = 0; i < ring.length; i++) {
      const A = ids[i], B = ids[(i + 1) % ring.length];
      for (let k = 0; k < seg; k++) { const k2 = full ? (k + 1) % seg : k + 1; I.push(A[k], B[k], B[k2], A[k], B[k2], A[k2]); }
    }
    if (!full) {for (const k of [0, seg]) {
      const { points, triangles } = triangulate(ring);
      const cap = points.map(([r, z]) => push([r * Math.cos(ang(k)), r * Math.sin(ang(k)), z]));
      // the start face looks back along −θ, the end face along +θ
      for (const [i, j, l] of triangles) { if (k === 0) I.push(cap[i], cap[j], cap[l]); else I.push(cap[l], cap[j], cap[i]); }
    }}
  } else if (g.shape === "loft") {
    const at = place(axis);
    const st = g.sections.map((s) => ({ at: s.at, pts: sectionPoints(s) }));
    const ids = st.map((s) => s.pts.map(([a, b]) => push(at(s.at, a, b))));
    for (let k = 0; k < st.length - 1; k++) {
      const A = ids[k], B = ids[k + 1];
      for (let i = 0; i < A.length; i++) { const j = (i + 1) % A.length; I.push(A[i], A[j], B[j], A[i], B[j], B[i]); }
    }
    for (const k of [0, st.length - 1]) {
      const { points, triangles } = triangulate(st[k].pts);
      const cap = points.map(([a, b]) => push(at(st[k].at, a, b)));
      for (const [i, j, l] of triangles) I.push(cap[i], cap[j], cap[l]);
    }
  }
  // laying a shape along y swaps two axes (a mirror): turn every triangle back outward
  if (axis === "y" && g.shape !== "revolve") for (let t = 0; t < I.length; t += 3) { const tmp = I[t + 1]; I[t + 1] = I[t + 2]; I[t + 2] = tmp; }
  return { positions: P, indices: I };
}

/** Bounding box (local, metres) as { x: [lo, hi], y: [..], z: [..] }. */
export function profileBounds(g, axis = "x") {
  const m = profileMesh(g, axis);
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < m.positions.length; i++) { const a = i % 3; lo[a] = Math.min(lo[a], m.positions[i]); hi[a] = Math.max(hi[a], m.positions[i]); }
  return { x: [lo[0], hi[0]], y: [lo[1], hi[1]], z: [lo[2], hi[2]] };
}
