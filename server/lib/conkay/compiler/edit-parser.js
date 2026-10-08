// server/lib/conkay/compiler/edit-parser.js
//
// Plain-language edits → graph operations. Deterministic: it either maps the
// sentence onto { node, path, value } ops it can show, or says what it could
// not read. It never guesses a node or a number. (An LLM can propose the
// sentence; this is what turns it into a checked edit.)
//
//   "make bolt B1 stainless"            → B1.material = iso-3506-a2-70 (noted)
//   "change all bolts to A490"          → every Bolt.material = astm-a490
//   "set plate P1 thickness to 12 mm"   → P1.geometry.thickness = 0.012 m

import { parseQuantity } from "./units.js";
import { resolveMaterialName } from "../materials/index.js";
import { SHAPES } from "./design-ir.js";

const KIND_WORDS = { bolt: "Bolt", bolts: "Bolt", plate: "Plate", plates: "Plate", joint: "Joint", joints: "Joint", part: "Part", parts: "Part", beam: "Beam", beams: "Beam" };
const PARAMS = new Set(Object.values(SHAPES).flat());

function resolveNodes(ref, graph) {
  const words = ref.trim().toLowerCase().split(/\s+/).filter((w) => w !== "the");
  if ((words[0] === "all" || words[0] === "every") && KIND_WORDS[words[1]] && words.length === 2) {
    const nodes = graph.nodesOfKind(KIND_WORDS[words[1]]);
    return nodes.length ? { nodes } : { error: `there are no ${words[1]} in this design` };
  }
  const name = words.filter((w) => !KIND_WORDS[w]).join(" ");
  const hits = [...graph.nodes.values()].filter((n) => n.id.toLowerCase() === name || n.name.toLowerCase() === name);
  if (hits.length === 1) return { nodes: hits };
  if (hits.length > 1) return { error: `"${ref}" matches ${hits.map((n) => n.id).join(", ")}` };
  return { error: `no part called "${ref}"` };
}

export function parseEdit(text, graph) {
  const t = String(text || "").trim().replace(/[.!]$/, "");
  const m = t.match(/^(?:make|change|switch|set|swap)\s+(.+?)\s+(?:to|into|in)\s+(.+)$/i) || t.match(/^(?:make)\s+(.+?)\s+(\S+)$/i);
  if (!m) return { ok: false, error: 'I can read edits like "make bolt B1 stainless" or "set plate P1 thickness to 12 mm".' };
  let [, lhs, rhs] = m;

  // "<ref> <param> to <quantity>"
  const lw = lhs.trim().split(/\s+/);
  const param = lw[lw.length - 1].toLowerCase();
  if (PARAMS.has(param)) {
    const target = resolveNodes(lw.slice(0, -1).join(" "), graph);
    if (target.error) return { ok: false, error: target.error };
    const q = parseQuantity(rhs.trim(), "length");
    if (!q.ok) return { ok: false, error: `${param}: ${q.error}` };
    const ops = [];
    for (const n of target.nodes) {
      if (!n.geometry || !SHAPES[n.geometry.shape].includes(param)) return { ok: false, error: `${n.id} has no ${param}` };
      ops.push({ node: n.id, path: `geometry.${param}`, value: q.si });
    }
    return { ok: true, ops, notes: [] };
  }

  // "<ref> [material] to <material>"
  const target = resolveNodes(lhs.replace(/\s+material$/i, ""), graph);
  if (target.error) return { ok: false, error: target.error };
  const ops = [];
  const notes = new Set();
  for (const n of target.nodes) {
    const r = resolveMaterialName(rhs, { kind: n.kind });
    if (!r) return { ok: false, error: `unknown material "${rhs}"` };
    if (r.note) notes.add(r.note);
    ops.push({ node: n.id, path: "material", value: r.id });
  }
  return { ok: true, ops, notes: [...notes] };
}
