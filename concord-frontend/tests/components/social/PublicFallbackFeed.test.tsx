/**
 * PublicFallbackFeed — never an empty first screen (oc-social-3b item a).
 *
 * When the Following timeline has nothing to show, Home fills with real
 * recent PUBLIC posts served by the existing /api/social/feed/explore
 * route. This test proves: the fallback renders those posts, shows the
 * clear "Follow people to fill this feed" prompt, renders attached media
 * through the real PostMediaCard, and falls back to the honest empty
 * state (no fabricated rows) when the site itself has no posts.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const apiGet = vi.fn();

vi.mock('@/lib/api/client', () => ({
  api: { get: (...a: unknown[]) => apiGet(...a), post: vi.fn() },
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), prefetch: vi.fn(), replace: vi.fn() }),
}));
vi.mock('next/image', () => ({
  default: (props: { alt?: string }) => React.createElement('img', { alt: props.alt || '' }),
}));

import { PublicFallbackFeed } from '@/components/social/PublicFallbackFeed';

function renderFeed(props: { currentUserId?: string; onFindPeople?: () => void } = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <PublicFallbackFeed currentUserId={props.currentUserId || 'viewer-1'} onFindPeople={props.onFindPeople} />
    </QueryClientProvider>,
  );
}

const EXPLORE_POSTS = [
  {
    id: 'pub1',
    userId: 'bea',
    username: 'bea',
    displayName: 'Bea',
    content: 'a public post from across the site',
    createdAt: '2026-10-01T00:00:00.000Z',
    mediaType: 'text',
    mediaUrl: null,
    listing: null,
  },
  {
    id: 'pub2',
    userId: 'ced',
    username: 'ced',
    displayName: 'Ced',
    content: 'shared a marketplace item',
    createdAt: '2026-10-02T00:00:00.000Z',
    mediaType: 'listing',
    mediaUrl: null,
    listing: {
      id: 'list-1',
      title: 'Track',
      price: 12,
      currency: 'CC',
      transferRate: 0.02,
      marketplaceRate: 0.03,
    },
  },
];

describe('PublicFallbackFeed', () => {
  beforeEach(() => {
    apiGet.mockReset();
  });
  afterEach(() => {
    cleanup();
  });

  it('renders real public posts from the explore route when Following is empty', async () => {
    apiGet.mockResolvedValue({ data: { ok: true, posts: EXPLORE_POSTS } });
    renderFeed();
    expect(await screen.findByText('a public post from across the site')).toBeTruthy();
    expect(screen.getByText('Recent posts from around Concord')).toBeTruthy();
    // The clear prompt, exactly as the spec words it.
    expect(screen.getByRole('button', { name: 'Find people to follow' })).toHaveTextContent('Follow people to fill this feed');
    // It reads the existing public-posts route, not a new one.
    expect(apiGet.mock.calls.some(([url]: unknown[]) => String(url) === '/api/social/feed/explore')).toBe(true);
  });

  it('shows the Find people prompt which opens Explore', async () => {
    apiGet.mockResolvedValue({ data: { ok: true, posts: EXPLORE_POSTS } });
    const onFindPeople = vi.fn();
    renderFeed({ onFindPeople });
    fireEvent.click(await screen.findByRole('button', { name: 'Find people to follow' }));
    expect(onFindPeople).toHaveBeenCalledTimes(1);
  });

  it('renders a listing attachment as a real media card with the listing fields', async () => {
    apiGet.mockResolvedValue({ data: { ok: true, posts: [EXPLORE_POSTS[1]] } });
    renderFeed();
    // SocialCommerceTag's card shows the real title from the listing row.
    expect(await screen.findByText('Track')).toBeTruthy();
    expect(screen.getByText(/12 CC/)).toBeTruthy();
    // Fee rates read from the listing payload (which the server copied
    // from economy/fees.js) — never hard-coded percentages.
    expect(screen.getByText(/transfer fee 2\.00%/)).toBeTruthy();
    expect(screen.getByText(/marketplace fee 3\.00%/)).toBeTruthy();
  });

  it('shows the honest empty state when the site has no public posts at all', async () => {
    apiGet.mockResolvedValue({ data: { ok: true, posts: [] } });
    renderFeed();
    expect(await screen.findByText('No activity yet')).toBeTruthy();
    expect(screen.queryByText('Recent posts from around Concord')).toBeNull();
  });

  it('does not render fabricated rows when the explore call fails', async () => {
    apiGet.mockRejectedValue(new Error('down'));
    renderFeed();
    expect(await screen.findByText(/Couldn’t load recent public posts/)).toBeTruthy();
    expect(screen.queryByText('Recent posts from around Concord')).toBeNull();
    expect(screen.queryByRole('list')).toBeNull();
  });
});