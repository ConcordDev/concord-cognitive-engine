#!/usr/bin/env node
// scripts/lens-broken-calls.mjs
//
// Layer-1.5 of the lens-audit methodology (see docs/LENS_AUDIT_METHODOLOGY.md):
// the deterministic detector for the BROKEN-WIRE facade class — a frontend call to
// a macro that DOES NOT EXIST. This is the purest, highest-severity facade: a button
// the user clicks that 404s because `runMacro(domain, action, …)` finds no handler
// (e.g. research.generate — the lens "Analyze" button POSTed it but no macro was
// registered, so it silently failed). Unlike the depth scorecard (which sees deep
// backend + deep frontend and says "parity-candidate"), this catches the wire that
// connects them being severed.
//
// It cross-references two literal sets, both extracted from code:
//   • REGISTERED  — every `register(LensAction)?("<dom>","<act>", …)` across server/
//   • CALLED      — every frontend `lensRun('<dom>','<act>'…)` / `runDomain(…)` /
//                   `{ domain:'<dom>', action|name:'<act>' }` literal pair
// A CALLED pair whose <dom> is a real macro domain but whose <dom>.<act> is not
// REGISTERED is a broken wire.
//
// HONEST CAVEATS:
//   • Literal-only. Calls with a computed action (`action: someVar`) can't be checked
//     and are skipped — so this UNDER-reports (a clean, low-false-positive signal).
//   • A handful of hits may be REST-route shims (the frontend posts to /api/lens/run
//     but a route elsewhere serves it) or dynamically-registered macros the literal
//     grep misses. VERIFY each: grep the action tree-wide and read the call site for a
//     fallback before declaring it broken. In practice the false-positive rate is low.
//   • Fix = register a real macro (preferred, with a deterministic + opt-in-LLM body
//     per the literature-review convention) OR repoint the call to the right macro/route.
//
//   node scripts/lens-broken-calls.mjs           # table
//   node scripts/lens-broken-calls.mjs --json

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERVER = path.join(ROOT, 'server');
const FE = path.join(ROOT, 'concord-frontend');
const JSON_OUT = process.argv.includes('--json');
const rd = (f) => { try { return readFileSync(f, 'utf8'); } catch { return ''; } };

function walk(d, ext, acc = []) {
  if (!existsSync(d)) return acc;
  let es; try { es = readdirSync(d, { withFileTypes: true }); } catch { return acc; }
  for (const e of es) {
    if (['node_modules', '.git', 'tests', '.next'].includes(e.name)) continue;
    const p = path.join(d, e.name);
    try { if (e.isDirectory()) walk(p, ext, acc); else if (ext.test(e.name) && existsSync(p)) acc.push(p); } catch { /* skip */ }
  }
  return acc;
}

// REGISTERED macros: dom.act (honor per-file `const reg = registerLensAction` aliases).
const reg = new Set();
for (const f of walk(SERVER, /\.js$/)) {
  const s = rd(f);
  const aliases = new Set(['register', 'registerLensAction']);
  for (const m of s.matchAll(/\bconst\s+(\w+)\s*=\s*(?:registerLensAction|register)\b/g)) aliases.add(m[1]);
  const re = new RegExp('\\b(?:' + [...aliases].join('|') + ')\\(\\s*["\'`]([a-zA-Z0-9_.-]+)["\'`]\\s*,\\s*["\'`]([a-zA-Z0-9_.-]+)["\'`]', 'g');
  let m; while ((m = re.exec(s))) reg.add(m[1] + '.' + m[2]);
}
const domains = new Set([...reg].map(x => x.split('.')[0]));

