'use client';

/** Classroom north star — cohorts from list_cohorts. No invented class. */

import { useState } from 'react';
import { LensShell } from '@/components/lens/LensShell';
import { NorthGreeting, QuietMore, northCtaClass } from '@/components/code/CodeFamilyChrome';
import { NorthError, northPage, useMacro } from '@/components/lens/NorthStarChrome';
import { useAuth } from '@/hooks/useAuth';
import { useLensNav } from '@/hooks/useLensNav';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';

type Cohort = { id: number | string; name?: string; enrolled?: number };

export function TheRoom({ onOpenDesk }: { onOpenDesk: () => void }) {
  useLensNav('classroom');
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [actError, setActError] = useState('');
  const listQ = useMacro<{ teaching?: Cohort[]; studying?: Cohort[] }>(
    ['classroom-northstar', 'cohorts'],
    'classroom',
    'list_cohorts',
    {},
    (result) => {
      const bag = result as { teaching?: Cohort[]; studying?: Cohort[]; ok?: boolean; error?: string; reason?: string };
      if (bag.ok === false) throw new Error(bag.error || bag.reason || 'Classes did not answer.');
      if (!Array.isArray(bag.teaching) || !Array.isArray(bag.studying)) throw new Error('Classes did not answer.');
      return bag;
    },
  );
  const teaching = listQ.data?.teaching ?? [];
  const studying = listQ.data?.studying ?? [];
  const rows = [
    ...teaching.map((c) => ({ ...c, role: 'Teaching' })),
    ...studying.filter((c) => !teaching.some((t) => String(t.id) === String(c.id))).map((c) => ({ ...c, role: 'Studying' })),
  ];
  const selected = rows.find((c) => String(c.id) === selectedId) ?? null;
  const loadError = listQ.error instanceof Error ? listQ.error.message : '';

  function openClass() {
    setActError('');
    if (!listQ.data) return;
    if (rows.length === 0) {
      setActError('No class to open.');
      return;
    }
    setSelectedId(String(selected?.id ?? rows[0].id));
  }

  return (
    <LensShell lensId="classroom" asMain={false} disableAgentFab>
      <div data-lens-theme="classroom" className={northPage}>
        <div className="flex items-start justify-between gap-4">
          <NorthGreeting kicker="Classroom" title={who ? `The room, ${who}` : 'The room'} />
          <QuietMore items={[{ id: 'desk', label: 'Cohorts' }]} onPick={onOpenDesk} />
        </div>
        {(loadError || actError) && <NorthError message={loadError || actError} />}
        {listQ.data && (
          <div className="mt-6 grid min-h-[420px] grid-cols-1 overflow-hidden rounded-2xl border border-white/10 md:grid-cols-[240px_1fr]" data-testid="classroom-panes">
            <div className="border-b border-white/10 p-4 md:border-b-0 md:border-r">
              {rows.length === 0 ? (
                <p className="text-[14px] text-zinc-400">No class open.</p>
              ) : (
                <ul className="space-y-1">
                  {rows.map((c) => (
                    <li key={`${c.role}-${c.id}`}>
                      <button
                        type="button"
                        onClick={() => { setActError(''); setSelectedId(String(c.id)); }}
                        className={`w-full rounded-lg px-2 py-1.5 text-left text-[14px] ${selectedId === String(c.id) ? 'bg-white/10 text-zinc-100' : 'text-zinc-300 hover:bg-white/[0.04]'}`}
                      >
                        {c.name || 'Untitled'}
                        <span className="mt-0.5 block text-[12px] text-zinc-500">{c.role}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="p-4">
              {!selected && <p className="text-[14px] text-zinc-500">Nothing selected.</p>}
              {selected && (
                <div data-testid="classroom-open">
                  <p className="text-[16px] text-zinc-100">{selected.name || 'Untitled'}</p>
                  <p className="mt-1 text-[13px] text-zinc-500">{selected.role}</p>
                  {typeof selected.enrolled === 'number' && (
                    <p className="mt-3 text-[14px] text-zinc-400 tabular-nums">{selected.enrolled} enrolled</p>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
        <button type="button" className={northCtaClass} onClick={openClass} disabled={listQ.isLoading}>Open a class</button>
      </div>
    </LensShell>
  );
}
