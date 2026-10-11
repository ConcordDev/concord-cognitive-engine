/**
 * /lenses/reflection community panel must not call reddit.com from the
 * browser. A failed same-origin listing shows an honest unavailable state
 * and never a fabricated post. A cached payload is labeled.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

vi.mock('@/components/dtu/SaveAsDtuButton', () => ({
  SaveAsDtuButton: () => null,
}));

import { ReflectionFeed } from '@/components/reflection/ReflectionFeed';

const FETCH_REDDIT = /fetch\s*\(\s*[`'"]https?:\/\/(?:www\.|old\.|api\.|oauth\.)?reddit\.com/;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.next') continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (name.endsWith('.ts') || name.endsWith('.tsx')) out.push(p);
  }
  return out;
}

function renderFeed() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: 1, retryDelay: 0 } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ReflectionFeed />
    </QueryClientProvider>,
  );
}

describe('ReflectionFeed community listing', () => {
  const calls: string[] = [];

  beforeEach(() => {
    calls.length = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url.includes('reddit.com')) throw new TypeError('Failed to fetch');
      return new Response(JSON.stringify({ ok: false, reason: 'community_feed_unavailable' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      });
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does not fetch reddit.com and shows an honest unavailable state', async () => {
    renderFeed();
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Community feed unavailable.'));
    expect(screen.queryByText('No posts.')).toBeNull();
    expect(screen.queryByText('Morning pages that stuck')).toBeNull();
    expect(calls.length).toBe(1);
    expect(calls[0]).toContain('/api/community/reddit-listing?');
    expect(calls[0]).toContain('sub=Journaling');
    expect(calls[0]).toContain('t=week');
    expect(calls[0]).not.toContain('reddit.com');
  });

  it('renders the posts the server returned and does not label a fresh pull as cached', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return new Response(JSON.stringify({
        ok: true,
        cached: false,
        stale: false,
        fetchedAt: 2,
        posts: [{
          id: 'abc123',
          title: 'Morning pages that stuck',
          permalink: '/r/Journaling/comments/abc123/morning_pages/',
          author: 'ada',
          score: 42,
          num_comments: 7,
        }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }));
    renderFeed();
    await waitFor(() => expect(screen.getByText('Morning pages that stuck')).toBeInTheDocument());
    expect(screen.queryByText('Community feed unavailable.')).toBeNull();
    expect(screen.queryByText('cached')).toBeNull();
    expect(screen.queryByText(/may be stale/)).toBeNull();
    const link = screen.getByRole('link', { name: /Morning pages that stuck/ });
    expect(link.getAttribute('href')).toBe('https://reddit.com/r/Journaling/comments/abc123/morning_pages/');
    expect(calls.some((url) => url.includes('reddit.com'))).toBe(false);
  });

  it('labels cached posts and still shows the cached titles', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      cached: true,
      stale: true,
      fetchedAt: 1,
      posts: [{
        id: 'abc123',
        title: 'Morning pages that stuck',
        permalink: '/r/Journaling/comments/abc123/morning_pages/',
        author: 'ada',
        score: 42,
        num_comments: 7,
      }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })));
    renderFeed();
    await waitFor(() => expect(screen.getByText('Morning pages that stuck')).toBeInTheDocument());
    expect(screen.getByText('cached · may be stale')).toBeInTheDocument();
    expect(screen.queryByText('Community feed unavailable.')).toBeNull();
  });

  it('shows an empty state when the server returns no posts', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      ok: true, posts: [], cached: false, stale: false, fetchedAt: 1,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })));
    renderFeed();
    await waitFor(() => expect(screen.getByText('No posts.')).toBeInTheDocument());
    expect(screen.queryByText('Community feed unavailable.')).toBeNull();
    expect(screen.queryByText('cached')).toBeNull();
  });

  it('no concord-frontend tsx file fetches reddit.com directly', () => {
    const root = join(__dirname, '..');
    const files = [
      ...walk(join(root, 'components')),
      ...walk(join(root, 'app')),
      ...walk(join(root, 'lib')),
    ];
    const offenders = files.filter((file) => FETCH_REDDIT.test(readFileSync(file, 'utf8')));
    expect(offenders).toEqual([]);
    const feed = readFileSync(join(root, 'components/reflection/ReflectionFeed.tsx'), 'utf8');
    expect(feed).toContain('fetchRedditListing');
    expect(feed).not.toMatch(/fetch\(\s*`https:\/\/www\.reddit\.com/);
    // The remaining reddit.com string is DTU provenance (not a browser fetch).
    expect(feed).toContain('apiUrl={`https://www.reddit.com/r/${sub}/top.json?t=${windowKey}`}');
  });
});
