// server/lib/conkay/safety-case/facility-nuscale-us600.js
//
// Facility-level system / structure / component (SSC) skeleton of a public,
// NRC-certified reference design: the NuScale US600 (10 CFR Part 52,
// Appendix G; final rule 88 FR 3287, 2023-01-19, effective 2023-02-21).
//
// PUBLIC DATA ONLY, and only what was actually read (2026-10-10):
//   primary   the design-certification final rule as published in the Federal
//             Register (govinfo.gov HTML), quoted verbatim with its section;
//   secondary a peer-reviewed open-access review (Welter, Reyes, Brigantic,
//             Frontiers in Energy Research 2023), quoted verbatim; it describes
//             the NuScale design family and, where it differs from the rule, the
//             later US460 / VOYGR design: such differences are CONFLICTS for
//             review, never silently merged.
// The DCA FSAR Tier 2 chapters on nrc.gov could not be retrieved by this tool
// (HTTP 403 to automated requests on 2026-10-10); everything they would supply
// (valve counts per train, ECCS success criterion, DC system architecture, MPS
// divisions, building and fire-area layout) is a listed GAP, not a value.
//
// This is a dependency skeleton for SCREENING, not a plant model: it holds
// what depends on what, as stated in the sources, so cross-system checks can
// run. It makes no claim about the plant's safety.

const RETRIEVED = "2026-10-10";

export const US600_SOURCES = Object.freeze({
  "fr-2023-00729": {
    title: "NuScale Small Modular Reactor Design Certification, final rule (10 CFR Part 52, Appendix G), 88 FR 3287, Federal Register Doc. 2023-00729, 2023-01-19",
    url: "https://www.govinfo.gov/content/pkg/FR-2023-01-19/html/2023-00729.htm",
    alt: "https://www.federalregister.gov/documents/2023/01/19/2023-00729/nuscale-small-modular-reactor-design-certification",
    quality: "primary", publisher: "U.S. NRC (Federal Register)", retrieved: RETRIEVED,
  },
  "frontiers-2023": {
    title: "K. Welter, J. N. Reyes Jr, A. Brigantic, Unique safety features and licensing requirements of the NuScale small modular reactor, Frontiers in Energy Research 11 (2023), doi:10.3389/fenrg.2023.1160150",
    url: "https://www.frontiersin.org/journals/energy-research/articles/10.3389/fenrg.2023.1160150/full",
    quality: "secondary", publisher: "peer-reviewed journal (open access); authors affiliated with the vendor", retrieved: RETRIEVED,
    caution: "describes the NuScale design family in 2023, including the later US460 / VOYGR design; any fact that differs from the US600 rule is recorded as a conflict",
  },
});

const fact = (id, source, locator, quote, extra = {}) => ({ id, source, locator, quote, verbatim: true, quality: US600_SOURCES[source].quality, ...extra });

