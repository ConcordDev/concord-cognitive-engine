/**
 * F9 / S9 — Scheduler bench crash regression.
 *
 * The bench used to demand pasted JSON for the generic artifact
 * calculators; plausible input crashed the whole lens with
 * "Cannot read properties of undefined (reading 'slice')", and the
 * artifact schema (startTime/endTime) silently disabled every button.
 * The bench now runs on the real store through the STATE macros, and
 * every macro result is shape-checked before it is stored — a
 * malformed response becomes inline feedback, never a render crash.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

vi.mock('framer-motion', () => ({
  motion: { div: (props: Record<string, unknown>) => <div {...props} /> },
  AnimatePresence: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/components/panel-polish', () => ({
  usePipe: () => ({ publish: () => {} }),
  useRecallableAction: () => ({ run: async (fn: () => Promise<unknown>) => fn() }),
  RecallSlot: () => null,
}));
vi.mock('@/components/dtu/ContentClassLicenseFields', () => ({
  withContentLicense: (x: unknown) => x,
}));

const EVENTS = [
  { id: 'evt_1', title: 'Alpha', start: '2026-10-28T14:00:00.000Z', end: '2026-10-28T15:00:00.000Z' },
  { id: 'evt_2', title: 'Beta', start: '2026-10-28T14:30:00.000Z', end: '2026-10-28T15:30:00.000Z' },
];

let malformedConflicts = false;

const runDomainMock = vi.fn((_domain: string, action: string, _opts?: { input?: Record<string, unknown> }) => {
  switch (action) {
    case 'events-list':
      return Promise.resolve({ data: { ok: true, result: { events: EVENTS, count: EVENTS.length } } });
    case 'tasks-list':
      return Promise.resolve({ data: { ok: true, result: { tasks: [{ id: 'task_1', status: 'todo' }] } } });
    case 'conflicts-check':
      if (malformedConflicts) return Promise.resolve({ data: { ok: true, result: {} } });
      return Promise.resolve({
        data: {
          ok: true,
          result: {
            hasConflict: true,
            conflicts: [{ eventId: 'evt_1', title: 'Alpha', start: EVENTS[0].start, end: EVENTS[0].end }],
            pairs: [{ a: { title: 'Alpha', start: EVENTS[0].start, end: EVENTS[0].end }, b: { title: 'Beta', start: EVENTS[1].start, end: EVENTS[1].end }, overlapMinutes: 30 }],
          },
        },
      });
    case 'availability-find':
      return Promise.resolve({
        data: { ok: true, result: { freeSlots: [{ start: '2026-10-28T13:00:00.000Z', end: '2026-10-28T14:00:00.000Z' }], busyBlockCount: 2 } },
      });
    case 'ai-auto-schedule':
      return Promise.resolve({
        data: {
          ok: true,
          result: {
            day: '2026-10-28', scheduledCount: 1, unscheduledCount: 0,
            proposals: [{ taskId: 'task_1', title: 'Write report', priority: 'high', estimateMin: 30, proposedStart: '2026-10-28T13:00:00.000Z', proposedEnd: '2026-10-28T13:30:00.000Z' }],
          },
        },
      });
    case 'ical-export':
      return Promise.resolve({ data: { ok: true, result: { ics: 'BEGIN:VCALENDAR\r\nEND:VCALENDAR', eventCount: 2, contentType: 'text/calendar' } } });
    default:
      return Promise.resolve({ data: { ok: false, error: `unmocked ${action}` } });
  }
});

vi.mock('@/lib/api/client', () => ({
  api: { post: vi.fn(), delete: vi.fn(), get: vi.fn() },
  apiHelpers: { lens: { runDomain: (d: string, a: string, o?: { input?: Record<string, unknown> }) => runDomainMock(d, a, o) } },
  lensRun: vi.fn(() => Promise.resolve({ data: { ok: false, error: 'unused' } })),
}));

import { CalendarActionPanel } from '@/components/calendar/CalendarActionPanel';

describe('Scheduler bench (F9)', () => {
  beforeEach(() => {
    malformedConflicts = false;
    runDomainMock.mockClear();
  });

  it('loads the real calendar — no paste boxes anywhere', async () => {
    render(<CalendarActionPanel />);
    await waitFor(() => expect(screen.getByText(/2 real events · 1 open tasks/)).toBeTruthy());
    expect(screen.queryByRole('textbox', { name: /json/i })).toBeNull();
    expect(document.querySelectorAll('textarea').length).toBe(0);
  });

  it('conflicts / free time / optimize / ICS all run on the real events', async () => {
    render(<CalendarActionPanel />);
    await waitFor(() => expect(screen.getByText(/2 real events/)).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: /Conflicts/ }));
    await waitFor(() => expect(screen.getByText(/Alpha ⨯ Beta · 30min/)).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: /Free time/ }));
    await waitFor(() => expect(screen.getByText(/60\s*min free today|1 free slots/)).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: /Optimize/ }));
    await waitFor(() => expect(screen.getByText(/Write report/)).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: /ICS/ }));
    await waitFor(() => expect(screen.getByText(/ICS · 2 events/)).toBeTruthy());
  });

  it('a malformed macro result is inline feedback, never a crash (the slice regression)', async () => {
    malformedConflicts = true;
    render(<CalendarActionPanel />);
    await waitFor(() => expect(screen.getByText(/2 real events/)).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Conflicts/ }));
    await waitFor(() => expect(screen.getByText(/unexpected shape/)).toBeTruthy());
    // The bench is still alive and usable afterwards.
    expect(screen.getByText('Scheduler')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Free time/ }));
    await waitFor(() => expect(screen.getByText(/free today/)).toBeTruthy());
  });
});
