/**
 * The browser test harness (S4, PR #1707) — program assembly + shims.
 *
 * Generated tests target `node:test` (the framework test-generate is
 * asked for), which does not exist in a browser. This module rewrites
 * a generated test file + the file under test into ONE program the
 * local worker can execute against small `node:test` / `node:assert`
 * compatible shims, and the worker reports the real outcome. Nothing
 * here invents a result: the summary is counted from tests that
 * actually ran, by the runner loop at the end of the program.
 *
 * Honest limits, surfaced as run errors rather than papered over:
 * - One file under test. If it imports other project files, the build
 *   refuses with that reason (the harness cannot resolve them).
 * - Imports of node:test / node:assert and of the file under test are
 *   rewritten to the shims / the captured exports; anything else the
 *   tests import fails the run with its real error.
 * - The assert shim covers the subset generated tests use: ok, equal,
 *   notEqual, strictEqual, notStrictEqual, deepStrictEqual, throws,
 *   rejects, match, fail, ifError.
 */

export interface TestFailure { name: string; error: string }
export interface TestSummary {
  total: number;
  passed: number;
  failed: number;
  failures: TestFailure[];
}

// ── assert shim ──────────────────────────────────────────────────────

function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  if (typeof a === 'object') {
    const ka = Object.keys(a as object);
    const kb = Object.keys(b as object);
    if (ka.length !== kb.length) return false;
    return ka.every((k) => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
  }
  return false;
}

function show(v: unknown): string {
  try { return typeof v === 'string' ? JSON.stringify(v) : String(JSON.stringify(v) ?? v); }
  catch { return String(v); }
}

export function createAssertShim() {
  const fail = (message: string): never => { throw new Error(`AssertionError: ${message}`); };
  return {
    ok: (v: unknown, m?: string) => { if (!v) fail(m || `expected a truthy value, got ${show(v)}`); },
    equal: (a: unknown, b: unknown, m?: string) => { if (!(a == b)) fail(m || `expected ${show(a)} == ${show(b)}`); }, // eslint-disable-line eqeqeq
    notEqual: (a: unknown, b: unknown, m?: string) => { if (!(a != b)) fail(m || `expected ${show(a)} != ${show(b)}`); }, // eslint-disable-line eqeqeq
    strictEqual: (a: unknown, b: unknown, m?: string) => { if (!Object.is(a, b)) fail(m || `expected ${show(a)} to strictly equal ${show(b)}`); },
    notStrictEqual: (a: unknown, b: unknown, m?: string) => { if (Object.is(a, b)) fail(m || `expected values to differ, both were ${show(a)}`); },
    deepStrictEqual: (a: unknown, b: unknown, m?: string) => { if (!deepEqual(a, b)) fail(m || `expected deep equality: ${show(a)} vs ${show(b)}`); },
    deepEqual: (a: unknown, b: unknown, m?: string) => { if (!deepEqual(a, b)) fail(m || `expected deep equality: ${show(a)} vs ${show(b)}`); },
    throws: (fn: () => unknown, m?: string) => {
      try { fn(); } catch { return; }
      fail(m || 'expected the function to throw');
    },
    rejects: async (p: Promise<unknown> | (() => Promise<unknown>), m?: string) => {
      try { await (typeof p === 'function' ? p() : p); } catch { return; }
      fail(m || 'expected the promise to reject');
    },
    match: (s: string, re: RegExp, m?: string) => { if (!re.test(String(s))) fail(m || `expected ${show(s)} to match ${re}`); },
    fail: (m?: string) => fail(m || 'explicit failure'),
    ifError: (v: unknown) => { if (v) fail(`expected no error, got ${show(v)}`); },
  };
}

// ── test/describe shim ───────────────────────────────────────────────

export interface RegisteredTest { name: string; fn: () => unknown }

export function createTestShim() {
  const registry: RegisteredTest[] = [];
  const prefixStack: string[] = [];
  const test = (name: string, fn: () => unknown) => {
    registry.push({ name: [...prefixStack, String(name)].join(' › '), fn });
  };
  const describe = (name: string, fn: () => void) => {
    prefixStack.push(String(name));
    try { fn(); } finally { prefixStack.pop(); }
  };
  return { registry, test, describe, it: test };
}

// ── rewriting ────────────────────────────────────────────────────────

