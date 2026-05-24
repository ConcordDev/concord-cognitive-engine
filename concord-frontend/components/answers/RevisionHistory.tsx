'use client';

/**
 * RevisionHistory — shows a question/answer edit history with a
 * word-level revision diff (added words highlighted green, removed red).
 * Wires the answers.revisions macro.
 */

import { useCallback, useEffect, useState } from 'react';
import { History, Loader2, X } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface DiffOp { t: 'eq' | 'add' | 'del'; v: string }
interface Revision {
  id: string;
  field: string;
  previous: string;
  editorId: string;
  editedAt: string;
  diff?: DiffOp[];
}

interface RevisionHistoryProps {
  questionId: string;
  answerId?: string;
  onClose: () => void;
}

export function RevisionHistory({ questionId, answerId, onClose }: RevisionHistoryProps) {
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [currentBody, setCurrentBody] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await lensRun('answers', 'revisions', { questionId, answerId });
    if (r.data?.ok) {
      setRevisions((r.data.result?.revisions as Revision[]) || []);
      setCurrentBody((r.data.result?.currentBody as string) || '');
    }
    setLoading(false);
  }, [questionId, answerId]);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/80 p-3 space-y-3">
      <div className="flex items-center gap-2">
        <History className="w-4 h-4 text-orange-400" />
        <h4 className="text-sm font-semibold text-zinc-200">Revision history</h4>
        <button onClick={onClose} aria-label="Close revision history" className="ml-auto text-zinc-400 hover:text-zinc-200">
          <X className="w-4 h-4" />
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-6"><Loader2 className="w-4 h-4 animate-spin text-zinc-400" /></div>
      ) : revisions.length === 0 ? (
        <p className="text-xs text-zinc-400 italic py-4 text-center">No edits yet — this post is at its original version.</p>
      ) : (
        <ol className="space-y-2">
          {revisions.map((rev, i) => (
            <li key={rev.id} className="rounded border border-zinc-800 bg-zinc-900/50 p-2">
              <div className="flex items-center gap-2 text-[11px] text-zinc-400 mb-1">
                <span className="px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300">rev {i + 1}</span>
                <span>field: {rev.field}</span>
                <span className="ml-auto">{new Date(rev.editedAt).toLocaleString()}</span>
              </div>
              {rev.field === 'body' && rev.diff ? (
                <p className="text-[13px] leading-relaxed">
                  {rev.diff.map((op, j) => (
                    <span
                      key={j}
                      className={
                        op.t === 'add'
                          ? 'bg-emerald-900/50 text-emerald-300'
                          : op.t === 'del'
                          ? 'bg-rose-900/50 text-rose-300 line-through'
                          : 'text-zinc-400'
                      }
                    >
                      {op.v}
                    </span>
                  ))}
                </p>
              ) : (
                <p className="text-[12px] text-zinc-400">
                  Previous {rev.field}: <span className="text-zinc-300">{rev.previous}</span>
                </p>
              )}
            </li>
          ))}
          <li className="rounded border border-emerald-900/40 bg-emerald-950/20 p-2">
            <div className="text-[11px] text-emerald-400 mb-1">current version</div>
            <p className="text-[13px] text-zinc-300 whitespace-pre-wrap">{currentBody}</p>
          </li>
        </ol>
      )}
    </div>
  );
}
