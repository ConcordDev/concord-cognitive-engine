import fs from 'fs';
import path from 'path';
const ROOT = '/home/user/concord-cognitive-engine';
const SERVER = path.join(ROOT, 'server');
const LENSDIR = path.join(ROOT, 'concord-frontend/app/lenses');

function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.git', 'tests', 'test'].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (e.name.endsWith('.js')) acc.push(p);
  }
  return acc;
}
const serverFiles = walk(SERVER);

// ---- 1. macro domains: registerLensAction("d","n") and register("d","n") ----
// Some domain files (e.g. server/domains/personas.js, settings.js) bind an
// alias `const reg = registerLensAction` and then call `reg("d","n", ...)`.
// Detect those aliases per-file and treat them as registration sites too —
// without this, the alias-using domains look unregistered and the lenses
// that call them get PARTIAL verdicts (e.g. `personas` lens).
const macroDomains = new Set();
for (const f of serverFiles) {
  const src = fs.readFileSync(f, 'utf8');
  // Build a per-file set of identifiers that alias register / registerLensAction.
  const aliases = new Set(['register', 'registerLensAction']);
  for (const m of src.matchAll(/\bconst\s+(\w+)\s*=\s*(?:registerLensAction|register)\b/g)) {
    aliases.add(m[1]);
  }
  const aliasRe = new RegExp(
    String.raw`\b(?:` + [...aliases].join('|') + String.raw`)\(\s*["'\`]([a-zA-Z0-9_.\-]+)["'\`]\s*,\s*["'\`]([a-zA-Z0-9_.\-]+)["'\`]`,
    'g'
  );
  let m;
  while ((m = aliasRe.exec(src))) macroDomains.add(m[1]);
}

