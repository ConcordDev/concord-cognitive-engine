// server/lib/receipts/calc-sheet.js
//
// GB-1534 — the one-page human calculation sheet for a v2 calc receipt.
// Pure function of the receipt (plus an optional verify verdict the caller
// computed): no I/O, no network. An outside reviewer given only this page
// can see what was computed, against what basis, what was NOT checked, how
// the solver compares to the hand calculation / reference case, and can
// tamper-check the numbers through the verification link — any edited
// number fails verification, because the v2 signature covers the outputs.
//
// Print CSS targets a single A4 page via the browser's Save-as-PDF.

import { qrSvg } from "./qr-svg.js";

const VERIFY_BASE = "https://concord-os.org/verify";

function esc(v) {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Display formatting: at most 4 decimals, trailing noise trimmed, never 6929.999999999999. */
function fmt(value) {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "—";
    const rounded = Math.round(value * 10000) / 10000;
    return String(Object.is(rounded, -0) ? 0 : rounded);
  }
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (value == null) return "—";
  return String(value);
}

/** A results/inputs cell: { value, unit } unwraps to "value unit"; anything else formats plainly. */
function cell(v) {
  if (v && typeof v === "object" && !Array.isArray(v) && "value" in v) {
    return `${fmt(v.value)}${v.unit ? ` ${esc(v.unit)}` : ""}`;
  }
  if (Array.isArray(v)) return v.map((x) => cell(x)).join(", ");
  if (v && typeof v === "object") return Object.entries(v).map(([k, x]) => `${k}: ${cell(x)}`).join("; ");
  return fmt(v);
}

const LABELS = {
  length: "Length", height: "Depth (height)", flangeWidth: "Flange width",
  flangeThickness: "Flange thickness", webThickness: "Web thickness",
  support: "Support", loadN: "Point load", segments: "Segments",
  E: "Elastic modulus E", yield: "Yield strength",
  maxStressMPa: "Maximum stress", maxDeflectionMm: "Maximum deflection",
  safetyFactor: "Safety factor (yield / stress)", utilization: "Utilization",
  adiabaticFlameTemperature: "Adiabatic flame temperature",
  majorProducts: "Major products (mole fraction)",
};
const label = (k) => LABELS[k] || k.replace(/([a-z])([A-Z])/g, "$1 $2");

/** Inputs rows in plain units: dims in mm, the point load in kN, moduli in MPa. */
function inputRows(inputs) {
  const rows = [];
  const walk = (obj, prefix) => {
    for (const [k, v] of Object.entries(obj || {})) {
      const key = prefix ? `${prefix}.${k}` : k;
      if (v && typeof v === "object" && !Array.isArray(v) && !("value" in v)) { walk(v, key); continue; }
      let shown = cell(v);
      if (k === "loadN" && typeof v === "number") shown = `${fmt(v / 1000)} kN`;
      else if (["length", "height", "flangeWidth", "flangeThickness", "webThickness"].includes(k)) shown = `${fmt(v)} mm`;
      else if ((k === "E" || k === "yield") && typeof v === "number") shown = `${fmt(v)} MPa`;
      rows.push(`<tr><th>${esc(label(k))}</th><td>${esc(shown)}</td></tr>`);
    }
  };
  walk(inputs, "");
  return rows.join("");
}

const NOT_CHECKED_SENTENCES = {
  "Shear": "Shear was not checked",
  "Lateral-torsional and local buckling": "Lateral-torsional and local buckling were not checked",
  "Bearing at supports": "Bearing at supports was not checked",
  "Connections": "Connections were not checked",
  "Self-weight": "Self-weight was not included",
  "Finite-rate kinetics": "Finite-rate kinetics were not checked",
  "Heat loss and radiation": "Heat loss and radiation were not checked",
  "Transport and mixing effects": "Transport and mixing effects were not checked",
};
const notCheckedSentence = (name) => NOT_CHECKED_SENTENCES[name] || `${name} was not checked`;

function nyTime(iso) {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York", year: "numeric", month: "short", day: "numeric",
      hour: "numeric", minute: "2-digit", second: "2-digit", timeZoneName: "short",
    }).format(new Date(iso));
  } catch {
    return "";
  }
}

