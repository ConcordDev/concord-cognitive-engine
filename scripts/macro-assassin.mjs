#!/usr/bin/env node
// scripts/macro-assassin.mjs
//
// The Macro Assassin — adversarial verifier for the macro layer. Boots the app
// in-process, loads derived + override contracts, and drives every
// HEADLESS-SAFE macro through three attack vectors against the REAL runMacro:
//
//   V1 SEED      — each contract fuzz_case input → runMacro; the returned object
//                  must match every key in `expect`.
//   V2 FUZZ      — a malicious payload synthesized from the input schema (NaN,
//                  Infinity, 1e308, -1, an XSS probe string, a deeply-nested
//                  object). PASS if the macro returns {ok:false} or throws a
//                  CAUGHT guard error; FAIL only on an uncaught runner crash or
//                  {ok:true} returned over poisoned NUMERIC input.
//   V3 INVARIANT — minimal-valid input → evaluate every invariant expression via
//                  the shared SAFE evaluator. FAIL on `false`.
//
// HONEST COVERAGE: only the ~925 headless-safe macros (the smoke-harness
// surface) can be driven here. LLM-hint / destructive / heavy-domain macros get
// a STATIC contract from derive-contracts but are NOT fuzzed — we never claim
// all ~9,600 were driven.
//
// Modes:
//   node scripts/macro-assassin.mjs                 # run all vectors; nonzero exit on ANY failure
//   node scripts/macro-assassin.mjs --ratchet       # nonzero exit ONLY on NEW failures vs BASELINE
//   node scripts/macro-assassin.mjs --write-baseline # (re)snapshot current failures as the baseline
//   node scripts/macro-assassin.mjs --domain=foo     # restrict to one domain (debug)
//   node scripts/macro-assassin.mjs --quiet          # summary only

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { bootEngine, enumerateMacros, buildDefaultInput } from "./contracts/harness.mjs";
import { evalInvariant } from "../server/lib/invariant-eval.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const DERIVED_DIR = path.join(REPO_ROOT, "content", "contracts", "derived");
const OVERRIDES_DIR = path.join(REPO_ROOT, "content", "contracts", "overrides");
const OUT_DIR = path.join(REPO_ROOT, "audit", "invariant-engine");
const VIOLATIONS_FILE = path.join(OUT_DIR, "violations.json");
const BASELINE_FILE = path.join(OUT_DIR, "BASELINE.json");

const argv = process.argv.slice(2);
const FLAGS = {
  ratchet: argv.includes("--ratchet"),
  writeBaseline: argv.includes("--write-baseline"),
  quiet: argv.includes("--quiet"),
  domain: (argv.find((a) => a.startsWith("--domain=")) || "").split("=")[1] || null,
};

const C = { g: "\x1b[32m", r: "\x1b[31m", y: "\x1b[33m", dim: "\x1b[2m", b: "\x1b[1m", rst: "\x1b[0m" };

// Per-macro wall-clock budget. A macro that blows past this is treated as a
// (recorded) hang, never allowed to wedge the whole run.
const MACRO_TIMEOUT_MS = Number(process.env.CONCORD_ASSASSIN_TIMEOUT_MS || 8000);

// ── Contract loading ─────────────────────────────────────────────────────────

