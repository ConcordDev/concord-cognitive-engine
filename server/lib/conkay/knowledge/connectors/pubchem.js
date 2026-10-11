// server/lib/conkay/knowledge/connectors/pubchem.js
//
// PubChem connector (PUG REST + PUG View). The seven connector duties
// (sources.js CONNECTOR_DUTIES), in order:
//   1. identify the entity: name -> CID; more than one CID is ambiguous and is
//      sent to review, never resolved by picking the first; the identity block
//      carries the CID, formula, InChI, InChIKey, SMILES and the CAS number;
//   2. extract candidate values (experimental-property headings) with units;
//   3. preserve the original document (the getter's evidence store) and each
//      value's location in it (heading, information index, contributing
//      source and its reference number);
//   4. normalise to SI (K, Pa, kg/m3) keeping the text as printed;
//   5. check contradictions and missing conditions (review.js);
//   6. attach provenance (document hash, retrieval date, contributor);
//   7. send uncertain or conflicting records to review: an ambiguous name, a
//      CAS number contributors disagree on, a value whose unit is not stated,
//      a string that cannot be read, a temperature given in two scales that
//      disagree.
// PubChem aggregates contributed records: each value is attributed to its
// contributor, whose own terms apply (recorded per claim).

import { makeClaim } from "../claims.js";
import { documentEvidence } from "./fetcher.js";
import { parseDensityValue, parseTemperatureValue } from "./parse-values.js";

export const PUBCHEM_VERSION = "1.0.0";
const REST = "https://pubchem.ncbi.nlm.nih.gov/rest/pug";
const VIEW = "https://pubchem.ncbi.nlm.nih.gov/rest/pug_view/data/compound";

export const pubchemUrls = {
  name: (name) => `${REST}/compound/name/${encodeURIComponent(name)}/cids/JSON`,
  props: (cid) => `${REST}/compound/cid/${cid}/property/MolecularFormula,MolecularWeight,IUPACName,InChI,InChIKey,ConnectivitySMILES/JSON`,
  heading: (cid, heading) => `${VIEW}/${cid}/JSON?heading=${encodeURIComponent(heading)}`,
};

const LICENSE = "PubChem aggregates contributed records; this value's contributor terms apply (see the reference)";
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

function* informations(section, path = []) {
  for (const s of section.Section || []) yield* informations(s, [...path, s.TOCHeading]);
  let i = 0;
  for (const inf of section.Information || []) yield { path, inf, index: i++ };
}

/** Name -> CID. Returns { ok, cid } | { ok:false, notFound } | { ok:false, ambiguous: cids, review }. */
export async function resolveName(name, get) {
  const doc = await get(pubchemUrls.name(name));
  if (!doc.ok) return { ok: false, error: doc.error, doc };
  if (doc.notFound) return { ok: false, notFound: true, doc, review: { kind: "identity_not_found", subject: name, reason: `PubChem has no compound named "${name}"` } };
  const cids = JSON.parse(doc.body).IdentifierList?.CID || [];
  if (cids.length !== 1) return { ok: false, ambiguous: cids, doc, review: { kind: "identity_ambiguous", subject: name, reason: `"${name}" matches ${cids.length} PubChem compounds (${cids.slice(0, 10).join(", ")}): name the exact variant`, candidates: cids } };
  return { ok: true, cid: cids[0], doc };
}

