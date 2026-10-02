'use client';

/** Codex north star — one authored page, only after the canon is asked. */

import { useState } from 'react';
import { LensShell } from '@/components/lens/LensShell';
import { NorthGreeting, QuietMore, northCtaClass } from '@/components/code/CodeFamilyChrome';
import { NorthError, northPage, useMacro } from '@/components/lens/NorthStarChrome';
import { lensRun } from '@/lib/api/client';
import { useAuth } from '@/hooks/useAuth';
import { useLensNav } from '@/hooks/useLensNav';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';

type LoreEvent = { id: string; title?: string; description?: string; era?: string };

export function TheCodexPage({ onOpenDesk }: { onOpenDesk: () => void }) {
  useLensNav('codex');
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const [armed, setArmed] = useState(false);
  const [open, setOpen] = useState<LoreEvent | null>(null);
  const [openError, setOpenError] = useState('');
  const listQ = useMacro<{ events?: LoreEvent[] }>(
    ['codex-northstar', 'pages'],
    'lore',
    'list',
    { limit: 40 },
    (result) => {
      if (!Array.isArray(result.events)) throw new Error('The codex did not answer.');
      return result;
    },
    armed,
  );
  const events = (listQ.data?.events ?? []).filter((ev) => ev.id && ev.title);
  const loadError = listQ.error instanceof Error ? listQ.error.message : '';

  async function openExisting(id: string) {
    setOpenError('');
    const res = await lensRun<{ event?: LoreEvent } & LoreEvent>('lore', 'get', { id });
    const event = res.data.result?.event ?? (res.data.result?.id ? res.data.result : null);
    if (!res.data.ok || !event?.id) {
      setOpenError(res.data.error || 'That page did not open.');
      return;
    }
    setOpen(event);
  }

  return (
    <LensShell lensId="codex" asMain={false} disableAgentFab>
      <div data-lens-theme="codex" className={northPage}>
        <div className="flex items-start justify-between gap-4">
          <NorthGreeting kicker="Codex" title={who ? `The codex page, ${who}` : 'The codex page'} />
          <QuietMore items={[{ id: 'desk', label: 'Canon' }]} onPick={onOpenDesk} />
        </div>
        {(loadError || openError) && <NorthError message={loadError || openError} />}
        {!open && (
          <div className="mt-6 min-h-[420px] rounded-2xl border border-white/10 px-4 py-4" data-testid="codex-page">
            {!armed && <p className="text-[14px] text-zinc-400">No page open.</p>}
            {armed && listQ.data && events.length === 0 && <p className="text-[14px] text-zinc-400">No page to open.</p>}
            {events.length > 0 && (
              <ul className="divide-y divide-white/10">
                {events.map((ev) => (
                  <li key={ev.id}>
                    <button type="button" onClick={() => { void openExisting(ev.id); }} className="w-full py-3 text-left text-[15px] text-zinc-100">
                      {ev.title}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {open && (
          <article className="mt-6 min-h-[420px] rounded-2xl border border-white/10 px-4 py-4" data-testid="codex-open">
            <h2 className="text-[18px] text-zinc-100">{open.title || 'Untitled'}</h2>
            {open.era && <p className="mt-1 text-[13px] text-zinc-500">{open.era}</p>}
            {open.description?.trim() && <p className="mt-3 text-[15px] text-zinc-200">{open.description}</p>}
          </article>
        )}
        <button type="button" className={northCtaClass} onClick={() => setArmed(true)} disabled={listQ.isFetching}>
          Open a page
        </button>
      </div>
    </LensShell>
  );
}
