'use client';

/**
 * VocabularyBuilder — a personal vocabulary list with Leitner-box
 * spaced review: save words with definitions, then review the due
 * ones. Wires the linguistics.vocab-* macros.
 */

import { useCallback, useEffect, useState } from 'react';
import { BookA, Plus, Trash2, GraduationCap, Loader2, Check, X } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Word { id: string; word: string; definition: string; partOfSpeech: string | null; example: string | null; tags: string[]; level: number; reviewCount: number }
interface Dash { totalWords: number; mastered: number; learning: number; fresh: number; dueNow: number }

export function VocabularyBuilder({ refreshKey = 0, onChange }: { refreshKey?: number; onChange?: () => void }) {
  const [words, setWords] = useState<Word[]>([]);
  const [dash, setDash] = useState<Dash | null>(null);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ word: '', definition: '', partOfSpeech: '', example: '' });
  const [adding, setAdding] = useState(false);
  const [addMsg, setAddMsg] = useState<string | null>(null);
  // review mode
  const [reviewQueue, setReviewQueue] = useState<Word[] | null>(null);
  const [reviewIdx, setReviewIdx] = useState(0);
  const [revealed, setRevealed] = useState(false);

  const refresh = useCallback(async () => {
    const [wl, d] = await Promise.all([
      lensRun('linguistics', 'vocab-list', {}),
      lensRun('linguistics', 'vocab-dashboard', {}),
    ]);
    setWords((wl.data?.result?.words as Word[]) || []);
    setDash((d.data?.result as Dash) || null);
    setLoading(false);
  }, []);
  useEffect(() => { void refresh(); }, [refresh, refreshKey]);

  async function add() {
    if (!form.word.trim()) return;
    setAdding(true);
    setAddMsg(null);
    // Auto-fetch the definition from the dictionary when the user
    // leaves the definition blank — no need to paste it by hand.
    const r = await lensRun<{ autoFetched: boolean; word: { definition: string } }>(
      'linguistics',
      'vocab-add',
      {
        word: form.word.trim(),
        definition: form.definition.trim(),
        partOfSpeech: form.partOfSpeech.trim(),
        example: form.example.trim(),
      },
    );
    setAdding(false);
    if (!r.data?.ok) {
      setAddMsg(r.data?.error || 'Could not add word.');
      return;
    }
    if (r.data.result?.autoFetched && r.data.result.word?.definition) {
      setAddMsg('Definition fetched automatically.');
    } else if (r.data.result?.autoFetched === false && !form.definition.trim() && !r.data.result?.word?.definition) {
      setAddMsg('Added — no dictionary entry found, edit to add a definition.');
    }
    setForm({ word: '', definition: '', partOfSpeech: '', example: '' });
    await refresh();
    onChange?.();
  }
  async function del(id: string) {
    await lensRun('linguistics', 'vocab-delete', { id });
    await refresh();
    onChange?.();
  }
  async function startReview() {
    const r = await lensRun('linguistics', 'vocab-review-due', {});
    const due = (r.data?.result?.words as Word[]) || [];
    if (due.length === 0) { setReviewQueue([]); return; }
    setReviewQueue(due); setReviewIdx(0); setRevealed(false);
  }
  async function grade(known: boolean) {
    if (!reviewQueue) return;
    const w = reviewQueue[reviewIdx];
    await lensRun('linguistics', 'vocab-review', { id: w.id, known });
    if (reviewIdx + 1 < reviewQueue.length) { setReviewIdx(reviewIdx + 1); setRevealed(false); }
    else { setReviewQueue(null); await refresh(); onChange?.(); }
  }

  if (loading) return <div className="flex items-center justify-center py-6 text-zinc-400"><Loader2 className="w-4 h-4 animate-spin" /></div>;

  // ── Review mode ──
  if (reviewQueue) {
    if (reviewQueue.length === 0) {
      return (
        <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-6 text-center">
          <Check className="w-6 h-6 text-emerald-400 mx-auto mb-2" />
          <p className="text-sm text-zinc-300">Nothing due for review — great work.</p>
          <button onClick={() => setReviewQueue(null)} className="mt-3 px-3 py-1.5 text-xs rounded bg-zinc-800 text-zinc-200">Back</button>
        </div>
      );
    }
    const w = reviewQueue[reviewIdx];
    return (
      <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4 text-center">
        <p className="text-[10px] text-zinc-400 mb-2">{reviewIdx + 1} / {reviewQueue.length}</p>
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-6 mb-3">
          <p className="text-xl font-bold text-zinc-100">{w.word}</p>
          {revealed && (
            <div className="mt-3 pt-3 border-t border-zinc-800">
              {w.partOfSpeech && <p className="text-[11px] italic text-zinc-400">{w.partOfSpeech}</p>}
              <p className="text-sm text-emerald-300">{w.definition || '(no definition)'}</p>
              {w.example && <p className="text-xs text-zinc-400 mt-1">&ldquo;{w.example}&rdquo;</p>}
            </div>
          )}
        </div>
        {revealed ? (
          <div className="flex gap-2 justify-center">
            <button onClick={() => grade(false)} className="px-4 py-1.5 text-xs font-semibold rounded bg-rose-600 hover:bg-rose-500 text-white inline-flex items-center gap-1"><X className="w-3 h-3" />Didn&apos;t know</button>
            <button onClick={() => grade(true)} className="px-4 py-1.5 text-xs font-semibold rounded bg-emerald-600 hover:bg-emerald-500 text-white inline-flex items-center gap-1"><Check className="w-3 h-3" />Knew it</button>
          </div>
        ) : (
          <button onClick={() => setRevealed(true)} className="px-4 py-1.5 text-xs font-semibold rounded bg-indigo-600 hover:bg-indigo-500 text-white">Reveal definition</button>
        )}
      </div>
    );
  }

  // ── List mode ──
  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
      <div className="flex items-center gap-2 mb-3">
        <BookA className="w-4 h-4 text-indigo-400" />
        <h3 className="text-sm font-bold text-zinc-100">Vocabulary Builder</h3>
        <button onClick={startReview} disabled={!dash?.dueNow}
          className="ml-auto px-2.5 py-1 text-xs rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-40 inline-flex items-center gap-1">
          <GraduationCap className="w-3 h-3" />Review ({dash?.dueNow || 0})
        </button>
      </div>

      {dash && (
        <div className="grid grid-cols-4 gap-2 mb-3">
          {([['Words', dash.totalWords], ['Mastered', dash.mastered], ['Learning', dash.learning], ['Due', dash.dueNow]] as const).map(([l, v]) => (
            <div key={l} className="bg-zinc-900/60 border border-zinc-800 rounded-lg px-2 py-1.5 text-center">
              <p className="text-sm font-bold text-zinc-100">{v}</p>
              <p className="text-[9px] text-zinc-400 uppercase tracking-wide">{l}</p>
            </div>
          ))}
        </div>
      )}

      <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-2.5 mb-3 space-y-1.5">
        <div className="flex gap-1.5">
          <input value={form.word} onChange={e => setForm({ ...form, word: e.target.value })} placeholder="Word"
            className="w-32 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
          <input value={form.partOfSpeech} onChange={e => setForm({ ...form, partOfSpeech: e.target.value })} placeholder="part of speech"
            className="w-28 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
          <input value={form.definition} onChange={e => setForm({ ...form, definition: e.target.value })} placeholder="Definition (leave blank to auto-fetch)"
            className="flex-1 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
          <button onClick={add} disabled={!form.word.trim() || adding}
            className="px-2.5 py-1 text-xs rounded bg-indigo-600 hover:bg-indigo-500 text-white font-semibold disabled:opacity-40 inline-flex items-center gap-1">
            {adding ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}Add
          </button>
        </div>
        {addMsg && <p className="text-[10px] text-indigo-300">{addMsg}</p>}
      </div>

      {words.length === 0 ? (
        <p className="text-xs text-zinc-400 italic">No words yet — add one above or save a word from the lookup.</p>
      ) : (
        <ul className="space-y-1 max-h-72 overflow-y-auto">
          {words.map(w => (
            <li key={w.id} className="group flex items-center gap-2 bg-zinc-900/60 border border-zinc-800 rounded-lg px-3 py-1.5">
              <div className="flex gap-0.5 shrink-0">
                {[0, 1, 2, 3, 4].map(i => (
                  <span key={i} className={cn('w-1.5 h-1.5 rounded-full', i < w.level ? 'bg-emerald-500' : 'bg-zinc-700')} />
                ))}
              </div>
              <span className="text-xs font-semibold text-zinc-100">{w.word}</span>
              <span className="text-[11px] text-zinc-400 truncate flex-1">{w.definition}</span>
              <button aria-label="Delete" onClick={() => del(w.id)} className="opacity-0 group-hover:opacity-100 text-rose-400"><Trash2 className="w-3 h-3" /></button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
