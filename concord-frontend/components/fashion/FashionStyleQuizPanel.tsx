'use client';

/**
 * FashionStyleQuizPanel — style-profile quiz that produces a saved
 * profile and personalized closet recommendations from real wardrobe
 * gaps. Backed by fashion.style-quiz-* macros.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Sparkles, RotateCcw, Palette } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface QuizOption { value: string; label: string }
interface QuizQuestion { id: string; question: string; options: QuizOption[] }
interface StyleProfile {
  style: string; palette: string; colors: string[];
  fit: string; spend: string; priority: string; updatedAt: string;
}
interface Recommendation { type: string; category?: string; reason: string }

export function FashionStyleQuizPanel() {
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [profile, setProfile] = useState<StyleProfile | null>(null);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retaking, setRetaking] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    const [q, p] = await Promise.all([
      lensRun('fashion', 'style-quiz-questions', {}),
      lensRun('fashion', 'style-profile-get', {}),
    ]);
    setQuestions(q.data?.result?.questions || []);
    setProfile((p.data?.result?.profile as StyleProfile | null) || null);
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const submit = async () => {
    const missing = questions.filter((qn) => !answers[qn.id]);
    if (missing.length) { setError(`Answer all ${questions.length} questions.`); return; }
    setSubmitting(true);
    const r = await lensRun('fashion', 'style-quiz-submit', { answers });
    setSubmitting(false);
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setProfile((r.data?.result?.profile as StyleProfile) || null);
    setRecommendations((r.data?.result?.recommendations as Recommendation[]) || []);
    setRetaking(false);
    setError(null);
  };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-500"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  // Show saved profile + recommendations unless retaking.
  if (profile && !retaking) {
    return (
      <div className="space-y-3">
        <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-4">
          <div className="flex items-center justify-between">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold text-zinc-100">
              <Sparkles className="w-4 h-4 text-fuchsia-400" /> Your style profile
            </h3>
            <button type="button" onClick={() => { setRetaking(true); setAnswers({}); }}
              className="flex items-center gap-1 text-[11px] text-zinc-400 hover:text-fuchsia-300">
              <RotateCcw className="w-3 h-3" /> Retake
            </button>
          </div>
          <div className="grid grid-cols-3 gap-2 mt-3">
            {[
              ['Vibe', profile.style], ['Palette', profile.palette], ['Fit', profile.fit],
              ['Shopping', profile.spend], ['Priority', profile.priority],
            ].map(([label, value]) => (
              <div key={label} className="text-center bg-zinc-950/60 rounded-lg py-2">
                <p className="text-xs font-bold text-fuchsia-300 capitalize">{value}</p>
                <p className="text-[10px] text-zinc-500 uppercase tracking-wide">{label}</p>
              </div>
            ))}
          </div>
          {profile.colors.length > 0 && (
            <div className="mt-3">
              <p className="flex items-center gap-1 text-[10px] text-zinc-500 uppercase mb-1.5">
                <Palette className="w-3 h-3" /> Recommended palette
              </p>
              <div className="flex flex-wrap gap-1.5">
                {profile.colors.map((c) => (
                  <span key={c} className="text-[11px] px-2 py-0.5 rounded-full bg-fuchsia-950/40 border border-fuchsia-800/50 text-fuchsia-200 capitalize">{c}</span>
                ))}
              </div>
            </div>
          )}
        </div>

        <section>
          <h3 className="text-xs font-semibold text-zinc-300 mb-2">Closet recommendations</h3>
          {recommendations.length === 0 ? (
            <p className="text-[11px] text-zinc-500 italic">
              Retake the quiz to refresh recommendations against your current closet.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {recommendations.map((rec, idx) => (
                <li key={idx} className="flex items-start gap-2 bg-zinc-900/70 border border-zinc-800 rounded-lg px-3 py-2">
                  <span className={cn('text-[9px] px-1.5 py-0.5 rounded uppercase font-bold shrink-0 mt-0.5',
                    rec.type === 'gap' ? 'bg-rose-950/60 text-rose-300'
                      : rec.type === 'thin' ? 'bg-amber-950/60 text-amber-300'
                        : rec.type === 'sustainability' ? 'bg-emerald-950/60 text-emerald-300'
                          : 'bg-sky-950/60 text-sky-300')}>
                    {rec.type}
                  </span>
                  <span className="text-[11px] text-zinc-300">{rec.reason}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}
      <p className="text-[11px] text-zinc-500">
        Answer {questions.length} quick questions to get a style profile and recommendations from your real closet gaps.
      </p>
      {questions.map((qn) => (
        <fieldset key={qn.id} className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
          <legend className="text-xs font-semibold text-zinc-200 px-1">{qn.question}</legend>
          <div className="flex flex-wrap gap-1.5 mt-2">
            {qn.options.map((opt) => (
              <button key={opt.value} type="button"
                onClick={() => setAnswers((a) => ({ ...a, [qn.id]: opt.value }))}
                className={cn('text-[11px] px-2.5 py-1 rounded-full border',
                  answers[qn.id] === opt.value
                    ? 'border-fuchsia-600 bg-fuchsia-950/50 text-fuchsia-200'
                    : 'border-zinc-700 text-zinc-400 hover:border-zinc-600')}>
                {opt.label}
              </button>
            ))}
          </div>
        </fieldset>
      ))}
      <button type="button" onClick={submit} disabled={submitting}
        className="w-full flex items-center justify-center gap-1.5 bg-fuchsia-600 hover:bg-fuchsia-500 disabled:opacity-50 text-white text-xs font-medium rounded-lg px-2 py-2">
        {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
        Build my style profile
      </button>
    </div>
  );
}
