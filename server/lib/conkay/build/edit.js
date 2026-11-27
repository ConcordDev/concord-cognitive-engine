// server/lib/conkay/build/edit.js
//
// Working on a build after Kay planned it (owner, 2026-11-27: "3d and
// inspectable and manipulated by the user as long as things pass checks").
// The person changes a size, a material or a load, in any unit; the planned
// design graph is edited, every solver re-runs, and the report and the 3D
// parts come back. No model is involved: an edit is deterministic.
//
//   listParameters(ir) → what can be edited: [{ id, node, nodeName, path, label, value, dim, options? }]
//   applyEdits(ir, edits) → { ok, ir, applied } | { ok:false, errors }
//     edits: [{ id, value }] where id is a parameter id from listParameters.
// Only listed parameters can change; a value must read as the right kind of
// quantity (a length for a size, a force per length for a spread load) and
// a material must be in the library or defined on the design.

import { parseAmount } from "../units/universal.js";
import { MATERIALS } from "../materials/index.js";

const GEOMETRY_DIMS = { length: "length", width: "length", height: "length", thickness: "length", diameter: "length", outerDiameter: "length", wall: "length", flangeWidth: "length", flangeThickness: "length", webThickness: "length", fillet: "length", skin: "length" };
const LABEL = { length: "length", width: "width", height: "height", thickness: "thickness", diameter: "diameter", outerDiameter: "outside diameter", wall: "wall", flangeWidth: "flange width", flangeThickness: "flange thickness", webThickness: "web thickness", fillet: "corner fillet", skin: "skin thickness" };
const clone = (o) => JSON.parse(JSON.stringify(o));
const pid = (node, path) => `${node}:${path.join(".")}`;

/** Every value a person can change on this build. Values are as written (their units). */
export function listParameters(ir) {
  const out = [];
  const custom = Object.keys(ir?.materials || {});
  const materialOptions = [...new Set([...custom, ...Object.keys(MATERIALS)])];
  for (const n of ir?.nodes || []) {
    const name = n.name || n.id;
    if (n.geometry && typeof n.geometry === "object") {
      for (const [k, v] of Object.entries(n.geometry)) {
        if (k === "shape" || !GEOMETRY_DIMS[k] || v == null) continue;
        out.push({ id: pid(n.id, ["geometry", k]), node: n.id, nodeName: name, path: ["geometry", k], label: LABEL[k] || k, value: String(v), dim: GEOMETRY_DIMS[k] });
      }
    }
    // a loft's sections: each station's size
    if (n.geometry?.shape === "loft" && Array.isArray(n.geometry.sections)) {
      n.geometry.sections.forEach((sec, i) => {
        for (const k of ["chord", "width", "height"]) {
          if (sec?.[k] == null) continue;
          out.push({ id: pid(n.id, ["geometry", "sections", i, k]), node: n.id, nodeName: name, path: ["geometry", "sections", i, k], label: `section ${i + 1} ${k}`, value: String(sec[k]), dim: "length" });
        }
      });
    }
    if (typeof n.material === "string" && n.geometry) {
      out.push({ id: pid(n.id, ["material"]), node: n.id, nodeName: name, path: ["material"], label: "material", value: n.material, dim: "material", options: materialOptions });
    }
    const fm = n.props?.frameModel;
    if (fm && Array.isArray(fm.loadCases)) {
      fm.loadCases.forEach((c, ci) => {
        (c.udl || []).forEach((u, ui) => (u.w || []).forEach((w, wi) => {
          if (w == null || Number(w) === 0) return;
          out.push({ id: pid(n.id, ["props", "frameModel", "loadCases", ci, "udl", ui, "w", wi]), node: n.id, nodeName: name, path: ["props", "frameModel", "loadCases", ci, "udl", ui, "w", wi], label: `${c.id || `case ${ci + 1}`}: spread load on ${u.member} (${"xyz"[wi]})`, value: String(w), dim: "force_per_length" });
        }));
        (c.nodal || []).forEach((l, li) => (l.F || []).forEach((f, fi) => {
          if (f == null || Number(f) === 0) return;
          out.push({ id: pid(n.id, ["props", "frameModel", "loadCases", ci, "nodal", li, "F", fi]), node: n.id, nodeName: name, path: ["props", "frameModel", "loadCases", ci, "nodal", li, "F", fi], label: `${c.id || `case ${ci + 1}`}: force at ${l.node} (${"xyz"[fi]})`, value: String(f), dim: "force" });
        }));
      });
      if (fm.factorOfSafety?.value != null) {
        out.push({ id: pid(n.id, ["props", "frameModel", "factorOfSafety", "value"]), node: n.id, nodeName: name, path: ["props", "frameModel", "factorOfSafety", "value"], label: "safety factor", value: String(fm.factorOfSafety.value), dim: "ratio" });
      }
    }
  }
  return out;
}

