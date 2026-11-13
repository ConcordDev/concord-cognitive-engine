import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  mode: 'ready' as 'ready' | 'loading' | 'error',
  commands: [] as Array<{ action: () => void }>,
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: ({ queryKey }: { queryKey: string[] }) => {
    const state = { isLoading: mocks.mode === 'loading', isError: mocks.mode === 'error', error: mocks.mode === 'error' ? new Error('offline') : null, refetch: vi.fn() };
    if (queryKey[1] === 'achievements') return { ...state, data: { achievements: [{ id: 'a1', name: 'First', description: 'Won', earned: false, progress: 1, maxProgress: 1, xpReward: 50, rarity: 'rare' }] } };
    if (queryKey[1] === 'challenges') return { ...state, data: { challenges: [{ id: 'q1', name: 'Quest', description: 'Do it', reward: 100, progress: 0, target: 1 }] } };
    if (queryKey[1] === 'profile') return { ...state, data: { profile: { level: 2, xp: 200, nextLevelXp: 1000, totalXpEarned: 200, achievements: 0, totalAchievements: 1, streak: 3, longestStreak: 3, questsCompleted: 0, xpHistory: [{ day: 'Mon', xp: 20, label: 'Quest' }] } } };
    return { ...state, data: { leaderboard: [{ userId: 'u1', level: 2, xp: 200, badges: 1, badgeList: ['first'] }] } };
  },
  useMutation: () => ({ mutate: vi.fn() }),
}));
vi.mock('@/lib/hooks/use-lens-data', () => ({
  useLensData: () => ({
    items: [{
      id: 'lart_q1',
      title: 'Quest',
      ownerId: 'u1',
      data: { name: 'Quest', description: 'Do it', xpReward: 100, difficulty: 'medium', type: 'challenge', status: 'available', icon: '🎯' },
      meta: { status: 'active', visibility: 'private', tags: ['challenge'] },
      createdAt: '',
      updatedAt: '',
      version: 1,
    }],
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
    create: vi.fn(async () => ({ ok: true })),
    update: vi.fn(async () => ({ ok: true })),
  }),
}));
vi.mock('@/lib/api/client', () => ({ api: { get: vi.fn(), post: vi.fn(async () => ({ data: {} })) } }));
vi.mock('@/hooks/useLensNav', () => ({ useLensNav: vi.fn() }));
vi.mock('@/hooks/useLensCommand', () => ({
  useLensCommand: (commands: Array<{ action: () => void }>) => {
    mocks.commands = commands;
  },
}));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'u1', username: 'ada' } }) }));
vi.mock('@/hooks/useRealtimeLens', () => ({
  useRealtimeLens: () => ({ latestData: null, alerts: [], insights: [], isLive: true, lastUpdated: new Date() }),
}));
vi.mock('@/components/lens/LensShell', () => ({ LensShell: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));
vi.mock('@/components/lens/LiveIndicator', () => ({ LiveIndicator: () => null }));
vi.mock('@/components/lens/DTUExportButton', () => ({ DTUExportButton: () => null }));
vi.mock('@/components/lens/RealtimeDataPanel', () => ({ RealtimeDataPanel: () => null }));
vi.mock('@/components/lens/CrossLensRecentsPanel', () => ({ CrossLensRecentsPanel: () => null }));
vi.mock('@/components/game/HabitHub', () => ({
  HabitHub: (props: { onXpChange?: (xp: number) => void }) => {
    React.useEffect(() => { props.onXpChange?.(99999); }, []);
    return <div>HabitHub</div>;
  },
}));
vi.mock('@/components/game/GameDesignLab', () => ({ GameDesignLab: () => <div>GameDesignLab</div> }));
vi.mock('@/components/game/TriviaPanel', () => ({ TriviaPanel: () => <div>TriviaPanel</div> }));
vi.mock('@/components/game/GameFeed', () => ({ GameFeed: () => <div>GameFeed</div> }));
vi.mock('@/components/game/XpActivityFeed', () => ({ XpActivityFeed: () => <div>XpActivityFeed</div> }));
vi.mock('@/components/common/Toasts', () => ({ showToast: vi.fn() }));
vi.mock('@/components/common/EmptyState', () => ({ ErrorState: ({ error }: { error: string }) => <div>{error}</div> }));
vi.mock('framer-motion', async () => {
  const ReactModule = await vi.importActual<typeof import('react')>('react');
  const component = (tag: string) => ReactModule.forwardRef<HTMLElement, Record<string, unknown>>(
    ({ children, initial: _initial, animate: _animate, exit: _exit, transition: _transition, layout: _layout, ...props }, ref) =>
      ReactModule.createElement(tag, { ...props, ref }, children),
  );
  return {
    motion: { div: component('div'), tr: component('tr') },
    AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  };
});


import GameApp from '@/components/game/GameApp';

// FIX-game-001 (FE) — the header XP is the PROFILE total. HabitHub's
// habit-ledger total used to max-merge into it through onXpChange, so
// the header flipped to the habit number (56) depending on load order
// while the dashboard showed the profile number (10). GameApp no
// longer wires the merge: a HabitHub report — even a huge one — must
// never move the header.
describe('GameApp header XP (FIX-game-001)', () => {
  beforeEach(() => { mocks.mode = 'ready'; mocks.commands = []; });
  afterEach(() => cleanup());

  it('shows the profile XP and ignores the HabitHub report', () => {
    render(<GameApp />);
    expect(screen.getAllByText('200 XP').length).toBeGreaterThan(0);
    expect(screen.queryByText(/99,999/)).toBeNull();
  });
});