/**
 * Render the calc sheet for a v2 calc receipt.
 * @param {object} receipt the attested receipt (with its signature block)
 * @param {{ verify?: { valid: boolean, reason: string | null } | null }} [opts]
 * @returns {string} a complete HTML document
 */
export function renderCalcSheetHtml(receipt, opts = {}) {
  const r = receipt && typeof receipt === "object" ? receipt : {};
  const verdict = r.verdict || {};
  const basis = r.designBasis || null;
  const status = typeof verdict.status === "string" ? verdict.status : "NOT_COMPUTED";
  const yieldOnly = basis && typeof basis.code === "string" && basis.code.startsWith("none");
  const verdictLine = status === "PASS" && yieldOnly ? "Yield check only — PASS" : status.replace(/_/g, " ");
  const solverName = r.solver && typeof r.solver === "object"
    ? `${r.solver.id || "solver"}${r.solver.version ? `@${r.solver.version}` : ""}`
    : String(r.solver || "solver");
  const digest = r.signature && typeof r.signature === "object" ? r.signature.digest : null;
  const keyId = (r.signature && r.signature.keyId) || (r.issuer && r.issuer.keyId) || null;
  const verifyUrl = digest ? `${VERIFY_BASE}?d=${digest}` : VERIFY_BASE;
  const verify = opts.verify || null;

  const resultRows = Object.entries(r.results || {})
    .filter(([k]) => k !== "utilizationByMember")
    .map(([k, v]) => `<tr><th>${esc(label(k))}</th><td>${esc(cell(v))}</td></tr>`)
    .join("");
  const members = r.results && Array.isArray(r.results.utilizationByMember) ? r.results.utilizationByMember : null;

  const hand = r.handCheck || null;
  const handRows = hand ? (() => {
    const solverStress = r.results?.maxStressMPa;
    const solverDefl = r.results?.maxDeflectionMm;
    const pct = (x) => (typeof x === "number" ? `${fmt(x)}%` : "—");
    return `<table>
      <tr><th></th><th>Hand calculation</th><th>Solver</th><th>Difference</th></tr>
      <tr><th>Maximum stress</th><td>${esc(cell(hand.maxStressMPa))}</td><td>${esc(cell(solverStress))}</td><td>${pct(hand.stressErrorPct)}</td></tr>
      <tr><th>Maximum deflection</th><td>${esc(cell(hand.maxDeflectionMm))}</td><td>${esc(cell(solverDefl))}</td><td>${pct(hand.deflectionErrorPct)}</td></tr>
    </table>
    <p class="small">Formulae: ${esc(hand.formula || "")}. Hand check ${hand.agrees ? "agrees with the solver" : "does NOT agree with the solver"}.</p>`;
  })() : "";

  const notChecked = basis && Array.isArray(basis.checksNotPerformed) && basis.checksNotPerformed.length
    ? `<section><h2>Not checked</h2><ul>${basis.checksNotPerformed.map((n) => `<li>${esc(notCheckedSentence(n))}.</li>`).join("")}</ul></section>`
    : "";
  const performed = basis && Array.isArray(basis.checksPerformed) && basis.checksPerformed.length
    ? `<p class="small">Checks performed: ${basis.checksPerformed.map(esc).join("; ")}.</p>`
    : "";

  const reference = r.reference && typeof r.reference === "object"
    ? `<section><h2>Reference case</h2><p>${esc(r.reference.case || "")} — cited value ${esc(fmt(r.reference.value))}${r.reference.unit ? ` ${esc(r.reference.unit)}` : ""}${r.reference.tolerance != null ? `, tolerance ±${esc(fmt(r.reference.tolerance))}` : ""}.</p></section>`
    : "";

  const job = r.job && typeof r.job === "object"
    ? `<section><h2>Job</h2><table>${Object.entries(r.job).map(([k, v]) => `<tr><th>${esc(label(k))}</th><td>${esc(v)}</td></tr>`).join("")}</table></section>`
    : "";

  const issuedUtc = r.issuedAt ? new Date(r.issuedAt).toUTCString() : "";
  const issuedNy = r.issuedAt ? nyTime(r.issuedAt) : "";

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>Calculation sheet — ${esc(solverName)}</title>
<style>
  @page { size: A4; margin: 12mm; }
  body { font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #111; font-size: 12px; line-height: 1.45; margin: 0; }
  h1 { font-size: 19px; margin: 0 0 2px; }
  h2 { font-size: 13px; margin: 14px 0 4px; text-transform: uppercase; letter-spacing: 0.04em; }
  .verdict { font-size: 16px; font-weight: 700; margin: 4px 0; }
  .banner { border: 2px solid #111; padding: 6px 10px; margin: 8px 0; font-weight: 600; }
  .verify { border: 2px solid #111; padding: 6px 10px; margin: 8px 0; }
  .verify.invalid { border-color: #b00020; color: #b00020; }
  table { border-collapse: collapse; min-width: 55%; }
  th, td { border: 1px solid #999; padding: 3px 8px; text-align: left; vertical-align: top; }
  th { background: #f0f0f0; font-weight: 600; }
  ul { margin: 4px 0; padding-left: 18px; }
  .small { color: #333; font-size: 11px; }
  .signoff td { height: 26px; min-width: 180px; }
  .footer { margin-top: 14px; border-top: 1px solid #999; padding-top: 8px; display: flex; gap: 16px; align-items: flex-start; }
  .mono { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 10px; word-break: break-all; }
</style></head><body>
${verify ? `<div class="verify${verify.valid ? "" : " invalid"}">Signature check: <strong>${verify.valid ? "VALID" : "INVALID"}</strong>${verify.valid ? " — the signature covers every number on this sheet." : ` — ${esc(verify.reason || "verification failed")}. Do not rely on this sheet.`}</div>` : ""}
<h1>Calculation sheet — ${esc(solverName)}</h1>
<p class="verdict">${esc(verdictLine)}</p>
${verdict.text ? `<p>${esc(verdict.text)}${verdict.governing ? ` Governing: ${esc(verdict.governing)}.` : ""}${verdict.achievedSF != null && verdict.requiredSF != null ? ` Achieved safety factor ${esc(fmt(verdict.achievedSF))} against a required ${esc(fmt(verdict.requiredSF))}.` : ""}</p>` : ""}
${basis ? `<div class="banner">Design basis: ${esc(basis.code)}${basis.loadFactors ? ` · load factors: ${esc(basis.loadFactors)}` : ""}${basis.requiredSF != null ? ` · required safety factor: ${esc(fmt(basis.requiredSF))}` : ""}</div>` : ""}
<section><h2>Inputs</h2><table>${inputRows(r.inputs)}</table></section>
${r.method ? `<section><h2>Method</h2><p>${esc(r.method)}.</p>${Array.isArray(r.assumptions) && r.assumptions.length ? `<p class="small">Assumptions: ${r.assumptions.map(esc).join("; ")}.</p>` : ""}</section>` : ""}
${hand ? `<section><h2>Hand check</h2>${handRows}</section>` : ""}
<section><h2>Results</h2><table>${resultRows}</table>${performed}</section>
${members ? `<section><h2>Appendix — per-member utilization</h2><table><tr><th>Member</th><th>Utilization</th><th>Band</th></tr>${members.map((u) => `<tr><td>${esc(u.id)}</td><td>${esc(fmt(u.utilizationPct))}%</td><td>${esc(u.band || "")}</td></tr>`).join("")}</table></section>` : ""}
${notChecked}
${reference}
<section><h2>Issuer</h2><p>Issued by ${esc((r.issuer && r.issuer.service) || "concord-os.org")}${keyId ? ` · signing key <span class="mono">${esc(keyId)}</span>` : ""}.</p></section>
${job}
<section><h2>Reviewer sign-off</h2><table class="signoff">
  <tr><th>Checked by</th><td></td><th>Signature</th><td></td></tr>
  <tr><th>Date</th><td></td><th>Comments</th><td></td></tr>
</table></section>
<div class="footer">
  <div>
    <p class="small">Issued ${esc(issuedUtc)} (UTC)${issuedNy ? ` · ${esc(issuedNy)} (New York)` : ""}.</p>
    <p class="small">Verify this sheet: <a href="${esc(verifyUrl)}">${esc(verifyUrl)}</a></p>
    ${digest ? `<p class="mono">digest ${esc(digest)}</p>` : ""}
    <p class="small">Any edited number fails verification — the signature covers the inputs and the outputs.</p>
  </div>
  <div>${digest ? qrSvg(verifyUrl, { modulePx: 3 }) : ""}</div>
</div>
</body></html>`;
}