export const US600_FACTS = Object.freeze({
  module: fact("F-module", "fr-2023-00729", "I. Background", "A power module is a natural circulation light water reactor composed of a reactor core, a pressurizer, and two helical coil steam generators located in a common reactor pressure vessel that is housed in a compact cylindrical steel containment."),
  rating: fact("F-rating", "fr-2023-00729", "I. Background", "Each power module has a rated thermal output of 160 megawatt thermal (MWt) and electrical output of 50 megawatt electric (MWe), yielding a total capacity of 600 MWe for 12 power modules."),
  pool: fact("F-pool", "fr-2023-00729", "I. Background", "All the NuScale power modules are partially submerged in a common safety-related pool, which is also the ultimate heat sink for up to 12 power modules."),
  noClass1E: fact("F-no-1E", "fr-2023-00729", "IV.E Absence of Safety-Related Class 1E AC or DC Electrical Power", "NuScale does not contain safety-related Class 1E AC or DC electrical power systems."),
  noPowerReliance: fact("F-no-power", "fr-2023-00729", "IV.E Absence of Safety-Related Class 1E AC or DC Electrical Power", "NuScale has no safety-related functions that rely on electrical power. For example, the emergency core cooling system performs its safety function without reliance on safety-related electrical power or external sources of coolant inventory makeup."),
  eccsPath: fact("F-eccs", "fr-2023-00729", "IV.C Emergency Core Cooling System Inadvertent Actuation Block Valve", "The NuScale emergency core cooling system relies on natural circulation cooling of the reactor core by releasing the heated reactor coolant steam from the top of the reactor pressure vessel through three reactor vent valves into the containment vessel and returning the cooled condensed reactor coolant water to the reactor pressure vessel through two reactor recirculation valves."),
  eccsValve: fact("F-eccs-valve", "fr-2023-00729", "IV.C Emergency Core Cooling System Inadvertent Actuation Block Valve", "Each reactor vent valve and reactor recirculation valve consists of a first-of-a-kind arrangement of a main valve, an inadvertent actuation block (IAB) valve, a solenoid trip valve, and a solenoid reset valve."),
  iab: fact("F-iab", "fr-2023-00729", "IV.C Emergency Core Cooling System Inadvertent Actuation Block Valve", "The IAB valve for each reactor vent valve and reactor recirculation valve is designed to close rapidly to prevent its corresponding emergency core cooling system main valve from opening when the reactor coolant system is at high pressure conditions."),
  sgDamage: fact("F-sg", "fr-2023-00729", "III.C.3 Steam Generator Stability", "Damage to multiple steam generator tubes could disrupt natural circulation in the reactor coolant pathway and interfere with the decay heat removal system and the emergency core cooling system, which is relied upon to cool the reactor core in a NuScale power module."),
  controlRoom: fact("F-cr", "fr-2023-00729", "III. Control Room Staffing Requirements", "In a letter to the NRC, dated September 15, 2015, NuScale Power proposed that 6 licensed operators would operate up to 12 power modules from a single control room."),
  dhrsTrains: fact("F-dhrs", "frontiers-2023", "2.2.1 Decay heat removal system", "Two trains of decay heat removal equipment are provided, one for each steam generator. Each train is capable of removing 100 percent of the decay heat load"),
  dhrsActuation: fact("F-dhrs-act", "frontiers-2023", "2.2.1 Decay heat removal system", "When responding to a design basis event and upon receipt of an actuation signal, the DHRS isolation valves open and the secondary system (main steam and feedwater) isolation valves close."),
  dhrsPool: fact("F-dhrs-pool", "frontiers-2023", "2.2.1 Decay heat removal system", "The DHRS condenser...is submerged in the reactor pool.", { note: "ellipsis as returned by the retrieval" }),
  failSafe: fact("F-failsafe", "frontiers-2023", "2.2 Passive safety systems", "valves that fail to their safe position on a loss of power, meaning that safety system operation is ensured without reliance on electrical power."),
  mps: fact("F-mps", "frontiers-2023", "2.2 Passive safety systems", "When power is available, the systems are controlled via a dedicated safety-related module protection system (MPS), which monitors various plant conditions and actuates the safety systems if required."),
  poolHeat: fact("F-pool-heat", "frontiers-2023", "2.2.3 Containment and ultimate heat sink", "The pool absorbs the decay heat from the modules and eventually begins to boil."),
  building: fact("F-rxb", "frontiers-2023", "2.2.3 Containment and ultimate heat sink", "The NPMs are located below grade in a...Seismic Category I reactor building.", { note: "ellipsis as returned by the retrieval" }),
  eccsTwoRvv: fact("F-eccs-2rvv", "frontiers-2023", "2.2.2 Emergency core cooling system", "The system is initiated by opening the two reactor vent valves at the top of the reactor pressure vessel (the pressurizer region) and the two fail-safe reactor recirculation valves"),
  // Layout (Phase 3 drawings): what the rule states about the building, verbatim; no dimension is in the rule.
  rxbTwelve: fact("F-rxb-12", "fr-2023-00729", "I. Background", "The NuScale reactor building is designed to hold up to 12 power modules."),
  poolBelowGrade: fact("F-pool-grade", "fr-2023-00729", "I. Background", "The pool portion of the reactor building is located below grade."),
  bayGallery: fact("F-bay-gallery", "fr-2023-00729", "III.C Issues Not Resolved by the Design Certification", "This issue is narrowly focused on the shielding walls between the reactor module bays and the reactor building steam gallery areas."),
  radZoneMap: fact("F-rz-map", "fr-2023-00729", "Appendix G, Section IV.A.2.g", "design certification application Part 2, Tier 2, Chapter 12, Figure 12.3-1, ``Reactor Building Radiation Zone Map''", { note: "names the DCA figure that shows the reactor building layout (not read: nrc.gov blocked)" }),
  // Dimensions: secondary, design-family level (the review covers US600 and the later US460 / VOYGR); drawn as S2, never as US600 values.
  cnvSize: fact("F-cnv-size", "frontiers-2023", "1.1 Reactor configuration", "The reactor vessel is enclosed in a stainless steel containment vessel (CNV) that is nominally 76 ft tall and 19 ft in diameter."),
  baySize: fact("F-bay-size", "frontiers-2023", "1.1 Reactor configuration", "Each NPM is operated in its own bay, immersed in a pool of water which is approximately 20 ft square by 53 ft deep (see Figure 3 )."),
});

