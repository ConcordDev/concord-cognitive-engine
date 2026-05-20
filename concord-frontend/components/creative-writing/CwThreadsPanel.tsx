'use client';

/**
 * CwThreadsPanel — Plottr-style plot threads, each tracking how many
 * scenes carry that storyline.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Trash2, GitBranch } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Thread { id: string; name: string; color: string; sceneCount: number }

const COLORS = ['indigo', 'rose', 'emerald', 'amber', 'sky', 'violet'];
const COLOR_BG: Record<string, string> = {
  indigo: 'bg-indigo-500', rose: 'bg-rose-500', emerald: 'bg-emerald-500',
  amber: 'bg-amber-500', sky: 'bg-sky-500', violet: 'bg-violet-500',
};

export function CwThreadsPanel({ projectId, onChange }: { projectId: string; onChange: () => void }) {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', color: 'indigo' });

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await lensRun('creative-writing', 'thread-list', { projectId });
    setThreads(r.data?.result?.threads || []);
    setLoading(false);
    onChange();
  }, [projectId, onChange]);

  useEffect(() => { void refresh(); }, [refresh]);

  const addThread = async () => {
    if (!form.name.trim()) { setError('Thread name is required.'); return; }
    const r = await lensRun('creative-writing', 'thread-create', { projectId, name: form.name.trim(), color: form.color });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setForm({ name: '', color: 'indigo' });
    setError(null);
    await refresh();
  };

  const delThread = async (id: string) => {
    await lensRun('creative-writing', 'thread-delete', { threadId: id });
    await refresh();
  };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-500"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  return (
    <div className="space-y-4">
      {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

      <section className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 space-y-2">
        <p className="text-[11px] text-zinc-500">
          Plot threads track storylines across scenes. Tag scenes to a thread from the scene editor.
        </p>
        <div className="flex items-center gap-2">
          <input placeholder="Thread name (e.g. Romance arc)" value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <div className="flex gap-1">
            {COLORS.map((c) => (
              <button key={c} type="button" onClick={() => setForm({ ...form, color: c })}
                className={cn('w-6 h-6 rounded-full', COLOR_BG[c],
                  form.color === c ? 'ring-2 ring-offset-2 ring-offset-zinc-900 ring-white' : '')} />
            ))}
          </div>
          <button type="button" onClick={addThread}
            className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-amber-600 hover:bg-amber-500 text-white rounded-lg">
            <Plus className="w-3.5 h-3.5" /> Thread
          </button>
        </div>
      </section>

      {threads.length === 0 ? (
        <p className="text-[11px] text-zinc-500 italic py-6 text-center">No plot threads yet.</p>
      ) : (
        <ul className="space-y-2">
          {threads.map((t) => (
            <li key={t.id} className="flex items-center gap-3 bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
              <span className={cn('w-3 h-3 rounded-full shrink-0', COLOR_BG[t.color] || 'bg-zinc-500')} />
              <GitBranch className="w-4 h-4 text-zinc-500 shrink-0" />
              <span className="text-sm text-zinc-100 flex-1">{t.name}</span>
              <span className="text-[11px] text-zinc-500">{t.sceneCount} scene{t.sceneCount === 1 ? '' : 's'}</span>
              <button type="button" onClick={() => delThread(t.id)} className="text-zinc-600 hover:text-rose-400">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
