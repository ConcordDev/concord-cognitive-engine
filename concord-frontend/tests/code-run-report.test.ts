import { describe, it, expect } from 'vitest';
import {
  runSentence,
  runBody,
  runReportDtuCall,
  runThreadDraftCall,
  runThreadDraftOutcome,
  indexRunDrafts,
  type RunFacts,
} from '@/components/code/codeRunReport';

const okFacts: RunFacts = {
  name: 'fib.js',
  language: 'javascript',
  scriptType: 'snippet',
  code: 'console.log(1)',
  result: { stdout: '1\n', stderr: '', exitCode: 0, supported: true },
  elapsedMs: 12,
};

const errFacts: RunFacts = {
  name: 'fib.js',
  language: 'javascript',
  scriptType: 'snippet',
  code: 'throw new Error("boom")',
  result: { stdout: '', stderr: 'Error: boom', exitCode: 1, supported: true },
};

const unsupportedFacts: RunFacts = {
  name: 'main.go',
  language: 'go',
  scriptType: 'project',
  code: 'package main',
  result: { supported: false, stdout: '', stderr: 'Language "go" cannot run in the sandbox.', exitCode: -1 },
};

describe('code run report', () => {
  it('states the real stdout size, exit code, and elapsed time', () => {
    const s = runSentence(okFacts)!;
    expect(s).toContain('fib.js');
    expect(s).toContain('(javascript)');
    expect(s).toContain('Ran');
    expect(s).toContain('in 12ms');
    expect(s).toContain('2 bytes of output');
  });

  it('reports a non-zero exit as an exit, not a success', () => {
    const s = runSentence(errFacts)!;
    expect(s).toContain('Exited 1');
    expect(s).toContain('11 bytes of stderr');
  });

  it('reports a sandbox refusal as a refusal, not a run', () => {
    const s = runSentence(unsupportedFacts)!;
    expect(s).toContain('does not run go');
    expect(s).not.toContain('Ran');
  });

  it('refuses to summarise a run with no result', () => {
    expect(runSentence({ ...okFacts, result: null })).toBeNull();
    expect(runSentence({ ...okFacts, name: '' })).toBeNull();
    expect(runBody({ ...okFacts, result: null })).toBe('');
    expect(runReportDtuCall({ ...okFacts, result: null })).toBeNull();
  });

  it('builds a private run-report DTU carrying the real result', () => {
    const call = runReportDtuCall(okFacts)!;
    expect(call.domain).toBe('dtu');
    expect(call.action).toBe('create');
    expect(call.input.source).toBe('code-lens:run-report');
    expect((call.input.meta as Record<string, unknown>).visibility).toBe('private');
    expect(call.input.machine).toMatchObject({
      kind: 'code_run_report',
      name: 'fib.js',
      language: 'javascript',
      supported: true,
      exitCode: 0,
      stdoutBytes: 2,
    });
  });

  it('will not draft without a real DTU id to cite', () => {
    expect(runThreadDraftCall(okFacts, '')).toBeNull();
    expect(runThreadDraftCall(okFacts, 'not an id')).toBeNull();
    const call = runThreadDraftCall(okFacts, 'dtu_abc123')!;
    expect(call.domain).toBe('thread');
    expect(call.action).toBe('thread-draft');
    expect(call.input.citedDtuId).toBe('dtu_abc123');
    expect(String(call.input.content)).toContain('Nothing was published');
  });

  it('claims a draft only when Thread kept the exact cite and did not post', () => {
    const ok = { ok: true, result: { draft: { id: 'th_1', status: 'draft', citedDtuId: 'dtu_abc123' } } };
    expect(runThreadDraftOutcome(ok, 'dtu_abc123')).toEqual({ draftId: 'th_1', status: 'draft', citedDtuId: 'dtu_abc123' });

    expect(runThreadDraftOutcome({ ok: false, error: 'cited DTU not found' }, 'dtu_abc123')).toBeNull();
    expect(runThreadDraftOutcome({ ok: true, result: { draft: { id: 'th_1', status: 'draft', citedDtuId: 'dtu_other' } } }, 'dtu_abc123')).toBeNull();
    expect(runThreadDraftOutcome({ ok: true, result: { draft: { id: 'th_1', status: 'published', citedDtuId: 'dtu_abc123' } } }, 'dtu_abc123')).toBeNull();
    expect(runThreadDraftOutcome({ ok: true, result: {} }, 'dtu_abc123')).toBeNull();
    expect(runThreadDraftOutcome(null, 'dtu_abc123')).toBeNull();
  });

  it('will not save a DTU for a run the sandbox refused', () => {
    expect(runReportDtuCall(unsupportedFacts)).not.toBeNull();
    const call = runReportDtuCall(unsupportedFacts)!;
    expect((call.input.machine as Record<string, unknown>).supported).toBe(false);
    expect(String(call.input.human?.summary)).toContain('does not run go');
  });

  it('indexes drafts by the DTU they cite after a reload', () => {
    const index = indexRunDrafts([
      { ok: true, result: { draft: { id: 'th_1', citedDtuId: 'dtu_abc123' } } },
      { ok: true, result: { draft: { id: 'th_2', citedDtuId: null } } },
      { ok: true, result: { draft: { id: 'th_3', citedDtuId: 'dtu_zzz' } } },
      { ok: false, error: 'draft not found' },
      null,
    ]);
    expect(index).toEqual({ dtu_abc123: 'th_1', dtu_zzz: 'th_3' });
    expect(indexRunDrafts([{ draft: { id: 'th_4', citedDtuId: 'dtu_q' } }])).toEqual({ dtu_q: 'th_4' });
    expect(indexRunDrafts(null)).toEqual({});
  });
});