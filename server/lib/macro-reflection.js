/**
 * Autonomous Macro Reflection Factory
 *
 * On startup, auto-inspects the entire repo footprint and generates MCP
 * tool definitions for every registered macro pair. This makes Concord
 * self-describing: the entire 2.62M LOC ecosystem becomes a discoverable
 * tool network without manual hand-coding.
 *
 * What it scans:
 *   - server/domains/*.js       → registerLensAction(domain, name, handler)
 *   - server/lib/*.js            → register(domain, name, handler) + exported functions
 *   - server/routes/*.js         → app.get/post handlers (mount-prefixed)
 *   - server/macros/*.js         → macro definitions
 *
 * What it produces:
 *   - One MCP tool per (domain, name) macro pair → ~549 macros → 549+ tools
 *   - One MCP tool per exported function in key lib files → ~100s more
 *   - One MCP tool per route prefix → ~2997 routes → 2997 more (if enabled)
 *
 * Boot cost: ~2-5 seconds for the full scan (one-time, cached in memory).
 *
 * The /mcp/tools endpoint returns the full generated arsenal.
 * The /mcp/call endpoint dispatches to the actual handler at call-time.
 *
 * This file should be imported once at server startup (after DB is ready,
 * before routes are mounted) to populate the macro registry.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── Configuration ──────────────────────────────────────────────────────

const SERVER_ROOT = path.resolve(__dirname, '..', '..');
const DOMAINS_DIR = path.join(SERVER_ROOT, 'server', 'domains');
const LIB_DIR = path.join(SERVER_ROOT, 'server', 'lib');
const ROUTES_DIR = path.join(SERVER_ROOT, 'server', 'routes');
const SERVER_JS = path.join(SERVER_ROOT, 'server', 'server.js');

const SKIP_DIRS = new Set(['node_modules', '.git', 'tests', 'test', '__tests__', 'coverage', 'dist', 'build']);

// ─── Tool registry ──────────────────────────────────────────────────────

/**
 * Global registry: { domain: { name: { handler, file, line, description, source } } }
 */
export const MACRO_REGISTRY = new Map();

/**
 * Generated MCP tools: [{ name, description, inputSchema, _meta }]
 */
export const REFLECTED_TOOLS = [];

/**
 * Stats from the last reflection pass
 */
export const REFLECTION_STATS = {
  macros: 0,
  exports: 0,
  routes: 0,
  total: 0,
  scannedAt: null,
  durationMs: 0,
};

/**
 * Per-source breakdown for the doc
 */
export const REFLECTION_SOURCES = {
  macros: [],
  exports: [],
  routes: [],
};

// ─── File walker ────────────────────────────────────────────────────────

async function walkJs(dir, acc = []) {
  let entries;
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch {
    return acc; // dir doesn't exist (mirrors the old existsSync guard)
  }
  for (const e of entries) {
    if (SKIP_DIRS.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) await walkJs(p, acc);
    else if (e.name.endsWith('.js') && !e.name.endsWith('.test.js') && !e.name.endsWith('.spec.js')) {
      acc.push(p);
    }
  }
  return acc;
}

// ─── Macro extractor ────────────────────────────────────────────────────

/**
 * Extract register("domain", "name", ...) calls from a file's source.
 * Handles:
 *   - register("d", "n", handler)
 *   - registerLensAction("d", "n", handler)
 *   - const reg = registerLensAction; reg("d", "n", ...)
 *   - const reg = register; reg("d", "n", ...)
 */