// ---- 2. REST routes with mount mapping ----
const serverJs = fs.readFileSync(path.join(SERVER, 'server.js'), 'utf8');
// import X from './routes/Y.js'
const importMap = {};
for (const m of serverJs.matchAll(/import\s+(\w+)\s+from\s+["'`]\.\/routes\/([\w.-]+)\.js["'`]/g))
  importMap[m[1]] = m[2];
// app.use('/api/..', X)
const mountMap = {};
for (const m of serverJs.matchAll(/app\.use\(\s*["'`](\/[^"'`]*)["'`]\s*,\s*(\w+)/g))
  if (importMap[m[2]]) mountMap[importMap[m[2]]] = m[1];

const routeSet = new Set();
function addRoute(p) {
  const segs = p.split('/').filter(Boolean);
  let cur = '';
  for (const s of segs) { if (s.startsWith(':') || s.startsWith('*')) break; cur += '/' + s; routeSet.add(cur); }
}
// server.js own routes (full paths)
for (const m of serverJs.matchAll(/\bapp\.(get|post|put|delete|patch|all)\(\s*["'`](\/[^"'`]*)["'`]/g)) addRoute(m[2]);
// every app.use mount is itself a resolvable prefix
for (const m of serverJs.matchAll(/app\.use\(\s*["'`](\/[^"'`]*)["'`]/g)) addRoute(m[1]);
// routes/*.js — prepend mount
for (const f of serverFiles) {
  if (!f.includes('/routes/')) continue;
  const base = path.basename(f, '.js');
  const mount = mountMap[base] || '';
  const src = fs.readFileSync(f, 'utf8');
  for (const m of src.matchAll(/\b(?:router|app)\.(get|post|put|delete|patch|all)\(\s*["'`](\/[^"'`]*)["'`]/g))
    addRoute((mount + m[2]).replace(/\/+/g, '/'));
}
// Other top-level server files that mount their own /api/* routes via
// `app.METHOD()` (e.g. server/guidance.js). These don't sit under routes/
// but still register first-class endpoints — without this pass they look
// like dead paths to the verifier.
for (const f of serverFiles) {
  if (f.includes('/routes/') || f.endsWith('/server.js')) continue;
  const src = fs.readFileSync(f, 'utf8');
  for (const m of src.matchAll(/\bapp\.(get|post|put|delete|patch|all)\(\s*["'`](\/api\/[^"'`]*)["'`]/g))
    addRoute(m[2]);
}

// ---- 3. per-lens analysis ----
const lenses = fs.readdirSync(LENSDIR, { withFileTypes: true })
  .filter(e => e.isDirectory() && !e.name.startsWith('[')).map(e => e.name).sort();

// Scan a tsx/ts file + its directly-imported `@/...` siblings (one level)
// for backend calls. Without recursion the verifier misses every lens that
// delegates the API call to a child component — the dominant pattern.
const FRONTEND = path.join(ROOT, 'concord-frontend');
function readIfExists(p) { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } }
function resolveImport(alias) {
  // @/foo/bar -> concord-frontend/foo/bar.tsx | bar.ts | bar/*.tsx
  const rel = alias.replace(/^@\//, '');
  const abs = path.join(FRONTEND, rel);
  const candidates = [`${abs}.tsx`, `${abs}.ts`];
  for (const c of candidates) if (fs.existsSync(c)) return [c];
  if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) {
    return fs.readdirSync(abs).filter(f => /\.tsx?$/.test(f)).map(f => path.join(abs, f));
  }
  return [];
}

// Detection regexes — fixed to handle TypeScript generics (`lensRun<T>(...)`)
// and `api.get('/path')` / `apiClient.get('/path')` style calls. Without
// these the verifier under-detects badly: e.g. `lensRun<SearchResult>(...)`
// in app/lenses/sessions/page.tsx doesn't match `\blensRun\(`.
// `callMacro` and `runMacro` are intentionally excluded — several components
// define local `callMacro(action, input)` / `runMacro(action, input)` helpers
// that pre-bind the domain and take just the macro name. Treating that first
// arg as a domain produces false positives. Only `runDomain` (apiHelpers.lens)
// and `lensRun` (@/lib/api/client) canonically take (domain, action) order.
const MACRO_CALL_RE = /\b(?:runDomain|lensRun)(?:<[^>(]*>)?\(\s*["'`]([a-zA-Z0-9_.\-]+)["'`]/g;
const GENERIC_HOOK_RE = /useLensData\(|useRunArtifact\(|useLensArtifact\(/;
const API_PATH_RE = /["'`](\/api\/[a-zA-Z0-9/_.\-]*)/g;
// `api.get('/path')`, `api.post('/path', ...)`, `apiClient.get(...)` etc.
const API_CLIENT_RE = /\b(?:api|apiClient)\.(?:get|post|put|delete|patch)\(\s*["'`](\/api\/[a-zA-Z0-9/_.\-]*)/g;

function scanFile(src) {
  const calledDomains = new Set();
  const apiPaths = new Set();
  for (const m of src.matchAll(MACRO_CALL_RE)) calledDomains.add(m[1]);
  for (const m of src.matchAll(API_PATH_RE)) apiPaths.add(m[1].replace(/\/+$/, ''));
  for (const m of src.matchAll(API_CLIENT_RE)) apiPaths.add(m[1].replace(/\/+$/, ''));
  return { calledDomains, apiPaths, usesGeneric: GENERIC_HOOK_RE.test(src) };
}

function scanPageWithChildren(pageSrc, pagePath) {
  const acc = scanFile(pageSrc);
  // Pull @/components/<lens>/* style imports and merge their backend calls
  // (one level deep — children's children handle themselves at their own
  // mount sites; deeper recursion produces noise without finding more).
  for (const m of pageSrc.matchAll(/from\s+["'`](@\/[a-zA-Z0-9/_.\-]+)["'`]/g)) {
    // Only recurse into lens-specific component dirs (`@/components/<name>/`).
    // Skip:
    //  - `@/components/lens/` shared shell scaffolding (RecentMineCard, etc.)
    //  - `@/lib/api/client` — a known-good API surface; recursing pulls in
    //    every helper's path string and produces false positives
    //  - hooks, utils, providers — orthogonal infra
    if (!/^@\/components\//.test(m[1])) continue;
    if (/^@\/components\/lens\//.test(m[1])) continue;
    for (const child of resolveImport(m[1])) {
      const cs = scanFile(readIfExists(child));
      for (const d of cs.calledDomains) acc.calledDomains.add(d);
      for (const p of cs.apiPaths) acc.apiPaths.add(p);
      acc.usesGeneric ||= cs.usesGeneric;
    }
  }
  // Detect direct named-helper usage from @/lib/api/client (`api.foo()`,
  // `apiHelpers.bar()`, `morningBrief()` etc.) without recursing into the
  // client file. The mere presence of the import is sufficient signal that
  // the lens calls a server endpoint — false positives here are rare; false
  // negatives are common without it.
  if (/from\s+["'`]@\/lib\/api\/client["'`]/.test(pageSrc)) acc.usesGeneric = true;
  return acc;
}

const rows = [];
for (const lens of lenses) {
  const pf = path.join(LENSDIR, lens, 'page.tsx');
  if (!fs.existsSync(pf)) { rows.push({ lens, verdict: 'NO-PAGE', detail: '' }); continue; }
  const src = fs.readFileSync(pf, 'utf8');
  const { calledDomains, apiPaths, usesGeneric } = scanPageWithChildren(src, pf);

  const badDomains = [...calledDomains].filter(d => !macroDomains.has(d));
  const badApis = [...apiPaths].filter(p => {
    const segs = p.split('/').filter(Boolean);
    for (let n = segs.length; n >= 2; n--) {
      if (routeSet.has('/' + segs.slice(0, n).join('/'))) return false;
    }
    return true;
  });
  const hasBackend = usesGeneric || calledDomains.size > 0 || apiPaths.size > 0;
  let verdict;
  if (!hasBackend) verdict = 'NO-BACKEND-CALL';
  else if (badDomains.length && !usesGeneric && (calledDomains.size && [...calledDomains].every(d=>!macroDomains.has(d))) && apiPaths.size===0) verdict = 'UNWIRED';
  else if (badDomains.length || badApis.length) verdict = 'PARTIAL';
  else verdict = 'WIRED';
  rows.push({ lens, verdict,
    detail: [badDomains.length ? 'macro?:' + badDomains.join(',') : '', badApis.length ? 'api?:' + badApis.join(' ') : ''].filter(Boolean).join('  ') });
}

const by = {};
for (const r of rows) by[r.verdict] = (by[r.verdict] || 0) + 1;
console.log('=== macro domains registered:', macroDomains.size, ' route prefixes:', routeSet.size, '===');
console.log('=== verdicts:', JSON.stringify(by), 'total', rows.length, '===\n');
for (const r of rows) if (r.verdict !== 'WIRED') console.log(`${r.verdict.padEnd(16)} ${r.lens.padEnd(22)} ${r.detail}`);
fs.writeFileSync('/tmp/lens-verify.json', JSON.stringify(rows, null, 1));
// Machine-readable summary for CI gates (the stdout above is a
// human-readable table, not JSON — gates must parse this file).
fs.writeFileSync('/tmp/lens-verify-summary.json', JSON.stringify({ verdicts: by, total: rows.length }, null, 1));
