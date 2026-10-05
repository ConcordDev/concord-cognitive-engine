import { describe, it, expect } from 'vitest';
import {
  feaSentence,
  feaBody,
  feaReportDtuCall,
  feaThreadDraftCall,
  feaThreadDraftOutcome,
  indexFeaDrafts,
  type EngineeringFacts,
} from '@/components/engineering/feaReport';

const facts: EngineeringFacts = {
  jobName: 'Cantilever Beam',
  result: {
    jobId: 'sim_001',
    elapsedMs: 37,
    summary: {
      maxDisplacement: 0.0125,
      maxUtilization: 0.72,
      allPass: true,
      memberCount: 3,
      nodeCount: 4,
    },
    utilization: [
      { id: 'M1', utilization: 0.72, pass: true },
      { id: 'M2', utilization: 0.45, pass: true },
      { id: 'M3', utilization: 0.31, pass: true },
    ],
  },
};

describe('engineering FEA report', () => {
  it('states only the figures the backend reported', () => {
    const s = feaSentence(facts)!;
    expect(s).toContain('Cantilever Beam');
    expect(s).toContain('3 members');
    expect(s).toContain('4 nodes');
    expect(s).toContain('max util 0.720');
    expect(s).toContain('max disp 0.0125');
    expect(s).toContain('all pass');
  });

  it('reports failures when a member fails', () => {
    const fail: EngineeringFacts = {
      jobName: 'Bad Beam',
      result: {
        summary: { maxDisplacement: 0.1, maxUtilization: 1.3, allPass: false, memberCount: 2, nodeCount: 3 },
        utilization: [
          { id: 'M1', utilization: 1.3, pass: false },
          { id: 'M2', utilization: 0.5, pass: true },
        ],
      },
    };
    expect(feaSentence(fail)).toContain('has failures');
    expect(feaBody(fail)).toContain('Failed members: M1.');
  });

  it('refuses to summarise an FEA with no result or no name', () => {
    expect(feaSentence({ jobName: '', result: facts.result })).toBeNull();
    expect(feaSentence({ jobName: 'X', result: null })).toBeNull();
    expect(feaBody({ jobName: '', result: null })).toBe('');
    expect(feaReportDtuCall({ jobName: '', result: null })).toBeNull();
  });

  it('builds a private FEA-report DTU carrying the same numbers', () => {
    const call = feaReportDtuCall(facts)!;
    expect(call.domain).toBe('dtu');
    expect(call.action).toBe('create');
    expect(call.input.source).toBe('engineering-lens:fea-report');
    expect((call.input.meta as Record<string, unknown>).visibility).toBe('private');
    expect(call.input.machine).toMatchObject({
      kind: 'engineering_fea_report',
      jobName: 'Cantilever Beam',
      jobId: 'sim_001',
      elapsedMs: 37,
      memberCount: 3,
      nodeCount: 4,
      maxDisplacement: 0.0125,
      maxUtilization: 0.72,
      allPass: true,
      failedCount: 0,
    });
  });

  it('will not draft without a real DTU id to cite', () => {
    expect(feaThreadDraftCall(facts, '')).toBeNull();
    expect(feaThreadDraftCall(facts, 'not an id')).toBeNull();
    const call = feaThreadDraftCall(facts, 'dtu_abc123')!;
    expect(call.domain).toBe('thread');
    expect(call.action).toBe('thread-draft');
    expect(call.input.citedDtuId).toBe('dtu_abc123');
    expect(String(call.input.content)).toContain('Nothing was published');
  });

  it('claims a draft only when Thread kept the exact cite and did not post', () => {
    const ok = { ok: true, result: { draft: { id: 'th_1', status: 'draft', citedDtuId: 'dtu_abc123' } } };
    expect(feaThreadDraftOutcome(ok, 'dtu_abc123')).toEqual({ draftId: 'th_1', status: 'draft', citedDtuId: 'dtu_abc123' });
    expect(feaThreadDraftOutcome({ ok: false }, 'dtu_abc123')).toBeNull();
    expect(feaThreadDraftOutcome({ ok: true, result: { draft: { id: 'th_1', status: 'published', citedDtuId: 'dtu_abc123' } } }, 'dtu_abc123')).toBeNull();
    expect(feaThreadDraftOutcome(null, 'dtu_abc123')).toBeNull();
  });

  it('indexes drafts by the DTU they cite after a reload', () => {
    const index = indexFeaDrafts([
      { ok: true, result: { draft: { id: 'th_1', citedDtuId: 'dtu_abc123' } } },
      { ok: true, result: { draft: { id: 'th_3', citedDtuId: 'dtu_zzz' } } },
      null,
    ]);
    expect(index).toEqual({ dtu_abc123: 'th_1', dtu_zzz: 'th_3' });
    expect(indexFeaDrafts(null)).toEqual({});
  });

  it('body names the source and says nothing was published', () => {
    const body = feaBody(facts);
    expect(body).toContain('Every figure here came from the Engineering domain FEA solver');
    expect(body).toContain('Nothing was published by saving this');
    expect(body).toContain('Job: sim_001');
    expect(body).toContain('Elapsed: 37ms');
  });
});