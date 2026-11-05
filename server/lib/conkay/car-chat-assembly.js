// server/lib/conkay/car-chat-assembly.js
//
// A car the chat can show. "Make me a car" used to reach conkay_design's
// single-part solver, which has no car: it answered "unsupported part —
// recognised parts: i-beam, beam, ..." and the retry hint told the model to
// re-describe the ask as a beam, so the user got a 3D I-beam. ConKay already
// builds cars (car-from-library.js → assembly/build.js, the same assembly the
// ConKay workspace shows). This turns that assembly into the chat's mesh
// artifact: the lofted body plus the four tyres, Y-up metres like the robot
// concept mesh (x = length, y = height, z = width).

import { buildCarFromLibrary } from "./compiler/car-from-library.js";
import { assemblyFromIr } from "./assembly/build.js";
import { loftBody } from "./assembly/surface.js";

const r1 = (v) => Math.round(v);

/** Vehicle frame (x forward, y left/right, z up) → chat frame (x, y up, z). A proper rotation, so winding is kept. */
function toChat(x, y, z, cx) {
  return [x - cx, z, -y];
}

function appendMesh(out, positions, indices, { cx, offset = [0, 0, 0], mirrorY = false }) {
  const base = out.positions.length / 3;
  for (let i = 0; i < positions.length; i += 3) {
    const y = mirrorY ? -positions[i + 1] : positions[i + 1];
    const p = toChat(positions[i] + offset[0], y + offset[1], positions[i + 2] + offset[2], cx);
    out.positions.push(p[0], p[1], p[2]);
  }
  for (let i = 0; i < indices.length; i += 3) {
    // A mirror flips handedness: swap two corners so the faces still point out.
    if (mirrorY) out.indices.push(base + indices[i], base + indices[i + 2], base + indices[i + 1]);
    else out.indices.push(base + indices[i], base + indices[i + 1], base + indices[i + 2]);
  }
}

/**
 * @param {string} brief the user's own words ("make me a four-seat electric car")
 * @returns {null | { kind: "car-assembly", parts: Array<{name, size_mm}>, bbox_mm, componentCount, groups, mesh, notes: string[] }}
 */
export function buildCarChatAssembly(brief) {
  const text = String(brief || "").trim();
  if (!text) return null;
  const built = buildCarFromLibrary(text);
  if (!built?.ir) return null;
  const asm = assemblyFromIr(built.ir, { brief: text });
  const spec = asm?.surface?.spec;
  if (!spec) return null;
  // The workspace lofts the full-density skin; the chat viewer gets the mobile density (~25K triangles).
  const body = loftBody(spec, { quality: "mobile" });
  const tyres = (asm.components || []).filter((c) => c?.role === "wheel" && /^TIRE_/i.test(String(c.id || "")));
  const tire = asm.wheel?.tire;

  let minX = Infinity;
  let maxX = -Infinity;
  for (let i = 0; i < body.positions.length; i += 3) {
    minX = Math.min(minX, body.positions[i]);
    maxX = Math.max(maxX, body.positions[i]);
  }
  const cx = (minX + maxX) / 2;

  const out = { positions: [], indices: [] };
  const slices = [];
  const parts = [];
  const claim = (name, size_mm, draw) => {
    const v0 = out.positions.length / 3;
    const i0 = out.indices.length;
    draw();
    slices.push({ name, shape: "mesh", v0, v1: out.positions.length / 3, i0, i1: out.indices.length });
    parts.push({ name, size_mm });
  };

  const b = body.bounds;
  claim("body", [r1((b.max[0] - b.min[0]) * 1000), r1((b.max[2] - b.min[2]) * 1000), r1((b.max[1] - b.min[1]) * 1000)],
    () => appendMesh(out, body.positions, body.paint, { cx }));
  if (Array.isArray(tire?.positions) && Array.isArray(tire?.indices)) {
    for (const t of tyres) {
      const p = t.placement || {};
      const left = Number(p.y) < 0;
      const half = Array.isArray(t.half) ? t.half : [0, 0, 0];
      claim(String(t.id).toLowerCase().replace(/_/g, " "), [r1(half[0] * 2000), r1(half[2] * 2000), r1(half[1] * 2000)],
        () => appendMesh(out, tire.positions, tire.indices, { cx, offset: [Number(p.x) || 0, Number(p.y) || 0, Number(p.z) || 0], mirrorY: left }));
    }
  }

  const xs = [];
  const ys = [];
  const zs = [];
  for (let i = 0; i < out.positions.length; i += 3) { xs.push(out.positions[i]); ys.push(out.positions[i + 1]); zs.push(out.positions[i + 2]); }
  const span = (a) => r1((Math.max(...a) - Math.min(...a)) * 1000);
  const groups = {};
  for (const c of asm.components || []) groups[c.group || "other"] = (groups[c.group || "other"] || 0) + 1;

  return {
    kind: "car-assembly",
    parts,
    bbox_mm: { length: span(xs), height: span(ys), width: span(zs) },
    componentCount: (asm.components || []).length,
    groups,
    configuration: built.configuration || null,
    mesh: {
      kind: "car-assembly",
      positions: out.positions.map((v) => Math.round(v * 1e5) / 1e5),
      indices: out.indices,
      vertexCount: out.positions.length / 3,
      triangleCount: out.indices.length / 3,
      parts: slices,
    },
    notes: [
      "Built from ConKay's vehicle library: the same assembly the ConKay workspace opens for this brief.",
      "The shown model is the lofted body and the four tyres; the full assembly also has the chassis, powertrain, interior and storage parts.",
      "It is a layout concept. Structural, packaging and performance checks run when the design is opened in the ConKay workspace.",
    ],
  };
}
