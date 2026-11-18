// server/lib/conkay/cad/drawings-detail.js
//
// SX-CAD-07 — cad.drawings-detail: detail and assembly drawings
// (catalogue wave 0, PRG-17). Target tier L2 is the RENDERED sheet —
// orthographic projection with hidden-line removal and section views
// from the OCC HLR kernel (cad/drawing-kernel.js). That engine is not
// available in this lane, so EVERY run carries the rendered tier as
// NOT_COMPUTED engine_unavailable:sxe-06 (the OCC engine family, as
// declared by cad.part-geometry), never a plan labelled as a
// rendering. The GA sheets under drawings/* stay as they are.
//
// What this solver computes now is the sheet PLAN, and the plan is
// the part of a drawing set that review actually checks first:
//
//   - one sheet per part — every part has a sheet (the reference
//     case's first clause);
//   - dimensions RE-MEASURED from the part's solid: the dims are
//     validated through cad.mass-properties-brep's exactSolid (its
//     own field-named errors), then the per-shape extents are taken
//     from those validated dims. A caller-declared `claimed` extent
//     set is checked against the re-measure and every disagreement
//     beyond tolerance is named in outputs.discrepancies — a drawing
//     whose numbers disagree with the solid is exactly what review
//     exists to catch, so it is reported, never silently corrected;
//   - GD&T callouts carried per part, validated against the
//     GD&T characteristic vocabulary (the 14 ASME Y14.5 symbols,
//     mirroring assembly-drawing.js's GDT_SYMBOLS — see the table
//     below; an unknown symbol refuses the run, named);
//   - balloons numbered in input order, which is the BOM order
//     SX-CAD-08 formalizes (named in the outputs as bomLink).
//
// Units: solids are declared in metres (cad.mass-properties-brep's
// contract); drawing dimensions are reported in millimetres by the
// exact ×1000 conversion, with the source dims echoed as submitted
// (SC-04). Parts outside the exact analytic set still get their
// sheet — with dimensionStatus "not_measured" and the reason named;
// the OCC tier measures those.

import { registerSolver } from "../physics/registry.js";
import { exactSolid } from "./mass-properties-brep.js";

// The GD&T characteristic vocabulary — the 14 ASME Y14.5 geometric
// characteristics, mirroring assembly-drawing.js's GDT_SYMBOLS (the
// drawing model's home) key-for-key with glyphs. Carried locally on
// purpose: importing assembly-drawing.js would drag pdfkit and the
// assembly store into this solver's module graph, and a registry
// solver must stay hermetic. Both tables answer to the same closed
// standard set; a divergence between them is a defect in either home.
const GDT_SYMBOLS = Object.freeze({
  perpendicular: "⊥",
  parallel: "∥",
  position: "⌖",
  concentricity: "◎",
  flatness: "▱",
  circularity: "○",
  cylindricity: "⌭",
  angularity: "∠",
  symmetry: "⌯",
  runout: "↗",
  total_runout: "⇉",
  straightness: "⏤",
  profile_line: "⌒",
  profile_surface: "⌓",
});

const NS = "cad.drawingsDetail";

// Extents per exact-set shape, from exactSolid's VALIDATED dims
// (metres). One entry per shape in mass-properties-brep's exact set.
const EXTENTS = {
  box: (d) => ({ x: d.length, y: d.width, z: d.height }),
  cylinder: (d) => ({ x: 2 * d.radius, y: 2 * d.radius, z: d.height }),
  sphere: (d) => ({ x: 2 * d.radius, y: 2 * d.radius, z: 2 * d.radius }),
  tube: (d) => ({ x: 2 * d.outerRadius, y: 2 * d.outerRadius, z: d.height }),
};

const ENGINE_TIER = {
  requested: "L2-rendered",
  status: "NOT_COMPUTED",
  reason: "engine_unavailable:sxe-06",
  hint: "rendered sheets (OCC HLR projection, hidden-line removal, section views via cad/drawing-kernel.js) ride the OCC engine family (SXE-06); this solver returns the sheet plan with re-measured dimensions",
};

const CLAIM_TOLERANCE_MM = 1e-6;