const NODE_BUILTIN_IMPORT = /^\s*import\s+(?:[^'"]*\s+from\s+)?['"](?:node:)?(?:test|assert)['"];?\s*$/gm;
const NODE_BUILTIN_REQUIRE = /^\s*(?:const|let|var)\s+(?:\{[^}]*\}|[\w$]+)\s*=\s*require\(\s*['"](?:node:)?(?:test|assert)['"]\s*\);?\s*$/gm;
const RELATIVE_IMPORT_FROM = /^\s*import\s+([^'"]*?)\s+from\s+['"]\.[^'"]*['"];?\s*$/gm;
const RELATIVE_REQUIRE = /(?:const|let|var)\s+(\{[^}]*\}|[\w$]+)\s*=\s*require\(\s*['"]\.[^'"]*['"]\s*\)/g;
const ANY_IMPORT_LINE = /^\s*import\s/m;

export function rewriteTestImports(testCode: string): string {
  let out = testCode.replace(NODE_BUILTIN_IMPORT, '').replace(NODE_BUILTIN_REQUIRE, '');
  out = out.replace(RELATIVE_IMPORT_FROM, (_m, clause: string) => {
    const c = clause.trim();
    if (c.startsWith('{')) return `const ${c.replace(/\bas\b/g, ':')} = __source;`;
    if (c.startsWith('*')) return `const ${c.replace(/^\*\s+as\s+/, '')} = __source;`;
    const named = c.match(/^([\w$]+)\s*,\s*(\{[^}]*\})$/);
    if (named) return `const ${named[1]} = (__source.default ?? __source);\nconst ${named[2].replace(/\bas\b/g, ':')} = __source;`;
    return `const ${c} = (__source.default ?? __source);`;
  });
  out = out.replace(RELATIVE_REQUIRE, (_m, clause: string) => {
    const c = clause.trim();
    if (c.startsWith('{')) return `const ${c} = __source`;
    return `const ${c} = __source`;
  });
  return out;
}

export function rewriteSourceModule(sourceCode: string): { code: string } | { error: string } {
  if (/^\s*import\s+[^'"]*['"]\.[^'"]*['"]/m.test(sourceCode) || /require\(\s*['"]\.[^'"]*['"]\s*\)/.test(sourceCode)) {
    return { error: 'This file imports other project files, and the browser test harness runs one file at a time — those imports cannot be resolved here.' };
  }
  const named: string[] = [];
  let out = sourceCode;
  out = out.replace(/^\s*import\s+(?:[^'"]*\s+from\s+)?['"][^'"]+['"];?\s*$/gm, '');
  out = out.replace(/^(\s*)export\s+default\s+function\s+([\w$]+)/gm, (_m, sp: string, name: string) => { named.push(name); return `${sp}function ${name}`; });
  out = out.replace(/^(\s*)export\s+default\s+/gm, '$1__sourceModule.exports.default = ');
  out = out.replace(/^(\s*)export\s+(async\s+function|function|class|const|let|var)\s+([\w$]+)/gm, (_m, sp: string, _kw: string, name: string) => { named.push(name); return `${sp}${_kw} ${name}`; });
  out = out.replace(/^\s*export\s*\{[^}]*\};?\s*$/gm, (stmt) => {
    const inner = stmt.replace(/^\s*export\s*\{/, '').replace(/\};?\s*$/, '');
    return inner.split(',').map((part) => {
      const p = part.trim();
      if (!p) return '';
      const as = p.match(/^([\w$]+)\s+as\s+([\w$]+)$/);
      return as ? `__sourceModule.exports.${as[2]} = ${as[1]};` : `__sourceModule.exports.${p} = ${p};`;
    }).join('\n');
  });
  const tail = named.map((n) => `__sourceModule.exports.${n} = ${n};`).join('\n');
  return { code: `${out}\n${tail}` };
}

/**
 * Assemble the single program the worker executes. The worker binds
 * test / describe / it / assert / __tests / __reportTests / console as
 * parameters; this body registers the tests, then runs them in order
 * and reports the counted summary. Parse or build problems throw —
 * the worker renders the real error, and no summary is produced.
 */
export function buildTestProgram(
  sourceCode: string,
  testCode: string,
): { program: string } | { error: string } {
  const src = rewriteSourceModule(sourceCode);
  if ('error' in src) return src;
  const tests = rewriteTestImports(testCode);
  if (ANY_IMPORT_LINE.test(tests)) {
    return { error: 'The generated tests import a module the browser harness cannot provide (only node:test, node:assert, and the file under test are available).' };
  }
  const program = [
    'const __sourceModule = { exports: {} };',
    '(function (module, exports) {',
    src.code,
    '})(__sourceModule, __sourceModule.exports);',
    'const __source = __sourceModule.exports;',
    tests,
    'const __results = [];',
    'for (const __t of __tests) {',
    '  try { await __t.fn(); __results.push({ name: __t.name, ok: true }); }',
    '  catch (__e) { __results.push({ name: __t.name, ok: false, error: String((__e && __e.message) || __e) }); }',
    '}',
    '__reportTests({ total: __tests.length, passed: __results.filter((r) => r.ok).length, failed: __results.filter((r) => !r.ok).length, failures: __results.filter((r) => !r.ok).map((r) => ({ name: r.name, error: r.error || "" })) });',
  ].join('\n');
  return { program };
}
