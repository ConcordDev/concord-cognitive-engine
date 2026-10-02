'use client';

/**
 * Analytics north star — one chart, and only after a stream is chosen.
 * Counts come from event-list. No bars until that call returns.
 */

import { useState } from 'react';
import { LensShell } from '@/components/lens/LensShell';
import { NorthGreeting, QuietMore, northCtaClass } from '@/components/code/CodeFamilyChrome';
import { FamilyPill, NorthError, NorthNote, northPage, useMacro } from '@/components/lens/NorthStarChrome';
import { useAuth } from '@/hooks/useAuth';
import { useLensNav } from '@/hooks/useLensNav';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';

type Stream = { name: string; count: number };
type EventRow = { id?: string; at?: string; name?: string };

function bucketDays(events: EventRow[]): { day: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const ev of events) {
    const day = String(ev.at || '').slice(0, 10) || 'undated';
    counts.set(day, (counts.get(day) || 0) + 1);
  }
  return [...counts.entries()].map(([day, count]) => ({ day, count }));
}

const PILL = [
  { id: 'analytics', label: 'Analytics', href: '/lenses/analytics' },
  { id: 'forecast', label: 'Forecast', href: '/lenses/forecast' },
];

export function OneChart({ onOpenDesk }: { onOpenDesk: () => void }) {
  useLensNav('analytics');
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const streamsQ = useMacro<{ topEvents?: Stream[] }>(
    ['analytics-northstar', 'streams'],
    'analytics',
    'event-stats',
    {},
    (result) => {
      if (!Array.isArray(result.topEvents)) throw new Error('Streams did not answer.');
      return result;
    },
  );
  const streams = (streamsQ.data?.topEvents || []).filter((s) => s && s.name);
  const [picking, setPicking] = useState(false);
  const [chosen, setChosen] = useState('');
  const eventsQ = useMacro<{ events?: EventRow[] }>(
    ['analytics-northstar', 'events', chosen],
    'analytics',
    'event-list',
    { name: chosen },
    (result) => {
      if (!Array.isArray(result.events)) throw new Error('That stream did not answer.');
      return result;
    },
    Boolean(chosen),
  );
  const bars = eventsQ.data?.events
    ? bucketDays(eventsQ.data.events)
    : null;

  const max = bars && bars.length ? Math.max(...bars.map((b) => b.count)) : 0;

  return (
    <LensShell lensId="analytics" asMain={false} disableAgentFab>
      <div data-lens-theme="analytics" className={northPage}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <NorthGreeting kicker="Analytics" title={who ? `The one chart, ${who}` : 'The one chart'} />
            <FamilyPill label="Analytics" active="analytics" items={PILL} />
          </div>
          <QuietMore items={[{ id: 'desk', label: 'Analytics desk' }]} onPick={onOpenDesk} />
        </div>

        {chosen && <p className="mt-6 text-[13px] text-zinc-500">{chosen}</p>}
        {streamsQ.isSuccess && streams.length === 0 && !chosen && <NorthNote>No streams yet</NorthNote>}
        {(streamsQ.error || eventsQ.error) && (
          <NorthError message={(streamsQ.error || eventsQ.error) instanceof Error ? (streamsQ.error || eventsQ.error)!.message : 'Streams did not answer.'} />
        )}

        {bars && bars.length > 0 && (
          <ul data-testid="analytics-chart" className="mt-6 max-w-xl space-y-2" aria-label={`${chosen} by day`}>
            {bars.map((b) => (
              <li key={b.day} className="grid grid-cols-[6rem_1fr_2rem] items-center gap-3 text-[13px]">
                <span className="text-zinc-500">{b.day}</span>
                <span className="h-2 rounded-full bg-white/10">
                  <span className="block h-2 rounded-full bg-teal-300/80" style={{ width: `${max > 0 ? (b.count / max) * 100 : 0}%` }} />
                </span>
                <span className="tabular-nums text-zinc-300">{b.count}</span>
              </li>
            ))}
          </ul>
        )}
        {bars && bars.length === 0 && <NorthNote>No events in this stream</NorthNote>}

        {picking && streams && streams.length > 0 && (
          <ul className="mt-6 max-w-xl space-y-1">
            {streams.map((s) => (
              <li key={s.name}>
                <button type="button" onClick={() => { setChosen(s.name); setPicking(false); }} className="text-[14px] text-zinc-300 hover:text-zinc-50">
                  {s.name}
                  {Number.isFinite(s.count) ? ` · ${s.count}` : ''}
                </button>
              </li>
            ))}
          </ul>
        )}

        <button type="button" className={northCtaClass} onClick={() => setPicking(true)}>Choose a stream</button>
      </div>
    </LensShell>
  );
}
