// server/lib/conkay/physics/solvers/geometry-stability.js
//
// geometry.clearance — axis-aligned bounding boxes of every body in an
// assembly: overall extents, interferences between bodies that are not
// joined by an edge (MATED_TO / BOLTED_TO / WELDED_TO / SUPPORTS), and
// service-access envelopes (props.serviceAccess { face: "+x"|"-x"|..., depth })
// that must stay clear of every other body.
//
// stability.static — the vertical through the known-mass CG (mass.budget)
// must fall inside the support polygon: the convex hull of the contact
// patches of the nodes listed in props.stability.contacts. The margin is the
// distance from the CG to the nearest polygon edge (negative = outside).
// Reported on its own, never folded into a score with other domains.
// With unknown masses on the budget it also reports how much unknown mass the
// stance tolerates: the largest total that, put at the worst point of the
// assembly's plan extents, still leaves the CG inside the polygon. That bound
// is computed, not a pass: the unknown masses still have to be measured.

import { registerSolver } from "../registry.js";

const JOIN = new Set(["MATED_TO", "BOLTED_TO", "WELDED_TO", "SUPPORTS"]);

function bodies(ctx, id, out = []) {
  for (const child of ctx.children(id, "CONTAINS")) {
    if (child.kind === "Assembly") bodies(ctx, child.id, out);
    else out.push(child);
  }
  return out;
}

/** Extents (x, y, z sizes in m) of a body, or null. */
export function extentsOf(ctx, id) {
  const bat = ctx.get(id, "props.battery");
  if (bat) {
    const d = bat.cell?.diameterM; const h = bat.cell?.heightM;
    if (![d, h, bat.series, bat.parallel].every(Number.isFinite)) return null;
    const e = bat.enclosure;
    if (e) return { x: bat.parallel * (d + e.gapM) + 2 * e.sheetM, y: bat.series * (d + e.gapM) + 2 * e.sheetM, z: h + e.extraHeightM + 2 * e.sheetM };
    return { x: bat.parallel * d, y: bat.series * d, z: h };
  }
  const env = ctx.get(id, "props.envelope");
  if (env) return { x: env.x, y: env.y, z: env.z };
  const g = ctx.get(id, "geometry");
  if (!g) return null;
  if (g.shape === "rect-tube") {
    const axis = ctx.get(id, "props.axis") || "x";
    if (axis === "x") return { x: g.length, y: g.width, z: g.height };
    if (axis === "y") return { x: g.width, y: g.length, z: g.height };
    return { x: g.width, y: g.height, z: g.length };
  }
  if (g.shape === "box") return { x: g.length, y: g.width, z: g.height };
  if (g.shape === "plate") return { x: g.length, y: g.width, z: g.thickness };
  return null;
}

export function aabb(ctx, id) {
  const e = extentsOf(ctx, id);
  const p = ctx.get(id, "position");
  if (!e || !p) return null;
  return { min: { x: p.x - e.x / 2, y: p.y - e.y / 2, z: p.z - e.z / 2 }, max: { x: p.x + e.x / 2, y: p.y + e.y / 2, z: p.z + e.z / 2 } };
}

/** Penetration depth of two boxes (min over axes of the overlap), ≤ 0 when apart. */
function penetration(a, b) {
  return Math.min(...["x", "y", "z"].map((k) => Math.min(a.max[k], b.max[k]) - Math.max(a.min[k], b.min[k])));
}

function serviceBox(box, face, depth) {
  const k = face[1];
  const out = { min: { ...box.min }, max: { ...box.max } };
  if (face[0] === "+") { out.min[k] = box.max[k]; out.max[k] = box.max[k] + depth; }
  else { out.max[k] = box.min[k]; out.min[k] = box.min[k] - depth; }
  return out;
}

