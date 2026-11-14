/**
 * Daily planner date scope (FIX-strategic-adds-005).
 *
 * A planner task added on the strategic-adds Burnout + Focus tab
 * persisted through reload and edit, then "vanished" by cleanup
 * time. The store was never losing it: attention.plannerDays keeps
 * every date's plan server-side, but FocusToolkit passed
 * date: todayKey() to EVERY planner read and write and offered no
 * way to view another day — so yesterday's task was invisible and
 * unreachable the next morning, indistinguishable from deletion,
 * with the today-only scope undisclosed. These pins drive the real
 * FocusToolkit against the real attention domain actions: a task
 * seeded under yesterday is absent from today's view, appears when
 * navigating to yesterday, can be removed there (the cleanup the
 * walker could not do), and a task added while viewing yesterday is
 * stored under yesterday's date.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';

import registerAttentionActions from '../../server/domains/attention.js';
import { calendarDateKey } from '@/lib/calendar-date';

const serverActions: Record<string, (ctx: unknown, artifact: unknown, params: never) => unknown> = {};
registerAttentionActions((domain: string, name: string, fn: never) => {
  serverActions[`${domain}.${name}`] = fn as never;
});
const CTX = { userId: 'walker', actor: { userId: 'walker' } };
function serverCall(name: string, input: Record<string, unknown>) {
  const fn = serverActions[`attention.${name}`];
  if (!fn) return { ok: false, result: null, error: `no action attention.${name}` };
  const out = fn(CTX, { data: input }, input as never) as { ok: boolean; result?: unknown; error?: string };
  return { ok: out.ok, result: out.result ?? null, error: out.error ?? null };
}

const lensRun = vi.fn(async (domain: string, action: string, input: Record<string, unknown>) => {
  return { data: serverCall(action, input) };
});
vi.mock('@/lib/api/client', () => ({
  lensRun: (...a: unknown[]) => lensRun(...(a as [string, string, Record<string, unknown>])),
}));
vi.mock('@/components/viz', () => ({ ChartKit: () => null }));

import { FocusToolkit } from '@/components/attention/FocusToolkit';

const today = calendarDateKey();
const yesterday = calendarDateKey(new Date(Date.now() - 86400000));

async function until(pred: () => boolean, ms = 4000) {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > ms) throw new Error('until: timed out');
    await act(async () => { await new Promise((r) => setTimeout(r, 25)); });
  }
}

beforeEach(() => {
  lensRun.mockClear();
  (globalThis as Record<string, unknown>)._concordSTATE = {};
  (globalThis as Record<string, unknown>)._concordSaveStateDebounced = () => {};
  // The walker's scenario: a task planned yesterday, still stored.
  serverCall('plannerAddTask', { date: yesterday, name: 'qa-yesterday-task', startMinute: 540, durationMinutes: 60 });
});
afterEach(() => { cleanup(); });

describe('planner date scope (FIX-strategic-adds-005)', () => {
  it("yesterday's task is reachable by day navigation and removable there", async () => {
    render(<FocusToolkit />);
    // Today is the default view; yesterday's task is not shown.
    await until(() => screen.queryByText(/No tasks timeboxed for today/) != null);
    expect(screen.queryByText('qa-yesterday-task')).toBeNull();
    const dateInput = screen.getByLabelText('Planner date') as HTMLInputElement;
    expect(dateInput.value).toBe(today);

    fireEvent.click(screen.getByRole('button', { name: 'Previous day' }));
    await until(() => screen.queryByText('qa-yesterday-task') != null);
    expect(dateInput.value).toBe(yesterday);
    // The server was asked for yesterday's plan, not today's.
    const gets = lensRun.mock.calls.filter((c) => c[1] === 'plannerGet').map((c) => (c[2] as { date: string }).date);
    expect(gets).toContain(yesterday);
    // Scope is disclosed and reversible.
    expect(screen.getByRole('button', { name: 'Today' })).toBeInTheDocument();

    // Cleanup — the exact act the walker could not perform.
    fireEvent.click(screen.getByRole('button', { name: 'Remove task' }));
    await until(() => screen.queryByText('qa-yesterday-task') == null);
    const stored = serverCall('plannerGet', { date: yesterday }) as { result: { day: { tasks: unknown[] } } };
    expect(stored.result.day.tasks).toHaveLength(0);
  });

  it('a task added while viewing yesterday is stored under yesterday, not today', async () => {
    render(<FocusToolkit />);
    await until(() => screen.queryByText(/No tasks timeboxed for today/) != null);
    fireEvent.click(screen.getByRole('button', { name: 'Previous day' }));
    await until(() => screen.queryByText('qa-yesterday-task') != null);

    fireEvent.change(screen.getByPlaceholderText('Task name'), { target: { value: 'planned-ahead' } });
    fireEvent.click(screen.getByRole('button', { name: /Add/ }));
    await until(() => screen.queryByText('planned-ahead') != null);

    const yDay = serverCall('plannerGet', { date: yesterday }) as { result: { day: { tasks: Array<{ name: string }> } } };
    const tDay = serverCall('plannerGet', { date: today }) as { result: { day: { tasks: Array<{ name: string }> } } };
    expect(yDay.result.day.tasks.map((t) => t.name)).toContain('planned-ahead');
    expect(tDay.result.day.tasks.map((t) => t.name)).not.toContain('planned-ahead');
  });
});
