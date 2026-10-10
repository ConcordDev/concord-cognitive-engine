// server/lib/conkay/safety-case/facility-drawing.js
//
// Plant GA drawing of a facility skeleton, generated from the same model the
// facility screen runs on (buildUS600Facility). Revision = the first 8 hex of
// the SHA-256 of the canonical model (SSCs, dependencies, functions, facts,
// layout, gaps, gap sources, conflicts) plus the drawing version, so any change
// to the model gives a new revision and facilityDrawingStatus() can tell
// whether a sheet in hand is current.
//
// What is drawn is only what the model carries with a basis: the bays and the
// containment envelope at the secondary (design-family) dimensions, plus two
// values computed from them under a stated schematic placement. Everything else
// the drawing would normally show is written on it as UNKNOWN. A screening
// drawing of a public-source skeleton: not a plant drawing, not for
// construction, licensing or safety use.

import { createHash } from "node:crypto";
import { validateFacility } from "./facility.js";
import { BANNER } from "./vocabulary.js";
import { buildFacilityGaSheets, pickFacilityScale } from "../drawings/facility-ga.js";
import { toSvg, toPdf } from "../drawings/sheet.js";
import { keepContent } from "../physics/solvers/ga-drawing.js";

export const FACILITY_GA_VERSION = "1.0.0";
const GAP_MM = 4;

const sha = (s) => createHash("sha256").update(s).digest("hex");
const r9 = (v) => Math.round(v * 1e9) / 1e9;
const canonical = (v) => (Array.isArray(v) ? v.map(canonical) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical(v[k])])) : typeof v === "number" ? r9(v) : v);

/** SHA-256 of the canonical facility model plus the drawing version. */
export function facilityModelHash(facility) {
  const { design, ssc, dependencies, functions, facts, layout, gaps, gapSources, conflicts, sources } = facility;
  return sha(JSON.stringify(canonical({ drawing: `facility-ga@${FACILITY_GA_VERSION}`, design, ssc, dependencies, functions, facts, layout, gaps, gapSources, conflicts, sources })));
}

function quoteOf(facility, factId) {
  const f = Object.values(facility.facts).find((x) => x.id === factId);
  return f ? `${f.id} [${f.source}, ${f.locator}]: "${f.quote}"` : null;
}

/** Group SSCs: shared ones one row each, per-module ones by their suffix. */
function sscRows(facility) {
  const rows = [];
  const per = new Map();
  for (const s of facility.ssc) {
    if (s.scope !== "per-module") { rows.push([s.name, s.scope, 1, s.id, s.facts.join(", ")]); continue; }
    const suffix = s.id.replace(/^M\d+:/, "");
    const g = per.get(suffix) || { name: s.name.replace(/module \d+/i, "module n").replace(/power module \d+/i, "power module n"), ids: [], facts: new Set() };
    g.ids.push(s.id);
    s.facts.forEach((f) => g.facts.add(f));
    per.set(suffix, g);
  }
  for (const [suffix, g] of per) rows.push([g.name, "per-module", g.ids.length, `M1..M${g.ids.length}:${suffix}`, [...g.facts].join(", ")]);
  return rows;
}

/**
 * Draw the facility. Returns { ok, revision, modelHash, scale, dims, files, unknown, gaps } or { ok:false, errors }.
 * Refuses an invalid model (unsourced SSC / edge, unknown fact), the same gate as the screen.
 */
