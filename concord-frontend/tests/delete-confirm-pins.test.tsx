// CB-0438 verify-only pins — surfaces the premise pass found ALREADY
// conforming at the sweep head, pinned so a regression re-opens them:
// · forge-009 · lab-006 — the lenses mount no feed of their own; the
//   feed post delete is the shared FeedTimelinePanel's, armed by the
//   sweep's own f012a8f62 ("arm delete until confirm on seventeen more
//   lenses"). Pin: arm sends nothing, Confirm calls the delete API.
// · resonance-002 — the lens's only deletePair call site is the
//   workbench's, which already two-step confirms ("Delete this pair?"
//   + Cancel) since the 2026-11-05 lens build (840658921); a completed
//   search found no second, unconfirmed pair delete. Pin the flow.
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render as rtlRender, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const lensRunMock = vi.fn();
const apiGet = vi.fn();
const apiPost = vi.fn();
const apiDelete = vi.fn(async () => ({ data: { ok: true } }));
const POSTS = [
  { id: 'p1', type: 'text', author: { id: 'u1', name: 'Me', handle: 'me', gradient: 'g', verified: false }, content: 'My own post', createdAt: new Date(Date.now() - 120000).toISOString(), likes: 0, comments: 0, reposts: 0, shares: 0, views: 1, liked: false, reposted: false, bookmarked: false, tags: [] },
];
const SIDE = (id: string, domain: string, title: string) => ({ id, domain, title, description: `${title} d`, invariants: ['feedback loop'] });
const PAIR = { id: 'pr1', a: SIDE('a1', 'physics', 'Entropy'), b: SIDE('b1', 'economics', 'Inflation'), note: 'Interesting', resonance: 0.82, invOverlap: 0.7, tokOverlap: 0.1, classification: 'strong_resonance', sharedInvariants: ['feedback loop'], createdAt: '2026-03-01', analyzedAt: '2026-03-02' };

vi.mock('@/lib/api/client', () => ({
  lensRun: (...a: unknown[]) => lensRunMock(...a),
  api: { get: (...a: unknown[]) => apiGet(...a), post: (...a: unknown[]) => apiPost(...a), delete: (...a: unknown[]) => apiDelete(...a) },
  apiHelpers: { resonance: { boundary: vi.fn(async () => ({ data: {} })) }, lens: { runDomain: vi.fn(async () => ({ data: { ok: true, result: {} } })), list: vi.fn(async () => ({ data: { artifacts: [], total: 0 } })) } },
}));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/components/feed/useFeedPosts', () => ({ useFeedPosts: () => ({ feedPosts: POSTS, isLoading: false, isError: false, error: null, refetch: vi.fn(), fetchNextPage: vi.fn(), hasNextPage: false, isFetchingNextPage: false }) }));
vi.mock('react-virtuoso', () => ({ Virtuoso: ({ data, itemContent }: { data: unknown[]; itemContent: (i: number, d: unknown) => React.ReactNode }) => <div>{data.map((d, i) => <div key={i}>{itemContent(i, d)}</div>)}</div> }));
vi.mock('@/lib/hooks/use-lens-data', () => ({ useLensData: () => ({ items: [], isLoading: false, isError: false, error: null, refetch: vi.fn(), create: vi.fn(async () => ({ id: 'n1' })), update: vi.fn(async () => ({})), remove: vi.fn(async () => ({})), isCreating: false, createMut: { isPending: false }, updateMut: { isPending: false }, deleteMut: { isPending: false } }) }));
vi.mock('@/lib/hooks/use-lens-artifacts', () => ({ useRunArtifact: () => ({ mutateAsync: vi.fn(async () => ({ ok: true, result: {} })), mutate: vi.fn(), isPending: false }) }));
vi.mock('@/store/ui', () => {
  const state = { addToast: vi.fn(), setActiveLens: vi.fn() };
  const useUIStore = Object.assign((sel: (s: Record<string, unknown>) => unknown) => sel(state), { getState: () => state });
  return { useUIStore };
});
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'u1', username: 'me' }, isLoading: false }) }));
vi.mock('@/hooks/useRealtimeLens', () => ({ useRealtimeLens: () => ({ latestData: null, alerts: [], insights: [], isLive: false, lastUpdated: null }) }));
vi.mock('@/lib/realtime/socket', () => ({ subscribe: vi.fn(() => () => {}), getSocket: () => ({ on: vi.fn(), off: vi.fn(), emit: vi.fn() }) }));
for (const [path, name] of [
  ['@/components/feed/BookmarkFolderPicker', 'BookmarkFolderPicker'], ['@/app/lenses/feed/WaveformPlayer', 'WaveformPlayer'],
  ['@/components/feedback/FeedbackWidget', 'FeedbackWidget'], ['@/components/lens/LiveIndicator', 'LiveIndicator'],
  ['@/components/lens/DTUExportButton', 'DTUExportButton'], ['@/components/lens/RealtimeDataPanel', 'RealtimeDataPanel'],
  ['@/components/common/VisionAnalyzeButton', 'VisionAnalyzeButton'], ['@/components/dtu/ProvenanceBadge', 'ProvenanceBadge'],
  ['@/components/common/ReportButton', 'ReportButton'], ['@/components/social/StoriesBar', 'StoriesBar'],
  ['@/components/social/SuggestedFollows', 'SuggestedFollows'], ['@/components/social/PresenceIndicator', 'PresenceIndicator'],
  ['@/components/social/SocialCommerceTag', 'SocialCommerceTag'], ['@/components/social/CrossPostExternal', 'CrossPostExternal'],
  ['@/components/social/Discovery', 'Discovery'], ['@/components/feed/FeedSchedulerPanel', 'FeedSchedulerPanel'],
  ['@/components/feed/FeedSearchResults', 'FeedSearchResults'], ['@/components/social/TrendingTopics', 'TrendingTopics'],
  ['@/components/lens/PullToSubstrate', 'PullToSubstrate'], ['@/components/lens/FeedBanner', 'FeedBanner'],
  ['@/components/social/StreakIndicator', 'StreakIndicator'], ['@/components/social/NotificationCenter', 'NotificationCenter'],
  ['@/components/social/DMIndicator', 'DMIndicator'],
] as const) vi.doMock(path, () => ({ [name]: () => <span>{name}-stub</span> }));
vi.mock('@/components/common/EmptyState', () => ({ ErrorState: () => <div>error</div> }));
vi.mock('@/components/viz', () => ({ ChartKit: () => <div>chart</div> }));
vi.mock('framer-motion', () => ({
  useReducedMotion: () => false,
  MotionConfig: ({ children }: { children?: React.ReactNode }) => children,
  motion: new Proxy({}, { get: (_t, tag: string) => {
    const MOTION = ['initial', 'animate', 'exit', 'transition', 'variants', 'whileHover', 'whileTap', 'whileInView', 'layout', 'layoutId', 'drag'];
    return ({ children, ...rest }: Record<string, unknown>) => React.createElement(tag, Object.fromEntries(Object.entries(rest).filter(([k]) => !MOTION.includes(k))), children as React.ReactNode);
  } }),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { CrossDomainWorkbench } from '@/components/resonance/CrossDomainWorkbench';

const render = (ui: React.ReactElement) => rtlRender(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>{ui}</QueryClientProvider>,
);
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 10)); });
type Call = { action?: string; input?: Record<string, unknown> };
const sent = (action: string) => lensRunMock.mock.calls
  .map((c) => { const a = c as [unknown, unknown, unknown]; return (typeof a[0] === 'object' && a[0] !== null ? a[0] : { action: a[1], input: a[2] }) as Call; })
  .find((x) => x.action === action);

