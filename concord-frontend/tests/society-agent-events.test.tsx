// FIX-society-004 — a monitor agent saves exactly the events the user
// checked. AgentBuilder used to persist only monitorEvents[0] and
// silently substitute 'sensor:anomaly-detected' when nothing was
// checked, so the saved agent never matched the form; and Test Agent
// returned a fixed line naming the anomaly event regardless of the
// configuration. A schedule holds one event trigger, so creation now
// writes one schedule per checked event; an empty selection refuses
// in words; the test line is built from the selection.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRun(...args),
}));
vi.mock('@/components/common/StickyDeleteConfirm', () => ({
  StickyDeleteConfirm: () => null,
}));

import AgentBuilder from '@/components/world-lens/AgentBuilder';

function envelope(result: unknown) {
  return { data: { ok: true, result } };
}

beforeEach(() => {
  lensRun.mockReset();
  lensRun.mockImplementation(async (_domain: string, action: string) => {
    if (action === 'listSchedules') return envelope({ schedules: [] });
    if (action === 'createSchedule') return envelope({ schedule: { id: 'sched_x' } });
    return envelope({});
  });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

async function openCreateTab() {
  render(<AgentBuilder />);
  await act(async () => {});
  fireEvent.click(screen.getAllByRole('button', { name: 'Create Agent' })[0]);
  fireEvent.change(screen.getByPlaceholderText('My New Agent'), { target: { value: 'Watchdog' } });
}

function createCalls() {
  return lensRun.mock.calls.filter((c) => c[1] === 'createSchedule').map((c) => c[2] as { spec: string; kind: string });
}

describe('AgentBuilder monitor events (FIX-society-004)', () => {
  it('saves one schedule per checked event — the saved set equals the checked set', async () => {
    await openCreateTab();
    fireEvent.click(screen.getByText('system:health-degraded'));
    fireEvent.click(screen.getByText('dtu:validation-failed'));
    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: 'Create Agent' })[1]);
    });
    const calls = createCalls();
    expect(calls.map((c) => c.spec).sort()).toEqual(['dtu:validation-failed', 'system:health-degraded']);
    expect(calls.every((c) => c.kind === 'event')).toBe(true);
  });

  it('refuses an empty selection in words and creates nothing', async () => {
    await openCreateTab();
    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: 'Create Agent' })[1]);
    });
    expect(createCalls()).toEqual([]);
    expect(screen.getByText(/Select at least one event to watch/)).toBeTruthy();
  });

  it('Test Agent names the configured events, not a canned one', async () => {
    vi.useFakeTimers();
    await openCreateTab();
    fireEvent.click(screen.getByText('system:health-degraded'));
    fireEvent.click(screen.getByRole('button', { name: 'Test Agent' }));
    await act(async () => { vi.advanceTimersByTime(1600); });
    expect(screen.getByText(/Log system:health-degraded and notify #ops channel/)).toBeTruthy();
    expect(screen.queryByText(/Log anomaly event/)).toBeNull();
  });
});
