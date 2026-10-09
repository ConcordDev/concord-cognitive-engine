// server/lib/conkay/safety-case/sources.js
//
// Regulatory and reference locators used by the safety-case layer. Every
// entry was retrieved and read on 2026-10-09; quotes are verbatim from the
// retrieved text. These are CONTEXT for screening requirements, not a
// compliance claim: which criteria apply, and how, is decided by qualified
// engineers and the regulator.

const RETRIEVED = "2026-10-09";
const GDC_URL = "https://www.law.cornell.edu/cfr/text/10/appendix-A_to_part_50";
const SSR_URL = "https://www-pub.iaea.org/MTCD/Publications/PDF/Pub1715web-46541668.pdf";
const SSR_SHA = "c255c6780ca5b410bfc37a973b81c70b4fe3941d35225e5ef39177997fe2dc84";

export const REG_SOURCES = Object.freeze({
  "10cfr50-appA-single-failure": {
    regulation: "10 CFR Part 50, Appendix A (General Design Criteria for Nuclear Power Plants)",
    locator: "Definitions and Explanations — Single failure",
    url: GDC_URL, retrieved: RETRIEVED,
    quote: "Fluid and electric systems are considered to be designed against an assumed single failure if neither (1) a single failure of any active component (assuming passive components function properly) nor (2) a single failure of a passive component (assuming active components function properly), results in a loss of the capability of the system to perform its safety functions.",
  },
  "gdc-17": {
    regulation: "10 CFR Part 50, Appendix A", locator: "Criterion 17 — Electric power systems",
    url: GDC_URL, retrieved: RETRIEVED,
    quote: "The onsite electric power supplies, including the batteries, and the onsite electric distribution system, shall have sufficient independence, redundancy, and testability to perform their safety functions assuming a single failure.",
  },
  "gdc-21": {
    regulation: "10 CFR Part 50, Appendix A", locator: "Criterion 21 — Protection system reliability and testability",
    url: GDC_URL, retrieved: RETRIEVED,
    quote: "Redundancy and independence designed into the protection system shall be sufficient to assure that (1) no single failure results in loss of the protection function",
  },
  "gdc-22": {
    regulation: "10 CFR Part 50, Appendix A", locator: "Criterion 22 — Protection system independence",
    url: GDC_URL, retrieved: RETRIEVED,
    quote: "The protection system shall be designed to assure that the effects of natural phenomena, and of normal operating, maintenance, testing, and postulated accident conditions on redundant channels do not result in loss of the protection function, or shall be demonstrated to be acceptable on some other defined basis.",
  },
  "gdc-34": {
    regulation: "10 CFR Part 50, Appendix A", locator: "Criterion 34 — Residual heat removal",
    url: GDC_URL, retrieved: RETRIEVED,
    quote: "the system safety function can be accomplished, assuming a single failure.",
  },
  "gdc-35": {
    regulation: "10 CFR Part 50, Appendix A", locator: "Criterion 35 — Emergency core cooling",
    url: GDC_URL, retrieved: RETRIEVED,
    quote: "the system safety function can be accomplished, assuming a single failure.",
  },
  "srp-8.3.2": {
    regulation: "NUREG-0800, Standard Review Plan for the Review of Safety Analysis Reports for Nuclear Power Plants: LWR Edition",
    locator: "Chapter 8, Section 8.3.2 — D-C Power Systems (Onsite), Rev. 4 (05/2010)",
    url: "https://www.nrc.gov/reading-rm/doc-collections/nuregs/staff/sr0800/ch8/index", retrieved: RETRIEVED,
    quote: null,
  },
  "ssr-2/1-req-21": {
    regulation: "IAEA Safety Standards Series No. SSR-2/1 (Rev. 1), Safety of Nuclear Power Plants: Design",
    locator: "Requirement 21: Physical separation and independence of safety systems",
    url: SSR_URL, sha256: SSR_SHA, retrieved: RETRIEVED,
    quote: "Interference between safety systems or between redundant elements of a system shall be prevented by means such as physical separation, electrical isolation, functional independence and independence of communication (data transfer), as appropriate.",
  },
  "ssr-2/1-req-24": {
    regulation: "IAEA SSR-2/1 (Rev. 1)", locator: "Requirement 24: Common cause failures",
    url: SSR_URL, sha256: SSR_SHA, retrieved: RETRIEVED,
    quote: "The design of equipment shall take due account of the potential for common cause failures of items important to safety, to determine how the concepts of diversity, redundancy, physical separation and functional independence have to be applied to achieve the necessary reliability.",
  },
  "ssr-2/1-req-25": {
    regulation: "IAEA SSR-2/1 (Rev. 1)", locator: "Requirement 25: Single failure criterion",
    url: SSR_URL, sha256: SSR_SHA, retrieved: RETRIEVED,
    quote: "The single failure criterion shall be applied to each safety group incorporated in the plant design.",
  },
  "nureg-0492": {
    regulation: "NUREG-0492, Fault Tree Handbook (Vesely, Goldberg, Roberts, Haasl; U.S. NRC, January 1981)",
    locator: "Chapter VII (Figure VII-10, pp. VII-16–17) and Chapter VIII (Figure VIII-14, Table VIII-1, pp. VIII-12–14)",
    url: "https://www.nrc.gov/docs/ml1007/ml100780465.pdf",
    sha256: "b1de3399aa8a823343b3a32c51524a1cc3f2c714b54a4a7e3fe85edb631aa4c0", retrieved: RETRIEVED,
    quote: null,
  },
});

export function regRef(id, role = "context") {
  const s = REG_SOURCES[id];
  if (!s) throw new Error(`unknown regulatory source ${id}`);
  return { id, role, regulation: s.regulation, locator: s.locator, url: s.url, retrieved: s.retrieved, ...(s.sha256 ? { sha256: s.sha256 } : {}), ...(s.quote ? { quote: s.quote } : {}) };
}
