/**
 * F4 / S4 — description integrity (the A/B test from the frozen review).
 *
 * One event's description must never appear in a fresh form or in another
 * event's detail. The bug: the create/edit form's description field was a
 * DraftedTextarea keyed to a single lens-wide draft ("event-description"),
 * so the previous event's text hydrated into every new form and was saved
 * into the next event. The field is now a plain controlled input bound to
 * the per-event form state.
 *
 * The backend is a stateful fake over the real lensRun channel: what the
 * form sends to events-create is what events-list returns, exactly like
 * server/domains/calendar.js's STATE store.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { username: 'ramaj' } }),
}));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/store/ui', () => ({
  useUIStore: { getState: () => ({ addToast: () => {} }) },
}));

interface StoredEvent {
  id: string;
  number: string;
  calendarId: string;
  title: string;
  description: string;
  location: string;
  start: string;
  end: string;
  allDay: boolean;
  recurrence: null;
  reminders: number[];
  attendees: string[];
  conferenceLink: string;
  createdAt: string;
}

const store: StoredEvent[] = [];
let seq = 0;
const createCalls: Record<string, unknown>[] = [];

const lensRunMock = vi.fn((spec: { action: string; input?: Record<string, unknown> }) => {
  const { action, input = {} } = spec;
  if (action === 'calendars-list') {
    return Promise.resolve({
      data: {
        ok: true,
        result: {
          calendars: [
            { id: 'cal_1', number: 'CAL-001', name: 'Personal', color: '#4285f4', visible: true, isDefault: true },
          ],
        },
      },
    });
  }
  if (action === 'events-list') {
    const events = store.map((e) => ({ ...e, occurrenceStart: e.start, occurrenceEnd: e.end, occurrenceKey: e.start }));
    return Promise.resolve({ data: { ok: true, result: { events, count: events.length } } });
  }
  if (action === 'events-create') {
    createCalls.push(input);
    seq += 1;
    const ev: StoredEvent = {
      id: `evt_${seq}`,
      number: `EV-${String(seq).padStart(6, '0')}`,
      calendarId: 'cal_1',
      title: String(input.title || ''),
      description: String(input.description || ''),
      location: String(input.location || ''),
      start: String(input.start || ''),
      end: String(input.end || ''),
      allDay: Boolean(input.allDay),
      recurrence: null,
      reminders: [],
      attendees: [],
      conferenceLink: '',
      createdAt: new Date().toISOString(),
    };
    store.push(ev);
    return Promise.resolve({ data: { ok: true, result: { event: ev } } });
  }
  if (action === 'events-delete') {
    const i = store.findIndex((e) => e.id === input.id);
    if (i >= 0) store.splice(i, 1);
    return Promise.resolve({ data: { ok: true, result: { deleted: true } } });
  }
  if (action === 'conflicts-check') {
    return Promise.resolve({ data: { ok: true, result: { conflicts: [], conflictCount: 0 } } });
  }
  return Promise.resolve({ data: { ok: true, result: {} } });
});

vi.mock('@/lib/api/client', () => ({
  lensRun: (spec: { action: string; input?: Record<string, unknown> }) => lensRunMock(spec),
}));

import { CalendarGridWorkbench } from '@/components/calendar/CalendarGridWorkbench';

async function openCreateForm() {
  const btn = await screen.findByRole('button', { name: 'Schedule Event' });
  fireEvent.click(btn);
  return screen.findByPlaceholderText('Add title');
}

describe('description integrity (F4)', () => {
  beforeEach(() => {
    store.length = 0;
    createCalls.length = 0;
    seq = 0;
    lensRunMock.mockClear();
  });

  it("a fresh form never inherits the previous event's description, and B is saved without it", async () => {
    render(<CalendarGridWorkbench />);

    // Create event A with a distinctive description.
    const titleA = await openCreateForm();
    fireEvent.change(titleA, { target: { value: 'Event A' } });
    const descA = screen.getByPlaceholderText('Add notes, details, links...');
    fireEvent.change(descA, { target: { value: 'A secret note' } });
    fireEvent.click(screen.getByRole('button', { name: 'Schedule' }));
    await waitFor(() => expect(createCalls.length).toBe(1));
    expect(String(createCalls[0].description)).toContain('A secret note');

    // A fresh create form must open with an EMPTY description.
    const titleB = await openCreateForm();
    const descB = screen.getByPlaceholderText('Add notes, details, links...') as HTMLTextAreaElement;
    expect(descB.value).toBe('');

    // Save B with no description: its stored record must not contain A's text.
    fireEvent.change(titleB, { target: { value: 'Event B' } });
    fireEvent.click(screen.getByRole('button', { name: 'Schedule' }));
    await waitFor(() => expect(createCalls.length).toBe(2));
    expect(String(createCalls[1].description || '')).not.toContain('A secret note');

    // A's own detail still shows its description (rendered from its record).
    const aNodes = await screen.findAllByText('Event A');
    fireEvent.click(aNodes[0]);
    expect(await screen.findByText('A secret note')).toBeTruthy();
  });
});
