import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

// Slice B7 — FIX-attention-003 + FIX-strategic-adds-006: distraction
// log entries render as a list with edit + delete; focus blocks gain
// an edit form wired to calendarUpdate.

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRun(...args),
  api: { post: vi.fn(), delete: vi.fn(), get: vi.fn() },
  apiHelpers: { lens: { runDomain: vi.fn() } },
}));
vi.mock('@/components/viz', () => ({ ChartKit: () => null }));

import { FocusToolkit } from '@/components/attention/FocusToolkit';

function ok(result: unknown) {
  return Promise.resolve({ data: { ok: true, result } });
}
function calls(action: string) {
  return lensRun.mock.calls.filter((c) => c[1] === action);
}

const SUMMARY = {
  total: 1, todayCount: 1, lostMinutes: 10,
  byKind: { notification: 1 }, topSources: [{ source: 'Slack', count: 1 }],
  recent: [{ id: 'dx1', source: 'Slack', kind: 'notification', durationMinutes: 10, note: null, loggedAt: '2026-11-13T10:00:00Z' }],
};
const BLOCKS = {
  blocks: [{ id: 'cb1', date: '2026-11-13', startMinute: 540, durationMinutes: 90, endMinute: 630, title: 'Deep work', taskId: null, createdAt: '' }],
  count: 1, totalReservedMinutes: 90, totalReservedHours: 1.5,
};

beforeEach(() => {
  lensRun.mockReset();
  lensRun.mockImplementation((_d: string, action: string) => {
    if (action === 'distractionSummary') return ok(SUMMARY);
    if (action === 'calendarBlocks') return ok(BLOCKS);
    return ok(null);
  });
});

describe('FocusToolkit lifecycle edits (FIX-attention-003 / strategic-adds-006)', () => {
  it('distraction entries list with edit + delete; delete fires only on confirm', async () => {
    render(<FocusToolkit />);
    expect(await screen.findByText('Recent entries')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Delete distraction Slack' }));
    expect(calls('distractionDelete')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete distraction' }));
    await waitFor(() => expect(calls('distractionDelete')).toHaveLength(1));
    expect(calls('distractionDelete')[0][2]).toMatchObject({ id: 'dx1' });
  });

  it('distraction edit saves via distractionUpdate', async () => {
    render(<FocusToolkit />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit distraction Slack' }));
    fireEvent.change(screen.getByLabelText('Edit distraction source'), { target: { value: 'Slack (phone)' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls('distractionUpdate')).toHaveLength(1));
    expect(calls('distractionUpdate')[0][2]).toMatchObject({ id: 'dx1', source: 'Slack (phone)' });
  });

  it('focus block edit saves via calendarUpdate', async () => {
    render(<FocusToolkit />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit block Deep work' }));
    fireEvent.change(screen.getByLabelText('Edit block title'), { target: { value: 'Deep work (moved)' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls('calendarUpdate')).toHaveLength(1));
    expect(calls('calendarUpdate')[0][2]).toMatchObject({ blockId: 'cb1', title: 'Deep work (moved)' });
  });
});
