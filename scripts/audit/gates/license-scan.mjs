#!/usr/bin/env node
// License gate (Track G4 — Function-Assurance auto-gate principle).
//
// Walks the installed dependency trees (server + frontend + mobile when present),
// reads each package.json `license`/`licenses` field, and flags any package whose
// license is copyleft-strong, non-commercial, source-available-restrictive, or
// undeclared — vs a permissive allowlist. A small EXCEPTIONS map carries the
// deliberately-accepted ones (with a reason), mirroring the schema-drift gate's
// FP_EXCLUDE. Floor 0: `--ci` exits non-zero on any unexcepted violation, so a
// future AGPL/GPL/non-commercial/Hippocratic dep can't merge silently.
//
// Usage:
//   node scripts/audit/gates/license-scan.mjs            # report
//   node scripts/audit/gates/license-scan.mjs --ci       # fail on violation
//
// Method: per node_modules, read each package's package.json license; normalise SPDX;
// classify against PERMISSIVE; everything else is a violation unless EXCEPTIONS lists it.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..", "..", "..");

const CI = process.argv.includes("--ci");

// Permissive licenses — commercial-clean, no copyleft/attribution-redistribution burden
// that matters for a hosted SaaS. SPDX ids (normalised, upper-cased, prefix-matched).
const PERMISSIVE = [
  "MIT", "MIT-0", "ISC", "0BSD", "BSD-2-CLAUSE", "BSD-3-CLAUSE", "BSD", "APACHE-2.0",
  "APACHE", "MPL-2.0", "CC0-1.0", "CC0", "UNLICENSE", "PYTHON-2.0", "BLUEOAK-1.0.0",
  "WTFPL", "ZLIB", "BSL-1.0", "PostgreSQL".toUpperCase(),
];

// Substrings that mark a license as a violation regardless of exact SPDX form.
const FLAG_PATTERNS = [
  "AGPL", "SSPL", "BUSL", "BUSINESS SOURCE", "HIPPOCRATIC", "CC-BY-NC", "CC-BY-NC-SA",
  "COMMONS CLAUSE", "NONCOMMERCIAL", "NON-COMMERCIAL", "PROPRIETARY", "UNLICENSED",
  "ELASTIC", "CONFLUENT",
];
// GPL/LGPL handled separately: GPL is a violation unless excepted; LGPL flagged but
// usually fine (dynamic link) — we still surface it and require an explicit exception.
const COPYLEFT_GPL = ["GPL-3.0", "GPL-2.0", "GPL", "LGPL-3.0", "LGPL-2.1", "LGPL"];

// Deliberately-accepted exceptions (package name → reason). See docs/LICENSING.md.
const EXCEPTIONS = {
  "ffmpeg-static": "GPL-3.0 — invoked as a separate subprocess, not linked, not distributed (SaaS).",
  "sharp": "LGPL via @img/sharp-libvips — dynamically-loaded native lib, unmodified.",
  "caniuse-lite": "CC-BY-4.0 — build-time tooling, not shipped as content.",
  // Non-SPDX / undeclared-but-known-permissive (effectively MIT/Apache upstream):
  "flatbuffers": "Apache-2.0 — Google project, declared as 'SEE LICENSE IN' (non-SPDX form).",
  "png-js": "MIT upstream — package.json omits the license field.",
  "khroma": "MIT upstream — package.json omits the license field.",
  "webgl-constants": "MIT upstream — package.json omits the license field.",
  "@mapbox/jsonlint-lines-primitives": "MIT upstream (mapbox/jsonlint fork; maplibre-gl dep) — license field omitted.",
  "@segment/loosely-validate-event": "MIT (LICENSE file present; segment) — license field omitted.",
  "@wix-pilot/detox": "MIT upstream (wix-incubator/pilot; mobile detox) — license field omitted.",
  "gsap": "Standard 'no charge' license (gsap.com/standard-license) — free for commercial use under Webflow; dynamically-linked frontend animation lib, unmodified, not redistributed as source.",
  // Build-time-only dev tooling (not shipped in any bundle):
  "@sentry/cli": "FSL-1.1-MIT — build-time CLI only, not shipped; converts to MIT after 2y.",
  "@sentry/cli-linux-x64": "FSL-1.1-MIT — build-time CLI binary only, not shipped.",
};
// @img/sharp-libvips-* prebuilt binaries (LGPL) are covered by the `sharp` exception.
const EXCEPTION_PREFIXES = ["@img/sharp-libvips", "@img/sharp-"];

const ROOTS = [
  { name: "server", dir: path.join(REPO, "server", "node_modules") },
  { name: "frontend", dir: path.join(REPO, "concord-frontend", "node_modules") },
  { name: "mobile", dir: path.join(REPO, "concord-mobile", "node_modules") },
  { name: "repo", dir: path.join(REPO, "node_modules") },
];

