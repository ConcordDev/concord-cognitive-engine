'use client';

/**
 * PlaybooksPanel — the console's playbook library. Lists every registered
 * playbook (crisis.playbook's catalogue read, no crisis needed) and opens
 * one in place. Step tracking attaches to a crisis: when the console has
 * one selected, the opened playbook is that crisis's checkable list;
 * otherwise the steps render read-only.
 */

import { useEffect, useState, useCallback } from 'react';
import { BookOpen, Loader2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { PlaybookPanel } from '@/components/crisis-ops/PlaybookPanel';

interface PlaybookEntry {
  key: string;
  title: string;
  total: number;
}

export function PlaybooksPanel({ crisisId }: { crisisId?: string }) {
  const [entries, setEntries] = useState<PlaybookEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [openKey, setOpenKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await lensRun<{ playbooks?: PlaybookEntry[] }>('crisis', 'playbook', {});
    if (r.data?.ok && r.data.result) setEntries(r.data.result.playbooks || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-3">
      <header className="flex items-center gap-2">
        <BookOpen className="h-4 w-4 text-rose-300" />
        <h3 className="text-sm font-semibold text-white">Playbooks</h3>
        {entries.length > 0 && (
          <span className="font-mono text-[11px] text-zinc-400">{entries.length} response plans</span>
        )}
      </header>

      {loading && (
        <div className="flex items-center gap-2 text-xs text-zinc-400">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading playbooks…
        </div>
      )}

      {!loading && entries.length === 0 && (
        <p className="rounded border border-white/10 bg-white/5 p-3 text-center text-xs text-zinc-400">
          No playbooks registered.
        </p>
      )}

      {!loading && entries.length > 0 && (
        <ul className="space-y-1.5">
          {entries.map((p) => (
            <li key={p.key} className="rounded-lg border border-white/10 bg-white/5">
              <button
                type="button"
                onClick={() => setOpenKey((k) => (k === p.key ? null : p.key))}
                aria-expanded={openKey === p.key}
                className="flex w-full items-center justify-between gap-2 p-2.5 text-left"
              >
                <span className="text-sm font-medium text-zinc-100">{p.title}</span>
                <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-400">
                  {p.total} steps {openKey === p.key ? '· open' : ''}
                </span>
              </button>
              {openKey === p.key && (
                <div className="border-t border-white/10 p-2.5">
                  <PlaybookPanel crisisType={p.key} crisisId={crisisId} />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
