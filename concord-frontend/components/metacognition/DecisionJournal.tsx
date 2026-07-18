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
  TrendingUp, Loader2, ChevronDown, ChevronUp, Sparkles, ChevronRight,
  AlertTriangle, ShieldCheck, X, Star,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { ChartKit } from '@/components/viz';

// journalLog now accepts (and journalList/journalBiasDetection read back) a
// richer per-option shape — { name, score, evidence } — so biasDetection's
// real anchoring/confirmation/sunk-cost math has something to run against.
// Entries logged before this change persisted `options` as a flat array of
// plain strings; those legacy rows still live in state and journalList still
// returns them exactly as stored, so `options` here is a union and every
// render path below normalizes before use instead of assuming the rich shape.
interface EvidenceItem { supports: boolean; strength: number }
interface RichOption { name: string; score: number | null; evidence: EvidenceItem[] }
type JournalOption = string | RichOption;

function normalizeOption(o: JournalOption): RichOption {
  if (typeof o === 'string') return { name: o, score: null, evidence: [] };
  return { name: o.name, score: o.score ?? null, evidence: Array.isArray(o.evidence) ? o.evidence : [] };
}

interface JournalDecision {
  id: string;
  title: string;
  context: string;
  predictedOutcome: string;
  confidence: number;
  domain: string;
  options: JournalOption[];
  chosen?: string | null;
  initialAnchor?: number | null;
  investedCost?: number | null;
  biasChecks: string[];
  status: string;
  actualOutcome: string | null;
  correct: boolean | null;
  lesson?: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

// Editable row shape for the "Advanced" option-entry form. Kept as strings
// in state so a half-typed number ("-" or "") doesn't get coerced early;
// submitDecision does the real numeric parsing + validation at send time.
interface EvidenceRow { supports: boolean; strength: string }
interface OptionRow { name: string; score: string; evidence: EvidenceRow[] }

const emptyOptionRow = (): OptionRow => ({ name: '', score: '', evidence: [] });

interface BiasFinding {
  type: string;
  description: string;
  severity: 'high' | 'moderate' | 'low';
  [key: string]: unknown;
}
interface BiasReport {
  message?: string;
  decisionsAnalyzed?: number;
  biasesDetected?: number;
  biases?: BiasFinding[];
  biasIndex?: number;
  riskLevel?: 'high' | 'moderate' | 'low';
  recommendations?: string[];
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
  const [formError, setFormError] = useState<string | null>(null);

  // Advanced (optional) bias-detection data: per-option score + evidence +
  // which option was chosen + anchor/invested-cost. Collapsed by default so
  // the simple flat-option flow (or no options at all) stays the fast path;
  // opting in is what unlocks real Bias Detection below (§ Bias Detection).
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [optionRows, setOptionRows] = useState<OptionRow[]>([emptyOptionRow(), emptyOptionRow()]);
  const [chosenIdx, setChosenIdx] = useState<number | null>(null);
  const [initialAnchor, setInitialAnchor] = useState('');
  const [investedCost, setInvestedCost] = useState('');

