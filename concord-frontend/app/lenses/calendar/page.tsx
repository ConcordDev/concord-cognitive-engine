'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { GCalSection } from '@/components/calendar/GCalSection';
import { TimezoneTools } from '@/components/calendar/TimezoneTools';
import { ScheduleAnalyzer } from '@/components/calendar/ScheduleAnalyzer';
import { AppointmentSchedules } from '@/components/calendar/AppointmentSchedules';
import { CalendarParityHub } from '@/components/calendar/CalendarParityHub';
import { LensFeedButton } from '@/components/lens/LensFeedButton';
import { CalendarActionPanel } from '@/components/calendar/CalendarActionPanel';
import { CalendarGridWorkbench } from '@/components/calendar/CalendarGridWorkbench';
import { PipingProvider } from '@/components/panel-polish';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensIdentity } from '@/hooks/useLensIdentity';

/**
 * Calendar lens, per docs/lens-northstar/08: the month grid is the page.
 * The other tools (Google sync, booking pages, sharing, conflicts,
 * timezones, scheduler) are full views reached from a quiet "More" menu.
 */
export type CalendarView = 'calendar' | 'google' | 'book' | 'sync' | 'analyze' | 'tools' | 'bench';

const SECONDARY: { id: Exclude<CalendarView, 'calendar'>; label: string; key?: string }[] = [
  { id: 'google', label: 'Google + tasks', key: 'O' },
  { id: 'book', label: 'Booking pages', key: 'B' },
  { id: 'sync', label: 'Sync & share', key: 'S' },
  { id: 'analyze', label: 'Conflicts', key: 'C' },
  { id: 'tools', label: 'Timezones' },
  { id: 'bench', label: 'Scheduler' },
];

function MoreMenu({ onPick }: { onPick: (v: CalendarView) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="text-[14px] text-zinc-500 transition-colors hover:text-zinc-200"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        More
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full z-40 mt-2 w-52 rounded-xl border border-white/10 bg-[#141414] p-1 shadow-2xl">
          {SECONDARY.map((v) => (
            <button
              key={v.id}
              role="menuitem"
              type="button"
              onClick={() => { setOpen(false); onPick(v.id); }}
              className="flex w-full items-center rounded-md px-2.5 py-1.5 text-left text-[13px] text-zinc-300 hover:bg-white/[0.06] hover:text-zinc-50"
            >
              <span className="flex-1">{v.label}</span>
              {v.key && <kbd className="font-mono text-[11px] text-zinc-500">{v.key}</kbd>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function CalendarLensPage() {
  useLensNav('calendar');
  useLensIdentity('calendar');
  const [activeView, setActive] = useState<CalendarView>('calendar');

  useLensCommand(
    [
      { id: 'cal-grid', keys: 'g', description: 'Calendar grid', category: 'navigation', action: () => setActive('calendar') },
      { id: 'cal-google', keys: 'o', description: 'Google + tasks', category: 'navigation', action: () => setActive('google') },
      { id: 'cal-book', keys: 'b', description: 'Booking pages', category: 'navigation', action: () => setActive('book') },
      { id: 'cal-sync', keys: 's', description: 'Sync & share', category: 'navigation', action: () => setActive('sync') },
      { id: 'cal-analyze', keys: 'c', description: 'Conflicts', category: 'navigation', action: () => setActive('analyze') },
    ],
    { lensId: 'calendar' },
  );

  const secondary = SECONDARY.find((v) => v.id === activeView);

  return (
    <LensShell lensId="calendar" asMain={false}>
      <div data-lens-theme="calendar" className="flex min-h-[calc(100vh-4rem)] flex-col">
        {activeView === 'calendar' ? (
          <CalendarGridWorkbench headerExtra={<MoreMenu onPick={setActive} />} />
        ) : (
          <div className="px-8 pt-4 pb-8">
            <button
              type="button"
              onClick={() => setActive('calendar')}
              className="inline-flex items-center gap-1.5 text-[14px] text-zinc-500 transition-colors hover:text-zinc-200"
            >
              <ArrowLeft className="h-4 w-4" />
              Calendar
            </button>
            <h1 className="mt-2 mb-6 font-vault text-[2.25rem] leading-tight text-zinc-100">{secondary?.label}</h1>
            {activeView === 'google' && <GCalSection />}
            {activeView === 'book' && <AppointmentSchedules />}
            {activeView === 'sync' && <CalendarParityHub />}
            {activeView === 'analyze' && <ScheduleAnalyzer />}
            {activeView === 'tools' && <TimezoneTools />}
            {activeView === 'bench' && (
              <div className="space-y-3">
                <LensFeedButton domain="calendar" />
                <PipingProvider>
                  <CalendarActionPanel />
                </PipingProvider>
              </div>
            )}
          </div>
        )}
      </div>
    </LensShell>
  );
}
