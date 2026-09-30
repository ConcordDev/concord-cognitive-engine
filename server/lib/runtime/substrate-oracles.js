// server/lib/runtime/substrate-oracles.js
//
// Deterministic oracle macros — CAS, FEA, engineering/physics/chem/accounting
// calculators. Each case is INVOKED through the real dual-registry dispatch
// (LENS_ACTIONS first, then MACROS) and must return a computed payload, not
// just { ok: true }. Used by scripts/substrate-invoke-oracles.mjs, MCP
// substrate_invoke_oracles, and server/tests/substrate/oracle-invocation.test.js.
//
// Source of truth for "what is trainable this week" per
// ~/.zuko/memory/concord-substrate-inventory-2026-09-01.md §8.

import { recordMacroCall } from "../macro-billing.js";

/** Simply-supported 2-bay frame — same fixture as engineering-domain-parity.test.js */
export const FEA_FRAME = Object.freeze({
  nodes: [
    { id: "N1", x: 0, y: 0, z: 0 },
    { id: "N2", x: 5, y: 0, z: 0 },
    { id: "N3", x: 10, y: 0, z: 0 },
  ],
  members: [
    { id: "M1", nodeI: "N1", nodeJ: "N2", area: 0.01, momentI: 1e-5, elasticModulus: 2e11, allowableStress: 2.5e8 },
    { id: "M2", nodeI: "N2", nodeJ: "N3", area: 0.01, momentI: 1e-5, elasticModulus: 2e11, allowableStress: 2.5e8 },
  ],
  loads: [{ nodeId: "N2", Fy: -5000 }],
  supports: [
    { nodeId: "N1", type: "fixed", fixedDOF: ["x", "y", "z", "rx", "ry", "rz"] },
    { nodeId: "N3", type: "fixed", fixedDOF: ["x", "y", "z", "rx", "ry", "rz"] },
  ],
});

/**
 * @typedef {object} OracleCase
 * @property {string} id
 * @property {string} domain
 * @property {string} action
 * @property {object} [params]
 * @property {(raw: object) => boolean} verify — raw handler envelope (may be {ok,result})
 */

/** @type {OracleCase[]} */
export const SUBSTRATE_ORACLE_CASES = Object.freeze([
  {
    id: "math-cas-simplify",
    domain: "math",
    action: "symbolicCompute",
    params: { expression: "x+0", operation: "simplify" },
    verify: (r) => r?.ok === true && String(r.result?.output || "").replace(/\s/g, "") === "x",
  },
  {
    id: "math-cas-derivative",
    domain: "math",
    action: "symbolicCompute",
    params: { expression: "x^2", operation: "derivative", variable: "x" },
    verify: (r) => r?.ok === true && /2\s*\*?\s*x|x\s*\*?\s*2/.test(String(r.result?.derivative || "").replace(/\s/g, "")),
  },
  {
    id: "math-cas-definite-integral",
    domain: "math",
    action: "symbolicCompute",
    params: { expression: "x", operation: "integral", lower: 0, upper: 2, variable: "x" },
    verify: (r) => r?.ok === true && Number(r.result?.definite) === 2,
  },
  {
    id: "math-unit-convert",
    domain: "math",
    action: "unitConvert",
    params: { value: 1, from: "km", to: "m" },
    verify: (r) => r?.ok === true && Number(r.result?.converted) === 1000,
  },
  {
    id: "engineering-runFEA",
    domain: "engineering",
    action: "runFEA",
    params: { model: FEA_FRAME },
    verify: (r) => r?.ok === true && Number.isFinite(Number(r.result?.summary?.maxUtilization)),
  },
  {
    id: "engineering-circuit-solve",
    domain: "engineering",
    action: "circuitSolve",
    params: {
      nodes: [{ id: "gnd" }, { id: "n1" }],
      elements: [
        { type: "voltage_source", nodeA: "n1", nodeB: "gnd", value: 10 },
        { type: "resistor", nodeA: "n1", nodeB: "gnd", value: 100 },
      ],
      groundNodeId: "gnd",
    },
    verify: (r) => r?.ok === true && Math.abs(Number(r.result?.nodeVoltages?.n1) - 10) < 1e-6,
  },
  {
    id: "physics-kinematics-1d",
    domain: "physics",
    action: "kinematics-1d",
    params: { v0: 0, a: 2, t: 5 },
    verify: (r) => r?.ok === true && Math.abs(Number(r.result?.solved?.v) - 10) < 1e-6,
  },
  {
    id: "physics-projectile",
    domain: "physics",
    action: "projectile",
    params: { v0: 20, angleDeg: 45 },
    verify: (r) => r?.ok === true && Number(r.result?.range_m) === 40.77,
  },
  {
    id: "chem-balance-reaction",
    domain: "chem",
    action: "balanceReaction",
    params: { equation: "H2 + O2 -> H2O" },
    verify: verifyChemBalanceReaction,
  },
  {
    id: "chem-molarity",
    domain: "chem",
    action: "calc-molarity",
    params: { moles: 2, liters: 0.5 },
    verify: (r) => r?.ok === true && Math.abs(Number(r.result?.molarity) - 4) < 1e-6,
  },
  {
    id: "accounting-trial-balance",
    domain: "accounting",
    action: "trialBalance",
    params: {
      accounts: [
        {
          accountNumber: "1000", name: "Cash", type: "asset",
          entries: [{ date: "2026-01-01", debit: 1000, credit: 0 }],
        },
        {
          accountNumber: "3000", name: "Equity", type: "equity",
          entries: [{ date: "2026-01-01", debit: 0, credit: 1000 }],
        },
      ],
    },
    verify: (r) => r?.ok === true && r.result?.isBalanced === true,
  },
  {
    id: "accounting-budget-variance",
    domain: "accounting",
    action: "budgetVariance",
    params: { budget: [{ category: "Marketing", planned: 1000, actual: 1200 }] },
    verify: (r) => r?.ok === true && Number(r.result?.lineItems?.[0]?.variance) === 200,
  },
]);

