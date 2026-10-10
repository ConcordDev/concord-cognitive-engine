// server/lib/conkay/drawings/box-hlr.js
//
// Exact hidden-line projection of axis-aligned boxes onto an axis-aligned view.
// An assembly built from parts (frame tubes, plates, datasheet envelopes) is a
// set of axis-aligned boxes in its own frame; looking along an axis, each box
// projects to a rectangle whose edges lie on the box face nearest the viewer
// (depth d1). A point of such an edge is hidden exactly when the ray from it
// toward the viewer passes through another box: the point is strictly inside
// that box's rectangle and that box's near face is nearer (d1' > d1). No
// tessellation, no tolerance beyond `eps` for coincident edges.
//
// A view is { u: [axis, sign], v: [axis, sign], depth: [axis, sign] }: the
// sheet's horizontal and vertical axes and the direction toward the viewer.
// Output polylines are in model metres in (u, v).

const AX = { x: 0, y: 1, z: 2 };

function project(box, view) {
  const lo = [box.min.x, box.min.y, box.min.z], hi = [box.max.x, box.max.y, box.max.z];
  const r = ([a, s]) => (s > 0 ? [lo[AX[a]], hi[AX[a]]] : [-hi[AX[a]], -lo[AX[a]]]);
  const [u0, u1] = r(view.u), [v0, v1] = r(view.v), [, d1] = r(view.depth);
  return { u0, u1, v0, v1, d1 };
}

/** Sub-intervals of [a, b] not covered by the union of `cover` intervals. */
function subtract(a, b, cover) {
  const c = cover.map(([p, q]) => [Math.max(a, p), Math.min(b, q)]).filter(([p, q]) => q > p).sort((x, y) => x[0] - y[0]);
  const out = [];
  let at = a;
  for (const [p, q] of c) {
    if (p > at) out.push([at, p]);
    at = Math.max(at, q);
  }
  if (b > at) out.push([at, b]);
  return out;
}

/**
 * boxes: [{ id, min:{x,y,z}, max:{x,y,z}, inner?: { min, max } }] (inner: a tube bore,
 * drawn only in views along the tube axis, where its outline is an edge on the near face).
 * Returns { visible: [[[u,v],[u,v]], ...], hidden: [...], perBox: { id: rect } }.
 */
export function projectBoxes(boxes, view, { eps = 1e-6 } = {}) {
  const rects = boxes.map((b) => ({ id: b.id, ...project(b, view) }));
  const edges = [];
  const along = view.depth[0];
  rects.forEach((r, i) => {
    const own = [[r.u0, r.u1, r.v0, "u"], [r.u0, r.u1, r.v1, "u"], [r.v0, r.v1, r.u0, "v"], [r.v0, r.v1, r.u1, "v"]];
    for (const e of own) edges.push({ i, d1: r.d1, e });
    const inner = boxes[i].inner;
    if (inner && inner.axis === along) {
      const q = project({ min: inner.min, max: inner.max }, view);
      for (const e of [[q.u0, q.u1, q.v0, "u"], [q.u0, q.u1, q.v1, "u"], [q.v0, q.v1, q.u0, "v"], [q.v0, q.v1, q.u1, "v"]]) edges.push({ i, d1: r.d1, e });
    }
  });
  const visible = [], hidden = [];
  const seen = new Set();
  for (const { i, d1, e: [a, b, c, dir] } of edges) {
    const key = `${dir}|${a.toFixed(7)}|${b.toFixed(7)}|${c.toFixed(7)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const cover = [];
    rects.forEach((o, j) => {
      if (j === i || !(o.d1 > d1 + eps)) return;
      const [p0, p1, q0, q1] = dir === "u" ? [o.u0, o.u1, o.v0, o.v1] : [o.v0, o.v1, o.u0, o.u1];
      if (c > q0 + eps && c < q1 - eps) cover.push([p0, p1]);
    });
    const pt = (t) => (dir === "u" ? [t, c] : [c, t]);
    const vis = subtract(a, b, cover);
    for (const [p, q] of vis) if (q - p > eps) visible.push([pt(p), pt(q)]);
    for (const [p, q] of subtract(a, b, vis)) if (q - p > eps) hidden.push([pt(p), pt(q)]);
  }
  return { visible, hidden, perBox: Object.fromEntries(rects.map((r) => [r.id, r])) };
}