export const US600_CONFLICTS = Object.freeze([
  {
    id: "C-rvv-count", subject: "number of ECCS reactor vent valves per module", decision: "pending_human_review",
    values: [{ value: 3, fact: "F-eccs", source: "fr-2023-00729 (US600 rule, primary)" }, { value: 2, fact: "F-eccs-2rvv", source: "frontiers-2023 (secondary; describes the later design family)" }],
    disposition: "the US600 model uses the primary source (3 RVVs); the conflict is kept for a reviewer, who decides whether the secondary source describes US460 / VOYGR",
  },
]);

// Where each gap's answer is, for a human to pull. Automated retrieval was attempted and blocked (US600_RETRIEVAL_LOG).
// Document titles and ADAMS accession numbers are quoted from the final rule's "Availability of Documents" table
// (88 FR 3287, section XVII). Tier 2 chapter titles are quoted from Appendix G, paragraph III.A.2.b (the material
// incorporated by reference); Appendix G III.A.1.b says that material is in ADAMS under ML20225A071. Section and
// figure numbers below a chapter are marked "rule" when the rule itself cites them, otherwise "verify" (the
// standard-format numbering of RG 1.206 Rev. 1, ML18131A181, which must be checked against the DCA's own contents).
const DCA_REV5 = { document: "NuScale Power, LLC, Submittal of the NuScale Standard Plant Design Certification Application, Revision 5, July 2020", adams: "ML20225A071", part: "Part 2--Tier 2, Revision 5, July 2020" };
const FSER = { document: "NuScale DCA Final Safety Evaluation Report, August 2020", adams: "ML20023A318" };
const ch = (n, title) => `Chapter ${n}, ${title}`; // verbatim from App. G III.A.2.b
const ref = (base, chapter, section, sectionBasis) => ({ ...base, chapter, section, sectionBasis });
const T2 = {
  c1: ch("One", "Introduction and General Description of the Plant"), c3: ch("Three", "Design of Structures, Systems, Components and Equipment"),
  c5: ch("Five", "Reactor Coolant System and Connecting Systems"), c6: ch("Six", "Engineered Safety Features"), c7: ch("Seven", "Instrumentation and Controls"),
  c8: ch("Eight", "Electric Power"), c9: ch("Nine", "Auxiliary Systems"), c12: ch("Twelve", "Radiation Protection"), c15: ch("Fifteen", "Transient and Accident Analyses"),
  c19: ch("Nineteen", "Probabilistic Risk Assessment and Severe Accident Evaluation"), c21: ch("Twenty-One", "Multi-Module Design Considerations"),
};
export const US600_GAP_SOURCES = Object.freeze({
  "G-eccs-success": [
    ref(DCA_REV5, T2.c6, "6.3 emergency core cooling system", "verify"),
    ref(FSER, T2.c15, "15.0.0.5, \"Limiting Single Failures\"", "rule"),
    ref(FSER, T2.c19, "19.1.4.6.4, \"Success Criteria, Accident Sequences, and Systems Analyses\"", "rule"),
    { document: "SRM-SECY-19-0036, Staff Requirements--SECY-19-0036--Application of the Single Failure Criterion to NuScale Power LLC's Inadvertent Actuation Block Valves, July 2, 2019", adams: "ML19183A408", chapter: null, section: "whole document", sectionBasis: "rule" },
  ],
  "G-dhrs-valves": [ref(DCA_REV5, T2.c5, "the decay heat removal system section", "verify"), ref(FSER, T2.c5, "the decay heat removal system section", "verify")],
  "G-dc": [
    ref(DCA_REV5, T2.c8, "8.3.2 DC power systems", "verify"), ref(DCA_REV5, T2.c21, "shared electrical systems", "verify"),
    { document: "NRC Safety Evaluation for NuScale Power, LLC, Topical Report, TR-0815-16497, Revision 1, Safety Classification of Passive Nuclear Power Plant Electrical Systems, December 13, 2017", adams: "ML17340A524", chapter: null, section: "whole document", sectionBasis: "rule" },
  ],
  "G-mps": [ref(DCA_REV5, T2.c7, "module protection system", "verify")],
  "G-layout": [
    ref(DCA_REV5, T2.c1, "1.2 general plant description (arrangement figures)", "verify"), ref(DCA_REV5, T2.c12, "Figure 12.3-1, \"Reactor Building Radiation Zone Map\"", "rule"),
    ref(DCA_REV5, T2.c9, "9.5.1 fire protection (fire areas)", "verify"), ref(DCA_REV5, T2.c21, "shared structures and spatial interactions", "verify"),
  ],
  "G-dimensions": [ref(DCA_REV5, T2.c1, "1.2 general arrangement drawings of the reactor building", "verify"), ref(DCA_REV5, T2.c3, "3.8 seismic Category I structures (reactor building, pool)", "verify"), ref(DCA_REV5, T2.c12, "Figure 12.3-1, \"Reactor Building Radiation Zone Map\"", "rule")],
  "G-pool-inventory": [ref(DCA_REV5, T2.c9, "9.2.5 ultimate heat sink", "verify"), ref(DCA_REV5, T2.c21, "shared pool", "verify")],
  "G-reliability": [ref(DCA_REV5, T2.c19, "19.1 probabilistic risk assessment (data)", "verify"), ref(FSER, T2.c19, "19.1", "verify")],
});

