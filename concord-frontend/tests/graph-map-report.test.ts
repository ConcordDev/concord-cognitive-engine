import { describe, it, expect } from 'vitest';
import {
  mapSentence,
  mapBody,
  mapReportDtuCall,
  mapThreadDraftCall,
  mapThreadDraftOutcome,
  indexMapDrafts,
  type GraphFacts,
} from '@/components/graph/graphMapReport';

const map = {
  id: 'map_001',
  title: 'Product Strategy',
  nodes: [
    { id: 'n1', label: 'Product', central: true },
    { id: 'n2', label: 'Pricing', parentId: 'n1' },
    { id: 'n3', label: 'Channels', parentId: 'n1' },
  ],
  edges: [
    { id: 'e1', from: 'n1', to: 'n2' },
    { id: 'e2', from: 'n1', to: 'n3' },
  ],
  createdAt: '2026-10-04',
};

const facts: GraphFacts = {
  map,
  metrics: { nodeCount: 3, edgeCount: 2, avgDegree: 1.33, mostConnected: { label: 'Product', degree: 2 }, isolatedNodes: 0 },
};

describe('graph map report', () => {
  it('states only the figures the backend reported', () => {
    const s = mapSentence(facts)!;
    expect(s).toContain('Product Strategy');
    expect(s).toContain('3 nodes');
    expect(s).toContain('2 edges');
    expect(s).toContain('avg degree 1.3');
    expect(s).toContain('hub: Product (2)');
  });

  it('refuses to summarise a map with no identity', () => {
    expect(mapSentence({ ...facts, map: null })).toBeNull();
    expect(mapSentence({ ...facts, map: { ...map, id: '' } })).toBeNull();
    expect(mapBody({ ...facts, map: null })).toBe('');
    expect(mapReportDtuCall({ ...facts, map: null })).toBeNull();
  });

  it('says so when the backend reported nothing, instead of inventing figures', () => {
    const bare: GraphFacts = { map, metrics: null };
    expect(mapSentence(bare)).toContain('3 nodes');
    expect(mapSentence(bare)).toContain('2 edges');
    expect(mapSentence(bare)).not.toContain('avg degree');
  });

  it('builds a private map-report DTU carrying the same numbers', () => {
    const call = mapReportDtuCall(facts)!;
    expect(call.domain).toBe('dtu');
    expect(call.action).toBe('create');
    expect(call.input.source).toBe('graph-lens:map-report');
    expect((call.input.meta as Record<string, unknown>).visibility).toBe('private');
    expect(call.input.machine).toMatchObject({
      kind: 'graph_map_report',
      mapId: 'map_001',
      nodeCount: 3,
      edgeCount: 2,
      avgDegree: 1.33,
    });
  });

  it('will not draft without a real DTU id to cite', () => {
    expect(mapThreadDraftCall(facts, '')).toBeNull();
    expect(mapThreadDraftCall(facts, 'not an id')).toBeNull();
    const call = mapThreadDraftCall(facts, 'dtu_abc123')!;
    expect(call.domain).toBe('thread');
    expect(call.action).toBe('thread-draft');
    expect(call.input.citedDtuId).toBe('dtu_abc123');
    expect(String(call.input.content)).toContain('Nothing was published');
  });

  it('claims a draft only when Thread kept the exact cite and did not post', () => {
    const ok = { ok: true, result: { draft: { id: 'th_1', status: 'draft', citedDtuId: 'dtu_abc123' } } };
    expect(mapThreadDraftOutcome(ok, 'dtu_abc123')).toEqual({ draftId: 'th_1', status: 'draft', citedDtuId: 'dtu_abc123' });

    expect(mapThreadDraftOutcome({ ok: false, error: 'cited DTU not found' }, 'dtu_abc123')).toBeNull();
    expect(mapThreadDraftOutcome({ ok: true, result: { draft: { id: 'th_1', status: 'draft', citedDtuId: 'dtu_other' } } }, 'dtu_abc123')).toBeNull();
    expect(mapThreadDraftOutcome({ ok: true, result: { draft: { id: 'th_1', status: 'published', citedDtuId: 'dtu_abc123' } } }, 'dtu_abc123')).toBeNull();
    expect(mapThreadDraftOutcome({ ok: true, result: {} }, 'dtu_abc123')).toBeNull();
    expect(mapThreadDraftOutcome(null, 'dtu_abc123')).toBeNull();
  });

  it('indexes drafts by the DTU they cite after a reload', () => {
    const index = indexMapDrafts([
      { ok: true, result: { draft: { id: 'th_1', citedDtuId: 'dtu_abc123' } } },
      { ok: true, result: { draft: { id: 'th_2', citedDtuId: null } } },
      { ok: true, result: { draft: { id: 'th_3', citedDtuId: 'dtu_zzz' } } },
      { ok: false, error: 'draft not found' },
      null,
    ]);
    expect(index).toEqual({ dtu_abc123: 'th_1', dtu_zzz: 'th_3' });
    expect(indexMapDrafts([{ draft: { id: 'th_4', citedDtuId: 'dtu_q' } }])).toEqual({ dtu_q: 'th_4' });
    expect(indexMapDrafts(null)).toEqual({});
  });

  it('body names the source and says nothing was published', () => {
    const body = mapBody(facts);
    expect(body).toContain('Every figure here came from the Graph domain');
    expect(body).toContain('Nothing was published by saving this');
  });
});