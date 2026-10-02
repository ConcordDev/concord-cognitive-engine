'use client';

/** Saved north star — the caller's saved items, two panes, nothing invented. */

import { useState } from 'react';
import { LensShell } from '@/components/lens/LensShell';
import { NorthGreeting, QuietMore, northCtaClass } from '@/components/code/CodeFamilyChrome';
import { NorthError, northPage, useMacro } from '@/components/lens/NorthStarChrome';
import { useAuth } from '@/hooks/useAuth';
import { useLensNav } from '@/hooks/useLensNav';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';

type SavedItem = {
  id: string;
  title?: string | null;
  url?: string | null;
  author?: string | null;
  excerpt?: string | null;
  note?: string | null;
};

export function WorthKeeping({ onOpenDesk }: { onOpenDesk: () => void }) {
  useLensNav('saved');
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [actError, setActError] = useState('');
  const listQ = useMacro<{ items?: SavedItem[] }>(
    ['saved-northstar', 'list'],
    'saved',
    'list',
    { limit: 40, sortBy: 'savedAt' },
    (result) => {
      if (!Array.isArray(result.items)) throw new Error('Saved items did not answer.');
      return result;
    },
  );
  const items = listQ.data?.items ?? [];
  const selected = items.find((it) => it.id === selectedId) ?? null;
  const loadError = listQ.error instanceof Error ? listQ.error.message : '';

  function openSaved() {
    setActError('');
    if (items.length === 0) {
      setActError('Nothing saved to open.');
      return;
    }
    setSelectedId(selected?.id ?? items[0].id);
  }

  return (
    <LensShell lensId="saved" asMain={false} disableAgentFab>
      <div data-lens-theme="saved" className={northPage}>
        <div className="flex items-start justify-between gap-4">
          <NorthGreeting kicker="Saved" title={who ? `What's worth keeping, ${who}` : "What's worth keeping"} />
          <QuietMore
            items={[
              { id: 'collections', label: 'Collections' },
              { id: 'social', label: 'Social bookmarks' },
            ]}
            onPick={onOpenDesk}
          />
        </div>

        {loadError && <NorthError message={loadError} />}
        {actError && <NorthError message={actError} />}

        {listQ.data && (
          <div className="mt-6 grid min-h-[420px] grid-cols-1 overflow-hidden rounded-2xl border border-white/10 md:grid-cols-[240px_1fr]" data-testid="saved-panes">
            <div className="border-b border-white/10 p-4 md:border-b-0 md:border-r">
              {items.length === 0 ? (
                <p className="text-[14px] text-zinc-400">Nothing saved yet.</p>
              ) : (
                <ul className="space-y-1">
                  {items.map((it) => (
                    <li key={it.id}>
                      <button
                        type="button"
                        onClick={() => { setActError(''); setSelectedId(it.id); }}
                        className={`w-full rounded-lg px-2 py-1.5 text-left text-[14px] ${selectedId === it.id ? 'bg-white/10 text-zinc-100' : 'text-zinc-300 hover:bg-white/[0.04]'}`}
                      >
                        {it.title || 'Untitled'}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="p-4">
              {!selected && <p className="text-[14px] text-zinc-500">Nothing selected.</p>}
              {selected && (
                <div data-testid="saved-open">
                  <p className="text-[16px] text-zinc-100">{selected.title || 'Untitled'}</p>
                  {selected.author && <p className="mt-1 text-[13px] text-zinc-500">{selected.author}</p>}
                  {selected.excerpt && <p className="mt-3 text-[14px] text-zinc-300">{selected.excerpt}</p>}
                  {selected.note && <p className="mt-3 text-[14px] text-zinc-400">{selected.note}</p>}
                  {selected.url && (
                    <a href={selected.url} className="mt-3 inline-block text-[13px] text-teal-300 hover:text-teal-200">{selected.url}</a>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        <button type="button" className={northCtaClass} onClick={openSaved} disabled={listQ.isLoading}>
          Open saved
        </button>
      </div>
    </LensShell>
  );
}
