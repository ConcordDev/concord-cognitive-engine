import { describe, it, expect } from 'vitest';
import {
  deckSentence,
  deckBody,
  deckReportDtuCall,
  deckThreadDraftCall,
  deckThreadDraftOutcome,
  indexDeckDrafts,
  type SrsFacts,
} from '@/components/srs/srsDeckReport';

const facts: SrsFacts = {
  deck: { id: 'deck_001', name: 'Spanish Vocab', cardCount: 50, newCount: 10, dueCount: 15, studyCount: 25 },
  dashboard: { decks: 3, totalCards: 150, newCards: 30, dueCards: 45, matureCards: 60, suspendedCards: 2, reviewsLogged: 500 },
  stats: { totalReviews: 500, accuracy: 0.85, ratingBreakdown: { again: 50, hard: 80, good: 300, easy: 70 } },
  cardCount: 50,
};

describe('srs deck report', () => {
  it('states only the figures the backend reported', () => {
    const s = deckSentence(facts)!;
    expect(s).toContain('Spanish Vocab');
    expect(s).toContain('50 cards');
    expect(s).toContain('15 due');
    expect(s).toContain('10 new');
    expect(s).toContain('500 reviews');
    expect(s).toContain('85% accuracy');
    expect(s).toContain('60 mature');
  });

  it('refuses to summarise a deck with no identity', () => {
    expect(deckSentence({ ...facts, deck: null })).toBeNull();
    expect(deckSentence({ ...facts, deck: { ...facts.deck!, id: '' } })).toBeNull();
    expect(deckBody({ ...facts, deck: null })).toBe('');
    expect(deckReportDtuCall({ ...facts, deck: null })).toBeNull();
  });

  it('says so when the deck has no cards, instead of inventing figures', () => {
    const bare: SrsFacts = { deck: { id: 'deck_2', name: 'Empty Deck' }, dashboard: null, stats: null, cardCount: 0 };
    expect(deckSentence(bare)).toContain('no cards yet');
  });

  it('builds a private deck-report DTU carrying the same numbers', () => {
    const call = deckReportDtuCall(facts)!;
    expect(call.domain).toBe('dtu');
    expect(call.action).toBe('create');
    expect(call.input.source).toBe('srs-lens:deck-report');
    expect((call.input.meta as Record<string, unknown>).visibility).toBe('private');
    expect(call.input.machine).toMatchObject({
      kind: 'srs_deck_report',
      deckId: 'deck_001',
      deckName: 'Spanish Vocab',
      cardCount: 50,
      dueCount: 15,
      newCount: 10,
      matureCards: 60,
      reviewsLogged: 500,
      totalReviews: 500,
      accuracy: 0.85,
    });
  });

  it('will not draft without a real DTU id to cite', () => {
    expect(deckThreadDraftCall(facts, '')).toBeNull();
    expect(deckThreadDraftCall(facts, 'not an id')).toBeNull();
    const call = deckThreadDraftCall(facts, 'dtu_abc123')!;
    expect(call.domain).toBe('thread');
    expect(call.action).toBe('thread-draft');
    expect(call.input.citedDtuId).toBe('dtu_abc123');
    expect(String(call.input.content)).toContain('Nothing was published');
  });

  it('claims a draft only when Thread kept the exact cite and did not post', () => {
    const ok = { ok: true, result: { draft: { id: 'th_1', status: 'draft', citedDtuId: 'dtu_abc123' } } };
    expect(deckThreadDraftOutcome(ok, 'dtu_abc123')).toEqual({ draftId: 'th_1', status: 'draft', citedDtuId: 'dtu_abc123' });

    expect(deckThreadDraftOutcome({ ok: false, error: 'cited DTU not found' }, 'dtu_abc123')).toBeNull();
    expect(deckThreadDraftOutcome({ ok: true, result: { draft: { id: 'th_1', status: 'draft', citedDtuId: 'dtu_other' } } }, 'dtu_abc123')).toBeNull();
    expect(deckThreadDraftOutcome({ ok: true, result: { draft: { id: 'th_1', status: 'published', citedDtuId: 'dtu_abc123' } } }, 'dtu_abc123')).toBeNull();
    expect(deckThreadDraftOutcome(null, 'dtu_abc123')).toBeNull();
  });

  it('indexes drafts by the DTU they cite after a reload', () => {
    const index = indexDeckDrafts([
      { ok: true, result: { draft: { id: 'th_1', citedDtuId: 'dtu_abc123' } } },
      { ok: true, result: { draft: { id: 'th_2', citedDtuId: null } } },
      { ok: true, result: { draft: { id: 'th_3', citedDtuId: 'dtu_zzz' } } },
      { ok: false, error: 'draft not found' },
      null,
    ]);
    expect(index).toEqual({ dtu_abc123: 'th_1', dtu_zzz: 'th_3' });
    expect(indexDeckDrafts(null)).toEqual({});
  });

  it('body names the source and says nothing was published', () => {
    const body = deckBody(facts);
    expect(body).toContain('Every figure here came from the SRS domain');
    expect(body).toContain('Nothing was published by saving this');
  });
});