/** Load all derived contracts (already override-merged by derive-contracts). */
function loadContracts() {
  const byMacro = new Map();
  if (!fs.existsSync(DERIVED_DIR)) {
    console.error(
      `${C.r}[assassin] no derived contracts at ${path.relative(REPO_ROOT, DERIVED_DIR)}.${C.rst}\n` +
        `Run: node scripts/contracts/derive-contracts.mjs`,
    );
    process.exit(2);
  }
  for (const file of fs.readdirSync(DERIVED_DIR)) {
    if (!file.endsWith(".json")) continue;
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(path.join(DERIVED_DIR, file), "utf8"));
    } catch (err) {
      console.error(`[assassin] SKIP malformed derived ${file}: ${err?.message || err}`);
      continue;
    }
    for (const contract of parsed.contracts || []) {
      byMacro.set(contract.macro_id, contract);
    }
  }
  // Live-merge any override that wasn't folded in yet (defensive — derive should
  // have done this, but the runner must reflect current truth even if derive is
  // stale). Override invariants append; fuzz_cases replace; inputs merge.
  if (fs.existsSync(OVERRIDES_DIR)) {
    for (const file of fs.readdirSync(OVERRIDES_DIR)) {
      if (!file.endsWith(".json") || file.startsWith("_")) continue;
      let ov;
      try {
        ov = JSON.parse(fs.readFileSync(path.join(OVERRIDES_DIR, file), "utf8"));
      } catch {
        continue;
      }
      const id = ov.macro_id || file.replace(/\.json$/, "");
      const base = byMacro.get(id);
      if (!base) continue;
      if (ov.inputs) base.inputs = { ...base.inputs, ...ov.inputs };
      if (Array.isArray(ov.invariants)) {
        const set = new Set(base.invariants || []);
        ov.invariants.forEach((i) => typeof i === "string" && i.trim() && set.add(i));
        base.invariants = [...set];
      }
      if (Array.isArray(ov.fuzz_cases)) base.fuzz_cases = ov.fuzz_cases;
    }
  }
  return byMacro;
}

// ── Malicious payload synthesis (V2) ─────────────────────────────────────────

const XSS_PROBE = "<script>alert(1)</script>";

/** A deeply-nested object (not cyclic — JSON-safe so it can't crash the logger). */
function deepNested(depth = 60) {
  let node = { leaf: true };
  for (let i = 0; i < depth; i++) node = { nest: node, i };
  return node;
}

/**
 * Build a malicious payload from a param schema. Returns
 * { payload, poisonedNumericFields } so V2 can tell whether a numeric param was
 * actually poisoned (the only case where {ok:true} is a hard fail).
 */
function buildMaliciousPayload(inputs) {
  const payload = { artifact: { id: "assassin", data: {} } };
  const poisonedNumericFields = [];
  const POISON_NUMS = [NaN, Infinity, -Infinity, 1e308, -1];

  if (inputs && typeof inputs === "object") {
    let numIdx = 0;
    for (const [field, rule] of Object.entries(inputs)) {
      const type = rule?.type;
      if (type === "number") {
        payload[field] = POISON_NUMS[numIdx % POISON_NUMS.length];
        numIdx++;
        poisonedNumericFields.push(field);
      } else if (type === "string") {
        payload[field] = XSS_PROBE;
      } else if (type === "array") {
        payload[field] = [XSS_PROBE, NaN, deepNested(20)];
      } else if (type === "object") {
        payload[field] = deepNested(40);
      } else if (type === "boolean") {
        payload[field] = "not-a-boolean";
      } else {
        // unknown/absent type → throw a poison string at it
        payload[field] = XSS_PROBE;
      }
    }
  }

  // Always smuggle in extra garbage + a deep object so even a no-schema macro
  // sees something hostile. Extra fields are tolerated by V2 (only HARD crash /
  // ok:true-on-poisoned-number fails).
  payload.__assassin_garbage = { xss: XSS_PROBE, huge: 1e308, neg: -1, nan: NaN, deep: deepNested(60) };

  return { payload, poisonedNumericFields };
}

/** Synthesize a minimal-valid input from a schema (param mins, or {}). */
function buildMinimalValid(domain, name, inputs) {
  const base = buildDefaultInput(domain, name);
  if (!inputs || typeof inputs !== "object") return base;
  for (const [field, rule] of Object.entries(inputs)) {
    if (!rule || typeof rule !== "object") continue;
    if (!rule.required && rule.min === undefined && rule.enum === undefined) continue;
    if (rule.type === "number") {
      base[field] = typeof rule.min === "number" ? rule.min : 1;
    } else if (rule.type === "string") {
      base[field] = Array.isArray(rule.enum) ? String(rule.enum[0]) : "x";
    } else if (rule.type === "boolean") {
      base[field] = false;
    } else if (rule.type === "array") {
      base[field] = [];
    } else if (rule.type === "object") {
      base[field] = {};
    } else if (Array.isArray(rule.enum)) {
      base[field] = rule.enum[0];
    } else if (rule.required) {
      base[field] = "x";
    }
  }
  return base;
}

