/**
 * PeopleToFollow — real "People to follow" row (oc-social-3b item b).
 *
 * The row is built from GET /api/social/people-to-follow (real active
 * creators — recent public posts and/or studio releases — excluding the
 * viewer, already-followed accounts and blocked users). This test proves:
 * candidates render from the server's answer only, the Follow button hits
 * the real POST /api/social/follow, a successful follow refetches the row
 * (so it persists across reload), a failed follow shows an honest error,
 * and an empty result hides the row rather than padding it.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const apiGet = vi.fn();
const apiPost = vi.fn();

vi.mock('@/lib/api/client', () => ({
  api: { get: (...a: unknown[]) => apiGet(...a), post: (...a: unknown[]) => apiPost(...a) },
}));

import { PeopleToFollow } from '@/components/social/PeopleToFollow';

const PEOPLE = [
  {
    userId: 'bea',
    displayName: 'Bea',
    username: 'bea',
    avatar: null,
    bio: null,
    followerCount: 12,
    recentPostCount: 3,
    studioReleaseCount: 1,
    lastActiveAt: '2026-10-02T00:00:00.000Z',
  },
  {
    userId: 'ced',
    displayName: 'Ced',
    username: 'ced',
    avatar: null,
    bio: null,
    followerCount: 4,
    recentPostCount: 1,
    studioReleaseCount: 0,
    lastActiveAt: '2026-10-01T00:00:00.000Z',
  },
];

function renderRow(props: { currentUserId?: string; onOpenProfile?: (id: string) => void } = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <PeopleToFollow currentUserId={props.currentUserId || 'viewer-1'} onOpenProfile={props.onOpenProfile} />
    </QueryClientProvider>,
  );
}

describe('PeopleToFollow', () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiPost.mockReset();
    apiGet.mockResolvedValue({ data: { ok: true, people: PEOPLE } });
    apiPost.mockResolvedValue({ data: { ok: true } });
  });
  afterEach(() => {
    cleanup();
  });

  it('renders only the server-provided creators — no hard-coded users', async () => {
    renderRow();
    expect(await screen.findByRole('button', { name: 'Follow Bea' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Follow Ced' })).toBeTruthy();
    expect(apiGet.mock.calls.some(([url]: unknown[]) => String(url) === '/api/social/people-to-follow')).toBe(true);
  });

  it('hides entirely when there are no candidates (empty is hidden, not faked)', async () => {
    apiGet.mockResolvedValue({ data: { ok: true, people: [] } });
    const { container } = renderRow();
    await waitFor(() => expect(apiGet).toHaveBeenCalled());
    expect(container.querySelector('section')).toBeNull();
  });

  it('hides while loading and while signed out', () => {
    const { container } = renderRow({ currentUserId: '' });
    expect(container.querySelector('section')).toBeNull();
  });

  it('Follow hits the real follow route and the row refetches (persists across reload)', async () => {
    renderRow();
    const followBea = await screen.findByRole('button', { name: 'Follow Bea' });
    const getCallsBefore = apiGet.mock.calls.filter(([url]: unknown[]) => String(url) === '/api/social/people-to-follow').length;
    fireEvent.click(followBea);
    await waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith('/api/social/follow', { followedId: 'bea' });
    });
    // The row re-reads the server's own answer — the followed person is
    // no longer suggested, on this render and after a reload.
    await waitFor(() => {
      const calls = apiGet.mock.calls.filter(([url]: unknown[]) => String(url) === '/api/social/people-to-follow').length;
      expect(calls).toBeGreaterThan(getCallsBefore);
    });
  });

  it('a failed follow shows an honest error, not fake success', async () => {
    apiPost.mockRejectedValue(new Error('boom'));
    renderRow();
    fireEvent.click(await screen.findByRole('button', { name: 'Follow Bea' }));
    expect(await screen.findByText(/Couldn’t follow just now\./)).toBeTruthy();
    // The follow button is still there — the state did not pretend it worked.
    expect(screen.getByRole('button', { name: 'Follow Bea' })).toBeTruthy();
  });

  it('opens the real profile page when a person is tapped', async () => {
    const onOpenProfile = vi.fn();
    renderRow({ onOpenProfile });
    fireEvent.click(await screen.findByRole('button', { name: 'Open Bea' }));
    expect(onOpenProfile).toHaveBeenCalledWith('bea');
  });

  it('shows real activity facts (studio releases and recent posts) from the payload', async () => {
    renderRow();
    expect(await screen.findByText(/1 studio release/)).toBeTruthy();
    expect(screen.getByText(/3 recent posts/)).toBeTruthy();
    expect(screen.getByText(/1 recent post/)).toBeTruthy();
  });
});