/** Identity block + CAS consensus (contributors that list a different CAS go to review). */
export async function identify(name, get) {
  const r = await resolveName(name, get);
  if (!r.ok) return { ok: false, reason: r.error || r.review?.reason, reviews: r.review ? [r.review] : [] };
  const { cid } = r;
  const pd = await get(pubchemUrls.props(cid));
  if (!pd.ok || pd.notFound) return { ok: false, reason: pd.error || `no properties for CID ${cid}`, reviews: [] };
  const p = JSON.parse(pd.body).PropertyTable.Properties[0];
  const cd = await get(pubchemUrls.heading(cid, "CAS"));
  const reviews = [];
  let cas = null;
  const casVotes = {};
  if (cd.ok && !cd.notFound) {
    const rec = JSON.parse(cd.body).Record;
    const refs = Object.fromEntries((rec.Reference || []).map((x) => [x.ReferenceNumber, x]));
    for (const { inf } of informations(rec)) {
      for (const s of inf.Value?.StringWithMarkup || []) (casVotes[s.String] ||= []).push(refs[inf.ReferenceNumber]?.SourceName || `reference ${inf.ReferenceNumber}`);
    }
    const ranked = Object.entries(casVotes).sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
    const total = ranked.reduce((a, [, v]) => a + v.length, 0);
    if (ranked.length && ranked[0][1].length * 2 > total) cas = ranked[0][0];
    if (ranked.length > 1) reviews.push({ kind: "identifier_conflict", subject: p.IUPACName || name, property: "CAS RN", reason: `contributors disagree on the CAS number: ${ranked.map(([k, v]) => `${k} (${v.length})`).join(", ")}; ${cas ? `${cas} is the majority and is used, the others need review` : "no majority: none is used"}`, candidates: ranked.map(([k, v]) => ({ value: k, sources: v })) });
  } else {
    reviews.push({ kind: "identifier_missing", subject: p.IUPACName || name, property: "CAS RN", reason: "PubChem lists no CAS number for this compound" });
  }
  const evidence = documentEvidence(pd, { sourceId: "pubchem", title: `PubChem CID ${cid} computed properties`, locator: "PUG REST property table (computed by PubChem)", excerpt: `${p.MolecularFormula}; MW ${p.MolecularWeight}; ${p.InChIKey}`, license: "NCBI PubChem computed properties: public domain" });
  return {
    ok: true, cid,
    identity: {
      name: p.IUPACName || name, aliases: [name], category: "substance", version: `pubchem-cid-${cid}`,
      identifiers: { pubchemCid: cid, cas: cas || "unknown", molecularFormula: p.MolecularFormula, inchi: p.InChI, inchiKey: p.InChIKey, smiles: p.ConnectivitySMILES || p.CanonicalSMILES || "unknown" },
      variant: null,
    },
    molarMass: makeClaim({
      id: `claim:${slug(p.IUPACName || name)}:molar-mass:pubchem`, subject: p.IUPACName || name, property: "molar_mass",
      value: Number(p.MolecularWeight), unit: "g/mol", kind: "quantitative", conditions: {},
      uncertainty: { type: "range", low: Number(p.MolecularWeight) - 0.5 * 10 ** -(String(p.MolecularWeight).split(".")[1]?.length || 0), high: Number(p.MolecularWeight) + 0.5 * 10 ** -(String(p.MolecularWeight).split(".")[1]?.length || 0), note: "printed precision (half the last digit)" },
      method: { kind: "source_document", description: "PubChem computed molecular weight", standard: null, receiptRef: null, assumptions: [] },
      status: ["sourced"], support: "supported", evidence: [evidence],
    }),
    casVotes, reviews, documents: [pd, cd].filter((d) => d?.ok).map((d) => ({ url: d.url, sha256: d.fullSha256 || d.sha256, retrieved: d.retrieved })),
  };
}

const TEMP_HEADINGS = { "Boiling Point": "normal_boiling_point", "Melting Point": "melting_point", "Flash Point": "flash_point" };

/**
 * Experimental values under one PUG View heading as claims (each with its location) + review items.
 * Supported headings: Density, Boiling Point, Melting Point, Flash Point.
 */