/** Stoichiometry oracle for H2 + O2 -> H2O → 2:1:2 (handles chem.js + chemistry-compute shapes). */
export function verifyChemBalanceReaction(r) {
  if (r?.ok === false) return false;
  const inner = r?.result?.elementCheck != null || typeof r?.result?.balanced === "boolean"
    ? r.result
    : (r?.result?.coefficients ? r.result : r);
  if (!inner) return false;

  // chemistry-compute (production LENS_ACTION override): balanced is formatted string
  if (typeof inner.balanced === "string") {
    return inner.balanced === "2H2 + O2 → 2H2O"
      && inner.coefficients?.H2 === 2
      && inner.coefficients?.O2 === 1
      && inner.coefficients?.H2O === 2;
  }

  // domains/chem.js: balanced boolean + elementCheck + coefficient array
  if (inner.balanced !== true) return false;
  const h = inner.elementCheck?.H;
  const o = inner.elementCheck?.O;
  if (!h?.balanced || !o?.balanced) return false;
  if (h.left !== 4 || h.right !== 4 || o.left !== 2 || o.right !== 2) return false;
  const coeffs = inner.coefficients || [];
  const byCompound = (name) => coeffs.find((c) => c.compound === name)?.coefficient;
  return byCompound("H2") === 2 && byCompound("O2") === 1 && byCompound("H2O") === 2;
}

/**
 * Normalize handler return — LENS_ACTIONS handlers return { ok, result }.
 * @param {object} raw
 */
export function unwrapHandlerResult(raw) {
  if (raw && typeof raw === "object" && "ok" in raw && "result" in raw) return raw;
  if (raw && typeof raw === "object" && "ok" in raw) return raw;
  return { ok: true, result: raw };
}

/**
 * Invoke one oracle case through the supplied dispatch function.
 * @param {OracleCase} c
 * @param {{ dispatch: Function, ctx?: object, db?: object, logCalls?: boolean, userId?: string }} opts
 */
export async function invokeOracleCase(c, opts) {
  const t0 = Date.now();
  const input = { ...(c.params || {}), artifact: { id: `oracle-${c.id}`, data: c.params || {} } };
  let raw;
  try {
    raw = await opts.dispatch(c.domain, c.action, input, opts.ctx || {});
  } catch (e) {
    raw = { ok: false, error: String(e?.message || e) };
  }
  const envelope = unwrapHandlerResult(raw);
  const durationMs = Date.now() - t0;
  const verified = c.verify(envelope);

  if (opts.logCalls && opts.db) {
    recordMacroCall(opts.db, {
      userId: opts.userId || "substrate-oracle",
      domain: c.domain,
      name: c.action,
      durationMs,
      status: verified ? "ok" : "error",
      costUnits: 0,
      refId: `substrate:${c.id}:${t0}`,
    });
  }

  return {
    id: c.id,
    domain: c.domain,
    action: c.action,
    ok: envelope.ok !== false,
    verified,
    durationMs,
    error: verified ? null : (envelope.error || "verification_failed"),
    resultSample: verified ? summarizeResult(envelope.result) : null,
  };
}

function summarizeResult(result) {
  if (result == null) return null;
  if (typeof result !== "object") return result;
  const keys = Object.keys(result).slice(0, 8);
  const out = {};
  for (const k of keys) {
    const v = result[k];
    if (v == null || typeof v === "number" || typeof v === "string" || typeof v === "boolean") {
      out[k] = v;
    } else if (Array.isArray(v)) {
      out[k] = `array[${v.length}]`;
    } else {
      out[k] = typeof v;
    }
  }
  return out;
}

/**
 * Run all substrate oracle cases.
 * @param {{ dispatch: Function, ctx?: object, db?: object, logCalls?: boolean, userId?: string, caseIds?: string[] }} opts
 */
export async function runSubstrateOracles(opts) {
  const cases = opts.caseIds?.length
    ? SUBSTRATE_ORACLE_CASES.filter((c) => opts.caseIds.includes(c.id))
    : SUBSTRATE_ORACLE_CASES;

  const results = [];
  for (const c of cases) {
    results.push(await invokeOracleCase(c, opts));
  }

  const passed = results.filter((r) => r.verified).length;
  const failed = results.filter((r) => !r.verified);

  return {
    ok: failed.length === 0,
    scope: "substrate-oracles",
    total: results.length,
    passed,
    failed: failed.length,
    results,
    failures: failed.map((r) => ({ id: r.id, domain: r.domain, action: r.action, error: r.error })),
  };
}

export default { SUBSTRATE_ORACLE_CASES, runSubstrateOracles, invokeOracleCase, FEA_FRAME };
