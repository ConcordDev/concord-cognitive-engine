// server/lib/conkay/cad/bom-structure.js
//
// SX-CAD-08 — cad.bom-structure: multi-level bill of materials
// (catalogue wave 0, PRG-17). Engine: JS — there is no engine tier
// on this ticket; the roll-up is exact arithmetic over declared
// structure. Today's erp-bom.js (ERP-shaped export over the assembly
// store) and assembly-export.js's buildBom stay as they are; this
// solver is the registry form: a nested BOM tied to geometry, whose
// leaf masses come from cad.mass-properties-brep — the same path
// orc.mass-bom (SX-ORC-07) rolls up, so a part's mass agrees across
// the stack.
//
// Roll-up rules (all declared, none silent):
//
//   - A LEAF line carries massProperties (the CAD-03 input shape);
//     its unit mass is that solver's massKg. A line with children
//     rolls its unit mass up from them: Σ child.qty × child unit
//     mass. A line carrying BOTH children and massProperties is
//     refused, named — its mass would be ambiguous.
//   - An unresolvable leaf (unknown material, no declared density,
//     bad dims) is UNMASSED with cad.mass-properties-brep's reason
//     carried verbatim; the null propagates up through every
//     ancestor, and the total is null beside a labelled partial
//     subtotal. Nothing is treated as zero-mass in secret.
//   - Cost follows the reference case's second clause — UNPRICED
//     STAYS NULL. A line with a declared unitCost is priced as
//     purchased: its extended cost is qty × unitCost and its
//     children's costs are NOT rolled into it (the price already
//     includes them; the children still count for mass and
//     structure). An unpriced line's cost is the sum of its
//     children's extended costs when every descendant is priced,
//     else null. The total follows the same discipline: null with
//     a labelled priced subtotal whenever anything is unpriced.
//   - Item numbers are hierarchical ("1", "1.1", "1.2", "2") — the
//     multi-level form of the balloons cad.drawings-detail
//     (SX-CAD-07) numbers flat per drawing set.
//   - Quantities are required and explicit — no silent qty = 1.
//     The same part id may appear under different parents (each
//     occurrence is its own line, counted each time); duplicates
//     among siblings are refused, named.
//
// Depth is capped at 32 levels and the tree at 10,000 lines —
// pathological nesting refuses, named, rather than recursing.

import { registerSolver } from "../physics/registry.js";
import { massPropertiesBrep } from "./mass-properties-brep.js";

const NS = "cad.bomStructure";
const MAX_DEPTH = 32;
const MAX_LINES = 10000;