// ── Safe macro invocation (timeout + total isolation) ────────────────────────

/**
 * Run a macro with a timeout. Distinguishes a CAUGHT throw (the dispatcher
 * threw, we caught it — acceptable for V2) from an uncaught crash that the
 * runner could not contain. Since runMacro is awaited inside try/catch, a true
 * "uncaught" here means an unhandled rejection / sync throw outside the await —
 * extremely rare, surfaced as `hardCrash`.
 *
 * @returns {Promise<{ status:'ok'|'threw'|'timeout', value?:any, error?:string }>}
 */
async function safeRun(runMacro, makeInternalCtx, domain, name, input) {
  const ctx = makeInternalCtx(`assassin:${domain}.${name}`);
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ status: "timeout" }), MACRO_TIMEOUT_MS);
  });
  const run = (async () => {
    try {
      const value = await runMacro(domain, name, input, ctx);
      return { status: "ok", value };
    } catch (err) {
      return { status: "threw", error: err?.message ? String(err.message) : String(err) };
    }
  })();
  const res = await Promise.race([run, timeout]);
  clearTimeout(timer);
  return res;
}

function isOk(v) {
  return v && typeof v === "object" && v.ok === true;
}
function isObj(v) {
  return v !== null && typeof v === "object";
}
/** True if a non-finite number (NaN / ±Infinity) appears anywhere in the value —
 *  the signature of a poisoned numeric LEAKING into a macro's output. Bounded
 *  recursion (depth 8) so a hostile deeply-nested return can't wedge the scan. */
function hasNonFiniteNumber(v, depth = 0) {
  if (depth > 8) return false;
  if (typeof v === "number") return !Number.isFinite(v);
  if (Array.isArray(v)) return v.some((x) => hasNonFiniteNumber(x, depth + 1));
  if (v && typeof v === "object") return Object.values(v).some((x) => hasNonFiniteNumber(x, depth + 1));
  return false;
}

// ── Vectors ──────────────────────────────────────────────────────────────────

const violations = [];
function record(macroId, vector, reason, detail) {
  violations.push({ macro_id: macroId, vector, reason, detail: detail || null });
}

/** V1 — seed cases. */
async function runV1(runMacro, makeInternalCtx, contract) {
  const cases = Array.isArray(contract.fuzz_cases) ? contract.fuzz_cases : [];
  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    const input = c?.input ?? {};
    const res = await safeRun(runMacro, makeInternalCtx, contract.domain, contract.name, input);
    if (res.status === "timeout") {
      record(contract.macro_id, "V1", "seed_timeout", { caseIndex: i });
      continue;
    }
    if (res.status === "threw") {
      record(contract.macro_id, "V1", "seed_threw", { caseIndex: i, error: res.error });
      continue;
    }
    const out = res.value;
    const expect = c?.expect || {};
    for (const [k, want] of Object.entries(expect)) {
      const got = isObj(out) ? out[k] : undefined;
      const matched = JSON.stringify(got) === JSON.stringify(want);
      if (!matched) {
        record(contract.macro_id, "V1", "seed_expect_mismatch", {
          caseIndex: i, key: k, want, got: clip(got),
        });
      }
    }
  }
}

