'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * DecisionJournal — log a decision with predicted outcome + confidence,
 * resolve it later with the actual outcome, and review a reliability
 * diagram + Brier-score history built from the resolved entries.
 * Every value rendered comes from the metacognition domain macros.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  BookMarked, Plus, CheckCircle2, XCircle, Clock, Trash2, Target,
  TrendingUp, Loader2, ChevronDown, ChevronUp,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { ChartKit } from '@/components/viz';

interface DecisionOption { label?: string; score?: number; notes?: string }
interface JournalDecision {
  id: string;
  title: string;
  context: string;
  predictedOutcome: string;
  confidence: number;
  domain: string;
  options: string[];
  biasChecks: string[];
  status: string;
  actualOutcome: string | null;
  correct: boolean | null;
  lesson?: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

interface ReliabilityBin {
  binRange: [number, number];
  midpoint: number;
  count: number;
  predicted: number | null;
  observed: number | null;
  gap: number | null;
}

interface CalibrationReport {
  n: number;
  brierScore?: number;
  brierSkillScore?: number;
  accuracy?: number;
  avgConfidence?: number;
  calibrationGap?: number;
  ece?: number;
  quality?: string;
  tendency?: string;
  overconfident?: number;
  underconfident?: number;
  reliability: ReliabilityBin[];
  history: Array<{ index: number; title: string; runningBrier: number; correct: boolean }>;
}

const DOMAINS = ['general', 'work', 'finance', 'health', 'relationships', 'forecasting', 'learning'];

function fmtDate(ts: string | null): string {
  if (!ts) return '';
  const d = new Date(ts);
  return isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function DecisionJournal() {
  const [decisions, setDecisions] = useState<JournalDecision[]>([]);
  const [report, setReport] = useState<CalibrationReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'open' | 'resolved'>('all');
  const [error, setError] = useState<string | null>(null);

  // New-decision form.
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [context, setContext] = useState('');
  const [predicted, setPredicted] = useState('');
  const [confidence, setConfidence] = useState(0.7);
  const [domain, setDomain] = useState('general');
  const [saving, setSaving] = useState(false);

  // Resolve form.
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [actualOutcome, setActualOutcome] = useState('');
  const [lesson, setLesson] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [listRes, calRes] = await Promise.all([
      lensRun('metacognition', 'journalList', { status: filter }),
      lensRun('metacognition', 'calibrationReport', { bins: 5 }),
    ]);
    if (listRes.data.ok && listRes.data.result) {
      setDecisions(((listRes.data.result as any).decisions as JournalDecision[]) || []);
    } else {
      setError(listRes.data.error || 'Failed to load journal');
    }
    if (calRes.data.ok && calRes.data.result) {
      setReport(calRes.data.result as CalibrationReport);
    }
    setLoading(false);
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  const submitDecision = async () => {
    if (!title.trim()) return;
    setSaving(true);
    const res = await lensRun('metacognition', 'journalLog', {
      title, context, predictedOutcome: predicted, confidence, domain,
    });
    setSaving(false);
    if (res.data.ok) {
      setTitle(''); setContext(''); setPredicted(''); setConfidence(0.7); setDomain('general');
      setShowForm(false);
      load();
    } else {
      setError(res.data.error || 'Failed to log decision');
    }
  };

  const resolve = async (id: string, correct: boolean) => {
    const res = await lensRun('metacognition', 'journalResolve', {
      id, actualOutcome, correct, lesson,
    });
    if (res.data.ok) {
      setResolvingId(null); setActualOutcome(''); setLesson('');
      load();
    } else {
      setError(res.data.error || 'Failed to resolve');
    }
  };

  const remove = async (id: string) => {
    const res = await lensRun('metacognition', 'journalDelete', { id });
    if (res.data.ok) load();
  };

  // Reliability-diagram chart data: predicted vs observed per bin.
  const reliabilityData = (report?.reliability || [])
    .filter((b) => b.count > 0)
    .map((b) => ({
      bin: `${Math.round(b.binRange[0] * 100)}-${Math.round(b.binRange[1] * 100)}%`,
      predicted: b.predicted != null ? Math.round(b.predicted * 100) : 0,
      observed: b.observed != null ? Math.round(b.observed * 100) : 0,
      count: b.count,
    }));

  const brierHistory = (report?.history || []).map((h) => ({
    label: `#${h.index}`,
    brier: Math.round(h.runningBrier * 1000) / 1000,
  }));

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-gray-500 gap-2">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading decision journal...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg p-3">{error}</div>
      )}

