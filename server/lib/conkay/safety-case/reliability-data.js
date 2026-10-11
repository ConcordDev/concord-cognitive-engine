// server/lib/conkay/safety-case/reliability-data.js
//
// Industry-average reliability data used by the Phase 2 fault-tree / event-tree
// engine, each value a sourced claim with its distribution and locator. Values
// are transcribed from the retrieved reports (2026-10-09); the reports' SHA-256
// are recorded so a reader can confirm the same document. Nothing here is
// invented or adjusted: where the report rounds α or β, the claim keeps the
// printed numbers and records the printed mean next to them.
//
//   NUREG/CR-6928 2020 Update: Z. Ma, T. E. Wierman, K. J. Kvarfordt,
//     "Industry-Average Performance for Components and Initiating Events at U.S.
//     Commercial Nuclear Power Plants: 2020 Update", INL/EXT-21-65055, Nov 2021
//     (OSTI 1847110). Table 1 (component unreliability), Table 4 (initiating events).
//   CCF 2020 Update: Z. Ma, K. J. Kvarfordt, "CCF Parameter Estimations, 2020
//     Update", INL/EXT-21-62940, Nov 2021. Alpha-factor distributions per template;
//     for a common-cause component group of 2 the report's MGL Beta equals α2.
//
// Distributions: beta(α, β) for demand probabilities (mean α/(α+β)); gamma(α, β)
// for rates (shape α, rate β per hour or per reactor-critical-year; mean α/β).

export const RETRIEVED = "2026-10-09";

export const DATA_SOURCES = Object.freeze({
  "nureg-cr-6928-2020": {
    title: "Industry-Average Performance for Components and Initiating Events at U.S. Commercial Nuclear Power Plants: 2020 Update",
    report: "INL/EXT-21-65055 (NUREG/CR-6928 series), November 2021; OSTI 1847110",
    authors: "Z. Ma, T. E. Wierman, K. J. Kvarfordt (Idaho National Laboratory)",
    url: "https://nrcoe.inl.gov/publicdocs/AvgPerf/AvgPara2020.pdf",
    sha256: "fd7b697974ddb4db9400fefc2c70776d687ed2461dc2bf7e941630da70f3ae12",
    retrieved: RETRIEVED,
  },
  "ccf-param-2020": {
    title: "CCF Parameter Estimations, 2020 Update",
    report: "INL/EXT-21-62940, November 2021",
    authors: "Z. Ma, K. J. Kvarfordt (Idaho National Laboratory)",
    url: "https://nrcoe.inl.gov/publicdocs/CCF/ccfparamest2020.pdf",
    sha256: "7a754274ea130b18175a795301eeab96a2552d7f525f6e1592ab4f4f3069e142",
    retrieved: RETRIEVED,
  },
});

const t1 = (pdfPage, printedPage) => ({ source: "nureg-cr-6928-2020", locator: `Table 1 (Component UR data and results), report page ${printedPage}, PDF page ${pdfPage}` });
const t4 = { source: "nureg-cr-6928-2020", locator: "Table 4 (Initiating event data and results), report page 22, PDF page 46" };

/**
 * Component failure parameters. kind: "demand" (p per demand, beta) or "rate" (λ per hour, gamma).
 * failures / exposure: the report's data columns (demands or hours), for the reader.
 */