export async function experimental(cid, heading, subject, get) {
  const doc = await get(pubchemUrls.heading(cid, heading));
  if (!doc.ok) return { ok: false, error: doc.error, claims: [], reviews: [] };
  if (doc.notFound) return { ok: true, notFound: true, claims: [], reviews: [], note: `PubChem has no "${heading}" section for CID ${cid}` };
  const rec = JSON.parse(doc.body).Record;
  const refs = Object.fromEntries((rec.Reference || []).map((x) => [x.ReferenceNumber, x]));
  const claims = [], reviews = [];
  const s = slug(subject);
  for (const { inf, index } of informations(rec)) {
    const ref = refs[inf.ReferenceNumber] || {};
    const strings = (inf.Value?.StringWithMarkup || []).map((x) => x.String);
    if (inf.Value?.Number) strings.push(`${inf.Value.Number.join(" ")} ${inf.Value.Unit || ""}`.trim());
    // several values in one string are separated by "; "; a part with no number is commentary on the one before
    const parts = (full) => full.split(/;\s+/).reduce((acc, p) => { if (acc.length && !/\d/.test(p)) acc[acc.length - 1] += `; ${p}`; else acc.push(p); return acc; }, []);
    strings.forEach((full, si) => parts(full).forEach((text, pi) => {
      const locator = `PUG View CID ${cid} > "${heading}" > Information ${index + 1}${strings.length > 1 ? `.${si + 1}` : ""}${pi ? ` part ${pi + 1}` : ""} (reference ${inf.ReferenceNumber}: ${ref.SourceName || "?"}${ref.SourceID ? `, ${ref.SourceID}` : ""})`;
      const ev = documentEvidence(doc, { sourceId: "pubchem", title: `PubChem CID ${cid} — ${heading} (contributed by ${ref.SourceName || "?"})`, locator, excerpt: text, license: ref.License ? `${ref.SourceName}: ${ref.License}` : LICENSE });
      const id = `claim:${s}:${slug(heading)}:pubchem-ref${inf.ReferenceNumber}-${index + 1}-${si + 1}-${pi + 1}`;
      const base = { id, subject, evidence: [ev], status: ["sourced"], support: "supported", attributedTo: ref.SourceName || null, method: { kind: "source_document", description: `as printed by ${ref.SourceName || "the contributor"}`, standard: null, receiptRef: null, assumptions: [] } };
      if (heading === "Density") {
        const d = parseDensityValue(text);
        if (!d.ok) { if (!d.empty) reviews.push({ kind: d.table ? "not_read_table" : "unparsed", subject, property: "density", locator, reason: d.reason, text }); return; }
        if (d.kind === "other_substance") { reviews.push({ kind: "different_substance", subject, property: "density", locator, reason: `"${text}" is about ${d.qualifier}, not ${subject}: not used as a claim about ${subject}`, text }); return; }
        if (d.kind === "other_phase") {
          claims.push(makeClaim({ ...base, property: null, kind: "qualitative", value: text, unit: null, statement: `density of another phase (${d.phase}); not a liquid density`, conditions: { ...d.conditions, phase: d.phase }, flags: ["other_phase"] }));
          reviews.push({ kind: "other_phase", subject, property: "density", locator, reason: `"${text}" is for the ${d.phase} phase: kept as printed, not compared with liquid values`, text });
          return;
        }
        if (d.kind === "liquid_density") {
          claims.push(makeClaim({ ...base, property: "liquid_density", kind: "quantitative", value: d.valueKgM3, unit: "kg/m3", conditions: { ...d.conditions }, uncertainty: { type: "range", low: d.valueKgM3 - d.resolution, high: d.valueKgM3 + d.resolution, note: "printed precision (half the last digit)" } }));
        } else if (d.kind === "relative_density") {
          claims.push(makeClaim({ ...base, property: "relative_density", kind: "quantitative", value: d.value, unit: "1", conditions: { ...d.conditions, reference: "water" }, uncertainty: { type: "range", low: d.value - d.resolution, high: d.value + d.resolution, note: "printed precision (half the last digit)" } }));
        } else {
          claims.push(makeClaim({ ...base, property: null, kind: "qualitative", value: text, unit: null, statement: `number ${d.value} with no unit and no water reference stated (could be a density in g/cm3 or a relative density)`, conditions: { ...d.conditions }, flags: ["unit_not_stated"] }));
          reviews.push({ kind: "unit_not_stated", subject, property: "density", locator, reason: `"${text}": no unit or reference is stated; it is kept as printed, not converted`, text, value: d.value, conditions: d.conditions });
        }
        return;
      }
      const prop = TEMP_HEADINGS[heading];
      if (!prop) { reviews.push({ kind: "unsupported_heading", subject, locator, reason: `heading "${heading}" is not parsed by this connector`, text }); return; }
      if (!text.trim()) return;
      const t = parseTemperatureValue(text);
      if (!t.ok) {
        const kind = /\[Table#\d+\]/.test(text) ? "not_read_table" : /^\s*[-+]?\d+(\.\d+)?\s*$/.test(text) ? "unit_not_stated" : "unparsed";
        reviews.push({ kind, subject, property: prop, locator, reason: kind === "unit_not_stated" ? `"${text}": a number with no unit; kept as printed, not converted` : t.reason, text });
        return;
      }
      for (const issue of t.issues) reviews.push({ kind: "internally_inconsistent", subject, property: prop, locator, reason: issue, text });
      const conditions = { ...t.conditions };
      const claim = t.rangeK
        ? makeClaim({ ...base, property: prop, kind: "quantitative", range: t.rangeK, unit: "K", conditions })
        : makeClaim({ ...base, property: prop, kind: "quantitative", value: t.valueK, unit: "K", conditions, uncertainty: { type: "range", low: t.valueK - t.resolutionK, high: t.valueK + t.resolutionK, note: "printed precision (half the last digit)" } });
      claims.push(claim);
    }));
  }
  return { ok: true, claims, reviews, document: { url: doc.url, sha256: doc.fullSha256 || doc.sha256, retrieved: doc.retrieved, excerpt: !!doc.excerpt } };
}
