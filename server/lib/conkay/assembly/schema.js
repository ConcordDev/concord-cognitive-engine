// server/lib/conkay/assembly/schema.js
//
// The parametric vehicle assembly is the serializable source of truth for a
// design: placements, envelopes or solids, relationships and the provenance of
// every driving value. Drawings and the 3D viewer are projections of this
// document. A convincing shape is not a manufactured part.

export const ASSEMBLY_SCHEMA = "conkay.vehicle-assembly/1";

export const COORDINATE_SYSTEM = Object.freeze({
  convention: "SAE J1100 / ISO 4130 axis sense",
  axes: { x: "rearward", y: "to the right", z: "up" },
  origin: "Ground is z = 0. x = 0 is the design origin ahead of the nose, the same frame the layout solvers use. The front-axle ground point is (frontAxleX, 0, 0); subtract frontAxleX to read stations from the front axle.",
  units: "m",
});

const PROVENANCE = new Set(["sourced", "calculated", "estimated", "assumed"]);
const GEOMETRY = new Set(["solid", "envelope"]);
const REL = new Set(["mounted-to", "aligned-to", "constrained-by", "clears"]);

/**
 * Structural check. Returns { ok, errors }. Does not judge whether a value is
 * a good design, only whether the document is a readable assembly.
 */
export function validateAssembly(doc) {
  const errors = [];
  if (!doc || typeof doc !== "object") return { ok: false, errors: ["assembly is not an object"] };
  if (doc.schema !== ASSEMBLY_SCHEMA) errors.push(`schema must be ${ASSEMBLY_SCHEMA}`);
  if (!doc.coordinateSystem?.axes || doc.coordinateSystem.units !== "m") errors.push("coordinateSystem must state metres and the axis sense");
  if (!Array.isArray(doc.components) || doc.components.length === 0) errors.push("components must be a non-empty list");
  const ids = new Set();
  for (const c of doc.components || []) {
    if (!c.id || ids.has(c.id)) errors.push(`component id missing or duplicated (${c.id})`);
    ids.add(c.id);
    const p = c.placement;
    if (!p || [p.x, p.y, p.z].some((n) => !Number.isFinite(n))) errors.push(`${c.id}: placement x,y,z must be finite metres`);
    if (!GEOMETRY.has(c.geometry?.kind)) errors.push(`${c.id}: geometry.kind must be solid or envelope`);
    if (c.geometry.kind === "envelope" && !c.geometry.label) errors.push(`${c.id}: an envelope must say it is not a manufactured solid`);
    for (const param of c.parameters || []) {
      if (!PROVENANCE.has(param.provenance?.state)) errors.push(`${c.id}.${param.id}: provenance state must be sourced, calculated, estimated or assumed`);
    }
    for (const r of c.relationships || []) {
      if (!REL.has(r.kind)) errors.push(`${c.id}: unknown relationship ${r.kind}`);
    }
  }
  for (const c of doc.components || []) {
    for (const r of c.relationships || []) {
      if (r.target && !ids.has(r.target)) errors.push(`${c.id}: relationship target ${r.target} is not a component`);
    }
  }
  if (!Array.isArray(doc.checks)) errors.push("checks must be a list");
  for (const k of doc.checks || []) {
    if (!["pass", "warn", "fail"].includes(k.status)) errors.push(`${k.id}: status must be pass, warn or fail`);
  }
  return { ok: errors.length === 0, errors };
}
