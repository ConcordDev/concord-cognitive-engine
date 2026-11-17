// server/lib/conkay/orc/intent-parse.js
//
// SX-ORC-01 — orc.intent-parse: free-text request -> typed brief for ANY
// product (catalogue wave 0, PRG-17 root).
//
// Generalizes the five read domains of chat/brief-parser.js (car, bracket,
// beam, truss, sentinel-part) into a registered solver, and extends the
// typed brief to open text: quantities are extracted by
// chat/quantities.js (domain-independent) and EVERY number in the brief is
// traced to the user's text by literal re-find — the PLAN-CONKAY-SENTINEL
// rule. A language model may PROPOSE quantities (the `proposed` input);
// a proposal enters the brief only when its value and unit are found
// literally in the request text. Bare numbers (no unit) are surfaced as
// bare, never silently read as SI (SC-04 discipline at this layer).
//
// Honesty contract:
//   - no text -> NOT_COMPUTED missing_input:text
//   - nothing parseable at all -> NOT_COMPUTED naming what was looked for
//   - ambiguous units are excluded and named, never guessed
//   - proposed numbers that fail literal re-find are rejected and named,
//     with INVALID_INPUT for non-finite / unphysical magnitudes

import { registerSolver } from "../physics/registry.js";
import { detectDomain, parseChatBrief } from "../chat/brief-parser.js";
import { scanQuantities } from "../chat/quantities.js";

const NS = "orc.intent";

// Targeting + run are a local pair, not physics/solvers/graph-adapter.js:
// at this build the adapter's two halves disagree — graphTargets checks
// the literal dotted key (props["orc.intent"], the shape compiled nodes
// carry) while graphRunner reads through ctx.get's dot-splitting path
// walk (props -> orc -> intent), so an adapter solver is targeted and
// then reads nothing. This pair checks and reads the same literal key.
// Finding filed with the SXC-38/ORC-01 evidence for the office to route;
// the adapter itself is shared machinery and is not edited here.
function intentTargets(graph) {
  if (!graph || !graph.nodes) return [];
  const out = [];
  for (const [id, node] of graph.nodes) {
    if (node && node.props && node.props[NS]) out.push(id);
  }
  return out;
}

function intentRun(ctx, id) {
  let all = null;
  try {
    all = ctx.get(id, "props");
  } catch {
    all = null;
  }
  const props = all ? all[NS] : null;
  if (!props || (typeof props === "object" && !Array.isArray(props) && Object.keys(props).length === 0)) {
    return { notComputed: `props.${NS} is empty or absent on node ${id}`, inputs: {} };
  }
  return parseIntentBrief(props);
}

const READ_DOMAINS = ["car", "bracket", "beam", "truss", "sentinel-part"];

/** Literal re-find: does `value` with `unit` appear in the text as written? */
export function literallyInText(text, value, unit) {
  const src = String(text || "");
  const num = String(value);
  if (!src.includes(num)) return false;
  if (unit == null || unit === "") return true;
  const after = src.slice(src.indexOf(num) + num.length);
  return after.trimStart().toLowerCase().startsWith(String(unit).toLowerCase());
}

function checkProposed(text, proposed) {
  const admitted = [];
  const rejected = [];
  for (const p of Array.isArray(proposed) ? proposed : []) {
    const name = p?.name || p?.field || "proposed";
    const value = Number(p?.value);
    if (!Number.isFinite(value) || Math.abs(value) >= 1e300) {
      rejected.push({ name, value: p?.value ?? null, unit: p?.unit ?? null, reason: "INVALID_INPUT: value is not a finite, physical magnitude" });
      continue;
    }
    if (value < 0) {
      rejected.push({ name, value, unit: p?.unit ?? null, reason: "INVALID_INPUT: negative value for a physical quantity" });
      continue;
    }
    if (!literallyInText(text, p.value, p.unit)) {
      rejected.push({ name, value, unit: p?.unit ?? null, reason: "not found literally in the request text (literal re-find failed)" });
      continue;
    }
    admitted.push({ name, value, unit: p.unit ?? null, source: "proposed; admitted by literal re-find in the request text" });
  }
  return { admitted, rejected };
}

/**
 * The pure solver function. props: { text, proposed? } -> raw solver result.
 * Exported for direct testing; the registry run() reaches it through the
 * graph adapter over props["orc.intent"].
 */
export function parseIntentBrief(props = {}) {
  const text = props?.text;
  if (typeof text !== "string" || !text.trim()) {
    return { notComputed: "missing_input:text", inputs: {} };
  }
  const scan = scanQuantities(text);
  const domain = detectDomain(text);
  const warnings = [];
  for (const e of scan.errors || []) {
    warnings.push(`quantity excluded, not guessed: "${e.raw}" — ${e.error}`);
  }

  const quantities = (scan.quantities || []).map((q) => ({
    raw: q.raw,
    value: q.value,
    unit: q.unit,
    dim: q.dim,
    si: q.si,
    traced: true,
    source: "request text (literal extraction)",
  }));
  const bareNumbers = (scan.bare || []).map((b) => ({
    raw: b.raw,
    value: b.value,
    disposition: "no unit stated — not admitted as a quantity (SC-04)",
  }));
  const { admitted, rejected } = checkProposed(text, props?.proposed);
  for (const a of admitted) quantities.push(a);

  let claims = [];
  let ir = null;
  if (domain && READ_DOMAINS.includes(domain)) {
    const parsed = parseChatBrief(text);
    if (parsed.ok) {
      claims = parsed.claims || [];
      ir = parsed.ir || null;
    }
  }

  const missing = [];
  if (!domain) missing.push("domain");
  if (!quantities.length && !claims.length) missing.push("quantities");

  if (!domain && !quantities.length && !claims.length && !(scan.counts || []).length) {
    return {
      notComputed: "no_parseable_design_content: no read domain, no quantities, no claims in the request text",
      inputs: { text },
      outputs: { domain: null, quantities, bareNumbers, rejectedProposals: rejected, missing },
      warnings,
    };
  }
  if (!domain) {
    warnings.push("domain is not one of the five read domains (car, bracket, beam, truss, sentinel-part); brief carries traced quantities only");
  }

  return {
    inputs: { text },
    outputs: {
      domain,
      readDomain: Boolean(domain && READ_DOMAINS.includes(domain)),
      quantities,
      bareNumbers,
      admittedProposals: admitted,
      rejectedProposals: rejected,
      claims,
      ir,
      missing,
    },
    assumptions: [],
    warnings,
  };
}

registerSolver({
  id: "orc.intent-parse",
  version: "1.0.0",
  domain: "orchestration",
  domains: ["orchestration"],
  method: "intent.parse",
  fidelity: 1,
  regime: "any design request (Q11); the five read domains produce claims + an IR skeleton, open text produces traced quantities",
  units: "SI inside; input quantities echoed with their raw text and unit as written; bare numbers are never read as SI",
  tolerance: "exact: every admitted number is a literal re-find in the request text (tolerance 0)",
  screening: true,
  reference: "PLAN-CONKAY-SENTINEL literal re-find rule; 20-brief corpus in server/tests/conkay-orc-intent-parse.test.js",
  graphProp: NS,
  targets: intentTargets,
  run: intentRun,
});

export default { parseIntentBrief, literallyInText };
