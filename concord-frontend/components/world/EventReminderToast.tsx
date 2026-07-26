'use client';

// DET-C dead-event-listener fix — `event:reminder` is a real, scheduled
// server broadcast (server/lib/event-rsvp.js#sweepEventReminders, run every
// ~1min by the `event-reminder-sweep` heartbeat in server.js) that fires to
// a single user's `user:<id>` room ~10min before an event they RSVP'd to
// starts. Nothing in the frontend ever subscribed to it — the reminder was
// computed and sent, then silently dropped. This toast is the first real
// consumer: a small bottom-right notification, same shape/position as
// BrawlInviteToast, auto-dismissing once the event's start time passes.

import { useCallback, useEffect, useState } from 'react';
import { CalendarClock, X } from 'lucide-react';
import { subscribe } from '@/lib/realtime/socket';
import { sfx } from '@/lib/concordia/juice';

interface EventReminderPayload {
  eventId: string;
  worldId: string;
  startsAt: number; // unix seconds
  title: string;
}

interface ReminderEntry extends EventReminderPayload {
  receivedAt: number;
}

export function EventReminderToast() {
  const [reminders, setReminders] = useState<ReminderEntry[]>([]);

  useEffect(() => {
    const off = subscribe<EventReminderPayload>('event:reminder', (payload) => {
      if (!payload?.eventId) return;
      sfx('ui_discovery'); // existing 'notification-glow' voice — same one BrawlInviteToast/LFG use
      setReminders((prev) => {
        if (prev.some((r) => r.eventId === payload.eventId)) return prev;
        return [...prev, { ...payload, receivedAt: Date.now() }];
      });
    });
    return off;
  }, []);

  // Drop a reminder once its event's start time has actually passed —
  // the toast stops being useful information at that point.
  useEffect(() => {
    if (reminders.length === 0) return;
    const t = setInterval(() => {
      const nowSec = Math.floor(Date.now() / 1000);
      setReminders((prev) => prev.filter((r) => r.startsAt > nowSec - 60));
    }, 15_000);
    return () => clearInterval(t);
  }, [reminders.length]);

  const dismiss = useCallback((eventId: string) => {
    setReminders((prev) => prev.filter((r) => r.eventId !== eventId));
  }, []);

  if (reminders.length === 0) return null;

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-40 flex flex-col gap-2">
      {reminders.map((r) => {
        const minutesLeft = Math.max(0, Math.round((r.startsAt * 1000 - Date.now()) / 60_000));
        return (
          <div
            key={r.eventId}
            className="concordia-hud-fade pointer-events-auto w-72 rounded-lg border border-amber-500/40 bg-zinc-950/95 p-3 shadow-xl backdrop-blur"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-start gap-2">
                <CalendarClock size={14} className="mt-0.5 shrink-0 text-amber-300" />
                <div>
                  <div className="text-xs font-semibold text-amber-100">{r.title || 'Event'}</div>
                  <div className="text-[10px] text-amber-300/70">
                    {minutesLeft <= 0 ? 'Starting now' : `Starts in ${minutesLeft} min`}
                  </div>
                </div>
              </div>
              <button
                onClick={() => dismiss(r.eventId)}
                aria-label="Dismiss reminder"
                className="rounded p-1 text-zinc-400 hover:bg-zinc-800"
              >
                <X size={11} />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
