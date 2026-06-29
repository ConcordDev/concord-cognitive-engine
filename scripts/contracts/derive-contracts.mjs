#!/usr/bin/env node
// scripts/contracts/derive-contracts.mjs
//
// Auto-derive a BASELINE contract per macro from the live registry, group by
// domain into content/contracts/derived/<domain>.json, and merge any
// hand-authored content/contracts/overrides/<domain>.<macro>.json on top.
//
// Baselines are cheap and universal:
//   - inputs:     from spec.paramSchema where present, else {}.
//   - invariants: the universal floor (object, non-null, ok-boolean-or-data).
//   - fuzz_cases: none by default (seeds are human-authored in overrides).
//
// The output is deterministic (sorted keys) and idempotent: re-running with no
// macro/override changes rewrites byte-identical files.
//
// Usage:
//   node scripts/contracts/derive-contracts.mjs            # write derived/*.json
//   node scripts/contracts/derive-contracts.mjs --check    # fail if out-of-date (CI)

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bootEngine, enumerateMacros, stableStringify } from "./harness.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const CONTRACTS_DIR = path.join(REPO_ROOT, "content", "contracts");
const DERIVED_DIR = path.join(CONTRACTS_DIR, "derived");
const OVERRIDES_DIR = path.join(CONTRACTS_DIR, "overrides");

const CHECK_MODE = process.argv.includes("--check");

// The universal invariant floor every macro must clear. These are intentionally
// generous — they encode "returned a usable object envelope", not domain logic.
export const UNIVERSAL_INVARIANTS = [
  "output !== null && output !== undefined",
  "typeof output === 'object'",
  "(typeof output.ok === 'boolean') || (output !== null && typeof output === 'object')",
];

/** Load all overrides keyed by macro_id. */
function loadOverrides() {
  const byMacro = new Map();
  if (!fs.existsSync(OVERRIDES_DIR)) return byMacro;
  for (const file of fs.readdirSync(OVERRIDES_DIR)) {
    if (!file.endsWith(".json") || file.startsWith("_")) continue;
    const full = path.join(OVERRIDES_DIR, file);
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(full, "utf8"));
    } catch (err) {
      console.error(`[derive] SKIP malformed override ${file}: ${err?.message || err}`);
      continue;
    }
    const macroId = parsed.macro_id || file.replace(/\.json$/, "");
    byMacro.set(macroId, parsed);
  }
  return byMacro;
}

/** Build the derived baseline contract for one macro, then merge an override. */
function buildContract(macro, override) {
  const baselineInputs =
    macro.spec && macro.spec.paramSchema && typeof macro.spec.paramSchema === "object"
      ? macro.spec.paramSchema
      : {};

  const contract = {
    macro_id: macro.macroId,
    domain: macro.domain,
    name: macro.name,
    _derived: true,
    inputs: { ...baselineInputs },
    invariants: [...UNIVERSAL_INVARIANTS],
    fuzz_cases: [],
  };

  if (override && typeof override === "object") {
    contract._derived = false; // an override is present → no longer pure-derived
    // inputs MERGE field-by-field (override tightens/adds).
    if (override.inputs && typeof override.inputs === "object") {
      contract.inputs = { ...contract.inputs, ...override.inputs };
    }
    // invariants APPEND + dedupe.
    if (Array.isArray(override.invariants)) {
      const set = new Set(contract.invariants);
      for (const inv of override.invariants) {
        if (typeof inv === "string" && inv.trim()) set.add(inv);
      }
      contract.invariants = [...set];
    }
    // fuzz_cases REPLACE (seeds are wholly human-authored).
    if (Array.isArray(override.fuzz_cases)) {
      contract.fuzz_cases = override.fuzz_cases;
    }
  }

  return contract;
}

async function main() {
  const { MACROS, lensActions, brainBacked } = await bootEngine();
  const macros = enumerateMacros(MACROS, lensActions, brainBacked);
  const overrides = loadOverrides();

  // Group contracts by domain.
  const byDomain = new Map();
  let withSchema = 0;
  let withOverride = 0;
  for (const macro of macros) {
    // Path-3 brain-backed/skip handlers are never driven, so emitting a static
    // contract for them would only bloat the derived tree by ~29k entries. Skip.
    // (Path-2 is emitted in full, including its skip macros, unchanged.)
    if (macro.path === 3 && macro.skip) continue;
    const override = overrides.get(macro.macroId) || null;
    if (macro.spec?.paramSchema) withSchema++;
    if (override) withOverride++;
    const contract = buildContract(macro, override);
    if (!byDomain.has(macro.domain)) byDomain.set(macro.domain, []);
    byDomain.get(macro.domain).push(contract);
  }

  fs.mkdirSync(DERIVED_DIR, { recursive: true });

  // Build the desired file contents first (deterministic), then either write or
  // diff (--check). Sort domains + contracts within a domain for stability.
  const desired = new Map(); // filepath -> content string
  for (const [domain, contracts] of [...byDomain.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    contracts.sort((a, b) => a.macro_id.localeCompare(b.macro_id));
    const safeDomain = domain.replace(/[^a-zA-Z0-9_.-]/g, "_");
    const file = path.join(DERIVED_DIR, `${safeDomain}.json`);
    const payload = {
      domain,
      generatedBy: "scripts/contracts/derive-contracts.mjs",
      macroCount: contracts.length,
      contracts,
    };
    desired.set(file, stableStringify(payload));
  }

  // Determine stale derived files (domains that no longer exist) for cleanup.
  const existing = fs.existsSync(DERIVED_DIR)
    ? fs.readdirSync(DERIVED_DIR).filter((f) => f.endsWith(".json")).map((f) => path.join(DERIVED_DIR, f))
    : [];
  const desiredFiles = new Set(desired.keys());
  const orphanFiles = existing.filter((f) => !desiredFiles.has(f));

  if (CHECK_MODE) {
    let drift = 0;
    for (const [file, content] of desired.entries()) {
      const cur = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
      if (cur !== content) {
        console.error(`[derive --check] OUT OF DATE: ${path.relative(REPO_ROOT, file)}`);
        drift++;
      }
    }
    for (const f of orphanFiles) {
      console.error(`[derive --check] ORPHAN (domain gone): ${path.relative(REPO_ROOT, f)}`);
      drift++;
    }
    if (drift > 0) {
      console.error(`[derive --check] ${drift} file(s) out of date. Run: node scripts/contracts/derive-contracts.mjs`);
      process.exit(1);
    }
    console.log(`[derive --check] up to date — ${macros.length} macros across ${desired.size} domains.`);
    return;
  }

  let written = 0;
  for (const [file, content] of desired.entries()) {
    const cur = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
    if (cur !== content) {
      fs.writeFileSync(file, content);
      written++;
    }
  }
  for (const f of orphanFiles) {
    fs.rmSync(f);
    console.log(`[derive] removed orphan ${path.relative(REPO_ROOT, f)}`);
  }

  console.log(
    `[derive] ${macros.length} macros → ${desired.size} domain files ` +
      `(${written} written/changed, ${withSchema} with paramSchema, ${withOverride} overrides merged).`,
  );
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error("[derive] FATAL", err);
    process.exit(1);
  },
);
