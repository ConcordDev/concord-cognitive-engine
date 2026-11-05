/**
 * Attention full-build pins (S-ATT-1/2/3/5/6 FE legs):
 *  - planner completion = done/planned, live in the planner header;
 *  - the +/− steppers adjust DURATION (they used to shift start time);
 *  - an empty block title is refused with a message, not defaulted;
 *  - distractions render as a list and delete two-step;
 *  - the Threads header reads the SAME focus ledger as the Focus view;
 *  - system threads are labelled, your completed threads list, and
 *    background tasks show with their outcome.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';

const h = vi.hoisted(() => ({
  lensRun: vi.fn(),
  queryData: {} as Record<string, unknown>,
  deleteThread: vi.fn(),
}));

vi.mock('@/lib/api/client', () => ({
  lensRun: h.lensRun,
  apiHelpers: {
    attention: {
      deleteThread: h.deleteThread,
    },
  },
}));
vi.mock('@tanstack/react-query', () => ({
  useQuery: ({ queryKey }: { queryKey: string[] }) => ({
    data: h.queryData[queryKey[0]],
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
  useMutation: () => ({ mutate: vi.fn(), isPending: false }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock('@/hooks/useRealtimeLens', () => ({
  useRealtimeLens: () => ({ latestData: null, insights: [], isLive: false, lastUpdated: null }),
}));
vi.mock('@/components/lens/RealtimeDataPanel', () => ({ RealtimeDataPanel: () => null }));
vi.mock('@/components/common/EmptyState', () => ({ ErrorState: () => null }));
vi.mock('@/components/viz', () => ({ ChartKit: () => null }));
vi.mock('framer-motion', () => ({
  motion: new Proxy({}, { get: () => (props: Record<string, unknown>) => {
    const { initial, animate, transition, ...rest } = props as Record<string, unknown>;
    void initial; void animate; void transition;
    return React.createElement('div', rest, (props as { children?: React.ReactNode }).children);
  } }),
}));

import { FocusToolkit } from '@/components/attention/FocusToolkit';
import { ThreadsDeskPanel } from '@/components/attention/ThreadsDeskPanel';

const DAY = {
  date: '2026-11-05', dayStartMinute: 540, dayEndMinute: 1080,
  tasks: [
    { id: 'pt_1', name: 'Write the brief', startMinute: 540, durationMinutes: 60, priority: 0.5, color: '#6366f1', done: true },
    { id: 'pt_2', name: 'Review the ledger', startMinute: 660, durationMinutes: 45, priority: 0.5, color: '#6366f1', done: false },
  ],
};

function wireFocusToolkit() {
  h.lensRun.mockImplementation(async (_lens: string, action: string) => {
    switch (action) {
      case 'pomodoroStatus': return { data: { ok: true, result: { timer: null, remainingSeconds: 0 } } };
      case 'pomodoroStats': return { data: { ok: true, result: { totalSessions: 2, completedSessions: 1, deepWorkSessions: 1, totalFocusMinutes: 90, totalFocusHours: 1.5, totalInterruptions: 1, completionRate: 50, today: { sessions: 1, minutes: 30, deepWork: 1 }, recentSessions: [] } } };
      case 'plannerGet': return { data: { ok: true, result: { day: DAY, plannedMinutes: 105, capacityMinutes: 540, remainingMinutes: 435, overbooked: false } } };
      case 'distractionSummary': return { data: { ok: true, result: { total: 1, todayCount: 1, lostMinutes: 3, byKind: { notification: 1 }, topSources: [{ source: 'Phone', count: 1 }], recent: [{ id: 'dx_1', source: 'Phone', kind: 'notification', durationMinutes: 3, note: null, loggedAt: '2026-11-05T10:00:00Z' }] } } };
      case 'focusAnalytics': return { data: { ok: true, result: { windowDays: 14, daily: [], weekly: [], totals: { focusHours: 0, deepWorkHours: 0, avgFocusHoursPerActiveDay: 0, activeDays: 0 }, deepWorkTrend: 'no-data', trendSlope: 0 } } };
      case 'peakHours': return { data: { ok: true, result: { hourly: [], peakHours: [], lowHours: [], taggedSessions: 0, moodBreakdown: {} } } };
      case 'focusModeGet': return { data: { ok: true, result: { mode: { enabled: false, label: null, mutedChannels: [], enabledAt: null } } } };
      case 'calendarBlocks': return { data: { ok: true, result: { blocks: [], count: 0, totalReservedMinutes: 0, totalReservedHours: 0 } } };
      default: return { data: { ok: true, result: {} } };
    }
  });
}

beforeEach(() => { vi.clearAllMocks(); h.queryData = {}; });

describe('FocusToolkit', () => {
  it('planner completion is done/planned and the session stat is honestly labelled', async () => {
    wireFocusToolkit();
    render(<FocusToolkit />);
    expect(await screen.findByText(/Completion: 1\/2 done \(50%\)/)).toBeTruthy();
    expect(await screen.findByText('Session completion')).toBeTruthy();
    expect(await screen.findByText(/Deep work counts a completed session/)).toBeTruthy();
  });

  it('an empty analytics window reports no trend instead of "steady"', async () => {
    wireFocusToolkit();
    render(<FocusToolkit />);
    expect(await screen.findByText(/No sessions in this window yet/)).toBeTruthy();
  });

  it('the + stepper lengthens the DURATION, not the start time', async () => {
    wireFocusToolkit();
    render(<FocusToolkit />);
    const btn = await screen.findByLabelText('Lengthen Write the brief by 15 minutes');
    fireEvent.click(btn);
    const move = h.lensRun.mock.calls.find((c) => c[1] === 'plannerMoveTask');
    expect(move).toBeTruthy();
    expect(move![2]).toMatchObject({ taskId: 'pt_1', durationMinutes: 75 });
    expect(move![2]).not.toHaveProperty('startMinute');
  });

  it('an empty block title is refused with a message and no reserve call', async () => {
    wireFocusToolkit();
    render(<FocusToolkit />);
    fireEvent.click(await screen.findByText('Reserve'));
    expect(await screen.findByText(/Give the block a title first/)).toBeTruthy();
    expect(h.lensRun.mock.calls.some((c) => c[1] === 'calendarReserve')).toBe(false);
  });

  it('distractions render as a list and delete two-step', async () => {
    wireFocusToolkit();
    render(<FocusToolkit />);
    fireEvent.click(await screen.findByLabelText('Delete distraction Phone'));
    fireEvent.click(await screen.findByText('Delete?'));
    const rm = h.lensRun.mock.calls.find((c) => c[1] === 'distractionRemove');
    expect(rm).toBeTruthy();
    expect(rm![2]).toMatchObject({ entryId: 'dx_1' });
  });
});

describe('ThreadsDeskPanel (one ledger)', () => {
  function wireThreads() {
    h.lensRun.mockImplementation(async (_lens: string, action: string) => {
      if (action === 'pomodoroStats') return { data: { ok: true, result: { totalSessions: 7, totalFocusHours: 3.5, deepWorkSessions: 2 } } };
      if (action === 'distractionSummary') return { data: { ok: true, result: { total: 4 } } };
      return { data: { ok: true, result: {} } };
    });
    h.queryData = {
      'attention-status': { activeThreads: [], stats: { threadsCreated: 42, threadsCompleted: 40, interruptions: 9, avgFocusDurationMs: 2900 }, queueLength: 0, backgroundTasks: 1, focus: false },
      'attention-threads': {
        threads: [
          { id: 'th_sys', type: 'reasoning', priority: 0.5, status: 'active', description: 'Chat-Response', createdAt: '2026-11-05T09:00:00Z', system: true, mine: false, domain: null },
          { id: 'th_mine', type: 'planning', priority: 0.8, status: 'completed', description: 'Plan the migration', createdAt: '2026-11-05T08:00:00Z', system: false, mine: true, domain: 'work', completedAt: '2026-11-05T09:30:00Z' },
        ],
      },
      'attention-queue': { queue: [], completed: [], background: [{ id: 'bg_1', type: 'memory-consolidation', status: 'completed', createdAt: '2026-11-05T09:00:00Z', completedAt: '2026-11-05T09:01:00Z' }] },
    };
  }

  it('the header reads the focus ledger, not the thread manager', async () => {
    wireThreads();
    render(<ThreadsDeskPanel />);
    expect(await screen.findByText('7')).toBeTruthy();
    expect(await screen.findByText('3.5h')).toBeTruthy();
    expect(await screen.findByText('Deep Work Sessions')).toBeTruthy();
  });

  it('system threads are labelled and your completed thread lists under its filter', async () => {
    wireThreads();
    render(<ThreadsDeskPanel />);
    expect(await screen.findByText('System')).toBeTruthy();
    const select = screen.getByDisplayValue('All');
    fireEvent.change(select, { target: { value: 'completed' } });
    expect(await screen.findByText('Plan the migration')).toBeTruthy();
    expect(await screen.findByText('Yours')).toBeTruthy();
  });

  it('background tasks show with their outcome', async () => {
    wireThreads();
    render(<ThreadsDeskPanel />);
    expect((await screen.findAllByText('Background Tasks')).length).toBeGreaterThanOrEqual(1);
    expect(await screen.findByText('memory consolidation')).toBeTruthy();
    expect(await screen.findByText('completed')).toBeTruthy();
  });
});