// Automated retrieval attempts for the gaps (2026-10-10, curl with a browser user agent): status codes as returned.
export const US600_RETRIEVAL_LOG = Object.freeze([
  { url: "https://www.nrc.gov/reactors/new-reactors/smr/licensing-activities/nuscale.html", status: 403 },
  { url: "https://www.nrc.gov/docs/ML2022/ML20225A071.html", status: 403 },
  { url: "https://pbadupws.nrc.gov/docs/ML2022/ML20225A071.html", status: 403 },
  { url: "https://adams.nrc.gov/wba/services/search/advanced/nrc (ML20225A071 query)", status: "no response (20 s timeout)" },
  { url: "https://adams-api.nrc.gov/aps/api/search/ML20225A071", status: 401, note: "the ADAMS API needs a registered subscription key" },
  { url: "https://www.govinfo.gov/content/pkg/FR-2023-01-19/html/2023-00729.htm", status: 200, note: "the final rule: read; quotes and locators re-checked against it" },
  { url: "https://www.frontiersin.org/journals/energy-research/articles/10.3389/fenrg.2023.1160150/full", status: 200, note: "the secondary review: read" },
]);

export const US600_GAPS = Object.freeze([
  { id: "G-eccs-success", item: "ECCS success criterion (how many RVVs and RRVs must open)", where: "US600 DCA FSAR Tier 2 ch. 6.3 (not read: nrc.gov HTTP 403)", effect: "ECCS is screened only for supports every valve train shares (valid for any success criterion); no k-of-n single-failure screen" },
  { id: "G-dhrs-valves", item: "DHRS actuation / isolation valve count and type per train", where: "US600 DCA FSAR Tier 2 (DHRS section)", effect: "each train is modelled as one valve group + one condenser; no NUREG/CR-6928 data row can be matched" },
  { id: "G-dc", item: "non-Class 1E DC system architecture (common vs module-specific, divisions, battery duration)", where: "US600 DCA FSAR Tier 2 ch. 8.3.2", effect: "multi-module actuation on loss of a shared DC supply is not determinable" },
  { id: "G-mps", item: "module protection system separation groups / divisions and their power", where: "US600 DCA FSAR Tier 2 ch. 7", effect: "MPS modelled as one actuating system per module; channel independence not screened" },
  { id: "G-layout", item: "building, room and fire-area layout of DHRS / ECCS equipment", where: "US600 DCA FSAR Tier 2 ch. 1.2, 3, 9.5.1", effect: "spatial common-cause (fire, flood) not screened" },
  { id: "G-pool-inventory", item: "pool inventory, level limits and heat-up / boil-off times for the US600", where: "US600 DCA FSAR Tier 2 ch. 9.2.5", effect: "the shared heat sink is a structural dependency only; no time to boil" },
  { id: "G-dimensions", item: "US600 building, pool, bay and containment dimensions and the bay arrangement", where: "US600 DCA FSAR Tier 2 ch. 1.2 and 3.8 (and Figure 12.3-1)", effect: "the facility GA is schematic: the only dimensions drawn are the secondary, design-family values (CNV 76 ft x 19 ft, bay 20 ft square x 53 ft deep), labelled S2; the bay arrangement, building outline and pool-to-grade elevation are UNKNOWN" },
  { id: "G-reliability", item: "failure data for passive components (condensers, pool, building) and NuScale valve designs", where: "a human-chosen data basis (NUREG/CR-6928 has no matching rows for these)", effect: "fault and event trees are built and their cut sets computed; nothing is quantified" },
]);