/** The pure solver function. Exported for direct testing. */
export function drawingsDetail(props = {}) {
  const parts = props?.parts;
  if (!Array.isArray(parts) || parts.length === 0) {
    return { notComputed: "missing_input:parts", inputs: {} };
  }
  const ids = new Set();
  const sheets = [];
  const discrepancies = [];
  const warnings = [`rendered-sheet tier NOT_COMPUTED: ${ENGINE_TIER.reason} (sheet plan reported beside it, labelled)`];
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (!p || typeof p.id !== "string" || !p.id) {
      return { notComputed: `INVALID_INPUT: parts[${i}].id must be a non-empty string`, inputs: {} };
    }
    if (ids.has(p.id)) {
      return { notComputed: `INVALID_INPUT: parts[${i}].id duplicates "${p.id}"`, inputs: {} };
    }
    ids.add(p.id);
    if (!p.solid || typeof p.solid.shape !== "string") {
      return { notComputed: `missing_input:parts[${i}].solid.shape`, inputs: {} };
    }
    // GD&T callouts: vocabulary-checked against the drawing model.
    const callouts = [];
    const gdt = p.gdt === undefined ? [] : p.gdt;
    if (!Array.isArray(gdt)) {
      return { notComputed: `INVALID_INPUT: parts[${i}].gdt must be an array`, inputs: {} };
    }
    for (let k = 0; k < gdt.length; k++) {
      const g = gdt[k];
      if (!g || !(g.symbol in GDT_SYMBOLS)) {
        return {
          notComputed: `INVALID_INPUT: parts[${i}].gdt[${k}].symbol "${g?.symbol}" is not in the GD&T vocabulary (${Object.keys(GDT_SYMBOLS).join(", ")})`,
          inputs: {},
        };
      }
      const v = Number(g.value);
      if (!Number.isFinite(v) || v <= 0 || Math.abs(v) >= 1e300) {
        return { notComputed: `INVALID_INPUT: parts[${i}].gdt[${k}].value must be a positive finite tolerance in mm`, inputs: {} };
      }
      callouts.push({ symbol: g.symbol, glyph: GDT_SYMBOLS[g.symbol], valueMm: v, datum: g.datum ?? null, feature: g.feature ?? null });
    }
    // Dimensions re-measured from the solid (validated dims only).
    const got = exactSolid(p.solid.shape, p.solid.dims || {});
    let dimensions = [];
    let dimensionStatus = "measured";
    let dimensionNote = null;
    if (got.error) {
      if (!String(got.error).startsWith("shape_not_in_exact_set")) {
        return { notComputed: `INVALID_INPUT: parts[${i}].solid — ${got.error}`, inputs: {} };
      }
      dimensionStatus = "not_measured";
      dimensionNote = `${got.error}; the OCC tier measures this shape — the sheet carries no dimensions rather than unmeasured ones`;
    } else {
      const ext = EXTENTS[p.solid.shape](got.dims);
      dimensions = ["x", "y", "z"].map((axis) => ({ axis, valueMm: ext[axis] * 1000, source: "re-measured from the part's analytic solid (exactSolid validated dims)" }));
      if (p.claimed != null) {
        for (const axis of ["x", "y", "z"]) {
          const c = Number(p.claimed[axis]);
          if (!Number.isFinite(c)) {
            return { notComputed: `INVALID_INPUT: parts[${i}].claimed.${axis} must be a finite extent in mm when claimed is given`, inputs: {} };
          }
          const measured = ext[axis] * 1000;
          if (Math.abs(c - measured) > CLAIM_TOLERANCE_MM) {
            discrepancies.push({ partId: p.id, axis, claimedMm: c, measuredMm: measured });
          }
        }
      }
    }
    sheets.push({
      partId: p.id,
      balloon: i + 1,
      views: ["front", "top", "side"],
      sections: "rendered tier (NOT_COMPUTED with the sheet rendering)",
      dimensionStatus,
      dimensionNote,
      dimensions,
      gdtCallouts: callouts,
    });
  }
  if (discrepancies.length) {
    warnings.push(`${discrepancies.length} claimed dimension(s) disagree with the re-measure beyond ${CLAIM_TOLERANCE_MM} mm — named in discrepancies, NOT silently corrected`);
  }
  const unmeasured = sheets.filter((s) => s.dimensionStatus === "not_measured");
  if (unmeasured.length) {
    warnings.push(`${unmeasured.length} part(s) outside the exact analytic set carry sheets without dimensions (named per sheet)`);
  }
  return {
    inputs: { parts },
    outputs: {
      engineTier: ENGINE_TIER,
      planOnly: true,
      sheetCount: sheets.length,
      sheets,
      discrepancies,
      bomLink: "balloon numbers follow the input parts order — the BOM order SX-CAD-08 (cad.bom-structure) formalizes",
      unitsNote: "solid dims are declared in metres (cad.mass-properties-brep); sheet dimensions are millimetres by the exact x1000 conversion",
    },
    assumptions: [],
    warnings,
  };
}

// Local targets/run pair (literal-key discipline; graph-adapter finding
// filed under SX-ORC-01).
function ddTargets(graph) {
  if (!graph || !graph.nodes) return [];
  const out = [];
  for (const [id, node] of graph.nodes) {
    if (node && node.props && node.props[NS]) out.push(id);
  }
  return out;
}

function ddRun(ctx, id) {
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
  return drawingsDetail(props);
}

registerSolver({
  id: "cad.drawings-detail",
  version: "1.0.0",
  domain: "cad",
  domains: ["cad"],
  method: "drawings-detail.sheet-plan+remeasure",
  fidelity: 2,
  engineDependent: ["sxe-06"],
  regime: "parts in the exact analytic set (box, cylinder, sphere, tube) are dimensioned from their solids; other shapes receive sheets without dimensions, named; GD&T callouts are drafting callouts in the assembly-drawing vocabulary, not CMM certification",
  units: "solid dims in metres (echoed as submitted); sheet dimensions and GD&T tolerance values in millimetres (exact x1000 conversion)",
  tolerance: "dimensions are exact analytic extents; a claimed extent disagreeing with the re-measure by more than 1e-6 mm is named as a discrepancy",
  screening: false,
  reference: "reference case (every part has a sheet; dimensions re-measure from the solid) in server/tests/conkay-cad-drawings-detail.test.js; GD&T vocabulary from assembly-drawing.js (GDT_SYMBOLS)",
  graphProp: NS,
  targets: ddTargets,
  run: ddRun,
});

export default { drawingsDetail };
