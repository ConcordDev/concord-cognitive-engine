#!/usr/bin/env node
// scripts/check-licenses.js
//
// Sprint 18 — license compliance gate. Reads license-checker JSON on
// stdin, compares against allowlist/denylist in argv[1]. Exits non-zero
// on any denied license; warns on unknown licenses.

const fs = require('node:fs');
const path = require('node:path');

const allowlistPath = process.argv[2];
if (!allowlistPath || !fs.existsSync(allowlistPath)) {
  console.error('usage: license-checker --production --json | check-licenses.js <allowlist.json>');
  process.exit(1);
}

const allowlist = JSON.parse(fs.readFileSync(allowlistPath, 'utf8'));
const allowed = new Set(allowlist.allowed);
const denied = new Set(allowlist.denied);

let input = '';
process.stdin.on('data', (c) => input += c);
process.stdin.on('end', () => {
  let pkgs;
  try { pkgs = JSON.parse(input); }
  catch (e) { console.error('parse error:', e.message); process.exit(2); }

  const violations = [];
  const warnings = [];

  for (const [pkg, info] of Object.entries(pkgs)) {
    const licenseField = info.licenses || info.license || '';
    // license-checker returns an array if multiple licenses; flatten.
    const licenses = Array.isArray(licenseField) ? licenseField : [String(licenseField)];
    for (const lic of licenses) {
      const norm = String(lic).trim();
      if (!norm) continue;
      if (denied.has(norm)) {
        violations.push({ pkg, license: norm });
      } else if (!allowed.has(norm)) {
        warnings.push({ pkg, license: norm });
      }
    }
  }

  console.log(`Scanned ${Object.keys(pkgs).length} packages.`);
  if (warnings.length > 0) {
    console.log(`\n${warnings.length} unknown licenses (manual review):`);
    for (const w of warnings.slice(0, 50)) console.log(`  ⚠ ${w.pkg}: ${w.license}`);
    if (warnings.length > 50) console.log(`  …(${warnings.length - 50} more)`);
  }
  if (violations.length > 0) {
    console.log(`\n✗ ${violations.length} DENIED licenses (will block build):`);
    for (const v of violations) console.log(`  ✗ ${v.pkg}: ${v.license}`);
    process.exit(1);
  }
  console.log(`\n✓ No denied licenses found.`);
});
