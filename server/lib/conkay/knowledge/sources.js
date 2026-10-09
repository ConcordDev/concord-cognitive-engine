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
// and route uncertain or conflicting records to review. No connector is live
// in this slice (status "planned"); the documents below were read by hand on
// the `retrieved` date and their values typed in with their locators.
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
  pubchem: { name: "PubChem (NCBI)", url: "https://pubchem.ncbi.nlm.nih.gov/", kind: "database", connector: "planned", license: "NCBI data are public domain, but individual contributed records (e.g. HSDB, CAMEO, ICSC) carry their own terms; record the contributing source per value." },
  nist_webbook: { name: "NIST Chemistry WebBook (SRD 69)", url: "https://webbook.nist.gov/chemistry/", kind: "database", connector: "planned", license: "NIST Standard Reference Data; cite NIST SRD 69 and the version." },
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
