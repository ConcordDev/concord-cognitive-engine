// server/lib/conkay/build/normalize.js
//
// The planner lets the model write any quantity with any unit ("0.9 m",
// "3 ft", "-50 kg" as a weight is NOT allowed — weights are forces). The
// fixed solvers read SI numbers in a few props blocks; this turns the
// planner's strings into those numbers, deterministically, and reports any
// string it cannot read instead of guessing.

import { parseAmount } from "../units/universal.js";

function num(v, dim, where, errors) {
  if (v == null || (typeof v === "number" && Number.isFinite(v))) return v;
  const r = parseAmount(v, { expectDim: dim });
  if (!r.ok) { errors.push(`${where}: ${r.error}`); return v; }
  return r.si;
}
const vec3 = (a, dim, where, errors) => (Array.isArray(a) ? a.map((x, i) => num(x, dim, `${where}[${i}]`, errors)) : a);

function frameModel(fm, where, errors) {
  if (!fm || typeof fm !== "object") return fm;
  const out = { ...fm };
  out.nodes = (fm.nodes || []).map((n, i) => ({ ...n, x: num(n.x ?? 0, "length", `${where}.nodes[${i}].x`, errors), y: num(n.y ?? 0, "length", `${where}.nodes[${i}].y`, errors), z: num(n.z ?? 0, "length", `${where}.nodes[${i}].z`, errors) }));
  out.loadCases = (fm.loadCases || []).map((c, i) => ({
    ...c,
    ...(c.nodal ? { nodal: c.nodal.map((l, k) => ({ ...l, F: vec3(l.F, "force", `${where}.loadCases[${i}].nodal[${k}].F`, errors), ...(l.M ? { M: vec3(l.M, "torque", `${where}.loadCases[${i}].nodal[${k}].M`, errors) } : {}) })) } : {}),
    ...(c.udl ? { udl: c.udl.map((l, k) => ({ ...l, w: vec3(l.w, "force_per_length", `${where}.loadCases[${i}].udl[${k}].w`, errors) })) } : {}),
  }));
  if (fm.factorOfSafety != null && typeof fm.factorOfSafety !== "object") out.factorOfSafety = { value: Number(fm.factorOfSafety), basis: "stated" };
  if (out.factorOfSafety && typeof out.factorOfSafety.value === "string") out.factorOfSafety = { ...out.factorOfSafety, value: Number(out.factorOfSafety.value) };
  return out;
}

const VESSEL_KEYS = [
  ["innerRadius", "innerRadiusM", "length"], ["wallThickness", "wallThicknessM", "length"], ["length", "lengthM", "length"],
  ["workingPressure", "nwpPa", "pressure"], ["nwp", "nwpPa", "pressure"],
];
function pressureVessel(v, where, errors) {
  if (!v || typeof v !== "object") return v;
  const out = { ...v };
  for (const [from, to, dim] of VESSEL_KEYS) if (v[from] != null && v[to] == null) { out[to] = num(v[from], dim, `${where}.${from}`, errors); delete out[from]; }
  for (const k of ["innerRadiusM", "wallThicknessM", "lengthM"]) if (typeof out[k] === "string") out[k] = num(out[k], "length", `${where}.${k}`, errors);
  if (typeof out.nwpPa === "string") out.nwpPa = num(out.nwpPa, "pressure", `${where}.nwpPa`, errors);
  const ws = v.wallStrength || v.wallStrengthPa;
  if (ws && typeof ws === "object") { out.wallStrengthPa = { ...ws, lo: num(ws.lo, "pressure", `${where}.wallStrength.lo`, errors), hi: num(ws.hi ?? ws.lo, "pressure", `${where}.wallStrength.hi`, errors) }; delete out.wallStrength; }
  return out;
}

function chemistry(c, where, errors) {
  if (!c || typeof c !== "object") return c;
  return { ...c, ...(c.T0 != null ? { T0: num(c.T0, "temperature", `${where}.T0`, errors) } : {}), ...(c.P0 != null ? { P0: num(c.P0, "pressure", `${where}.P0`, errors) } : {}) };
}

/** Normalise a planned IR's solver props to SI. Returns { ir, errors }. */
export function normalizePlan(ir) {
  const errors = [];
  if (!ir || !Array.isArray(ir.nodes)) return { ir, errors };
  const nodes = ir.nodes.map((n) => {
    if (!n?.props) return n;
    const p = { ...n.props };
    const w = `nodes(${n.id}).props`;
    if (p.frameModel) p.frameModel = frameModel(p.frameModel, `${w}.frameModel`, errors);
    if (p.pressureVessel) p.pressureVessel = pressureVessel(p.pressureVessel, `${w}.pressureVessel`, errors);
    if (p.chemistry) p.chemistry = chemistry(p.chemistry, `${w}.chemistry`, errors);
    return { ...n, props: p };
  });
  return { ir: { edges: [], loadCases: [], requirements: [], ...ir, nodes }, errors };
}
