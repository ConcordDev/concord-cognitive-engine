// tests/conkay-nuclear-facility-drawing.test.js
//
// Nuclear Phase 3 drawings: the schematic plant GA of the NuScale US600
// skeleton, generated from the same model the facility screen runs on. Pins:
// revision = model hash (and a model change supersedes a sheet), only sourced
// or computed dimensions are drawn, unknowns stay unknown on the sheet, and the
// FSAR gap pull list cites only accessions / chapter titles quoted from the rule.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import "../lib/conkay/index.js";
import {
  buildUS600Facility, drawFacility, facilityDrawingStatus, facilityModelHash, US600_GAPS, US600_GAP_SOURCES, US600_FACTS,
  US600_RETRIEVAL_LOG, forbiddenVerdicts, BANNER,
} from "../lib/conkay/safety-case/index.js";
import { toSvg } from "../lib/conkay/drawings/sheet.js";
import { titleBlock } from "../lib/conkay/drawings/ga-drawing.js";
import registerConkaySafetyActions from "../domains/conkay-safety.js";

// Accession numbers that appear in the rule's "Availability of Documents" table (88 FR 3287, XVII; read 2026-10-10).
const RULE_ACCESSIONS = new Set(["ML20225A071", "ML20023A318", "ML19183A408", "ML17340A524"]);
// Tier 2 chapter titles, verbatim from 10 CFR 52 App. G III.A.2.b (the ones the pull list uses).
const RULE_CHAPTERS = new Set([
  "Chapter One, Introduction and General Description of the Plant", "Chapter Three, Design of Structures, Systems, Components and Equipment",
  "Chapter Five, Reactor Coolant System and Connecting Systems", "Chapter Six, Engineered Safety Features", "Chapter Seven, Instrumentation and Controls",
  "Chapter Eight, Electric Power", "Chapter Nine, Auxiliary Systems", "Chapter Twelve, Radiation Protection", "Chapter Fifteen, Transient and Accident Analyses",
  "Chapter Nineteen, Probabilistic Risk Assessment and Severe Accident Evaluation", "Chapter Twenty-One, Multi-Module Design Considerations",
]);

const svgText = (r) => r._sheets.map((s) => toSvg(s)).join("\n");

