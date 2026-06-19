// @sync-fs-ok: audit/cartographer tooling, never the server runtime. Sync fs in this file is intentional and not on the user request path (audited 2026-06).
// server/lib/route-inventory.js
//
// Static-parse every HTTP route registration in server.js + routes/*.js
// so /admin/endpoints can render the complete map of backend buttons
// with their auth posture.
//
// We do not introspect the live Express stack — too much of the
// codebase mounts routers (`app.use('/api/foo', router)`) where the
// inner routes register with relative paths. Source parsing keeps the
// `(method, fullPath, file, line)` tuple intact, including for routers
// that haven't been instantiated when the inventory builds.
//
// Auth classification is a heuristic over three signals:
//   - publicReadPaths / _safeReadPaths prefix match → 'public'
//   - requireAuth / requireRole on the same line → 'required'
//   - everything else → 'gated' (passes other middleware checks but
//     not an obvious explicit guard).
//
// The classification is intentionally honest — public/required come
// from real code, 'gated' means "we couldn't statically prove either
// way." The /admin/endpoints UI's Test button is the ground truth.

import fs from 'node:fs';
import path from 'node:path';

const METHOD_REGEX = /(app|router)\.(get|post|put|delete|patch|options|head|all)\s*\(\s*(['"`])([^'"`]+)\3/g;
const USE_PREFIX_REGEX = /app\.use\s*\(\s*(['"`])(\/api\/[a-z0-9_/-]+)\1/g;

function readFileSafe(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch { return null; }
}

function listRouteFiles(routesDir) {
  try {
    return fs.readdirSync(routesDir)
      .filter(f => f.endsWith('.js'))
      .map(f => path.join(routesDir, f));
  } catch { return []; }
}

function lineNumberAt(text, index) {
  let n = 1;
  for (let i = 0; i < index && i < text.length; i++) {
    if (text.charCodeAt(i) === 10) n++;
  }
  return n;
}

// Parse a single file. If a mountPrefix is given (router mounted under
// '/api/foo'), router-relative paths get the prefix prepended.
function parseFile(filePath, mountPrefix = null) {
  const text = readFileSafe(filePath);
  if (!text) return [];
  const fileLabel = path.relative(path.resolve(filePath, '../..'), filePath);
  const results = [];
  let m;
  METHOD_REGEX.lastIndex = 0;
  while ((m = METHOD_REGEX.exec(text)) !== null) {
    const target = m[1]; // 'app' or 'router'
    const method = m[2].toUpperCase();
    const rawPath = m[4];
    if (method === 'ALL') continue;
    if (target === 'router' && !mountPrefix) {
      results.push({ method, path: rawPath, file: fileLabel, line: lineNumberAt(text, m.index), kind: 'router_relative' });
      continue;
    }
    let full = rawPath;
    if (target === 'router' && mountPrefix) {
      if (rawPath.startsWith('/')) full = mountPrefix.replace(/\/+$/, '') + rawPath;
      else full = mountPrefix.replace(/\/+$/, '') + '/' + rawPath;
    }
    results.push({ method, path: full, file: fileLabel, line: lineNumberAt(text, m.index), kind: target });
  }
  return results;
}

// Match a route's mount-prefix by scanning server.js for
// `app.use('/api/foo', createBarRouter(...))` and pairing it with
// `server/routes/bar.js` heuristically by filename token overlap.
function buildPrefixMap(serverText, routeFiles) {
  // Capture mount-prefix → factory-name pairs.
  const factoryToPrefix = new Map();
  const factoryRegex = /app\.use\s*\(\s*(['"`])(\/api\/[a-z0-9_/-]+)\1\s*,\s*(?:require\([^)]+\)\([^)]*\)|[a-zA-Z_$][\w$]*\s*\([^)]*\))/g;
  let m;
  while ((m = factoryRegex.exec(serverText)) !== null) {
    const prefix = m[2];
    // Pull the factory-name out of the slice after the second arg start.
    const sliceStart = m.index + m[0].length - 1; // last char of match
    const tailWindow = serverText.slice(m.index, m.index + 400);
    const nameMatch = tailWindow.match(/,\s*(?:require\(['"]([^'"]+)['"]\)\([^)]*\)|([a-zA-Z_$][\w$]*)\s*\()/);
    if (nameMatch) {
      const token = (nameMatch[1] || nameMatch[2] || '').toLowerCase();
      if (token) factoryToPrefix.set(token, prefix);
    }
  }

  // Pair each route file with the most-likely prefix.
  const prefixForFile = new Map();
  for (const file of routeFiles) {
    const base = path.basename(file, '.js').toLowerCase().replace(/[-_]/g, '');
    let chosen = null;
    for (const [factory, prefix] of factoryToPrefix) {
      const tokens = factory.replace(/(create|router|routes)/g, '').toLowerCase();
      const baseStripped = base.replace(/routes?$/, '').replace(/router$/, '');
      if (!tokens) continue;
      if (tokens.includes(baseStripped) || baseStripped.includes(tokens)) {
        chosen = prefix;
        break;
      }
    }
    // Fallback: try matching by basename literally against the prefix's last segment.
    if (!chosen) {
      for (const [, prefix] of factoryToPrefix) {
        const lastSeg = prefix.split('/').filter(Boolean).pop() || '';
        if (lastSeg.replace(/-/g, '') === base.replace(/-/g, '')) {
          chosen = prefix; break;
        }
      }
    }
    prefixForFile.set(file, chosen);
  }
  return prefixForFile;
}

// Extract the publicReadPaths + _safeReadPaths arrays from server.js by
// scanning for the constant declarations and parsing string literals.
function extractAllowlists(serverText) {
  function pullArray(name) {
    const re = new RegExp(`const\\s+${name}\\s*=\\s*\\[`, 'g');
    const m = re.exec(serverText);
    if (!m) return [];
    let i = m.index + m[0].length;
    let depth = 1;
    let buf = '';
    while (i < serverText.length && depth > 0) {
      const ch = serverText[i];
      if (ch === '[') depth++;
      else if (ch === ']') { depth--; if (depth === 0) break; }
      buf += ch; i++;
    }
    const result = [];
    const lit = /["']([^"']+)["']/g;
    let lm;
    while ((lm = lit.exec(buf)) !== null) result.push(lm[1]);
    return result;
  }
  return {
    publicReadPaths: pullArray('publicReadPaths'),
    safeReadPaths: pullArray('_safeReadPaths'),
  };
}

// Re-read the source line that registered the route so we can detect
// inline `requireAuth` / `requireRole` middleware. The source text is
// passed in (already loaded) and `line` is 1-indexed.
function authForLine(sourceText, lineNumber) {
  const lines = sourceText.split('\n');
  // Look at the registration line + up to 2 following lines (middleware
  // often spans). 1-indexed → array index = lineNumber - 1.
  const start = Math.max(0, lineNumber - 1);
  const window = lines.slice(start, start + 4).join('\n');
  if (/\brequireRole\s*\(/.test(window)) return 'required_role';
  if (/\brequireAuth\b/.test(window)) return 'required';
  return null;
}

function classifyAuth(method, fullPath, inlineAuth, allowlists) {
  if (inlineAuth) return inlineAuth === 'required_role' ? 'required' : 'required';
  if (method === 'GET' || method === 'HEAD') {
    const match = (arr) => arr.some(p => fullPath === p || fullPath.startsWith(p + '/'));
    if (match(allowlists.publicReadPaths) || match(allowlists.safeReadPaths)) return 'public';
  }
  return 'gated';
}

let CACHE = null;

export function buildRouteInventory({ serverPath, routesDir, force = false } = {}) {
  if (CACHE && !force) return CACHE;
  const resolvedServer = serverPath || path.resolve(process.cwd(), 'server.js');
  const resolvedRoutesDir = routesDir || path.resolve(process.cwd(), 'routes');
  const serverText = readFileSafe(resolvedServer) || '';
  const routeFiles = listRouteFiles(resolvedRoutesDir);

  const allowlists = extractAllowlists(serverText);
  const prefixMap = buildPrefixMap(serverText, routeFiles);

  const all = [];

  // 1) Direct app.METHOD(...) in server.js.
  const serverRoutes = parseFile(resolvedServer, null).filter(r => r.kind === 'app');
  for (const r of serverRoutes) {
    const inline = authForLine(serverText, r.line);
    all.push({
      method: r.method,
      path: r.path,
      file: r.file,
      line: r.line,
      auth: classifyAuth(r.method, r.path, inline, allowlists),
    });
  }

  // 2) Each route file with its detected mount prefix.
  for (const file of routeFiles) {
    const prefix = prefixMap.get(file);
    const text = readFileSafe(file) || '';
    const rows = parseFile(file, prefix);
    for (const r of rows) {
      const inline = authForLine(text, r.line);
      all.push({
        method: r.method,
        path: r.path,
        file: r.file,
        line: r.line,
        auth: classifyAuth(r.method, r.path, inline, allowlists),
        mountPrefixDetected: !!prefix,
      });
    }
  }

  // Sort: by base path then method then line.
  all.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method) || a.line - b.line);

  const counters = {
    total: all.length,
    public: all.filter(r => r.auth === 'public').length,
    required: all.filter(r => r.auth === 'required').length,
    gated: all.filter(r => r.auth === 'gated').length,
    byMethod: all.reduce((acc, r) => { acc[r.method] = (acc[r.method] || 0) + 1; return acc; }, {}),
  };

  CACHE = { endpoints: all, counters, generatedAt: Date.now() };
  return CACHE;
}

export function clearRouteInventoryCache() {
  CACHE = null;
}
