/**
 * Pins the real-time wiring fix for `event:reminder` (DET-C dead-event
 * sweep, batch 9): server/lib/event-rsvp.js#sweepEventReminders fires this
 * to a user's `user:<id>` room ~10min before an RSVP'd event starts, but no
 * frontend code ever subscribed — the reminder was computed and sent, then
 * silently dropped. EventReminderToast is the first real consumer.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, waitFor, act } from '@testing-library/react';

vi.mock('@/lib/realtime/socket', () => {
  const listeners: Record<string, Array<(data: unknown) => void>> = {};
  return {
    subscribe: vi.fn((event: string, cb: (data: unknown) => void) => {
      (listeners[event] ||= []).push(cb);
      return () => {
        listeners[event] = (listeners[event] || []).filter((f) => f !== cb);
      };
    }),
    __emit: (event: string, data?: unknown) => {
      (listeners[event] || []).forEach((cb) => cb(data));
    },
  };
});

import { EventReminderToast } from '@/components/world/EventReminderToast';
import * as socketMock from '@/lib/realtime/socket';

const emitSocket = (event: string, data?: unknown) =>
  (socketMock as unknown as { __emit: (e: string, d?: unknown) => void }).__emit(event, data);

describe('EventReminderToast — realtime wiring', () => {
  it('renders nothing until a real event:reminder payload arrives', () => {
    const { container } = render(<EventReminderToast />);
    expect(container.textContent).toBe('');
  });

  it('shows a toast from a real event:reminder socket payload', async () => {
    const { container } = render(<EventReminderToast />);
    const startsAt = Math.floor(Date.now() / 1000) + 300; // 5 min out

    act(() => {
      emitSocket('event:reminder', {
        eventId: 'evt-1', worldId: 'concordia-hub', startsAt, title: 'Harvest Festival',
      });
    });

    await waitFor(() => expect(container.textContent).toMatch(/Harvest Festival/));
    expect(container.textContent).toMatch(/Starts in \d+ min/);
  });

  it('ignores a malformed payload with no eventId', async () => {
    const { container } = render(<EventReminderToast />);
    act(() => { emitSocket('event:reminder', { title: 'No id here' }); });
    await new Promise((r) => setTimeout(r, 10));
    expect(container.textContent).toBe('');
  });

  it('dedupes repeated reminders for the same eventId', async () => {
    const { container } = render(<EventReminderToast />);
    const startsAt = Math.floor(Date.now() / 1000) + 120;
    act(() => {
      emitSocket('event:reminder', { eventId: 'evt-2', worldId: 'w', startsAt, title: 'Council Vote' });
      emitSocket('event:reminder', { eventId: 'evt-2', worldId: 'w', startsAt, title: 'Council Vote' });
    });
    await waitFor(() => expect(container.textContent).toMatch(/Council Vote/));
    expect(container.querySelectorAll('[aria-label="Dismiss reminder"]').length).toBe(1);
  });
});
