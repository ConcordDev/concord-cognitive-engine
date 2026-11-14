// FIX-lock-003 + FIX-lock-004: LockProfiler's Clear wipes the whole
// trace only behind the two-step confirm, and each recorded event
// carries its own two-step delete wired to lock.deleteLockEvent
// with the SERVER-recorded id.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const calls: { action: string; input: Record<string, unknown> }[] = [];
vi.mock('@/lib/api/client', () => ({
  lensRun: vi.fn((_domain: string, action: string, input: Record<string, unknown>) => {
    calls.push({ action, input });
    if (action === 'recordLockEvent') {
      return Promise.resolve({ data: { ok: true, result: { recorded: { id: 'lt_test_1' }, totalEvents: 1 } } });
    }
    if (action === 'deleteLockEvent') {
      return Promise.resolve({ data: { ok: true, result: { deleted: input.id, totalEvents: 0 } } });
    }
    if (action === 'clearLockTrace') {
      return Promise.resolve({ data: { ok: true, result: { cleared: true } } });
    }
    return Promise.resolve({ data: { ok: true, result: {} } });
  }),
}));
vi.mock('@/components/viz', () => ({
  ChartKit: () => null,
  TimelineView: () => null,
  TreeDiagram: () => null,
}));

import { LockProfiler } from '@/components/lock/LockProfiler';

async function recordOne() {
  // The mount refresh holds `busy`; the Record button is disabled
  // until it settles.
  await waitFor(() => expect((screen.getByRole('button', { name: 'Record' }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.change(screen.getByLabelText('thread name'), { target: { value: 'T1' } });
  fireEvent.change(screen.getByLabelText('lock name'), { target: { value: 'L1' } });
  fireEvent.click(screen.getByRole('button', { name: 'Record' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Delete event T1 L1 acquire' })).toBeTruthy());
}

describe('LockProfiler delete/confirm (GB-1538)', () => {
  beforeEach(() => { calls.length = 0; });

  it('per-event delete: arms first, then deletes by the server-recorded id', async () => {
    render(<LockProfiler />);
    await recordOne();
    fireEvent.click(screen.getByRole('button', { name: 'Delete event T1 L1 acquire' }));
    expect(calls.filter((c) => c.action === 'deleteLockEvent')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete event T1 L1 acquire' }));
    await waitFor(() => expect(calls.filter((c) => c.action === 'deleteLockEvent')).toHaveLength(1));
    expect(calls.find((c) => c.action === 'deleteLockEvent')?.input).toEqual({ id: 'lt_test_1' });
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Delete event T1 L1 acquire' })).toBeNull());
  });

  it('Clear wipes the trace only after the confirm step', async () => {
    render(<LockProfiler />);
    await recordOne();
    fireEvent.click(screen.getByRole('button', { name: 'Clear lock trace' }));
    expect(calls.filter((c) => c.action === 'clearLockTrace')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm clear lock trace' }));
    await waitFor(() => expect(calls.filter((c) => c.action === 'clearLockTrace')).toHaveLength(1));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Delete event T1 L1 acquire' })).toBeNull());
  });
});