/**
 * The facility SSC graph for n modules (the rule: up to 12). Shared SSCs once; per-module SSCs prefixed "M{i}:".
 * ssc: { id, name, kind, scope, facts }; dependencies: { from, to, type, facts, note? }
 *   type "requires"     loss of `to` defeats `from` (as stated or as a stated physical dependency)
 *   type "fail-safe"    loss of `to` moves `from` to its safe position (actuates); it does not defeat it
 *   type "actuates"     `to` sends the actuation signal to `from` when power is available
 * functions: { id, name, module, trains: [{ id, components }], successCriterion: { k, facts } | { unknown, gap } }
 */
export function buildUS600Facility({ modules = 12 } = {}) {
  if (!Number.isInteger(modules) || modules < 1 || modules > 12) throw new Error("modules must be 1..12 (the rule: up to 12 power modules)");
  const F = US600_FACTS;
  const ssc = [
    { id: "RXB", name: "Reactor building (Seismic Category I, below-grade pool)", kind: "structure", scope: "shared", facts: [F.building.id, F.rxbTwelve.id, F.poolBelowGrade.id] },
    { id: "GALLERY", name: "Reactor building steam gallery area (behind the module bays' shield walls)", kind: "structure", scope: "shared", facts: [F.bayGallery.id] },
    { id: "POOL", name: "Common reactor pool / ultimate heat sink", kind: "ultimate-heat-sink", scope: "shared", facts: [F.pool.id, F.poolHeat.id] },
    { id: "CR", name: "Single control room for up to 12 modules", kind: "control-room", scope: "shared", facts: [F.controlRoom.id] },
    { id: "ELEC", name: "Electrical power (non-Class 1E AC and DC; no safety-related function relies on it)", kind: "power", scope: "shared", facts: [F.noClass1E.id, F.noPowerReliance.id], note: "the common / module-specific split is a gap (G-dc)" },
  ];
  const dependencies = [{ from: "POOL", to: "RXB", type: "requires", facts: [F.building.id, F.pool.id], note: "stated physical dependency: the pool is in the reactor building; its integrity rests on the building structure" }];
  const functions = [];
  for (let i = 1; i <= modules; i++) {
    const m = (s) => `M${i}:${s}`;
    ssc.push(
      { id: m("BAY"), name: `module ${i} bay (in the pool, shield wall to the steam gallery)`, kind: "structure", scope: "per-module", facts: [F.bayGallery.id, F.baySize.id] },
      { id: m("NPM"), name: `power module ${i}: RPV with core, pressurizer, two helical-coil SGs`, kind: "module", scope: "per-module", facts: [F.module.id, F.rating.id] },
      { id: m("CNV"), name: `module ${i} containment vessel`, kind: "structure", scope: "per-module", facts: [F.module.id, F.eccsPath.id] },
      { id: m("MPS"), name: `module ${i} protection system`, kind: "ic", scope: "per-module", facts: [F.mps.id] },
    );
    dependencies.push({ from: m("CNV"), to: "POOL", type: "requires", facts: [F.pool.id, F.poolHeat.id], note: "the module is partially submerged in the pool, which absorbs the decay heat" });
    dependencies.push({ from: m("MPS"), to: "ELEC", type: "fail-safe", facts: [F.mps.id, F.failSafe.id], note: "on loss of power the actuated valves fail to their safe position" });
    // DHRS: two trains, one per steam generator, each 100 %
    const dhrsTrains = [];
    for (const t of [1, 2]) {
      const v = m(`DHRS${t}-VALVES`), c = m(`DHRS${t}-COND`);
      ssc.push({ id: v, name: `module ${i} DHRS train ${t} isolation valves`, kind: "valve-group", scope: "per-module", facts: [F.dhrsActuation.id, F.failSafe.id] }, { id: c, name: `module ${i} DHRS train ${t} condenser (in the pool)`, kind: "heat-exchanger", scope: "per-module", facts: [F.dhrsTrains.id, F.dhrsPool.id] });
      dependencies.push(
        { from: c, to: "POOL", type: "requires", facts: [F.dhrsPool.id] },
        { from: v, to: m("MPS"), type: "actuates", facts: [F.mps.id, F.dhrsActuation.id] },
        { from: v, to: m("MPS"), type: "fail-safe", facts: [F.failSafe.id] },
        { from: v, to: "ELEC", type: "fail-safe", facts: [F.failSafe.id, F.noPowerReliance.id] },
      );
      dhrsTrains.push({ id: m(`DHRS-${t}`), components: [v, c] });
    }
    functions.push({ id: m("SF-DHR"), name: `module ${i} decay heat removal (DHRS)`, module: i, trains: dhrsTrains, successCriterion: { k: 1, facts: [F.dhrsTrains.id] } });
    // ECCS: 3 RVVs + 2 RRVs (primary source), heat rejected through the CNV to the pool
    const eccsTrains = [];
    for (const [kind, n] of [["RVV", 3], ["RRV", 2]]) {
      for (let j = 1; j <= n; j++) {
        const v = m(`${kind}${j}`);
        ssc.push({ id: v, name: `module ${i} ECCS ${kind === "RVV" ? "reactor vent" : "reactor recirculation"} valve ${j} (main, IAB, trip and reset valves)`, kind: "valve-group", scope: "per-module", facts: [F.eccsPath.id, F.eccsValve.id] });
        dependencies.push(
          { from: v, to: m("CNV"), type: "requires", facts: [F.eccsPath.id], note: "steam is released into, and condensate returned from, the containment vessel" },
          { from: v, to: m("MPS"), type: "fail-safe", facts: [F.failSafe.id] },
          { from: v, to: "ELEC", type: "fail-safe", facts: [F.noPowerReliance.id, F.failSafe.id] },
        );
        eccsTrains.push({ id: m(`ECCS-${kind}${j}`), components: [v] });
      }
    }
    functions.push({ id: m("SF-ECCS"), name: `module ${i} emergency core cooling (ECCS)`, module: i, trains: eccsTrains, successCriterion: { unknown: true, gap: "G-eccs-success" } });
  }
  return {
    design: { id: "nuscale-us600", name: "NuScale US600 (design certification, 10 CFR 52 App. G)", modules, certification: US600_SOURCES["fr-2023-00729"].title },
    sources: US600_SOURCES, facts: US600_FACTS, ssc, dependencies, functions, conflicts: US600_CONFLICTS, gaps: US600_GAPS, gapSources: US600_GAP_SOURCES, retrievalLog: US600_RETRIEVAL_LOG,
    // what the GA drawing places, and with what basis (P primary, S2 secondary family-level, UNK unknown)
    layout: {
      dims: {
        cnvHeightFt: { value: 76, basis: "S2", fact: F.cnvSize.id },
        cnvDiameterFt: { value: 19, basis: "S2", fact: F.cnvSize.id },
        baySquareFt: { value: 20, basis: "S2", fact: F.baySize.id },
        bayDepthFt: { value: 53, basis: "S2", fact: F.baySize.id },
        buildingOutline: { value: null, basis: "UNK", gap: "G-dimensions" },
        bayArrangement: { value: null, basis: "UNK", gap: "G-dimensions" },
        poolSurfaceToGrade: { value: null, basis: "UNK", gap: "G-dimensions", stated: F.poolBelowGrade.id },
        controlRoomLocation: { value: null, basis: "UNK", gap: "G-layout" },
      },
      bays: Array.from({ length: modules }, (_, k) => `M${k + 1}:BAY`),
    },
  };
}
