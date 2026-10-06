import { describe, it, expect } from 'vitest';
import {
  loadSentence,
  loadBody,
  loadReportDtuCall,
  loadThreadDraftCall,
  loadThreadDraftOutcome,
  indexLoadDrafts,
  type HvacLoadFacts,
} from '@/components/hvac/hvacLoadReport';

const facts: HvacLoadFacts = {
  inputs: { squareFootage: 1800, stories: 2, insulation: 'good', climate: 'hot-humid' },
  result: {
    squareFootage: 1800,
    heatingBTU: 38250,
    coolingBTU: 45000,
    requiredBTU: 45000,
    tonnage: 3.8,
    tonnageRecommended: '3.8 ton',
    equipmentSize: '4 ton system',
    estimatedCost: 13300,
    energyEstimate: '106 kWh/day at peak',
    seerRecommendation: 'SEER 16+',
    recommendation: 'Hot climate — prioritise SEER 16+ and verify duct sealing to hold the cooling load.',
  },
};

describe('hvac load report', () => {
  it('states only the figures the backend reported', () => {
    const s = loadSentence(facts)!;
    expect(s).toContain('1,800 sf');
    expect(s).toContain('hot-humid');
    expect(s).toContain('38,250 BTU heat');
    expect(s).toContain('45,000 BTU cool');
    expect(s).toContain('3.8 ton');
  });

  it('refuses to summarise a load with no inputs or no result', () => {
    expect(loadSentence({ inputs: { squareFootage: 0, stories: 1, insulation: 'average', climate: 'temperate' }, result: null })).toBeNull();
    expect(loadSentence({ inputs: { squareFootage: 1800, stories: 1, insulation: 'average', climate: 'temperate' }, result: null })).toBeNull();
    expect(loadBody({ inputs: { squareFootage: 0, stories: 1, insulation: 'average', climate: 'temperate' }, result: null })).toBe('');
    expect(loadReportDtuCall({ inputs: { squareFootage: 0, stories: 1, insulation: 'average', climate: 'temperate' }, result: null })).toBeNull();
  });

  it('refuses to summarise when the result is missing the BTU figures', () => {
    const partial: HvacLoadFacts = {
      inputs: { squareFootage: 1800, stories: 1, insulation: 'average', climate: 'temperate' },
      result: { squareFootage: 1800, tonnageRecommended: '3 ton' },
    };
    expect(loadSentence(partial)).toBeNull();
  });

  it('builds a private load-report DTU carrying the same numbers', () => {
    const call = loadReportDtuCall(facts)!;
    expect(call.domain).toBe('dtu');
    expect(call.action).toBe('create');
    expect(call.input.source).toBe('hvac-lens:load-report');
    expect((call.input.meta as Record<string, unknown>).visibility).toBe('private');
    expect(call.input.machine).toMatchObject({
      kind: 'hvac_load_report',
      squareFootage: 1800,
      stories: 2,
      insulation: 'good',
      climate: 'hot-humid',
      heatingBTU: 38250,
      coolingBTU: 45000,
      tonnageRecommended: '3.8 ton',
      equipmentSize: '4 ton system',
      seerRecommendation: 'SEER 16+',
      estimatedCost: 13300,
    });
  });

  it('will not draft without a real DTU id to cite', () => {
    expect(loadThreadDraftCall(facts, '')).toBeNull();
    expect(loadThreadDraftCall(facts, 'not an id')).toBeNull();
    const call = loadThreadDraftCall(facts, 'dtu_abc123')!;
    expect(call.domain).toBe('thread');
    expect(call.action).toBe('thread-draft');
    expect(call.input.citedDtuId).toBe('dtu_abc123');
    expect(String(call.input.content)).toContain('Nothing was published');
  });

  it('claims a draft only when Thread kept the exact cite and did not post', () => {
    const ok = { ok: true, result: { draft: { id: 'th_1', status: 'draft', citedDtuId: 'dtu_abc123' } } };
    expect(loadThreadDraftOutcome(ok, 'dtu_abc123')).toEqual({ draftId: 'th_1', status: 'draft', citedDtuId: 'dtu_abc123' });
    expect(loadThreadDraftOutcome({ ok: false }, 'dtu_abc123')).toBeNull();
    expect(loadThreadDraftOutcome({ ok: true, result: { draft: { id: 'th_1', status: 'published', citedDtuId: 'dtu_abc123' } } }, 'dtu_abc123')).toBeNull();
    expect(loadThreadDraftOutcome(null, 'dtu_abc123')).toBeNull();
  });

  it('indexes drafts by the DTU they cite after a reload', () => {
    const index = indexLoadDrafts([
      { ok: true, result: { draft: { id: 'th_1', citedDtuId: 'dtu_abc123' } } },
      { ok: true, result: { draft: { id: 'th_3', citedDtuId: 'dtu_zzz' } } },
      null,
    ]);
    expect(index).toEqual({ dtu_abc123: 'th_1', dtu_zzz: 'th_3' });
    expect(indexLoadDrafts(null)).toEqual({});
  });

  it('body names the source and says nothing was published', () => {
    const body = loadBody(facts);
    expect(body).toContain('Every figure here came from the HVAC domain');
    expect(body).toContain('Nothing was published by saving this');
    expect(body).toContain('45,000 BTU/hr');
    expect(body).toContain('SEER 16+');
  });
});