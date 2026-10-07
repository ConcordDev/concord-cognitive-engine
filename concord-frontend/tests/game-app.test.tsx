import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
vi.mock('@/lib/hooks/use-lens-data', () => ({ useLensData: () => ({ create: vi.fn(async () => ({})), update: vi.fn(async () => ({})) }) }));
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
vi.mock('@/components/lens/FirstRunTour', () => ({ FirstRunTour: () => null }));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));
vi.mock('@/components/lens/LiveIndicator', () => ({ LiveIndicator: () => null }));
vi.mock('@/components/lens/DTUExportButton', () => ({ DTUExportButton: () => null }));
vi.mock('@/components/lens/RealtimeDataPanel', () => ({ RealtimeDataPanel: () => null }));
vi.mock('@/components/lens/CrossLensRecentsPanel', () => ({ CrossLensRecentsPanel: () => null }));
vi.mock('@/components/game/HabitHub', () => ({ HabitHub: () => <div>HabitHub</div> }));
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

describe('GameApp', () => {
  beforeEach(() => {
    mocks.mode = 'ready';
    mocks.commands = [];
  });

  it('renders loading and error states', () => {
    mocks.mode = 'loading';
    const { rerender } = render(<GameApp />);
    expect(screen.getByText('Loading game library...')).toBeInTheDocument();
    mocks.mode = 'error';
    rerender(<GameApp />);
    expect(screen.getByText('offline')).toBeInTheDocument();
  });

  it('executes every canonical game workspace and mini-game click path', () => {
    const rafCallbacks: FrameRequestCallback[] = [];
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      rafCallbacks.push(cb);
      return rafCallbacks.length;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      save: vi.fn(), restore: vi.fn(), translate: vi.fn(), clearRect: vi.fn(), beginPath: vi.fn(),
      moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(), arc: vi.fn(), fill: vi.fn(), fillRect: vi.fn(),
      fillText: vi.fn(),
    } as unknown as CanvasRenderingContext2D);

    render(<GameApp />);
    act(() => {
      for (const command of mocks.commands) command.action();
    });
    for (const label of ['Habit Hub', 'Design Lab', 'Quests', 'Achievements', 'Leaderboard', 'XP History', 'Trivia', 'Feed', 'Mini-Game']) {
      fireEvent.click(screen.getByTitle(new RegExp(`^${label}`)));
    }

    fireEvent.click(screen.getByTitle(/^Quests/));
    for (const filter of ['All', 'Daily', 'Weekly', 'Challenge']) {
      fireEvent.click(screen.getByRole('button', { name: filter }));
    }
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }));
    fireEvent.click(screen.getByRole('button', { name: 'Complete' }));

    fireEvent.click(screen.getByTitle(/^Achievements/));
    fireEvent.click(screen.getByRole('button', { name: 'Claim' }));

    fireEvent.click(screen.getByTitle(/^Leaderboard/));
    for (const period of ['Weekly', 'Monthly', 'All Time']) {
      fireEvent.click(screen.getByRole('button', { name: period }));
    }

    fireEvent.click(screen.getByTitle('Create a challenge (N)'));
    fireEvent.change(screen.getByPlaceholderText('e.g. 808 Bass Marathon'), { target: { value: 'Coverage Quest' } });
    fireEvent.change(screen.getByPlaceholderText('Describe the challenge rules and goals...'), { target: { value: 'Exercise the flow' } });
    fireEvent.change(document.querySelector('select')!, { target: { value: 'hard' } });
    fireEvent.change(document.querySelector('input[type="number"]')!, { target: { value: '500' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    fireEvent.click(screen.getByTitle(/^Mini-Game/));
    fireEvent.click(screen.getByRole('button', { name: /Start/i }));
    act(() => rafCallbacks.shift()?.(performance.now() + 1000));
    fireEvent.click(document.querySelector('canvas')!);
    fireEvent.click(screen.getByRole('button', { name: 'End Early' }));
  }, 30_000);
});