// CALLED literal pairs in the frontend.
const calls = new Map(); // dom.act -> Set(files)
const add = (d, a, f) => { const k = d + '.' + a; if (!calls.has(k)) calls.set(k, new Set()); calls.get(k).add(path.relative(FE, f)); };
for (const f of walk(FE, /\.(tsx?|jsx?)$/)) {
  const s = rd(f);
  // (1) Explicit domain+action literals: lensRun('dom','act') / {domain:'dom', action:'act'}.
  for (const m of s.matchAll(/\b(?:lensRun|runDomain)\(\s*["'`]([a-z0-9_-]+)["'`]\s*,\s*["'`]([a-zA-Z0-9_-]+)["'`]/g)) add(m[1], m[2], f);
  for (const m of s.matchAll(/domain:\s*["'`]([a-z0-9_-]+)["'`]\s*,\s*(?:action|name):\s*["'`]([a-zA-Z0-9_-]+)["'`]/g)) add(m[1], m[2], f);
  // (2) Hook-bound-domain pattern: the domain is bound in `useRunArtifact('dom')`
  //     (or useLensData/useRunArtifact<T>('dom')) and actions are dispatched via a
  //     wrapper — `handleAction('act')` / `runAction('act')` / `action: 'act'`. The
  //     call site has NO domain literal, so pattern (1) misses it. Only fire when the
  //     file binds EXACTLY ONE domain this way (otherwise the action↔domain pairing is
  //     ambiguous). This is what surfaced the retail/food snake_case→camelCase breaks.
  const bound = new Set();
  for (const m of s.matchAll(/\buse(?:RunArtifact|LensData)(?:<[^>]*>)?\(\s*["'`]([a-z0-9_-]+)["'`]/g)) bound.add(m[1]);
  if (bound.size === 1) {
    const dom = [...bound][0];
    if (!domains.has(dom)) continue;
    const acts = new Set();
    for (const m of s.matchAll(/\b[A-Za-z]*[Aa]ction\(\s*["'`]([a-zA-Z0-9_-]+)["'`]/g)) acts.add(m[1]); // handleAction('x'), runAction('x'), doAction('x')
    for (const a of acts) add(dom, a, f);
  }
}

// `<domain>.analyze` and bare `*generate*` actions with no registered handler are a
// DELIBERATE convention: the lens.run dispatch routes unregistered actions to the
// utility brain (the "AI analyze / generate this artifact" button). 27 lenses share
// the `.analyze` button. Tag these as likely-intentional so the count reflects
// genuine broken wires, not the convention.
const isAiCatchall = (act) => act === 'analyze' || /(^|[-_])generate([-_]|$)/i.test(act) || act === 'generate';

const broken = [];
for (const [k, files] of calls) {
  const dom = k.split('.')[0];
  if (!domains.has(dom)) continue;           // not a macro domain — skip (REST-only)
  if (!reg.has(k)) broken.push({ macro: k, callers: files.size, firstSeen: [...files][0], aiCatchall: isAiCatchall(k.split('.').slice(1).join('.')) });
}
broken.sort((a, b) => a.macro.localeCompare(b.macro));
const genuine = broken.filter(b => !b.aiCatchall);
const catchall = broken.filter(b => b.aiCatchall);

if (JSON_OUT) {
  process.stdout.write(JSON.stringify({ generatedAt: new Date().toISOString(), registered: reg.size, domains: domains.size, genuineCount: genuine.length, aiCatchallCount: catchall.length, broken }, null, 2) + '\n');
} else {
  console.log(`Broken frontend→macro wires — ${broken.length} call(s) to UNREGISTERED macros`);
  console.log(`  ${genuine.length} genuine (likely real bug) · ${catchall.length} likely-intentional AI-catch-all (.analyze / *generate*)`);
  console.log(`(${reg.size} registered macros across ${domains.size} domains)\n`);
  console.log(`${'macro (domain.action)'.padEnd(40)} caller`);
  console.log('─'.repeat(78));
  for (const b of genuine) console.log(`${b.macro.padEnd(40)} ${b.firstSeen}`);
  if (catchall.length) {
    console.log(`\n  …plus ${catchall.length} likely-intentional AI-catch-all (not listed; the lens.run dispatch routes`);
    console.log(`  these unregistered .analyze/*generate* actions to the utility brain by design).`);
  }
  console.log('\n⚠ Verify each before fixing: grep the action tree-wide + read the call site for a');
  console.log('  fallback (a few may be REST-route shims). Fix = register a real macro or repoint.');
  console.log('  See docs/LENS_AUDIT_METHODOLOGY.md (Layer 1.5, broken-wire detector).');
}

// Ratchet gate: `--ci [ceiling]` fails the build if the GENUINE broken-wire count
// exceeds the ceiling (default GENUINE_CEILING) — so a new broken button can't merge,
// while the existing backlog is grandfathered. Drive the ceiling DOWN as wires get
// fixed (it can only tighten). The AI-catch-all convention is excluded by design.
const GENUINE_CEILING = 16; // ratchets down; -12 at Batch E (government dashboard substrate macros)
if (process.argv.includes('--ci')) {
  const i = process.argv.indexOf('--ci');
  const ceiling = Number(process.argv[i + 1]) >= 0 ? Number(process.argv[i + 1]) : GENUINE_CEILING;
  if (genuine.length > ceiling) {
    console.error(`\n::error::Broken-wire gate: ${genuine.length} genuine broken frontend→macro wires > ceiling ${ceiling}. A new lens button calls an unregistered macro — register it, repoint it, or (if intentional AI-catch-all) name it *analyze/*generate. New genuine wires above:`);
    for (const b of genuine) console.error(`  ${b.macro}  (${b.firstSeen})`);
    process.exit(1);
  }
  console.log(`\n✓ Broken-wire gate: ${genuine.length} genuine ≤ ceiling ${ceiling}.`);
}

