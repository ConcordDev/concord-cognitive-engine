// server/lib/conkay/knowledge/connectors/nist-webbook.js
//
// NIST Chemistry WebBook (SRD 69) thermophysical-property connector, fluid
// service (fluid.cgi). Values there are computed by NIST from a cited
// reference equation of state / correlation for each fluid (they are not
// individual measurements), so each claim is "sourced" from NIST with the
// equation cited as its method, and its uncertainty is the one NIST states
// for that equation where the statement covers the state point; otherwise the
// uncertainty is recorded as unknown with the reason.
//
// Duties: identify the fluid by its WebBook ID (C + CAS digits) and refuse a
// fluid the service does not cover; extract each column with the unit printed
// in its header; preserve the document (getter's evidence store) and the row
// / column of every value; normalise to SI (J/(kg K) from J/(g K)); check that
// the temperatures returned are the ones asked for (the service silently
// moves a range that starts outside its data, e.g. water below its triple
// point: the claims then carry the temperatures actually returned and a review
// item says so).

import { makeClaim } from "../claims.js";
import { documentEvidence } from "./fetcher.js";

export const NIST_VERSION = "1.0.0";
const BASE = "https://webbook.nist.gov/cgi/fluid.cgi";

/** Fluids the fluid service covers that this connector is set up for (ID = "C" + CAS digits). */
export const NIST_FLUIDS = Object.freeze({
  "67-56-1": { id: "C67561", name: "methanol" },
  "7732-18-5": { id: "C7732185", name: "water" },
});

const Q = "Digits=5&RefState=DEF&TUnit=K&PUnit=MPa&DUnit=kg%2Fm3&HUnit=kJ%2Fkg&WUnit=m%2Fs&VisUnit=Pa*s&STUnit=N%2Fm";
export const nistUrls = {
  isobar: (id, { pMPa, tLowK, tHighK, tIncK }) => `${BASE}?Action=Data&Wide=on&ID=${id}&Type=IsoBar&P=${pMPa}&THigh=${tHighK}&TLow=${tLowK}&TInc=${tIncK}&${Q}`,
  page: (id, { pMPa, tLowK, tHighK, tIncK }) => `${BASE}?Action=Load&ID=${id}&Type=IsoBar&P=${pMPa}&THigh=${tHighK}&TLow=${tLowK}&TInc=${tIncK}&${Q}`,
};

// header -> property, unit as printed, factor to SI
const COLUMNS = {
  "Density (kg/m3)": { property: "liquid_density", unit: "kg/m3", f: 1 },
  "Cp (J/g*K)": { property: "specific_heat_capacity", unit: "J/(kg.K)", f: 1000 },
  "Viscosity (Pa*s)": { property: "dynamic_viscosity", unit: "Pa.s", f: 1 },
  "Therm. Cond. (W/m*K)": { property: "liquid_thermal_conductivity", unit: "W/(m.K)", f: 1 },
};

/**
 * Uncertainty statements NIST prints on the results page, per fluid and property, with the regime the
 * number applies to. `excerpt` must occur verbatim in the page text (checked when the page is parsed).
 * A property with no entry (or a state outside the regime) gets uncertainty "unknown" with the reason.
 */