/** The pure solver function. Exported for direct testing. */
export function bomStructure(props = {}) {
  const items = props?.items;
  if (!Array.isArray(items) || items.length === 0) {
    return { notComputed: "missing_input:items", inputs: {} };
  }
  let currency = null;
  if (props?.currency != null) {
    if (typeof props.currency !== "string" || !props.currency) {
      return { notComputed: "INVALID_INPUT: currency must be a non-empty string when given", inputs: {} };
    }
    currency = props.currency;
  }

  const lines = [];
  const unmassedLines = [];
  const unpricedLines = [];
  let lineCount = 0;

  // Returns {unitMassKg|null, unitCost|null} for the subtree, or
  // {error} for a structural refusal.
  function walk(list, prefix, depth) {
    if (depth > MAX_DEPTH) return { error: `INVALID_INPUT: BOM nesting exceeds ${MAX_DEPTH} levels at item ${prefix}` };
    const siblingIds = new Set();
    const results = [];
    for (let i = 0; i < list.length; i++) {
      const itemNo = prefix ? `${prefix}.${i + 1}` : `${i + 1}`;
      const it = list[i];
      if (!it || typeof it.id !== "string" || !it.id) {
        return { error: `INVALID_INPUT: items at ${itemNo} must carry a non-empty string id` };
      }
      if (siblingIds.has(it.id)) {
        return { error: `INVALID_INPUT: duplicate sibling id "${it.id}" at item ${itemNo} — merge the lines and sum the quantity` };
      }
      siblingIds.add(it.id);
      if (it.qty == null) {
        return { error: `missing_input:items qty for "${it.id}" (item ${itemNo}) — quantities are explicit, never defaulted` };
      }
      const qty = Number(it.qty);
      if (!Number.isFinite(qty) || qty <= 0 || Math.abs(qty) >= 1e300) {
        return { error: `INVALID_INPUT: qty for "${it.id}" (item ${itemNo}) must be a positive finite number` };
      }
      let declaredCost = null;
      if (it.unitCost != null) {
        const c = Number(it.unitCost);
        if (!Number.isFinite(c) || c < 0 || Math.abs(c) >= 1e300) {
          return { error: `INVALID_INPUT: unitCost for "${it.id}" (item ${itemNo}) must be a non-negative finite number or null` };
        }
        declaredCost = c;
      }
      const children = Array.isArray(it.children) && it.children.length ? it.children : null;
      if (children && it.massProperties != null) {
        return { error: `INVALID_INPUT: "${it.id}" (item ${itemNo}) carries both children and massProperties — an assembly's mass rolls up from its children; a purchased assembly declares unitCost, not massProperties` };
      }
      lineCount += 1;
      if (lineCount > MAX_LINES) return { error: `INVALID_INPUT: BOM exceeds ${MAX_LINES} lines` };
      // Reserve this line's slot BEFORE recursing so `lines` stays in
      // document (pre-order) order — parents print before their
      // children, the way a BOM reads. The named lists
      // (unmassedLines/unpricedLines) stay in discovery order: the
      // root-cause leaf is named before the ancestors it nulls.
      const slot = lines.length;
      lines.push(null);

      let unitMass = null;
      let massReason = null;
      let childResults = null;
      if (children) {
        const sub = walk(children, itemNo, depth + 1);
        if (sub.error) return sub;
        childResults = sub.results;
        if (sub.results.every((r) => r.unitMassKg != null)) {
          unitMass = sub.results.reduce((s, r) => s + r.qty * r.unitMassKg, 0);
        } else {
          massReason = "a descendant line is unmassed (named in unmassedLines)";
        }
      } else {
        if (!it.massProperties || typeof it.massProperties !== "object") {
          return { error: `missing_input:massProperties for leaf "${it.id}" (item ${itemNo})` };
        }
        const mp = massPropertiesBrep(it.massProperties);
        if (mp.notComputed) {
          massReason = mp.notComputed;
        } else {
          unitMass = mp.outputs.massKg;
        }
      }
      if (unitMass == null) unmassedLines.push({ item: itemNo, id: it.id, reason: massReason });

      let unitCost = declaredCost;
      let costReason = null;
      if (unitCost == null) {
        if (childResults && childResults.every((r) => r.extendedCost != null)) {
          // Children quantities are per ONE parent unit, so one parent
          // unit costs the sum of the children's extended costs.
          unitCost = childResults.reduce((s, r) => s + r.extendedCost, 0);
        } else if (childResults) {
          costReason = "unpriced: a descendant line is unpriced (named in unpricedLines)";
        } else {
          costReason = "unpriced: no unitCost declared";
        }
      }
      const extendedCost = unitCost == null ? null : qty * unitCost;
      if (extendedCost == null) unpricedLines.push({ item: itemNo, id: it.id, reason: costReason });
      const row = {
        item: itemNo,
        id: it.id,
        qty,
        depth,
        unitMassKg: unitMass,
        extendedMassKg: unitMass == null ? null : qty * unitMass,
        unitCost,
        extendedCost,
        ...(massReason ? { massReason } : {}),
        ...(costReason ? { costReason } : {}),
      };
      lines[slot] = row;
      results.push({ qty, unitMassKg: unitMass, extendedCost });
    }
    return { results };
  }

  const top = walk(items, "", 1);
  if (top.error) return { notComputed: top.error, inputs: {} };

  const massed = lines.filter((l) => l.extendedMassKg != null);
  const totalMassKg = unmassedLines.length === 0
    ? top.results.reduce((s, r) => s + r.qty * r.unitMassKg, 0)
    : null;
  const massedSubtotalKg = lines.filter((l) => l.depth === 1 && l.extendedMassKg != null)
    .reduce((s, l) => s + l.extendedMassKg, 0);
  const pricedTop = lines.filter((l) => l.depth === 1 && l.extendedCost != null);
  const totalCost = unpricedLines.length === 0
    ? lines.filter((l) => l.depth === 1).reduce((s, l) => s + l.extendedCost, 0)
    : null;
  const pricedSubtotal = pricedTop.reduce((s, l) => s + l.extendedCost, 0);

  const warnings = [];
  if (unmassedLines.length) warnings.push(`${unmassedLines.length} line(s) unmassed — totalMassKg is null; massedSubtotalKg covers only the massed top-level lines and is labelled partial`);
  if (unpricedLines.length) warnings.push(`${unpricedLines.length} line(s) unpriced — totalCost is null (unpriced stays null); pricedSubtotal covers only priced top-level lines and is labelled partial`);

  return {
    inputs: { items, ...(currency ? { currency } : {}) },
    outputs: {
      lines,
      lineCount,
      maxDepth: Math.max(...lines.map((l) => l.depth)),
      totalMassKg,
      massedSubtotalKg,
      totalCost,
      pricedSubtotal,
      currency,
      unmassedLines,
      unpricedLines,
      costRule: "a line with a declared unitCost is priced as purchased (children count for mass and structure, not cost); an unpriced line rolls its children's costs only when every descendant is priced; totals are null beside labelled partial subtotals whenever any line is unmassed or unpriced",
      balloonLink: "item numbers are the multi-level balloon keys — cad.drawings-detail (SX-CAD-07) numbers balloons flat per drawing set in the same order",
    },
    assumptions: [],
    warnings,
  };
}

