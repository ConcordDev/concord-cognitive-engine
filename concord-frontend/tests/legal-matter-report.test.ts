import { describe, it, expect } from 'vitest';
import {
  matterSentence,
  matterBody,
  matterReportDtuCall,
  matterThreadDraftCall,
  matterThreadDraftOutcome,
  indexMatterDrafts,
  type MatterFacts,
} from '@/components/legal/legalMatterReport';

const matter = {
  id: 'mat_001',
  number: 'M-0001',
  name: 'Acme v Beta',
  clientName: 'Acme Corp',
  matterType: 'litigation',
  status: 'open',
  jurisdiction: 'NY',
  court: 'Southern District',
  caseNumber: '24-cv-1234',
  billingType: 'hourly',
  hourlyRate: 350,
  openedAt: '2026-09-01',
  closedAt: null,
  description: 'Breach of contract',
};

const facts: MatterFacts = {
  matter,
  parties: [
    { id: 'p1', name: 'Acme Corp', kind: 'client' },
    { id: 'p2', name: 'Beta LLC', kind: 'opposing_party' },
  ],
  totals: { billed: 5000, unbilled: 3200, hours: 12.5, trustBalance: 10000 },
  time: [
    { id: 'te1', date: '2026-10-01', description: 'Review complaint', hours: 2.5, amount: 875, status: 'unbilled' },
    { id: 'te2', date: '2026-10-02', description: 'Draft motion', hours: 4, amount: 1400, status: 'unbilled' },
  ],
  invoices: [{ id: 'inv1', number: 'INV-001', total: 5000, status: 'paid' }],
  documents: [{ id: 'doc1', name: 'Complaint.pdf', status: 'filed' }],
  events: [{ id: 'evt1', title: 'Hearing', date: '2026-11-15', kind: 'hearing' }],
};

describe('legal matter report', () => {
  it('states only the figures the backend reported', () => {
    const s = matterSentence(facts)!;
    expect(s).toContain('Acme v Beta (M-0001)');
    expect(s).toContain('12.5 hrs logged');
    expect(s).toContain('$3,200 unbilled');
    expect(s).toContain('$5,000 billed');
    expect(s).toContain('$10,000 in trust');
    expect(s).toContain('2 time entries');
    expect(s).toContain('1 invoices');
    expect(s).toContain('2 parties');
    expect(s).toContain('Status open');
  });

  it('refuses to summarise a matter with no identity', () => {
    expect(matterSentence({ ...facts, matter: null })).toBeNull();
    expect(matterSentence({ ...facts, matter: { ...matter, id: '' } })).toBeNull();
    expect(matterBody({ ...facts, matter: null })).toBe('');
    expect(matterReportDtuCall({ ...facts, matter: null })).toBeNull();
  });

  it('says so when the backend reported nothing, instead of inventing figures', () => {
    const bare: MatterFacts = {
      matter,
      parties: [],
      totals: null,
      time: [],
      invoices: [],
      documents: [],
      events: [],
    };
    expect(matterSentence(bare)).toContain('no reported activity yet');
    expect(matterBody(bare)).not.toContain('unbilled');
    const call = matterReportDtuCall(bare)!;
    expect(call.input.machine).toMatchObject({ totals: null, parties: 0, timeEntries: 0 });
  });

  it('builds a private matter-report DTU carrying the same numbers', () => {
    const call = matterReportDtuCall(facts)!;
    expect(call.domain).toBe('dtu');
    expect(call.action).toBe('create');
    expect(call.input.source).toBe('legal-lens:matter-report');
    expect((call.input.meta as Record<string, unknown>).visibility).toBe('private');
    expect(call.input.machine).toMatchObject({
      kind: 'legal_matter_report',
      matterId: 'mat_001',
      matterNumber: 'M-0001',
      totals: { hours: 12.5, unbilled: 3200, billed: 5000, trustBalance: 10000 },
      parties: 2,
      timeEntries: 2,
      invoices: 1,
    });
  });

  it('will not draft without a real DTU id to cite', () => {
    expect(matterThreadDraftCall(facts, '')).toBeNull();
    expect(matterThreadDraftCall(facts, 'not an id')).toBeNull();
    const call = matterThreadDraftCall(facts, 'dtu_abc123')!;
    expect(call.domain).toBe('thread');
    expect(call.action).toBe('thread-draft');
    expect(call.input.citedDtuId).toBe('dtu_abc123');
    expect(String(call.input.content)).toContain('No court was filed');
    expect(String(call.input.content)).toContain('Nothing was published');
  });

  it('claims a draft only when Thread kept the exact cite and did not post', () => {
    const ok = { ok: true, result: { draft: { id: 'th_1', status: 'draft', citedDtuId: 'dtu_abc123' } } };
    expect(matterThreadDraftOutcome(ok, 'dtu_abc123')).toEqual({ draftId: 'th_1', status: 'draft', citedDtuId: 'dtu_abc123' });

    expect(matterThreadDraftOutcome({ ok: false, error: 'cited DTU not found' }, 'dtu_abc123')).toBeNull();
    expect(matterThreadDraftOutcome({ ok: true, result: { draft: { id: 'th_1', status: 'draft', citedDtuId: 'dtu_other' } } }, 'dtu_abc123')).toBeNull();
    expect(matterThreadDraftOutcome({ ok: true, result: { draft: { id: 'th_1', status: 'published', citedDtuId: 'dtu_abc123' } } }, 'dtu_abc123')).toBeNull();
    expect(matterThreadDraftOutcome({ ok: true, result: {} }, 'dtu_abc123')).toBeNull();
    expect(matterThreadDraftOutcome(null, 'dtu_abc123')).toBeNull();
  });

  it('indexes drafts by the DTU they cite after a reload', () => {
    const index = indexMatterDrafts([
      { ok: true, result: { draft: { id: 'th_1', citedDtuId: 'dtu_abc123' } } },
      { ok: true, result: { draft: { id: 'th_2', citedDtuId: null } } },
      { ok: true, result: { draft: { id: 'th_3', citedDtuId: 'dtu_zzz' } } },
      { ok: false, error: 'draft not found' },
      null,
    ]);
    expect(index).toEqual({ dtu_abc123: 'th_1', dtu_zzz: 'th_3' });
    expect(indexMatterDrafts([{ draft: { id: 'th_4', citedDtuId: 'dtu_q' } }])).toEqual({ dtu_q: 'th_4' });
    expect(indexMatterDrafts(null)).toEqual({});
  });

  it('body names the external services that were not used', () => {
    const body = matterBody(facts);
    expect(body).toContain('No court was filed');
    expect(body).toContain('Nothing was published by saving this');
  });
});