export const NIST_UNCERTAINTY = Object.freeze({
  C67561: {
    equationOfState: 'de Reuck, K.M. and Craven, R.J.B., "Methanol, International Thermodynamic Tables of the Fluid State-12," IUPAC, Blackwell Scientific Publications, London, 1993.',
    liquid_density: { pct: 0.1, regime: (s) => s.phase === "liquid" && s.pMPa <= 10, regimeText: "outside the critical region and high pressures (applied to liquid at <= 10 MPa)", excerpt: "The uncertainties of the equation of state are generally 0.1% in density" },
    dynamic_viscosity: { pct: 2, regime: (s) => s.phase === "liquid" && s.pMPa <= 30 && s.tK >= 273 && s.tK <= 343, regimeText: "liquid at pressures up to 30 MPa between 273 and 343 K", excerpt: "2% for the liquid at pressures up to 30 MPa between 273 and 343 K", reference: "Xiang, Laesecke and Huber, J. Phys. Chem. Ref. Data 35(4):1597-1620, 2006" },
    liquid_thermal_conductivity: { pct: 4.4, regime: () => true, regimeText: "except near critical", excerpt: "Estimated uncertainty in thermal conductivity is 4.4% except near critical", reference: "Sykioti, Assael, Huber and Perkins, J. Phys. Chem. Ref. Data 42, 043101, 2013" },
  },
  C7732185: {
    equationOfState: "Wagner, W.; Pruss, A., The IAPWS Formulation 1995 for the Thermodynamic Properties of Ordinary Water Substance for General and Scientific Use, J. Phys. Chem. Ref. Data, 2002, 31, 2, 387-535 (IAPWS R6-95, revised 2016)",
    liquid_density: { pct: 0.0001, regime: (s) => s.phase === "liquid" && Math.abs(s.pMPa - 0.101325) < 1e-3, regimeText: "liquid at 1 atm", excerpt: "The uncertainty in density of the equation of state is 0.0001% at 1 atm in the liquid phase" },
    specific_heat_capacity: { pct: 0.1, regime: (s) => s.phase === "liquid", regimeText: "liquid, away from the critical region", excerpt: "The uncertainty in isobaric heat capacity is 0.2% in the vapor and 0.1% in the liquid" },
  },
});

/** Plain text of an HTML page (for the uncertainty statements). */
export function pageText(html) {
  const body = html.includes("<body") ? html.slice(html.indexOf("<body")) : html;
  return body.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, " ");
}

/**
 * Isobaric properties of a fluid (by CAS) over a temperature grid, as claims.
 * Returns { ok, claims, reviews, rows, documents } or { ok:false, reason, reviews }.
 */
