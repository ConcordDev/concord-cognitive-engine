/**
 * S4 (PR #1707): the test-generate contract + the browser test harness.
 *
 * Three layers, all behaviour:
 *  1. validateGeneratedTests — generated output is CODE, gated before
 *     it can render. The A8 probe payload (run-shaped JSON with
 *     embedded stdout) must be rejected, never rendered.
 *  2. The harness itself — buildTestProgram + the node:test /
 *     node:assert shims, executed for real in this test process:
 *     pass/fail counts come from tests that actually ran.
 *  3. runGeneratedTests plumbing — a Worker stub that runs the real
 *     harness in-process, proving the wrapper correlates messages and
 *     returns the counted summary (and nothing when tests can't run).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { validateGeneratedTests } from '@/components/code/testGenContract';
import {
  buildTestProgram,
  createAssertShim,
  createTestShim,
} from '@/components/code/testHarness';
import { runGeneratedTests } from '@/components/code/localExec';

const GOOD_TESTS = [
  "import { test } from 'node:test';",
  "import assert from 'node:assert';",
  "import { add } from './math.js';",
  "test('adds', () => { assert.strictEqual(add(1, 2), 3); });",
].join('\n');

const SOURCE = 'export function add(a, b) { return a + b; }';

// ── 1. The contract ──────────────────────────────────────────────────

describe('validateGeneratedTests', () => {
  it('accepts real node:test code', () => {
    const v = validateGeneratedTests({ tests: GOOD_TESTS, framework: 'node:test' }, 'node:test');
    expect(v.ok).toBe(true);
    if (v.ok) { expect(v.tests).toContain("test('adds'"); expect(v.strippedFences).toBe(false); }
  });

  it('strips markdown fences and says so', () => {
    const v = validateGeneratedTests({ tests: '```js\n' + GOOD_TESTS + '\n```' }, 'node:test');
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.strippedFences).toBe(true);
  });

  it('rejects the A8 shape: run-shaped JSON is discarded, never rendered', () => {
    const a8 = JSON.stringify({ tests: JSON.stringify({ stdout: '✓ 3 passed', passed: 3, failed: 0, exitCode: 0 }) });
    const v = validateGeneratedTests(JSON.parse(a8), 'node:test');
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toMatch(/run-shaped/);
  });

  it('rejects a payload that is itself a results object', () => {
    const v = validateGeneratedTests({ tests: '{"passed": 2, "results": []}' }, 'node:test');
    expect(v.ok).toBe(false);
  });

  it('rejects plain JSON and non-test prose', () => {
    expect(validateGeneratedTests({ tests: '{"name": "x"}' }, 'node:test').ok).toBe(false);
    expect(validateGeneratedTests({ tests: 'Here are some tests you might like!' }, 'node:test').ok).toBe(false);
    expect(validateGeneratedTests({ tests: '   ' }, 'node:test').ok).toBe(false);
    expect(validateGeneratedTests(null, 'node:test').ok).toBe(false);
  });

  it('accepts pytest code and rejects pytest-shaped prose', () => {
    const py = 'def test_add():\n    assert add(1, 2) == 3\n';
    expect(validateGeneratedTests({ tests: py }, 'pytest').ok).toBe(true);
    expect(validateGeneratedTests({ tests: 'def helper():\n    pass\n' }, 'pytest').ok).toBe(false);
  });
});

// ── 2. The harness, executed for real ────────────────────────────────

async function executeProgram(source: string, testCode: string) {
  const built = buildTestProgram(source, testCode);
  if ('error' in built) return { error: built.error, summary: null };
  const shim = createTestShim();
  let summary: unknown = null;
  const fn = new Function(
    'test', 'describe', 'it', 'assert', '__tests', '__reportTests', 'console',
    `"use strict"; return (async () => {\n${built.program}\n})();`,
  ) as (...args: unknown[]) => Promise<unknown>;
  await fn(shim.test, shim.describe, shim.it, createAssertShim(), shim.registry, (s: unknown) => { summary = s; }, console);
  return { error: null, summary: summary as { total: number; passed: number; failed: number; failures: Array<{ name: string; error: string }> } | null };
}

describe('the worker test harness', () => {
  it('counts a passing generated test as passed', async () => {
    const { summary, error } = await executeProgram(SOURCE, GOOD_TESTS);
    expect(error).toBeNull();
    expect(summary).toEqual({ total: 1, passed: 1, failed: 0, failures: [] });
  });

  it('counts a failing assertion as failed, with its message', async () => {
    const bad = GOOD_TESTS.replace('add(1, 2), 3', 'add(1, 2), 4');
    const { summary } = await executeProgram(SOURCE, bad);
    expect(summary?.passed).toBe(0);
    expect(summary?.failed).toBe(1);
    expect(summary?.failures[0].name).toBe('adds');
    expect(summary?.failures[0].error).toMatch(/AssertionError/);
  });

  it('nests describe names and runs CommonJS sources', async () => {
    const cjs = 'function mul(a, b) { return a * b; }\nmodule.exports = { mul };';
    const tests = [
      "const { test } = require('node:test');",
      "const assert = require('node:assert');",
      "const { mul } = require('./math.js');",
      "describe('mul', () => { test('works', () => assert.strictEqual(mul(2, 3), 6)); });",
    ].join('\n');
    const { summary } = await executeProgram(cjs, tests);
    expect(summary?.passed).toBe(1);
    expect(summary?.total).toBe(1);
  });

  it('refuses a source that imports other project files, in words', async () => {
    const built = buildTestProgram("import { x } from './other.js';\nexport const y = x;", GOOD_TESTS);
    expect('error' in built && built.error).toMatch(/one file at a time/);
  });

  it('refuses tests importing modules the harness cannot provide', async () => {
    const built = buildTestProgram(SOURCE, "import fs from 'node:fs';\nimport { test } from 'node:test';\nimport assert from 'node:assert';\ntest('x', () => assert.ok(fs));");
    expect('error' in built).toBe(true);
  });

  it('the assert shim throws on deep inequality and passes on equality', () => {
    const assert = createAssertShim();
    expect(() => assert.deepStrictEqual({ a: [1, 2] }, { a: [1, 2] })).not.toThrow();
    expect(() => assert.deepStrictEqual({ a: [1, 2] }, { a: [1, 3] })).toThrow(/AssertionError/);
    expect(() => assert.strictEqual(1, 2)).toThrow(/AssertionError/);
  });
});

// ── 3. runGeneratedTests plumbing ────────────────────────────────────

class HarnessWorker {
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onerror: ((ev: { message: string }) => void) | null = null;
  terminated = false;

  postMessage(msg: { type: string; id: number; source: string; testCode: string }) {
    const id = msg.id;
    const emit = (data: unknown) => queueMicrotask(() => this.onmessage?.({ data }));
    void executeProgram(msg.source, msg.testCode).then(({ summary, error }) => {
      if (error) { emit({ type: 'stderr', id, text: error + '\n' }); emit({ type: 'done', id, exitCode: 1 }); return; }
      if (summary) emit({ type: 'test-summary', id, summary });
      emit({ type: 'done', id, exitCode: 0 });
    });
  }
  terminate() { this.terminated = true; }
}

const realWorker = globalThis.Worker;
beforeEach(() => { globalThis.Worker = HarnessWorker as unknown as typeof Worker; });
afterEach(() => { globalThis.Worker = realWorker; });

describe('runGeneratedTests', () => {
  it('returns the counted summary from the harness', async () => {
    const { outcome, summary } = await runGeneratedTests({ sourceCode: SOURCE, testCode: GOOD_TESTS, language: 'javascript' });
    expect(outcome.ranLocally).toBe(true);
    expect(summary).toEqual({ total: 1, passed: 1, failed: 0, failures: [] });
  });

  it('returns no summary when the tests cannot run — failure stays an error, not a result', async () => {
    const { outcome, summary } = await runGeneratedTests({
      sourceCode: "import { x } from './other.js';\nexport const y = x;",
      testCode: GOOD_TESTS,
      language: 'javascript',
    });
    expect(summary).toBeNull();
    expect(outcome.result.exitCode).toBe(1);
    expect(outcome.result.stderr).toMatch(/one file at a time/);
  });
});
