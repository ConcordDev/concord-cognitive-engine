'use client';

import { useState } from 'react';
import { TrendingUp, Plus, Zap, Loader2, BarChart3, Clock } from 'lucide-react';
import {
  understandingMacro,
  Field,
  type PromotionEval,
} from './understanding-shared';

export function EvolutionPanel({ onChanged }: { onChanged: () => void }) {
  const [understandingId, setUnderstandingId] = useState('');
  const [evidenceText, setEvidenceText] = useState('');
  const [evaluation, setEvaluation] = useState<PromotionEval | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tickResult, setTickResult] = useState<string | null>(null);

  async function recordEvidence() {
    if (!understandingId || !evidenceText.trim()) return;
    setBusy(true); setError(null);
    try {
      await understandingMacro('record_evidence', {
        id: understandingId,
        evidence: evidenceText,
        at: new Date().toISOString(),
      });
      setEvidenceText('');
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'record failed');
    } finally {
      setBusy(false);
    }
  }

  async function evaluatePromotion() {
    if (!understandingId) return;
    setBusy(true); setError(null);
    try {
      const r = await understandingMacro<PromotionEval>('evaluate_promotion', { id: understandingId });
      setEvaluation(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'evaluate failed');
    } finally {
      setBusy(false);
    }
  }

  async function applyPromotion(decision: 'promote' | 'reject') {
    if (!understandingId) return;
    setBusy(true); setError(null);
    try {
      await understandingMacro('apply_promotion', { id: understandingId, decision });
      setEvaluation(null);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'apply failed');
    } finally {
      setBusy(false);
    }
  }

  async function runEvolutionTick() {
    setBusy(true); setError(null); setTickResult(null);
    try {
      const r = await understandingMacro<{ ok: boolean; processed?: number; promoted?: number }>('evolution_tick'
      );
      setTickResult(`tick processed=${r.processed ?? 0} promoted=${r.promoted ?? 0}`);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'tick failed');
    } finally {
      setBusy(false);
    }
  }

  async function runSweep() {
    setBusy(true); setError(null); setTickResult(null);
    try {
      const r = await understandingMacro<{ ok: boolean; expired?: number }>('sweep');
      setTickResult(`sweep expired=${r.expired ?? 0}`);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'sweep failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-4">
      <div className="rounded-lg border border-amber-500/30 bg-black/60 p-4">
        <h2 className="text-amber-300 font-semibold mb-3 inline-flex items-center gap-1.5">
          <TrendingUp className="w-4 h-4" /> Evidence + promotion
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
          <Field label="Understanding ID">
            <input
              value={understandingId}
              onChange={(e) => setUnderstandingId(e.target.value)}
              placeholder="und_..."
              className="w-full bg-black/60 border border-white/10 rounded px-3 py-2 text-sm font-mono"
            />
          </Field>
          <Field label="Evidence">
            <input
              value={evidenceText}
              onChange={(e) => setEvidenceText(e.target.value)}
              placeholder="Supporting/refuting evidence text"
              className="w-full bg-black/60 border border-white/10 rounded px-3 py-2 text-sm"
            />
          </Field>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={recordEvidence}
            disabled={busy || !understandingId || !evidenceText.trim()}
            className="px-3 py-1.5 text-xs bg-amber-500/20 border border-amber-500/40 rounded text-amber-200 hover:bg-amber-500/30 disabled:opacity-50 inline-flex items-center gap-1"
          >
            {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
            Record evidence
          </button>
          <button
            onClick={evaluatePromotion}
            disabled={busy || !understandingId}
            className="px-3 py-1.5 text-xs bg-violet-500/20 border border-violet-500/40 rounded text-violet-200 hover:bg-violet-500/30 disabled:opacity-50 inline-flex items-center gap-1"
          >
            {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
            Evaluate promotion
          </button>
        </div>

        {evaluation && (
          <div className={`mt-3 rounded p-3 text-xs ${
            evaluation.decision === 'promote' ? 'bg-emerald-500/10 border border-emerald-500/30' :
            evaluation.decision === 'reject'  ? 'bg-rose-500/10 border border-rose-500/30' :
            'bg-amber-500/10 border border-amber-500/30'
          }`}>
            <div className="flex items-center justify-between mb-2">
              <span className="font-semibold uppercase tracking-wide text-[10px]">{evaluation.decision ?? 'pending'}</span>
              {evaluation.evidenceCount != null && (
                <span className="text-white/40">evidence count: {evaluation.evidenceCount}</span>
              )}
            </div>
            {evaluation.reason && <p className="text-white/70">{evaluation.reason}</p>}
            {evaluation.thresholds && (
              <div className="mt-2 text-white/40 font-mono text-[10px]">
                {Object.entries(evaluation.thresholds).map(([k, v]) => `${k}=${v}`).join(' · ')}
              </div>
            )}
            {(evaluation.decision === 'promote' || evaluation.decision === 'pending') && (
              <div className="flex gap-2 mt-3">
                <button
                  onClick={() => applyPromotion('promote')}
                  disabled={busy}
                  className="px-3 py-1 text-[11px] bg-emerald-600 hover:bg-emerald-500 rounded text-white"
                >
                  Apply promote
                </button>
                <button
                  onClick={() => applyPromotion('reject')}
                  disabled={busy}
                  className="px-3 py-1 text-[11px] bg-rose-600 hover:bg-rose-500 rounded text-white"
                >
                  Apply reject
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="rounded-lg border border-white/10 bg-black/60 p-4">
        <h2 className="text-white/80 font-semibold mb-3 inline-flex items-center gap-1.5">
          <BarChart3 className="w-4 h-4" /> System cycles
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={runEvolutionTick}
            disabled={busy}
            className="px-3 py-1.5 text-xs bg-violet-700/40 hover:bg-violet-700/60 border border-violet-700 disabled:opacity-50 rounded text-violet-200 inline-flex items-center gap-1"
          >
            {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <TrendingUp className="w-3 h-3" />}
            Run evolution tick
          </button>
          <button
            onClick={runSweep}
            disabled={busy}
            className="px-3 py-1.5 text-xs bg-rose-700/40 hover:bg-rose-700/60 border border-rose-700 disabled:opacity-50 rounded text-rose-200 inline-flex items-center gap-1"
          >
            {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Clock className="w-3 h-3" />}
            Sweep expired
          </button>
        </div>
        {tickResult && <p className="text-xs text-emerald-300 mt-2">{tickResult}</p>}
      </div>

      {error && <p className="text-sm text-rose-300">{error}</p>}
    </section>
  );
}
