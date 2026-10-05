import { describe, it, expect } from 'vitest';
import {
  shareSentence,
  shareBody,
  shareDtuCall,
  shareThreadDraftCall,
  shareThreadDraftOutcome,
  indexShareDrafts,
  type WorldShareFacts,
} from '@/components/world/worldShareReport';

const facts: WorldShareFacts = {
  link: {
    id: 'wlink_1',
    worldId: 'concordia-hub',
    x: 10,
    y: 20,
    z: 30,
    note: 'Proof spot',
    url: '/lenses/world?world=concordia-hub&x=10.0&y=20.0&z=30.0&n=Proof%20spot',
    createdAt: '2026-10-05T00:00:00.000Z',
  },
};

describe('world share link report', () => {
  it('states only the figures the backend reported', () => {
    const s = shareSentence(facts)!;
    expect(s).toContain('concordia-hub');
    expect(s).toContain('(10.0, 20.0, 30.0)');
  });

  it('puts the link id in the sentence so two links to one world get distinct DTU titles', () => {
    const a = shareSentence({ link: { id: 'wlink_a', worldId: 'concordia-hub' } })!;
    const b = shareSentence({ link: { id: 'wlink_b', worldId: 'concordia-hub' } })!;
    expect(a).toContain('wlink_a');
    expect(a).not.toBe(b);
    expect(shareDtuCall({ link: { id: 'wlink_a', worldId: 'concordia-hub' } })!.input.title)
      .not.toBe(shareDtuCall({ link: { id: 'wlink_b', worldId: 'concordia-hub' } })!.input.title);
  });

  it('refuses to summarise a link with no id or worldId', () => {
    expect(shareSentence({ link: null })).toBeNull();
    expect(shareSentence({ link: { id: '', worldId: 'x' } })).toBeNull();
    expect(shareSentence({ link: { id: 'l', worldId: '' } })).toBeNull();
    expect(shareBody({ link: null })).toBe('');
    expect(shareDtuCall({ link: null })).toBeNull();
  });

  it('builds a private DTU call that cites the real link', () => {
    const call = shareDtuCall(facts)!;
    expect(call.domain).toBe('dtu');
    expect(call.action).toBe('create');
    expect(call.input.source).toBe('world-lens:share-link-report');
    expect(call.input.meta.visibility).toBe('private');
    expect((call.input.machine as Record<string, unknown>).kind).toBe('world_lens_share_link_report');
    expect((call.input.machine as Record<string, unknown>).linkId).toBe('wlink_1');
  });

  it('builds a Thread draft call that cites the DTU id', () => {
    const call = shareThreadDraftCall(facts, 'dtu_abc')!;
    expect(call.domain).toBe('thread');
    expect(call.action).toBe('thread-draft');
    expect(call.input.citedDtuId).toBe('dtu_abc');
  });

  it('refuses a Thread draft call with no DTU id', () => {
    expect(shareThreadDraftCall(facts, '')).toBeNull();
    expect(shareThreadDraftCall({ link: null }, 'dtu_abc')).toBeNull();
  });

  it('accepts a real draft outcome that cites the right DTU and stays draft', () => {
    const outcome = shareThreadDraftOutcome(
      { ok: true, result: { draft: { id: 'drf_1', status: 'draft', citedDtuId: 'dtu_abc' } } },
      'dtu_abc',
    )!;
    expect(outcome.draftId).toBe('drf_1');
    expect(outcome.status).toBe('draft');
  });

  it('rejects a draft outcome that does not cite the same DTU or is not draft', () => {
    expect(shareThreadDraftOutcome({ ok: true, result: { draft: { id: 'drf_1', status: 'draft', citedDtuId: 'other' } } }, 'dtu_abc')).toBeNull();
    expect(shareThreadDraftOutcome({ ok: true, result: { draft: { id: 'drf_1', status: 'posted', citedDtuId: 'dtu_abc' } } }, 'dtu_abc')).toBeNull();
    expect(shareThreadDraftOutcome({ ok: false }, 'dtu_abc')).toBeNull();
  });

  it('indexes drafts by the DTU they cite', () => {
    const idx = indexShareDrafts([
      { ok: true, result: { draft: { id: 'drf_1', status: 'draft', citedDtuId: 'dtu_a' } } },
      { ok: true, result: { draft: { id: 'drf_2', status: 'draft', citedDtuId: 'dtu_b' } } },
    ]);
    expect(idx.dtu_a).toBe('drf_1');
    expect(idx.dtu_b).toBe('drf_2');
  });
});