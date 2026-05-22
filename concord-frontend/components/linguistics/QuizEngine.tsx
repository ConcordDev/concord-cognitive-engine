'use client';

/**
 * QuizEngine — adaptive vocabulary quiz. Generates a weighted question
 * set from the user's own vocabulary (lower mastery + overdue weighted
 * higher), then grades each answer through the linguistics.quiz-*
 * macros. Multiple-choice questions draw real distractor definitions
 * from the user's other words; falls back to typing when the pool is
 * small. No mock data — every question is built from saved vocabulary.
 */

import { useCallback, useState } from 'react';
import { Brain, Loader2, Check, X, RotateCcw, Trophy } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Question {
  wordId: string;
  mode: 'typing' | 'multiple-choice';
  prompt: string;
  partOfSpeech: string | null;
  choices?: string[];
  answer: string;
}
interface GradeResult {
  correct: boolean;
  correctAnswer: string;
  level: number;
  points: number;
}

type Mode = '' | 'typing' | 'multiple-choice';

export function QuizEngine({ onComplete }: { onComplete?: () => void }) {
  const [questions, setQuestions] = useState<Question[] | null>(null);
  const [idx, setIdx] = useState(0);
  const [typed, setTyped] = useState('');
  const [graded, setGraded] = useState<GradeResult | null>(null);
  const [score, setScore] = useState({ correct: 0, points: 0 });
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('');
  const [count, setCount] = useState(8);

  const start = useCallback(async () => {
    setLoading(true);
    setErr(null);
    const params: Record<string, unknown> = { count };
    if (mode) params.mode = mode;
    const r = await lensRun<{ questions: Question[]; poolSize: number }>('linguistics', 'quiz-generate', params);
    setLoading(false);
    if (!r.data?.ok || !r.data.result) {
      setErr(r.data?.error || 'Add words with definitions to take a quiz.');
      return;
    }
    if (r.data.result.questions.length === 0) {
      setErr('No quizzable words yet. Add words with definitions first.');
      return;
    }
    setQuestions(r.data.result.questions);
    setIdx(0);
    setTyped('');
    setGraded(null);
    setScore({ correct: 0, points: 0 });
  }, [count, mode]);

  const submit = useCallback(async (answer: string) => {
    if (!questions) return;
    const q = questions[idx];
    const r = await lensRun<GradeResult>('linguistics', 'quiz-grade', {
      wordId: q.wordId,
      answer,
      mode: q.mode,
    });
    if (r.data?.ok && r.data.result) {
      setGraded(r.data.result);
      setScore((s) => ({
        correct: s.correct + (r.data.result!.correct ? 1 : 0),
        points: s.points + r.data.result!.points,
      }));
    }
  }, [questions, idx]);

  const next = useCallback(() => {
    if (!questions) return;
    if (idx + 1 < questions.length) {
      setIdx(idx + 1);
      setTyped('');
      setGraded(null);
    } else {
      setQuestions(null);
      onComplete?.();
    }
  }, [questions, idx, onComplete]);

  // ── Setup screen ──
  if (!questions) {
    return (
      <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
        <div className="flex items-center gap-2 mb-3">
          <Brain className="w-4 h-4 text-fuchsia-400" />
          <h3 className="text-sm font-bold text-zinc-100">Adaptive Quiz</h3>
        </div>
        {score.points > 0 && (
          <div className="mb-3 flex items-center gap-2 rounded-lg border border-emerald-700/40 bg-emerald-900/20 px-3 py-2">
            <Trophy className="w-4 h-4 text-emerald-400" />
            <span className="text-xs text-emerald-300">
              Last quiz: {score.correct} correct, {score.points} points earned.
            </span>
          </div>
        )}
        <p className="text-xs text-zinc-500 mb-3">
          Questions adapt to your mastery — weaker and overdue words appear more often.
        </p>
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <label className="text-[11px] text-zinc-400">
            Questions
            <select
              value={count}
              onChange={(e) => setCount(Number(e.target.value))}
              className="ml-1.5 bg-zinc-950 border border-zinc-800 rounded px-1.5 py-1 text-xs text-zinc-200"
            >
              {[5, 8, 10, 15, 20].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <label className="text-[11px] text-zinc-400">
            Mode
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as Mode)}
              className="ml-1.5 bg-zinc-950 border border-zinc-800 rounded px-1.5 py-1 text-xs text-zinc-200"
            >
              <option value="">Adaptive</option>
              <option value="multiple-choice">Multiple choice</option>
              <option value="typing">Typing</option>
            </select>
          </label>
        </div>
        {err && <p className="text-xs text-rose-400 mb-2">{err}</p>}
        <button
          onClick={start}
          disabled={loading}
          className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-fuchsia-600 hover:bg-fuchsia-500 text-white inline-flex items-center gap-1.5 disabled:opacity-50"
        >
          {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Brain className="w-3 h-3" />}
          Start quiz
        </button>
      </div>
    );
  }

  // ── Active quiz ──
  const q = questions[idx];
  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-[10px] text-zinc-500">Question {idx + 1} / {questions.length}</p>
        <p className="text-[10px] text-zinc-400">{score.points} pts · {score.correct} correct</p>
      </div>
      <div className="h-1 bg-zinc-800 rounded-full mb-3 overflow-hidden">
        <div
          className="h-full bg-fuchsia-500 rounded-full transition-all"
          style={{ width: `${((idx + (graded ? 1 : 0)) / questions.length) * 100}%` }}
        />
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 mb-3">
        <p className="text-[10px] uppercase tracking-wide text-zinc-500 mb-1">
          {q.mode === 'typing' ? 'Type the word for this definition' : 'Pick the definition'}
          {q.partOfSpeech ? ` · ${q.partOfSpeech}` : ''}
        </p>
        <p className={cn('font-bold text-zinc-100', q.mode === 'typing' ? 'text-sm' : 'text-lg')}>
          {q.prompt}
        </p>
      </div>

      {q.mode === 'multiple-choice' && q.choices ? (
        <div className="space-y-1.5 mb-3">
          {q.choices.map((c, i) => {
            const isAnswer = graded && c === graded.correctAnswer;
            const isPicked = graded && typed === c;
            return (
              <button
                key={i}
                disabled={!!graded}
                onClick={() => { setTyped(c); void submit(c); }}
                className={cn(
                  'w-full text-left text-xs px-3 py-2 rounded-lg border transition-colors',
                  !graded && 'border-zinc-800 bg-zinc-900/60 hover:border-fuchsia-600 text-zinc-200',
                  isAnswer && 'border-emerald-600 bg-emerald-900/30 text-emerald-200',
                  graded && isPicked && !isAnswer && 'border-rose-600 bg-rose-900/30 text-rose-200',
                  graded && !isPicked && !isAnswer && 'border-zinc-800 bg-zinc-900/40 text-zinc-500',
                )}
              >
                {c}
              </button>
            );
          })}
        </div>
      ) : (
        <div className="flex gap-1.5 mb-3">
          <input
            value={typed}
            disabled={!!graded}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && typed.trim() && !graded) void submit(typed.trim()); }}
            placeholder="Type the word..."
            className="flex-1 bg-zinc-950 border border-zinc-800 rounded px-2.5 py-1.5 text-xs text-zinc-200 disabled:opacity-60"
          />
          {!graded && (
            <button
              onClick={() => typed.trim() && submit(typed.trim())}
              disabled={!typed.trim()}
              className="px-3 py-1.5 text-xs font-semibold rounded bg-fuchsia-600 hover:bg-fuchsia-500 text-white disabled:opacity-40"
            >
              Submit
            </button>
          )}
        </div>
      )}

      {graded && (
        <div
          className={cn(
            'rounded-lg border px-3 py-2 mb-3 flex items-start gap-2',
            graded.correct ? 'border-emerald-700/50 bg-emerald-900/20' : 'border-rose-700/50 bg-rose-900/20',
          )}
        >
          {graded.correct
            ? <Check className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            : <X className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />}
          <div className="text-xs">
            <p className={graded.correct ? 'text-emerald-300 font-semibold' : 'text-rose-300 font-semibold'}>
              {graded.correct ? `Correct · +${graded.points} pts` : 'Not quite'}
            </p>
            {!graded.correct && (
              <p className="text-zinc-400 mt-0.5">Answer: <span className="text-zinc-200">{graded.correctAnswer}</span></p>
            )}
            <p className="text-zinc-500 mt-0.5">Mastery level now {graded.level} / 5</p>
          </div>
        </div>
      )}

      {graded && (
        <button
          onClick={next}
          className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-fuchsia-600 hover:bg-fuchsia-500 text-white inline-flex items-center gap-1.5"
        >
          {idx + 1 < questions.length ? 'Next question' : (<><RotateCcw className="w-3 h-3" />Finish</>)}
        </button>
      )}
    </div>
  );
}