// Local targets/run pair (literal-key discipline; graph-adapter finding
// filed under SX-ORC-01).
function bsTargets(graph) {
  if (!graph || !graph.nodes) return [];
  const out = [];
  for (const [id, node] of graph.nodes) {
    if (node && node.props && node.props[NS]) out.push(id);
  }
  return out;
}

function bsRun(ctx, id) {
  let all = null;
  try {
    all = ctx.get(id, "props");
  } catch {
    all = null;
  }
  const props = all ? all[NS] : null;
  if (!props || (typeof props === "object" && !Array.isArray(props) && Object.keys(props).length === 0)) {
    return { notComputed: `props.${NS} is empty or absent on node ${id}`, inputs: {} };
  }
  return bomStructure(props);
}

registerSolver({
  id: "cad.bom-structure",
  version: "1.0.0",
  domain: "cad",
  domains: ["cad"],
  method: "bom-structure.tree-rollup",
  fidelity: 2,
  engineDependent: [],
  regime: "nested BOMs to 32 levels / 10,000 lines; leaf masses from the exact analytic set (the CAD-03 solver's shapes and density paths); costs are declared inputs, never estimated",
  units: "mass in kilograms (cad.mass-properties-brep); quantities dimensionless counts (fractional quantities allowed for bulk material); costs in the declared currency, or unitless when currency is null",
  tolerance: "roll-up arithmetic is exact over the leaf values cad.mass-properties-brep returns; those carry IEEE-754 rounding from the analytic forms, so totals agree with the hand sum to ~1e-9 kg — and a total is null, never approximated, whenever any contributing line is unmassed or unpriced",
  screening: false,
  reference: "reference case (BOM mass = sum of part masses through the tree; unpriced stays null) in server/tests/conkay-cad-bom-structure.test.js",
  graphProp: NS,
  targets: bsTargets,
  run: bsRun,
});

export default { bomStructure };