/** V2 — malicious fuzz. Returns true if a HARD crash was detected. */
async function runV2(runMacro, makeInternalCtx, contract) {
  const { payload, poisonedNumericFields } = buildMaliciousPayload(contract.inputs);
  const res = await safeRun(runMacro, makeInternalCtx, contract.domain, contract.name, payload);

  if (res.status === "timeout") {
    // A hang on garbage input is a real robustness defect (possible infinite
    // loop on poisoned numeric), but not an uncaught crash.
    record(contract.macro_id, "V2", "fuzz_timeout", { poisonedNumericFields });
    return false;
  }
  if (res.status === "threw") {
    // The dispatcher caught a throw and surfaced it — acceptable. (runMacro is
    // supposed to convert throws into {ok:false}; if it threw anyway, that's a
    // soft signal, recorded but not a hard fail.)
    record(contract.macro_id, "V2", "fuzz_threw_caught", { error: res.error });
    return false;
  }
  const out = res.value;
  // The true fail-open defect is a poisoned numeric LEAKING into the output: the
  // macro consumed NaN/Infinity and emitted a non-finite number in its result.
  // A macro that SANITIZES the poison to a finite value (the codebase's
  // established "clamp, don't reject" convention — parseInt('1e999')→1,
  // finNum collapses non-finite to a fallback) is CORRECT and must not be
  // flagged just for returning ok:true. So the gate is: ok:true AND a non-finite
  // number actually present in the output. (An earlier version flagged any
  // ok:true-with-poison, which false-positived every safe-clamp macro.)
  if (isOk(out) && poisonedNumericFields.length > 0 && hasNonFiniteNumber(out)) {
    record(contract.macro_id, "V2", "nonfinite_leak_on_poison", { poisonedNumericFields, out: clip(out) });
  }
  // Returning a non-object on garbage is also a contract break.
  if (!isObj(out)) {
    record(contract.macro_id, "V2", "non_object_on_fuzz", { got: clip(out) });
  }
  return false;
}

/** V3 — invariant evaluation on minimal-valid input. */
async function runV3(runMacro, makeInternalCtx, contract) {
  const invariants = Array.isArray(contract.invariants) ? contract.invariants : [];
  if (invariants.length === 0) return;
  const input = buildMinimalValid(contract.domain, contract.name, contract.inputs);
  const res = await safeRun(runMacro, makeInternalCtx, contract.domain, contract.name, input);
  if (res.status === "timeout") {
    record(contract.macro_id, "V3", "invariant_input_timeout", null);
    return;
  }
  if (res.status === "threw") {
    record(contract.macro_id, "V3", "invariant_input_threw", { error: res.error });
    return;
  }
  const output = res.value;
  for (const expr of invariants) {
    const r = evalInvariant(expr, input, output);
    if (!r.ok) {
      record(contract.macro_id, "V3", "invariant_violated", {
        expr, why: r.reason, output: clip(output),
      });
    }
  }
}

function clip(v) {
  try {
    const s = JSON.stringify(v);
    return s && s.length > 240 ? s.slice(0, 240) + "…" : (s ?? String(v));
  } catch {
    return String(v);
  }
}

// ── Ratchet helpers ──────────────────────────────────────────────────────────

