'use client';

/**
 * RelatedSidebar — related-questions panel for a question detail view.
 * Ranks workspace questions by cosine similarity + shared tags.
 * Wires the answers.related macro.
 */

import { useCallback, useEffect, useState } from 'react';
import { Link2, Loader2, CheckCircle2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface RelatedItem {
  id: string;
  title: string;
  votes: number;
  answerCount: number;
  hasAccepted: boolean;
  sharedTags: number;
  relevance: number;
}

interface RelatedSidebarProps {
  questionId: string;
  onOpenQuestion: (id: string) => void;
}

export function RelatedSidebar({ questionId, onOpenQuestion }: RelatedSidebarProps) {
  const [items, setItems] = useState<RelatedItem[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await lensRun('answers', 'related', { questionId });
    if (r.data?.ok) setItems((r.data.result?.related as RelatedItem[]) || []);
    setLoading(false);
  }, [questionId]);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
      <div className="flex items-center gap-2 mb-2">
        <Link2 className="w-4 h-4 text-orange-400" />
        <h4 className="text-sm font-semibold text-zinc-200">Related</h4>
      </div>
      {loading ? (
        <div className="flex justify-center py-4"><Loader2 className="w-4 h-4 animate-spin text-zinc-400" /></div>
      ) : items.length === 0 ? (
        <p className="text-xs text-zinc-400 italic py-3">No related questions yet.</p>
      ) : (
        <ul className="space-y-1.5">
          {items.map((it) => (
            <li key={it.id}>
              <button
                onClick={() => onOpenQuestion(it.id)}
                className="w-full text-left rounded px-2 py-1.5 hover:bg-zinc-900/60"
              >
                <div className="flex items-start gap-1.5">
                  <span className="text-[10px] tabular-nums px-1 rounded bg-zinc-800 text-zinc-300 shrink-0 mt-0.5">
                    {it.votes}
                  </span>
                  <span className="text-[12px] text-orange-300 leading-snug">{it.title}</span>
                  {it.hasAccepted && <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0 mt-0.5" />}
                </div>
                <p className="text-[10px] text-zinc-400 mt-0.5 pl-7">
                  {it.sharedTags} shared tag{it.sharedTags === 1 ? '' : 's'} · {(it.relevance * 100).toFixed(0)}% relevant
                </p>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
