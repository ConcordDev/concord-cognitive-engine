// server/lib/conkay/knowledge/sources.js
//
// Source registry (a registry, not a scraper) and the evidence documents this
// slice cites.
//
// SOURCES lists the kinds of source the knowledge layer accepts, with usage /
// licensing notes. Each connector must, per the spec: identify the entity and
// exact variant; extract candidate values and units; preserve the original
// document and the claim's location; normalise units and identifiers; check
// contradictions and missing conditions; attach provenance and confidence;
// and route uncertain or conflicting records to review. PubChem and the NIST
// WebBook connectors are built (connectors/); the documents below were read by
// hand on the `retrieved` date and their values typed in with their locators.
//
// DOCUMENTS are cited by id from claims. For PDFs, sha256 is the hash of the
// file as retrieved, so the exact document can be re-identified later. The
// documents themselves are not copied into the repo (copyright); only the
// short excerpt that carries the value.

export const CONNECTOR_DUTIES = [
  "identify the entity and the exact variant",
  "extract candidate values and units",
  "preserve the original document and the claim's location in it",
  "normalise units and identifiers",
  "check contradictions and missing conditions",
  "attach provenance and confidence",
  "send uncertain or conflicting records to review",
];

export const SOURCES = {
  pubchem: { name: "PubChem (NCBI)", url: "https://pubchem.ncbi.nlm.nih.gov/", kind: "database", connector: "built (connectors/pubchem.js: identity + experimental Density / Boiling / Melting / Flash point; recorded-excerpt replay in the server, live capture by scripts/conkay-capture-knowledge.mjs)", license: "NCBI data are public domain, but individual contributed records (e.g. HSDB, CAMEO, ICSC) carry their own terms; record the contributing source per value." },
  nist_webbook: { name: "NIST Chemistry WebBook (SRD 69)", url: "https://webbook.nist.gov/chemistry/", kind: "database", connector: "built (connectors/nist-webbook.js: fluid-service isobars with the stated equation uncertainties; recorded-excerpt replay in the server, live capture by scripts/conkay-capture-knowledge.mjs)", license: "NIST Standard Reference Data; cite NIST SRD 69 and the version." },
  nist_refprop: { name: "NIST REFPROP (SRD 23)", url: "https://www.nist.gov/srd/refprop", kind: "software", connector: "planned", license: "Licensed software; values computed with it must cite the version; redistribution of the program is not allowed." },
  materials_project: { name: "Materials Project", url: "https://materialsproject.org/", kind: "database", connector: "planned", license: "CC BY 4.0 data; results are DFT-computed, so their claims are status computed/simulated, not measured." },
  manufacturer_datasheet: { name: "Manufacturer / supplier datasheets", kind: "document", connector: "planned", license: "Typical values for the named grade only; usually 'not for specification'. Copyrighted: store excerpt + locator + hash, not the document." },
  sds: { name: "Safety Data Sheets", kind: "document", connector: "planned", license: "Supplier-specific; hazards apply to the exact product and grade." },
  paper: { name: "Peer-reviewed papers", kind: "document", connector: "planned", license: "Per publisher (many MDPI papers are CC BY 4.0)." },
  standard: { name: "Standards bodies (ASTM, ISO, SAE, CSA)", kind: "standard", connector: "planned", license: "Copyrighted; cite designation and title only." },
  lab: { name: "Accredited laboratory reports", kind: "test_record", connector: "planned", license: "Owned by whoever commissioned the test." },
  concord_experiment: { name: "Concord's own experiments (batch and test records)", kind: "test_record", connector: "planned", license: "Concord-owned." },
  user_statement: { name: "A user's or author's own statement", kind: "user_statement", connector: "n/a", license: "Recorded as an assertion to be checked, never as evidence." },
};

const R = "2026-10-09";

