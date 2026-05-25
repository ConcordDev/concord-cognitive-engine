#!/usr/bin/env node
// scripts/audit-spec-vs-impl.mjs
//
// For each docs/lens-specs/<lens>.md, classify whether the prose claims
// match what the macros named in the prose actually do. Output a triage
// list with one row per detected mismatch.
//
// Categories:
//   POLLING-WHERE-REALTIME-CLAIMED   — spec says realtime/live/multiplayer
//                                       but handler has no realtime emit
//                                       and the macro name has polling vibes
//   SCHEDULING-WHERE-CLIENT-CLAIMED  — spec says video/call/streaming but
//                                       handler returns metadata + null url
//   CRUD-WHERE-WORKFLOW-CLAIMED      — spec says pipeline/workflow but
//                                       handler is single insert/update
//   STUB-WHERE-INTEGRATION-CLAIMED   — spec names an external API but
//                                       handler has no fetch to its hostname
//
// Reuses scripts/grade-macro-depth.mjs's body extraction + helper index.
// Writes audit/spec-vs-impl.json + audit/spec-vs-impl-mismatches.md.
//
// Run: node scripts/audit-spec-vs-impl.mjs

import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(new URL(import.meta.url).pathname, '..', '..');
const SPECS = path.join(ROOT, 'docs', 'lens-specs');
const SERVER = path.join(ROOT, 'server');

// ---- 1. Build a (domain, macro) → handler-body index from the source ----

function findMatchingClose(src, openIdx) {
  let depth = 0;
  let i = openIdx;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') { i += 2; while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++; i += 2; continue; }
    if (c === '"' || c === "'") { i++; while (i < n && src[i] !== c) { if (src[i] === '\\') i++; i++; } i++; continue; }
    if (c === '`') {
      i++;
      while (i < n && src[i] !== '`') {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === '$' && src[i + 1] === '{') { i += 2; let td = 1; while (i < n && td > 0) { if (src[i] === '{') td++; else if (src[i] === '}') td--; i++; } continue; }
        i++;
      }
      i++; continue;
    }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return i; }
    i++;
  }
  return -1;
}

function extractRegisterBody(src, registerStart) {
  const openParen = src.indexOf('(', registerStart);
  if (openParen < 0) return '';
  // Skip two string args + commas + handler header to find body open brace
  let i = openParen + 1;
  let stringsSeen = 0;
  while (i < src.length && stringsSeen < 2) {
    if (src[i] === '"' || src[i] === "'" || src[i] === '`') {
      const q = src[i]; i++;
      while (i < src.length && src[i] !== q) { if (src[i] === '\\') i++; i++; }
      i++; stringsSeen++;
      continue;
    }
    i++;
  }
  // From here, scan forward to the next `{` that opens the handler body.
  // Skip past arrow params `(args)` first if present.
  while (i < src.length && i < openParen + 1000) {
    if (src[i] === '{') {
      const end = findMatchingClose(src, i);
      if (end > i) return src.slice(i, end + 1);
      return '';
    }
    i++;
  }
  return '';
}

function walkSrc(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.git', 'tests'].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkSrc(p, acc);
    else if (e.name.endsWith('.js')) acc.push(p);
  }
  return acc;
}

console.error('Indexing macro bodies…');
const macroBodies = new Map(); // "domain.macro" → { body, file }
const macroSourceFiles = walkSrc(SERVER);
for (const f of macroSourceFiles) {
  if (f.includes('/node_modules/')) continue;
  const src = fs.readFileSync(f, 'utf8');
  // Find aliases of register/registerLensAction in this file
  const aliases = new Set(['register', 'registerLensAction']);
  for (const m of src.matchAll(/\bconst\s+(\w+)\s*=\s*(?:registerLensAction|register)\b/g)) aliases.add(m[1]);
  const aliasGroup = [...aliases].join('|');
  const re = new RegExp(String.raw`\b(?:` + aliasGroup + String.raw`)\(\s*["'\`]([a-zA-Z0-9_.\-]+)["'\`]\s*,\s*["'\`]([a-zA-Z0-9_.\-]+)["'\`]`, 'g');
  let m;
  while ((m = re.exec(src))) {
    const key = `${m[1]}.${m[2]}`;
    if (macroBodies.has(key)) continue; // first wins
    const body = extractRegisterBody(src, m.index);
    macroBodies.set(key, { body, file: path.relative(ROOT, f), line: src.slice(0, m.index).split('\n').length });
  }
}
console.error(`  ${macroBodies.size} (domain, macro) bodies indexed`);

// ---- 2. Spec parsing ----

