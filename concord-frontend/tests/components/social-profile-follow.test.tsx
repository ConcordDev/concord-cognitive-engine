// Audit fix sweep (PR #2356) — FIX-social-014: another user's profile
// page showed no Follow/Message buttons, only 'Copy ID' in the menu.
// The ['auth-me'] react-query key is shared: the shell (Topbar /
// RailAccount) caches the full { ok, user } envelope under it, while
// the social profile page cached only res.data.user. With the shell's
// envelope in the cache, the page resolved the viewer as signed out
// and UserProfile hid the whole action row. The page now caches the
// envelope like every other consumer and resolves the viewer from
// either cached shape.

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const apiGet = vi.fn();
vi.mock('@/lib/api/client', () => ({
  api: {
    get: (...a: unknown[]) => apiGet(...a),
    post: vi.fn(async () => ({ data: { ok: true } })),
  },
  lensRun: vi.fn(async () => ({ data: { ok: true, result: {} } })),
}));
vi.mock('next/navigation', () => ({
  useParams: () => ({ username: 'bea' }),
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock('@/hooks/use-open-post-in-place', () => ({
  useOpenPostInPlace: () => ({ openPostId: null, openPost: vi.fn(), closePost: vi.fn() }),
}));
vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));

import SocialProfilePage from '@/app/lenses/social/u/[username]/page';

const VIEWER = { id: 'viewer1', username: 'ana', displayName: 'Ana' };
const ENVELOPE = { ok: true, user: VIEWER };

const PROFILE = {
  userId: 'u2', displayName: 'Bea', username: 'bea', bio: 'maps', avatar: '',
  isPublic: true, specialization: [], website: '', createdAt: '2026-01-01T00:00:00Z',
  accent: null,
  stats: { dtuCount: 0, publicDtuCount: 0, citationCount: 0, followerCount: 3, followingCount: 1 },
};

beforeEach(() => {
  apiGet.mockReset();
  apiGet.mockImplementation(async (url: string) => {
    if (url === '/api/auth/me') return { data: ENVELOPE };
    if (url.includes('/api/social/users/by-username/')) return { data: { ok: true, user: { id: 'u2', username: 'bea' } } };
    if (url.includes('/api/social/profile/')) return { data: { profile: PROFILE } };
    if (url.includes('/api/social/posts/user/')) return { data: { posts: [], total: 0 } };
    if (url.includes('/api/social/following/')) return { data: { following: [] } };
    return { data: {} };
  });
});

function renderPage(seedAuthMe: unknown) {
  // Mirror the app's real QueryClient defaults (Providers.tsx:
  // staleTime 60s) — within that window a cache entry written by the
  // shell is served to this page's observer with no refetch, which is
  // exactly the production condition the ticket walked into.
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 60_000 } } });
  if (seedAuthMe !== undefined) qc.setQueryData(['auth-me'], seedAuthMe);
  return render(
    <QueryClientProvider client={qc}>
      <SocialProfilePage />
    </QueryClientProvider>,
  );
}

describe('Social profile page Follow row (FIX-social-014)', () => {
  it('shows Follow + Message when the auth-me cache holds the shell envelope shape', async () => {
    renderPage(ENVELOPE);
    await waitFor(() => expect(screen.getByRole('button', { name: /^Follow$/ })).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Message' })).toBeTruthy();
  });

  it('shows Follow + Message when the auth-me cache holds the bare user shape', async () => {
    renderPage(VIEWER);
    await waitFor(() => expect(screen.getByRole('button', { name: /^Follow$/ })).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Message' })).toBeTruthy();
  });

  it('shows no Follow row on your own profile', async () => {
    apiGet.mockImplementation(async (url: string) => {
      if (url === '/api/auth/me') return { data: { ok: true, user: { id: 'u2', username: 'bea' } } };
      if (url.includes('/api/social/users/by-username/')) return { data: { ok: true, user: { id: 'u2', username: 'bea' } } };
      if (url.includes('/api/social/profile/')) return { data: { profile: PROFILE } };
      if (url.includes('/api/social/posts/user/')) return { data: { posts: [], total: 0 } };
      return { data: {} };
    });
    renderPage(undefined);
    await waitFor(() => expect(screen.getByRole('button', { name: 'More options' })).toBeTruthy());
    expect(screen.queryByRole('button', { name: /^Follow$/ })).toBeNull();
  });
});
