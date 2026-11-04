// server/lib/hvac-codes.js
//
// The HVAC Codes reference corpus — the library the Codes view searches.
// Curated, stable, factual reference entries: each names its source
// document and section and summarises what the section governs, in the
// desk's own words (no reproduced code text). Kept deliberately small and
// high-confidence: widely-applied federal rules (EPA 40 CFR 82 Subpart F),
// the IMC provisions an HVAC tech looks up weekly, the ASHRAE ventilation
// and safety standards, the NEC disconnect rule, and the ACCA manuals the
// trade designs to. Local amendments and adopted-edition differences
// always govern over a summary — the entries say so where it matters.

export const HVAC_CODE_CORPUS = [
  {
    id: "epa-82-154",
    source: "EPA — 40 CFR Part 82, Subpart F",
    section: "§82.154(a)",
    title: "Venting prohibition",
    summary: "Knowingly venting or otherwise releasing a regulated refrigerant into the environment while maintaining, servicing, repairing, or disposing of an appliance is prohibited, apart from de minimis releases made in good faith during genuine service attempts.",
    keywords: ["epa", "608", "venting", "release", "refrigerant", "prohibition"],
  },
  {
    id: "epa-82-161",
    source: "EPA — 40 CFR Part 82, Subpart F",
    section: "§82.161",
    title: "Technician certification (Section 608)",
    summary: "Technicians who work on appliances that could release refrigerant must be certified: Type I for small appliances, Type II for high- and very-high-pressure appliances, Type III for low-pressure appliances, and Universal for all three. Certification is by an EPA-approved program after a proctored exam.",
    keywords: ["epa", "608", "certification", "technician", "type i", "type ii", "type iii", "universal", "exam"],
  },
  {
    id: "epa-82-156",
    source: "EPA — 40 CFR Part 82, Subpart F",
    section: "§82.156",
    title: "Required practices — recovery before opening or disposal",
    summary: "Before opening an appliance for service or disposing of it, refrigerant must be evacuated to the section's specified levels using certified recovery or recycling equipment, with the evacuation level depending on the appliance type, its charge, and whether the compressor runs.",
    keywords: ["epa", "608", "recovery", "evacuation", "disposal", "opening", "vacuum"],
  },
  {
    id: "epa-82-157",
    source: "EPA — 40 CFR Part 82, Subpart F",
    section: "§82.157",
    title: "Leak repair — appliances with 50+ lb charge",
    summary: "Owners of appliances holding 50 pounds or more of refrigerant must repair leaks when the calculated leak rate exceeds the applicable threshold (10% for comfort cooling, 20% for commercial refrigeration, 30% for industrial process refrigeration on the newer schedule), on the section's repair, verification-test, and recordkeeping timelines.",
    keywords: ["epa", "608", "leak", "repair", "50 lb", "threshold", "comfort cooling", "refrigeration"],
  },
  {
    id: "epa-82-166",
    source: "EPA — 40 CFR Part 82, Subpart F",
    section: "§82.166",
    title: "Recordkeeping — refrigerant and service records",
    summary: "Service shops keep records of refrigerant purchases and of service to larger appliances — dates, quantities added, and the technician's certification — for three years, so a system's charge history can be audited against its leak rate.",
    keywords: ["epa", "608", "records", "recordkeeping", "purchases", "service records"],
  },
  {
    id: "imc-403",
    source: "International Mechanical Code (IMC)",
    section: "§403",
    title: "Mechanical ventilation — required outdoor air rates",
    summary: "Sets the minimum outdoor airflow rates for mechanical ventilation (Table 403.3.1.1, people + area components by occupancy) and the rules for system operation and demand-controlled ventilation. The adopted edition and local amendments govern the exact rates.",
    keywords: ["imc", "ventilation", "outdoor air", "403", "fresh air", "occupancy"],
  },
  {
    id: "imc-306",
    source: "International Mechanical Code (IMC)",
    section: "§306",
    title: "Access and clearance for appliances",
    summary: "Appliances must be installed with the access and working clearance needed to inspect, service, and replace them — including access openings and passageways to attic and rooftop equipment, and clearance to the manufacturer's service points.",
    keywords: ["imc", "access", "clearance", "service", "attic", "rooftop"],
  },
  {
    id: "imc-307",
    source: "International Mechanical Code (IMC)",
    section: "§307",
    title: "Condensate disposal",
    summary: "Condensate from cooling coils and evaporators must drain to an approved place of disposal through a trap and pipe sized per the section's table; equipment above ceilings or in locations where overflow causes damage needs an auxiliary drain pan, a separate overflow drain, or a water-level switch.",
    keywords: ["imc", "condensate", "drain", "trap", "overflow", "auxiliary pan", "float switch"],
  },
  {
    id: "imc-504",
    source: "International Mechanical Code (IMC)",
    section: "§504",
    title: "Clothes dryer exhaust",
    summary: "Domestic dryer exhaust must run in smooth metal duct to the outdoors, independent of any other exhaust system, with length and fitting allowances per the section (a common source of failed inspections when vented into an attic or combined with a bath fan).",
    keywords: ["imc", "dryer", "exhaust", "504", "venting"],
  },
  {
    id: "imc-1101",
    source: "International Mechanical Code (IMC)",
    section: "Chapter 11 (§1101+)",
    title: "Refrigeration — refrigerant piping and systems",
    summary: "Governs refrigerant piping materials, joints, testing, and system safeguards: piping must be rated for the refrigerant and pressure, tested before concealment, and systems using higher-charge or flammability-class refrigerants carry machinery-room and concentration-limit requirements that tie to ASHRAE 15.",
    keywords: ["imc", "refrigerant piping", "chapter 11", "testing", "a2l", "piping"],
  },
  {
    id: "ashrae-621",
    source: "ASHRAE Standard 62.1",
    section: "§6.2 (Ventilation Rate Procedure)",
    title: "Ventilation Rate Procedure",
    summary: "The design procedure behind most ventilation code tables: breathing-zone outdoor airflow is the sum of a per-person rate and a per-area rate by occupancy category, adjusted by zone air-distribution effectiveness to set the outdoor air intake for the system.",
    keywords: ["ashrae", "62.1", "ventilation", "outdoor air", "breathing zone", "design"],
  },
  {
    id: "ashrae-15",
    source: "ASHRAE Standard 15",
    section: "Safety Standard for Refrigeration Systems",
    title: "Refrigeration system safety",
    summary: "Sets the safety basis for refrigeration systems: refrigerant concentration limits by occupancy, when a machinery room is required and how it must be ventilated and monitored, and pressure-relief and piping safeguards. Newer A2L (mildly flammable) refrigerant rules live here and in the product listing standards.",
    keywords: ["ashrae", "15", "safety", "machinery room", "concentration", "a2l", "refrigerant"],
  },
  {
    id: "ashrae-34",
    source: "ASHRAE Standard 34",
    section: "Designation and Safety Classification of Refrigerants",
    title: "Refrigerant safety classes (A1, A2L, B…)",
    summary: "The designation system (R-numbers) and safety classification of refrigerants: toxicity class A or B and flammability class 1, 2L, 2, or 3 — so R-410A is A1, R-32 and R-454B are A2L. The class drives the charge limits and handling rules in Standard 15 and the building codes.",
    keywords: ["ashrae", "34", "classification", "a1", "a2l", "flammable", "r-410a", "r-454b", "r-32"],
  },
  {
    id: "nec-440-14",
    source: "National Electrical Code (NEC)",
    section: "Article 440.14",
    title: "Disconnecting means — within sight of the equipment",
    summary: "A disconnecting means for air-conditioning and refrigerating equipment must be located within sight from, and readily accessible from, the equipment it serves (or be capable of being locked in the open position where the Article's exception applies) — the pull-out disconnect beside the condenser exists because of this rule.",
    keywords: ["nec", "440", "disconnect", "within sight", "electrical", "condenser"],
  },
  {
    id: "nec-440-mca",
    source: "National Electrical Code (NEC)",
    section: "Article 440 (MCA / MOP)",
    title: "Branch-circuit sizing from the nameplate",
    summary: "For hermetic motor-compressors the equipment nameplate's Minimum Circuit Ampacity (MCA) sizes the conductors and the Maximum Overcurrent Protection (MOP) sizes the breaker or fuses — both are taken from the nameplate, not computed from a generic motor table.",
    keywords: ["nec", "440", "mca", "mop", "nameplate", "breaker", "circuit"],
  },
  {
    id: "acca-manual-j",
    source: "ACCA Manual J",
    section: "Residential Load Calculation",
    title: "Manual J — the reference load method",
    summary: "The industry-reference procedure for residential heating and cooling loads: room-by-room, using design temperatures, envelope assemblies, window gains, infiltration, and internal gains. Concord's Loads panel is a square-foot rule of thumb and says so — Manual J is the calculation it is not.",
    keywords: ["acca", "manual j", "load calculation", "residential", "sizing"],
  },
  {
    id: "acca-manual-sd",
    source: "ACCA Manual S / Manual D",
    section: "Equipment Selection / Duct Design",
    title: "Manual S and Manual D — selection and duct design",
    summary: "Manual S selects equipment against the Manual J loads within the manufacturer's expanded performance data (avoiding oversizing); Manual D designs the duct system from available static pressure and fitting loss coefficients — the ducted counterpart to a rule-of-thumb friction rate.",
    keywords: ["acca", "manual s", "manual d", "equipment selection", "duct design", "static pressure"],
  },
  {
    id: "epa-hfc-phasedown",
    source: "EPA — AIM Act / 40 CFR Part 84",
    section: "HFC phasedown & Technology Transitions",
    title: "Refrigerant transition — R-410A to lower-GWP refrigerants",
    summary: "Federal rules phase down HFC production and restrict new equipment to lower-GWP refrigerants (700 GWP limit for most new residential/light-commercial AC and heat pumps on the Technology Transitions schedule), which is why new equipment ships charged with A2L refrigerants such as R-454B and R-32 and why R-410A pricing and availability keep tightening.",
    keywords: ["epa", "hfc", "phasedown", "gwp", "r-410a", "r-454b", "transition", "aim act"],
  },
];

/** Case-insensitive search over source, section, title, summary, keywords. */
export function searchHvacCodes(query) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return HVAC_CODE_CORPUS.slice();
  const tokens = q.split(/\s+/).filter(Boolean);
  return HVAC_CODE_CORPUS.filter((e) => {
    const blob = [e.source, e.section, e.title, e.summary, ...(e.keywords || [])].join(" ").toLowerCase();
    return tokens.every((t) => blob.includes(t));
  });
}