export function drawFacility(facility, { number = "CK-GA-US600-PLANT" } = {}) {
  const errors = validateFacility(facility);
  if (errors.length) return { ok: false, errors };
  const L = facility.layout;
  if (!L?.dims) return { ok: false, errors: ["the facility model has no layout"] };
  const ld = L.dims;
  const need = ["baySquareFt", "bayDepthFt", "cnvHeightFt", "cnvDiameterFt"];
  const missing = need.filter((k) => !Number.isFinite(ld[k]?.value));
  if (missing.length) return { ok: false, errors: [`layout dimensions unknown: ${missing.join(", ")} (nothing to draw at scale)`] };

  const src = (k) => ({ valueFt: ld[k].value, basis: ld[k].basis, fact: ld[k].fact, from: quoteOf(facility, ld[k].fact) });
  const dims = {
    baySquare: { ...src("baySquareFt"), label: "Module bay, square side (water)" },
    bayDepth: { ...src("bayDepthFt"), label: "Module bay water depth" },
    cnvHeight: { ...src("cnvHeightFt"), label: "Containment vessel height (nominal)" },
    cnvDiameter: { ...src("cnvDiameterFt"), label: "Containment vessel diameter (nominal)" },
  };
  dims.cnvAboveWater = {
    valueFt: dims.cnvHeight.valueFt - dims.bayDepth.valueFt, basis: "C", label: "CNV top above the pool surface",
    from: "computed: CNV height - bay water depth, with the CNV seated on the bay floor (D, schematic); consistent with the rule's \"partially submerged\" (F-pool), not a sourced elevation",
  };
  dims.radialClearance = {
    valueFt: (dims.baySquare.valueFt - dims.cnvDiameter.valueFt) / 2, basis: "C", label: "Radial clearance, CNV to bay side",
    from: "computed: (bay side - CNV diameter) / 2 from the two S2 nominal values; flanges, supports and guides not modelled",
  };
  for (const [k, id] of [["buildingOutline", "Reactor building outline"], ["bayArrangement", "Bay arrangement / spacing"], ["poolSurfaceToGrade", "Pool surface to grade"], ["controlRoomLocation", "Control room location"]]) {
    dims[k] = { valueFt: null, basis: "UNK", gap: ld[k]?.gap || "G-dimensions", label: id, from: ld[k]?.stated ? `not in the sources read; stated only: ${quoteOf(facility, ld[k].stated)}` : "not in the sources read" };
  }
  const dimRows = ["baySquare", "bayDepth", "cnvHeight", "cnvDiameter", "cnvAboveWater", "radialClearance", "buildingOutline", "bayArrangement", "poolSurfaceToGrade", "controlRoomLocation"];

  const sharedNames = facility.ssc.filter((s) => s.scope === "shared").map((s) => `${s.id}: ${s.name}`);
  const unknownNotDrawn = [
    ...sharedNames,
    "DHRS condensers (2 trains per module, submerged in the pool): positions UNKNOWN",
    "ECCS valves (3 RVV + 2 RRV per module, on the vessel): positions UNKNOWN",
    "shield walls between the bays and the steam gallery: positions UNKNOWN",
    "grade line: elevation UNKNOWN; rule: the pool portion of the building is below grade",
    "site layout outside the reactor building: not in the sources read",
  ];
  const notes = [
    "SCREENING DRAWING of a public-source skeleton: not a plant drawing; not for construction, licensing or safety use.",
    "S2 = secondary, design-family value (Welter et al. 2023 also covers US460 / VOYGR): NOT a confirmed US600 dimension.",
    "C = computed from drawn values; D = schematic placement; UNK = not drawn. Units ft (m in brackets).",
    "Revision = hash of the facility model; any model change gives a new revision and supersedes this sheet.",
    "Unknowns stay unknown until a human reads the FSAR sections on sheet 3.",
    BANNER,
  ];
  const conflicts = (facility.conflicts || []).map((c) => `${c.id}: ${c.subject}: ${(c.values || []).map((x) => `${x.value} (${x.fact}, ${x.source})`).join(" vs ")}; ${c.decision}`);
  const gaps = facility.gaps.map((g) => ({ ...g, sources: facility.gapSources?.[g.id] || [{ document: "no public locator identified", adams: "-", chapter: null, section: "-", sectionBasis: "-" }] }));

  const scale = pickFacilityScale({ bays: L.bays.length, bayFt: dims.baySquare.valueFt, gapMm: GAP_MM, sectionFt: dims.cnvHeight.valueFt });
  const modelHash = facilityModelHash(facility);
  const revision = `R-${modelHash.slice(0, 8).toUpperCase()}`;
  const input = {
    title: `PLANT GA - ${facility.design.id.toUpperCase()} (public-source skeleton)`,
    number, scale, revision, modelHash, gapMm: GAP_MM,
    projection: "Plan + section", units: "ft (m)",
    status: "SCREENING - SCHEMATIC - NOT FOR CONSTRUCTION",
    generated: `Generated by ConKay facility-ga ${FACILITY_GA_VERSION} from the facility model; revision = model hash`,
    model: `${facility.design.id}: ${facility.ssc.length} SSCs, ${facility.dependencies.length} dependencies, ${Object.keys(facility.facts).length} facts`,
    bays: L.bays.map((id) => ({ id, label: id.replace(":BAY", "") })),
    dims, dimRows, unknownNotDrawn, sscRows: sscRows(facility), conflicts, gaps,
    retrieval: facility.retrievalLog || [], notes, banner: BANNER,
  };
  const sheets = buildFacilityGaSheets(input);
  const meta = { drawing: number, revision, modelHash, generator: `facility-ga@${FACILITY_GA_VERSION}`, design: facility.design.id, modules: facility.design.modules };
  const files = {};
  sheets.forEach((s, i) => { files[`sheet${i + 1}Svg`] = keepContent(`${number}-${revision}-sheet${i + 1}.svg`, toSvg(s, { ...meta, sheet: i + 1 })); });
  files.pdf = keepContent(`${number}-${revision}.pdf`, toPdf(sheets, { ...meta, title: `${number} ${revision}`, producer: `ConKay facility-ga ${FACILITY_GA_VERSION}` }));
  const dimsOut = Object.fromEntries(Object.entries(dims).map(([k, x]) => [k, { ft: x.valueFt, m: x.valueFt == null ? null : r9(x.valueFt * 0.3048), basis: x.basis, ...(x.fact ? { fact: x.fact } : {}), ...(x.gap ? { gap: x.gap } : {}), from: x.from }]));
  files.json = keepContent(`${number}-${revision}.json`, JSON.stringify({ ...meta, dims: dimsOut, unknownNotDrawn, gaps, retrieval: input.retrieval, notes }, null, 2));
  return {
    ok: true, banner: BANNER, drawing: number, revision, modelHash, scale: `1:${scale}`, sheets: sheets.length,
    dims: dimsOut, unknown: unknownNotDrawn, gaps, retrieval: input.retrieval, files,
    _sheets: sheets,
  };
}

/** Is a drawing in hand (its meta, or the SVG text) the current revision of this facility model? */
export function facilityDrawingStatus(drawing, facility) {
  let meta = drawing;
  if (typeof drawing === "string") {
    const m = drawing.match(/<metadata id="conkay-drawing">([^<]*)<\/metadata>/);
    if (!m) return { current: false, reason: "no ConKay drawing metadata found" };
    try { meta = JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")); } catch { return { current: false, reason: "unreadable drawing metadata" }; }
  }
  const now = facilityModelHash(facility);
  return now === meta.modelHash
    ? { current: true, revision: meta.revision }
    : { current: false, revision: meta.revision, currentRevision: `R-${now.slice(0, 8).toUpperCase()}`, reason: `superseded: the facility model changed since ${meta.revision}` };
}
