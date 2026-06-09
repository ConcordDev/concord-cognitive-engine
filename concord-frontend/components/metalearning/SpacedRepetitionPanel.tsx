'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { Layers, Plus, Loader2, Trash2, RotateCcw, CheckCircle2 } from 'lucide-react';

interface ReviewCard {
  id: string;
  front: string;
  back: string;
  topic: string;
  ease: number;
  intervalDays: number;
  repetitions: number;
  lapses: number;
  dueAt: number;
  overdueDays?: number;
}
interface UpcomingCard {
  id: string;
  front: string;
  topic: string;
  dueInDays: number;
}

const GRADES = [
  { g: 0, label: 'Blackout', color: 'bg-red-500/20 text-red-300 border-red-500/40' },
  { g: 2, label: 'Hard', color: 'bg-orange-500/20 text-orange-300 border-orange-500/40' },
  { g: 3, label: 'Good', color: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/40' },
  { g: 4, label: 'Easy', color: 'bg-lime-500/20 text-lime-300 border-lime-500/40' },
  { g: 5, label: 'Perfect', color: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' },
];

export function SpacedRepetitionPanel() {
  const [due, setDue] = useState<ReviewCard[]>([]);
  const [upcoming, setUpcoming] = useState<UpcomingCard[]>([]);
  const [totalCards, setTotalCards] = useState(0);
  const [loading, setLoading] = useState(false);
  const [front, setFront] = useState('');
  const [back, setBack] = useState('');
  const [topic, setTopic] = useState('');
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const { data: r } = await lensRun<any>('metalearning', 'srsDue', {});
      if (r?.ok === false) { setErr(r.error || 'Failed to load reviews'); return; }
      const res = r?.result || r;
      setDue(res.dueNow || []);
      setUpcoming(res.upcoming || []);
      setTotalCards(res.totalCards || 0);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load reviews');
    } finally {
      setLoading(false);
    }
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { refresh(); }, []);

  const addCard = async () => {
    if (!front.trim()) return;
    setBusy('add');
    try {
      const { data: r } = await lensRun<any>('metalearning', 'srsAddCard', { front, back, topic });
      if (r?.ok === false) { setErr(r.error || 'Failed to add card'); return; }
      setFront(''); setBack(''); setTopic('');
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to add card');
    } finally { setBusy(null); }
  };

  const review = async (cardId: string, grade: number) => {
    setBusy(cardId);
    try {
      const { data: r } = await lensRun<any>('metalearning', 'srsReview', { cardId, grade });
      if (r?.ok === false) { setErr(r.error || 'Review failed'); return; }
      setRevealed((p) => ({ ...p, [cardId]: false }));
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Review failed');
    } finally { setBusy(null); }
  };

  const remove = async (cardId: string) => {
    setBusy(cardId);
    try {
      const { data: r } = await lensRun<any>('metalearning', 'srsDeleteCard', { cardId });
      if (r?.ok === false) { setErr(r.error || 'Delete failed'); return; }
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Delete failed');
    } finally { setBusy(null); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold flex items-center gap-2 text-sm">
          <RotateCcw className="w-4 h-4 text-neon-cyan" /> Spaced Repetition
          <span className="text-xs text-gray-400 font-normal">
            {totalCards} card{totalCards !== 1 ? 's' : ''} · {due.length} due
          </span>
        </h3>
        <button onClick={refresh} disabled={loading}
          className="text-xs text-gray-400 hover:text-white disabled:opacity-50">
          {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Refresh'}
        </button>
      </div>

      {err && <p className="text-xs text-red-400">{err}</p>}

      {/* Add card */}
      <div className="bg-lattice-deep rounded-lg p-3 space-y-2 border border-white/5">
        <p className="text-xs text-gray-400 flex items-center gap-1">
          <Plus className="w-3 h-3" /> New review card
        </p>
        <input value={front} onChange={(e) => setFront(e.target.value)}
          placeholder="Prompt / question (front)" className="input-lattice w-full text-sm" />
        <textarea value={back} onChange={(e) => setBack(e.target.value)}
          placeholder="Answer (back)" rows={2} className="input-lattice w-full text-sm" />
        <div className="flex gap-2">
          <input value={topic} onChange={(e) => setTopic(e.target.value)}
            placeholder="Topic" className="input-lattice flex-1 text-sm" />
          <button onClick={addCard} disabled={!front.trim() || busy === 'add'}
            className="btn-neon text-sm px-3 disabled:opacity-50">
            {busy === 'add' ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Add Card'}
          </button>
        </div>
      </div>

      {/* Due now */}
      {due.length === 0 ? (
        <p className="text-center py-6 text-gray-400 text-sm flex items-center justify-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-neon-green" />
          {totalCards === 0 ? 'No cards yet — add one above.' : 'All caught up — nothing due.'}
        </p>
      ) : (
        <div className="space-y-2 max-h-80 overflow-y-auto">
          {due.map((c) => (
            <div key={c.id} className="bg-lattice-surface rounded-lg p-3 border border-white/5">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{c.front}</p>
                  <p className="text-[10px] text-gray-400 mt-0.5">
                    {c.topic} · ease {c.ease.toFixed(2)} · rep {c.repetitions}
                    {(c.overdueDays ?? 0) > 0 && ` · ${c.overdueDays}d overdue`}
                  </p>
                </div>
                <button aria-label="Delete" onClick={() => remove(c.id)} disabled={busy === c.id}
                  className="text-gray-600 hover:text-red-400 disabled:opacity-50">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
              {revealed[c.id] ? (
                <>
                  {c.back && <p className="text-xs text-gray-300 mt-2 bg-lattice-deep rounded p-2">{c.back}</p>}
                  <div className="flex gap-1 mt-2 flex-wrap">
                    {GRADES.map((gr) => (
                      <button key={gr.g} onClick={() => review(c.id, gr.g)} disabled={busy === c.id}
                        className={`text-[10px] px-2 py-1 rounded border ${gr.color} disabled:opacity-50`}>
                        {gr.label}
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <button onClick={() => setRevealed((p) => ({ ...p, [c.id]: true }))}
                  className="text-xs text-neon-cyan mt-2 hover:underline">
                  Reveal answer & grade
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Upcoming */}
      {upcoming.length > 0 && (
        <div className="border-t border-white/5 pt-2">
          <p className="text-[10px] text-gray-400 uppercase tracking-wider mb-1 flex items-center gap-1">
            <Layers className="w-3 h-3" /> Upcoming
          </p>
          <div className="space-y-1 max-h-32 overflow-y-auto">
            {upcoming.map((u) => (
              <div key={u.id} className="flex justify-between text-xs text-gray-400">
                <span className="truncate">{u.front}</span>
                <span className="text-gray-600 flex-shrink-0 ml-2">in {u.dueInDays}d</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
