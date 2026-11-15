/**
 * FIX-dtus-006 (RCA-ask-silent) — Ask under dtus context explained the
 * Regular, MEGA and HYPER tiers but omitted Shadow, because the dtus
 * domain had no facts provider at all: the analyst answered from
 * general knowledge instead of the lens's own data. The provider now
 * grounds the tier vocabulary in the DTU Browser's own filter (all
 * four tiers) and the per-tier counts in the Browser's own paginated
 * read.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = vi.hoisted(() => ({ totals: new Map<string, number>(), fail: false }));

vi.mock('@/lib/api/client', () => ({
  lensRun: async () => ({ data: { ok: false, error: 'not mocked' } }),
  api: { get: async () => { throw new Error('not mocked'); } },
  apiHelpers: {
    dtus: {
      paginated: async (params: { tier?: string }) => {
        if (state.fail) throw new Error('down');
        return { data: { ok: true, total: state.totals.get(params.tier || '') ?? 0, dtus: [] } };
      },
    },
  },
}));

import { buildLensFactsBlock } from '@/components/chat/lensAccountFacts';

beforeEach(() => {
  state.totals.clear();
  state.fail = false;
  state.totals.set('regular', 12);
  state.totals.set('mega', 3);
  state.totals.set('hyper', 1);
  state.totals.set('shadow', 7);
});

describe('dtus facts (FIX-dtus-006)', () => {
  it('grounds all four tiers — Shadow included — with the Browser counts', async () => {
    const block = await buildLensFactsBlock('dtus');
    expect(block).toContain('ACCOUNT FACTS — DTUs');
    expect(block).toContain('Regular, MEGA, HYPER and Shadow');
    expect(block).toContain('Shadow: working DTUs that start as shadows');
    expect(block).toContain('Your DTUs by tier: 12 regular, 3 mega, 1 hyper, 7 shadow');
    expect(block).toContain('never present a subset of the tiers as the whole set');
  });

  it('an unreadable count drops the counts fact and names it; the vocabulary stands', async () => {
    state.fail = true;
    const block = await buildLensFactsBlock('dtus');
    expect(block).toContain('DTU tiers');
    expect(block).not.toContain('Your DTUs by tier');
    expect(block).toContain('Not readable just now: the per-tier DTU counts.');
  });
});
