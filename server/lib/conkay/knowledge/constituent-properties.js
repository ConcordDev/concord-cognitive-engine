// server/lib/conkay/knowledge/constituent-properties.js
//
// Blend D brief item 2: the constituents' property tables, every value a
// claim with its documents (sources.js, each with a locator and excerpt).
//
// Intervals are the span of the cited values for the constituent CLASS: the
// formulation names no grade, so the span is the honest width. Where only one
// source gives a value the claim carries that one value and says so. Where
// no source has been read, the property is absent and unknown: no claim, no
// guess. The HDPE/HC co-polymer has no properties until it is identified.
//
// Kept apart on purpose (the brief's rule): graphene nanoplatelets' supplier
// in-plane values (the graphite basal plane) and the effective values
// measured on multilayer GNP; HDPE tensile vs flexural moduli are one span
// with the test methods listed, flagged as mixed.

import { makeClaim } from "./claims.js";
import { evidenceRef } from "./sources.js";

const MPA = 1e6, GPA = 1e9, UM = 1e-6, NM = 1e-9;
const C2K = (c) => c + 273.15;

function claim(subject, property, unit, { range = null, value = null }, docs, { conditions = {}, notes = [], flags = [] } = {}) {
  const lo = range ? range[0] : value, hi = range ? range[1] : value;
  return makeClaim({
    id: `${subject}.${property}`, subject, property, kind: "quantitative", unit,
    ...(range ? { range: { min: lo, max: hi } } : { value }),
    conditions: { method: "as reported by the cited sources", ...conditions },
    uncertainty: range
      ? { type: "range", low: lo, high: hi, note: "span of the cited values for the class, not a measurement uncertainty" }
      : { type: "range", low: lo, high: hi, note: "one cited value; no spread is known" },
    method: { kind: "source_document", description: "values read from the cited documents", standard: null, receiptRef: null, assumptions: [] },
    status: ["sourced"], support: "supported", evidence: docs.map(evidenceRef), notes, flags,
  });
}

const H = "material:hdpe";
const B = "material:basalt-fiber";
const G = "material:graphene-nanoplatelets";
const CC = "substance:calcium-carbonate";
const SI = "substance:silica";

