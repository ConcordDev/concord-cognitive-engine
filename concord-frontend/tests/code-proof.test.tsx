/**
 * Proof (the Code lens): the strip shows only what the ledger says, push is
 * gated on the server's own verdict, and the browser runner reports exactly
 * what ran against the fingerprint it ran on.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { Ledger } from '@/components/code/proof/proofApi';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));
const runGeneratedTests = vi.fn();
const runLocalScript = vi.fn();
vi.mock('@/components/code/localExec', () => ({
  runGeneratedTests: (...a: unknown[]) => runGeneratedTests(...a),
  runLocalScript: (...a: unknown[]) => runLocalScript(...a),
}));

import { ProofStrip, evidence, sealLine } from '@/components/code/proof/ProofStrip';
import { resolveImport, testSubjects, runProjectTests, proveTests, proveRun } from '@/components/code/proof/proofRunner';
import { testPathFor } from '@/components/code/proof/AgentPane';
import { projectFromSearch } from '@/components/code/proof/ProofApp';

function ledger(over: Partial<Ledger> = {}): Ledger {
  return {
    projectId: 'p1', projectName: 'Demo',
    base: { kind: 'remote', label: 'acme/demo @ main', ref: 'main' },
    codeFingerprint: 'f'.repeat(64),
    changes: [
      { path: 'src/sum.ts', status: 'modified', additions: 2, deletions: 1, hash: 'h1', code: true, test: false, reviewed: true },
      { path: 'src/sum.test.ts', status: 'added', additions: 4, deletions: 0, hash: 'h2', code: true, test: true, reviewed: false },
    ],
    checks: {
      types: { status: 'proved', engine: 'typescript', errors: 0, problems: [], filesChecked: 2, uncheckedPackages: ['node:test'] },
      lint: { status: 'proved', errors: 0, warnings: 0, info: 1, problems: [] },
      tests: { status: 'stale', reason: 'The code changed after these tests ran.', testFiles: ['src/sum.test.ts'] },
      run: { status: 'proved', source: 'browser', path: 'src/sum.ts', exitCode: 0, timedOut: false, durationMs: 12, at: new Date().toISOString(), candidates: ['src/sum.ts'] },
      review: { status: 'not_run', reviewed: 1, total: 2 },
    },
    order: ['types', 'lint', 'tests', 'run', 'review'],
    open: ['tests', 'review'],
    green: false,
    remote: { owner: 'acme', repo: 'demo', defaultBranch: 'main', url: null },
    canPush: false,
    pushBlockers: ['proof_open'],
    pushes: [],
    ...over,
  };
}

const noop = () => {};
const strip = (l: Ledger, extra: Partial<Parameters<typeof ProofStrip>[0]> = {}) => render(
  <ProofStrip ledger={l} busy={{}} onOpenProblem={noop} onRunTests={noop} onWriteTests={noop} onRun={noop} onReview={noop} onPush={noop} {...extra} />,
);

describe('Proof Strip', () => {
  it('writes each check from the ledger, and says which checks are open', () => {
    const l = ledger();
    strip(l);
    expect(screen.getByTestId('pf-evidence-types').textContent).toBe('TypeScript · 2 files · no errors · 1 package not installed here');
    expect(screen.getByTestId('pf-evidence-tests').textContent).toBe('The code changed after these tests ran.');
    expect(screen.getByTestId('pf-evidence-review').textContent).toBe('1 of 2 files read');
    expect(screen.getByTestId('pf-seal-line').textContent).toBe('2 checks open: tests, review.');
    expect(screen.getByTestId('pf-seal-count').textContent).toBe('3/5');
  });

  it('keeps push off with the server-named reason until the server says canPush', () => {
    const { unmount } = strip(ledger());
    expect((screen.getByTestId('pf-push') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('pf-push-blockers').textContent).toContain('Some checks are still open.');
    unmount();
    const onPush = vi.fn();
    const green = ledger({
      checks: { ...ledger().checks, tests: { status: 'proved', source: 'browser', total: 2, passed: 2, failed: 0, at: new Date().toISOString(), testFiles: ['src/sum.test.ts'] }, review: { status: 'proved', reviewed: 2, total: 2 } },
      open: [], green: true, canPush: true, pushBlockers: [],
    });
    strip(green, { onPush });
    const push = screen.getByTestId('pf-push') as HTMLButtonElement;
    expect(push.disabled).toBe(false);
    expect(push.textContent).toContain('Push to acme/demo');
    expect(screen.getByTestId('pf-seal').getAttribute('data-green')).toBe('true');
    fireEvent.click(push);
    expect(onPush).toHaveBeenCalledTimes(1);
  });

  it('green on the client alone never enables push: canPush comes from the server', () => {
    strip(ledger({ open: [], green: true, canPush: false, pushBlockers: ['no_remote'] }));
    expect((screen.getByTestId('pf-push') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('pf-push-blockers').textContent).toContain('not linked to a GitHub repository');
  });

  it('offers the one action that closes an open check', () => {
    const onWriteTests = vi.fn();
    strip(ledger({ checks: { ...ledger().checks, tests: { status: 'not_run', reason: 'This project has no test files yet.', testFiles: [] } } }), { onWriteTests });
    fireEvent.click(screen.getByTestId('pf-write-tests'));
    expect(onWriteTests).toHaveBeenCalled();
    expect(screen.queryByTestId('pf-run-file')).toBeNull(); // run is proved: no action shown
  });

  it('a nothing-changed ledger says so, rather than claiming a proof', () => {
    const empty = ledger({ changes: [], open: [], green: false });
    expect(sealLine(empty)).toMatch(/Nothing to prove yet/);
    expect(evidence('run', ledger())).toMatch(/^src\/sum\.ts · exit 0 · 12 ms/);
  });
});

describe('browser runner', () => {
  beforeEach(() => { lensRun.mockReset(); runGeneratedTests.mockReset(); runLocalScript.mockReset(); });
  const files: Record<string, string> = {
    'src/sum.ts': 'export function sum(a: number, b: number) { return a + b; }\n',
    'src/sum.test.ts': "import { test } from 'node:test';\nimport { sum } from './sum';\ntest('adds', () => {});\n",
    'src/two.test.ts': "import { sum } from './sum';\nimport { x } from './util';\n",
    'src/util.ts': 'export const x = 1;\n',
    'src/ghost.test.ts': "import { y } from './missing';\n",
  };
  const serve = () => lensRun.mockImplementation(async (_d: string, action: string, input: { path?: string }) => {
    if (action === 'files-read') return { data: { ok: true, result: { content: files[input.path!] } } };
    if (action === 'proof-attest') return { data: { ok: true, result: { proof: { attested: input } } } };
    return { data: { ok: false, error: 'unexpected' } };
  });

  it('resolves relative imports like a bundler', () => {
    const paths = new Set(Object.keys(files));
    expect(resolveImport('src/sum.test.ts', './sum', paths)).toBe('src/sum.ts');
    expect(resolveImport('src/a/b.test.ts', '../sum', paths)).toBe('src/sum.ts');
    expect(resolveImport('src/x.test.ts', './sum.js', paths)).toBe('src/sum.ts');
    expect(resolveImport('src/x.test.ts', './nope', paths)).toBeNull();
    expect(testSubjects('src/two.test.ts', files['src/two.test.ts'], paths).resolved.sort()).toEqual(['src/sum.ts', 'src/util.ts']);
    expect(testPathFor('src/sum.ts')).toBe('src/sum.test.ts');
    expect(testPathFor('lib/calc.py')).toBe('lib/test_calc.py');
  });

  it('counts only what the harness reports, and reports a file it could not run as a failure with its reason', async () => {
    serve();
    runGeneratedTests.mockResolvedValue({ outcome: { result: { stdout: '' }, timedOut: false, ranLocally: true, elapsedMs: 3 }, summary: { total: 2, passed: 1, failed: 1, failures: [{ name: 'adds', error: 'boom' }] } });
    const report = await runProjectTests('p1', Object.keys(files), ['src/sum.test.ts', 'src/two.test.ts', 'src/ghost.test.ts']);
    expect(runGeneratedTests).toHaveBeenCalledTimes(1); // only the runnable one actually ran
    const call = runGeneratedTests.mock.calls[0][0];
    expect(call.sourceCode).toContain('export function sum(a, b)'); // types stripped
    expect(report.total).toBe(4);
    expect(report.passed).toBe(1);
    expect(report.failed).toBe(3);
    expect(report.failures.map((f) => f.name)).toEqual(['src/sum.test.ts › adds', 'src/two.test.ts (did not run)', 'src/ghost.test.ts (did not run)']);
    expect(report.failures[1].error).toMatch(/one file at a time/);
    expect(report.failures[2].error).toMatch(/not a file in this project/);
  });

  it('attests against the fingerprint the run started from', async () => {
    serve();
    runGeneratedTests.mockResolvedValue({ outcome: { result: {}, timedOut: false, ranLocally: true, elapsedMs: 1 }, summary: { total: 1, passed: 1, failed: 0, failures: [] } });
    await proveTests(ledger(), Object.keys(files));
    const attest = lensRun.mock.calls.find((c) => c[1] === 'proof-attest')![2];
    expect(attest).toMatchObject({ projectId: 'p1', check: 'tests', fingerprint: 'f'.repeat(64), total: 1, passed: 1, failed: 0, files: ['src/sum.test.ts'] });
  });

  it('a run that never started is never attested', async () => {
    serve();
    runLocalScript.mockResolvedValue({ result: { supported: false, stderr: 'The local runner did not start in time, so nothing ran. Try again.' }, timedOut: false, ranLocally: false, elapsedMs: 0 });
    const { attest } = await proveRun(ledger(), 'src/sum.ts');
    expect(attest.ok).toBe(false);
    expect(lensRun.mock.calls.some((c) => c[1] === 'proof-attest')).toBe(false);
  });

  it('a timed-out run is attested as a failure (exit -1), never as a pass', async () => {
    serve();
    runLocalScript.mockResolvedValue({ result: { supported: true, stdout: 'partial' }, timedOut: true, ranLocally: true, elapsedMs: 10000 });
    await proveRun(ledger(), 'src/sum.ts');
    const attest = lensRun.mock.calls.find((c) => c[1] === 'proof-attest')![2];
    expect(attest).toMatchObject({ check: 'run', path: 'src/sum.ts', exitCode: -1, timedOut: true });
  });
});

describe('URL state', () => {
  it('accepts a project id and rejects anything else', () => {
    expect(projectFromSearch('?p=proj_abc-123')).toBe('proj_abc-123');
    expect(projectFromSearch('?p=../../etc')).toBeNull();
    expect(projectFromSearch('')).toBeNull();
  });
});
