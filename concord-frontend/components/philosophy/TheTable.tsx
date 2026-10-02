'use client';

/** Philosophy north star — one channel on the table, created only with a title. */

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { LensShell } from '@/components/lens/LensShell';
import { NorthGreeting, QuietMore, northCtaClass } from '@/components/code/CodeFamilyChrome';
import { NorthError, northPage, useMacro } from '@/components/lens/NorthStarChrome';
import { lensRun } from '@/lib/api/client';
import { useAuth } from '@/hooks/useAuth';
import { useLensNav } from '@/hooks/useLensNav';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';

type Channel = { id: string; title?: string; description?: string };

export function TheTable({ onOpenDesk }: { onOpenDesk: () => void }) {
  useLensNav('philosophy');
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const client = useQueryClient();
  const [armed, setArmed] = useState(false);
  const [title, setTitle] = useState('');
  const [open, setOpen] = useState<Channel | null>(null);
  const [openError, setOpenError] = useState('');
  const listQ = useMacro<{ channels?: Channel[] }>(
    ['philosophy-northstar', 'channels'],
    'philosophy',
    'channel-list',
    {},
    (result) => {
      if (!Array.isArray(result.channels)) throw new Error('The table did not answer.');
      return result;
    },
    armed,
  );
  const begin = useMutation({
    mutationFn: async (nextTitle: string) => {
      const res = await lensRun<{ channel?: Channel }>('philosophy', 'channel-create', { title: nextTitle });
      if (!res.data.ok || !res.data.result?.channel?.id) {
        throw new Error(res.data.error || 'The question was not opened.');
      }
      return res.data.result.channel;
    },
    onSuccess: (channel) => {
      setOpen(channel);
      setTitle('');
      void client.invalidateQueries({ queryKey: ['philosophy-northstar', 'channels'] });
    },
  });
  const channels = listQ.data?.channels ?? [];
  const loadError = listQ.error instanceof Error ? listQ.error.message : '';
  const actError = begin.error instanceof Error ? begin.error.message : '';

  async function openExisting(id: string) {
    setOpenError('');
    const res = await lensRun<{ channel?: Channel }>('philosophy', 'channel-detail', { id });
    if (!res.data.ok || !res.data.result?.channel?.id) {
      setOpenError(res.data.error || 'That question did not open.');
      return;
    }
    setOpen(res.data.result.channel);
  }

  function onBegin() {
    if (!armed) {
      setArmed(true);
      return;
    }
    const next = title.trim();
    if (!next) return;
    begin.mutate(next);
  }

  return (
    <LensShell lensId="philosophy" asMain={false} disableAgentFab>
      <div data-lens-theme="philosophy" className={northPage}>
        <div className="flex items-start justify-between gap-4">
          <NorthGreeting kicker="Philosophy" title={who ? `The question on the table, ${who}` : 'The question on the table'} />
          <QuietMore items={[{ id: 'desk', label: 'Channels' }]} onPick={onOpenDesk} />
        </div>
        {(loadError || actError || openError) && <NorthError message={loadError || actError || openError} />}
        {!open && (
          <div className="mt-6 min-h-[420px] rounded-2xl border border-white/10 px-4 py-4" data-testid="philosophy-table">
            {!armed && <p className="text-[14px] text-zinc-400">No question open.</p>}
            {armed && listQ.data && channels.length === 0 && <p className="text-[14px] text-zinc-400">No question open.</p>}
            {channels.length > 0 && (
              <ul className="divide-y divide-white/10">
                {channels.map((ch) => (
                  <li key={ch.id}>
                    <button type="button" onClick={() => { void openExisting(ch.id); }} className="w-full py-3 text-left text-[15px] text-zinc-100">
                      {ch.title || 'Untitled'}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {armed && listQ.data && (
              <label className="mt-4 block text-[13px] text-zinc-500">
                Question
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-white/10 bg-transparent px-3 py-2 text-[15px] text-zinc-100 outline-none"
                />
              </label>
            )}
          </div>
        )}
        {open && (
          <article className="mt-6 min-h-[420px] rounded-2xl border border-white/10 px-4 py-4" data-testid="philosophy-open">
            <h2 className="text-[18px] text-zinc-100">{open.title || 'Untitled'}</h2>
            {open.description?.trim() && <p className="mt-3 text-[15px] text-zinc-200">{open.description}</p>}
          </article>
        )}
        <button type="button" className={northCtaClass} onClick={onBegin} disabled={listQ.isFetching || begin.isPending}>Begin</button>
      </div>
    </LensShell>
  );
}