function setPath(obj, path, value) {
  let o = obj;
  for (let i = 0; i < path.length - 1; i++) { o = o?.[path[i]]; if (o == null) return false; }
  if (!(path[path.length - 1] in o)) return false;
  o[path[path.length - 1]] = value;
  return true;
}

/** Apply edits by parameter id. Values keep the person's units. */
export function applyEdits(ir, edits) {
  if (!Array.isArray(edits) || !edits.length) return { ok: false, errors: ["no edits"] };
  const params = new Map(listParameters(ir).map((p) => [p.id, p]));
  const next = clone(ir);
  const errors = []; const applied = [];
  for (const e of edits.slice(0, 50)) {
    const p = params.get(String(e?.id));
    if (!p) { errors.push(`"${e?.id}" is not an editable value on this build`); continue; }
    const raw = typeof e.value === "number" ? e.value : String(e.value ?? "").trim();
    if (raw === "") { errors.push(`${p.nodeName} ${p.label}: empty`); continue; }
    let value = raw;
    if (p.dim === "material") {
      if (!p.options.includes(String(raw))) { errors.push(`${p.nodeName} material: "${raw}" is not a library material or one defined on this design`); continue; }
    } else if (p.dim === "ratio") {
      const n = Number(raw);
      if (!(n > 0)) { errors.push(`${p.nodeName} ${p.label}: a positive number`); continue; }
      value = n;
    } else {
      const r = parseAmount(raw, { expectDim: p.dim });
      if (!r.ok) { errors.push(`${p.nodeName} ${p.label}: ${r.error}`); continue; }
      if (p.dim === "length" && !(r.si > 0)) { errors.push(`${p.nodeName} ${p.label}: must be more than zero`); continue; }
      // A load keeps its direction: a downward spread load stays downward when typed as "60 lbf/ft".
      if ((p.dim === "force" || p.dim === "force_per_length") && typeof raw === "string" && !/^\s*-/.test(raw)) {
        const was = parseAmount(p.value, { expectDim: p.dim });
        if (was.ok && was.si < 0) value = `-${raw}`;
      }
    }
    if (!setPath(next.nodes.find((n) => n.id === p.node), p.path, value)) { errors.push(`${p.nodeName} ${p.label}: could not be set`); continue; }
    applied.push({ id: p.id, node: p.node, label: p.label, from: p.value, to: String(value) });
    if (p.path.join(".") === "geometry.length") followMemberLength(next, p.node, value, applied);
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, ir: next, applied };
}

const num = (v, dim) => { const r = parseAmount(v ?? 0, { expectDim: dim }); return r.ok ? r.si : NaN; };

/**
 * A part that is one frame member: its new length moves the member's far end
 * along the member, when that end belongs to this member alone (a support or
 * a free end). A shared joint is left where it is; the report then says the
 * part and the span disagree.
 */
function followMemberLength(ir, partId, lengthValue, applied) {
  const L = num(lengthValue, "length");
  if (!(L > 0)) return;
  for (const n of ir.nodes) {
    const fm = n.props?.frameModel;
    if (!fm?.members) continue;
    const ms = fm.members.filter((m) => m.part === partId);
    if (ms.length !== 1) continue;
    const m = ms[0];
    const uses = (id) => fm.members.filter((x) => x.i === id || x.j === id).length;
    const ni = fm.nodes.find((x) => x.id === m.i), nj = fm.nodes.find((x) => x.id === m.j);
    if (!ni || !nj) continue;
    const [move, fixed] = uses(nj.id) === 1 ? [nj, ni] : uses(ni.id) === 1 ? [ni, nj] : [null, null];
    if (!move) continue;
    const a = ["x", "y", "z"].map((k) => num(fixed[k], "length")), b = ["x", "y", "z"].map((k) => num(move[k], "length"));
    const d = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    if (!(d > 0)) continue;
    ["x", "y", "z"].forEach((k, i) => { move[k] = Number((a[i] + ((b[i] - a[i]) * L) / d).toPrecision(9)); });
    applied.push({ id: `${n.id}:frame.${move.id}`, node: n.id, label: `frame joint ${move.id} moved to keep member ${m.id} as long as the part`, from: `${d} m`, to: `${L} m` });
  }
}

/** Parts that are frame members but whose length no longer matches the span they model. */
export function memberLengthMismatches(compiledGraph) {
  const out = [];
  for (const n of compiledGraph.nodes.values()) {
    const fm = n.props?.frameModel;
    if (!fm?.members) continue;
    for (const m of fm.members) {
      const part = m.part ? compiledGraph.node(m.part) : null;
      const L = part?.geometry?.length;
      const ni = fm.nodes.find((x) => x.id === m.i), nj = fm.nodes.find((x) => x.id === m.j);
      if (!(L > 0) || !ni || !nj) continue;
      const d = Math.hypot(nj.x - ni.x, nj.y - ni.y, nj.z - ni.z);
      if (Math.abs(d - L) > 0.01 * L) out.push({ target: n.id, member: m.id, part: m.part, spanM: d, lengthM: L });
    }
  }
  return out;
}
