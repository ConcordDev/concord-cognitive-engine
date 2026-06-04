#!/usr/bin/env node
// scripts/lens-unloaded-domains.mjs
//
// Layer-1.5 of the lens-audit methodology (see docs/LENS_AUDIT_METHODOLOGY.md): the
// deterministic detector for the UNLOADED-DOMAIN facade class — a `server/domains/<X>.js`
// file that registers lens-action macros but is NEVER wired into the runtime, so EVERY
// macro in it returns `unknown_macro` and the lens's whole backend is dead.
//
// This is the most severe facade after the broken wire: not one button, a whole domain.
// It is invisible to the source-based verifiers (verify-lens-backends, lens-broken-calls)
// because the `registerLensAction("X", …)` calls DO exist in source — they just never
// run. Only a live request, or this loader cross-check, exposes it. (Found 2026-06-04:
// genesis/staking/sponsorship/system/code-quality — 64 macros — were all dead this way.)
//
// A domain is LOADED if its module is invoked by one of the two runtime paths:
//   1. `server/domains/index.js` — the `export default [ … ]` array the loader walks
//      (`server.js`: `domainModules.forEach(mod => mod(registerLensAction))`).
//   2. an explicit `import registerXMacros from "./domains/<X>.js"` + call in `server.js`.
// A `server/domains/<X>.js` that registers `registerLensAction("<X>", …)` but is in
// NEITHER path is UNLOADED.
//
//   node scripts/lens-unloaded-domains.mjs            # report
//   node scripts/lens-unloaded-domains.mjs --json
//   node scripts/lens-unloaded-domains.mjs --ci       # exit 1 if any unloaded domain (floor 0)

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DOMAINS = path.join(ROOT, 'server', 'domains');
const rd = (f) => { try { return readFileSync(f, 'utf8'); } catch { return ''; } };
const JSON_OUT = process.argv.includes('--json');
const CI = process.argv.includes('--ci');

const indexSrc = rd(path.join(DOMAINS, 'index.js'));
const serverSrc = rd(path.join(ROOT, 'server', 'server.js'));

const unloaded = [];
for (const file of (existsSync(DOMAINS) ? readdirSync(DOMAINS) : [])) {
  if (!file.endsWith('.js') || file === 'index.js') continue;
  const base = file.replace(/\.js$/, '');
  const src = rd(path.join(DOMAINS, file));
  // Only consider files that register lens-action macros (a real lens-action domain).
  const macroCount = (src.match(/registerLensAction\(\s*["'`][a-zA-Z0-9_-]+["'`]/g) || []).length;
  if (macroCount === 0) continue;
  // Loaded if imported from index.js (the loader array) OR imported in server.js.
  const inIndex = new RegExp(`from\\s+['"]\\./${base}\\.js['"]`).test(indexSrc);
  const inServer = new RegExp(`from\\s+['"]\\./domains/${base}\\.js['"]`).test(serverSrc);
  if (!inIndex && !inServer) unloaded.push({ domain: base, macros: macroCount });
}
unloaded.sort((a, b) => b.macros - a.macros);

if (JSON_OUT) {
  process.stdout.write(JSON.stringify({ generatedAt: new Date().toISOString(), unloadedCount: unloaded.length, unloaded }, null, 2) + '\n');
} else {
  if (unloaded.length === 0) {
    console.log('✓ No unloaded lens-action domains — every server/domains/*.js with macros is wired into the runtime loader.');
  } else {
    console.log(`✗ ${unloaded.length} UNLOADED lens-action domain(s) — registered in source but never invoked, so every macro 404s:\n`);
    for (const u of unloaded) console.log(`  ${u.domain.padEnd(20)} ${u.macros} macros — add to server/domains/index.js (or import in server.js)`);
    console.log('\nThe whole backend of these lenses is dead at runtime. See docs/LENS_AUDIT_METHODOLOGY.md (Layer 1.5, unloaded-domain detector).');
  }
}

if (CI && unloaded.length > 0) {
  console.error(`\n::error::Unloaded-domain gate: ${unloaded.length} domain(s) register lens-action macros but are not wired into the runtime loader (every macro returns unknown_macro). Add to server/domains/index.js.`);
  process.exit(1);
}
