'use client';

/** History north star — one timeline, only after a record is opened. */

import { useState } from 'react';
import { LensShell } from '@/components/lens/LensShell';
import { NorthGreeting, QuietMore, northCtaClass } from '@/components/code/CodeFamilyChrome';
import { NorthError, northPage, useMacro } from '@/components/lens/NorthStarChrome';
import { lensRun } from '@/lib/api/client';
import { useAuth } from '@/hooks/useAuth';
import { useLensNav } from '@/hooks/useLensNav';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';

type TimelineSummary = { id: string; title?: string; eventCount?: number };
type TimelineEvent = { id?: string; title?: string; year?: number };
type Timeline = { id: string; title?: string; description?: string; events?: TimelineEvent[] };

export function TheRecord({ onOpenDesk }: { onOpenDesk: () => void }) {
  useLensNav('history');
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const [armed, setArmed] = useState(false);
  const [open, setOpen] = useState<Timeline | null>(null);
  const [openError, setOpenError] = useState('');
  const listQ = useMacro<{ timelines?: TimelineSummary[] }>(
    ['history-northstar', 'timelines'],
    'history',
    'timeline-list',
    {},
    (result) => {
      if (!Array.isArray(result.timelines)) throw new Error('Records did not answer.');
      return result;
    },
    armed,
  );
  const timelines = listQ.data?.timelines ?? [];
  const loadError = listQ.error instanceof Error ? listQ.error.message : '';

  async function openExisting(id: string) {
    setOpenError('');
    const res = await lensRun<{ timeline?: Timeline }>('history', 'timeline-detail', { id });
    if (!res.data.ok || !res.data.result?.timeline?.id) {
      setOpenError(res.data.error || 'That record did not open.');
      return;
    }
    setOpen(res.data.result.timeline);
  }

  const events = (open?.events ?? []).filter((ev) => typeof ev.title === 'string' && ev.title.trim().length > 0);

  return (
    <LensShell lensId="history" asMain={false} disableAgentFab>
      <div data-lens-theme="history" className={northPage}>
        <div className="flex items-start justify-between gap-4">
          <NorthGreeting kicker="History" title={who ? `The record, ${who}` : 'The record'} />
          <QuietMore items={[{ id: 'desk', label: 'Timelines' }]} onPick={onOpenDesk} />
        </div>
        {(loadError || openError) && <NorthError message={loadError || openError} />}
        {!open && (
          <div className="mt-6 min-h-[420px] rounded-2xl border border-white/10 px-4 py-4" data-testid="history-record">
            {!armed && <p className="text-[14px] text-zinc-400">No record open.</p>}
            {armed && listQ.data && timelines.length === 0 && <p className="text-[14px] text-zinc-400">No record to open.</p>}
            {timelines.length > 0 && (
              <ul className="divide-y divide-white/10">
                {timelines.map((t) => (
                  <li key={t.id}>
                    <button type="button" onClick={() => { void openExisting(t.id); }} className="w-full py-3 text-left text-[15px] text-zinc-100">
                      {t.title || 'Untitled'}
                      {typeof t.eventCount === 'number' && (
                        <span className="ml-2 text-[13px] text-zinc-500">{t.eventCount} events</span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {open && (
          <article className="mt-6 min-h-[420px] rounded-2xl border border-white/10 px-4 py-4" data-testid="history-open">
            <h2 className="text-[18px] text-zinc-100">{open.title || 'Untitled'}</h2>
            {open.description?.trim() && <p className="mt-3 text-[15px] text-zinc-300">{open.description}</p>}
            {events.length === 0 && <p className="mt-3 text-[14px] text-zinc-500">This record has no events.</p>}
            {events.length > 0 && (
              <ul className="mt-3 divide-y divide-white/10">
                {events.map((ev, i) => (
                  <li key={ev.id || `${i}-${ev.title}`} className="py-2 text-[15px] text-zinc-200">
                    {typeof ev.year === 'number' && <span className="mr-2 tabular-nums text-zinc-500">{ev.year}</span>}
                    {ev.title}
                  </li>
                ))}
              </ul>
            )}
          </article>
        )}
        <button type="button" className={northCtaClass} onClick={() => setArmed(true)} disabled={listQ.isFetching}>
          Open a record
        </button>
      </div>
    </LensShell>
  );
}