export const DOCUMENTS = {
  "pubchem-cid-10112-density": {
    kind: "url", sourceId: "pubchem", title: "PubChem CID 10112 Calcium Carbonate — Experimental Properties: Density",
    url: "https://pubchem.ncbi.nlm.nih.gov/compound/10112#section=Density", retrieved: R,
    locator: "Chemical and Physical Properties > Experimental Properties > Density (ref. 97 NIOSH npgd0090; ref. 3 CAMEO; ref. 90 DOE PAC)",
    excerpt: "2.7-2.95 (NIOSH); 2.93 @25 °C (DOE PAC); 2.8 g/cm³ (ICSC 1193)", license: "NIOSH content: US government; ICSC: CC BY 4.0",
  },
  "pubchem-cid-24261-density": {
    kind: "url", sourceId: "pubchem", title: "PubChem CID 24261 Silica — Experimental Properties: Density",
    url: "https://pubchem.ncbi.nlm.nih.gov/compound/24261#section=Density", retrieved: R,
    locator: "Chemical and Physical Properties > Experimental Properties > Density (refs. 17, 134, 135, 185)",
    excerpt: "Amorphous silica 2.2 (NIOSH npgd0552; Merck Index 13th ed. 2.2 @ 25 °C); 'density: 2.2-2.6' (Hawley's); alpha-quartz 2.648 (IARC table)", license: "NIOSH/HSDB: US government",
  },
  "astm-d4976-density-classes": {
    kind: "document", sourceId: "standard", title: "ASTM D4976 polyethylene density classes (as reproduced in ASTM D1248 sample text)",
    url: "https://www.normadoc.com/media/file/49/89/4e4e0dc40a4d90abcabc0356f23c.pdf", retrieved: R,
    locator: "Note 5 (class terms)", excerpt: "Class 3 (>0.940 to 0.960) = high density, Class 4 (>0.960) = high density", license: "ASTM copyright; designation and class bounds only",
  },
  "mol-hdpe-catalogue-2023": {
    kind: "document", sourceId: "manufacturer_datasheet", title: "MOL Group, High Density Polyethylene (TIPELIN) Product Catalogue 2023",
    url: "https://molgroupchemicals.com/userfiles/catalog/hdpe/HDPE_Product_catalogue_2023_EN.pdf", retrieved: R,
    locator: "p.3 'HDPE Density: 0.94–0.97 g/cm³'; p.4 'Polyethylene density (0.910–0.970 g/cm³)'; p.9 blow moulding: 'Recommended melt temperatures are 180–220°C'",
    excerpt: "HDPE Density: 0.94–0.97 g/cm³ … Recommended melt temperatures are 180–220°C",
    sha256: "886a069738f4107b4046ae7a7f56ccbd7022160837f6cd57dc0ed4c2ed2a12f3", license: "manufacturer copyright; excerpt only",
  },
  "exxonmobil-hma016": {
    kind: "document", sourceId: "manufacturer_datasheet", title: "ExxonMobil HDPE HMA 016 product datasheet",
    url: "https://stavianchem.com/sites/default/files/product-specs/HMA016.pdf", retrieved: R,
    locator: "p.1 Resin Properties / Thermal table", excerpt: "Density 0.956 g/cm³ (ASTM D1505); Melt Index (190°C/2.16 kg) 20 g/10 min; Peak Melting Temperature 133 °C (ASTM D3418)",
    sha256: "11e44e284e1ebdfeb85e7239f93537aaa2d2e42a895fad522c1cdb96886e250d", license: "manufacturer copyright; excerpt only",
  },
  "basalt-fibre-review-jcs-2022": {
    kind: "document", sourceId: "paper", title: "Developments and Industrial Applications of Basalt Fibre Reinforced Composite Materials (J. Compos. Sci. 2022, 6(12), 367)",
    url: "https://www.mdpi.com/2504-477X/6/12/367", retrieved: R, locator: "fibre property comparison table",
    excerpt: "Basalt | Fibre diameter 9–23 µm | Density 2.8–3.0 g/cm3", license: "CC BY 4.0",
  },
  "basalt-fibre-bfrc-review-2023": {
    kind: "document", sourceId: "paper", title: "Fresh, mechanical, and durability properties of basalt fiber-reinforced concrete (BFRC): A review (2023)",
    url: "https://www.sciencedirect.com/science/article/pii/S2666165923000376", retrieved: R, locator: "basalt fibre property table (21 sources)",
    excerpt: "Range row: density 2.4–2.8 g/cm3 (individual entries e.g. 2.65 Jiang et al. 2014; 2.8 Lopresto et al. 2011)", license: "per publisher",
  },
  "basalt-fibre-acs-2026": {
    kind: "document", sourceId: "paper", title: "An Overview of Advancements in Basalt Fibers and Their Composites (ACS Symposium Series 1524, ch. 1)",
    url: "https://pubs.acs.org/doi/full/10.1021/bk-2026-1524.ch001", retrieved: R, locator: "Table 3",
    excerpt: "Basalt fiber | 6−21 µm | 2.65−3.05 g·cm-3", license: "ACS copyright; excerpt only",
  },
  "sigma-xgnp-c": {
    kind: "url", sourceId: "manufacturer_datasheet", title: "Sigma-Aldrich 900407, xGnP graphene nanoplatelets grade C-750",
    url: "https://www.sigmaaldrich.com/US/en/product/aldrich/900407", retrieved: R, locator: "Properties: relative gravity; bulk density",
    excerpt: "relative gravity: 2.0-2.25 g/cm3; bulk density 0.2‑0.4 g/cm3", license: "supplier copyright; excerpt only",
  },
  "li-2023-h2-liner-review": {
    kind: "document", sourceId: "paper", title: "Li X., Huang Q., Liu Y., Zhao B., Li J. Review of the Hydrogen Permeation Test of the Polymer Liner Material of Type IV On-Board Hydrogen Storage Cylinders. Materials 2023, 16(15), 5366",
    url: "https://www.mdpi.com/1996-1944/16/15/5366", retrieved: R, date: "2023-07-30",
    locator: "§1 Introduction ¶2–3; §2 ¶1",
    excerpt: "the polymer liner material of type IV hydrogen storage cylinders is made from high-density polyethylene (HDPE) or polyamide (PA). However, due to the structural characteristics of these polymer materials, hydrogen permeation is inevitable, and the large gas permeability and dissolution rate can also lead to liner blistering and collapse … ISO 19881 … less than 46 NmL/(h·L) at 1.15 NWP and 55 °C, and less than 6 NmL/(h·L) at the NWP and 15 °C … polymers do not suffer from hydrogen embrittlement as metals do",
    license: "CC BY 4.0",
  },
  "dong-2023-pa6-hdpe-permeability": {
    kind: "document", sourceId: "paper", title: "Dong C., Liu Y., Li J., Bin G., Zhou C., Han W., Li X. Hydrogen Permeability of Polyamide 6 Used as Liner Material for Type IV On-Board Hydrogen Storage Cylinders. Polymers 2023, 15(18), 3715 (doi:10.3390/polym15183715)",
    url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC10534423/", retrieved: R, date: "2023",
    locator: "Table 4. Hydrogen permeation test results of different materials (288 K, 70 MPa)",
    excerpt: "HDPE: Pe 5.88 × 10−14 cm3·cm/(cm2·s·Pa), D 9.73 × 10−7 cm2/s (PA6: 1.72 × 10−14; PA11: 1.87 × 10−14)",
    license: "CC BY 4.0",
  },
  // ---- Blend D brief item 2 (constituent property tables), read 2026-10-16 ----
  "exxonmobil-hma016-molded": {
    kind: "document", sourceId: "manufacturer_datasheet", title: "ExxonMobil HDPE HMA 016 product datasheet (revision 01/01/2017)",
    url: "https://stavianchem.com/sites/default/files/product-specs/HMA016.pdf", retrieved: "2026-10-16",
    locator: "p.1 Molded Properties / Thermal tables (4 mm injection-moulded specimens, ISO 294-1)",
    excerpt: "Tensile Stress at Yield 23 MPa (ISO 527-2/1A/50); Tensile Strain at Yield 10 %; Flexural Modulus 970 MPa (ISO 178); Heat Deflection Temperature (0.45 MPa) 64 °C (ISO 75-2/B); Peak Melting Temperature 133 °C (ASTM D3418)",
    sha256: "11e44e284e1ebdfeb85e7239f93537aaa2d2e42a895fad522c1cdb96886e250d", license: "manufacturer copyright; excerpt only",
  },
  "ineos-rigid-packaging-2022": {
    kind: "document", sourceId: "manufacturer_datasheet", title: "INEOS Olefins & Polymers Europe, Rigid Packaging Solutions (K 2022) — injection moulding range",
    url: "https://www.ineos.com/globalassets/ineos-group/businesses/ineos-olefins-and-polymers-europe/k2022/ineos-op---rigid-packaging-solutions---2022.pdf", retrieved: "2026-10-16",
    locator: "p.4 'Injection moulding range' table (MFR ISO 1133; density ISO 1183-1; tensile modulus 23 °C ISO 527-2; Charpy notched 23 °C ISO 179-1)",
    excerpt: "RIGIDEX® HD5218EA | 18 | 952 | 1200 | 3 | For fast cycling thin wall applications, caps & closures, pails, houseware",
    sha256: "b767047685ea9d09f6a87acd5f908642f63c512576096289d779cd48633a728d", license: "manufacturer copyright; excerpt only",
  },
  "lyondellbasell-alathon-h6011": {
    kind: "url", sourceId: "manufacturer_datasheet", title: "LyondellBasell Alathon H6011 HDPE (injection moulding) product page",
    url: "https://lyondellbasell.com/en/polymers/p/Alathon H6011/b2dd6ef8-82f3-429e-8f06-afaeafe5177c", retrieved: "2026-10-16",
    locator: "Technical properties table (test methods not shown on the page)",
    excerpt: "Density 0.960 g/cm³; Flexural Modulus (1% Secant) 1410 MPa; Tensile Stress at Yield (23 °C) 29.1 MPa; Tensile Elongation at Yield 10 %; Vicat Softening Temperature 127 °C; Deflection Temperature Under Load (66 psi) 75 °C",
    license: "manufacturer copyright; excerpt only",
  },
  "sahu-2023-heliyon-rhdpe": {
    kind: "document", sourceId: "paper", title: "Sahu S.K., Sreekanth P.S.R. Evaluation of tensile properties of spherical shaped SiC inclusions inside recycled HDPE matrix using FEM based representative volume element approach. Heliyon 2023, 9, e14034 (doi:10.1016/j.heliyon.2023.e14034)",
    url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC10011209/", retrieved: "2026-10-16", date: "2023",
    locator: "§2.1 Materials", excerpt: "[recycled HDPE] density is 0.956 g/cm3; Poison's ratio is 0.41, Young's modulus is 1080 MPa", license: "CC BY 4.0",
  },
  "gao-2024-polymers-bn-hdpe": {
    kind: "document", sourceId: "paper", title: "Gao Z., Wang Y., Zhang B., et al. Enhanced Thermal Conductivity of High-Density Polyethylene Composites with Hybrid Fillers of Flaky and Spherical Boron Nitride Particles. Polymers 2024, 16(2), 268 (doi:10.3390/polym16020268)",
    url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC10819010/", retrieved: "2026-10-16", date: "2024",
    locator: "§2.1 Materials (HDPE 2911, 0.960 g/cm3, Fushun Petrochemical); §3 Results and Discussion (thermal conductivity); Table 2 (T_M of HDPE by DSC)",
    excerpt: "282.27% higher than that of pure HDPE (0.431 Wm−1 K−1); Table 2: HDPE T_M 134.73 °C", license: "CC BY 4.0",
  },
  "travas-2023-polymers-eg-bn-hdpe": {
    kind: "document", sourceId: "paper", title: "Travaš L., Rujnić Havstad M., Pilipović A., et al. Optimization of Thermal Conductivity and Tensile Properties of High-Density Polyethylene by Addition of Expanded Graphite and Boron Nitride. Polymers 2023, 15(17), 3645 (doi:10.3390/polym15173645)",
    url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC10489680/", retrieved: "2026-10-16", date: "2023",
    locator: "§2.1 Materials (HDPE 6060R, SABIC, PE-100, granulate density 0.959 g/cm3); §3.1 Thermal Properties",
    excerpt: "From a starting value of 0.37 W/mK for pure HDPE, the thermal conductivity increased up to 3.00 W/mK", license: "CC BY 4.0",
  },
  "khina-2025-polymers-clte-review": {
    kind: "document", sourceId: "paper", title: "Khina A.G., Bulkatov D.P., Storozhuk I.P., et al. Coefficient of Linear Thermal Expansion of Polymers and Polymer Composites: A Comprehensive Review. Polymers 2025, 17(23), 3097 (doi:10.3390/polym17233097)",
    url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC12693757/", retrieved: "2026-10-16", date: "2025",
    locator: "Table 3 'CLTE of thermoplastics' (α2 above Tg), row High-density polyethylene (HDPE), source [92]",
    excerpt: "High-density polyethylene (HDPE) | ΔT2 −30–60 °C | α2 ~180 ppm/°C", license: "CC BY 4.0",
  },
  "das-2026-acsaem-hdpe-tpe-gnp": {
    kind: "document", sourceId: "paper", title: "Das B., Ip G., Porwal H., et al. Tunable Pyroresistive Behavior in Conductive Polymer Composites with a Secondary Elastomer Phase. ACS Applied Engineering Materials 2026, 4(7), 3644 (doi:10.1021/acsaenm.6c00343)",
    url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC13411071/", retrieved: "2026-10-16", date: "2026",
    locator: "Table 1 'Materials Used with Relevant Datasheet Information'",
    excerpt: "INEOS Rigidex HD5218EA: density (kg·m–3) 952, melt temp (°C) 130, modulus (MPa) 1200, CTE (E-4/°C) 2.2, crystallinity 58.9; XG Science M-25 GNP: density (kg·m–3) 2200, avg. lateral size 25 μm, avg. thickness 6–8 nm",
    license: "CC BY 4.0",
  },
  "badawi-2026-scirep-hdpe-tg": {
    kind: "document", sourceId: "paper", title: "Badawi M.S., Habanjar K., Shaib M.A., et al. Tailoring mechanical and thermal behavior of HDPE via Ba–Sr–Ca hexaferrite incorporation. Scientific Reports 2026, 16 (doi:10.1038/s41598-026-57097-x)",
    url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC13276080/", retrieved: "2026-10-16", date: "2026",
    locator: "§ Thermal properties using Differential Scanning Calorimetry (DSC)",
    excerpt: "the glass transition temperature of HDPE is between − 130 °C and − 100 °C … according to Greene et al; … thermal studies frequently fail to identify it", license: "CC BY 4.0",
  },
  "liang-2025-polymers-basalt": {
    kind: "document", sourceId: "paper", title: "Liang F., Yang Q., Tao J., et al. Multi-Performance Evolution and Elasto-Plastic Damage Modeling of Basalt Fiber-Reinforced EPS Geopolymer Lightweight Concrete. Polymers 2025, 17(18), 2471 (doi:10.3390/polym17182471)",
    url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC12473786/", retrieved: "2026-10-16", date: "2025",
    locator: "Table 2 'Properties of basalt fibre'", excerpt: "Diameter 7–15 μm | Density 2.63–2.65 | Elastic Modulus 91–110 GPa | Tensile Strength 3000–4800 MPa | Elongation at Break 3.1 %", license: "CC BY 4.0",
  },
  "jiang-2025-materials-basalt": {
    kind: "document", sourceId: "paper", title: "Jiang H., Luo L., Hou Y., et al. Mechanical and Microstructural Performance of UHPC with Recycled Aggregates Modified by Basalt Fiber and Nanoalumina at High Temperatures. Materials 2025, 18(5), 1072 (doi:10.3390/ma18051072)",
    url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC11901275/", retrieved: "2026-10-16", date: "2025",
    locator: "Table 3 'Physical properties of the basalt fibre (BF)'", excerpt: "Length 12 mm | Diameter 16 μm | Density 2700 kg/m3 | Modulus of Elasticity 85–110 GPa | Tensile Strength (25 °C) 3000–4800 MPa", license: "CC BY 4.0",
  },
  "zhang-2024-heliyon-basalt": {
    kind: "document", sourceId: "paper", title: "Zhang X., Wang J., Lou C. Experimental study on axial tensile properties of basalt fibre reinforced recycled aggregate concrete. Heliyon 2024, 10(13), e34208 (doi:10.1016/j.heliyon.2024.e34208)",
    url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC11292499/", retrieved: "2026-10-16", date: "2024",
    locator: "Table 3 'Physical and mechanical properties of basalt fibers'", excerpt: "Length 9 mm | Monofilament diameter 17.4 μm | Density 2650 kg/m3 | Elastic modulus 88 GPa | Tensile strength 2950 MPa | Fracture elongation 2.8 %", license: "CC BY 4.0",
  },
  "gaska-2017-polymers-xgnp-m5": {
    kind: "document", sourceId: "paper", title: "Gaska K., Kádár R., Rybak A., et al. Gas Barrier, Thermal, Mechanical and Rheological Properties of Highly Aligned Graphene-LDPE Nanocomposites. Polymers 2017, 9(7), 294 (doi:10.3390/polym9070294)",
    url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC6432036/", retrieved: "2026-10-16", date: "2017",
    locator: "Table 1 'Basic characteristics of the LDPE and graphene nanoplatelets' (* parameters from the producer data sheet)",
    excerpt: "xGnP M5*: SA 120–160 m2/g; d_ave 5 µm; thickness 6–8 nm; ρ 2.2 g cm−3; thermal conductivity through plane 6, in-plane 3000 W/mK; electrical conductivity 10^2 / 10^7 S/m", license: "CC BY 4.0",
  },
  "watts-2021-acsomega-gnp": {
    kind: "document", sourceId: "paper", title: "Watts T.A., Gavvalapalli N. Role of Aryl Amphiphile Hydrophobe Size on the Concentration and Stability of Graphene Nanoplatelet Dispersions. ACS Omega 2021, 6(30), 20068 (doi:10.1021/acsomega.1c03126)",
    url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC8340392/", retrieved: "2026-10-16", date: "2021",
    locator: "Table 2 'Physical Properties of GNPs'", excerpt: "Strem 06-0215 | particle diameter 15 μm | thickness 6–8 nm | thermal conductivity 3000 W/m K | electrical conductivity 10^7 S/m | tensile modulus 1000 GPa | tensile strength 5 GPa", license: "CC BY 4.0",
  },
  "cilento-2022-nanomaterials-2d": {
    kind: "document", sourceId: "paper", title: "Cilento F., Martone A., Giordano M., et al. Insights on Shear Transfer Efficiency in “Brick-and-Mortar” Composites Made of 2D Carbon Nanoparticles. Nanomaterials 2022, 12(8), 1359 (doi:10.3390/nano12081359)",
    url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC9027589/", retrieved: "2026-10-16", date: "2022",
    locator: "Table 2 'Comparison between 2D nanoplatelets employed as reinforcement in B&M composites', row GNP (refs [15], [8])",
    excerpt: "GNP | >10 layer | BET 30 m2/g | Elastic Modulus 25–40 GPa [15] | In Plane—Therm. Cond. 300–470 W/mK [8] | 2 × 10^6 S/m", license: "CC BY 4.0",
  },
  "pubchem-cid-10112-melting": {
    kind: "url", sourceId: "pubchem", title: "PubChem CID 10112 Calcium Carbonate — Experimental Properties: Melting Point",
    url: "https://pubchem.ncbi.nlm.nih.gov/compound/10112#section=Melting-Point", retrieved: "2026-10-16",
    locator: "PUG View CID 10112 > \"Melting Point\" > Information 1–3 (CAMEO; OSHA; NIOSH) — replayed from fixtures/connector-recordings.json",
    excerpt: "1517 to 2442 °F (Decomposes) (NIOSH, 2024)", license: "NIOSH: US government",
  },
  "pubchem-cid-24261-melting": {
    kind: "url", sourceId: "pubchem", title: "PubChem CID 24261 Silica — Experimental Properties: Melting Point",
    url: "https://pubchem.ncbi.nlm.nih.gov/compound/24261#section=Melting-Point", retrieved: "2026-10-16",
    locator: "PUG View CID 24261 > \"Melting Point\" > Information 1–7 (CAMEO; HSDB; HMDB; ILO-WHO ICSC; DOE PAC; NIOSH) — replayed from fixtures/connector-recordings.json",
    excerpt: "3110 °F; 1710 °C; 1716 - 1736 °C; 1713 °C; 1722 °C", license: "NIOSH/HSDB: US government; ICSC: CC BY 4.0",
  },
};

/** An evidence ref (schema EvidenceRef) for a registered document. */
export function evidenceRef(docId) {
  const d = DOCUMENTS[docId];
  if (!d) throw new Error(`unknown evidence document "${docId}"`);
  return {
    kind: d.kind, sourceId: d.sourceId, title: d.title, url: d.url ?? null, document: docId,
    author: null, date: d.date ?? null, retrieved: d.retrieved, locator: d.locator, excerpt: d.excerpt,
    sha256: d.sha256 ?? null, license: d.license ?? null, receiptRef: null,
  };
}