export const COMPONENT_DATA = Object.freeze({
  "EDG-FTS": { description: "Diesel Generator Fails To Start, Normally Standby", kind: "demand", dist: { type: "beta", alpha: 23.8, beta: 1.07e4 }, mean: 2.22e-3, p5: 1.53e-3, median: 2.19e-3, p95: 3.02e-3, errorFactor: 1.4, failures: 136, components: 234, dataRange: "2006-2020", ...t1(33, 9) },
  "EDG-FTLR": { description: "Diesel Generator Fails To Load And Run, Early", kind: "rate", dist: { type: "gamma", alpha: 3.61, beta: 1.09e3 }, mean: 3.31e-3, p5: 1.05e-3, median: 3.01e-3, p95: 6.6e-3, errorFactor: 2.2, failures: 172, components: 234, dataRange: "2006-2020", ...t1(33, 9),
    note: "Table 1 lists this mode per hour (gamma); Table 58 defines FTLR as a probability, 'fail to load and run for 1 h'. Applied over exactly 1 h, p = 1 - exp(-λ x 1 h), which equals λ x 1 h to within λ^2/2." },
  "EDG-FTR": { description: "Diesel Generator Fails To Run, Late Term", kind: "rate", dist: { type: "gamma", alpha: 3.83, beta: 3.25e3 }, mean: 1.18e-3, p5: 3.9e-4, median: 1.08e-3, p95: 2.31e-3, errorFactor: 2.1, failures: 155, components: 234, dataRange: "2006-2020", ...t1(33, 9), note: "Table 58: 'Fail to run beyond 1 h' (applied to the mission time after the first hour)." },
  "MDP-FTS-NS": { description: "Motor-Driven Pump Fails To Start, Normally Standby", kind: "demand", dist: { type: "beta", alpha: 2.07, beta: 3.52e3 }, mean: 5.88e-4, p5: 1.09e-4, median: 4.96e-4, p95: 1.38e-3, errorFactor: 2.8, failures: 227, components: 1311, dataRange: "2006-2020", ...t1(32, 8), note: "Pooled centrifugal MDPs (no AFW-specific MDP row in Table 1)." },
  "MDP-FTR<1H": { description: "Motor-Driven Pump FTR<1H", kind: "rate", dist: { type: "gamma", alpha: 0.579, beta: 6.34e3 }, mean: 9.13e-5, p5: 7.34e-7, median: 4.68e-5, p95: 3.33e-4, errorFactor: 7.1, failures: 31, components: 1305, dataRange: "2006-2020", ...t1(32, 8), note: "Table 42: 'Failure to run for 1 h' (pooled; no AFW-specific MDP row)." },
  "MDP-FTR>1H": { description: "Motor-Driven Pump FTR>1H", kind: "rate", dist: { type: "gamma", alpha: 0.511, beta: 6.29e4 }, mean: 8.12e-6, p5: 3.58e-8, median: 3.77e-6, p95: 3.1e-5, errorFactor: 8.2, failures: 92, components: 1311, dataRange: "2006-2020", ...t1(32, 8), note: "Table 42: 'Fail to run beyond 1 h' (pooled)." },
  "TDP-FTS-NS-AFW": { description: "Auxiliary Feedwater Turbine-Driven Pump Fails To Start, Normally Standby", kind: "demand", dist: { type: "beta", alpha: 0.831, beta: 218 }, mean: 3.79e-3, p5: 1.17e-4, median: 2.43e-3, p95: 1.21e-2, errorFactor: 5.0, failures: 52, components: 74, dataRange: "2006-2020", ...t1(32, 8) },
  "TDP-FTR<1H-AFW": { description: "Auxiliary Feedwater Turbine-Driven Pump FTR<1H", kind: "rate", dist: { type: "gamma", alpha: 18.5, beta: 1.07e4 }, mean: 1.73e-3, p5: 1.12e-3, median: 1.70e-3, p95: 2.44e-3, errorFactor: 1.4, failures: 18, components: 74, dataRange: "2006-2020", ...t1(32, 8) },
  "TDP-FTR>1H-AFW": { description: "Auxiliary Feedwater Turbine-Driven Pump FTR>1H", kind: "rate", dist: { type: "gamma", alpha: 8.5, beta: 3.3e3 }, mean: 2.58e-3, p5: 1.31e-3, median: 2.48e-3, p95: 4.18e-3, errorFactor: 1.7, failures: 8, components: 74, dataRange: "2006-2020", ...t1(32, 8) },
  "CKV-FTO": { description: "Check Valve Fails To Open", kind: "demand", dist: { type: "beta", alpha: 0.5, beta: 4.48e4 }, mean: 1.12e-5, p5: 4.39e-8, median: 5.08e-6, p95: 4.29e-5, errorFactor: 8.4, failures: 0, components: 489, dataRange: "2006-2020", ...t1(31, 7), note: "0 failures: Jeffreys noninformative prior update (JNID/IL)." },
  "BAT-FTOP": { description: "Battery Fails To Operate", kind: "rate", dist: { type: "gamma", alpha: 0.634, beta: 1.57e6 }, mean: 4.05e-7, p5: 4.79e-9, median: 2.21e-7, p95: 1.42e-6, errorFactor: 6.5, failures: 21, components: 412, dataRange: "2006-2020", ...t1(34, 10) },
  "BUS-FTOP-AC": { description: "AC Bus Fails To Operate", kind: "rate", dist: { type: "gamma", alpha: 0.986, beta: 1.68e6 }, mean: 5.88e-7, p5: 2.91e-8, median: 4.05e-7, p95: 1.77e-6, errorFactor: 4.4, failures: 76, components: 1296, dataRange: "2006-2020", ...t1(35, 11) },
  "BUS-FTOP-DC": { description: "DC Bus Fails To Operate", kind: "rate", dist: { type: "gamma", alpha: 1.5, beta: 2.1e6 }, mean: 7.13e-7, p5: 8.38e-8, median: 5.63e-7, p95: 1.86e-6, errorFactor: 3.3, failures: 1, components: 16, dataRange: "2006-2020", ...t1(35, 11) },
});

