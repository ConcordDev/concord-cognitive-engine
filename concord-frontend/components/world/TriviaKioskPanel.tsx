'use client';

// Phase DB7 — Trivia kiosk + answer panel.
// Lists active questions, lets player start a session over a question subset
// and submit cited DTUs. Correct cites trigger the royalty cascade via the
// existing submitAnswer path.

import { useCallback, useEffect, useState } from 'react';
import { Sparkles, CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import { StationOverlayShell } from './_StationOverlayShell';
import type { OverlayProps } from './StationInteractionRouter';
import { successJuice, failureJuice } from '@/lib/concordia/juice';

interface Question {
  id: string;
  dtu_id: string;
  question_text: string;
  difficulty: number;
  created_by: string;
}

export function TriviaKioskPanel({ building, onClose, worldId }: OverlayProps) {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [active, setActive] = useState<Question | null>(null);
  const [citation, setCitation] = useState('');
  const [result, setResult] = useState<{ ok: boolean; isCorrect?: boolean; points?: number; error?: string } | null>(null);
  const [pending, setPending] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const j = await fetch('/api/trivia/questions?limit=20', { credentials: 'include' }).then(r => r.json());
      if (j?.ok) setQuestions(j.questions || []);
    } catch { /* swallow */ }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const startSession = useCallback(async () => {
    setPending(true);
    try {
      const r = await fetch('/api/trivia/session/start', {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ worldId, questionIds: questions.slice(0, 5).map(q => q.id) }),
      });
      const j = await r.json();
      if (j?.ok) setSessionId(j.sessionId);
    } finally { setPending(false); }
  }, [worldId, questions]);

  const submit = useCallback(async () => {
    if (!sessionId || !active || !citation.trim()) return;
    setPending(true);
    setResult(null);
    try {
      const r = await fetch(`/api/trivia/session/${sessionId}/answer`, {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ questionId: active.id, citedDtuId: citation.trim() }),
      });
      const j = await r.json();
      setResult(j);
      if (j?.ok && j.isCorrect) {
        successJuice('ui_trivia_correct');
        setTimeout(() => { setActive(null); setCitation(''); setResult(null); }, 1500);
      } else if (j?.ok && !j.isCorrect) {
        failureJuice('ui_trivia_wrong');
      }
    } finally { setPending(false); }
  }, [sessionId, active, citation]);

  return (
    <StationOverlayShell
      title={building.name || 'Trivia kiosk'}
      subtitle={`trivia_kiosk · ${worldId}`}
      onClose={onClose}
      accent="violet"
      size="md"
    >
      <div className="space-y-3">
        {!sessionId && (
          <div className="text-center">
            <p className="mb-2 text-xs text-zinc-400">{questions.length} active questions in the kiosk.</p>
            <button
              onClick={startSession}
              disabled={pending || questions.length === 0}
              className="rounded bg-violet-500/30 px-4 py-2 text-sm text-violet-100 hover:bg-violet-500/50 disabled:opacity-50"
            >
              {pending ? <Loader2 className="inline animate-spin" size={14} /> : <Sparkles className="inline" size={14} />} Start session (5 questions)
            </button>
          </div>
        )}

        {sessionId && !active && (
          <div className="space-y-1.5">
            <div className="text-[10px] uppercase text-violet-300/70">session live · pick a question</div>
            {questions.slice(0, 5).map((q) => (
              <button
                key={q.id}
                onClick={() => { setActive(q); setResult(null); setCitation(''); }}
                className="block w-full rounded border border-violet-500/30 bg-violet-950/30 p-2 text-left text-xs hover:border-violet-400/60 hover:bg-violet-900/30"
              >
                <div className="font-mono text-[10px] text-violet-300/60">difficulty {q.difficulty}/5</div>
                <div className="text-violet-100">{q.question_text}</div>
              </button>
            ))}
          </div>
        )}

        {active && (
          <div className="space-y-2 rounded-lg border border-violet-500/40 bg-violet-950/40 p-3">
            <div className="text-sm font-semibold text-violet-100">{active.question_text}</div>
            <div className="text-[10px] text-violet-300/60">Cite the DTU that answers this. (DTU id)</div>
            <input
              value={citation}
              onChange={(e) => setCitation(e.target.value)}
              placeholder="dtu-…"
              disabled={pending}
              className="w-full rounded border border-violet-500/40 bg-zinc-950 px-2 py-1.5 font-mono text-xs text-violet-100 outline-none focus:border-violet-400"
            />
            {result && (
              <div className={['flex items-center gap-1 text-xs', result.isCorrect ? 'text-emerald-300' : 'text-red-300'].join(' ')}>
                {result.isCorrect ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
                {result.isCorrect ? `+${result.points} point${result.points === 1 ? '' : 's'}` : (result.error || 'wrong citation')}
              </div>
            )}
            <div className="flex gap-2">
              <button
                onClick={submit}
                disabled={pending || !citation.trim()}
                className="flex-1 rounded bg-violet-500/30 px-3 py-1.5 text-xs text-violet-100 hover:bg-violet-500/50 disabled:opacity-50"
              >
                {pending ? <Loader2 className="inline animate-spin" size={12} /> : 'Submit citation'}
              </button>
              <button
                onClick={() => { setActive(null); setResult(null); setCitation(''); }}
                className="rounded bg-zinc-800 px-3 py-1.5 text-xs text-zinc-200 hover:bg-zinc-700"
              >
                Back
              </button>
            </div>
          </div>
        )}
      </div>
    </StationOverlayShell>
  );
}
