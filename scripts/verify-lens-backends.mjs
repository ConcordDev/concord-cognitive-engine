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
const macroDomains = new Set();
for (const f of serverFiles) {
  const src = fs.readFileSync(f, 'utf8');
  let m;
  const re = /\b(?:registerLensAction|register)\(\s*["'`]([a-zA-Z0-9_.\-]+)["'`]\s*,\s*["'`]([a-zA-Z0-9_.\-]+)["'`]/g;
  while ((m = re.exec(src))) macroDomains.add(m[1]);
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

// ---- 3. per-lens analysis ----
const lenses = fs.readdirSync(LENSDIR, { withFileTypes: true })
  .filter(e => e.isDirectory() && !e.name.startsWith('[')).map(e => e.name).sort();

const rows = [];
for (const lens of lenses) {
  const pf = path.join(LENSDIR, lens, 'page.tsx');
  if (!fs.existsSync(pf)) { rows.push({ lens, verdict: 'NO-PAGE', detail: '' }); continue; }
  const src = fs.readFileSync(pf, 'utf8');
  const usesGeneric = /useLensData\(|useRunArtifact\(|useLensArtifact\(/.test(src);
  // macro calls: fn('domain', 'name')
  const calledDomains = new Set();
  for (const m of src.matchAll(/\b(?:runDomain|runMacro|lensRun|macro|callMacro)\(\s*["'`]([a-zA-Z0-9_.\-]+)["'`]/g))
    calledDomains.add(m[1]);
  for (const m of src.matchAll(/runDomain\(\s*["'`]([a-zA-Z0-9_.\-]+)["'`]/g)) calledDomains.add(m[1]);
  // api paths
  const apiPaths = new Set();
  for (const m of src.matchAll(/["'`](\/api\/[a-zA-Z0-9/_.\-]*)/g)) apiPaths.add(m[1].replace(/\/+$/, ''));

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