function normLicense(pkg) {
  // license (string | {type}) or licenses[] (legacy array)
  let lic = pkg.license ?? pkg.licenses;
  if (!lic) return null;
  if (Array.isArray(lic)) lic = lic.map((l) => (typeof l === "string" ? l : l?.type)).filter(Boolean).join(" OR ");
  if (typeof lic === "object") lic = lic.type || lic.name || "";
  return String(lic).trim();
}

function classify(name, licenseRaw) {
  if (isExcepted(name)) return { verdict: "excepted", reason: EXCEPTIONS[name] || "sharp-libvips" };
  if (!licenseRaw) return { verdict: "violation", kind: "missing" };
  const L = licenseRaw.toUpperCase().replace(/[()]/g, "");
  // strip SPDX expression noise for prefix checks
  const tokens = L.split(/\s+(?:OR|AND)\s+|\//).map((t) => t.trim()).filter(Boolean);
  // permissive if EVERY token is permissive (an OR with one permissive arm is also fine)
  const anyPermissive = tokens.some((t) => PERMISSIVE.some((p) => t === p || t.startsWith(p)));
  const anyFlag = FLAG_PATTERNS.some((p) => L.includes(p));
  const anyGpl = COPYLEFT_GPL.some((p) => tokens.some((t) => t.startsWith(p)));
  if (anyFlag) return { verdict: "violation", kind: "restricted", license: licenseRaw };
  if (anyGpl && !anyPermissive) return { verdict: "violation", kind: "copyleft", license: licenseRaw };
  if (anyPermissive) return { verdict: "ok", license: licenseRaw };
  return { verdict: "violation", kind: "unknown", license: licenseRaw };
}

function isExcepted(name) {
  if (EXCEPTIONS[name]) return true;
  return EXCEPTION_PREFIXES.some((p) => name.startsWith(p));
}

function* iterPackages(nmDir) {
  let entries;
  try { entries = fs.readdirSync(nmDir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (!e.isDirectory() && !e.isSymbolicLink()) continue;
    if (e.name === ".bin" || e.name === ".cache") continue;
    if (e.name.startsWith("@")) {
      // scope dir — descend one level
      const scopeDir = path.join(nmDir, e.name);
      let scoped;
      try { scoped = fs.readdirSync(scopeDir, { withFileTypes: true }); } catch { continue; }
      for (const s of scoped) {
        const pkgJson = path.join(scopeDir, s.name, "package.json");
        const p = readPkg(pkgJson);
        if (p) yield { name: `${e.name}/${s.name}`, pkg: p };
      }
    } else {
      const p = readPkg(path.join(nmDir, e.name, "package.json"));
      if (p) yield { name: e.name, pkg: p };
    }
  }
}

function readPkg(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
}

const violations = [];
const excepted = [];
let scanned = 0;
const seen = new Set();
const rootsPresent = [];

for (const root of ROOTS) {
  if (!fs.existsSync(root.dir)) continue;
  rootsPresent.push(root.name);
  for (const { name, pkg } of iterPackages(root.dir)) {
    const key = `${name}@${pkg.version || "?"}`;
    if (seen.has(key)) continue;
    seen.add(key);
    scanned++;
    const c = classify(name, normLicense(pkg));
    if (c.verdict === "violation") violations.push({ name, root: root.name, ...c });
    else if (c.verdict === "excepted") excepted.push({ name, reason: c.reason });
  }
}

const missingRoots = ROOTS.filter((r) => !rootsPresent.includes(r.name)).map((r) => r.name);

console.log(`[license-scan] scanned ${scanned} unique packages across: ${rootsPresent.join(", ") || "(none)"}`);
if (missingRoots.includes("mobile")) {
  console.log(`[license-scan] NOTE: concord-mobile not installed — its tree was NOT scanned (run \`cd concord-mobile && npm install\` to close the gap).`);
}
if (excepted.length) {
  console.log(`[license-scan] ${excepted.length} accepted exception(s): ${[...new Set(excepted.map((e) => e.name))].join(", ")}`);
}

if (violations.length === 0) {
  console.log("[license-scan] ✓ no license violations.");
  process.exit(0);
}

console.log(`\n[license-scan] ${violations.length} VIOLATION(S):`);
for (const v of violations.slice(0, 100)) {
  console.log(`  ✗ ${v.name} (${v.root}) — ${v.kind}${v.license ? `: ${v.license}` : ""}`);
}

if (CI) {
  console.error(`\n::error::license-scan found ${violations.length} disallowed-license dependency(ies). See docs/LICENSING.md — add a documented EXCEPTION or replace the dep.`);
  process.exit(1);
}
process.exit(0);
