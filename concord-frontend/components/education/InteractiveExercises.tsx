'use client';

import { useCallback, useEffect, useState } from 'react';
import { Target, Plus, Loader2, Lightbulb, CheckCircle, XCircle, Trash2, Trophy } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface ExerciseSummary { id: string; title: string; skillId: string | null; stepCount: number }
interface DraftStep {
  prompt: string; type: 'text' | 'numeric' | 'multiple_choice';
  answer: string; tolerance: string; options: string; hints: string;
}
interface SubmitResult {
  correct: boolean; pointsAwarded: number; masteryBumped: boolean;
  streak: number; bestStreak: number; explanation: string | null;
}

const EMPTY_STEP: DraftStep = { prompt: '', type: 'text', answer: '', tolerance: '0', options: '', hints: '' };

/**
 * Khan-style interactive exercises with auto-grading + 3-tier hints.
 * Author exercises with typed answer keys; learners submit answers
 * that are auto-graded server-side; 3 correct in a row bumps the
 * linked skill's mastery.
 */
export function InteractiveExercises() {
  const [exercises, setExercises] = useState<ExerciseSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [skillId, setSkillId] = useState('');
  const [steps, setSteps] = useState<DraftStep[]>([{ ...EMPTY_STEP }]);

  const [active, setActive] = useState<ExerciseSummary | null>(null);
  const [stepIdx, setStepIdx] = useState(0);
  const [answer, setAnswer] = useState('');
  const [result, setResult] = useState<SubmitResult | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [hintIndex, setHintIndex] = useState(0);
  const [hintsRemaining, setHintsRemaining] = useState(0);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = await lensRun('education', 'exercises-list', {});
      if (r.data?.ok) setExercises((r.data.result as { exercises: ExerciseSummary[] }).exercises || []);
    } catch (e) { console.error('[Exercises] refresh failed', e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  async function createExercise() {
    if (!title.trim()) return;
    const payloadSteps = steps
      .filter(s => s.prompt.trim() && s.answer.trim())
      .map(s => ({
        prompt: s.prompt.trim(),
        type: s.type,
        answer: s.answer.trim(),
        tolerance: Number(s.tolerance) || 0,
        options: s.options.split(',').map(o => o.trim()).filter(Boolean),
        hints: s.hints.split('|').map(h => h.trim()).filter(Boolean).slice(0, 3),
      }));
    if (payloadSteps.length === 0) return;
    try {
      const r = await lensRun('education', 'exercises-create', {
        title: title.trim(), skillId: skillId.trim() || undefined, steps: payloadSteps,
      });
      if (r.data?.ok) {
        setTitle(''); setSkillId(''); setSteps([{ ...EMPTY_STEP }]); setCreating(false);
        await refresh();
      }
    } catch (e) { console.error('[Exercises] create failed', e); }
  }

  function startExercise(ex: ExerciseSummary) {
    setActive(ex);
    setStepIdx(0);
    setAnswer('');
    setResult(null);
    setHint(null);
    setHintIndex(0);
    setHintsRemaining(0);
  }

  async function submit() {
    if (!active) return;
    setBusy(true);
    try {
      const r = await lensRun('education', 'exercises-submit', {
        exerciseId: active.id, stepId: `step_${stepIdx + 1}`, answer,
      });
      if (r.data?.ok) setResult(r.data.result as SubmitResult);
    } catch (e) { console.error('[Exercises] submit failed', e); }
    finally { setBusy(false); }
  }

  async function getHint() {
    if (!active) return;
    try {
      const r = await lensRun('education', 'exercises-hint', {
        exerciseId: active.id, stepId: `step_${stepIdx + 1}`, hintIndex,
      });
      if (r.data?.ok) {
        const res = r.data.result as { hint: string | null; hintsRemaining: number };
        setHint(res.hint);
        setHintsRemaining(res.hintsRemaining);
        setHintIndex(i => i + 1);
      }
    } catch (e) { console.error('[Exercises] hint failed', e); }
  }

  function nextStep() {
    if (!active) return;
    if (stepIdx + 1 < active.stepCount) {
      setStepIdx(i => i + 1);
      setAnswer(''); setResult(null); setHint(null); setHintIndex(0); setHintsRemaining(0);
    } else {
      setActive(null);
    }
  }

  return (
    <div className="space-y-4">
      {!active && (
        <>
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
              <Target className="w-4 h-4 text-amber-400" /> Interactive exercises
            </h3>
            <button
              onClick={() => setCreating(c => !c)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded bg-amber-500/20 text-amber-400 border border-amber-500/30 font-bold"
            >
              <Plus className="w-3.5 h-3.5" /> {creating ? 'Cancel' : 'New exercise'}
            </button>
          </div>

          {creating && (
            <div className="panel p-4 space-y-3 border border-amber-500/20 rounded-lg">
              <input
                value={title} onChange={e => setTitle(e.target.value)}
                placeholder="Exercise title"
                className="w-full px-3 py-2 bg-lattice-deep border border-lattice-border rounded text-sm text-white"
              />
              <input
                value={skillId} onChange={e => setSkillId(e.target.value)}
                placeholder="Linked skill ID (optional — 3-in-a-row bumps its mastery)"
                className="w-full px-3 py-2 bg-lattice-deep border border-lattice-border rounded text-xs text-white"
              />
              {steps.map((s, i) => (
                <div key={i} className="space-y-2 p-3 bg-white/[0.02] border border-white/5 rounded">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] uppercase tracking-wider text-gray-400">Step {i + 1}</span>
                    {steps.length > 1 && (
                      <button aria-label="Delete" onClick={() => setSteps(p => p.filter((_, idx) => idx !== i))} className="text-gray-400 hover:text-red-400">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                  <input
                    value={s.prompt}
                    onChange={e => setSteps(p => p.map((x, idx) => idx === i ? { ...x, prompt: e.target.value } : x))}
                    placeholder="Question prompt"
                    className="w-full px-2 py-1.5 bg-lattice-deep border border-lattice-border rounded text-xs text-white"
                  />
                  <div className="flex gap-2">
                    <select
                      value={s.type}
                      onChange={e => setSteps(p => p.map((x, idx) => idx === i ? { ...x, type: e.target.value as DraftStep['type'] } : x))}
                      className="px-2 py-1.5 bg-lattice-deep border border-lattice-border rounded text-xs text-white"
                    >
                      <option value="text">Text</option>
                      <option value="numeric">Numeric</option>
                      <option value="multiple_choice">Multiple choice</option>
                    </select>
                    <input
                      value={s.answer}
                      onChange={e => setSteps(p => p.map((x, idx) => idx === i ? { ...x, answer: e.target.value } : x))}
                      placeholder={s.type === 'text' ? 'Answer (pipe | for alternatives)' : 'Correct answer'}
                      className="flex-1 px-2 py-1.5 bg-lattice-deep border border-lattice-border rounded text-xs text-white"
                    />
                    {s.type === 'numeric' && (
                      <input
                        value={s.tolerance}
                        onChange={e => setSteps(p => p.map((x, idx) => idx === i ? { ...x, tolerance: e.target.value } : x))}
                        placeholder="± tol"
                        className="w-20 px-2 py-1.5 bg-lattice-deep border border-lattice-border rounded text-xs text-white"
                      />
                    )}
                  </div>
                  {s.type === 'multiple_choice' && (
                    <input
                      value={s.options}
                      onChange={e => setSteps(p => p.map((x, idx) => idx === i ? { ...x, options: e.target.value } : x))}
                      placeholder="Options, comma-separated"
                      className="w-full px-2 py-1.5 bg-lattice-deep border border-lattice-border rounded text-xs text-white"
                    />
                  )}
                  <input
                    value={s.hints}
                    onChange={e => setSteps(p => p.map((x, idx) => idx === i ? { ...x, hints: e.target.value } : x))}
                    placeholder="Up to 3 hints, pipe | separated (escalating)"
                    className="w-full px-2 py-1.5 bg-lattice-deep border border-lattice-border rounded text-xs text-white"
                  />
                </div>
              ))}
              <div className="flex gap-2">
                <button
                  onClick={() => setSteps(p => [...p, { ...EMPTY_STEP }])}
                  className="text-xs px-3 py-1.5 rounded border border-white/10 text-gray-400 hover:bg-white/5"
                >
                  + Add step
                </button>
                <button
                  onClick={createExercise}
                  disabled={!title.trim()}
                  className="text-xs px-3 py-1.5 rounded bg-amber-500 text-black font-bold disabled:opacity-40"
                >
                  Create exercise
                </button>
              </div>
            </div>
          )}

          {loading ? (
            <div className="flex items-center gap-2 text-xs text-gray-400 py-6">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading exercises…
            </div>
          ) : exercises.length === 0 ? (
            <p className="text-sm text-gray-400 py-8 text-center">No exercises yet. Create one to start the mastery loop.</p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {exercises.map(ex => (
                <button
                  key={ex.id}
                  onClick={() => startExercise(ex)}
                  className="text-left p-3 bg-white/[0.02] border border-white/10 rounded-lg hover:border-amber-400/40 transition-colors"
                >
                  <div className="text-sm font-bold text-white">{ex.title}</div>
                  <div className="text-[10px] text-gray-400 mt-1">
                    {ex.stepCount} step{ex.stepCount !== 1 ? 's' : ''}
                    {ex.skillId ? ' · linked to skill' : ''}
                  </div>
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {active && (
        <div className="panel p-4 space-y-4 border border-amber-500/20 rounded-lg">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-white">{active.title}</h3>
            <span className="text-[10px] text-gray-400">Step {stepIdx + 1} / {active.stepCount}</span>
          </div>
          <div className="space-y-2">
            <input
              value={answer}
              onChange={e => setAnswer(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !result) submit(); }}
              placeholder="Your answer"
              disabled={busy || !!result}
              className="w-full px-3 py-2 bg-lattice-deep border border-lattice-border rounded text-sm text-white"
            />
            <div className="flex gap-2">
              {!result && (
                <button
                  onClick={submit}
                  disabled={!answer.trim() || busy}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded bg-amber-500 text-black font-bold disabled:opacity-40"
                >
                  {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                  Submit answer
                </button>
              )}
              <button
                onClick={getHint}
                disabled={hintsRemaining === 0 && hintIndex > 0}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded border border-yellow-500/40 text-yellow-300 hover:bg-yellow-500/10 disabled:opacity-40"
              >
                <Lightbulb className="w-3.5 h-3.5" /> Hint ({hintIndex + (hintsRemaining > 0 ? hintsRemaining : 0)} available)
              </button>
              <button
                onClick={() => setActive(null)}
                className="ml-auto text-xs px-3 py-1.5 rounded border border-white/10 text-gray-400 hover:bg-white/5"
              >
                Exit
              </button>
            </div>
          </div>

          {hint && (
            <div className="px-3 py-2 bg-yellow-500/10 border border-yellow-500/30 rounded text-xs text-yellow-200 flex gap-2">
              <Lightbulb className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>{hint}</span>
            </div>
          )}

          {result && (
            <div className={cn(
              'px-3 py-3 rounded border space-y-2',
              result.correct ? 'bg-neon-green/10 border-neon-green/30' : 'bg-red-500/10 border-red-500/30',
            )}>
              <div className="flex items-center gap-2 text-sm font-bold">
                {result.correct
                  ? <><CheckCircle className="w-4 h-4 text-neon-green" /> <span className="text-neon-green">Correct!</span></>
                  : <><XCircle className="w-4 h-4 text-red-400" /> <span className="text-red-400">Not quite</span></>}
                {result.correct && <span className="text-xs text-gray-400">+{result.pointsAwarded} points</span>}
              </div>
              {!result.correct && result.explanation && (
                <p className="text-xs text-gray-300">{result.explanation}</p>
              )}
              {result.correct && (
                <p className="text-[11px] text-gray-400">
                  Streak: {result.streak} (best {result.bestStreak})
                </p>
              )}
              {result.masteryBumped && (
                <div className="flex items-center gap-1.5 text-xs font-bold text-amber-400">
                  <Trophy className="w-3.5 h-3.5" /> Mastery level bumped on the linked skill!
                </div>
              )}
              <button
                onClick={result.correct ? nextStep : () => { setResult(null); setAnswer(''); }}
                className="text-xs px-3 py-1.5 rounded bg-white/10 text-white font-bold hover:bg-white/15"
              >
                {result.correct
                  ? (stepIdx + 1 < active.stepCount ? 'Next step' : 'Finish')
                  : 'Try again'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default InteractiveExercises;
