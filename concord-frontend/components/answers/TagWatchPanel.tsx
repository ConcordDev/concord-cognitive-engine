'use client';

/**
 * TagWatchPanel — manage watched tags. Watching a tag delivers a
 * notification whenever a new question is asked under it.
 * Wires the answers.tag-watch macro.
 */

import { useCallback, useEffect, useState } from 'react';
import { Eye, Loader2, Plus, X } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

export function TagWatchPanel({ onChanged }: { onChanged?: () => void }) {
  const [watched, setWatched] = useState<string[]>([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await lensRun('answers', 'tag-watch', {});
    if (r.data?.ok) setWatched((r.data.result?.watchedTags as string[]) || []);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function toggle(tag: string) {
    const r = await lensRun('answers', 'tag-watch', { tag });
    if (r.data?.ok) {
      setWatched((r.data.result?.watchedTags as string[]) || []);
      onChanged?.();
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Eye className="w-4 h-4 text-orange-400" />
        <h4 className="text-sm font-semibold text-zinc-200">Watched tags</h4>
      </div>
      <p className="text-[11px] text-zinc-400">Get notified when a new question is asked under a tag you watch.</p>

      <div className="flex gap-1">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && draft.trim()) { void toggle(draft.trim()); setDraft(''); }
          }}
          placeholder="Add a tag to watch"
          className="flex-1 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-[12px] text-zinc-200"
        />
        <button
          onClick={() => { if (draft.trim()) { void toggle(draft.trim()); setDraft(''); } }}
          className="px-2 py-1 rounded bg-orange-600 hover:bg-orange-500 text-white"
          aria-label="Watch tag"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-3"><Loader2 className="w-4 h-4 animate-spin text-zinc-400" /></div>
      ) : watched.length === 0 ? (
        <p className="text-xs text-zinc-400 italic py-2">No data yet — you are not watching any tags.</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {watched.map((t) => (
            <span
              key={t}
              className="text-[11px] px-1.5 py-0.5 rounded bg-orange-900/40 text-orange-300 inline-flex items-center gap-1"
            >
              {t}
              <button onClick={() => toggle(t)} aria-label={`Unwatch ${t}`} className="hover:text-rose-300">
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