export const clearance = registerSolver({
  id: "geometry.clearance",
  version: "1.0.0",
  domain: "geometry.clearance",
  fidelity: 0,
  method: "axis-aligned bounding-box interference and service-envelope check",
  regime: "static pose; boxes bound each body (conservative for round parts)",
  units: { inputs: "m", outputs: "m" },
  tolerance: "interference counted when penetration > props.clearance.tolerance (m)",
  screening: true,
  targets: (g) => g.nodesOfKind("Assembly").filter((n) => n.props?.clearance).map((n) => n.id),
  run(ctx, id) {
    const tol = ctx.get(id, "props.clearance.tolerance") ?? 0.001;
    // distributed items (a harness, fasteners) have a mass and a centroid but no single box; a part not
    // fitted is not a body: both are listed, not checked
    const listed = bodies(ctx, id).filter((n) => !ctx.get(n.id, "props.logical"));
    const distributed = listed.filter((n) => ctx.get(n.id, "props.distributed")).map((n) => n.id);
    const notFitted = listed.filter((n) => ctx.get(n.id, "props.notFitted")).map((n) => n.id);
    const all = listed.filter((n) => !distributed.includes(n.id) && !notFitted.includes(n.id));
    ctx.children(id, "MATED_TO"); // record a structure read: joins come from edges
    const joined = new Set(ctx.graph.edges().filter((e) => JOIN.has(e.type)).flatMap((e) => [`${e.from}|${e.to}`, `${e.to}|${e.from}`]));
    const boxes = [];
    const noBox = [];
    for (const n of all) {
      const b = aabb(ctx, n.id);
      if (b) boxes.push({ id: n.id, box: b }); else noBox.push(n.id);
    }
    const interferences = [];
    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        const a = boxes[i]; const b = boxes[j];
        if (joined.has(`${a.id}|${b.id}`)) continue;
        const p = penetration(a.box, b.box);
        if (p > tol) interferences.push({ a: a.id, b: b.id, penetration: p });
      }
    }
    const blocked = [];
    for (const { id: bid, box } of boxes) {
      const sa = ctx.get(bid, "props.serviceAccess");
      if (!sa) continue;
      const region = serviceBox(box, sa.face, sa.depth);
      for (const o of boxes) {
        if (o.id === bid) continue;
        const p = penetration(region, o.box);
        if (p > tol) blocked.push({ body: bid, face: sa.face, depth: sa.depth, by: o.id, penetration: p });
      }
    }
    const ext = { min: { x: Infinity, y: Infinity, z: Infinity }, max: { x: -Infinity, y: -Infinity, z: -Infinity } };
    for (const { box } of boxes) for (const k of ["x", "y", "z"]) { ext.min[k] = Math.min(ext.min[k], box.min[k]); ext.max[k] = Math.max(ext.max[k], box.max[k]); }
    return {
      inputs: { bodies: { value: boxes.length }, tolerance: { value: tol, unit: "m" } },
      outputs: {
        overallHeight: { value: ext.max.z - Math.min(0, ext.min.z), unit: "m" },
        extents: { value: ext, unit: "m" },
        interferences: { value: interferences },
        serviceBlocked: { value: blocked },
        noEnvelope: { value: noBox },
        distributed: { value: distributed, note: "spread over the assembly (no single box): not checked for interference" },
        notFitted: { value: notFitted },
      },
      failures: [
        ...interferences.map((x) => `interference: ${x.a} ↔ ${x.b} (${(x.penetration * 1000).toFixed(1)} mm)`),
        ...blocked.map((x) => `service access ${x.body} ${x.face} blocked by ${x.by}`),
      ],
      warnings: noBox.length ? [`no envelope for ${noBox.join(", ")}: not checked`] : [],
      assumptions: ["Bodies joined by MATED_TO/BOLTED_TO/WELDED_TO/SUPPORTS edges may touch.", "Height is measured from the ground plane z = 0."],
    };
  },
});

function hull(points) {
  const p = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower = [];
  for (const q of p) { while (lower.length >= 2 && cross(lower.at(-2), lower.at(-1), q) <= 0) lower.pop(); lower.push(q); }
  const upper = [];
  for (const q of [...p].reverse()) { while (upper.length >= 2 && cross(upper.at(-2), upper.at(-1), q) <= 0) upper.pop(); upper.push(q); }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)]; // counter-clockwise
}

/** Signed distance from a point to each edge of a CCW convex polygon (positive inside). */
export function edgeDistances(poly, pt) {
  return poly.map((a, i) => {
    const b = poly[(i + 1) % poly.length];
    return ((b.x - a.x) * (pt.y - a.y) - (b.y - a.y) * (pt.x - a.x)) / Math.hypot(b.x - a.x, b.y - a.y);
  });
}

/**
 * Largest extra mass m that keeps the CG of (known mass M at cg) + (m at any
 * point of `region`, a list of plan points whose convex hull bounds where it
 * can be) inside the polygon. Signed edge distance is linear in position, so
 * the worst placement is a region corner, and spreading the mass out never
 * makes it worse than putting it all there:
 *   M·d_e + m·s_e(p) ≥ 0 for every edge e and corner p  →  m ≤ M·d_e / −s_e(p) where s_e(p) < 0.
 * Returns { massKg: Infinity } when no corner lies outside any edge.
 */
