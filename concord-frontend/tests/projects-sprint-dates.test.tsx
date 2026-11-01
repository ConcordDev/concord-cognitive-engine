/**
 * A14 remainder — the sprint create form: the default range is VISIBLE
 * (pre-filled), a cleared/half-typed date blocks creation with a
 * message (never silently substituted), reversed dates block too.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const calls: { action: string; params: Record<string, unknown> }[] = [];
vi.mock('@/lib/api/client', () => ({
  lensRun: vi.fn(async (_lens: string, action: string, params: Record<string, unknown>) => {
    calls.push({ action, params });
    if (action === 'sprint-list') return { data: { ok: true, result: { sprints: [] } } };
    if (action === 'sprint-burndown') return { data: { ok: true, result: null } };
    return { data: { ok: true, result: {} } };
  }),
}));

import { PjSprintsPanel } from '../components/projects/PjSprintsPanel';

function dateInputs(container: HTMLElement) {
  return Array.from(container.querySelectorAll('input[type="date"]')) as HTMLInputElement[];
}

describe('PjSprintsPanel — sprint date integrity (A14)', () => {
  beforeEach(() => { calls.length = 0; vi.clearAllMocks(); });

  it('opens with the default range pre-filled and visible', async () => {
    const { container } = render(<PjSprintsPanel projectId="p1" onChange={() => {}} />);
    await screen.findByPlaceholderText('Sprint name');
    const [start, end] = dateInputs(container);
    const pad = (n: number) => String(n).padStart(2, '0');
    const now = new Date();
    const local = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    expect(start.value).toBe(local(now));
    expect(end.value).toBe(local(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 14)));
  });

  it('at 23:00 local the start date is the local today, not the UTC tomorrow (#1862 follow-up)', async () => {
    const prevTz = process.env.TZ;
    process.env.TZ = 'America/New_York'; // 23:00 EST on Nov 20 is already Nov 21 in UTC
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 20, 23, 0, 0));
    try {
      const { container } = render(<PjSprintsPanel projectId="p1" onChange={() => {}} />);
      await screen.findByPlaceholderText('Sprint name');
      const [start, end] = dateInputs(container);
      expect(start.value).toBe('2026-11-20');
      expect(end.value).toBe('2026-12-04');
    } finally {
      vi.useRealTimers();
      if (prevTz === undefined) delete process.env.TZ; else process.env.TZ = prevTz;
    }
  });

  it('a cleared date blocks creation with a message — nothing is submitted', async () => {
    const { container } = render(<PjSprintsPanel projectId="p1" onChange={() => {}} />);
    const nameInput = await screen.findByPlaceholderText('Sprint name');
    fireEvent.change(nameInput, { target: { value: 'Sprint X' } });
    const [, end] = dateInputs(container);
    fireEvent.change(end, { target: { value: '' } });
    const btn = screen.getByRole('button', { name: 'Sprint' });
    fireEvent.click(btn);
    expect(await screen.findByText(/half-typed/)).toBeInTheDocument();
    expect(calls.filter((c) => c.action === 'sprint-create')).toHaveLength(0);
  });

  it('reversed dates block creation with a message', async () => {
    const { container } = render(<PjSprintsPanel projectId="p1" onChange={() => {}} />);
    const nameInput = await screen.findByPlaceholderText('Sprint name');
    fireEvent.change(nameInput, { target: { value: 'Sprint Y' } });
    const [start, end] = dateInputs(container);
    fireEvent.change(start, { target: { value: '2026-11-20' } });
    fireEvent.change(end, { target: { value: '2026-11-10' } });
    const btn = screen.getByRole('button', { name: 'Sprint' });
    fireEvent.click(btn);
    expect(await screen.findByText(/end date is before its start date/)).toBeInTheDocument();
    expect(calls.filter((c) => c.action === 'sprint-create')).toHaveLength(0);
  });
});