beforeEach(() => {
  lensRunMock.mockReset();
  apiGet.mockReset(); apiPost.mockReset(); apiDelete.mockClear();
  apiGet.mockImplementation(async () => ({ data: { ok: true, items: [], posts: [] } }));
  apiPost.mockResolvedValue({ data: { ok: true } });
  lensRunMock.mockImplementation(async (...a: unknown[]) => {
    const action = (a as [unknown, string])[1];
    switch (action) {
      case 'listPairs': return { data: { ok: true, result: { pairs: [PAIR], byClass: { strong_resonance: 1 }, avgResonance: 0.82 } } };
      case 'resonanceGraph': return { data: { ok: true, result: { nodes: [], edges: [], stats: { domains: 0, connections: 0 } } } };
      case 'resonanceAlerts': return { data: { ok: true, result: { alerts: [], unacknowledgedCount: 0 } } };
      case 'listInsights': return { data: { ok: true, result: { insights: [] } } };
      default: return { data: { ok: true, result: { ok: true } } };
    }
  });
});
afterEach(() => cleanup());

describe('CB-0438 verify-only pins', () => {
  it('forge-009/lab-006: the shared feed panel delete arms first; confirm calls the delete API', async () => {
    const { FeedTimelinePanel } = await import('@/components/feed/FeedTimelinePanel');
    render(<FeedTimelinePanel tab="for-you" onDiscover={vi.fn()} />);
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'More options' }));
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Delete post' }));
    expect(apiDelete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete post' }));
    await waitFor(() => expect(apiDelete).toHaveBeenCalledWith('/api/social/post/p1'));
  });

  it('resonance-002: the workbench pair delete confirms, cancels clean, then deletes', async () => {
    render(<CrossDomainWorkbench />);
    const arm = await screen.findByRole('button', { name: 'Delete' });
    fireEvent.click(arm);
    expect(await screen.findByText('Delete this pair?')).toBeTruthy();
    expect(sent('deletePair')).toBeUndefined();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByText('Delete this pair?')).toBeNull());
    expect(sent('deletePair')).toBeUndefined();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(sent('deletePair')?.input).toMatchObject({ pairId: 'pr1' }));
  });
});
