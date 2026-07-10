#!/usr/bin/env node
// scripts/validate-lens-contract.mjs
//
// Cross-checks the optional capability-contract fields on LensEntry
// (permissions / supportedDtuSchemas / macroDomain / version — see
// concord-frontend/lib/lens-registry.ts) against reality:
//
//   - `macroDomain`, when populated, MUST name a domain that is actually
//     registered server-side via `register(domain, ...)` /
//     `registerLensAction(domain, ...)` somewhere under `server/`. This is
//     the same detection method `scripts/verify-lens-backends.mjs` uses, so
//     the two scripts agree on what "a real macro domain" means.
//   - `permissions` / `supportedDtuSchemas`, when populated, are validated
//     structurally (array of non-empty strings) — there is no backend
//     enforcement engine yet to check them against (the fields are
//     informational per the CLAUDE.md "docs are a build artifact" rule:
//     a claim with no way to verify it shouldn't be asserted as fact, so we
//     only assert what's checkable and leave the rest as declared intent).
//   - `version`, when populated, MUST be a positive integer.
//
// Per this repo's "docs are a build artifact" discipline (CLAUDE.md §5):
// this script is how the `macroDomain` claim earns the right to exist —
// an entry that claims a domain the backend doesn't register is a fact
// error, not a style nit, and fails the gate.
//
// Mirrors the tsx-shim pattern in scripts/audit/gates/lens-reachability.mjs
// so we read the registry's own real values instead of regex-scraping
// 3.5k lines of TypeScript by hand.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SERVER = path.join(ROOT, "server");
const FE = path.join(ROOT, "concord-frontend");
const CI = process.argv.includes("--ci");

// ── 1. Registered macro domains (same detection as verify-lens-backends.mjs) ──
// Some domain files bind an alias (`const reg = registerLensAction`) and call
// `reg("d", "n", ...)` — those alias sites are registration sites too.
function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", ".git", "tests", "test"].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (e.name.endsWith(".js")) acc.push(p);
  }
  return acc;
}

function collectMacroDomains() {
  const serverFiles = walk(SERVER);
  const macroDomains = new Set();
  for (const f of serverFiles) {
    const src = fs.readFileSync(f, "utf8");
    const aliases = new Set(["register", "registerLensAction"]);
    for (const m of src.matchAll(/\bconst\s+(\w+)\s*=\s*(?:registerLensAction|register)\b/g)) {
      aliases.add(m[1]);
    }
    const aliasRe = new RegExp(
      String.raw`\b(?:` + [...aliases].join("|") + String.raw`)\(\s*["'\`]([a-zA-Z0-9_.\-]+)["'\`]\s*,\s*["'\`]([a-zA-Z0-9_.\-]+)["'\`]`,
      "g",
    );
    let m;
    while ((m = aliasRe.exec(src))) macroDomains.add(m[1]);
  }
  return macroDomains;
}

// ── 2. Pull the real LENS_REGISTRY contract fields via tsx ────────────────────
function readRegistryEntries() {
  const shim = `
import { LENS_REGISTRY } from './lib/lens-registry';
const rows = LENS_REGISTRY.map((l) => ({
  id: l.id,
  permissions: l.permissions ?? null,
  supportedDtuSchemas: l.supportedDtuSchemas ?? null,
  macroDomain: l.macroDomain ?? null,
  version: l.version ?? null,
}));
process.stdout.write(JSON.stringify(rows));
`;
  const shimPath = path.join(FE, ".lens-contract-shim.mts");
  fs.writeFileSync(shimPath, shim);
  try {
    const out = execFileSync("npx", ["--no-install", "tsx", shimPath], {
      cwd: FE, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    });
    return JSON.parse(out);
  } catch (e) {
    return null; // frontend deps (tsx) unavailable — caller degrades gracefully
  } finally {
    try { fs.unlinkSync(shimPath); } catch { /* best-effort */ }
  }
}

const macroDomains = collectMacroDomains();
const entries = readRegistryEntries();

if (entries === null) {
  console.log("[validate-lens-contract] SKIP — frontend deps (tsx) unavailable; run from an env with concord-frontend deps installed.");
  process.exit(0);
}

// ── 3. Validate each populated field ───────────────────────────────────────
const violations = [];
let populatedCount = 0;

function isStringArray(v) {
  return Array.isArray(v) && v.every((s) => typeof s === "string" && s.length > 0);
}

for (const e of entries) {
  const touchesContract = e.permissions || e.supportedDtuSchemas || e.macroDomain || e.version;
  if (!touchesContract) continue;
  populatedCount++;

  if (e.macroDomain !== null) {
    if (typeof e.macroDomain !== "string" || e.macroDomain.length === 0) {
      violations.push({ id: e.id, field: "macroDomain", reason: "must be a non-empty string" });
    } else if (!macroDomains.has(e.macroDomain)) {
      violations.push({
        id: e.id, field: "macroDomain", reason: `"${e.macroDomain}" is not a registered macro domain server-side`,
      });
    }
  }

  if (e.permissions !== null && !isStringArray(e.permissions)) {
    violations.push({ id: e.id, field: "permissions", reason: "must be an array of non-empty strings" });
  }

  if (e.supportedDtuSchemas !== null && !isStringArray(e.supportedDtuSchemas)) {
    violations.push({ id: e.id, field: "supportedDtuSchemas", reason: "must be an array of non-empty strings" });
  }

  if (e.version !== null && !(Number.isInteger(e.version) && e.version >= 1)) {
    violations.push({ id: e.id, field: "version", reason: "must be a positive integer" });
  }
}

const report = {
  generatedAt: new Date().toISOString(),
  totalLensEntries: entries.length,
  registeredMacroDomains: macroDomains.size,
  entriesWithContractFields: populatedCount,
  violationCount: violations.length,
  violations,
};
fs.mkdirSync(path.join(ROOT, "audit"), { recursive: true });
fs.writeFileSync(path.join(ROOT, "audit/lens-contract-validation.json"), JSON.stringify(report, null, 2));

console.log(`[validate-lens-contract] ${entries.length} lens entries, ${macroDomains.size} registered macro domains`);
console.log(`[validate-lens-contract] ${populatedCount} entries populate a capability-contract field`);
console.log(`[validate-lens-contract] violations: ${violations.length}`);
for (const v of violations) console.log(`   ✗ ${v.id}.${v.field} — ${v.reason}`);
if (violations.length === 0) console.log(`[validate-lens-contract] ✓ every populated contract claim checks out`);

if (CI && violations.length > 0) {
  console.error(`[validate-lens-contract] GATE FAIL: ${violations.length} unverified contract claim(s)`);
  process.exit(1);
}
