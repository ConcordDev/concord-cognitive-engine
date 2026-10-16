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
    excerpt: "282.27% higher than that of pure HDPE (0.431 Wm−1 K−1); Table 2: HDPE T_M 134.73 °C, T_C 117.79 °C", license: "CC BY 4.0",
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
  "evgin-2020-bjnano-hdpe-gnp": {
    kind: "document", sourceId: "paper", title: "Evgin T., Turgut A., Hamaoui G., et al. Size effects of graphene nanoplatelets on the properties of high-density polyethylene nanocomposites: morphological, thermal, electrical, and mechanical characterization. Beilstein J. Nanotechnol. 2020, 11, 167 (doi:10.3762/bjnano.11.14)",
    url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC7006480/", retrieved: "2026-10-16", date: "2020",
    locator: "Materials (HDPE LITEN FB 75, 948 kg/m3; GnP G1 5 µm/50–100 nm, G2 44 µm/50–100 nm, G3 5 µm/5–8 nm); Table 2 (DSC); Thermal conductivity section (Figure 5 text); Electrical conductivity section",
    excerpt: "Table 2: HDPE (0 vol %) T_m 130.09 °C, T_c 116.30 °C; with GnP T_c 117.31–121.57 °C. 'the thermal conductivity of pure HDPE is 0.386 W/mK' … 'increased linearly with the addition of GnPs' … 'No thermal percolation threshold was observed for all types of nanocomposites' … 'with a GnP content of 13.92 vol %, the thermal conductivity of the HDPE/G2 nanocomposite was 0.729 W/mK, while for the HDPE/G1 and HDPE/G3 nanocomposites, it was enhanced up to 0.521 W/mK and 0.625 W/mK' … 'The percolation thresholds of G2 and G3 were 5.52 vol % and 7.38 vol %' … 'mainly ascribed to the high interfacial thermal boundary resistance'",
    license: "CC BY 4.0",
  },
  "segura-2025-polymers-hdpe-relaxation": {
    kind: "document", sourceId: "paper", title: "Segura-Méndez E.E., Puente-Córdova J.G., Rentería-Baltiérrez F.Y., et al. Modeling of Stress Relaxation Behavior in HDPE and PP Using Fractional Derivatives. Polymers 2025, 17(4), 453 (doi:10.3390/polym17040453)",
    url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC11859346/", retrieved: "2026-10-16", date: "2025",
    locator: "§3 Materials and Methods (stress relaxation, ASTM D638 Type I, Shimadzu AGS-X, steps of 1000 s); Table 6 (parallel Maxwell parameters for HDPE at 0.5/1/5/10 % strain)",
    excerpt: "HDPE | 0.5 | 170.4 | 57.800 | 443.5 | 5941.77 | 0.9925 … 1 | 132.2 | 48.008 | 387.5 | 5733.90 | 0.9778 … 5 | 89.71 | 69.930 | 209.8 | 6119.95 | 0.9900 … 10 | 67.27 | 48.100 | 140.8 | 5945.30 | 0.9836 (ε %, E6 MPa, τ6 s, E7 MPa, τ7 s, R2); 'The duration of each step was 1000 s'",
    license: "CC BY 4.0",
  },
  "pacheco-2015-lajss-prony": {
    kind: "document", sourceId: "paper", title: "Pacheco J.E.L., Bavastri C.A., Pereira J.T. Viscoelastic Relaxation Modulus Characterization Using Prony Series. Latin American Journal of Solids and Structures 2015, 12, 420–445",
    url: "https://www.scielo.br/j/lajss/a/JYnGg6LdhHhmq8cRG7Jdwjd/?format=pdf&lang=en", retrieved: "2026-10-16", date: "2015",
    locator: "eqs. 11–14 (Prony with WLF shift, constant-strain-rate stress); Table 4 (strain rate 1.0 /s, −35/23/80 °C); appendix Tables 7, 9, 11 (SABIC Stamax 30YM240, 30 % long glass fibre PP, ISO 527/1B)",
    excerpt: "Table 4: τ (s) 0.517896 → 2524.9 MPa; 193.062086 → 2301.1; 10000.000000 → 1021.0; E∞ 2217.5 MPa; C1 10.0; C2 103.8183 °C; Ts −55.4621 °C; Minimum error 0.3051 MPa2",
    sha256: "13127e40c707a51b113ed06cce281f159442592dbea949b6237186f9f9aaf95f", license: "CC BY-NC (SciELO)",
  },
  "ppi-tr19-2023": {
    kind: "document", sourceId: "standard", title: "Plastics Pipe Institute TR-19 (04.28.2023), Chemical Resistance of Plastic Piping Materials",
    url: "https://plasticpipe.org/TR-19", retrieved: "2026-10-16",
    locator: "p.6 (aqueous salt solutions); Table 2 Resistance Codes; Table 3 p.45 row 'Sodium Chloride, Saturated', column PE (MDPE, HDPE, PE-RT)",
    excerpt: "'aqueous solutions of neutral inorganic salts generally have the same effect on plastic piping materials as water alone; thus, sodium chloride … solutions have the same effect as water.' Table 3, Sodium Chloride, Saturated, PE: 'R to 140' (°F). Table 2: 'R to xx°F — Plastic material is generally Resistant up to the temperature (°F) indicated … Swelling < 3% or weight loss < 0.5% and elongation at break not significantly changed'",
    sha256: "313aada9bb934d27e2eb81b694a18ebbbdd2b85e61d0c6a0887d84c18e5d2b39", license: "PPI copyright; excerpt only",
  },
  "lavoie-2021-membranes-hdpe-uv": {
    kind: "document", sourceId: "paper", title: "Lavoie F.L., Kobelnik M., Valentin C.A., Tirelli É.F., Lopes M.L. Laboratory Study of the Ultraviolet Radiation Effect on an HDPE Geomembrane. Membranes 2021, 11(6), 390 (doi:10.3390/membranes11060390)",
    url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC8226566/", retrieved: "2026-10-16", date: "2021",
    locator: "§1 Introduction",
    excerpt: "'Polymer chain scission and polymer property degradation can occur when UV radiation reaches the geomembrane surface' … 'To protect the polymer from UV radiation, carbon black is added to the resin during the manufacturing process, about 2 to 3% in mass, typically with a particle size of 22–25 nm'",
    license: "CC BY 4.0",
  },
  "li-2023-h2-mechanism": {
    kind: "document", sourceId: "paper", title: "Li X., Huang Q., Liu Y., Zhao B., Li J. Review of the Hydrogen Permeation Test of the Polymer Liner Material of Type IV On-Board Hydrogen Storage Cylinders. Materials 2023, 16(15), 5366 (doi:10.3390/ma16155366)",
    url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC10420304/", retrieved: "2026-10-16", date: "2023",
    locator: "§1 ¶2; §2 (Hydrogen Permeation Mechanism in Polymer Liner Materials); Table 1 (CSA/ANSI CHMC 2, ISO 11114-5 test methods)",
    excerpt: "'the large gas permeability and dissolution rate can also lead to liner blistering and collapse' … 'polymers do not suffer from hydrogen embrittlement as metals do in high-pressure hydrogen environments' … 'When hydrogen dissolves in a polymer, it has a plasticizing effect, reducing the material's strength and increasing its toughness'",
    license: "CC BY 4.0",
  },
  "pubchem-cid-10112-reactivity": {
    kind: "url", sourceId: "pubchem", title: "PubChem CID 10112 Calcium Carbonate — Safety and Hazards: Reactivity Profile",
    url: "https://pubchem.ncbi.nlm.nih.gov/compound/10112#section=Reactivity-Profile", retrieved: "2026-10-16",
    locator: "PUG View CID 10112 > Safety and Hazards > Stability and Reactivity > Reactivity Profile (reference 3: CAMEO Chemicals) — replayed from fixtures/connector-recordings.json",
    excerpt: "'Incompatible with acids, alum, ammonium salts, fluorine, magnesium. Reacts with acids and acidic salts to generate gaseous carbon dioxide with effervescence (bubbling).'",
    license: "CAMEO Chemicals (NOAA): US government",
  },
  "mol-hdpe-catalogue-2023-processing": {
    kind: "document", sourceId: "manufacturer_datasheet", title: "MOL Group, High Density Polyethylene (TIPELIN) Product Catalogue 2023 — processing and oxidation induction time",
    url: "https://molgroupchemicals.com/userfiles/catalog/hdpe/HDPE_Product_catalogue_2023_EN.pdf", retrieved: "2026-10-16",
    locator: "p.9 (processing notes); p.7 blow-moulding grade table, column 'OIT 200°C' (EN 728, min)",
    excerpt: "p.9: 'Recommended melt temperatures are 180–220°C' (blow moulding); 'melt temperatures of 200–220°C are recommended' (film); 'Recommended processing temperatures are 170–220°C for extrusion.' p.7 OIT 200 °C (min) by grade: 8, 40, 90, 8, 7, 30, 90, 30, 105, 50, >100, 120, >120",
    sha256: "886a069738f4107b4046ae7a7f56ccbd7022160837f6cd57dc0ed4c2ed2a12f3", license: "manufacturer copyright; excerpt only",
  },
  "evgin-2020-bjnano-tga": {
    kind: "document", sourceId: "paper", title: "Evgin T., Turgut A., Hamaoui G., et al. Beilstein J. Nanotechnol. 2020, 11, 167 (doi:10.3762/bjnano.11.14) — TGA",
    url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC7006480/", retrieved: "2026-10-16", date: "2020",
    locator: "Characterization (TGA method); Table 3 (TGA results)",
    excerpt: "'TGA was carried out at a heating rate of 10 °C/min from room temperature to 700 °C under a nitrogen atmosphere'; Table 3, HDPE (0 vol %): T5% 440.77 °C, T50% 474.44 °C; 'T 5% (5% sample weight loss) was defined as the onset degradation temperature'",
    license: "CC BY 4.0",
  },
  // ---- Blend D brief item 9 (chamber checks), read 2026-10-16 ----
  "un-r134-02-amend3-burst": {
    kind: "document", sourceId: "standard", title: "UN Regulation No. 134 (hydrogen and fuel cell vehicles), 02 series of amendments, Amendment 3 (E/ECE/324/Rev.2/Add.133/Rev.1/Amend.3, 27 September 2024)",
    url: "https://documents.un.org/doc/undoc/gen/g24/178/89/pdf/g2417889.pdf", retrieved: "2026-10-16", date: "2024",
    locator: "§5.1.1 (baseline initial burst pressure)",
    excerpt: "'burst pressure within ±10 per cent of BPO and greater than or equal to a minimum BPmin of 200 per cent NWP. Containers having glass-fibre composite as a primary constituent shall have a minimum burst pressure greater than 350 per cent NWP.'",
    sha256: "f4ac7afce9dca960dfe9541e394438c3f580c2ac2c9e39a79947cc41c6615b9c", license: "UN/ECE official document, publicly available; excerpt with locator",
  },
  // ---- Blend D co-polymer candidates (Dutch 2026-10-16: discarded plastics), read 2026-10-16 ----
  "mba-pp2143-tds": {
    kind: "document", sourceId: "manufacturer_datasheet", title: "MBA Polymers UK, PP 2143 technical data sheet (post-consumer recycled polypropylene copolymer), TDS-PP2143-EN Rev 05-14",
    url: "https://mbapolymers.com/wp-content/uploads/2011/03/TDS-PP2143-EN-Rev0514-MBAUK.pdf", retrieved: "2026-10-16",
    locator: "p.1 Material Properties; p.2 Processing Information",
    excerpt: "'A post-consumer recycled polypropylene copolymer'; Density 0.94 g/cm3 (MBA Method); Tensile Modulus 1100 MPa (ISO 527); Tensile Stress at Yield (23°C) 20 MPa (ISO 527); Flexural Modulus (23°C) 900 MPa (ISO 178); Injection Moulding Melt Temperature Range 190-220 °C, Recommended Melt Temperature 200 °C",
    sha256: "3bbf9a22e779b0151044395ffe70cdb3b621ca07273da1f07945aff4bb43f356", license: "manufacturer copyright; excerpt only",
  },
  "vinmar-verdant-rrpi1520k": {
    kind: "document", sourceId: "manufacturer_datasheet", title: "Vinmar Polymers America, VERDANT RRPI1520K Series, recycled copolymer polypropylene (rev. 11/18/2024)",
    url: "https://vpa.vinmar.com/wp-content/uploads/VERDANT-RRPI1520K-Series.pdf", retrieved: "2026-10-16",
    locator: "p.1 property table",
    excerpt: "'a post-industrial recycled, reprocessed, polypropylene copolymer resin'; Density 0.902 g/cm3 (ASTM D-792A); Tensile Strength 3,600-3,700 (25-26) psi (MPa) (ASTM D-638); Flexural Modulus 140,000-169,000 (965-1,165) psi (MPa) (ASTM D-790); Notched Izod No Break",
    sha256: "2e0387d3553cbce532a2dcd08ebb29eb0077f57d323bacaf4dba7816b1bf72a2", license: "manufacturer copyright; excerpt only",
  },
  "vinmar-vinpol-rrpi50y": {
    kind: "document", sourceId: "manufacturer_datasheet", title: "Vinmar Polymers America, VINPOL RRPI50Y, recycled copolymer polypropylene (rev. 11/6/2018)",
    url: "https://vpa.vinmar.com/wp-content/uploads/VINPOL-RRPI50Y.pdf", retrieved: "2026-10-16",
    locator: "p.1 property table",
    excerpt: "'a post-industrial, reprocessed, copolymer polypropylene resin'; Density 0.91 g/cm3 (ASTM D-792); Tensile Strength at Yield 2,879 (19) psi (MPa) (ASTM D-638); Flexural Modulus – 1% Tangent 140,000 (966) psi (MPa) (ASTM D-790)",
    sha256: "785c4c91a2e85d0ccaf5d9dac3434ca2e7cb65851e023520a3e1674720466f6d", license: "manufacturer copyright; excerpt only",
  },
  "takayama-2025-polymers-pp-reuse": {
    kind: "document", sourceId: "paper", title: "Takayama T., et al. Evaluation of Polypropylene Reusability Using a Simple Mechanical Model Derived from Injection-Molded Products. Polymers 2025, 17, 2107 (doi:10.3390/polym17152107)",
    url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC12349465/", retrieved: "2026-10-16", date: "2025",
    locator: "Table 2 (materials); Table 7 (parameters at different extrusion times); Table 9 (DSC at different extrusion times)",
    excerpt: "Table 2: 'Block-type Polypropylene | Block-PP | ... | Novatec-PP BC03AD'. Table 7, Block-PP, extrusion cycles 0 / 1 / 3 / 5: E 1305 (50) / 1241 (77) / 1190 (72) / 1046 (35) MPa; υ 0.361 (0.017) / 0.370 (0.018) / 0.350 (0.024) / 0.341 (0.018); σy 22.2 / 21.4 / 21.4 / 20.3 MPa. Table 9, Block-PP Tm 165.2 / 165.8 / 165.0 / 165.0 °C",
    license: "CC BY 4.0",
  },
  "vinmar-vinpol-ev0218": {
    kind: "document", sourceId: "manufacturer_datasheet", title: "Vinmar Polymers America, VINPOL EV0218 ethylene vinyl acetate copolymer, 18 % VA (rev. 1/12/2022)",
    url: "https://vpa.vinmar.com/wp-content/uploads/VINPOL-EV0218.pdf", retrieved: "2026-10-16",
    locator: "p.1 property table",
    excerpt: "'Targeted applications include foams, shoe soles'; Vinyl Acetate Content 18 wt% (ASTM D-5594); Density 0.935 g/cm3 (ASTM D-1505); Melting Point 189 (87) °F (°C) (ASTM D-3418); Tensile Strength at Yield 5.2 MPa (ASTM D-638); Flexural Modulus 60 MPa (ASTM D-790)",
    sha256: "0874506d38df69614e6d40a4baa611e70247777cf1e351d59be375cd9e820dce", license: "manufacturer copyright; excerpt only",
  },
  "vinmar-vinpol-ev0627": {
    kind: "document", sourceId: "manufacturer_datasheet", title: "Vinmar Polymers America, VINPOL EV0627 ethylene vinyl acetate copolymer, 26.7 % VA (rev. 1/18/2024)",
    url: "https://vpa.vinmar.com/wp-content/uploads/VINPOL-EV0627.pdf", retrieved: "2026-10-16",
    locator: "p.1 property table (compression-moulded specimens, supplier methods)",
    excerpt: "Vinyl Acetate Content 26.7 wt%; Density 0.953 g/cm3 (ASTM D-1505); Peak Melting Temperature 162 (72) °F (°C); 1% Secant Flexural Modulus 3,300 (23) psi (MPa); 'All physical properties were measured on compression molded specimens.'",
    sha256: "78c51c9d6dace0119fce25f01047992bf0ce52ba64dcf97036dd2d83fec087a6", license: "manufacturer copyright; excerpt only",
  },
  "rondon-2026-edt-eva-mouthguard": {
    kind: "document", sourceId: "paper", title: "Rondon A.K.A., Cordeiro I.B., Lozada M.I.T., et al. Biomechanical Analysis of 3D Printed and Thermoformed EVA Custom-Made Mouthguard: Experimental and Finite Element Analyses. Dental Traumatology 2026 (doi:10.1111/edt.70044)",
    url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC13356495/", retrieved: "2026-10-16", date: "2026",
    locator: "Methods (Poisson's ratio by ASTM D638 axial tensile tests with a speckle pattern, small strain; density ASTM D792); Table 3",
    excerpt: "Table 3 (EVA sheets Bio-art / Essence dental / Proform): Elastic modulus 33.7 ± 1.0 / 36.8 ± 1.3 / 20.1 ± 0.9 MPa; Density 0.94 ± 0.09 / 0.99 ± 0.02 / 0.95 ± 0.01 g·cm−3; Poison ratio 0.29 ± 0.05 / 0.29 ± 0.05 / 0.29 ± 0.05",
    license: "CC BY 4.0",
  },
  "ciaaw-abridged-atomic-weights": {
    kind: "url", sourceId: "paper", title: "IUPAC Commission on Isotopic Abundances and Atomic Weights (CIAAW), Abridged Standard Atomic Weights",
    url: "https://www.ciaaw.org/abridged-atomic-weights.htm", retrieved: "2026-10-16",
    locator: "table rows 6 (C), 8 (O), 20 (Ca)",
    excerpt: "6 | C | carbon | 12.011 ± 0.002; 8 | O | oxygen | 15.999 ± 0.001; 20 | Ca | calcium | 40.078 ± 0.004",
    sha256: "f9e9554471749c55a624aec55151922470a7f4104c62811eb194fed9731b907d", license: "IUPAC/CIAAW public reference data",
  },
  // ---- Blend D "missing solvers" 1: filler property data, read 2026-10-16 ----
  "korth-calcite": {
    kind: "url", sourceId: "manufacturer_datasheet", title: "Korth Kristalle GmbH, Calcite (CaCO3) material data",
    url: "https://www.korth.de/en/materials/detail/Calcite", retrieved: "2026-10-16",
    locator: "material data table",
    excerpt: "Density 2.711 g/cm3 @25°C; Thermal Conductivity ∥C 5.526 W/m·K for 273 K, ⊥C 4.646 W/m·K for 273 K; Thermal Expansion ∥C 25·10-6, ⊥C -5.8·10-6; Shear Modulus 32 GPa; Bulk Modulus 129.6 GPa; Elastic Coefficient C11 = 144 GPa; C12 = 53.9 GPa; C14 = 20.5 GPa; C13 = 51.1 GPa; C33 = 84 GPa; C44 = 33.5 GPa; Poisson Ratio 0.31",
    sha256: "d6658747137529c2e17e14207e125d6519cec37934d2019946a22be5666e8bbb", license: "supplier copyright; excerpt only",
  },
  "crystran-calcite": {
    kind: "url", sourceId: "manufacturer_datasheet", title: "Crystran Ltd, Calcite (CaCO3) optical material data",
    url: "https://crystran.com/optical-materials/calcite-caco3", retrieved: "2026-10-16",
    locator: "material data table",
    excerpt: "Density 2.71 g/cc; Melting Point 825°C (Decomposes); Thermal Conductivity 5.526 (para) 4.646 (perp) W m-1 K-1 at 273K; Thermal Expansion 25 (para) -5.8 (perp) x 10-6 K-1 at 273K; Youngs Modulus (E) 72.35 (perp) 88.19 (para) GPa; Shear Modulus (G) 35 GPa; Bulk Modulus (K) 129.53 GPa; Elastic Coefficients C11=137; C12=45; C13=45; C14=21; C33=79; Poisson Ratio n/a",
    sha256: "40a884b321c3707a0a25b318c9e6e24f359f43153da1f5c7ef123c97fd2b8845", license: "supplier copyright; excerpt only",
  },
  "crystran-fused-silica": {
    kind: "url", sourceId: "manufacturer_datasheet", title: "Crystran Ltd, Fused Silica Glass (SiO2) optical material data",
    url: "https://crystran.com/optical-materials/fused-silica-glass-sio2", retrieved: "2026-10-16",
    locator: "material data table",
    excerpt: "Density 2.203 g/cc; Thermal Conductivity 1.38 W m-1 K-1; Thermal Expansion 0.55 x 10-6 /°C @ 300 K; Youngs Modulus (E) 73.1 GPa; Shear Modulus (G) 31.2 GPa; Bulk Modulus (K) 36.7 GPa; Poisson Ratio 0.17; Class/Structure Amorphous Glass",
    sha256: "308944e5e3d4a6c7309c8a739ee1049e7e996e9a211c0650eba06c55a8000720", license: "supplier copyright; excerpt only",
  },
  "crystran-crystal-quartz": {
    kind: "url", sourceId: "manufacturer_datasheet", title: "Crystran Ltd, Crystal Quartz (SiO2) optical material data",
    url: "https://crystran.com/optical-materials/crystal-quartz-sio2", retrieved: "2026-10-16",
    locator: "material data table",
    excerpt: "Density 2.649 g/cc; Thermal Conductivity 10.7 (para) 6.2 (perp) W m-1 K-1 at 323 K; Thermal Expansion 7.1 (para) 13.2 (perp) x 10-6/°C; Youngs Modulus (E) 97.2 (para) 76.5 (perp) GPa; Shear Modulus (G) 31.14 GPa; Bulk Modulus (K) 36.4 GPa; Elastic Coefficients C11=87 C12=7 C44=58 C13=13 C14=(-)18 C33=106; Poisson Ratio n/a",
    sha256: "0a61d6b5a26250640356348711bd94b962e46f68efb3f8f168f9c9ab48578f57", license: "supplier copyright; excerpt only",
  },
  "quantas-calcite-vrh": {
    kind: "url", sourceId: "paper", title: "Quantas documentation (2.0.0-beta), Elasticity analysis tutorial: calcite (B3LYP) stiffness tensor and Voigt–Reuss–Hill averages",
    url: "https://quantas.readthedocs.io/en/2.0.0-beta/tutorials/elasticity.html", retrieved: "2026-10-16",
    locator: "calcite.dat input block; 'Voigt-Reuss-Hill average properties' table",
    excerpt: "162.859000 63.582000 60.233000 0.000000 20.670000 0.000000 / 162.859000 60.233000 0.000000 -20.670000 0.000000 / 89.647000 0.000000 0.000000 0.000000 / 36.640000 0.000000 -20.670000 / 36.640000 0.000000 / 49.638000; Voigt | 87.0512 | 104.0720 | 40.0047 | 0.300746; Reuss | 79.1474 | 81.0336 | 30.4784 | 0.329361; Hill | 83.0993 | 92.6302 | 35.2416 | 0.314218 (K, E, G GPa; nu)",
    sha256: "bf6372e97a0ab9ca2d5885861f4dbf7a0a881fbb345ed39e528606904f4b4b8b", license: "software documentation; excerpt only (benchmark for the VRH routine)",
  },
  "yun-2023-polymers-basalt-particulate": {
    kind: "document", sourceId: "paper", title: "Yun J.-H., Jeon Y.-J., Kang M.-S., et al. Effective Properties for the Design of Basalt Particulate–Polymer Composites. Polymers 2023, 15(20), 4125 (doi:10.3390/polym15204125)",
    url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC10610629/", retrieved: "2026-10-16", date: "2023",
    locator: "Table 1 'Properties of materials' (compiled from refs 29–34), column Basalt",
    excerpt: "Basalt: Density 2.75 g/cm3; Thermal expansion coefficient 8 × 10−6 1/K; Elastic modulus 89,000 MPa; Poisson's ratio 0.20; Shear modulus 37,083.33 MPa; Thermal conductivity 0.035 W/mK",
    license: "CC BY 4.0",
  },
  "khina-2025-polymers-clte-fillers": {
    kind: "document", sourceId: "paper", title: "Khina A.G., et al. Coefficient of Linear Thermal Expansion of Polymers and Polymer Composites: A Comprehensive Review. Polymers 2025, 17(23), 3097 (doi:10.3390/polym17233097) — fillers",
    url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC12693757/", retrieved: "2026-10-16", date: "2025",
    locator: "Table 5 'CLTE of fillers typical for polymer composites'",
    excerpt: "SiO2 (quartz glass) | 25–250 | 0.55; Graphite (in-plane) | 0–300 | −0.5–(−1.5); Graphite (out-of-plane) | 0–300 | 20–30; Graphene | −73–127 | ~−12–(−2.5); Basalt fiber (longitudinal direction) | −50–600 | 5.0–8.0; Basalt fiber (transverse direction) | 7.0–12.0 (ppm/°C)",
    license: "CC BY 4.0",
  },
  "macromolecules-2023-pp-graphene-cgmd": {
    kind: "document", sourceId: "paper", title: "Atta M., Srivastava R., Koutroumanis N., Semitekolos D., et al. Mesoscopic Modeling and Experimental Validation of Thermal and Mechanical Properties of Polypropylene Nanocomposites Reinforced By Graphene-Based Fillers. Macromolecules 2023, 56 (doi:10.1021/acs.macromol.3c01529)",
    url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC10753874/", retrieved: "2026-10-16", date: "2023",
    locator: "Table 1 'Mechanical and Thermal Properties of Graphene as Computed by CG-MD'",
    excerpt: "armchair | 845 | 0.14 | 621.5; zigzag | 916 | 0.15 | 658.7 (Young's modulus GPa | Poisson ratio | thermal conductivity W/(m K))",
    license: "CC BY 4.0",
  },
  "heliyon-2024-eshelby-spheroid": {
    kind: "document", sourceId: "paper", title: "Analytical solutions for macroscopic elastic moduli and thermal expansion coefficient of composite materials with coated fillers. Heliyon 2024, e25274 (doi:10.1016/j.heliyon.2024.e25274)",
    url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC11637110/", retrieved: "2026-10-16", date: "2024",
    locator: "Appendix A, eqs. (A.1a)–(A.1c) geometrical factors and (A.2)–(A.3) Eshelby tensor of a spheroid",
    excerpt: "(A.1a) prolate: H3 = 1 − ω3/(ω3²−1)^(3/2) {ω3(ω3²−1)^(1/2) − cosh⁻¹ω3}, H31 = (1 − 3H3)/(2(ω3²−1)); (A.1b) sphere: H3 = 1/3, H31 = 1/5; (A.1c) oblate: H3 = 1 − ω3/(1−ω3²)^(3/2) {cos⁻¹ω3 − ω3(1−ω3²)^(1/2)}; (A.2) S1111 = S2222 = (5−4ν)/(8(1−ν))(1−H3) + 3(H3−H31)/(8(1−ν)), S3333 = H3 + (H3−H31)/(1−ν), S1122 = S2211 = −(1−4ν)/(8(1−ν))(1−H3) + (H3−H31)/(8(1−ν)); (A.3) S2233 = S1133 = ν/(2(1−ν))(1−H3) − (H3−H31)/(2(1−ν)), S3311 = S3322 = ν/(1−ν)H3 − (H3−H31)/(2(1−ν)), S2323 = S3131 = (1/4)(1+H3) − (H3−H31)/(2(1−ν)), S1212 = (S1111 − S1122)/2",
    license: "CC BY (Heliyon open access)",
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
