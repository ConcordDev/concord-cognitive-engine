/**
 * The test-generate contract (S4, PR #1707).
 *
 * `code.test-generate` is generation-only: a brain reads source and
 * writes test CODE. It executes nothing and returns no results. This
 * module is the only door between that macro's output and the screen,
 * and it enforces the contract the A8 probe established the hard way
 * (Pass 1: the brain returned run-shaped JSON — stdout embedded in the
 * payload — and the surface rendered it as if a run had happened):
 *
 * - The payload must carry test code as a string. Run-shaped JSON
 *   (stdout / exitCode / pass counts / a results array) is REJECTED
 *   with a user-word reason, never rendered — not as tests, and
 *   certainly not as results.
 * - The code must plausibly be tests for the requested framework
 *   (test cases + assertions present), or it is rejected.
 * - Markdown fences are stripped and noted; nothing else is rewritten.
 * - This module knows nothing about pass/fail. Results exist only
 *   after the worker harness actually executes the tests
 *   (localExec.runGeneratedTests), and they render in a separate,
 *   clearly-labelled results block — never inside this contract's
 *   GENERATED container.
 */

export type GeneratedTestsValidation =
  | { ok: true; tests: string; framework: string; strippedFences: boolean }
  | { ok: false; reason: string };

const RUN_SHAPED_KEYS = ['stdout', 'stderr', 'exitcode', 'exit_code', 'passed', 'failed', 'results', 'summary', 'testsrun', 'tests_run'];

function looksRunShaped(value: unknown, depth = 0): boolean {
  if (!value || typeof value !== 'object' || depth > 2) return false;
  const keys = Object.keys(value as Record<string, unknown>).map((k) => k.toLowerCase());
  if (keys.some((k) => RUN_SHAPED_KEYS.includes(k))) return true;
  return Object.values(value as Record<string, unknown>).some((v) => looksRunShaped(v, depth + 1));
}

export function validateGeneratedTests(
  rawResult: unknown,
  requestedFramework: string,
): GeneratedTestsValidation {
  const result = rawResult && typeof rawResult === 'object' ? (rawResult as Record<string, unknown>) : null;
  const rawTests = typeof result?.tests === 'string' ? result.tests : '';
  if (!rawTests.trim()) {
    return { ok: false, reason: 'The generator returned no test code. Nothing was saved or run.' };
  }

  let tests = rawTests.trim();
  let strippedFences = false;
  if (tests.startsWith('```')) {
    const lines = tests.split('\n');
    lines.shift();
    if (lines.length > 0 && lines[lines.length - 1].trim().startsWith('```')) lines.pop();
    tests = lines.join('\n').trim();
    strippedFences = true;
  }

  // The A8 shape: the whole payload is JSON. JSON is not test code,
  // and run-shaped JSON is a simulated result — reject both, in words
  // that say which happened.
  if (tests.startsWith('{') || tests.startsWith('[')) {
    let parsed: unknown = null;
    try { parsed = JSON.parse(tests); } catch { parsed = null; }
    if (parsed !== null) {
      if (looksRunShaped(parsed)) {
        return {
          ok: false,
          reason: 'The generator returned run-shaped output (results, not test code). It was discarded: generated tests are code, and results only ever come from actually running them here. Nothing was saved or run.',
        };
      }
      return { ok: false, reason: 'The generator returned JSON, not test code. Nothing was saved or run.' };
    }
    return { ok: false, reason: 'The generator returned text that is not test code. Nothing was saved or run.' };
  }

  const framework = String(result?.framework || requestedFramework || '').trim() || requestedFramework;
  const fw = framework.toLowerCase();
  const hasCases = /(\btest\s*\()|(\bit\s*\()|(\bdescribe\s*\()|(def\s+test_)/.test(tests);
  const hasAsserts = /assert/.test(tests);
  if (fw.includes('pytest')) {
    if (!/def\s+test_/.test(tests) || !hasAsserts) {
      return { ok: false, reason: 'The generated text does not look like pytest tests (no test_ functions with assertions). Nothing was saved or run.' };
    }
  } else if (!hasCases || !hasAsserts) {
    return { ok: false, reason: `The generated text does not look like ${framework} tests (no test cases with assertions). Nothing was saved or run.` };
  }

  return { ok: true, tests, framework, strippedFences };
}