const REALTIME_CLAIM_RE = /\b(real[\s-]?time|live[\s-]?share|multiplayer|websocket|streaming|push|crdt|conflict[\s-]?free)\b/i;
const VIDEO_CLAIM_RE = /\b(video[\s-]?(call|visit|chat|tile|client|conference)|webrtc|telehealth|spaces?\s+audio)\b/i;
const WORKFLOW_CLAIM_RE = /\b(pipeline|workflow|multi[\s-]?step|state[\s-]?machine|fulfilment|fulfillment|escalation|approval[\s-]?chain|orchestrat)/i;
const INTEGRATION_CLAIM_RE = /\b(integrat|fhir|stripe|spotify|github|openalex|arxiv|wikipedia|conceptnet|usda|met[\s-]?museum|nasa|api|webhook)\b/i;
const FRONT_TO_BACK_RE = /\bfront[\s-]?to[\s-]?back\b/i;

const REALTIME_BODY_RE = /\b(realtimeEmit|io\.to|REALTIME\?\.io|app\.locals\.io|broadcastTo|emit\s*\(\s*['"`]\w)/;
const POLLING_BODY_RE = /\b(poll|since|cursor|interval|setTimeout|setInterval)\b/i;
const FETCH_EXTERNAL_RE = /await\s+fetch\s*\(\s*['"`]https?:\/\//;
const ROOM_URL_NULL_RE = /roomUrl\s*:\s*null\b/;

function specsList() {
  return fs.readdirSync(SPECS)
    .filter(f => f.endsWith('.md') && f !== 'README.md' && f !== 'all.md')
    .sort();
}

function extractMacroRefs(specText, lensName) {
  // backtick-quoted `domain.macro` patterns
  const refs = new Set();
  for (const m of specText.matchAll(/`([a-z][\w-]*)\.([a-zA-Z_][\w-]*)`/g)) {
    refs.add(`${m[1]}.${m[2]}`);
  }
  // Also: many specs describe features in prose without naming macros.
  // For each Missing-item line that contains a claim keyword, pull every
  // macro from the lens's same-named domain whose name shares a keyword
  // with the line. Catches Live Share, telehealth, collab CRDT, etc.
  const claimLinePat = /^[\s\-*]+\[[\sx]\]\s+`?\[[MLS]\]`?\s+(.+)$/gm;
  const lensDomainMacros = [];
  for (const k of macroBodies.keys()) {
    if (k.startsWith(`${lensName}.`)) lensDomainMacros.push(k);
  }
  for (const m of specText.matchAll(claimLinePat)) {
    const claim = m[1].toLowerCase();
    if (!REALTIME_CLAIM_RE.test(claim) && !VIDEO_CLAIM_RE.test(claim)) continue;
    // Tight keyword match: extract noun-like keywords ≥5 chars and require
    // ≥2 of them to appear in the macro name. Workflow + integration
    // claims are too generic to infer reliably — we only infer for
    // realtime + video claims, which are the high-signal mismatches.
    const claimWords = Array.from(claim.matchAll(/\b([a-z][a-z-]{4,})\b/g)).map(x => x[1])
      .filter(w => !['shipped', 'front', 'back', 'feature', 'editing', 'sharing'].includes(w));
    if (claimWords.length < 2) continue;
    for (const dotMacro of lensDomainMacros) {
      const macroName = dotMacro.split('.')[1].toLowerCase();
      const hits = claimWords.filter(w => macroName.includes(w)).length;
      if (hits >= 2) refs.add(dotMacro);
    }
  }
  return refs;
}

function classifyMismatch(lensName, specText, macroRefs) {
  const mismatches = [];

  // For each macro the spec names, compare its body signals to the spec claims.
  for (const ref of macroRefs) {
    const entry = macroBodies.get(ref);
    if (!entry) continue;
    const body = entry.body || '';

    // Two cases for finding the right claim context:
    //   (1) macro is named in backticks → grab paragraphs that mention it
    //   (2) macro was inferred from a Missing-line keyword match → use the
    //       Missing list + Parity prose as the claim context
    const refRe = new RegExp('`' + ref.replace(/[.\-]/g, '\\$&') + '`');
    let claimText;
    if (refRe.test(specText)) {
      const paragraphs = specText.split(/\n\s*\n/).filter(p => refRe.test(p));
      claimText = paragraphs.join('\n');
    } else {
      // Inferred ref: scope claim to Missing + Parity sections (most claim
      // language lives there).
      const missing = specText.match(/##\s*Missing[\s\S]*?(?=\n##|$)/i)?.[0] || '';
      const parity = specText.match(/##\s*Parity[\s\S]*?(?=\n##|$)/i)?.[0] || '';
      claimText = missing + '\n' + parity;
    }

    const claimsRealtime = REALTIME_CLAIM_RE.test(claimText);
    const claimsVideo = VIDEO_CLAIM_RE.test(claimText);
    const claimsWorkflow = WORKFLOW_CLAIM_RE.test(claimText);
    const claimsIntegration = INTEGRATION_CLAIM_RE.test(claimText);
    const hasFrontToBack = FRONT_TO_BACK_RE.test(claimText);

    const hasRealtimeEmit = REALTIME_BODY_RE.test(body);
    const looksPolling = POLLING_BODY_RE.test(body) && !hasRealtimeEmit;
    const hasExternalFetch = FETCH_EXTERNAL_RE.test(body);
    const hasNullRoomUrl = ROOM_URL_NULL_RE.test(body);
    const bodyLoc = body.split('\n').length;

    if (claimsRealtime && looksPolling && !hasRealtimeEmit) {
      mismatches.push({
        lens: lensName,
        macro: ref,
        file: entry.file,
        line: entry.line,
        category: 'POLLING-WHERE-REALTIME-CLAIMED',
        evidence: { bodyLoc, hasRealtimeEmit, looksPolling, hasFrontToBack },
        suggestion: `Add realtimeEmit to the handler OR downgrade spec prose to describe polling explicitly.`,
      });
    }
    if (claimsVideo && hasNullRoomUrl) {
      mismatches.push({
        lens: lensName,
        macro: ref,
        file: entry.file,
        line: entry.line,
        category: 'SCHEDULING-WHERE-CLIENT-CLAIMED',
        evidence: { hasNullRoomUrl, hasFrontToBack },
        suggestion: `Bundle a WebRTC client (simple-peer / Daily SDK / Twilio) OR downgrade spec prose to "scheduling + external client handoff".`,
      });
    }
    if (claimsIntegration && !hasExternalFetch && bodyLoc < 80) {
      mismatches.push({
        lens: lensName,
        macro: ref,
        file: entry.file,
        line: entry.line,
        category: 'STUB-WHERE-INTEGRATION-CLAIMED',
        evidence: { bodyLoc, hasExternalFetch, hasFrontToBack },
        suggestion: `Implement the integration with await fetch to the API OR downgrade spec prose.`,
      });
    }
    if (claimsWorkflow && bodyLoc < 60 && !body.includes('await runMacro')) {
      mismatches.push({
        lens: lensName,
        macro: ref,
        file: entry.file,
        line: entry.line,
        category: 'CRUD-WHERE-WORKFLOW-CLAIMED',
        evidence: { bodyLoc, hasFrontToBack },
        suggestion: `Implement the multi-step workflow (orchestrate child macros via runMacro) OR downgrade spec prose.`,
      });
    }
  }

  return mismatches;
}

// ---- 3. Run audit ----

const specs = specsList();
console.error(`\nAuditing ${specs.length} spec files…`);
const allMismatches = [];
for (const spec of specs) {
  const lensName = spec.replace(/\.md$/, '');
  const specText = fs.readFileSync(path.join(SPECS, spec), 'utf8');
  const refs = extractMacroRefs(specText, lensName);
  if (refs.size === 0) continue;
  const m = classifyMismatch(lensName, specText, refs);
  allMismatches.push(...m);
}

// Dedupe by (lens, macro, category)
const dedupSet = new Set();
const dedupedMismatches = [];
for (const m of allMismatches) {
  const k = `${m.lens}|${m.macro}|${m.category}`;
  if (dedupSet.has(k)) continue;
  dedupSet.add(k);
  dedupedMismatches.push(m);
}

const byCategory = {};
for (const m of dedupedMismatches) byCategory[m.category] = (byCategory[m.category] || 0) + 1;
const byLens = {};
for (const m of dedupedMismatches) {
  if (!byLens[m.lens]) byLens[m.lens] = [];
  byLens[m.lens].push(m);
}

const output = {
  generatedAt: new Date().toISOString(),
  totals: { specs: specs.length, mismatches: dedupedMismatches.length, byCategory },
  byLens,
  mismatches: dedupedMismatches,
};

fs.mkdirSync(path.join(ROOT, 'audit'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'audit', 'spec-vs-impl.json'), JSON.stringify(output, null, 2));

// Human-scannable markdown
const lines = [];
lines.push('# Spec-vs-Implementation Audit\n');
lines.push(`Generated: ${output.generatedAt}\n`);
lines.push(`Specs scanned: ${specs.length}. Mismatches detected: ${dedupedMismatches.length}.\n`);
lines.push('## By category\n');
for (const [cat, n] of Object.entries(byCategory).sort((a, b) => b[1] - a[1])) {
  lines.push(`- **${cat}**: ${n}`);
}
lines.push('\n## By lens\n');
for (const [lens, ms] of Object.entries(byLens).sort((a, b) => b[1].length - a[1].length)) {
  lines.push(`### ${lens} (${ms.length})\n`);
  for (const m of ms) {
    lines.push(`- \`${m.macro}\` — **${m.category}**  ([\`${m.file}:${m.line}\`](../${m.file}#L${m.line}))`);
    lines.push(`  - ${m.suggestion}`);
  }
  lines.push('');
}
fs.writeFileSync(path.join(ROOT, 'audit', 'spec-vs-impl-mismatches.md'), lines.join('\n'));

console.error(`\nWrote audit/spec-vs-impl.json + audit/spec-vs-impl-mismatches.md`);
console.error(`Total mismatches: ${dedupedMismatches.length}`);
for (const [cat, n] of Object.entries(byCategory).sort((a, b) => b[1] - a[1])) {
  console.error(`  ${cat}: ${n}`);
}