export async function isobar(cas, subject, req, get) {
  const fluid = NIST_FLUIDS[cas];
  if (!fluid) return { ok: false, reason: `the WebBook fluid service is not set up here for CAS ${cas}`, reviews: [{ kind: "source_does_not_cover", subject, reason: `NIST WebBook fluid data are not available here for CAS ${cas}` }], claims: [] };
  const doc = await get(nistUrls.isobar(fluid.id, req));
  if (!doc.ok || doc.notFound) return { ok: false, reason: doc.error || "no data", reviews: [], claims: [] };
  const page = await get(nistUrls.page(fluid.id, req));
  const text = page.ok && !page.notFound ? pageText(page.body) : "";
  const unc = NIST_UNCERTAINTY[fluid.id] || {};
  const reviews = [];
  for (const [prop, u] of Object.entries(unc)) {
    if (prop === "equationOfState") continue;
    if (!text.includes(u.excerpt)) reviews.push({ kind: "uncertainty_statement_not_found", subject, property: prop, reason: `the results page no longer contains the statement "${u.excerpt}"; the uncertainty is not applied` });
  }
  const lines = doc.body.trim().split(/\r?\n/);
  if (/Query Error|<html/i.test(lines[0])) return { ok: false, reason: `NIST returned no table: ${lines[0].slice(0, 120)}`, reviews, claims: [] };
  const header = lines[0].split("\t");
  const col = (name) => header.indexOf(name);
  const iT = col("Temperature (K)"), iP = col("Pressure (MPa)"), iPh = col("Phase");
  if (iT < 0 || iP < 0) return { ok: false, reason: "unexpected table header", reviews, claims: [] };
  const rows = lines.slice(1).map((l) => l.split("\t"));
  const asked = [];
  for (let t = req.tLowK; t <= req.tHighK + 1e-9; t += req.tIncK) asked.push(Math.round(t * 1000) / 1000);
  const got = rows.map((r) => Number(r[iT]));
  const offGrid = got.filter((t) => !asked.some((a) => Math.abs(a - t) < 1e-6));
  // a recorded excerpt keeps only some rows: rows missing from it are expected; a temperature that is not on the
  // grid asked for is the source moving the range, and is always reported
  if (offGrid.length || (!doc.excerpt && got.length !== asked.length)) {
    reviews.push({ kind: "range_adjusted_by_source", subject, reason: `asked for ${asked[0]}..${asked.at(-1)} K in ${req.tIncK} K steps; NIST returned ${got.length} rows (${got[0]}..${got.at(-1)} K)${offGrid.length ? `, off the grid asked for: ${offGrid.join(", ")} K` : ""}. The claims carry the temperatures returned` });
  }
  const claims = [];
  rows.forEach((r, ri) => {
    const state = { tK: Number(r[iT]), pMPa: Number(r[iP]), phase: r[iPh] };
    for (const [h, c] of Object.entries(COLUMNS)) {
      const ci = col(h);
      if (ci < 0 || r[ci] == null || r[ci] === "") continue;
      const v = Number(r[ci]) * c.f;
      const u = unc[c.property];
      const applies = u && u.regime(state) && text.includes(u.excerpt);
      const uncertainty = applies
        ? { type: "pct", value: u.pct, note: `NIST: ${u.excerpt} (${u.regimeText})` }
        : { type: "unknown", note: u ? (text.includes(u.excerpt) ? `outside the stated regime (${u.regimeText})` : "statement not found on the page") : "NIST's page states no single number for this property at this state; see the cited reference" };
      const locator = `fluid.cgi isobar ID=${fluid.id} P=${req.pMPa} MPa, row ${ri + 1} (T = ${r[iT]} K), column "${h}"`;
      claims.push(makeClaim({
        id: `claim:${subject}:${c.property.replace(/_/g, "-")}:nist-${state.tK}k`,
        subject, property: c.property, kind: "quantitative", value: v, unit: c.unit,
        conditions: { temperature: state.tK, pressure: state.pMPa * 1e6, phase: state.phase },
        uncertainty,
        method: { kind: "source_document", description: `NIST WebBook (SRD 69) fluid properties computed from: ${unc.equationOfState || "the reference equation NIST cites for this fluid"}${u?.reference ? `; ${u.reference}` : ""}`, standard: null, receiptRef: null, assumptions: [] },
        status: ["sourced"], support: "supported",
        evidence: [documentEvidence(doc, { sourceId: "nist_webbook", title: `NIST Chemistry WebBook, SRD 69: isobaric properties of ${fluid.name}`, locator, excerpt: `${h} = ${r[ci]} at ${r[iT]} K, ${r[iP]} MPa (${r[iPh]})`, license: "NIST Standard Reference Data (SRD 69); cite NIST" })],
      }));
    }
  });
  const nbp = text.match(/Normal boiling point ([\d.]+) K/);
  if (nbp) {
    claims.push(makeClaim({
      id: `claim:${subject}:normal-boiling-point:nist`, subject, property: "normal_boiling_point", kind: "quantitative", value: Number(nbp[1]), unit: "K",
      conditions: { pressure: 101325 },
      uncertainty: { type: "unknown", note: "NIST lists the value from the fluid's equation of state without a separate uncertainty statement" },
      method: { kind: "source_document", description: `NIST WebBook (SRD 69) additional fluid properties, from: ${unc.equationOfState || "the cited equation of state"}`, standard: null, receiptRef: null, assumptions: [] },
      status: ["sourced"], support: "supported",
      evidence: [documentEvidence(page, { sourceId: "nist_webbook", title: `NIST Chemistry WebBook, SRD 69: ${fluid.name}, additional fluid properties`, locator: "results page, \"Additional fluid properties\" > Normal boiling point", excerpt: nbp[0], license: "NIST Standard Reference Data (SRD 69); cite NIST" })],
    }));
  }
  return {
    ok: true, claims, reviews, rows: rows.length, fluid,
    documents: [doc, page].filter((d) => d?.ok && !d.notFound).map((d) => ({ url: d.url, sha256: d.fullSha256 || d.sha256, retrieved: d.retrieved, excerpt: !!d.excerpt })),
  };
}
