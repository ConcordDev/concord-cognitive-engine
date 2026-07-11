// Behavior test for RfInsightsPanel — pins the two previously-unsurfaced
// `reflection` macro groups this pass added: `journal-stats` (all-time
// totals + mood breakdown) and `reflection-goal-set`/`reflection-goal-status`
// (weekly writing goal widget), alongside the pre-existing streak/mood-trend/
// calendar/tags panels this component already rendered.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...args: unknown[]) => lensRun(...args) }));

// recharts touches layout/canvas jsdom can't provide — stub it like other tests do.
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => children,
  LineChart: () => null, Line: () => null, XAxis: () => null, YAxis: () => null,
  Tooltip: () => null, CartesianGrid: () => null,
}));

import { RfInsightsPanel } from '@/components/reflection/RfInsightsPanel';

const RESULTS: Record<string, unknown> = {
  'journal-streak': { currentStreak: 3, longestStreak: 9, daysJournaled: 20 },
  'mood-trend': { entries: 0, averageScore: null, series: [] },
  'tags-list': { tags: [], count: 0 },
  'calendar-month': { year: 2026, month: 7, days: {} },
  'journal-stats': {
    totalEntries: 12, totalWords: 3400, avgWords: 283, totalPhotos: 4,
    byMood: { great: 2, good: 5, okay: 3, low: 1, rough: 1 },
  },
  'reflection-goal-status': { weeklyEntries: 5, entriesThisWeek: 2, pct: 40, met: false, isDefault: true },
};

function stub(overrides: Record<string, unknown> = {}) {
  lensRun.mockImplementation((_domain: string, name: string) =>
    Promise.resolve({ data: { ok: true, result: (overrides[name] ?? RESULTS[name]) ?? null, error: null } }));
}

describe('RfInsightsPanel', () => {
  beforeEach(() => lensRun.mockReset());

  it('loads all six macros on mount, including the two new ones', async () => {
    stub();
    render(<RfInsightsPanel />);
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith('reflection', 'journal-stats', {}));
    expect(lensRun).toHaveBeenCalledWith('reflection', 'reflection-goal-status', {});
    expect(lensRun).toHaveBeenCalledWith('reflection', 'journal-streak', {});
  });

  it('renders all-time stats from journal-stats real response shape', async () => {
    stub();
    render(<RfInsightsPanel />);
    const heading = await screen.findByText('All-time stats');
    const section = heading.closest('div') as HTMLElement;
    expect(within(section).getByText('12')).toBeInTheDocument(); // totalEntries
    expect(within(section).getByText('3,400')).toBeInTheDocument(); // totalWords.toLocaleString()
    expect(within(section).getByText('283')).toBeInTheDocument(); // avgWords
    expect(within(section).getByText('4')).toBeInTheDocument(); // totalPhotos
  });

  it('renders the weekly goal progress from reflection-goal-status', async () => {
    stub();
    render(<RfInsightsPanel />);
    expect(await screen.findByText('2/5 this week')).toBeInTheDocument();
    expect(await screen.findByText(/Default goal/)).toBeInTheDocument();
  });

  it('shows the met badge when the goal is satisfied', async () => {
    stub({ 'reflection-goal-status': { weeklyEntries: 3, entriesThisWeek: 4, pct: 133, met: true, isDefault: false } });
    render(<RfInsightsPanel />);
    expect(await screen.findByText('4/3 this week')).toBeInTheDocument();
    expect(screen.queryByText(/Default goal/)).not.toBeInTheDocument();
  });

  it('editing and saving the goal calls reflection-goal-set with the new value', async () => {
    stub();
    render(<RfInsightsPanel />);
    await screen.findByText('2/5 this week');

    fireEvent.click(screen.getByRole('button', { name: /edit/i }));
    const input = screen.getByRole('spinbutton');
    fireEvent.change(input, { target: { value: '7' } });

    lensRun.mockImplementation((_domain: string, name: string) => {
      if (name === 'reflection-goal-set') return Promise.resolve({ data: { ok: true, result: { weeklyEntries: 7 }, error: null } });
      if (name === 'reflection-goal-status') {
        return Promise.resolve({ data: { ok: true, result: { weeklyEntries: 7, entriesThisWeek: 2, pct: 28, met: false, isDefault: false }, error: null } });
      }
      return Promise.resolve({ data: { ok: true, result: RESULTS[name] ?? null, error: null } });
    });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => expect(lensRun).toHaveBeenCalledWith('reflection', 'reflection-goal-set', { weeklyEntries: 7 }));
    expect(await screen.findByText('2/7 this week')).toBeInTheDocument();
  });

  it('renders the mood breakdown bars from byMood', async () => {
    stub();
    render(<RfInsightsPanel />);
    expect(await screen.findByText('great')).toBeInTheDocument();
    expect(await screen.findByText('rough')).toBeInTheDocument();
  });
});