      {/* Calibration summary */}
      {report && report.n > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="lens-card">
            <Target className="w-4 h-4 text-neon-cyan mb-1" />
            <p className="text-xl font-bold font-mono">{report.brierScore?.toFixed(3) ?? '--'}</p>
            <p className="text-xs text-gray-400">Brier score</p>
          </div>
          <div className="lens-card">
            <CheckCircle2 className="w-4 h-4 text-neon-green mb-1" />
            <p className="text-xl font-bold font-mono">{report.accuracy != null ? `${(report.accuracy * 100).toFixed(0)}%` : '--'}</p>
            <p className="text-xs text-gray-400">Accuracy ({report.n})</p>
          </div>
          <div className="lens-card">
            <TrendingUp className="w-4 h-4 text-neon-purple mb-1" />
            <p className="text-xl font-bold font-mono capitalize">{report.tendency ?? '--'}</p>
            <p className="text-xs text-gray-400">
              Gap {report.calibrationGap != null ? `${report.calibrationGap > 0 ? '+' : ''}${(report.calibrationGap * 100).toFixed(0)}%` : '--'}
            </p>
          </div>
          <div className="lens-card">
            <Clock className="w-4 h-4 text-neon-yellow mb-1" />
            <p className="text-xl font-bold font-mono capitalize">{report.quality ?? '--'}</p>
            <p className="text-xs text-gray-400">Calibration quality</p>
          </div>
        </div>
      )}

      {/* Reliability diagram */}
      {reliabilityData.length > 0 && (
        <div className="panel p-4">
          <h3 className="font-semibold mb-3 flex items-center gap-2">
            <Target className="w-4 h-4 text-neon-cyan" /> Reliability Diagram
          </h3>
          <p className="text-xs text-gray-500 mb-3">
            Predicted confidence vs observed outcome rate per bin. A perfectly calibrated
            forecaster has the two bars equal in every bin.
          </p>
          <ChartKit
            kind="bar"
            data={reliabilityData}
            xKey="bin"
            series={[
              { key: 'predicted', label: 'Predicted %', color: '#6366f1' },
              { key: 'observed', label: 'Observed %', color: '#22c55e' },
            ]}
            height={220}
          />
        </div>
      )}

      {/* Brier history */}
      {brierHistory.length > 1 && (
        <div className="panel p-4">
          <h3 className="font-semibold mb-3 flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-neon-green" /> Running Brier Score
          </h3>
          <ChartKit
            kind="line"
            data={brierHistory}
            xKey="label"
            series={[{ key: 'brier', label: 'Brier (lower = better)', color: '#f59e0b' }]}
            height={200}
          />
        </div>
      )}

      {/* New decision */}
      <div className="panel p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold flex items-center gap-2">
            <BookMarked className="w-4 h-4 text-neon-purple" /> Decision Journal
          </h3>
          <button
            onClick={() => setShowForm((v) => !v)}
            className="btn-neon purple text-sm flex items-center gap-1"
          >
            <Plus className="w-4 h-4" /> {showForm ? 'Cancel' : 'Log Decision'}
          </button>
        </div>

        {showForm && (
          <div className="space-y-3 mb-4 p-3 bg-lattice-deep rounded-lg">
            <input
              className="input-lattice w-full"
              placeholder="Decision — e.g. 'Accept the contractor's quote'"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            <textarea
              className="input-lattice w-full"
              rows={2}
              placeholder="Context — what do you know right now?"
              value={context}
              onChange={(e) => setContext(e.target.value)}
            />
            <textarea
              className="input-lattice w-full"
              rows={2}
              placeholder="Predicted outcome — what do you expect to happen?"
              value={predicted}
              onChange={(e) => setPredicted(e.target.value)}
            />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-gray-400 block mb-1">
                  Confidence: {(confidence * 100).toFixed(0)}%
                </label>
                <input
                  type="range" min="0.05" max="1" step="0.05"
                  value={confidence}
                  onChange={(e) => setConfidence(parseFloat(e.target.value))}
                  className="w-full"
                />
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Domain</label>
                <select
                  className="input-lattice w-full"
                  value={domain}
                  onChange={(e) => setDomain(e.target.value)}
                >
                  {DOMAINS.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
            </div>
            <button
              onClick={submitDecision}
              disabled={!title.trim() || saving}
              className="btn-neon purple w-full flex items-center justify-center gap-2"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              {saving ? 'Saving...' : 'Record Decision'}
            </button>
          </div>
        )}

        {/* Filter */}
        <div className="flex gap-1 mb-3">
          {(['all', 'open', 'resolved'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1 text-xs rounded-full capitalize transition-colors ${
                filter === f ? 'bg-neon-purple/20 text-neon-purple' : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              {f}
            </button>
          ))}
        </div>

        {/* Decision list */}
        {decisions.length === 0 ? (
          <p className="text-center py-8 text-gray-500 text-sm">
            No decisions logged yet. Click &quot;Log Decision&quot; to start your journal.
          </p>
        ) : (
          <div className="space-y-2">
            {decisions.map((d) => {
              const isOpen = d.status === 'open';
              const isExp = expanded === d.id;
              return (
                <div key={d.id} className="lens-card">
                  <div className="flex items-start gap-3">
                    {isOpen ? (
                      <Clock className="w-4 h-4 text-gray-400 shrink-0 mt-0.5" />
                    ) : d.correct ? (
                      <CheckCircle2 className="w-4 h-4 text-green-400 shrink-0 mt-0.5" />
                    ) : (
                      <XCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">{d.title}</p>
                      <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500 mt-0.5">
                        <span>Conf: {(d.confidence * 100).toFixed(0)}%</span>
                        <span className="px-1.5 py-0.5 rounded bg-neon-purple/10 text-neon-purple">{d.domain}</span>
                        <span>{fmtDate(d.createdAt)}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => setExpanded(isExp ? null : d.id)}
                        className="p-1 text-gray-500 hover:text-gray-300"
                      >
                        {isExp ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                      </button>
                      <button
                        onClick={() => remove(d.id)}
                        className="p-1 text-gray-500 hover:text-red-400"
                        title="Delete"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {isExp && (
                    <div className="mt-3 pt-3 border-t border-gray-700/30 space-y-2 text-xs text-gray-400">
                      {d.context && <p><span className="text-gray-500">Context:</span> {d.context}</p>}
                      {d.predictedOutcome && <p><span className="text-gray-500">Predicted:</span> {d.predictedOutcome}</p>}
                      {d.actualOutcome && <p><span className="text-gray-500">Actual:</span> {d.actualOutcome}</p>}
                      {d.lesson && <p className="text-neon-yellow"><span className="text-gray-500">Lesson:</span> {d.lesson}</p>}
                      {d.resolvedAt && <p className="text-gray-500">Resolved: {fmtDate(d.resolvedAt)}</p>}
                    </div>
                  )}

                  {/* Resolve UI */}
                  {isOpen && (
                    resolvingId === d.id ? (
                      <div className="mt-3 pt-3 border-t border-gray-700/30 space-y-2">
                        <textarea
                          className="input-lattice w-full"
                          rows={2}
                          placeholder="What actually happened?"
                          value={actualOutcome}
                          onChange={(e) => setActualOutcome(e.target.value)}
                        />
                        <input
                          className="input-lattice w-full"
                          placeholder="Lesson learned (optional)"
                          value={lesson}
                          onChange={(e) => setLesson(e.target.value)}
                        />
                        <div className="flex gap-2">
                          <button
                            onClick={() => resolve(d.id, true)}
                            className="flex-1 px-3 py-1.5 text-xs rounded bg-green-500/20 text-green-400 hover:bg-green-500/30 flex items-center justify-center gap-1"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" /> Prediction held
                          </button>
                          <button
                            onClick={() => resolve(d.id, false)}
                            className="flex-1 px-3 py-1.5 text-xs rounded bg-red-500/20 text-red-400 hover:bg-red-500/30 flex items-center justify-center gap-1"
                          >
                            <XCircle className="w-3.5 h-3.5" /> Prediction missed
                          </button>
                          <button
                            onClick={() => { setResolvingId(null); setActualOutcome(''); setLesson(''); }}
                            className="px-3 py-1.5 text-xs rounded text-gray-400 hover:text-gray-200"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        onClick={() => { setResolvingId(d.id); setActualOutcome(''); setLesson(''); }}
                        className="mt-2 text-xs text-neon-cyan hover:underline"
                      >
                        Record outcome →
                      </button>
                    )
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export type { DecisionOption };