  const addOptionRow = () => setOptionRows((rows) => [...rows, emptyOptionRow()]);
  const removeOptionRow = (i: number) => {
    setOptionRows((rows) => rows.filter((_, idx) => idx !== i));
    setChosenIdx((c) => (c === i ? null : c && c > i ? c - 1 : c));
  };
  const updateOptionRow = (i: number, patch: Partial<OptionRow>) =>
    setOptionRows((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const addEvidenceRow = (optIdx: number) =>
    setOptionRows((rows) => rows.map((r, idx) =>
      idx === optIdx ? { ...r, evidence: [...r.evidence, { supports: true, strength: '' }] } : r
    ));
  const removeEvidenceRow = (optIdx: number, evIdx: number) =>
    setOptionRows((rows) => rows.map((r, idx) =>
      idx === optIdx ? { ...r, evidence: r.evidence.filter((_, ei) => ei !== evIdx) } : r
    ));
  const updateEvidenceRow = (optIdx: number, evIdx: number, patch: Partial<EvidenceRow>) =>
    setOptionRows((rows) => rows.map((r, idx) =>
      idx === optIdx ? { ...r, evidence: r.evidence.map((e, ei) => (ei === evIdx ? { ...e, ...patch } : e)) } : r
    ));
  const resetAdvanced = () => {
    setShowAdvanced(false);
    setOptionRows([emptyOptionRow(), emptyOptionRow()]);
    setChosenIdx(null);
    setInitialAnchor('');
    setInvestedCost('');
  };

  // Resolve form.
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [actualOutcome, setActualOutcome] = useState('');
  const [lesson, setLesson] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  // Bias Detection panel — real findings from journalBiasDetection, never a
  // fabricated report. Loads only on request (not on every journal load) so
  // a user who never fills in the Advanced section never pays for a call
  // that can only ever say "no decision data".
  const [biasReport, setBiasReport] = useState<BiasReport | null>(null);
  const [biasLoading, setBiasLoading] = useState(false);
  const [biasError, setBiasError] = useState<string | null>(null);

  const runBiasDetection = async () => {
    setBiasLoading(true);
    setBiasError(null);
    try {
      const res = await lensRun<BiasReport>('metacognition', 'journalBiasDetection', {});
      if (res.data.ok && res.data.result) {
        setBiasReport(res.data.result);
      } else {
        setBiasError(res.data.error || 'Could not run bias detection.');
      }
    } catch (e) {
      setBiasError(e instanceof Error ? e.message : 'Could not run bias detection.');
    } finally {
      setBiasLoading(false);
    }
  };

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
    setFormError(null);

    const payload: Record<string, any> = { title, context, predictedOutcome: predicted, confidence, domain };

    if (showAdvanced) {
      const namedRows = optionRows.filter((r) => r.name.trim());
      if (namedRows.length > 0) {
        payload.options = namedRows.map((r) => ({
          name: r.name.trim(),
          ...(r.score.trim() !== '' ? { score: Number(r.score) } : {}),
          ...(r.evidence.length > 0
            ? { evidence: r.evidence
                .filter((e) => e.strength.trim() !== '')
                .map((e) => ({ supports: e.supports, strength: Number(e.strength) })) }
            : {}),
        }));
        // chosenIdx indexes into the full optionRows array (matches the
        // radio buttons rendered per-row below), not the filtered namedRows
        // — resolve against the original row so filtering out blank rows
        // never shifts which option "chosen" points at.
        if (chosenIdx != null && optionRows[chosenIdx]?.name.trim()) {
          payload.chosen = optionRows[chosenIdx].name.trim();
        }
      }
      if (initialAnchor.trim() !== '') payload.initialAnchor = Number(initialAnchor);
      if (investedCost.trim() !== '') payload.investedCost = Number(investedCost);
    }

    const res = await lensRun('metacognition', 'journalLog', payload);
    setSaving(false);
    if (res.data.ok) {
      setTitle(''); setContext(''); setPredicted(''); setConfidence(0.7); setDomain('general');
      resetAdvanced();
      setShowForm(false);
      load();
    } else {
      setFormError(res.data.error || 'Failed to log decision');
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
      <div className="flex items-center justify-center py-12 text-gray-400 gap-2">
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
          <p className="text-xs text-gray-400 mb-3">
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

            {/* Advanced: per-option score + evidence + anchor/invested-cost —
                the data Bias Detection (below) needs. Collapsed by default so
                the fast flat path is unaffected for users who don't need it. */}
            <button
              type="button"
              onClick={() => setShowAdvanced((v) => !v)}
              className="text-xs text-neon-cyan hover:underline flex items-center gap-1"
            >
              {showAdvanced ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
              Advanced: options, evidence &amp; bias data (optional)
            </button>

            {showAdvanced && (
              <div className="space-y-3 p-3 bg-black/20 rounded-lg border border-white/5">
                <p className="text-xs text-gray-400">
                  Add the options you considered, an optional numeric score for each,
                  and evidence for/against. Mark which one you chose. This is what
                  powers real Bias Detection below.
                </p>
                <div className="space-y-3">
                  {optionRows.map((row, i) => (
                    <div key={i} className="p-2 rounded bg-lattice-deep space-y-2">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setChosenIdx(i)}
                          title="Mark as chosen"
                          aria-label={`Mark option ${i + 1} as chosen`}
                          className={`shrink-0 p-1 rounded ${chosenIdx === i ? 'text-neon-yellow' : 'text-gray-500 hover:text-gray-300'}`}
                        >
                          <Star className="w-3.5 h-3.5" fill={chosenIdx === i ? 'currentColor' : 'none'} />
                        </button>
                        <input
                          className="input-lattice flex-1"
                          placeholder={`Option ${i + 1} name`}
                          value={row.name}
                          onChange={(e) => updateOptionRow(i, { name: e.target.value })}
                        />
                        <input
                          className="input-lattice w-24"
                          placeholder="Score"
                          inputMode="decimal"
                          value={row.score}
                          onChange={(e) => updateOptionRow(i, { score: e.target.value })}
                        />
                        {optionRows.length > 1 && (
                          <button
                            type="button"
                            onClick={() => removeOptionRow(i)}
                            className="p-1 text-gray-500 hover:text-red-400"
                            aria-label={`Remove option ${i + 1}`}
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>

                      {row.evidence.length > 0 && (
                        <div className="space-y-1 pl-6">
                          {row.evidence.map((ev, ei) => (
                            <div key={ei} className="flex items-center gap-2">
                              <select
                                className="input-lattice text-xs py-1"
                                value={ev.supports ? 'for' : 'against'}
                                onChange={(e) => updateEvidenceRow(i, ei, { supports: e.target.value === 'for' })}
                                aria-label="Evidence supports or contradicts"
                              >
                                <option value="for">Supports</option>
                                <option value="against">Contradicts</option>
                              </select>
                              <input
                                className="input-lattice flex-1 text-xs py-1"
                                placeholder="Strength (0-10)"
                                inputMode="decimal"
                                value={ev.strength}
                                onChange={(e) => updateEvidenceRow(i, ei, { strength: e.target.value })}
                              />
                              <button
                                type="button"
                                onClick={() => removeEvidenceRow(i, ei)}
                                className="p-1 text-gray-500 hover:text-red-400"
                                aria-label="Remove evidence"
                              >
                                <X className="w-3 h-3" />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={() => addEvidenceRow(i)}
                        className="ml-6 text-[11px] text-gray-400 hover:text-neon-cyan"
                      >
                        + Add evidence
                      </button>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={addOptionRow}
                  className="text-xs text-neon-cyan hover:underline"
                >
                  + Add another option
                </button>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">Initial anchor (optional)</label>
                    <input
                      className="input-lattice w-full"
                      placeholder="e.g. the first number you saw"
                      inputMode="decimal"
                      value={initialAnchor}
                      onChange={(e) => setInitialAnchor(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">Invested cost (optional)</label>
                    <input
                      className="input-lattice w-full"
                      placeholder="e.g. time/money already spent"
                      inputMode="decimal"
                      value={investedCost}
                      onChange={(e) => setInvestedCost(e.target.value)}
                    />
                  </div>
                </div>
              </div>
            )}

            {formError && (
              <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg p-2">{formError}</div>
            )}

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
          <p className="text-center py-8 text-gray-400 text-sm">
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
                      <div className="flex flex-wrap items-center gap-2 text-xs text-gray-400 mt-0.5">
                        <span>Conf: {(d.confidence * 100).toFixed(0)}%</span>
                        <span className="px-1.5 py-0.5 rounded bg-neon-purple/10 text-neon-purple">{d.domain}</span>
                        <span>{fmtDate(d.createdAt)}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => setExpanded(isExp ? null : d.id)}
                        className="p-1 text-gray-400 hover:text-gray-300"
                        aria-label={isExp ? `Collapse ${d.title}` : `Expand ${d.title}`}
                      >
                        {isExp ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                      </button>
                      <button
                        onClick={() => remove(d.id)}
                        className="p-1 text-gray-400 hover:text-red-400"
                        title="Delete"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {isExp && (
                    <div className="mt-3 pt-3 border-t border-gray-700/30 space-y-2 text-xs text-gray-400">
                      {d.context && <p><span className="text-gray-400">Context:</span> {d.context}</p>}
                      {d.predictedOutcome && <p><span className="text-gray-400">Predicted:</span> {d.predictedOutcome}</p>}
                      {Array.isArray(d.options) && d.options.length > 0 && (
                        <div>
                          <span className="text-gray-400">Options considered:</span>
                          <ul className="mt-1 space-y-0.5">
                            {d.options.map((raw, i) => {
                              const opt = normalizeOption(raw);
                              const isChosen = !!d.chosen && opt.name === d.chosen;
                              return (
                                <li key={i} className={isChosen ? 'text-neon-yellow flex items-center gap-1' : 'flex items-center gap-1'}>
                                  {isChosen && <Star className="w-3 h-3 shrink-0" fill="currentColor" />}
                                  {opt.name}
                                  {opt.score != null && <span className="text-gray-500"> (score {opt.score})</span>}
                                  {opt.evidence.length > 0 && (
                                    <span className="text-gray-500">
                                      {' '}— {opt.evidence.filter((e) => e.supports).length} for /{' '}
                                      {opt.evidence.filter((e) => !e.supports).length} against
                                    </span>
                                  )}
                                </li>
                              );
                            })}
                          </ul>
                        </div>
                      )}
                      {d.initialAnchor != null && <p><span className="text-gray-400">Initial anchor:</span> {d.initialAnchor}</p>}
                      {d.investedCost != null && <p><span className="text-gray-400">Invested cost:</span> {d.investedCost}</p>}
                      {d.actualOutcome && <p><span className="text-gray-400">Actual:</span> {d.actualOutcome}</p>}
                      {d.lesson && <p className="text-neon-yellow"><span className="text-gray-400">Lesson:</span> {d.lesson}</p>}
                      {d.resolvedAt && <p className="text-gray-400">Resolved: {fmtDate(d.resolvedAt)}</p>}
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

      {/* Bias Detection — real anchoring/confirmation/sunk-cost findings
          computed from this journal's own rich entries (journalBiasDetection),
          never a canned report. A prior pass removed the biasDetection button
          from the Predictions Analysis panel because that surface's data model
          (predictions_list) has no options/chosen/anchor concept at all, so the
          button could only ever say "no bias data" — see
          docs/lens-specs/metacognition-capability-map.md. Now that the journal
          itself captures real per-option score/evidence/anchor/invested-cost
          (the Advanced section above), this is the honest home for it. */}
      <div className="panel p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-red-400" /> Bias Detection
          </h3>
          <button
            onClick={runBiasDetection}
            disabled={biasLoading}
            className="btn-secondary text-sm flex items-center gap-1 disabled:opacity-50"
          >
            {biasLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
            {biasLoading ? 'Analyzing...' : 'Run Bias Detection'}
          </button>
        </div>
        <p className="text-xs text-gray-400">
          Analyzes anchoring, confirmation bias, and sunk-cost patterns across the
          decisions above that were logged with the Advanced (options/evidence/
          anchor/invested-cost) fields filled in. Needs at least 2 such decisions
          per pattern to say anything.
        </p>

        {biasError && (
          <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg p-2">{biasError}</div>
        )}

        {biasReport && (
          <div className="space-y-3">
            {biasReport.message && (
              <p className="text-sm text-gray-400">{biasReport.message}</p>
            )}
            {!biasReport.message && (
              <>
                <div className="flex flex-wrap items-center gap-4 text-xs">
                  <span className="text-gray-400">
                    Decisions analyzed: <span className="text-gray-200 font-mono">{biasReport.decisionsAnalyzed}</span>
                  </span>
                  <span className="text-gray-400">
                    Biases found: <span className="text-gray-200 font-mono">{biasReport.biasesDetected}</span>
                  </span>
                  {biasReport.riskLevel && (
                    <span
                      className={`px-2 py-0.5 rounded-full capitalize font-medium ${
                        biasReport.riskLevel === 'high'
                          ? 'bg-red-500/15 text-red-400'
                          : biasReport.riskLevel === 'moderate'
                            ? 'bg-yellow-500/15 text-yellow-400'
                            : 'bg-green-500/15 text-green-400'
                      }`}
                    >
                      {biasReport.riskLevel} risk
                    </span>
                  )}
                </div>

                {(biasReport.biasesDetected ?? 0) === 0 ? (
                  <p className="text-sm text-green-400 flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4" /> No systematic bias patterns detected in {biasReport.decisionsAnalyzed} analyzed decision{biasReport.decisionsAnalyzed === 1 ? '' : 's'}.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {(biasReport.biases || []).map((b, i) => (
                      <div key={i} className="lens-card">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium capitalize">{b.type.replace(/_/g, ' ')}</span>
                          <span
                            className={`text-[10px] uppercase px-1.5 py-0.5 rounded-full ${
                              b.severity === 'high'
                                ? 'bg-red-500/15 text-red-400'
                                : b.severity === 'moderate'
                                  ? 'bg-yellow-500/15 text-yellow-400'
                                  : 'bg-gray-500/15 text-gray-400'
                            }`}
                          >
                            {b.severity}
                          </span>
                        </div>
                        <p className="text-xs text-gray-400 mt-1">{b.description}</p>
                      </div>
                    ))}
                    {Array.isArray(biasReport.recommendations) && biasReport.recommendations.length > 0 && (
                      <div className="text-xs text-gray-400 space-y-1 pt-1">
                        {biasReport.recommendations.map((rec, i) => (
                          <p key={i}>• {rec}</p>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export type { JournalOption, RichOption, EvidenceItem };
