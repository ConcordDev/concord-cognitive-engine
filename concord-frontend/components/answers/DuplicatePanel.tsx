'use client';

/**
 * DuplicatePanel — duplicate-question detection. Runs embedding-style
 * cosine similarity over the workspace and lets the author link a
 * question as a duplicate of another. Wires answers.find-duplicates +
 * answers.link-duplicate.
 */

import { useCallback, useEffect, useState } from 'react';
import { Copy, Loader2, Link2, Unlink } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface DupMatch {
  id: string;
  title: string;
  tags: string[];
  votes: number;
  answerCount: number;
  hasAccepted: boolean;
  similarity: number;
}

interface DuplicatePanelProps {
  questionId: string;
  duplicateOf: { id: string; title: string } | null;
  onLinkChanged: () => void;
  onOpenQuestion: (id: string) => void;
}

export function DuplicatePanel({ questionId, duplicateOf, onLinkChanged, onOpenQuestion }: DuplicatePanelProps) {
  const [matches, setMatches] = useState<DupMatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await lensRun('answers', 'find-duplicates', { questionId, threshold: 0.2 });
    if (r.data?.ok) setMatches((r.data.result?.matches as DupMatch[]) || []);
    setLoading(false);
  }, [questionId]);

  useEffect(() => { void load(); }, [load]);

  async function link(targetId: string | null) {
    setBusy(true);
    const r = await lensRun('answers', 'link-duplicate', { questionId, duplicateOf: targetId });
    setBusy(false);
    if (r.data?.ok) onLinkChanged();
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Copy className="w-4 h-4 text-orange-400" />
        <h4 className="text-sm font-semibold text-zinc-200">Possible duplicates</h4>
      </div>

      {duplicateOf && (
        <div className="rounded border border-amber-900/40 bg-amber-950/20 px-3 py-2 flex items-center gap-2">
          <span className="text-[12px] text-amber-300">
            Linked as a duplicate of <span className="font-semibold">{duplicateOf.title}</span>
          </span>
          <button
            onClick={() => link(null)}
            disabled={busy}
            className="ml-auto text-[11px] text-zinc-400 hover:text-rose-300 inline-flex items-center gap-0.5 disabled:opacity-40"
          >
            <Unlink className="w-3 h-3" />Unlink
          </button>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-4"><Loader2 className="w-4 h-4 animate-spin text-zinc-500" /></div>
      ) : matches.length === 0 ? (
        <p className="text-xs text-zinc-500 italic py-3 text-center">No similar questions found.</p>
      ) : (
        <ul className="space-y-1.5">
          {matches.map((m) => (
            <li key={m.id} className="rounded border border-zinc-800 bg-zinc-900/50 p-2 flex items-center gap-2">
              <button
                onClick={() => onOpenQuestion(m.id)}
                className="min-w-0 flex-1 text-left"
              >
                <p className="text-[12px] text-orange-300 truncate">{m.title}</p>
                <p className="text-[10px] text-zinc-500">
                  {m.votes} votes · {m.answerCount} answers · {(m.similarity * 100).toFixed(0)}% similar
                </p>
              </button>
              <button
                onClick={() => link(m.id)}
                disabled={busy || duplicateOf?.id === m.id}
                className="text-[10px] px-1.5 py-1 rounded bg-zinc-800 hover:bg-amber-700 text-zinc-200 inline-flex items-center gap-0.5 disabled:opacity-40"
              >
                <Link2 className="w-3 h-3" />Link
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
