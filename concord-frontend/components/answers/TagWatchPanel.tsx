'use client';

/**
 * TagWatchPanel — manage watched tags plus a browsable tag directory.
 * Watching a tag delivers a notification whenever a new question is
 * asked under it. Wires the answers.tag-watch and answers.tag-list
 * macros (the latter powers the "browse all tags" list with real
 * per-tag question/answered counts — clicking a tag filters the main
 * question list).
 */

import { useCallback, useEffect, useState } from 'react';
import { Eye, Loader2, Plus, X, Tag as TagIcon, Filter } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface TagCount { tag: string; questionCount: number; answeredCount: number }

export function TagWatchPanel({
  onChanged,
  onFilterTag,
  activeTagFilter,
}: {
  onChanged?: () => void;
  onFilterTag?: (tag: string | null) => void;
  activeTagFilter?: string | null;
}) {
  const [watched, setWatched] = useState<string[]>([]);
  const [allTags, setAllTags] = useState<TagCount[]>([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [w, t] = await Promise.all([
      lensRun('answers', 'tag-watch', {}),
      lensRun('answers', 'tag-list', {}),
    ]);
    if (w.data?.ok) setWatched((w.data.result?.watchedTags as string[]) || []);
    if (t.data?.ok) setAllTags((t.data.result?.tags as TagCount[]) || []);
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

      <div className="border-t border-zinc-800 pt-2 mt-1">
        <div className="flex items-center gap-2 mb-1.5">
          <TagIcon className="w-3.5 h-3.5 text-zinc-400" />
          <h4 className="text-sm font-semibold text-zinc-200">Browse tags</h4>
          {activeTagFilter && (
            <button
              onClick={() => onFilterTag?.(null)}
              className="ml-auto text-[10px] text-orange-300 hover:text-orange-200 inline-flex items-center gap-0.5"
            >
              <Filter className="w-2.5 h-2.5" />clear filter ({activeTagFilter})
            </button>
          )}
        </div>
        {!loading && allTags.length === 0 ? (
          <p className="text-xs text-zinc-400 italic py-2">No tags yet — ask a question with tags to seed this list.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {allTags.map((t) => (
              <button
                key={t.tag}
                onClick={() => onFilterTag?.(activeTagFilter === t.tag ? null : t.tag)}
                title={`${t.questionCount} question${t.questionCount === 1 ? '' : 's'} · ${t.answeredCount} answered`}
                className={`text-[11px] px-1.5 py-0.5 rounded border inline-flex items-center gap-1 ${
                  activeTagFilter === t.tag
                    ? 'bg-orange-600/30 border-orange-500/50 text-orange-200'
                    : 'bg-zinc-900/60 border-zinc-800 text-zinc-300 hover:border-orange-700/40'
                }`}
              >
                {t.tag}
                <span className="text-zinc-500">{t.questionCount}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