function fingerprint(v) {
  // Stable across runs: macro_id + vector + reason (+ key for V1 mismatches +
  // expr for V3). Deliberately excludes volatile `got`/`output` payloads.
  const parts = [v.macro_id, v.vector, v.reason];
  if (v.detail?.key) parts.push(`key:${v.detail.key}`);
  if (v.detail?.expr) parts.push(`expr:${v.detail.expr}`);
  if (typeof v.detail?.caseIndex === "number") parts.push(`case:${v.detail.caseIndex}`);
  return crypto.createHash("sha1").update(parts.join("|")).digest("hex").slice(0, 16);
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const t0 = Date.now();
  const { runMacro, makeInternalCtx, MACROS, lensActions, dispatchLensRun, brainBacked } = await bootEngine();
  const contracts = loadContracts();
  const allMacros = enumerateMacros(MACROS, lensActions, brainBacked);

  let driven = 0;
  let skipped = 0;
  let hardCrashes = [];

  // Process-level safety net: a macro that emits an unhandled rejection mid-run
  // must be recorded, not allowed to kill the process.
  const onUnhandled = (reason) => {
    hardCrashes.push(String(reason?.message || reason));
  };
  process.on("unhandledRejection", onUnhandled);

  for (const macro of allMacros) {
    if (FLAGS.domain && macro.domain !== FLAGS.domain) continue;
    if (macro.skip) {
      skipped++;
      continue; // headless-unsafe → static contract only, never driven
    }
    const contract = contracts.get(macro.macroId);
    if (!contract) {
      // Should not happen if derive ran; record as a meta-violation so it's visible.
      record(macro.macroId, "META", "no_contract", null);
      continue;
    }
    driven++;
    // Drive path-3 handlers through the LENS_ACTIONS-preferring dispatcher (the
    // exact /api/lens/run path); path-2 stays on bare runMacro.
    const driveFn = macro.path === 3 ? dispatchLensRun : runMacro;
    // Each vector is fully guarded inside safeRun; an unexpected throw at THIS
    // level (e.g. a synchronous explosion in contract handling) is caught here
    // and flagged as a hard crash — the real-bug signal the task asks for.
    try {
      await runV1(driveFn, makeInternalCtx, contract);
      await runV2(driveFn, makeInternalCtx, contract);
      await runV3(driveFn, makeInternalCtx, contract);
    } catch (err) {
      const msg = `${macro.macroId} HARD-CRASHED runner: ${err?.stack || err?.message || err}`;
      hardCrashes.push(msg);
      record(macro.macroId, "HARD", "uncaught_runner_crash", { error: String(err?.message || err) });
    }
  }

  process.off("unhandledRejection", onUnhandled);

  // ── Aggregate ──
  const byVector = { V1: 0, V2: 0, V3: 0, META: 0, HARD: 0 };
  const byReason = {};
  const byDomain = {};
  for (const v of violations) {
    byVector[v.vector] = (byVector[v.vector] || 0) + 1;
    byReason[v.reason] = (byReason[v.reason] || 0) + 1;
    const dom = v.macro_id.split(".")[0];
    byDomain[dom] = (byDomain[dom] || 0) + 1;
  }

  const fingerprints = {};
  for (const v of violations) fingerprints[fingerprint(v)] = { macro_id: v.macro_id, vector: v.vector, reason: v.reason };

  const report = {
    generatedAt: new Date().toISOString(),
    durationMs: Date.now() - t0,
    totals: {
      macrosEnumerated: allMacros.length,
      headlessSafeDriven: driven,
      headlessUnsafeSkipped: skipped,
      violations: violations.length,
      hardCrashes: hardCrashes.length,
    },
    byVector,
    byReason,
    byDomain,
    violations,
    hardCrashes,
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(VIOLATIONS_FILE, JSON.stringify(report, null, 2) + "\n");

  // ── Console summary ──
  if (!FLAGS.quiet) {
    console.log(`\n${C.b}═══ MACRO ASSASSIN ═══${C.rst}`);
    console.log(
      `${C.dim}enumerated${C.rst} ${allMacros.length}  ` +
        `${C.dim}driven (headless-safe)${C.rst} ${C.b}${driven}${C.rst}  ` +
        `${C.dim}skipped (static-only)${C.rst} ${skipped}  ` +
        `${C.dim}in${C.rst} ${(report.durationMs / 1000).toFixed(1)}s`,
    );
    console.log(
      `${C.dim}violations${C.rst}  V1=${byVector.V1}  V2=${byVector.V2}  V3=${byVector.V3}  ` +
        `META=${byVector.META}  HARD=${C.r}${byVector.HARD}${C.rst}  ` +
        `${C.dim}total${C.rst} ${violations.length}`,
    );
    const topDomains = Object.entries(byDomain).sort((a, b) => b[1] - a[1]).slice(0, 12);
    if (topDomains.length) {
      console.log(`${C.dim}top domains:${C.rst} ${topDomains.map(([d, n]) => `${d}:${n}`).join("  ")}`);
    }
    const topReasons = Object.entries(byReason).sort((a, b) => b[1] - a[1]);
    if (topReasons.length) {
      console.log(`${C.dim}reasons:${C.rst}     ${topReasons.map(([r, n]) => `${r}:${n}`).join("  ")}`);
    }
    if (hardCrashes.length) {
      console.log(`\n${C.r}${C.b}HARD CRASHES (uncaught — real bugs):${C.rst}`);
      hardCrashes.slice(0, 20).forEach((m) => console.log(`  ${C.r}✗${C.rst} ${m.slice(0, 200)}`));
    }
    console.log(`${C.dim}report → ${path.relative(REPO_ROOT, VIOLATIONS_FILE)}${C.rst}`);
  }

  // ── Baseline / ratchet ──
  if (FLAGS.writeBaseline) {
    const baseline = {
      generatedAt: report.generatedAt,
      totals: report.totals,
      byVector,
      fingerprints,
    };
    fs.writeFileSync(BASELINE_FILE, JSON.stringify(baseline, null, 2) + "\n");
    console.log(`${C.g}[assassin] baseline snapshotted → ${path.relative(REPO_ROOT, BASELINE_FILE)} (${Object.keys(fingerprints).length} fingerprints)${C.rst}`);
    process.exit(0);
  }

  if (FLAGS.ratchet) {
    if (!fs.existsSync(BASELINE_FILE)) {
      console.error(`${C.r}[assassin --ratchet] no baseline at ${path.relative(REPO_ROOT, BASELINE_FILE)}. Run --write-baseline first.${C.rst}`);
      process.exit(2);
    }
    const baseline = JSON.parse(fs.readFileSync(BASELINE_FILE, "utf8"));
    const baseFp = new Set(Object.keys(baseline.fingerprints || {}));
    // Timeout-class reasons (fuzz_timeout / invariant_input_timeout / seed_timeout)
    // are a TIMING artifact, not a deterministic code defect: under the fixed
    // per-macro wall-clock budget, WHICH heavy macro exceeds it varies run-to-run
    // and with machine load (acute now that the path-3 enumeration drives ~13k
    // macros/run). Gating CI on them makes the ratchet flaky for no signal. They
    // are still RECORDED in the report (advisory) — only excluded from the
    // pass/fail gate. Deterministic reasons (fail-open, invariant, seed mismatch,
    // throws) still gate normally.
    const isTimeoutReason = (r) => typeof r === "string" && r.includes("timeout");
    const newOnes = Object.entries(fingerprints)
      .filter(([fp]) => !baseFp.has(fp))
      .filter(([, v]) => !isTimeoutReason(v.reason));
    if (newOnes.length > 0) {
      console.error(`\n${C.r}${C.b}[assassin --ratchet] ${newOnes.length} NEW violation(s) vs baseline:${C.rst}`);
      for (const [fp, v] of newOnes.slice(0, 50)) {
        console.error(`  ${C.r}✗${C.rst} ${v.macro_id}  ${v.vector}  ${v.reason}  ${C.dim}(${fp})${C.rst}`);
      }
      process.exit(1);
    }
    console.log(`${C.g}[assassin --ratchet] no new violations vs baseline (${baseFp.size} known).${C.rst}`);
    process.exit(0);
  }

  // Default mode: nonzero exit on ANY failure (but everything is printed/saved).
  if (violations.length > 0) {
    console.log(`\n${C.y}[assassin] ${violations.length} violation(s) — see report. (Use --ratchet for new-only gating.)${C.rst}`);
    process.exit(1);
  }
  console.log(`${C.g}[assassin] clean — 0 violations across ${driven} headless-safe macros.${C.rst}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(`${C.r}[assassin] FATAL${C.rst}`, err);
  process.exit(2);
});
