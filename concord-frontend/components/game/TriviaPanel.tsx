'use client';

/**
 * TriviaPanel — real Open Trivia DB random questions for the game lens.
 * No API key.
 *
 * Phase 4 (fifth wave) of the UX completeness sprint. Real questions
 * with real correct answers — no fake data. The user can flip a card
 * to reveal the answer; getting it right is on the honor system (we
 * don't grade or score, just surface authentic content).
 */

import { useState, useEffect } from 'react';
import { Brain, RefreshCw, AlertTriangle, Check } from 'lucide-react';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface TriviaQuestion {
  index: number;
  category: string;
  difficulty: string;
  type: string;
  question: string;
  correctAnswer: string;
  incorrectAnswers: string[];
}

async function runMacro<T>(domain: string, name: string, input: Record<string, unknown>): Promise<T | null> {
  try {
    const r = await api.post('/api/lens/run', { domain, name, input });
    return r?.data as T;
  } catch {
    return null;
  }
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const DIFFICULTY_COLOR: Record<string, string> = {
  easy:   'text-emerald-300',
  medium: 'text-amber-300',
  hard:   'text-rose-300',
};

export interface TriviaPanelProps {
  className?: string;
}

export function TriviaPanel({ className }: TriviaPanelProps) {
  const [questions, setQuestions] = useState<TriviaQuestion[]>([]);
  const [revealed, setRevealed] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [difficulty, setDifficulty] = useState<string>('');

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    setRevealed(new Set());
    const r = await runMacro<{ ok: boolean; questions?: TriviaQuestion[]; reason?: string }>(
      'game', 'live_trivia', { amount: 5, ...(difficulty ? { difficulty } : {}) },
    );
    if (r?.ok) setQuestions(r.questions || []);
    else setError(r?.reason || 'fetch_failed');
    setLoading(false);
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const r = await runMacro<{ ok: boolean; questions?: TriviaQuestion[]; reason?: string }>(
        'game', 'live_trivia', { amount: 5 },
      );
      if (cancelled) return;
      if (r?.ok) setQuestions(r.questions || []);
      else setError(r?.reason || 'fetch_failed');
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  const onReveal = (idx: number) => {
    setRevealed(prev => new Set(prev).add(idx));
  };

  return (
    <section className={cn('rounded-lg border border-zinc-800 bg-zinc-950/80 overflow-hidden', className)}>
      <header className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800/80 bg-zinc-900/40">
        <Brain className="w-4 h-4 text-indigo-300" aria-hidden="true" />
        <h3 className="text-sm font-medium text-zinc-100 flex-1">Open Trivia DB</h3>
        <span className="text-[10px] text-emerald-400 font-mono">REAL data</span>
        <select
          value={difficulty}
          onChange={(e) => setDifficulty(e.target.value)}
          className="text-[10px] bg-zinc-900 border border-zinc-700 rounded px-1.5 py-0.5 text-zinc-300"
        >
          <option value="">Any difficulty</option>
          <option value="easy">Easy</option>
          <option value="medium">Medium</option>
          <option value="hard">Hard</option>
        </select>
        <button
          type="button"
          onClick={() => void fetchData()}
          disabled={loading}
          className="p-1 text-zinc-400 hover:text-zinc-200 transition-colors"
          aria-label="New questions"
        >
          <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
        </button>
      </header>

      {error && (
        <div className="px-3 py-3 text-xs text-rose-300/80">
          <AlertTriangle className="inline w-3.5 h-3.5 mr-1" /> Trivia API unreachable ({error})
        </div>
      )}

      {!error && questions.length > 0 && (
        <ul className="divide-y divide-zinc-800/40">
          {questions.map((q) => {
            const allAnswers = shuffle([q.correctAnswer, ...q.incorrectAnswers]);
            const isRevealed = revealed.has(q.index);
            return (
              <li key={q.index} className="px-3 py-3 text-xs">
                <div className="flex items-baseline gap-2 mb-2">
                  <span className="text-[10px] font-mono text-zinc-400">{q.category}</span>
                  <span className={cn('text-[10px] font-mono', DIFFICULTY_COLOR[q.difficulty] || 'text-zinc-400')}>
                    {q.difficulty}
                  </span>
                </div>
                <p className="text-zinc-200 mb-2">{q.question}</p>
                {!isRevealed ? (
                  <div className="space-y-1">
                    {allAnswers.map((a, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => onReveal(q.index)}
                        className="block w-full text-left px-2 py-1 rounded border border-zinc-800 hover:border-indigo-500/40 hover:bg-zinc-900/60 text-zinc-300"
                      >
                        {a}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="rounded border border-emerald-500/40 bg-emerald-500/10 p-2 text-emerald-200 flex items-center gap-1.5">
                    <Check className="w-3.5 h-3.5" />
                    <span className="font-medium">{q.correctAnswer}</span>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <footer className="px-3 py-1.5 text-[10px] text-zinc-400 border-t border-zinc-800/40">
        Source: Open Trivia DB · opentdb.com (cc-by-sa-4.0)
      </footer>
    </section>
  );
}

export default TriviaPanel;
