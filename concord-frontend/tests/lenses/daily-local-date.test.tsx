/// <reference types="@testing-library/jest-dom/vitest" />
/**
 * Daily "today" is the browser calendar day.
 * 2026-10-10 21:58 America/New_York is 2026-10-11 01:58 UTC — the old
 * toISOString().slice(0, 10) path labeled that evening Sunday and saved
 * the entry under a day the local calendar never highlighted.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const FIXED = new Date('2026-10-11T01:58:00.000Z');
const ORIGINAL_TZ = process.env.TZ;

const { entryStore, createEntry } = vi.hoisted(() => ({
  entryStore: { items: [] as Array<Record<string, unknown>> },
  createEntry: vi.fn(),
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { username: 'tester' } }),
}));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/hooks/useRealtimeLens', () => ({
  useRealtimeLens: () => ({ latestData: null, alerts: [], insights: [], isLive: false, lastUpdated: null }),
}));
vi.mock('@/lib/hooks/use-lens-artifacts', () => ({
  useRunArtifact: () => vi.fn(),
}));
vi.mock('@/lib/api/client', () => ({
  api: {
    get: vi.fn(async () => ({ data: { media: [] } })),
    post: vi.fn(async () => ({ data: { ok: true } })),
  },
  apiHelpers: {
    daily: {
      list: vi.fn(async () => ({ data: [] })),
      digest: vi.fn(async () => ({ data: {} })),
      createReminder: vi.fn(async () => ({ data: {} })),
      completeReminder: vi.fn(async () => ({ data: {} })),
    },
  },
  lensRun: vi.fn(),
}));
vi.mock('@/lib/hooks/use-lens-data', () => ({
  useLensData: (_domain: string, type: string) => ({
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
    items: type === 'entry' ? entryStore.items : [],
    create: type === 'entry' ? createEntry : vi.fn(),
  }),
}));
vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/components/lens/FirstRunTour', () => ({ FirstRunTour: () => null }));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));
vi.mock('@/components/lens/CrossLensRecentsPanel', () => ({ CrossLensRecentsPanel: () => null }));
vi.mock('@/components/lens/LiveIndicator', () => ({ LiveIndicator: () => null }));
vi.mock('@/components/lens/DTUExportButton', () => ({ DTUExportButton: () => null }));
vi.mock('@/components/lens/RealtimeDataPanel', () => ({ RealtimeDataPanel: () => null }));
vi.mock('@/components/lens/LensFeedButton', () => ({ LensFeedButton: () => null }));
vi.mock('@/components/daily/QuotablePanel', () => ({ QuotablePanel: () => null }));
vi.mock('@/components/lens/DraftedTextarea', () => ({
  DraftedTextarea: ({
    initial,
    onValueChange,
    placeholder,
  }: {
    initial?: string;
    onValueChange?: (value: string) => void;
    placeholder?: string;
  }) => (
    <textarea
      placeholder={placeholder}
      defaultValue={initial ?? ''}
      onChange={(event) => onValueChange?.(event.target.value)}
    />
  ),
}));

import DailyLensPage from '@/app/lenses/daily/page';

function renderDaily() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <DailyLensPage />
    </QueryClientProvider>,
  );
}

describe('Daily lens local calendar day', () => {
  beforeEach(() => {
    process.env.TZ = 'America/New_York';
    vi.useFakeTimers({ toFake: ['Date'], now: FIXED });
    entryStore.items = [];
    createEntry.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    if (ORIGINAL_TZ === undefined) delete process.env.TZ;
    else process.env.TZ = ORIGINAL_TZ;
  });

  it('headers Saturday Oct 10, saves 2026-10-10, and shows that entry after reload', () => {
    const first = renderDaily();

    expect(screen.getByRole('heading', { level: 1, name: (name) => name === 'Saturday, October 10' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Saturday, October 10, 2026' })).toBeInTheDocument();
    const day = screen.getByRole('button', { name: '10' });
    expect(day.className).toContain('bg-neon-cyan/30');

    fireEvent.change(screen.getByPlaceholderText('How did your day go?'), {
      target: { value: 'Saturday night notes' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save Entry' }));

    expect(createEntry).toHaveBeenCalledTimes(1);
    expect(createEntry.mock.calls[0][0]).toMatchObject({
      title: '2026-10-10',
      data: { date: '2026-10-10', notes: 'Saturday night notes' },
    });

    first.unmount();
    entryStore.items = [{
      id: 'ent-saturday',
      title: '2026-10-10',
      data: {
        date: '2026-10-10',
        mood: null,
        notes: 'Saturday night notes',
        workedOn: '',
        learned: '',
        goals: '',
      },
      meta: { tags: [], status: 'active', visibility: 'private' },
      createdAt: FIXED.toISOString(),
      updatedAt: FIXED.toISOString(),
      version: 1,
    }];

    renderDaily();
    expect(screen.getByRole('heading', { level: 1, name: (name) => name === 'Saturday, October 10' })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('How did your day go?')).toHaveValue('Saturday night notes');
    expect(screen.getByRole('button', { name: '10' }).className).toContain('bg-neon-cyan/30');
  });
});
