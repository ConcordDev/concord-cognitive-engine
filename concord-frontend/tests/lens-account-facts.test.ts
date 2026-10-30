/**
 * Lens account facts for the Chat analyst (Review 4 — Analytics F1).
 *
 * The analyst used to receive a context label and no data, and invented
 * account numbers ("About 43 DTUs" against a true 26). These tests pin the
 * grounded-or-decline contract of buildLensFactsBlock:
 *   GROUNDED  — facts are composed from the same endpoints the Analytics
 *               Overview renders, each citing its card + endpoint.
 *   ZERO IS A FACT — a present 0 (the A20 Total Reach case) is included as
 *               0, never treated as missing.
 *   PARTIAL FAILURE NAMES ITSELF — an unreadable source is named in the
 *               block, never zero-filled or silently dropped.
 *   TOTAL FAILURE DECLINES — no facts at all ⇒ a decline instruction,
 *               never an estimate.
 *   OTHER DOMAINS UNCHANGED — no provider ⇒ empty block.
 *
 * The client is mocked at '@/lib/api/client' in the exact envelopes the
 * module consumes; no server behaviour is fabricated beyond those contracts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const apiGet = vi.fn();
const myDtus = vi.fn();

vi.mock('@/lib/api/client', () => ({
  api: { get: (...a: unknown[]) => apiGet(...a) },
  apiHelpers: { dtus: { myDtus: (...a: unknown[]) => myDtus(...a) } },
}));
vi.mock('@/lib/utils', () => ({
  formatNumber: (n: number) => n.toLocaleString('en-US'),
}));

import { buildLensFactsBlock } from '@/components/chat/lensAccountFacts';

function wireHappyPath() {
  apiGet.mockImplementation((url: string) => {
    if (url === '/api/social/profile') {
      return Promise.resolve({
        data: { profile: { userId: 'qa-user', stats: { citationCount: 26 } } },
      });
    }
    if (url === '/api/economy/transactions') {
      return Promise.resolve({
        data: { transactions: [], summary: { royaltyTotal: 0, salesTotal: 0, total: 0 } },
      });
    }
    if (url === '/api/social/followers/qa-user') {
      return Promise.resolve({ data: { followers: [{}, {}, {}], count: 3 } });
    }
    if (url === '/api/social/analytics/creator') {
      return Promise.resolve({
        data: { overview: { totalReach: 0, engagementRate: 0, followerCount: 3 } },
      });
    }
    return Promise.reject(new Error(`unexpected ${url}`));
  });
  myDtus.mockImplementation(() =>
    Promise.resolve({ data: { dtus: [{}], total: 26 } }),
  );
}

beforeEach(() => {
  apiGet.mockReset();
  myDtus.mockReset();
});

describe('buildLensFactsBlock — analytics grounding (F1)', () => {
  it('composes the account facts from the Overview substrate, with sources', async () => {
    wireHappyPath();
    const block = await buildLensFactsBlock('analytics');
    expect(block).toContain('Total DTUs: 26');
    expect(block).toContain('GET /api/dtus/mine');
    expect(block).toContain('Citations: 26');
    expect(block).toContain('Followers: 3');
    expect(block).toContain('Total CC moved: 0');
    // Total DTUs leads the block — the question the analyst got wrong.
    expect(block.indexOf('Total DTUs')).toBeLessThan(block.indexOf('Citations'));
  });

  it('renders a present zero as a fact, never as missing (A20 reach case)', async () => {
    wireHappyPath();
    const block = await buildLensFactsBlock('analytics');
    expect(block).toContain('Total Reach: 0');
    expect(block).toContain('Engagement Rate: 0.0%');
    expect(block).not.toContain('Not readable');
  });

  it('states the facts override examples and carries the decline rule', async () => {
    wireHappyPath();
    const block = await buildLensFactsBlock('analytics');
    expect(block).toContain('override any examples');
    expect(block).toContain('name the source you used');
    expect(block).toContain('never estimate');
  });

  it('reads the creator endpoint flat shape too (the endpoint has two consumers)', async () => {
    wireHappyPath();
    apiGet.mockImplementation((url: string) => {
      if (url === '/api/social/analytics/creator') {
        return Promise.resolve({ data: { totalReach: 12, engagementRate: 2.5 } });
      }
      if (url === '/api/social/profile') {
        return Promise.resolve({
          data: { profile: { userId: 'qa-user', stats: { citationCount: 1 } } },
        });
      }
      if (url === '/api/economy/transactions') {
        return Promise.resolve({ data: { summary: { total: 5 } } });
      }
      if (url === '/api/social/followers/qa-user') {
        return Promise.resolve({ data: { followers: [], count: 0 } });
      }
      return Promise.reject(new Error(`unexpected ${url}`));
    });
    const block = await buildLensFactsBlock('analytics');
    expect(block).toContain('Total Reach: 12');
    expect(block).toContain('Engagement Rate: 2.5%');
  });

  it('a failed source is named as unreadable — never zero-filled', async () => {
    wireHappyPath();
    myDtus.mockImplementation(() => Promise.reject(new Error('down')));
    const block = await buildLensFactsBlock('analytics');
    expect(block).toContain('Citations: 26');
    expect(block).not.toContain('Total DTUs:');
    expect(block).toContain('Not readable just now');
    expect(block).toContain('Total DTUs (GET /api/dtus/mine)');
  });

  it('total read failure yields a decline block, not an estimate', async () => {
    apiGet.mockImplementation(() => Promise.reject(new Error('down')));
    myDtus.mockImplementation(() => Promise.reject(new Error('down')));
    const block = await buildLensFactsBlock('analytics');
    expect(block).toContain('could not be read');
    expect(block).toContain('never estimate or invent');
    expect(block).not.toContain('Total DTUs:');
  });

  it('a domain without a provider returns an empty block (prior behaviour)', async () => {
    const block = await buildLensFactsBlock('projects');
    expect(block).toBe('');
    expect(apiGet).not.toHaveBeenCalled();
    expect(myDtus).not.toHaveBeenCalled();
  });

  it('an empty domain returns an empty block', async () => {
    expect(await buildLensFactsBlock('')).toBe('');
  });
});
