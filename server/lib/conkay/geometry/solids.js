// server/lib/conkay/geometry/solids.js
//
// The B-rep side of ConKay geometry: every build part built as an OpenCascade
// solid (conkay_solids_occ.py) from the same compiled geometry ConKay's own
// math uses. Two uses:
//   - cad.solid-check: the kernel's own volume must agree with ConKay's exact
//     volume — two independent computations of the same part; a disagreement
//     is a FAIL, never hidden.
//   - STEP export: real B-rep solids (planes, cylinders, revolved and ruled
//     surfaces, exact circular holes), not faceted triangles.
// No kernel installed → NOT_COMPUTED with how to install it.

import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import fsp from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { registerSolver } from "../physics/registry.js";
import { requestKernel, runPythonKernel } from "../cad/kernel-queue.js";
import { resolveKernelPython, UNAVAILABLE } from "../cad/body-kernel.js";
import { PROFILE_SHAPES } from "./shapes.js";
import { sectionPoints } from "./profiles.js";
import { geometryVolumeM3 } from "../physics/solvers/mass-cost.js";

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), "conkay_solids_occ.py");
const SOLID_SHAPES = new Set([...PROFILE_SHAPES, "box", "plate", "cylinder", "rod", "bolt", "round-tube", "rect-tube"]);
/** Relative volume agreement required between the kernel and ConKay's exact math. */
export const AGREEMENT = 1e-6;

/** The kernel's request for one compiled node (SI), or null when it has no solid. */
export function solidRequest(node) {
  const g = node?.geometry;
  if (!g || !SOLID_SHAPES.has(g.shape)) return null;
  const geometry = { ...g };
  delete geometry.derived;
  if (g.shape === "loft") geometry.stations = g.sections.map((s) => ({ at: s.at, pts: sectionPoints(s) }));
  if (g.shape === "extrude") geometry.circles = (g.circles || []).map((c) => ({ at: c.at, d: c.d }));
  const p = node.position;
  return {
    id: node.id, name: node.name || node.id, geometry,
    axis: node.props?.axis || null,
    position: p && [p.x, p.y, p.z].every(Number.isFinite) ? [p.x, p.y, p.z] : [0, 0, 0],
  };
}

/** Build solids (and optionally a STEP file) off the request path. */
export async function runSolids(parts, { stepPath = null, timeoutMs = 300000 } = {}) {
  const python = await resolveKernelPython();
  if (!python) return { ok: false, unavailable: UNAVAILABLE };
  return runPythonKernel({ python, script: SCRIPT, input: { parts, stepPath }, timeoutMs });
}

/** Every solid of a compiled graph as one STEP file's text. */
export async function buildStep(graph) {
  const parts = [...graph.nodes.values()].map(solidRequest).filter(Boolean);
  if (!parts.length) return { ok: false, error: "this build has no solid parts" };
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "conkay-step-"));
  const stepPath = path.join(dir, "build.step");
  try {
    const r = await runSolids(parts, { stepPath });
    if (!r.ok) return { ok: false, error: r.unavailable || r.error };
    if (!r.step) return { ok: false, error: "the kernel built no solid", parts: r.parts };
    const text = await fsp.readFile(stepPath, "utf8");
    return { ok: true, step: text, parts: r.parts };
  } finally {
    await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

export const solidCheck = registerSolver({
  id: "cad.solid-check",
  version: "1.0.0",
  domain: "geometry.verification",
  domains: ["geometry.verification"],
  fidelity: 3,
  method: "The part built as an OpenCascade B-rep solid (prism, revolution, ruled loft, exact circular holes) and measured by the kernel's own mass properties; compared with ConKay's exact volume (Green's theorem, Pappus, the ruled-loft integral)",
  reference: "server/lib/conkay/geometry/conkay_solids_occ.py; server/lib/conkay/geometry/shapes.js",
  regime: "the solid exactly as compiled (no tolerances, no draft, no manufacturing allowances)",
  units: { inputs: "m", outputs: "m^3, m^2" },
  targets: (g) => [...g.nodes.values()].filter((n) => n.geometry && PROFILE_SHAPES.has(n.geometry.shape)).map((n) => n.id),
  run(ctx, id) {
    // read through ctx so an edit to the geometry, position or axis re-runs this check
    const node = { id, name: ctx.get(id, "name"), geometry: ctx.get(id, "geometry"), position: ctx.get(id, "position"), props: { axis: ctx.get(id, "props.axis") } };
    const req = solidRequest(node);
    // a skinned loft's own volume is a thin-wall estimate; the kernel builds its outer solid,
    // which ConKay also has exactly — compare like with like
    const skinned = node.geometry?.shape === "loft" && node.geometry.skin > 0;
    const exact = skinned ? node.geometry.derived.solidVolume : geometryVolumeM3(node.geometry);
    if (!req || !(exact > 0)) return { notComputed: "no solid to build" };
    const key = `solid:${crypto.createHash("sha256").update(JSON.stringify(req)).digest("hex").slice(0, 32)}`;
    const r = requestKernel(key, async () => {
      const out = await runSolids([req]);
      if (!out.ok) return { ok: false, error: out.unavailable || out.error };
      const p = out.parts?.[0];
      return p?.ok ? { ok: true, volume: p.volume, area: p.area } : { ok: false, error: p?.error || "no solid" };
    }, `B-rep solid for ${node.name || id}`);
    if (r.pending) return { notComputed: r.reason };
    if (!r.ok) return { notComputed: r.error };
    const rel = Math.abs(r.volume - exact) / exact;
    return {
      inputs: { shape: { value: node.geometry.shape } },
      outputs: { kernelVolume: { value: r.volume, unit: "m^3" }, exactVolume: { value: exact, unit: "m^3" }, surfaceArea: { value: r.area, unit: "m^2" }, relativeDifference: { value: rel, unit: "1" } },
      margins: [{ check: skinned ? "B-rep volume of the outer solid agrees with ConKay's exact volume" : "B-rep volume agrees with ConKay's exact volume", demand: rel, capacity: AGREEMENT, unit: "fraction", basis: "two independent computations of the same solid" }],
      warnings: skinned ? ["the skin's own volume (and so the mass) is the thin-wall estimate: surface area × skin thickness"] : [],
      assumptions: ["the solid as modelled: no fillets beyond those drawn, no draft, no tolerances"],
    };
  },
});
