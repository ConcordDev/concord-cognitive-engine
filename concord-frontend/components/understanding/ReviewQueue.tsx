'use client';

// ReviewQueue — RemNote-style "review your notes" spaced-repetition
// surface. Schedules the notes themselves via understanding.review/due
// (classic SM-2, computed server-side — see server/domains/understanding.js
// for the algorithm and why it's distinct from the separate Anki/FSRS-shape
// `srs` lens). Nothing here is fabricated: the due queue, the ease/interval
// numbers, and the next-due date are all the real macro response.

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { Clock, Eye, Loader2, RefreshCw, Sparkles, CheckCircle2 } from 'lucide-react';
import type { Note } from './NotesWorkbench';

interface DueNote extends Note {
  overdueDays: number;
}

interface ReviewResult {
  noteId: string;
  quality: number;
  nextReviewInDays: number;
  srs: Note['srs'];
}

// Anki-style 4-button UX layered on top of the raw 0-5 SM-2 quality scale
// the backend accepts (see server/domains/understanding.js#sm2Schedule).
// "Again" (1) and "Hard" (3) are both real, distinct grades — Again resets
// the repetition streak (q<3), Hard passes it but shrinks ease growth.
const GRADES: { label: string; quality: number; hint: string; className: string }[] = [
  { label: 'Again', quality: 1, hint: '<1d', className: 'bg-rose-600 hover:bg-rose-500' },
  { label: 'Hard', quality: 3, hint: 'shrinks growth', className: 'bg-amber-600 hover:bg-amber-500' },
  { label: 'Good', quality: 4, hint: 'on track', className: 'bg-emerald-600 hover:bg-emerald-500' },
  { label: 'Easy', quality: 5, hint: 'grows fastest', className: 'bg-cyan-600 hover:bg-cyan-500' },
];

export function ReviewQueue({
  onOpenNote, onChanged,
}: { onOpenNote: (id: string) => void; onChanged?: () => void }) {
  const [due, setDue] = useState<DueNote[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [grading, setGrading] = useState(false);
  const [lastResult, setLastResult] = useState<ReviewResult | null>(null);
  const [sessionCount, setSessionCount] = useState(0);

  const refresh = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const r = await lensRun<{ due: DueNote[]; count: number }>('understanding', 'due', {});
      if (r.data?.ok && r.data.result) {
        setDue(r.data.result.due);
      } else {
        setError(r.data?.error || 'load failed');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'load failed');
    } finally {
      setLoading(false);
      setRevealed(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const current = due[0] ?? null;

  async function grade(quality: number) {
    if (!current || grading) return;
    setGrading(true); setError(null);
    try {
      const r = await lensRun<ReviewResult>('understanding', 'review', { id: current.id, quality });
      if (r.data?.ok && r.data.result) {
        setLastResult(r.data.result);
        setSessionCount((c) => c + 1);
        setDue((d) => d.slice(1));
        setRevealed(false);
        onChanged?.();
      } else {
        setError(r.data?.error || 'review failed');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'review failed');
    } finally {
      setGrading(false);
    }
  }

  return (
    <section className="max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs text-white/40 inline-flex items-center gap-1.5">
          <Clock className="w-3.5 h-3.5 text-amber-300" />
          {due.length} due now {sessionCount > 0 && <span className="text-emerald-300 ml-1">· {sessionCount} reviewed this session</span>}
        </p>
        <button onClick={refresh} className="text-white/40 hover:text-white text-xs inline-flex items-center gap-1">
          <RefreshCw className="w-3 h-3" /> Refresh
        </button>
      </div>

      {error && <p className="text-sm text-rose-400 mb-3">{error}</p>}

      {loading ? (
        <div className="flex items-center gap-2 text-white/60 text-sm"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>
      ) : !current ? (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-8 text-center">
          <CheckCircle2 className="w-8 h-8 text-emerald-300 mx-auto mb-2" />
          <p className="text-white/80 text-sm">Nothing due right now.</p>
          <p className="text-white/40 text-xs mt-1">
            Enable review on a note (in the Notes editor) to add it to this queue, or come back when the schedule brings one due.
          </p>
        </div>
      ) : (
        <div className="rounded-lg border border-violet-500/30 bg-black/60 p-5">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[10px] uppercase tracking-wide text-white/40">
              {current.overdueDays > 0 ? `${current.overdueDays}d overdue` : 'due today'} · ease {current.srs.ease.toFixed(2)} · {current.srs.reps} rep{current.srs.reps === 1 ? '' : 's'}
            </span>
            <button
              onClick={() => onOpenNote(current.id)}
              className="text-[10px] text-white/40 hover:text-white"
            >
              Open in editor
            </button>
          </div>
          <h3 className="text-lg font-semibold text-violet-200 mb-3">{current.title}</h3>

          {!revealed ? (
            <button
              onClick={() => setRevealed(true)}
              className="w-full px-4 py-3 text-sm bg-white/5 hover:bg-white/10 border border-white/10 rounded text-white/70 inline-flex items-center justify-center gap-2"
            >
              <Eye className="w-4 h-4" /> Show answer
            </button>
          ) : (
            <>
              <pre className="text-sm whitespace-pre-wrap text-white/80 bg-black/40 border border-white/10 rounded p-3 mb-4 max-h-64 overflow-y-auto font-sans">
                {current.body || <span className="text-white/30 italic">(empty body)</span>}
              </pre>
              <p className="text-[10px] text-white/40 uppercase tracking-wide mb-1.5">How well did you recall this?</p>
              <div className="grid grid-cols-4 gap-2">
                {GRADES.map((g) => (
                  <button
                    key={g.label}
                    onClick={() => grade(g.quality)}
                    disabled={grading}
                    className={`px-2 py-2 text-xs rounded text-white disabled:opacity-50 flex flex-col items-center gap-0.5 ${g.className}`}
                  >
                    {grading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <span className="font-semibold">{g.label}</span>}
                    <span className="text-[9px] opacity-70">{g.hint}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {lastResult && (
        <p className="text-xs text-emerald-300 mt-3 inline-flex items-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5" />
          Scheduled next review in {lastResult.nextReviewInDays} day{lastResult.nextReviewInDays === 1 ? '' : 's'} (ease now {lastResult.srs.ease.toFixed(2)})
        </p>
      )}
    </section>
  );
}