/** Initiating-event frequencies (gamma, per reactor-critical-year). */
export const INITIATOR_DATA = Object.freeze({
  "PO.LOOP": { description: "Loss-of-Offsite-Power, All Categories, Power Operations", unit: "1/rcry", dist: { type: "gamma", alpha: 1.3, beta: 52.8 }, mean: 2.52e-2, p5: 2.39e-3, median: 1.92e-2, p95: 6.83e-2, errorFactor: 3.6, events: 35, exposure: "1388.9 rcry", dataRange: "2006-2020", ...t4,
    note: "The printed α (1.3) is rounded to one decimal: α/β = 0.0246 vs the printed mean 0.0252. Sampling uses the printed α and β; the point estimate uses the printed mean." },
  "LOCHS PWR FI": { description: "Loss of Condenser Heat Sink (PWR)", unit: "1/rcry", dist: { type: "gamma", alpha: 5.4, beta: 211 }, mean: 2.53e-2, p5: 1.04e-2, median: 2.38e-2, p95: 4.57e-2, errorFactor: 1.9, events: 23, exposure: "909.8 rcry", dataRange: "2006-2020", ...t4,
    note: "The printed α (5.4) and β (211) are rounded: α/β = 0.0256 vs the printed mean 0.0253." },
});

const ccf = (section, pdfPage) => ({ source: "ccf-param-2020", locator: `Section ${section}, ALPHA FACTOR DISTRIBUTIONS, CCCG = 2, alpha2 row; PDF page ${pdfPage}` });

/**
 * Beta factors for common-cause component groups of size 2 (alpha2 of the template, which the report's
 * MGL table equals as Beta at CCCG = 2), with the alpha2 distribution as the beta factor's uncertainty.
 */
export const CCF_DATA = Object.freeze({
  "EPS-EDG-FS": { description: "Emergency diesel generators fail to start", groupSize: 2, dist: { type: "beta", alpha: 1.469, beta: 175.8 }, mean: 8.28e-3, p5: 9.44e-4, median: 6.52e-3, p95: 2.16e-2, independentEvents: 153.4, ccfEvents: 1, dataRange: "2006-2020", ...ccf("2.11.1.1", 394) },
  "EPS-EDG-LR": { description: "Emergency diesel generators fail to load and run", groupSize: 2, dist: { type: "beta", alpha: 0.6369, beta: 114.0 }, mean: 5.56e-3, p5: 6.76e-5, median: 3.06e-3, p95: 1.95e-2, independentEvents: 181.6, ccfEvents: 2, dataRange: "2006-2020", ...ccf("2.11.1.2", 397) },
  "EPS-EDG-FR": { description: "Emergency diesel generators fail to run", groupSize: 2, dist: { type: "beta", alpha: 1.848, beta: 132.5 }, mean: 1.38e-2, p5: 2.23e-3, median: 1.14e-2, p95: 3.32e-2, independentEvents: 181.6, ccfEvents: 3, dataRange: "2006-2020", ...ccf("2.11.1.3", 400) },
  "AFW-MDP-FS": { description: "AFW motor-driven pumps fail to start", groupSize: 2, dist: { type: "beta", alpha: 1.469, beta: 38.75 }, mean: 3.65e-2, p5: 4.26e-3, median: 2.91e-2, p95: 9.41e-2, independentEvents: 24.5, ccfEvents: 1, dataRange: "2006-2020", ...ccf("2.1.6.1", 91) },
});

/** The full claim for a data key (component, initiator or CCF), with its source record. */
export function dataClaim(key) {
  const row = COMPONENT_DATA[key] || INITIATOR_DATA[key] || CCF_DATA[key];
  if (!row) return null;
  return { key, ...row, sourceRecord: DATA_SOURCES[row.source], status: "sourced" };
}

/** Mean of a distribution as parameterised (α/(α+β) for beta, α/β for gamma). */
export function distMean(d) {
  if (d.type === "beta") return d.alpha / (d.alpha + d.beta);
  if (d.type === "gamma") return d.alpha / d.beta;
  throw new Error(`unknown distribution ${d.type}`);
}
