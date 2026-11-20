/**
 * The browser half of Proof: runs a project's test files and a changed file
 * in the lens's local workers (components/code/localExec.ts), then reports
 * exactly what ran to code.proof-attest, bound to the fingerprint of the code
 * it ran on. Nothing here invents a count: totals come from the harness's own
 * tally of tests that executed. A test file the harness cannot run is
 * reported as a failure with its reason, never skipped silently.
 */

import { runGeneratedTests, runLocalScript } from '../localExec';
import { code, languageOf, readFiles, type Ledger } from './proofApi';

const JS_EXTS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];

export interface TestRunReport {
  total: number;
  passed: number;
  failed: number;
  failures: { name: string; error: string }[];
  files: string[];
  output: string;
}

function dirname(p: string) { const i = p.lastIndexOf('/'); return i < 0 ? '' : p.slice(0, i); }
function normalize(p: string) {
  const out: string[] = [];
  for (const part of p.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') out.pop(); else out.push(part);
  }
  return out.join('/');
}

/** Resolve a relative import from `from` to a project path, the way a bundler would. */
export function resolveImport(from: string, spec: string, paths: Set<string>): string | null {
  const base = normalize(`${dirname(from)}/${spec}`);
  const candidates = [base, ...JS_EXTS.map((e) => base + e), ...JS_EXTS.map((e) => `${base}/index${e}`)];
  if (/\.js$/.test(base)) candidates.push(base.replace(/\.js$/, '.ts'), base.replace(/\.js$/, '.tsx'));
  return candidates.find((c) => paths.has(c)) || null;
}

/** Project files a test imports (relative specifiers only; packages are the harness's job). */
export function testSubjects(testPath: string, testCode: string, paths: Set<string>): { resolved: string[]; missing: string[] } {
  const resolved = new Set<string>();
  const missing: string[] = [];
  if (/\.py$/i.test(testPath)) {
    for (const m of testCode.matchAll(/^\s*(?:from\s+([\w.]+)\s+import|import\s+([\w.]+))/gm)) {
      const mod = (m[1] || m[2] || '').split('.')[0];
      const p = normalize(`${dirname(testPath)}/${mod}.py`);
      if (mod && paths.has(p) && p !== testPath) resolved.add(p);
    }
    return { resolved: [...resolved], missing };
  }
  for (const m of testCode.matchAll(/(?:from\s+|require\(\s*|import\s+)['"](\.[^'"]+)['"]/g)) {
    const r = resolveImport(testPath, m[1], paths);
    if (r) resolved.add(r); else missing.push(m[1]);
  }
  return { resolved: [...resolved], missing };
}

async function toModuleJs(source: string, path: string): Promise<string> {
  if (!/\.(ts|tsx|mts|cts)$/i.test(path)) return source;
  const ts = await import('typescript');
  return ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.React, isolatedModules: true },
    fileName: path,
    reportDiagnostics: false,
  }).outputText;
}

/** Run every test file in the project, in order, one worker each. */
export async function runProjectTests(projectId: string, allPaths: string[], testFiles: string[], onFile?: (path: string) => void): Promise<TestRunReport> {
  const paths = new Set(allPaths);
  const report: TestRunReport = { total: 0, passed: 0, failed: 0, failures: [], files: [], output: '' };
  const contents = await readFiles(projectId, allPaths.filter((p) => /\.(py|[cm]?[jt]sx?)$/i.test(p)));
  for (const testPath of testFiles) {
    onFile?.(testPath);
    const testCode = contents.get(testPath);
    report.files.push(testPath);
    const fail = (error: string) => {
      report.total += 1; report.failed += 1;
      report.failures.push({ name: `${testPath} (did not run)`, error });
      report.output += `✕ ${testPath}: ${error}\n`;
    };
    if (testCode == null) { fail('Could not read the test file.'); continue; }
    const { resolved, missing } = testSubjects(testPath, testCode, paths);
    if (missing.length) { fail(`Imports ${missing.join(', ')}, which is not a file in this project.`); continue; }
    if (resolved.length > 1) { fail(`Imports ${resolved.length} project files (${resolved.join(', ')}); the browser runner tests one file at a time.`); continue; }
    const subject = resolved[0] || null;
    const language = /\.py$/i.test(testPath) ? 'python' : 'javascript';
    const sourceCode = subject ? await toModuleJs(contents.get(subject) || '', subject) : '';
    const test = await toModuleJs(testCode, testPath);
    const run = await runGeneratedTests({ sourceCode, testCode: test, language });
    const out = run.outcome.result;
    if (out.stdout) report.output += out.stdout;
    if (run.summary) {
      report.total += run.summary.total;
      report.passed += run.summary.passed;
      report.failed += run.summary.failed;
      for (const f of run.summary.failures) report.failures.push({ name: `${testPath} › ${f.name}`, error: f.error });
      report.output += `${run.summary.failed ? '✕' : '✓'} ${testPath}: ${run.summary.passed}/${run.summary.total} passed\n`;
      if (run.summary.total === 0) report.output += `  no tests registered in ${testPath}\n`;
    } else {
      fail(run.outcome.timedOut ? 'Timed out before the tests reported.' : (out.stderr || 'The runner stopped before the tests reported.').trim().slice(0, 400));
    }
  }
  return report;
}

/** Run the tests and record the result in the proof. */
export async function proveTests(ledger: Ledger, allPaths: string[], onFile?: (path: string) => void) {
  const fingerprint = ledger.codeFingerprint;
  const files = ledger.checks.tests.testFiles || [];
  const report = await runProjectTests(ledger.projectId, allPaths, files, onFile);
  const attest = await code<{ proof: Ledger }>('proof-attest', {
    projectId: ledger.projectId, check: 'tests', fingerprint,
    total: report.total, passed: report.passed, failed: report.failed,
    failures: report.failures.slice(0, 20), files: report.files,
  });
  return { report, attest };
}

/** Run one file in the browser sandbox and record it in the proof. */
export async function proveRun(ledger: Ledger, path: string) {
  const fingerprint = ledger.codeFingerprint;
  const content = (await readFiles(ledger.projectId, [path])).get(path) ?? '';
  const outcome = await runLocalScript({ code: content, language: languageOf(path) });
  const r = outcome.result;
  if (!outcome.ranLocally) {
    return { outcome, attest: { ok: false as const, error: 'not_run', message: r.stderr || 'This file cannot run in the browser.' } };
  }
  const attest = await code<{ proof: Ledger }>('proof-attest', {
    projectId: ledger.projectId, check: 'run', fingerprint, path,
    exitCode: outcome.timedOut ? -1 : (typeof r.exitCode === 'number' && Number.isInteger(r.exitCode) ? r.exitCode : -1),
    timedOut: outcome.timedOut, durationMs: outcome.elapsedMs,
    stdout: r.stdout || '', stderr: r.stderr || '',
  });
  return { outcome, attest };
}