/** classId -> property -> claim (SI units). */
export const CONSTITUENT_PROPERTIES = Object.freeze({
  hdpe: Object.freeze({
    youngsModulus: claim(H, "youngs_modulus", "Pa", { range: [970 * MPA, 1410 * MPA] },
      ["exxonmobil-hma016-molded", "ineos-rigid-packaging-2022", "lyondellbasell-alathon-h6011", "sahu-2023-heliyon-rhdpe"],
      { conditions: { temperature: "23 °C" }, flags: ["mixed-test-methods"], notes: ["970 MPa flexural (ISO 178, ExxonMobil HMA 016); 1200 MPa tensile (ISO 527-2, INEOS Rigidex HD5218EA); 1410 MPa flexural 1 % secant (LyondellBasell Alathon H6011, method not shown); 1080 MPa (recycled HDPE, Sahu 2023). Tensile and flexural moduli are different tests; the span covers both, and it is the matrix only."] }),
    yieldStrength: claim(H, "tensile_yield_strength", "Pa", { range: [23 * MPA, 29.1 * MPA] },
      ["exxonmobil-hma016-molded", "lyondellbasell-alathon-h6011"],
      { conditions: { temperature: "23 °C" }, notes: ["23 MPa (ISO 527-2/1A/50, HMA 016); 29.1 MPa (Alathon H6011, method not shown)."] }),
    poisson: claim(H, "poisson_ratio", "1", { value: 0.41 }, ["sahu-2023-heliyon-rhdpe"],
      { notes: ["one source (recycled HDPE, used as an FEM input in that paper); no second named-grade value has been read"] , flags: ["single-source"] }),
    conductivity: claim(H, "thermal_conductivity", "W/(m·K)", { range: [0.37, 0.431] },
      ["travas-2023-polymers-eg-bn-hdpe", "gao-2024-polymers-bn-hdpe"],
      { notes: ["0.37 W/mK measured on neat SABIC HDPE 6060R (Travaš 2023); 0.431 W/mK on neat HDPE 2911 (Gao 2024)."] }),
    cte: claim(H, "linear_thermal_expansion", "1/K", { range: [180e-6, 220e-6] },
      ["khina-2025-polymers-clte-review", "das-2026-acsaem-hdpe-tpe-gnp"],
      { conditions: { temperature: "−30–60 °C for the 180 ppm/K value; not stated for the datasheet's 220 ppm/K" }, notes: ["~180 ppm/°C (Khina 2025 Table 3, above Tg, −30–60 °C); 2.2E-4/°C (INEOS Rigidex HD5218EA datasheet as tabulated by Das 2026 Table 1)."] }),
    meltTemperature: claim(H, "melting_temperature", "K", { range: [C2K(130), C2K(134.73)] },
      ["exxonmobil-hma016-molded", "das-2026-acsaem-hdpe-tpe-gnp", "gao-2024-polymers-bn-hdpe"],
      { notes: ["133 °C peak melting (ASTM D3418, HMA 016); 130 °C (Rigidex HD5218EA datasheet via Das 2026); 134.73 °C (DSC, Gao 2024 Table 2)."] }),
    crystallizationTemperature: claim(H, "crystallization_temperature", "K", { range: [C2K(116.3), C2K(117.79)] },
      ["evgin-2020-bjnano-hdpe-gnp", "gao-2024-polymers-bn-hdpe"],
      { conditions: { method: "DSC cooling (rates as in each paper)" }, notes: ["116.30 °C (HDPE LITEN FB 75, Evgin 2020 Table 2); 117.79 °C (HDPE 2911, Gao 2024 Table 2). Fillers shift it: GnP raised T_c to 117.3–121.6 °C in Evgin 2020."] }),
    glassTransition: claim(H, "glass_transition_temperature", "K", { range: [C2K(-130), C2K(-100)] },
      ["badawi-2026-scirep-hdpe-tg"],
      { flags: ["disputed"], notes: ["Badawi 2026, citing Greene et al.: 'between −130 °C and −100 °C'; the same paper notes that thermal studies frequently fail to identify HDPE's Tg. The assignment of polyethylene's Tg is disputed in the literature; treat as a range, not a design value."] }),
  }),
  hdpe_hc_copolymer: Object.freeze({}),
  basalt_fiber: Object.freeze({
    youngsModulus: claim(B, "youngs_modulus", "Pa", { range: [85 * GPA, 110 * GPA] },
      ["liang-2025-polymers-basalt", "jiang-2025-materials-basalt", "zhang-2024-heliyon-basalt"],
      { notes: ["91–110 GPa (Liang 2025 Table 2); 85–110 GPa (Jiang 2025 Table 3); 88 GPa (Zhang 2024 Table 3). Supplier fibre values as tabulated by these papers, before compounding."] }),
    tensileStrength: claim(B, "tensile_strength", "Pa", { range: [2950 * MPA, 4800 * MPA] },
      ["liang-2025-polymers-basalt", "jiang-2025-materials-basalt", "zhang-2024-heliyon-basalt"],
      { conditions: { temperature: "25 °C (Jiang 2025); others not stated" }, notes: ["3000–4800 MPa (Liang 2025; Jiang 2025 at 25 °C); 2950 MPa (Zhang 2024). Single-filament values; compounding shortens and damages fibres."] }),
    diameter: claim(B, "fibre_diameter", "m", { range: [6 * UM, 23 * UM] },
      ["liang-2025-polymers-basalt", "jiang-2025-materials-basalt", "zhang-2024-heliyon-basalt", "basalt-fibre-review-jcs-2022", "basalt-fibre-acs-2026"],
      { notes: ["7–15 µm (Liang 2025), 16 µm (Jiang 2025), 17.4 µm (Zhang 2024), 9–23 µm (J. Compos. Sci. 2022), 6–21 µm (ACS 2026). Fibre LENGTH in Blend D is unknown (chopped, milled or continuous is not stated)."] }),
  }),
  graphene: Object.freeze({
    inPlaneModulus: claim(G, "in_plane_youngs_modulus_supplier", "Pa", { value: 1000 * GPA }, ["watts-2021-acsomega-gnp"],
      { flags: ["supplier-nominal", "in-plane"], notes: ["Supplier table value (Strem 06-0215, 6–8 nm GNP) for the graphene basal plane. NOT the modulus a GNP contributes in a polymer: see effectiveModulus."] }),
    effectiveModulus: claim(G, "effective_youngs_modulus_multilayer", "Pa", { range: [25 * GPA, 40 * GPA] }, ["cilento-2022-nanomaterials-2d"],
      { flags: ["effective"], notes: ["GNP with >10 layers, as tabulated by Cilento 2022 (their ref. [15]). The gap to the 1000 GPa in-plane value is interlayer shear and defects."] }),
    inPlaneConductivity: claim(G, "in_plane_thermal_conductivity_supplier", "W/(m·K)", { value: 3000 }, ["gaska-2017-polymers-xgnp-m5", "watts-2021-acsomega-gnp"],
      { flags: ["supplier-nominal", "in-plane", "source-specific"], notes: ["xGnP M5 producer data sheet (via Gaska 2017 Table 1) and Strem 06-0215 (Watts 2021 Table 2): 3000 W/mK in-plane. Source-specific supplier value."] }),
    throughPlaneConductivity: claim(G, "through_plane_thermal_conductivity_supplier", "W/(m·K)", { value: 6 }, ["gaska-2017-polymers-xgnp-m5"],
      { flags: ["supplier-nominal", "through-plane", "source-specific"], notes: ["xGnP M5 producer data sheet via Gaska 2017 Table 1."] }),
    effectiveInPlaneConductivity: claim(G, "in_plane_thermal_conductivity_multilayer", "W/(m·K)", { range: [300, 470] }, ["cilento-2022-nanomaterials-2d"],
      { flags: ["effective", "in-plane"], notes: ["GNP >10 layers, as tabulated by Cilento 2022 (their ref. [8])."] }),
    thickness: claim(G, "platelet_thickness", "m", { range: [6 * NM, 8 * NM] }, ["gaska-2017-polymers-xgnp-m5", "watts-2021-acsomega-gnp", "das-2026-acsaem-hdpe-tpe-gnp"],
      { notes: ["6–8 nm for xGnP M5, Strem 06-0215 and XG Science M-25. Blend D does not name its graphene, so this is the xGnP-class assumption A3 of the density estimate."] }),
    lateralSize: claim(G, "platelet_lateral_size", "m", { range: [5 * UM, 25 * UM] }, ["gaska-2017-polymers-xgnp-m5", "watts-2021-acsomega-gnp", "das-2026-acsaem-hdpe-tpe-gnp"],
      { notes: ["5 µm (M5), 15 µm (Strem 06-0215), 25 µm (M-25): the grade sets it; Blend D's grade is unknown."] }),
  }),
  caco3: Object.freeze({
    decompositionTemperature: claim(CC, "decomposition_temperature", "K", { range: [1098.15, 1612.0388888888888] }, ["pubchem-cid-10112-melting"],
      { flags: ["decomposes"], notes: ["PubChem 'Melting Point' section, 1517–2442 °F '(Decomposes)': calcium carbonate decomposes (to CaO + CO2), it does not melt. Replayed from the recorded PubChem response."] }),
  }),
  silica: Object.freeze({
    meltTemperature: claim(SI, "melting_temperature", "K", { range: [1983.15, 2009.15] }, ["pubchem-cid-24261-melting"],
      { notes: ["PubChem 'Melting Point' section: 1710 °C / 3110 °F to 1716–1736 °C across contributors; the form (amorphous vs quartz) is unstated in Blend D. Replayed from the recorded PubChem response."] }),
  }),
});

/** Properties no source has been read for, per class (the reason each stays unknown). */
export const UNKNOWN_PROPERTIES = Object.freeze({
  hdpe_hc_copolymer: "every property: the co-polymer is not identified (comonomer, grade, supplier)",
  basalt_fiber: "thermal conductivity, CTE: no source read (one table listed 50.2 W/(m·K) for basalt fibre, implausible for a silicate glass fibre; not used)",
  caco3: "Young's modulus, thermal conductivity, CTE: PubChem has none and no handbook has been read",
  silica: "Young's modulus, thermal conductivity, CTE: PubChem has none and no handbook has been read; the form is unstated",
  graphene: "CTE: no source read",
});

/** The claim for a class's property, or null (unknown). */
export function constituentProperty(classId, key) {
  return CONSTITUENT_PROPERTIES[classId]?.[key] || null;
}
