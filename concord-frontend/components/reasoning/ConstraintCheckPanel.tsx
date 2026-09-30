'use client';

/**
 * Constraint-check lab — Lean/Coq-style goal checker, not a card wall.
 *
 * Two real substrates, both surfaced honestly:
 *   1. reasoning.logicValidate + reasoning.fallacyDetect  (deterministic
 *      contradiction / fallacy engines in server/domains/reasoning.js)
 *   2. POST /api/reasoning/run  mode=constraint_check     (the same wire
 *      DriftAlertToast uses) AND reasoning.run via lensRun. HLR's
 *      REASONING_MODES does not include constraint_check — a rejection
 *      is rendered as the engine's error, never as a fake pass.
 */

import { useState } from 'react';
import {
  ShieldAlert, Play, Loader2, AlertTriangle, CheckCircle2, Scale,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
import { ErrorState } from '@/components/ui/ErrorState';
import { EmptyState } from '@/components/ui/EmptyState';
import { StatusDot } from '@/components/ui/StatusDot';

type Phase = 'idle' | 'running' | 'done' | 'error';

interface ValidateShape {
  validity?: string;
  hasContradictions?: boolean;
  contradictions?: Array<{ premise1?: string; premise2?: string; type?: string }>;
  termSupport?: number;
  unsupportedTerms?: string[];
  recommendation?: string;
}

interface FallacyShape {
  fallacies?: Array<{ fallacy?: string; description?: string; severity?: string }>;
  count?: number;
}

export function ConstraintCheckPanel() {
  const [premisesText, setPremisesText] = useState('');
  const [conclusion, setConclusion] = useState('');
  const [question, setQuestion] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [validate, setValidate] = useState<ValidateShape | null>(null);
  const [fallacies, setFallacies] = useState<FallacyShape | null>(null);
  const [hlr, setHlr] = useState<Record<string, unknown> | null>(null);
  const [hlrNote, setHlrNote] = useState<string | null>(null);

  const premises = premisesText.split('\n').map((l) => l.trim()).filter(Boolean);

  const run = async () => {
    if (premises.length === 0 && !question.trim()) return;
    setPhase('running');
    setError(null);
    setValidate(null);
    setFallacies(null);
    setHlr(null);
    setHlrNote(null);
    try {
      if (premises.length > 0) {
        const v = await lensRun<ValidateShape>('reasoning', 'logicValidate', {
          premises,
          conclusion: conclusion.trim(),
        });
        if (!v.data.ok) {
          setError(v.data.error || 'logicValidate_failed');
          setPhase('error');
          return;
        }
        setValidate((v.data.result || {}) as ValidateShape);

        const argument = [...premises, conclusion.trim()].filter(Boolean).join('. ');
        const f = await lensRun<FallacyShape>('reasoning', 'fallacyDetect', { argument });
        if (f.data.ok) setFallacies((f.data.result || {}) as FallacyShape);
      }

      const topic = question.trim() || conclusion.trim() || premises[0] || '';
      if (topic) {
        const rest = await fetch('/api/reasoning/run', {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            mode: 'constraint_check',
            question: topic,
            topic,
            input: { question: topic, premises, conclusion: conclusion.trim() },
          }),
        });
        let restJson: Record<string, unknown> | null = null;
        try { restJson = await rest.json() as Record<string, unknown>; } catch { restJson = null; }

        const macro = await lensRun<Record<string, unknown>>('reasoning', 'run', {
          question: topic,
          topic,
          mode: 'constraint_check',
          depth: 2,
        });

        if (macro.data.ok && macro.data.result) {
          setHlr(macro.data.result as Record<string, unknown>);
        } else if (restJson && restJson.ok) {
          setHlr(restJson);
        } else {
          const err =
            macro.data.error ||
            (typeof restJson?.error === 'string' ? restJson.error : null) ||
            'invalid_mode';
          setHlrNote(
            `HLR rejected mode "constraint_check" (${err}). ` +
            'Allowed modes: deductive, inductive, abductive, adversarial, analogical, temporal, counterfactual. ' +
            'Contradiction / fallacy results above are the real constraint check.',
          );
        }
      }
      setPhase('done');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'constraint_check_failed');
      setPhase('error');
    }
  };

  const contradictionCount = validate?.contradictions?.length ?? 0;
  const fallacyCount = fallacies?.fallacies?.length ?? fallacies?.count ?? 0;
  const canRun = premises.length > 0 || question.trim().length > 0;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,22rem)_1fr] gap-3 min-h-[28rem]">
      <aside className="rounded border border-[color:var(--lens-accent,#4527A0)]/30 bg-zinc-950/70 p-3 space-y-3">
        <header className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-violet-200">
            <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" /> Constraint check
          </h2>
          <StatusDot
            state={phase === 'error' ? 'error' : phase === 'running' ? 'connecting' : phase === 'done' ? 'live' : 'idle'}
            size="sm"
            showLabel
            label={phase}
          />
        </header>
        <label className="block">
          <span className={ds.label}>Premises (one per line)</span>
          <textarea
            value={premisesText}
            onChange={(e) => setPremisesText(e.target.value)}
            placeholder={'All mammals are warm-blooded\nWhales are mammals'}
            className={cn(ds.textarea, 'h-32 font-mono text-xs')}
          />
        </label>
        <label className="block">
          <span className={ds.label}>Conclusion</span>
          <input
            value={conclusion}
            onChange={(e) => setConclusion(e.target.value)}
            placeholder="Therefore whales are warm-blooded"
            className={cn(ds.input, 'font-mono text-xs')}
          />
        </label>
        <label className="block">
          <span className={ds.label}>HLR question (optional)</span>
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="What constraint is violated?"
            className={cn(ds.input, 'font-mono text-xs')}
          />
        </label>
        <button
          type="button"
          onClick={() => void run()}
          disabled={!canRun || phase === 'running'}
          className={cn(ds.btnPrimary, 'w-full text-sm')}
        >
          {phase === 'running' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          Run constraint check
        </button>
        <p className="text-[10px] text-zinc-500">
          logicValidate + fallacyDetect always run on the premises. HLR <code className="text-violet-300">constraint_check</code> is
          the same POST DriftAlertToast uses — if the engine rejects the mode, that rejection is shown.
        </p>
      </aside>

      <section className="rounded border border-zinc-800 bg-zinc-950/40 p-3 font-mono text-xs min-h-[16rem]">
        {phase === 'idle' && (
          <EmptyState
            compact
            icon={<Scale className="h-5 w-5 text-zinc-600" />}
            title="No check run"
            description="Enter premises and a conclusion. The inspector will show contradictions, unsupported terms, and any HLR trace the engine actually records."
          />
        )}
        {phase === 'running' && (
          <div role="status" aria-busy="true" className="flex items-center gap-2 py-10 justify-center text-violet-300">
            <Loader2 className="h-4 w-4 animate-spin" /> Checking constraints…
          </div>
        )}
        {phase === 'error' && error && (
          <ErrorState message={error} onRetry={() => void run()} />
        )}
        {phase === 'done' && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-3 text-[11px]">
              <span className={validate?.hasContradictions ? 'text-red-300' : 'text-emerald-300'}>
                {validate?.hasContradictions
                  ? <><AlertTriangle className="inline h-3 w-3" /> {contradictionCount} contradiction{contradictionCount === 1 ? '' : 's'}</>
                  : <><CheckCircle2 className="inline h-3 w-3" /> no contradictions</>}
              </span>
              <span className="text-zinc-400">{validate?.validity || '—'}</span>
              <span className="text-zinc-400">termSupport {validate?.termSupport ?? '—'}</span>
              <span className={fallacyCount ? 'text-amber-300' : 'text-zinc-500'}>{fallacyCount} fallacy hit{fallacyCount === 1 ? '' : 's'}</span>
            </div>
            {validate?.recommendation && <p className="text-zinc-300">{validate.recommendation}</p>}
            {validate?.contradictions?.map((c, i) => (
              <div key={i} className="rounded border border-red-500/30 bg-red-500/5 p-2 text-[11px] text-red-100">
                <div className="uppercase tracking-wider text-red-400/80">{c.type || 'contradiction'}</div>
                <div>{c.premise1}</div>
                <div className="text-red-300/70">vs</div>
                <div>{c.premise2}</div>
              </div>
            ))}
            {validate?.unsupportedTerms && validate.unsupportedTerms.length > 0 && (
              <p className="text-amber-200/80">unsupported: {validate.unsupportedTerms.join(', ')}</p>
            )}
            {fallacies?.fallacies?.map((f, i) => (
              <div key={i} className="rounded border border-amber-500/30 bg-amber-500/5 p-2 text-[11px]">
                <span className="text-amber-300">{f.fallacy}</span>
                <span className="ml-2 text-zinc-400">{f.severity}</span>
                <p className="text-zinc-300 mt-0.5">{f.description}</p>
              </div>
            ))}
            {hlrNote && (
              <p role="status" className="rounded border border-amber-500/20 bg-amber-500/5 p-2 text-[11px] text-amber-200">
                {hlrNote}
              </p>
            )}
            {hlr && (
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all text-[10px] text-violet-100/90">
                {JSON.stringify(hlr, null, 2)}
              </pre>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
