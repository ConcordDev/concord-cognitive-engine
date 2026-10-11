// Custom challenges are private game/quest lens artifacts. The Quests tab,
// Dashboard, and Active Quests all read that list — a create that only
// lived in component state used to vanish on refresh.
import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type QuestArtifact = {
  id: string;
  title: string;
  ownerId: string;
  data: Record<string, unknown>;
  meta: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  version: number;
};

const mocks = vi.hoisted(() => ({
  items: [] as QuestArtifact[],
  listeners: new Set<() => void>(),
  createCalls: [] as Array<Record<string, unknown>>,
}));

function emit() {
  for (const listener of mocks.listeners) listener();
}

vi.mock('@tanstack/react-query', () => ({
  useQuery: ({ queryKey }: { queryKey: string[] }) => {
    const state = { isLoading: false, isError: false, error: null, refetch: vi.fn(async () => ({})) };
    if (queryKey[1] === 'achievements') return { ...state, data: { achievements: [] } };
    if (queryKey[1] === 'profile') return { ...state, data: { profile: { level: 1, xp: 0, nextLevelXp: 1000, questsCompleted: 0, xpHistory: [] } } };
    return { ...state, data: { leaderboard: [] } };
  },
}));

vi.mock('@/lib/hooks/use-lens-data', async () => {
  const ReactModule = await import('react');
  return {
    useLensData: () => {
      const [, bump] = ReactModule.useState(0);
      ReactModule.useEffect(() => {
        const listener = () => bump((n) => n + 1);
        mocks.listeners.add(listener);
        return () => { mocks.listeners.delete(listener); };
      }, []);
      return {
        items: mocks.items,
        isLoading: false,
        isError: false,
        error: null,
        refetch: async () => {},
        create: async (input: { title?: string; data?: Record<string, unknown>; meta?: Record<string, unknown> }) => {
          mocks.createCalls.push(input);
          const artifact: QuestArtifact = {
            id: `lart_${mocks.items.length + 1}`,
            title: input.title || 'Untitled',
            ownerId: 'u1',
            data: { ...(input.data || {}) },
            meta: { ...(input.meta || {}) },
            createdAt: '2026-10-11T00:00:00.000Z',
            updatedAt: '2026-10-11T00:00:00.000Z',
            version: 1,
          };
          mocks.items = [...mocks.items, artifact];
          emit();
          return { ok: true, artifact };
        },
        update: async (id: string, patch: { data?: Record<string, unknown> }) => {
          mocks.items = mocks.items.map((item) => item.id === id
            ? { ...item, data: { ...item.data, ...(patch.data || {}) }, version: item.version + 1 }
            : item);
          emit();
          return { ok: true };
        },
      };
    },
  };
});

vi.mock('@/lib/api/client', () => ({ api: { get: vi.fn(), post: vi.fn(async () => ({ data: {} })) } }));
vi.mock('@/hooks/useLensNav', () => ({ useLensNav: vi.fn() }));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: vi.fn() }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'u1', username: 'ada' } }) }));
vi.mock('@/hooks/useRealtimeLens', () => ({
  useRealtimeLens: () => ({ latestData: null, alerts: [], insights: [], isLive: false, lastUpdated: null }),
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
vi.mock('@/components/common/EmptyState', () => ({ ErrorState: () => null }));
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

describe('Game custom challenges', () => {
  beforeEach(() => {
    mocks.items = [];
    mocks.listeners = new Set();
    mocks.createCalls = [];
  });

  it('creates a private challenge, shows it in Quests after reload, and lists it under Active Quests once accepted', async () => {
    const first = render(<GameApp />);
    fireEvent.click(screen.getByTitle(/^Quests/));

    expect(screen.queryByText('Daily Creator')).not.toBeInTheDocument();
    expect(screen.queryByText('Tag Master')).not.toBeInTheDocument();
    expect(screen.queryByText('Civic Duty')).not.toBeInTheDocument();
    expect(screen.queryByText('Mega Merge')).not.toBeInTheDocument();
    expect(screen.getByText('No quests yet. New challenge saves a private quest on your account.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Create Challenge/i }));
    fireEvent.change(screen.getByPlaceholderText('e.g. 808 Bass Marathon'), { target: { value: 'Dawn Run' } });
    fireEvent.change(screen.getByPlaceholderText('Describe the challenge rules and goals...'), { target: { value: 'Run before breakfast' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    });

    expect(screen.getByRole('heading', { name: 'Dawn Run' })).toBeInTheDocument();
    expect(mocks.createCalls[0]).toMatchObject({
      title: 'Dawn Run',
      meta: { visibility: 'private', status: 'active' },
    });

    first.unmount();
    render(<GameApp />);
    fireEvent.click(screen.getByTitle(/^Quests/));
    expect(screen.getByRole('heading', { name: 'Dawn Run' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Accept' }));
    fireEvent.click(screen.getByTitle(/^Dashboard/));
    expect(screen.getByRole('heading', { name: 'Active Quests' })).toBeInTheDocument();
    expect(screen.getByText('Dawn Run')).toBeInTheDocument();
  });
});
