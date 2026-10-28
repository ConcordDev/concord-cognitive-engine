/**
 * Timeline page northstar greeting.
 *
 * The Timeline concept (docs/lens-northstar/10) opens on the serif
 * headline "When it lands, Ramaj". This pins the page header carrying
 * it with the signed-in username. Panels are mocked away — the
 * greeting lives in the page's own header.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'u1', username: 'ramaj' } }),
}));
vi.mock('@/hooks/useLensNav', () => ({ useLensNav: () => {} }));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/hooks/useLensIdentity', () => ({ useLensIdentity: () => {} }));
vi.mock('@/hooks/useRealtimeLens', () => ({
  useRealtimeLens: () => ({ latestData: null, insights: [], isLive: false, lastUpdated: null }),
}));
vi.mock('@/lib/api/client', () => ({
  lensRun: () => Promise.resolve({ data: { ok: true, result: { posts: [], unread: 0 } } }),
}));
vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/components/lens/CrossLensRecentsPanel', () => ({ CrossLensRecentsPanel: () => null }));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));
vi.mock('@/components/lens/LiveIndicator', () => ({ LiveIndicator: () => null }));
vi.mock('@/components/timeline/TimelineRoadmap', () => ({ TimelineRoadmap: () => null }));
vi.mock('@/components/timeline/TimelineWiki', () => ({ TimelineWiki: () => null }));
vi.mock('@/components/timeline/PostComposer', () => ({ PostComposer: () => null }));
vi.mock('@/components/timeline/PostCard', () => ({ PostCard: () => null }));
vi.mock('@/components/timeline/AlbumsPanel', () => ({ AlbumsPanel: () => null }));
vi.mock('@/components/timeline/ProfilePanel', () => ({ ProfilePanel: () => null }));
vi.mock('@/components/timeline/MemoriesPanel', () => ({ MemoriesPanel: () => null }));
vi.mock('@/components/timeline/NotificationsPanel', () => ({ NotificationsPanel: () => null }));
vi.mock('@/components/viz', () => ({ TimelineView: () => null }));

import TimelineLensPage from '@/app/lenses/timeline/page';

describe('Timeline page greeting', () => {
  it('opens on the concept headline addressed to the signed-in user', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <TimelineLensPage />
      </QueryClientProvider>,
    );
    const greeting = await screen.findByTestId('timeline-greeting');
    expect(greeting.textContent).toBe('When it lands, ramaj');
    expect(greeting.className).toContain('font-vault');
  });
});