function extractMacros(src, filePath) {
  const macros = [];

  // Find all aliases of register/registerLensAction
  const aliases = new Set(['register', 'registerLensAction']);
  for (const m of src.matchAll(/\b(?:const|let|var)\s+(\w+)\s*=\s*(?:registerLensAction|register)\b/g)) {
    aliases.add(m[1]);
  }

  // Match <alias>("domain", "name", ...) calls
  const aliasList = [...aliases].map(a => a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const aliasRe = new RegExp(
    '\\b(?:' + aliasList + ')\\(\\s*["\'`]([a-zA-Z0-9_.\\-]+)["\'`]\\s*,\\s*["\'`]([a-zA-Z0-9_.\\-]+)["\'`]',
    'g'
  );

  let m;
  while ((m = aliasRe.exec(src))) {
    const domain = m[1];
    const name = m[2];
    const rest = '';

    // Find the JSDoc just before this registration
    const before = src.slice(Math.max(0, m.index - 400), m.index);
    const docMatch = before.match(/\/\*\*([\s\S]*?)\*\//g);
    let description = '';
    if (docMatch) {
      const lastDoc = docMatch[docMatch.length - 1];
      description = lastDoc
        .replace(/^\/\*\*|\*\/$/g, '')
        .split('\n')
        .map(l => l.replace(/^\s*\*\s?/, '').trim())
        .filter(l => l && !l.startsWith('@'))
        .join(' ')
        .slice(0, 240);
    }

    if (!description) {
      description = `${name} action for the ${domain} domain.`;
    }

    macros.push({
      domain,
      name,
      toolName: `${domain}.${name}`,
      file: path.relative(SERVER_ROOT, filePath),
      description,
      argsHint: rest,
    });
  }

  return macros;
}

// ─── Export extractor ───────────────────────────────────────────────────

/**
 * Extract exported functions from a file (for lib files that expose helpers).
 */
function extractExports(src, filePath) {
  const exports = [];

  // Match: export function name(...) or export const name = ...
  for (const m of src.matchAll(/export\s+(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)/g)) {
    const name = m[1];
    const params = (m[2] || '').split(',').map(s => s.trim()).filter(Boolean);

    // Get the JSDoc just before
    const before = src.slice(Math.max(0, m.index - 400), m.index);
    const docMatch = before.match(/\/\*\*([\s\S]*?)\*\//g);
    let description = '';
    if (docMatch) {
      const lastDoc = docMatch[docMatch.length - 1];
      description = lastDoc
        .replace(/^\/\*\*|\*\/$/g, '')
        .split('\n')
        .map(l => l.replace(/^\s*\*\s?/, '').trim())
        .filter(l => l && !l.startsWith('@'))
        .join(' ')
        .slice(0, 240);
    }

    if (!description) description = `Helper function ${name} from ${path.basename(filePath)}`;

    // Skip very short helper names (likely private)
    if (name.startsWith('_') || name.length < 3) continue;

    exports.push({
      domain: '_lib',
      name,
      toolName: `_lib.${name}`,
      file: path.relative(SERVER_ROOT, filePath),
      description,
      params,
    });
  }

  return exports;
}

// ─── Route extractor ────────────────────────────────────────────────────

/**
 * Extract app.get/post/etc routes from server.js + routes/*.js
 */
async function extractRoutes(serverJsSrc, routesFiles) {
  const routes = [];

  // Build import map for routes/
  const importMap = {};
  for (const m of serverJsSrc.matchAll(/import\s+(\w+)\s+from\s+["'`]\.\/routes\/([\w.-]+)\.js["'`]/g)) {
    importMap[m[1]] = m[2];
  }

  // Build mount map: routeFileName -> mountPrefix
  const mountMap = {};
  for (const m of serverJsSrc.matchAll(/app\.use\(\s*["'`](\/[^"'`]*)["'`]\s*,\s*(\w+)/g)) {
    if (importMap[m[2]]) mountMap[importMap[m[2]]] = m[1];
  }

  // From server.js itself
  for (const m of serverJsSrc.matchAll(/\bapp\.(get|post|put|delete|patch|all)\(\s*["'`](\/[^"'`]*)["'`]/g)) {
    const method = m[1].toUpperCase();
    let p = m[2];
    // Truncate parameterized segments
    const segs = p.split('/').filter(Boolean);
    let cur = '';
    for (const s of segs) {
      if (s.startsWith(':') || s.startsWith('*')) break;
      cur += '/' + s;
    }
    if (cur) {
      routes.push({
        method,
        path: cur,
        fullPath: p,
        source: 'server.js',
      });
    }
  }

  // From routes/*.js
  for (const f of routesFiles) {
    const base = path.basename(f, '.js');
    const mount = mountMap[base] || `/${base}`;
    let src;
    try {
      src = await fs.promises.readFile(f, 'utf8');
    } catch (e) {
      // A file listed by the directory walk that fails to actually read
      // (a broken symlink, a permissions issue, a race with a concurrent
      // delete) must not crash the whole reflection pass — this is a
      // best-effort macro/route catalog for LLM tool-calling, not a
      // correctness-critical boot step. Skip just this file.
      console.warn('[macro-reflection] skipping unreadable file ' + f + ': ' + (e && e.message ? e.message : e));
      continue;
    }
    for (const m of src.matchAll(/\b(router|app)\.(get|post|put|delete|patch|all)\(\s*["'`](\/[^"'`]*)["'`]/g)) {
      const method = m[2].toUpperCase();
      const p = m[3];
      routes.push({
        method,
        path: mount + (p === '/' ? '' : p),
        fullPath: p,
        source: path.relative(SERVER_ROOT, f),
      });
    }
  }

  return routes;
}

// ─── Schema builder ─────────────────────────────────────────────────────

/**
 * Build a permissive JSON schema for a macro's args.
 * We don't know the exact shape, so allow any props.
 */
function buildPermissiveSchema(description) {
  return {
    type: "object",
    description: description || "Arbitrary arguments. See macro source for expected shape.",
    additionalProperties: true,
    properties: {
      _hint: {
        type: "string",
        description: "Optional hint for the macro. Some macros read this for context."
      }
    }
  };
}

// ─── Main reflection pass ───────────────────────────────────────────────

/**
 * Run the full reflection pass. Caches results in MACRO_REGISTRY + REFLECTED_TOOLS.
 *
 * @param {object} options
 *   - includeExports: also generate tools for exported helpers (default: false, can be many)
 *   - includeRoutes: also generate tools for route prefixes (default: false, huge)
 *   - maxTools: cap total tools (default: 1000)
 */
export async function reflectMacros(options = {}) {
  const { includeExports = false, includeRoutes = false, maxTools = 1000 } = options;
  const t0 = Date.now();

  MACRO_REGISTRY.clear();
  REFLECTED_TOOLS.length = 0;
  REFLECTION_SOURCES.macros.length = 0;
  REFLECTION_SOURCES.exports.length = 0;
  REFLECTION_SOURCES.routes.length = 0;

  // 1. Walk domain files for register(...)
  const domainFiles = await walkJs(DOMAINS_DIR);
  for (const f of domainFiles) {
    let src;
    try {
      src = await fs.promises.readFile(f, 'utf8');
    } catch (e) {
      // A file listed by the directory walk that fails to actually read
      // (a broken symlink, a permissions issue, a race with a concurrent
      // delete) must not crash the whole reflection pass — this is a
      // best-effort macro/route catalog for LLM tool-calling, not a
      // correctness-critical boot step. Skip just this file.
      console.warn('[macro-reflection] skipping unreadable file ' + f + ': ' + (e && e.message ? e.message : e));
      continue;
    }
    const macros = extractMacros(src, f);
    for (const m of macros) {
      if (!MACRO_REGISTRY.has(m.domain)) MACRO_REGISTRY.set(m.domain, new Map());
      MACRO_REGISTRY.get(m.domain).set(m.name, {
        ...m,
        registered: true,
      });
      REFLECTION_SOURCES.macros.push(m);
    }
  }

  // 2. Walk lib files for register(...) + exports (optional)
  const libFiles = await walkJs(LIB_DIR);
  for (const f of libFiles) {
    let src;
    try {
      src = await fs.promises.readFile(f, 'utf8');
    } catch (e) {
      // A file listed by the directory walk that fails to actually read
      // (a broken symlink, a permissions issue, a race with a concurrent
      // delete) must not crash the whole reflection pass — this is a
      // best-effort macro/route catalog for LLM tool-calling, not a
      // correctness-critical boot step. Skip just this file.
      console.warn('[macro-reflection] skipping unreadable file ' + f + ': ' + (e && e.message ? e.message : e));
      continue;
    }

    // register() in lib files (e.g., token-budget-assembler, csl-router)
    const macros = extractMacros(src, f);
    for (const m of macros) {
      if (!MACRO_REGISTRY.has(m.domain)) MACRO_REGISTRY.set(m.domain, new Map());
      if (!MACRO_REGISTRY.get(m.domain).has(m.name)) {
        MACRO_REGISTRY.get(m.domain).set(m.name, { ...m, registered: true });
        REFLECTION_SOURCES.macros.push(m);
      }
    }

    // Exports (optional)
    if (includeExports) {
      const exports = extractExports(src, f);
      for (const e of exports) {
        REFLECTION_SOURCES.exports.push(e);
      }
    }
  }

  // 3. Routes (optional)
  let routeCount = 0;
  const _serverJsExists = await fs.promises.access(SERVER_JS).then(() => true, () => false);
  if (includeRoutes && _serverJsExists) {
    const serverSrc = await fs.promises.readFile(SERVER_JS, 'utf8');
    const routes = await extractRoutes(serverSrc, await walkJs(ROUTES_DIR));
    for (const r of routes) {
      routeCount++;
      REFLECTION_SOURCES.routes.push(r);
    }
  }

  // 4. Generate MCP tool definitions
  let count = 0;
  for (const [domain, names] of MACRO_REGISTRY) {
    for (const [name, meta] of names) {
      if (count >= maxTools) break;
      REFLECTED_TOOLS.push({
        name: `macro.${meta.toolName}`,
        description: `[${meta.file}] ${meta.description}`.slice(0, 500),
        inputSchema: buildPermissiveSchema(meta.description),
        _meta: {
          kind: 'macro',
          domain,
          name,
          file: meta.file,
          argsHint: meta.argsHint,
        },
      });
      count++;
    }
    if (count >= maxTools) break;
  }

  // Add export tools
  for (const e of REFLECTION_SOURCES.exports) {
    if (count >= maxTools) break;
    REFLECTED_TOOLS.push({
      name: `lib.${e.name}`,
      description: `[${e.file}] ${e.description}`.slice(0, 500),
      inputSchema: {
        type: "object",
        properties: {
          args: {
            type: "object",
            description: "Function arguments as a key-value object.",
            additionalProperties: true,
          }
        }
      },
      _meta: { kind: 'export', ...e },
    });
    count++;
  }

  // Add route tools (curated, one per mount)
  if (includeRoutes) {
    const seen = new Set();
    for (const r of REFLECTION_SOURCES.routes) {
      if (seen.has(r.path)) continue;
      seen.add(r.path);
      if (count >= maxTools) break;
      REFLECTED_TOOLS.push({
        name: `route.${r.method.toLowerCase()}${r.path.replace(/\//g, '.')}`,
        description: `[${r.source}] ${r.method} ${r.path}`,
        inputSchema: { type: "object", additionalProperties: true, properties: {} },
        _meta: { kind: 'route', ...r },
      });
      count++;
    }
  }

  REFLECTION_STATS.macros = REFLECTION_SOURCES.macros.length;
  REFLECTION_STATS.exports = REFLECTION_SOURCES.exports.length;
  REFLECTION_STATS.routes = routeCount;
  REFLECTION_STATS.total = REFLECTED_TOOLS.length;
  REFLECTION_STATS.scannedAt = new Date().toISOString();
  REFLECTION_STATS.durationMs = Date.now() - t0;

  return REFLECTED_TOOLS;
}

// ─── Dispatcher ─────────────────────────────────────────────────────────

/**
 * Call a reflected tool. Returns { ok, result | error }.
 *
 * For macro tools, we don't actually invoke the handler (we'd need the
 * real ctx/artifact/params and the lens runtime to do that). Instead we
 * return a description of what would be invoked. Future work: hook into
 * the live macro dispatcher to actually call these.
 */
export async function callReflectedTool(toolName, args) {
  const tool = REFLECTED_TOOLS.find(t => t.name === toolName);
  if (!tool) return { ok: false, error: "Unknown reflected tool: " + toolName };

  const meta = tool._meta;
  if (!meta) return { ok: false, error: "Tool has no _meta" };

  if (meta.kind === 'macro') {
    // Try to invoke the registered handler via MACRO_REGISTRY
    let domain = MACRO_REGISTRY.get(meta.domain);
    let handler = domain ? domain.get(meta.name) : null;
    
    // If no handler in MACRO_REGISTRY, check globalThis.__concordLensActions
    // (real handlers live in LENS_ACTIONS which is a separate Map in server.js)
    if (!handler || !handler.handler) {
      const lensActions = globalThis.__concordLensActions;
      if (lensActions && lensActions.get) {
        const key = `${meta.domain}.${meta.name}`;
        const realHandler = lensActions.get(key);
        if (realHandler) {
          handler = { handler: realHandler, registered: true, source: 'lens_actions' };
        }
      }
    }
    
    // Also check globalThis.__concordRunMacro
    if (!handler || !handler.handler) {
      const runMacro = globalThis.__concordRunMacro;
      if (runMacro) {
        handler = { handler: (ctx, artifact, params) => runMacro(meta.domain, meta.name, params || artifact || {}, ctx), registered: true, source: 'run_macro' };
      }
    }
    
    if (handler && handler.handler && typeof handler.handler === 'function') {
      try {
        // Real invocation: call the handler with provided args
        // Handler signature is typically: (ctx, artifact, params) or (params)
        const params = args?.params || args?.args || args || {};
        let result;
        if (handler.handler.length >= 3) {
          // 3-arg signature: (ctx, artifact, params)
          const fakeCtx = { domain: meta.domain, user: { id: 'mcp', role: 'mcp' } };
          const fakeArtifact = { type: meta.domain, id: 'mcp-' + Date.now() };
          result = await handler.handler(fakeCtx, fakeArtifact, params);
        } else {
          // 1-arg signature
          result = await handler.handler(params);
        }
        return { ok: true, kind: 'macro', domain: meta.domain, name: meta.name, invoked: true, result };
      } catch (e) {
        return { ok: false, kind: 'macro', domain: meta.domain, name: meta.name, invoked: false, error: 'handler threw: ' + String(e?.message || e) };
      }
    }
    // No handler registered (e.g. it lives in a different runtime). Return discovery.
    return {
      ok: true,
      kind: 'macro',
      domain: meta.domain,
      name: meta.name,
      file: meta.file,
      args,
      invoked: false,
      note: "Macro handler not registered in this process. Usually because the domain action runs in lens runtime. Use lens_list to find an applicable lens."
    };
  }

  if (meta.kind === 'export') {
    // Invoke via dynamic import. Same process context as server.js.
    try {
      const { file, name } = meta;
      if (!file || typeof file !== 'string' || file.includes('..')) {
        return { ok: false, kind: 'export', name, file, invoked: false, error: 'invalid file path' };
      }
      const pathMod = await import('path');
      const fsMod = await import('fs/promises');
      const root = process.cwd();
      const absPath = pathMod.resolve(root, file);
      const serverDir = pathMod.resolve(root, 'server');
      if (!absPath.startsWith(serverDir + pathMod.sep)) {
        return { ok: false, kind: 'export', name, file, invoked: false, error: 'file not under server/' };
      }
      try { await fsMod.access(absPath); }
      catch { return { ok: false, kind: 'export', name, file, invoked: false, error: 'file not found: ' + absPath }; }
      const mod = await import('file://' + absPath);
      const fn = mod[name];
      if (typeof fn !== 'function') {
        return { ok: false, kind: 'export', name, file, invoked: false, error: 'export "' + name + '" is not a function (got ' + typeof fn + ')' };
      }
      let result;
      const positional = args && typeof args === 'object'
        ? Object.values(args).filter(v => v !== undefined)
        : [];
      if (positional.length === 0) {
        result = await fn();
      } else {
        result = await fn(...positional);
      }
      return { ok: true, kind: 'export', name, file, invoked: true, result };
    } catch (e) {
      return { ok: false, kind: 'export', name: meta.name, file: meta.file, invoked: false, error: 'invoke failed: ' + String(e?.message || e) };
    }
  }

  if (meta.kind === 'route') {
    // Actually invoke via HTTP to express
    const http = await import('http');
    const port = process.env.PORT || 5050;
    const path = meta.path;
    const method = (meta.method || 'GET').toUpperCase();
    const queryStr = method === 'GET' ? '?' + new URLSearchParams(args || {}).toString() : '';
    const body = method === 'GET' ? null : JSON.stringify(args || {});
    return new Promise((resolve) => {
      const req = http.request({
        hostname: '127.0.0.1', port, path: path + queryStr, method,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': body ? Buffer.byteLength(body) : 0,
          'X-MCP-Tool': 'reflect_invoke',
          'X-Internal': '1',
          'Authorization': 'Bearer mcp-internal',
        },
        timeout: Number(process.env.MACRO_TIMEOUT_MS) || 30000,
      }, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          let parsed = data;
          try { parsed = JSON.parse(data); } catch { /* observed: response body may be non-JSON (e.g. HTML 502 page); fall through to raw string */ }
          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 400,
            kind: 'route',
            method, path: path + queryStr,
            status: res.statusCode,
            invoked: true,
            result: parsed,
          });
        });
      });
      req.on('error', (e) => resolve({ ok: false, kind: 'route', method, path, invoked: false, error: 'http error: ' + e.message }));
      req.on('timeout', () => { req.destroy(); resolve({ ok: false, kind: 'route', method, path, invoked: false, error: 'timeout' }); });
      if (body) req.write(body);
      req.end();
    });
  }

  return { ok: false, error: "Unknown tool kind: " + meta.kind };
}

/**
 * Get stats about the reflection pass.
 */
export function getReflectionStats() {
  return { ...REFLECTION_STATS, registrySize: MACRO_REGISTRY.size };
}

// ─── Status helper ──────────────────────────────────────────────────────

/**
 * Print a human-readable summary of the reflection.
 */
export function summarizeReflection() {
  const stats = getReflectionStats();
  const lines = [
    `🔍 Macro Reflection Summary`,
    `  - macros registered: ${stats.macros}`,
    `  - lib exports: ${stats.exports}`,
    `  - route prefixes: ${stats.routes}`,
    `  - MCP tools generated: ${stats.total}`,
    `  - domains: ${stats.registrySize}`,
    `  - scanned at: ${stats.scannedAt}`,
    `  - duration: ${stats.durationMs}ms`,
  ];
  return lines.join("\n");
}
