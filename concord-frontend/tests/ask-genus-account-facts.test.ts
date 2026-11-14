// FIX-attention-005 · FIX-defense-006 · FIX-feed-009 · FIX-hypothesis-006
// (RCA-ask-silent) — the four Ask launches grounded the analyst in a
// context label and nothing else, so it punted (attention), answered
// from generic web results (defense), or answered about another lens
// out of a reused thread's history (feed, hypothesis). These pins hold
// the GB-1081 provider pattern for the four domains: the facts block
// is composed from the surface's OWN reads (each surface's calls
// mirrored), present values render as read, and an unreadable surface
// yields the decline block instead of silence.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = vi.hoisted(() => ({
  runs: new Map<string, unknown>(),
  gets: new Map<string, unknown>(),
}));

vi.mock('@/lib/api/client', () => ({
  lensRun: async (domain: string, action: string) =>
    state.runs.get(`${domain}:${action}`) ?? { data: { ok: false, error: 'not mocked' } },
  api: {
    get: async (url: string) => {
      const v = state.gets.get(url);
      if (v instanceof Error) throw v;
      if (v === undefined) throw new Error('not mocked');
      return { data: v };
    },
  },
  apiHelpers: {},
}));

import { buildLensFactsBlock } from '@/components/chat/lensAccountFacts';

function run(domain: string, action: string, result: unknown, ok = true) {
  state.runs.set(`${domain}:${action}`, { data: { ok, result, error: ok ? undefined : 'boom' } });
}

function defenseBoards() {
  run('defense', 'asset-rollup', { total: 10, inService: 8, fleetReadiness: 87, availabilityPct: 75 });
  run('defense', 'threat-board', { total: 4, highestSeverity: 'high', activeWatch: 3 });
  run('defense', 'personnel-roster', { total: 12, deployable: 7 });
  run('defense', 'supply-board', { total: 9, openCount: 2, fulfillmentPct: 78 });
}

beforeEach(() => {
  state.runs.clear();
  state.gets.clear();
});

describe('defense facts (FIX-defense-006)', () => {
  it('composes the block from the four readiness boards the surface renders', async () => {
    defenseBoards();
    const block = await buildLensFactsBlock('defense');
    expect(block).toContain('ACCOUNT FACTS — Defense');
    expect(block).toContain('Fleet readiness: 87% across 8 in-service assets (10 total, 75% available)');
    expect(block).toContain('(source: Defense Dashboard stats — defense.asset-rollup)');
    expect(block).toContain('Threat picture: 4 tracked threats — highest severity high, 3 on active watch');
    expect(block).toContain('Personnel: 12 on the roster, 7 available to deploy');
    expect(block).toContain('Supply: 9 supply requests — 2 open, fulfillment 78%');
    expect(block).toContain('never describe readiness, threats, personnel, or supply from general knowledge');
  });

  it('names a failed board as unreadable instead of zero-filling it', async () => {
    defenseBoards();
    run('defense', 'threat-board', undefined, false);
    const block = await buildLensFactsBlock('defense');
    expect(block).toContain('Not readable just now: the threat board');
    expect(block).not.toContain('Threat picture');
    expect(block).toContain('Fleet readiness: 87%');
  });

  it('declines when no readiness board answers', async () => {
    const block = await buildLensFactsBlock('defense');
    expect(block).toContain('ACCOUNT FACTS — Defense could not be read just now');
  });
});

describe('attention facts (FIX-attention-005)', () => {
  it('grounds the analyst in the live focus and thread state', async () => {
    run('attention', 'status', {
      focus: 'idle', activeThreads: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
      queueLength: 2, stats: { threadsCompleted: 5 },
    });
    run('attention', 'list_threads', { threads: [{ description: 'Summarise the morning brief' }] });
    const block = await buildLensFactsBlock('attention');
    expect(block).toContain('ACCOUNT FACTS — Attention');
    expect(block).toContain('Attention state: 3 active threads, 2 queued — current focus: idle, 5 completed');
    expect(block).toContain('Top thread: Summarise the morning brief');
    expect(block).toContain('never ask which lens the user means');
  });

  it('accepts the numeric status shape as well as the array shape', async () => {
    run('attention', 'status', { activeThreads: 1, queueDepth: 4 });
    run('attention', 'list_threads', { threads: [] });
    const block = await buildLensFactsBlock('attention');
    expect(block).toContain('Attention state: 1 active threads, 4 queued');
  });

  it('declines when the attention status cannot be read', async () => {
    const block = await buildLensFactsBlock('attention');
    expect(block).toContain('ACCOUNT FACTS — Attention could not be read just now');
  });
});

describe('feed facts (FIX-feed-009)', () => {
  it('composes the block from the timeline hook’s own endpoints', async () => {
    state.gets.set('/api/social/feed/foryou', { posts: Array.from({ length: 20 }, (_, i) => ({ id: `p${i}` })) });
    state.gets.set('/api/social/scheduled', { scheduled: [{ id: 's1' }, { id: 's2' }, { id: 's3' }] });
    state.gets.set('/api/social/bookmarks', ['b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7']);
    const block = await buildLensFactsBlock('feed');
    expect(block).toContain('ACCOUNT FACTS — Feed');
    expect(block).toContain('For You timeline: 20 posts on the first page');
    expect(block).toContain('(source: Feed timeline — GET /api/social/feed/foryou)');
    expect(block).toContain('Scheduled posts: 3 scheduled');
    expect(block).toContain('Bookmarks: 7 bookmarked posts');
    expect(block).toContain('never describe another lens');
  });

  it('declines when the timeline cannot be read', async () => {
    state.gets.set('/api/social/feed/foryou', new Error('down'));
    const block = await buildLensFactsBlock('feed');
    expect(block).toContain('ACCOUNT FACTS — Feed could not be read just now');
  });
});

describe('hypothesis facts (FIX-hypothesis-006)', () => {
  it('composes the block from the lab’s metrics and list, confidence rendered as the lab renders it', async () => {
    run('hypothesis', 'metrics', {
      total: 12, byStatus: { proposed: 5, testing: 2, confirmed: 3, rejected: 1, refined: 1, archived: 0 },
      avgConfidence: 0.42, factDTUsCreated: 4, rejectionDTUsCreated: 1,
    });
    run('hypothesis', 'list', [
      { id: 'h1', machine: { kind: 'hypothesis', hypothesis: { statement: 'Sleep improves recall', status: 'testing' } } },
    ]);
    const block = await buildLensFactsBlock('hypothesis');
    expect(block).toContain('ACCOUNT FACTS — Hypothesis');
    expect(block).toContain('Hypotheses: 12 tracked — 5 proposed, 2 testing, 3 confirmed, 1 rejected, 1 refined; average confidence 42%');
    expect(block).toContain('Outcomes: 4 fact DTUs created, 1 rejection DTUs');
    expect(block).toContain('Most recent hypothesis: Sleep improves recall');
  });

  it('declines when the hypothesis metrics cannot be read', async () => {
    const block = await buildLensFactsBlock('hypothesis');
    expect(block).toContain('ACCOUNT FACTS — Hypothesis could not be read just now');
  });
});