describe("NuScale US600 plant GA drawing (screening, schematic)", () => {
  const fac = buildUS600Facility({ modules: 12 });
  const r = drawFacility(fac);

  it("draws three sheets at a standard scale, with the revision taken from the model hash", () => {
    assert.equal(r.ok, true, JSON.stringify(r.errors));
    assert.equal(r.sheets, 3);
    assert.equal(r.scale, "1:250");
    assert.match(r.modelHash, /^[0-9a-f]{64}$/);
    assert.equal(r.revision, `R-${r.modelHash.slice(0, 8).toUpperCase()}`);
    assert.equal(r.modelHash, facilityModelHash(fac));
    assert.ok(r.files.pdf.bytes > 1000);
    const svg = svgText(r);
    assert.ok(svg.includes(r.revision) && svg.includes(r.modelHash.slice(0, 32)), "title block carries revision and hash");
    assert.ok(svg.includes("Units ft (m)"));
  });

  it("is deterministic: same model, same hash and same file bytes", () => {
    const again = drawFacility(buildUS600Facility({ modules: 12 }));
    assert.equal(again.modelHash, r.modelHash);
    for (const k of Object.keys(r.files)) assert.equal(again.files[k].sha256, r.files[k].sha256, k);
  });

  it("a model change gives a new revision and supersedes the sheet in hand", () => {
    const six = buildUS600Facility({ modules: 6 });
    const r6 = drawFacility(six);
    assert.notEqual(r6.revision, r.revision);
    const sheet1 = toSvg(r._sheets[0], { drawing: r.drawing, revision: r.revision, modelHash: r.modelHash });
    assert.equal(facilityDrawingStatus(sheet1, fac).current, true);
    const st = facilityDrawingStatus(sheet1, six);
    assert.equal(st.current, false);
    assert.equal(st.currentRevision, r6.revision);
    assert.match(st.reason, /superseded/);
    // a fact edit (not just a count) also changes the revision
    const edited = buildUS600Facility({ modules: 12 });
    edited.facts = { ...edited.facts, cnvSize: { ...edited.facts.cnvSize, locator: "edited" } };
    assert.notEqual(facilityModelHash(edited), r.modelHash);
  });

  it("draws only S2 dimensions whose numbers are in the quoted text, plus two values computed from them", () => {
    const d = r.dims;
    assert.deepEqual([d.baySquare.ft, d.bayDepth.ft, d.cnvHeight.ft, d.cnvDiameter.ft], [20, 53, 76, 19]);
    for (const k of ["baySquare", "bayDepth", "cnvHeight", "cnvDiameter"]) {
      assert.equal(d[k].basis, "S2");
      const f = Object.values(US600_FACTS).find((x) => x.id === d[k].fact);
      assert.equal(f.quality, "secondary");
      assert.ok(f.quote.includes(`${d[k].ft} ft`), `${k}: ${d[k].ft} ft is in the quote`);
    }
    assert.equal(d.cnvAboveWater.ft, 23); // 76 - 53, CNV seated on the floor (schematic)
    assert.equal(d.radialClearance.ft, 0.5); // (20 - 19) / 2
    assert.equal(d.cnvAboveWater.basis, "C");
    assert.equal(d.baySquare.m, 6.096); // 20 ft x 0.3048 m/ft exactly
  });

  it("leaves the building outline, arrangement, grade and control room UNKNOWN and says so on the sheet", () => {
    for (const k of ["buildingOutline", "bayArrangement", "poolSurfaceToGrade", "controlRoomLocation"]) {
      assert.equal(r.dims[k].ft, null, k);
      assert.equal(r.dims[k].basis, "UNK");
      assert.match(r.dims[k].gap, /^G-/);
    }
    const svg = svgText(r);
    assert.ok(svg.includes("UNKNOWN (G-dimensions)"));
    assert.ok(svg.includes("NOT DRAWN - UNKNOWN"));
    assert.ok(svg.includes("NOT to scale between bays"));
    assert.ok(r.unknown.some((s) => /grade line: elevation UNKNOWN/.test(s)));
  });

  it("the gap pull list cites only rule-quoted accessions and chapter titles, for every gap", () => {
    for (const g of US600_GAPS) {
      const rows = US600_GAP_SOURCES[g.id];
      assert.ok(rows?.length, `${g.id} has a pull-list row`);
      for (const s of rows) {
        assert.match(s.adams, /^ML\d{5}[A-Z]\d{3}$/);
        assert.ok(RULE_ACCESSIONS.has(s.adams), `${g.id}: ${s.adams} is in the rule's table`);
        if (s.chapter) assert.ok(RULE_CHAPTERS.has(s.chapter), `${g.id}: chapter title verbatim (${s.chapter})`);
        assert.ok(["rule", "verify"].includes(s.sectionBasis));
      }
    }
    assert.ok(US600_RETRIEVAL_LOG.some((x) => x.status === 403), "the blocked attempts are recorded");
    assert.ok(svgText(r).includes("ML20225A071"));
  });

  it("layout facts carry corrected locators and are verbatim", () => {
    const F = US600_FACTS;
    assert.equal(F.rxbTwelve.locator, "I. Background");
    assert.equal(F.poolBelowGrade.locator, "I. Background");
    assert.equal(F.radZoneMap.locator, "Appendix G, Section IV.A.2.g");
    for (const f of [F.rxbTwelve, F.poolBelowGrade, F.bayGallery, F.radZoneMap, F.cnvSize, F.baySize]) assert.equal(f.verbatim, true);
  });

  it("refuses an invalid model or one with nothing to draw at scale", () => {
    const bad = buildUS600Facility({ modules: 1 });
    bad.ssc = [...bad.ssc, { id: "X", name: "unsourced", kind: "structure", scope: "shared", facts: [] }];
    assert.equal(drawFacility(bad).ok, false);
    const nodim = buildUS600Facility({ modules: 1 });
    nodim.layout = { ...nodim.layout, dims: { ...nodim.layout.dims, cnvHeightFt: { value: null, basis: "UNK" } } };
    const res = drawFacility(nodim);
    assert.equal(res.ok, false);
    assert.match(res.errors[0], /cnvHeightFt/);
  });

  it("uses no verdict words, carries the banner, and is served as conkay_safety.facility-us600-drawing", () => {
    const { _sheets, ...rest } = r;
    assert.deepEqual(forbiddenVerdicts(rest), []);
    assert.equal(r.banner, BANNER);
    const actions = new Map();
    registerConkaySafetyActions((domain, name, fn) => actions.set(`${domain}.${name}`, fn));
    const out = actions.get("conkay_safety.facility-us600-drawing")({}, null, { modules: 12 });
    assert.equal(out.ok, true);
    assert.equal(out.result.revision, r.revision);
    assert.equal(out.result.svg.length, 3);
    assert.equal(out.result._sheets, undefined);
    assert.equal(actions.get("conkay_safety.facility-us600-drawing")({}, null, { modules: 13 }).ok, false);
  });

  it("leaves the vehicle title block's default units unchanged", () => {
    const items = [];
    titleBlock(items, { title: "t", number: "n", sheet: "1", scale: 10, projection: "p", model: "m", status: "s", generated: "g", revision: "R", modelHash: "0".repeat(64) }, [420, 297]);
    assert.ok(items.some((i) => i.t === "text" && i.s.includes("Units mm")));
  });
});
