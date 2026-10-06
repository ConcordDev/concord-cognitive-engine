import { describe, it, expect } from 'vitest';
import {
  registrySentence,
  registryBody,
  registryDtuCall,
  registryThreadDraftCall,
  registryThreadDraftOutcome,
  indexRegistryDrafts,
  type PreRegRecord,
} from '@/components/hypothesis/hypothesisRegistryReport';

const record: PreRegRecord = {
  id: 'preg_001',
  statement: 'Treatment group will show higher recovery rate than control',
  predictedDirection: 'greater',
  plannedTest: 'tTest',
  alpha: 0.05,
  plannedSampleSize: 200,
  status: 'resolved',
  outcome: { verdict: 'confirmed', pValue: 0.03, effectSize: 0.5, reject: true, predictionConfirmed: true, observedDirection: 'greater' },
  registeredAt: '2026-10-04',
};

describe('hypothesis registry report', () => {
  it('states only the figures the backend reported', () => {
    const s = registrySentence(record)!;
    expect(s).toContain('Treatment group will show higher recovery rate');
    expect(s).toContain('verdict: confirmed');
    expect(s).toContain('prediction confirmed');
    expect(s).toContain('p=0.0300');
    expect(s).toContain('d=0.500');
    expect(s).toContain('planned: tTest');
    expect(s).toContain('α=0.05');
  });

  it('refuses to summarise a record with no identity', () => {
    expect(registrySentence(null)).toBeNull();
    expect(registrySentence({ ...record, id: '' })).toBeNull();
    expect(registrySentence({ ...record, statement: '' })).toBeNull();
    expect(registryBody(null)).toBe('');
    expect(registryDtuCall(null)).toBeNull();
  });

  it('says so when the outcome is not resolved, instead of inventing figures', () => {
    const registered: PreRegRecord = { ...record, status: 'registered', outcome: null };
    const s = registrySentence(registered)!;
    expect(s).toContain('status: registered');
    expect(s).not.toContain('verdict');
  });

  it('builds a private registry-report DTU carrying the same numbers', () => {
    const call = registryDtuCall(record)!;
    expect(call.domain).toBe('dtu');
    expect(call.action).toBe('create');
    expect(call.input.source).toBe('hypothesis-lens:preregistration');
    expect((call.input.meta as Record<string, unknown>).visibility).toBe('private');
    expect(call.input.machine).toMatchObject({
      kind: 'hypothesis_registry_report',
      preRegId: 'preg_001',
      status: 'resolved',
      verdict: 'confirmed',
      pValue: 0.03,
      effectSize: 0.5,
      predictionConfirmed: true,
    });
  });

  it('will not draft without a real DTU id to cite', () => {
    expect(registryThreadDraftCall(record, '')).toBeNull();
    expect(registryThreadDraftCall(record, 'not an id')).toBeNull();
    const call = registryThreadDraftCall(record, 'dtu_abc123')!;
    expect(call.domain).toBe('thread');
    expect(call.action).toBe('thread-draft');
    expect(call.input.citedDtuId).toBe('dtu_abc123');
    expect(String(call.input.content)).toContain('Nothing was published');
  });

  it('claims a draft only when Thread kept the exact cite and did not post', () => {
    const ok = { ok: true, result: { draft: { id: 'th_1', status: 'draft', citedDtuId: 'dtu_abc123' } } };
    expect(registryThreadDraftOutcome(ok, 'dtu_abc123')).toEqual({ draftId: 'th_1', status: 'draft', citedDtuId: 'dtu_abc123' });

    expect(registryThreadDraftOutcome({ ok: false, error: 'cited DTU not found' }, 'dtu_abc123')).toBeNull();
    expect(registryThreadDraftOutcome({ ok: true, result: { draft: { id: 'th_1', status: 'draft', citedDtuId: 'dtu_other' } } }, 'dtu_abc123')).toBeNull();
    expect(registryThreadDraftOutcome({ ok: true, result: { draft: { id: 'th_1', status: 'published', citedDtuId: 'dtu_abc123' } } }, 'dtu_abc123')).toBeNull();
    expect(registryThreadDraftOutcome({ ok: true, result: {} }, 'dtu_abc123')).toBeNull();
    expect(registryThreadDraftOutcome(null, 'dtu_abc123')).toBeNull();
  });

  it('indexes drafts by the DTU they cite after a reload', () => {
    const index = indexRegistryDrafts([
      { ok: true, result: { draft: { id: 'th_1', citedDtuId: 'dtu_abc123' } } },
      { ok: true, result: { draft: { id: 'th_2', citedDtuId: null } } },
      { ok: true, result: { draft: { id: 'th_3', citedDtuId: 'dtu_zzz' } } },
      { ok: false, error: 'draft not found' },
      null,
    ]);
    expect(index).toEqual({ dtu_abc123: 'th_1', dtu_zzz: 'th_3' });
    expect(indexRegistryDrafts(null)).toEqual({});
  });

  it('body names the source and says nothing was published', () => {
    const body = registryBody(record);
    expect(body).toContain('Every figure here came from the Hypothesis domain');
    expect(body).toContain('Nothing was published by saving this');
  });
});