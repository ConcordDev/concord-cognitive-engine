/**
 * FIX-supplychain-005 — the Supply Chain lens's Lighthouse a11y
 * bundle: contrast + touch targets (expected a11y >= 95).
 *
 * All 6 selects named (org type, member role, organization,
 * subreddit, time window, disruption type). The OrgCollab and
 * Planner selects/inputs share a per-file INPUT class const, which
 * now carries the min-h-11 floor for every control using it; the
 * Feed pair and the 9px role-edit select are floored individually.
 * Headings: one panel per page view — Team Collaboration,
 * Scorecards & quick analysis, and Integrated Planning Workbench
 * titles are h2 under the frame h1. Contrast: zinc-500/600 text
 * raised to zinc-400 across OrgCollab, ActionPanel, Overview and
 * Planner.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import * as fs from 'node:fs';
import * as path from 'node:path';

vi.mock('@/lib/api/client', () => ({
  lensRun: vi.fn(async () => ({ data: { ok: true, result: { posts: [] } } })),
  api: { get: vi.fn(async () => ({ data: null })), post: vi.fn(async () => ({ data: null })) },
}));

// The feed is flag-gated off by default; enable it and stub the listing.
vi.mock('@/lib/community/reddit-flag', () => ({ isCommunityRedditEnabled: () => true }));
vi.mock('@/lib/community/reddit-listing', () => ({
  fetchRedditListing: vi.fn(async () => ({ posts: [], cached: false, stale: false })),
  RedditCacheLabel: () => null,
}));

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SupplyChainFeed } from '@/components/supplychain/SupplyChainFeed';

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

function openingTag(src: string, start: number): string {
  let depth = 0;
  for (let k = start; k < src.length; k++) {
    const c = src[k];
    if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (c === '>' && depth === 0) return src.slice(start, k + 1);
  }
  return src.slice(start);
}

describe('FIX-supplychain-005 — supplychain a11y bundle', () => {
  it('Feed: subreddit and time-window selects are named and floored', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <SupplyChainFeed />
      </QueryClientProvider>,
    );
    for (const lab of ['Subreddit', 'Time window']) {
      const sel = await screen.findByLabelText(lab);
      expect(sel.className).toContain('min-h-11');
    }
  });

  it('INPUT consts carry the floor; every supplychain select is named', () => {
    for (const f of ['OrgCollabPanel.tsx', 'SupplyChainPlanner.tsx']) {
      expect(read(`components/supplychain/${f}`)).toContain("const INPUT = 'min-h-11 w-full");
    }
    const files = fs
      .readdirSync(path.join(process.cwd(), 'components', 'supplychain'))
      .filter((x) => x.endsWith('.tsx'))
      .map((x) => `components/supplychain/${x}`);
    let count = 0;
    for (const f of [...files, 'app/lenses/supplychain/page.tsx']) {
      const src = read(f);
      let i = 0;
      for (;;) {
        const j = src.indexOf('<select', i);
        if (j < 0) break;
        count++;
        const tag = openingTag(src, j);
        const pre = src.slice(0, j);
        const wrapped = pre.lastIndexOf('<label') > pre.lastIndexOf('</label>');
        expect(tag.includes('aria-label') || wrapped, `${f}: select without a name`).toBe(true);
        const floored = tag.includes('min-h-11') || tag.includes('INPUT');
        expect(floored, `${f}: select without the target floor`).toBe(true);
        i = j + tag.length;
      }
    }
    expect(count).toBe(6);
  });

  it('no zinc-500/600 text remains in the four dim files', () => {
    for (const f of ['OrgCollabPanel.tsx', 'SupplyChainActionPanel.tsx', 'SupplyChainOverview.tsx', 'SupplyChainPlanner.tsx']) {
      const src = read(`components/supplychain/${f}`);
      expect(src.includes('text-zinc-500'), `${f}`).toBe(false);
      expect(src.includes('text-zinc-600'), `${f}`).toBe(false);
    }
  });
});
