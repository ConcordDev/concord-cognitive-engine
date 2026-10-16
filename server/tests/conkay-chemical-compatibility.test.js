// Blend D brief item 7: the static, sourced chemical-compatibility table.
// Every row with a rating cites a registered document whose excerpt carries the statement; every row without one
// is "unknown" with its reason. Calcium carbonate's reactivity replays from the recorded PubChem response.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { COMPATIBILITY, compatibilityFor } from "../lib/conkay/knowledge/chemical-compatibility.js";
import { DOCUMENTS } from "../lib/conkay/knowledge/sources.js";
import { loadFixture, loadConnectorRecordings, replayGetter } from "../lib/conkay/knowledge/index.js";
import { pubchemUrls } from "../lib/conkay/knowledge/connectors/pubchem.js";
import { materialIrFromText } from "../lib/conkay/knowledge/material-ir.js";
import { openDesign, listSolvers } from "../lib/conkay/index.js";

describe("compatibility rows", () => {
  it("every rated row cites a registered document with a locator and an excerpt; every unrated row is 'unknown' with a reason and no evidence", () => {
    for (const r of COMPATIBILITY) {
      if (r.rating === "unknown") {
        assert.equal(r.evidence.length, 0, r.id);
        assert.ok(r.notes[0]?.length > 20, r.id);
      } else {
        assert.ok(r.evidence.length >= 1, r.id);
        for (const e of r.evidence) assert.ok(DOCUMENTS[e.document]?.locator && DOCUMENTS[e.document]?.excerpt, `${r.id}: ${e.document}`);
      }
    }
  });

  it("each rating is the source's own statement (the excerpt carries it)", () => {
    const carries = {
      "saltwater:hdpe": ["'R to 140' (°F)", "sodium chloride … solutions have the same effect as water"],
      "h2:hdpe:embrittlement": ["polymers do not suffer from hydrogen embrittlement"],
      "h2:hdpe:plasticisation": ["plasticizing effect, reducing the material's strength and increasing its toughness"],
      "h2:hdpe:decompression": ["liner blistering and collapse"],
      "uv:hdpe": ["chain scission", "carbon black is added", "about 2 to 3% in mass"],
      "acids:caco3": ["Reacts with acids and acidic salts to generate gaseous carbon dioxide"],
      "saltwater:recycled_impact_pp": ["PP (PP-R, PP-RCT): 'R to 140'"],
    };
    for (const r of COMPATIBILITY.filter((x) => x.rating !== "unknown")) {
      const text = r.evidence.map((e) => DOCUMENTS[e.document].excerpt).join(" ‖ ");
      for (const w of carries[r.id]) assert.ok(text.includes(w), `${r.id}: "${w}"`);
    }
  });

  it("the CaCO3 reactivity row replays from the recorded PubChem response", async () => {
    const rec = await loadConnectorRecordings();
    const doc = await replayGetter(rec.recordings)(pubchemUrls.heading(10112, "Reactivity Profile"));
    assert.equal(doc.ok, true);
    assert.match(doc.body, /Reacts with acids and acidic salts to generate gaseous carbon dioxide/);
  });

  it("silica and graphene UV protection, basalt in salt water and the co-polymer are unknown — nothing claimed either way", () => {
    for (const id of ["uv:silica", "uv:graphene", "saltwater:basalt_fiber", "any:hdpe_hc_copolymer"]) {
      assert.equal(COMPATIBILITY.find((r) => r.id === id).rating, "unknown", id);
    }
  });
});

describe("material.chemical-compatibility on Blend D", () => {
  const { text, meta } = loadFixture("usb-blend-d");
  const ir = materialIrFromText(text, meta);
  it("lists the rows for its constituents, the unknowns, and the compound-level test note", () => {
    const s = listSolvers().find((x) => x.id === "material.chemical-compatibility");
    for (const k of ["regime", "units", "tolerance"]) assert.ok(s?.[k], k);
    const c = compatibilityFor(ir);
    assert.ok(c.rows.some((r) => r.id === "acids:caco3"));
    assert.ok(c.rows.some((r) => r.id === "uv:graphene" && r.rating === "unknown"));
    const r = openDesign({ nodes: [{ id: "B", kind: "Material", props: { formulation: ir } }] }).session.result("material.chemical-compatibility@B");
    assert.equal(r.status, "WARN");
    assert.ok(r.warnings.some((w) => /weathering ASTM G154\/G155, hydrogen CSA\/ANSI CHMC 2/.test(w)));
    assert.ok(r.warnings.some((w) => /^any:hdpe_hc_copolymer/.test(w)));
  });
});
