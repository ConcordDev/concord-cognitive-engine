'use client';

/** DTU browser north star — Browse loads the caller's units. Nothing is listed before that. */

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { LensShell } from '@/components/lens/LensShell';
import { NorthGreeting, QuietMore, northCtaClass } from '@/components/code/CodeFamilyChrome';
import { NorthError, northPage } from '@/components/lens/NorthStarChrome';
import { apiHelpers } from '@/lib/api/client';
import { useAuth } from '@/hooks/useAuth';
import { useLensNav } from '@/hooks/useLensNav';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';

type Unit = { id: string; title?: string; summary?: string };

function readUnits(data: unknown): Unit[] {
  if (!data || typeof data !== 'object') throw new Error('Units did not answer.');
  const bag = data as { dtus?: unknown; items?: unknown; result?: { dtus?: unknown; items?: unknown } };
  const rows = bag.dtus ?? bag.items ?? bag.result?.dtus ?? bag.result?.items;
  if (!Array.isArray(rows)) throw new Error('Units did not answer.');
  return rows.filter((row): row is Unit => !!row && typeof row === 'object' && typeof (row as Unit).id === 'string');
}

export function OneUnit({ onOpenDesk }: { onOpenDesk: () => void }) {
  useLensNav('dtus');
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const browse = useMutation({
    mutationFn: async () => {
      const res = await apiHelpers.dtus.paginated({ limit: 12, offset: 0, scope: 'mine' });
      return readUnits(res.data);
    },
  });
  const units = browse.data ?? [];
  const selected = units.find((u) => u.id === selectedId) ?? null;
  const actError = browse.error instanceof Error ? browse.error.message : '';
  const label = (u: Unit) => u.title || u.summary || u.id;

  return (
    <LensShell lensId="dtus" asMain={false} disableAgentFab>
      <div data-lens-theme="dtus" className={northPage}>
        <div className="flex items-start justify-between gap-4">
          <NorthGreeting kicker="DTU Browser" title={who ? `One unit of thought, ${who}` : 'One unit of thought'} />
          <QuietMore items={[{ id: 'browser', label: 'Browser' }]} onPick={onOpenDesk} />
        </div>

        {actError && <NorthError message={actError} />}

        {!browse.data && (
          <div className="mt-6 min-h-[420px] rounded-2xl border border-white/10 px-4 py-4" data-testid="dtu-empty">
            <p className="text-[14px] text-zinc-400">No unit selected.</p>
          </div>
        )}

        {browse.data && units.length === 0 && (
          <div className="mt-6 min-h-[420px] rounded-2xl border border-white/10 px-4 py-4" data-testid="dtu-none">
            <p className="text-[14px] text-zinc-400">Browse returned no units.</p>
          </div>
        )}

        {units.length > 0 && (
          <div className="mt-6 grid min-h-[420px] grid-cols-1 overflow-hidden rounded-2xl border border-white/10 md:grid-cols-[240px_1fr]" data-testid="dtu-units">
            <ul className="border-b border-white/10 p-2 md:border-b-0 md:border-r">
              {units.map((u) => (
                <li key={u.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(u.id)}
                    className={`w-full rounded-lg px-2 py-1.5 text-left text-[14px] ${selectedId === u.id ? 'bg-white/10 text-zinc-100' : 'text-zinc-300 hover:bg-white/[0.04]'}`}
                  >
                    {label(u)}
                  </button>
                </li>
              ))}
            </ul>
            <div className="p-4">
              {!selected && <p className="text-[14px] text-zinc-500">No unit selected.</p>}
              {selected && <p className="text-[16px] text-zinc-100">{label(selected)}</p>}
            </div>
          </div>
        )}

        <button type="button" className={northCtaClass} onClick={() => browse.mutate()} disabled={browse.isPending}>
          Browse
        </button>
      </div>
    </LensShell>
  );
}