export function tolerableUnknownMass(poly, cg, M, region) {
  const d = edgeDistances(poly, cg);
  let best = { massKg: Infinity, edge: null, corner: null };
  for (const p of region) {
    const s = edgeDistances(poly, p);
    s.forEach((se, e) => {
      if (se >= 0) return;
      const m = d[e] <= 0 ? 0 : (M * d[e]) / -se;
      if (m < best.massKg) best = { massKg: m, edge: e, corner: p };
    });
  }
  return best;
}

/** Signed distance from point to a CCW convex polygon (positive inside). */
export function insideMargin(poly, pt) {
  let m = Infinity;
  for (let i = 0; i < poly.length; i += 1) {
    const a = poly[i]; const b = poly[(i + 1) % poly.length];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const d = ((b.x - a.x) * (pt.y - a.y) - (b.y - a.y) * (pt.x - a.x)) / len;
    m = Math.min(m, d);
  }
  return m;
}

export const staticStability = registerSolver({
  id: "stability.static",
  version: "1.1.0",
  domain: "stability.static",
  fidelity: 0,
  method: "CG ground projection vs convex hull of contact patches; margin = distance to nearest edge",
  regime: "quasi-static, level ground, stated pose; no dynamic (ZMP) terms",
  units: { inputs: "m, kg", outputs: "m" },
  tolerance: "exact geometry",
  screening: true,
  targets: (g) => g.nodesOfKind("Assembly").filter((n) => n.props?.stability).map((n) => n.id),
  run(ctx, id) {
    const contacts = ctx.get(id, "props.stability.contacts") || [];
    const mb = ctx.result("mass.budget", id);
    if (!mb || mb.status === "NOT_COMPUTED") return { notComputed: `no mass budget (${mb?.reason || "missing"})` };
    const corners = [];
    for (const c of contacts) {
      const b = aabb(ctx, c);
      if (!b) return { notComputed: `contact ${c} has no position/extent` };
      corners.push({ x: b.min.x, y: b.min.y }, { x: b.max.x, y: b.min.y }, { x: b.max.x, y: b.max.y }, { x: b.min.x, y: b.max.y });
    }
    if (corners.length < 3) return { notComputed: "needs at least one contact patch" };
    const poly = hull(corners);
    const cg = { x: mb.outputs.cgX.value, y: mb.outputs.cgY.value };
    const margin = insideMargin(poly, cg);
    const unknown = mb.outputs.unknownItems.value;
    const outputs = { stabilityMargin: { value: margin, unit: "m" }, supportPolygon: { value: poly, unit: "m" }, cgHeight: { value: mb.outputs.cgZ.value, unit: "m" } };
    if (unknown.length && margin >= 0) {
      // Where an unknown mass can sit: the plan extents of every body that has a box (an assumption, stated).
      const ext = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
      for (const n of bodies(ctx, id)) {
        const b = aabb(ctx, n.id);
        if (!b) continue;
        ext.x0 = Math.min(ext.x0, b.min.x); ext.y0 = Math.min(ext.y0, b.min.y); ext.x1 = Math.max(ext.x1, b.max.x); ext.y1 = Math.max(ext.y1, b.max.y);
      }
      const region = [{ x: ext.x0, y: ext.y0 }, { x: ext.x1, y: ext.y0 }, { x: ext.x1, y: ext.y1 }, { x: ext.x0, y: ext.y1 }];
      const t = tolerableUnknownMass(poly, cg, mb.outputs.knownMass.value, region);
      outputs.unknownMassTolerance = {
        value: { massKg: t.massKg, worstPoint: t.corner, edge: t.edge, region: ext, unknownItems: unknown.length },
        unit: "kg",
        basis: "computed: largest total unknown mass that keeps the CG inside the support polygon wherever it sits in the assembly's plan extents (worst corner); a bound to measure against, not a pass",
      };
    }
    return {
      inputs: { cg: { value: cg, unit: "m", source: mb.runId }, contacts: { value: contacts } },
      outputs,
      failures: margin < 0 ? [`CG (${cg.x.toFixed(3)}, ${cg.y.toFixed(3)}) m is outside the support polygon by ${(-margin).toFixed(3)} m`] : [],
      warnings: unknown.length ? [`CG is of the known mass only; ${unknown.length} unknown-mass item(s) can move it`] : [],
      assumptions: [
        "Stated pose (props.stability.pose); both feet flat.", "Static: no walking dynamics, no ground slope.",
        ...(outputs.unknownMassTolerance ? ["Unknown-mass tolerance assumes every unknown item lies within the plan extents of the bodies that have boxes."] : []),
      ],
    };
  },
});
