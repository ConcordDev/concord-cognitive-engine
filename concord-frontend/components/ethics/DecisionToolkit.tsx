'use client';

/**
 * DecisionToolkit — the actionable ethics-decision surface for the
 * ethics lens. Wires all 19 `ethics` domain macros end-to-end, split
 * across nine tools:
 *   - multiFrameworkDilemma / listMultiFramework
 *   - stakeholderMap / listStakeholderMaps
 *   - decisionMatrix / listDecisionMatrices
 *   - biasChecklistTemplate / biasChecklist / listBiasChecklists
 *   - submitReview / addReviewOpinion / recordVerdict / listReviews
 *   - archiveCase / searchCases / deleteCase
 *   - frameworkAnalysis (deep 4-framework synthesis of a single action)
 *   - stakeholderImpact (Mitchell-Agle-Wood salience/equity analysis)
 *   - biasDetection (dataset-level 4/5ths-rule disparate-impact audit)
 *
 * Every value rendered comes from a real macro response. The last three
 * tools are single-shot compute (the backend never persists them — no
 * `list*` macro exists for them), so their panels are "fill in → run →
 * see the real computed result," not a fabricated history list.
 */

import { useState, useEffect, useCallback, type ReactNode } from 'react';
import { lensRun } from '@/lib/api/client';
import { ChartKit } from '@/components/viz';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
import {
  Scale, Users, Grid3x3, ListChecks, MessagesSquare, Archive,
  Plus, Trash2, X, Loader2, Search, Gavel, ThumbsUp, ThumbsDown, RefreshCw,
  Brain, Target, ShieldAlert,
} from 'lucide-react';

export type ToolTab =
  | 'multiframework' | 'stakeholder' | 'matrix' | 'bias' | 'review' | 'cases'
  | 'framework' | 'impact' | 'audit';

export const TOOL_TABS: { id: ToolTab; label: string; icon: typeof Scale; key: string }[] = [
  { id: 'multiframework', label: 'Multi-Framework', icon: Scale, key: 'm' },
  { id: 'stakeholder', label: 'Stakeholder Map', icon: Users, key: 's' },
  { id: 'matrix', label: 'Decision Matrix', icon: Grid3x3, key: 'd' },
  { id: 'bias', label: 'Bias Checklist', icon: ListChecks, key: 'b' },
  { id: 'review', label: 'Ethics Review', icon: MessagesSquare, key: 'r' },
  { id: 'cases', label: 'Case Library', icon: Archive, key: 'c' },
  { id: 'framework', label: 'Framework Analysis', icon: Brain, key: 'f' },
  { id: 'impact', label: 'Stakeholder Impact', icon: Target, key: 'i' },
  { id: 'audit', label: 'Bias Audit', icon: ShieldAlert, key: 'a' },
];

interface MfaOption {
  name: string;
  description: string;
  scores: { utilitarian: number; deontological: number; virtue: number };
  composite: number;
  agreement: string;
  benefit: number;
  harm: number;
}
interface MfaRecord {
  id: string;
  dilemma: string;
  options: MfaOption[];
  recommended?: string;
  conflicted: string[];
  createdAt: string;
}

interface SmapStakeholder {
  name: string;
  group: string;
  vulnerability: number;
  impacts: Record<string, { raw: number; weighted: number }>;
  netExposure: number;
}
interface SmapOptionTotal {
  option: string;
  netImpact: number;
  harmed: number;
  benefited: number;
  vulnerableHarmed: number;
}
interface SmapRecord {
  id: string;
  title: string;
  options: string[];
  stakeholders: SmapStakeholder[];
  optionTotals: SmapOptionTotal[];
  bestOption?: string;
  createdAt: string;
}

interface MtxRecord {
  id: string;
  title: string;
  criteria: { name: string; weight: number }[];
  options: {
    name: string;
    breakdown: { criterion: string; raw: number; weighted: number }[];
    total: number;
    percent: number;
  }[];
  winner?: string;
  createdAt: string;
}

interface BiasItem {
  key: string;
  label: string;
  prompt: string;
  flagged: boolean;
  note: string;
}
interface BiasRecord {
  id: string;
  decision: string;
  items: BiasItem[];
  flaggedCount: number;
  totalCount: number;
  riskScore: number;
  riskLevel: string;
  createdAt: string;
}

interface ReviewOpinion {
  id: string;
  by: string;
  stance: string;
  rationale: string;
  createdAt: string;
}
interface ReviewRecord {
  id: string;
  title: string;
  dilemma: string;
  options: string[];
  status: string;
  submittedBy: string;
  opinions: ReviewOpinion[];
  verdict: null | {
    decision: string;
    rationale: string;
    tally: Record<string, number>;
    decidedBy: string;
    decidedAt: string;
  };
  createdAt: string;
  updatedAt: string;
}

interface CaseRecord {
  id: string;
  title: string;
  dilemma: string;
  reasoning: string;
  resolution: string;
  framework: string;
  tags: string[];
  sourceReviewId: string | null;
  archivedAt: string;
}

const SECTION = 'rounded-xl border border-lattice-border bg-lattice-surface p-4 space-y-3';
const errBox = 'text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2';

/**
 * LoadGate — the single load-state authority for every ethics list panel.
 *
 * Each panel's list-load reaches a real macro through lensRun (which unwraps the
 * { ok, result } envelope, so a handler rejection lands as r.data.ok === false
 * with r.data.error). The prior surface did `if (r.data.ok && r.data.result)
 * setRecords(...)` with no else — a failed load rendered identically to a
 * genuinely-empty one (the silent-empty defect). LoadGate makes the four states
 * DISTINGUISHABLE: a spinner while loading, a red alert with a WORKING retry
 * that re-runs the loader on error, an honest CTA when truly empty, and the
 * children (real records) when populated.
 *
 * It renders nothing of its own in the populated case — the panel passes its
 * record list and LoadGate decides loading/error/empty vs. handing through.
 */
function LoadGate({
  loading,
  error,
  onRetry,
  isEmpty,
  emptyLabel,
  children,
}: {
  loading: boolean;
  error: string;
  onRetry: () => void;
  isEmpty: boolean;
  emptyLabel: string;
  children: ReactNode;
}) {
  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-8 text-sm text-gray-400">
        <Loader2 className="w-4 h-4 animate-spin" />
        Loading {emptyLabel}…
      </div>
    );
  }
  if (error) {
    return (
      <div className={cn(errBox, 'flex items-center justify-between gap-3')} role="alert">
        <span>Could not load {emptyLabel}: {error}</span>
        <button
          onClick={onRetry}
          className="flex items-center gap-1 px-2 py-1 rounded border border-red-500/40 text-red-300 hover:bg-red-500/10 whitespace-nowrap"
        >
          <RefreshCw className="w-3.5 h-3.5" /> Retry
        </button>
      </div>
    );
  }
  if (isEmpty) {
    return <EmptyHint label={emptyLabel} />;
  }
  return <>{children}</>;
}

function riskColor(level: string): string {
  return level === 'high' ? 'text-red-400'
    : level === 'moderate' ? 'text-yellow-400'
    : 'text-green-400';
}
function impactColor(v: number): string {
  return v > 0 ? 'text-green-400' : v < 0 ? 'text-red-400' : 'text-gray-400';
}

export function DecisionToolkit({
  activeTab, onTabChange,
}: { activeTab?: ToolTab; onTabChange?: (tab: ToolTab) => void } = {}) {
  const [internalTab, setInternalTab] = useState<ToolTab>('multiframework');
  const tab = activeTab ?? internalTab;
  const setTab = (t: ToolTab) => {
    setInternalTab(t);
    onTabChange?.(t);
  };

  return (
    <div className="space-y-4">
      <nav className="flex flex-wrap gap-2 border-b border-lattice-border pb-3">
        {TOOL_TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-colors',
              tab === t.id
                ? 'bg-neon-purple/20 text-neon-purple'
                : 'text-gray-400 hover:text-white hover:bg-lattice-elevated',
            )}
          >
            <t.icon className="w-4 h-4" />
            {t.label}
            <kbd className="hidden sm:inline text-[10px] px-1 py-0.5 rounded border border-current/30 opacity-60">
              {t.key}
            </kbd>
          </button>
        ))}
      </nav>
      {tab === 'multiframework' && <MultiFrameworkPanel />}
      {tab === 'stakeholder' && <StakeholderMapPanel />}
      {tab === 'matrix' && <DecisionMatrixPanel />}
      {tab === 'bias' && <BiasChecklistPanel />}
      {tab === 'review' && <ReviewWorkflowPanel />}
      {tab === 'cases' && <CaseLibraryPanel />}
      {tab === 'framework' && <FrameworkAnalysisPanel />}
      {tab === 'impact' && <StakeholderImpactPanel />}
      {tab === 'audit' && <BiasAuditPanel />}
    </div>
  );
}

/* ───────────────────────── Multi-Framework ───────────────────────── */

function MultiFrameworkPanel() {
  const [dilemma, setDilemma] = useState('');
  const [options, setOptions] = useState([
    { name: '', description: '', harmScore: '', benefitScore: '' },
    { name: '', description: '', harmScore: '', benefitScore: '' },
  ]);
  const [records, setRecords] = useState<MfaRecord[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setLoadErr('');
    const r = await lensRun('ethics', 'listMultiFramework', {});
    setLoading(false);
    if (!r.data.ok) { setLoadErr(r.data.error || 'request failed'); return; }
    setRecords(r.data.result?.analyses || []);
  }, []);
  useEffect(() => { load(); }, [load]);

  const setOpt = (i: number, field: string, val: string) => {
    setOptions((prev) => prev.map((o, idx) => (idx === i ? { ...o, [field]: val } : o)));
  };

  const run = async () => {
    setErr('');
    if (!dilemma.trim()) { setErr('Dilemma text required.'); return; }
    const payloadOptions = options
      .filter((o) => o.name.trim())
      .map((o) => ({
        name: o.name.trim(),
        description: o.description.trim(),
        ...(o.harmScore !== '' ? { harmScore: Number(o.harmScore) } : {}),
        ...(o.benefitScore !== '' ? { benefitScore: Number(o.benefitScore) } : {}),
      }));
    if (payloadOptions.length === 0) { setErr('Add at least one named option.'); return; }
    setBusy(true);
    const r = await lensRun('ethics', 'multiFrameworkDilemma', { dilemma, options: payloadOptions });
    setBusy(false);
    if (!r.data.ok) { setErr(r.data.error || 'Analysis failed.'); return; }
    setDilemma('');
    setOptions([
      { name: '', description: '', harmScore: '', benefitScore: '' },
      { name: '', description: '', harmScore: '', benefitScore: '' },
    ]);
    load();
  };

  return (
    <div className="space-y-4">
      <div className={SECTION}>
        <h4 className={ds.heading3}>Run a dilemma through three lenses</h4>
        <textarea
          className={ds.textarea}
          rows={2}
          placeholder="Describe the ethical dilemma..."
          value={dilemma}
          onChange={(e) => setDilemma(e.target.value)}
        />
        <div className="space-y-2">
          {options.map((o, i) => (
            <div key={i} className="grid grid-cols-12 gap-2 items-center">
              <input
                className={cn(ds.input, 'col-span-3')}
                placeholder={`Option ${i + 1} name`}
                value={o.name}
                onChange={(e) => setOpt(i, 'name', e.target.value)}
              />
              <input
                className={cn(ds.input, 'col-span-5')}
                placeholder="Description"
                value={o.description}
                onChange={(e) => setOpt(i, 'description', e.target.value)}
              />
              <input
                type="number" className={cn(ds.input, 'col-span-2')}
                placeholder="Benefit 0-100"
                value={o.benefitScore}
                onChange={(e) => setOpt(i, 'benefitScore', e.target.value)}
              />
              <input
                type="number" className={cn(ds.input, 'col-span-2')}
                placeholder="Harm 0-100"
                value={o.harmScore}
                onChange={(e) => setOpt(i, 'harmScore', e.target.value)}
              />
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button
            className={ds.btnSecondary}
            onClick={() => setOptions((p) => [...p, { name: '', description: '', harmScore: '', benefitScore: '' }])}
          >
            <Plus className="w-4 h-4" /> Add Option
          </button>
          <button className={ds.btnPrimary} onClick={run} disabled={busy}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Scale className="w-4 h-4" />}
            Analyze
          </button>
        </div>
        {err && <div className={errBox}>{err}</div>}
      </div>

      <LoadGate
        loading={loading} error={loadErr} onRetry={load}
        isEmpty={records.length === 0} emptyLabel="multi-framework analyses"
      >
      {records.map((rec) => (
        <div key={rec.id} className={SECTION}>
          <div className="flex items-start justify-between gap-3">
            <p className="text-white font-medium">{rec.dilemma}</p>
            <span className="text-xs text-gray-400 whitespace-nowrap">
              {new Date(rec.createdAt).toLocaleDateString()}
            </span>
          </div>
          <p className={ds.textMuted}>
            Recommended: <span className="text-neon-cyan">{rec.recommended}</span>
            {rec.conflicted.length > 0 && (
              <span className="text-yellow-400"> · Framework conflict on {rec.conflicted.join(', ')}</span>
            )}
          </p>
          <ChartKit
            kind="bar"
            xKey="name"
            height={200}
            data={rec.options.map((o) => ({
              name: o.name,
              Utilitarian: o.scores.utilitarian,
              Deontological: o.scores.deontological,
              Virtue: o.scores.virtue,
            }))}
            series={[
              { key: 'Utilitarian', color: '#6366f1' },
              { key: 'Deontological', color: '#22c55e' },
              { key: 'Virtue', color: '#f59e0b' },
            ]}
          />
          <div className="space-y-1">
            {rec.options.map((o) => (
              <div key={o.name} className="flex items-center justify-between text-sm">
                <span className="text-gray-300">{o.name}</span>
                <span className="flex items-center gap-3">
                  <span className="text-gray-400">composite {o.composite}</span>
                  <span className={
                    o.agreement === 'consensus' ? 'text-green-400'
                      : o.agreement === 'frameworks-conflict' ? 'text-red-400'
                      : 'text-yellow-400'
                  }>
                    {o.agreement}
                  </span>
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}
      </LoadGate>
    </div>
  );
}

/* ───────────────────────── Stakeholder Map ───────────────────────── */

function StakeholderMapPanel() {
  const [title, setTitle] = useState('');
  const [optionsText, setOptionsText] = useState('');
  const [stakeholders, setStakeholders] = useState([
    { name: '', group: '', vulnerability: '' },
  ]);
  const [impacts, setImpacts] = useState<Record<string, Record<string, string>>>({});
  const [records, setRecords] = useState<SmapRecord[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState('');

  const optionList = optionsText.split(',').map((s) => s.trim()).filter(Boolean);

  const load = useCallback(async () => {
    setLoading(true); setLoadErr('');
    const r = await lensRun('ethics', 'listStakeholderMaps', {});
    setLoading(false);
    if (!r.data.ok) { setLoadErr(r.data.error || 'request failed'); return; }
    setRecords(r.data.result?.maps || []);
  }, []);
  useEffect(() => { load(); }, [load]);

  const setSh = (i: number, field: string, val: string) => {
    setStakeholders((prev) => prev.map((s, idx) => (idx === i ? { ...s, [field]: val } : s)));
  };
  const setImpact = (shIdx: number, opt: string, val: string) => {
    setImpacts((prev) => ({ ...prev, [shIdx]: { ...(prev[shIdx] || {}), [opt]: val } }));
  };

  const run = async () => {
    setErr('');
    if (optionList.length === 0) { setErr('Add comma-separated options.'); return; }
    const payloadSh = stakeholders
      .filter((s) => s.name.trim())
      .map((s, i) => {
        const imp: Record<string, number> = {};
        for (const opt of optionList) {
          const v = impacts[i]?.[opt];
          if (v !== undefined && v !== '') imp[opt] = Number(v);
        }
        return {
          name: s.name.trim(),
          group: s.group.trim() || 'ungrouped',
          vulnerability: s.vulnerability !== '' ? Number(s.vulnerability) : 0,
          impacts: imp,
        };
      });
    if (payloadSh.length === 0) { setErr('Add at least one named stakeholder.'); return; }
    setBusy(true);
    const r = await lensRun('ethics', 'stakeholderMap', {
      title: title.trim() || 'Untitled map',
      options: optionList,
      stakeholders: payloadSh,
    });
    setBusy(false);
    if (!r.data.ok) { setErr(r.data.error || 'Map failed.'); return; }
    setTitle(''); setOptionsText('');
    setStakeholders([{ name: '', group: '', vulnerability: '' }]);
    setImpacts({});
    load();
  };

  return (
    <div className="space-y-4">
      <div className={SECTION}>
        <h4 className={ds.heading3}>Map affected parties per option</h4>
        <div className="grid grid-cols-2 gap-2">
          <input className={ds.input} placeholder="Map title" value={title} onChange={(e) => setTitle(e.target.value)} />
          <input
            className={ds.input}
            placeholder="Options (comma-separated)"
            value={optionsText}
            onChange={(e) => setOptionsText(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          {stakeholders.map((s, i) => (
            <div key={i} className="space-y-1">
              <div className="grid grid-cols-12 gap-2">
                <input className={cn(ds.input, 'col-span-4')} placeholder="Stakeholder name"
                  value={s.name} onChange={(e) => setSh(i, 'name', e.target.value)} />
                <input className={cn(ds.input, 'col-span-4')} placeholder="Group"
                  value={s.group} onChange={(e) => setSh(i, 'group', e.target.value)} />
                <input type="number" className={cn(ds.input, 'col-span-4')} placeholder="Vulnerability 0-100"
                  value={s.vulnerability} onChange={(e) => setSh(i, 'vulnerability', e.target.value)} />
              </div>
              {optionList.length > 0 && (
                <div className="flex flex-wrap gap-2 pl-2">
                  {optionList.map((opt) => (
                    <div key={opt} className="flex items-center gap-1">
                      <span className="text-xs text-gray-400">{opt}:</span>
                      <input
                        type="number" className={cn(ds.input, 'w-24 py-1 text-xs')}
                        placeholder="-100..100"
                        value={impacts[i]?.[opt] ?? ''}
                        onChange={(e) => setImpact(i, opt, e.target.value)}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button className={ds.btnSecondary}
            onClick={() => setStakeholders((p) => [...p, { name: '', group: '', vulnerability: '' }])}>
            <Plus className="w-4 h-4" /> Add Stakeholder
          </button>
          <button className={ds.btnPrimary} onClick={run} disabled={busy}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Users className="w-4 h-4" />}
            Build Map
          </button>
        </div>
        {err && <div className={errBox}>{err}</div>}
      </div>

      <LoadGate
        loading={loading} error={loadErr} onRetry={load}
        isEmpty={records.length === 0} emptyLabel="stakeholder maps"
      >
      {records.map((rec) => (
        <div key={rec.id} className={SECTION}>
          <div className="flex items-start justify-between gap-3">
            <p className="text-white font-medium">{rec.title}</p>
            <span className="text-xs text-neon-cyan">Best: {rec.bestOption}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-400 border-b border-lattice-border">
                  <th className="py-1 pr-3">Stakeholder</th>
                  <th className="py-1 pr-3">Vuln.</th>
                  {rec.options.map((o) => <th key={o} className="py-1 pr-3">{o}</th>)}
                  <th className="py-1">Net</th>
                </tr>
              </thead>
              <tbody>
                {rec.stakeholders.map((s) => (
                  <tr key={s.name} className="border-b border-lattice-border/50">
                    <td className="py-1 pr-3 text-gray-300">
                      {s.name} <span className="text-gray-600">({s.group})</span>
                    </td>
                    <td className="py-1 pr-3 text-gray-400">{s.vulnerability}</td>
                    {rec.options.map((o) => (
                      <td key={o} className={cn('py-1 pr-3', impactColor(s.impacts[o]?.weighted ?? 0))}>
                        {s.impacts[o]?.weighted ?? 0}
                      </td>
                    ))}
                    <td className={cn('py-1', impactColor(s.netExposure))}>{s.netExposure}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {rec.optionTotals.map((ot) => (
              <div key={ot.option} className="rounded-lg border border-lattice-border p-2">
                <p className="text-xs text-gray-400">{ot.option}</p>
                <p className={cn('text-lg font-bold', impactColor(ot.netImpact))}>{ot.netImpact}</p>
                <p className="text-xs text-gray-400">
                  +{ot.benefited} / -{ot.harmed}
                  {ot.vulnerableHarmed > 0 && (
                    <span className="text-red-400"> · {ot.vulnerableHarmed} vuln. harmed</span>
                  )}
                </p>
              </div>
            ))}
          </div>
        </div>
      ))}
      </LoadGate>
    </div>
  );
}

/* ───────────────────────── Decision Matrix ───────────────────────── */

function DecisionMatrixPanel() {
  const [title, setTitle] = useState('');
  const [criteria, setCriteria] = useState([
    { name: '', weight: '1' },
    { name: '', weight: '1' },
  ]);
  const [options, setOptions] = useState<{ name: string; scores: Record<string, string> }[]>([
    { name: '', scores: {} },
  ]);
  const [records, setRecords] = useState<MtxRecord[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState('');

  const criteriaNames = criteria.map((c) => c.name.trim()).filter(Boolean);

  const load = useCallback(async () => {
    setLoading(true); setLoadErr('');
    const r = await lensRun('ethics', 'listDecisionMatrices', {});
    setLoading(false);
    if (!r.data.ok) { setLoadErr(r.data.error || 'request failed'); return; }
    setRecords(r.data.result?.matrices || []);
  }, []);
  useEffect(() => { load(); }, [load]);

  const setCrit = (i: number, field: string, val: string) => {
    setCriteria((prev) => prev.map((c, idx) => (idx === i ? { ...c, [field]: val } : c)));
  };
  const setOptName = (i: number, val: string) => {
    setOptions((prev) => prev.map((o, idx) => (idx === i ? { ...o, name: val } : o)));
  };
  const setOptScore = (i: number, crit: string, val: string) => {
    setOptions((prev) => prev.map((o, idx) =>
      idx === i ? { ...o, scores: { ...o.scores, [crit]: val } } : o));
  };

  const run = async () => {
    setErr('');
    const critPayload = criteria
      .filter((c) => c.name.trim())
      .map((c) => ({ name: c.name.trim(), weight: Number(c.weight) || 0 }));
    if (critPayload.length === 0) { setErr('Add at least one criterion.'); return; }
    const optPayload = options
      .filter((o) => o.name.trim())
      .map((o) => {
        const scores: Record<string, number> = {};
        for (const c of critPayload) scores[c.name] = Number(o.scores[c.name]) || 0;
        return { name: o.name.trim(), scores };
      });
    if (optPayload.length === 0) { setErr('Add at least one option.'); return; }
    setBusy(true);
    const r = await lensRun('ethics', 'decisionMatrix', {
      title: title.trim() || 'Untitled matrix',
      criteria: critPayload,
      options: optPayload,
    });
    setBusy(false);
    if (!r.data.ok) { setErr(r.data.error || 'Matrix failed.'); return; }
    setTitle('');
    setCriteria([{ name: '', weight: '1' }, { name: '', weight: '1' }]);
    setOptions([{ name: '', scores: {} }]);
    load();
  };

  return (
    <div className="space-y-4">
      <div className={SECTION}>
        <h4 className={ds.heading3}>Score options against weighted ethical criteria</h4>
        <input className={ds.input} placeholder="Matrix title" value={title} onChange={(e) => setTitle(e.target.value)} />
        <div className="space-y-2">
          <p className={ds.textMuted}>Criteria (0-1 weight)</p>
          {criteria.map((c, i) => (
            <div key={i} className="grid grid-cols-12 gap-2">
              <input className={cn(ds.input, 'col-span-8')} placeholder="Criterion name"
                value={c.name} onChange={(e) => setCrit(i, 'name', e.target.value)} />
              <input type="number" step="0.1" className={cn(ds.input, 'col-span-4')} placeholder="Weight"
                value={c.weight} onChange={(e) => setCrit(i, 'weight', e.target.value)} />
            </div>
          ))}
          <button className={ds.btnSecondary}
            onClick={() => setCriteria((p) => [...p, { name: '', weight: '1' }])}>
            <Plus className="w-4 h-4" /> Criterion
          </button>
        </div>
        <div className="space-y-2">
          <p className={ds.textMuted}>Options (score each criterion 0-10)</p>
          {options.map((o, i) => (
            <div key={i} className="space-y-1">
              <input className={ds.input} placeholder={`Option ${i + 1} name`}
                value={o.name} onChange={(e) => setOptName(i, e.target.value)} />
              {criteriaNames.length > 0 && (
                <div className="flex flex-wrap gap-2 pl-2">
                  {criteriaNames.map((c) => (
                    <div key={c} className="flex items-center gap-1">
                      <span className="text-xs text-gray-400">{c}:</span>
                      <input type="number" className={cn(ds.input, 'w-20 py-1 text-xs')} placeholder="0-10"
                        value={o.scores[c] ?? ''} onChange={(e) => setOptScore(i, c, e.target.value)} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
          <button className={ds.btnSecondary}
            onClick={() => setOptions((p) => [...p, { name: '', scores: {} }])}>
            <Plus className="w-4 h-4" /> Option
          </button>
        </div>
        <button className={ds.btnPrimary} onClick={run} disabled={busy}>
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Grid3x3 className="w-4 h-4" />}
          Score Matrix
        </button>
        {err && <div className={errBox}>{err}</div>}
      </div>

      <LoadGate
        loading={loading} error={loadErr} onRetry={load}
        isEmpty={records.length === 0} emptyLabel="decision matrices"
      >
      {records.map((rec) => (
        <div key={rec.id} className={SECTION}>
          <div className="flex items-start justify-between gap-3">
            <p className="text-white font-medium">{rec.title}</p>
            <span className="text-xs text-neon-cyan">Winner: {rec.winner}</span>
          </div>
          <ChartKit
            kind="bar"
            xKey="name"
            height={180}
            data={rec.options.map((o) => ({ name: o.name, Score: o.percent }))}
            series={[{ key: 'Score', color: '#a855f7' }]}
          />
          <div className="space-y-2">
            {rec.options.map((o) => (
              <div key={o.name} className="rounded-lg border border-lattice-border p-2">
                <div className="flex items-center justify-between">
                  <span className="text-gray-200 text-sm font-medium">{o.name}</span>
                  <span className="text-neon-cyan text-sm">{o.percent}%</span>
                </div>
                <div className="flex flex-wrap gap-2 mt-1">
                  {o.breakdown.map((b) => (
                    <span key={b.criterion} className="text-xs text-gray-400">
                      {b.criterion}: {b.raw} → {b.weighted}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
      </LoadGate>
    </div>
  );
}

/* ───────────────────────── Bias Checklist ───────────────────────── */

function BiasChecklistPanel() {
  const [decision, setDecision] = useState('');
  const [template, setTemplate] = useState<{ key: string; label: string; prompt: string }[]>([]);
  const [responses, setResponses] = useState<Record<string, { flagged: boolean; note: string }>>({});
  const [records, setRecords] = useState<BiasRecord[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setLoadErr('');
    const [tpl, list] = await Promise.all([
      lensRun('ethics', 'biasChecklistTemplate', {}),
      lensRun('ethics', 'listBiasChecklists', {}),
    ]);
    setLoading(false);
    if (!tpl.data.ok) { setLoadErr(tpl.data.error || 'request failed'); return; }
    if (!list.data.ok) { setLoadErr(list.data.error || 'request failed'); return; }
    setTemplate(tpl.data.result?.items || []);
    setRecords(list.data.result?.checklists || []);
  }, []);
  useEffect(() => { load(); }, [load]);

  const toggleFlag = (key: string) => {
    setResponses((prev) => ({
      ...prev,
      [key]: { flagged: !prev[key]?.flagged, note: prev[key]?.note || '' },
    }));
  };
  const setNote = (key: string, note: string) => {
    setResponses((prev) => ({
      ...prev,
      [key]: { flagged: prev[key]?.flagged || false, note },
    }));
  };

  const run = async () => {
    setErr('');
    if (!decision.trim()) { setErr('Decision text required.'); return; }
    setBusy(true);
    const r = await lensRun('ethics', 'biasChecklist', { decision, responses });
    setBusy(false);
    if (!r.data.ok) { setErr(r.data.error || 'Checklist failed.'); return; }
    setDecision(''); setResponses({});
    load();
  };

  return (
    <div className="space-y-4">
      <div className={SECTION}>
        <h4 className={ds.heading3}>Cognitive-bias review of a decision</h4>
        <textarea className={ds.textarea} rows={2} placeholder="Describe the decision under review..."
          value={decision} onChange={(e) => setDecision(e.target.value)} />
        <div className="space-y-2">
          {template.map((b) => {
            const r = responses[b.key] || { flagged: false, note: '' };
            return (
              <div key={b.key} className={cn(
                'rounded-lg border p-2 transition-colors',
                r.flagged ? 'border-red-500/40 bg-red-500/5' : 'border-lattice-border',
              )}>
                <label className="flex items-start gap-2 cursor-pointer">
                  <input type="checkbox" checked={r.flagged} onChange={() => toggleFlag(b.key)}
                    className="mt-1 accent-red-500" />
                  <div className="flex-1">
                    <p className="text-sm text-gray-200 font-medium">{b.label}</p>
                    <p className="text-xs text-gray-400">{b.prompt}</p>
                  </div>
                </label>
                {r.flagged && (
                  <input className={cn(ds.input, 'mt-2 text-xs')} placeholder="Note (optional)"
                    value={r.note} onChange={(e) => setNote(b.key, e.target.value)} />
                )}
              </div>
            );
          })}
        </div>
        <button className={ds.btnPrimary} onClick={run} disabled={busy}>
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ListChecks className="w-4 h-4" />}
          Record Review
        </button>
        {err && <div className={errBox}>{err}</div>}
      </div>

      <LoadGate
        loading={loading} error={loadErr} onRetry={load}
        isEmpty={records.length === 0} emptyLabel="bias checklists"
      >
      {records.map((rec) => (
        <div key={rec.id} className={SECTION}>
          <div className="flex items-start justify-between gap-3">
            <p className="text-white font-medium">{rec.decision}</p>
            <span className={cn('text-sm font-bold', riskColor(rec.riskLevel))}>
              {rec.riskLevel} ({rec.riskScore}%)
            </span>
          </div>
          <p className={ds.textMuted}>
            {rec.flaggedCount} of {rec.totalCount} biases flagged
          </p>
          <div className="flex flex-wrap gap-1">
            {rec.items.filter((i) => i.flagged).map((i) => (
              <span key={i.key} className="text-xs px-2 py-0.5 rounded-full bg-red-500/20 text-red-400">
                {i.label}{i.note ? ` — ${i.note}` : ''}
              </span>
            ))}
            {rec.flaggedCount === 0 && <span className="text-xs text-green-400">No biases flagged</span>}
          </div>
        </div>
      ))}
      </LoadGate>
    </div>
  );
}

/* ───────────────────────── Ethics Review Workflow ───────────────────────── */

function ReviewWorkflowPanel() {
  const [title, setTitle] = useState('');
  const [dilemma, setDilemma] = useState('');
  const [records, setRecords] = useState<ReviewRecord[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setLoadErr('');
    const r = await lensRun('ethics', 'listReviews', {});
    setLoading(false);
    if (!r.data.ok) { setLoadErr(r.data.error || 'request failed'); return; }
    setRecords(r.data.result?.reviews || []);
  }, []);
  useEffect(() => { load(); }, [load]);

  const submit = async () => {
    setErr('');
    if (!title.trim() || !dilemma.trim()) { setErr('Title and dilemma required.'); return; }
    setBusy(true);
    const r = await lensRun('ethics', 'submitReview', { title, dilemma });
    setBusy(false);
    if (!r.data.ok) { setErr(r.data.error || 'Submit failed.'); return; }
    setTitle(''); setDilemma('');
    load();
  };

  return (
    <div className="space-y-4">
      <div className={SECTION}>
        <h4 className={ds.heading3}>Submit a dilemma for peer review</h4>
        <input className={ds.input} placeholder="Review title" value={title} onChange={(e) => setTitle(e.target.value)} />
        <textarea className={ds.textarea} rows={2} placeholder="The dilemma to deliberate..."
          value={dilemma} onChange={(e) => setDilemma(e.target.value)} />
        <button className={ds.btnPrimary} onClick={submit} disabled={busy}>
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <MessagesSquare className="w-4 h-4" />}
          Submit for Review
        </button>
        {err && <div className={errBox}>{err}</div>}
      </div>

      <LoadGate
        loading={loading} error={loadErr} onRetry={load}
        isEmpty={records.length === 0} emptyLabel="ethics reviews"
      >
      {records.map((rec) => (
        <ReviewCard key={rec.id} review={rec} onChange={load} />
      ))}
      </LoadGate>
    </div>
  );
}

function ReviewCard({ review, onChange }: { review: ReviewRecord; onChange: () => void }) {
  const [stance, setStance] = useState<'approve' | 'reject' | 'abstain' | 'amend'>('approve');
  const [rationale, setRationale] = useState('');
  const [verdictText, setVerdictText] = useState('');
  const [verdictRationale, setVerdictRationale] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const statusColor = review.status === 'decided' ? 'text-green-400'
    : review.status === 'deliberating' ? 'text-yellow-400' : 'text-gray-400';

  const addOpinion = async () => {
    setErr('');
    if (!rationale.trim()) { setErr('Rationale required.'); return; }
    setBusy(true);
    const r = await lensRun('ethics', 'addReviewOpinion', { reviewId: review.id, stance, rationale });
    setBusy(false);
    if (!r.data.ok) { setErr(r.data.error || 'Failed.'); return; }
    setRationale('');
    onChange();
  };

  const finalize = async () => {
    setErr('');
    if (!verdictText.trim()) { setErr('Verdict decision required.'); return; }
    setBusy(true);
    const r = await lensRun('ethics', 'recordVerdict', {
      reviewId: review.id, decision: verdictText, rationale: verdictRationale,
    });
    setBusy(false);
    if (!r.data.ok) { setErr(r.data.error || 'Failed.'); return; }
    setVerdictText(''); setVerdictRationale('');
    onChange();
  };

  return (
    <div className={SECTION}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-white font-medium">{review.title}</p>
          <p className={ds.textMuted}>{review.dilemma}</p>
        </div>
        <span className={cn('text-xs font-medium', statusColor)}>{review.status}</span>
      </div>

      {review.opinions.length > 0 && (
        <div className="space-y-1">
          {review.opinions.map((o) => (
            <div key={o.id} className="flex items-start gap-2 text-sm">
              <span className={cn(
                'text-xs px-1.5 py-0.5 rounded',
                o.stance === 'approve' ? 'bg-green-500/20 text-green-400'
                  : o.stance === 'reject' ? 'bg-red-500/20 text-red-400'
                  : o.stance === 'amend' ? 'bg-yellow-500/20 text-yellow-400'
                  : 'bg-gray-500/20 text-gray-400',
              )}>
                {o.stance}
              </span>
              <span className="text-gray-400">{o.rationale}</span>
            </div>
          ))}
        </div>
      )}

      {review.verdict ? (
        <div className="rounded-lg border border-green-500/30 bg-green-500/5 p-2">
          <p className="text-sm text-green-400 font-medium flex items-center gap-1">
            <Gavel className="w-4 h-4" /> Verdict: {review.verdict.decision}
          </p>
          {review.verdict.rationale && <p className="text-xs text-gray-400 mt-1">{review.verdict.rationale}</p>}
          <p className="text-xs text-gray-400 mt-1">
            Tally — approve {review.verdict.tally.approve || 0} ·
            reject {review.verdict.tally.reject || 0} ·
            amend {review.verdict.tally.amend || 0} ·
            abstain {review.verdict.tally.abstain || 0}
          </p>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-2 items-center">
            <select className={cn(ds.select, 'w-auto')} value={stance}
              onChange={(e) => setStance(e.target.value as typeof stance)}>
              <option value="approve">Approve</option>
              <option value="reject">Reject</option>
              <option value="amend">Amend</option>
              <option value="abstain">Abstain</option>
            </select>
            <input className={cn(ds.input, 'flex-1 min-w-[160px]')} placeholder="Rationale"
              value={rationale} onChange={(e) => setRationale(e.target.value)} />
            <button className={ds.btnSecondary} onClick={addOpinion} disabled={busy}>
              {stance === 'approve' ? <ThumbsUp className="w-4 h-4" /> : <ThumbsDown className="w-4 h-4" />}
              Add Opinion
            </button>
          </div>
          <div className="flex flex-wrap gap-2 items-center border-t border-lattice-border pt-2">
            <input className={cn(ds.input, 'flex-1 min-w-[140px]')} placeholder="Final verdict decision"
              value={verdictText} onChange={(e) => setVerdictText(e.target.value)} />
            <input className={cn(ds.input, 'flex-1 min-w-[140px]')} placeholder="Verdict rationale"
              value={verdictRationale} onChange={(e) => setVerdictRationale(e.target.value)} />
            <button className={ds.btnPrimary} onClick={finalize} disabled={busy}>
              <Gavel className="w-4 h-4" /> Record Verdict
            </button>
          </div>
        </>
      )}
      {err && <div className={errBox}>{err}</div>}
    </div>
  );
}

/* ───────────────────────── Case Library ───────────────────────── */

function CaseLibraryPanel() {
  const [query, setQuery] = useState('');
  const [tagFilter, setTagFilter] = useState('');
  const [cases, setCases] = useState<CaseRecord[]>([]);
  const [allTags, setAllTags] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState('');

  const [cTitle, setCTitle] = useState('');
  const [cDilemma, setCDilemma] = useState('');
  const [cReasoning, setCReasoning] = useState('');
  const [cResolution, setCResolution] = useState('');
  const [cFramework, setCFramework] = useState('');
  const [cTags, setCTags] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setLoadErr('');
    const r = await lensRun('ethics', 'searchCases', {
      query: query.trim(),
      tag: tagFilter.trim(),
    });
    setLoading(false);
    if (!r.data.ok) { setLoadErr(r.data.error || 'request failed'); return; }
    setCases(r.data.result?.cases || []);
    setAllTags(r.data.result?.allTags || []);
  }, [query, tagFilter]);
  useEffect(() => { load(); }, [load]);

  const archive = async () => {
    setErr('');
    if (!cTitle.trim() || !cDilemma.trim() || !cResolution.trim()) {
      setErr('Title, dilemma, and resolution required.'); return;
    }
    const r = await lensRun('ethics', 'archiveCase', {
      title: cTitle, dilemma: cDilemma, reasoning: cReasoning,
      resolution: cResolution, framework: cFramework,
      tags: cTags.split(',').map((t) => t.trim()).filter(Boolean),
    });
    if (!r.data.ok) { setErr(r.data.error || 'Archive failed.'); return; }
    setCTitle(''); setCDilemma(''); setCReasoning('');
    setCResolution(''); setCFramework(''); setCTags('');
    setCreating(false);
    load();
  };

  const del = async (id: string) => {
    const r = await lensRun('ethics', 'deleteCase', { caseId: id });
    if (r.data.ok) load();
  };

  return (
    <div className="space-y-4">
      <div className={SECTION}>
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input className={cn(ds.input, 'pl-10')} placeholder="Search resolved cases..."
              value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <select className={cn(ds.select, 'w-auto')} value={tagFilter}
            onChange={(e) => setTagFilter(e.target.value)}>
            <option value="">All tags</option>
            {allTags.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <button className={ds.btnPrimary} onClick={() => setCreating(true)}>
            <Plus className="w-4 h-4" /> Archive Case
          </button>
        </div>
      </div>

      {creating && (
        <div className={SECTION}>
          <div className="flex items-center justify-between">
            <h4 className={ds.heading3}>Archive a resolved dilemma</h4>
            <button onClick={() => setCreating(false)} className={ds.btnGhost} aria-label="Close">
              <X className="w-4 h-4" />
            </button>
          </div>
          <input className={ds.input} placeholder="Case title" value={cTitle} onChange={(e) => setCTitle(e.target.value)} />
          <textarea className={ds.textarea} rows={2} placeholder="The dilemma"
            value={cDilemma} onChange={(e) => setCDilemma(e.target.value)} />
          <textarea className={ds.textarea} rows={2} placeholder="Reasoning applied"
            value={cReasoning} onChange={(e) => setCReasoning(e.target.value)} />
          <textarea className={ds.textarea} rows={2} placeholder="Resolution reached"
            value={cResolution} onChange={(e) => setCResolution(e.target.value)} />
          <div className="grid grid-cols-2 gap-2">
            <input className={ds.input} placeholder="Framework used"
              value={cFramework} onChange={(e) => setCFramework(e.target.value)} />
            <input className={ds.input} placeholder="Tags (comma-separated)"
              value={cTags} onChange={(e) => setCTags(e.target.value)} />
          </div>
          <button className={ds.btnPrimary} onClick={archive}>
            <Archive className="w-4 h-4" /> Save to Library
          </button>
          {err && <div className={errBox}>{err}</div>}
        </div>
      )}

      <LoadGate
        loading={loading} error={loadErr} onRetry={load}
        isEmpty={cases.length === 0} emptyLabel="archived cases"
      >
      {cases.map((c) => (
        <div key={c.id} className={SECTION}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-white font-medium">{c.title}</p>
              {c.framework && <p className="text-xs text-neon-cyan">{c.framework}</p>}
            </div>
            <button onClick={() => del(c.id)} className={ds.btnGhost} aria-label="Delete case">
              <Trash2 className="w-4 h-4 text-red-400" />
            </button>
          </div>
          <p className={ds.textMuted}><span className="text-gray-400">Dilemma:</span> {c.dilemma}</p>
          {c.reasoning && (
            <p className={ds.textMuted}><span className="text-gray-400">Reasoning:</span> {c.reasoning}</p>
          )}
          <p className="text-sm text-green-400">
            <span className="text-gray-400">Resolution:</span> {c.resolution}
          </p>
          {c.tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {c.tags.map((t) => (
                <span key={t} className="text-xs px-2 py-0.5 rounded-full bg-neon-purple/20 text-neon-purple">
                  {t}
                </span>
              ))}
            </div>
          )}
        </div>
      ))}
      </LoadGate>
    </div>
  );
}

/* ───────────────────────── Framework Analysis ───────────────────────── */

interface FaFrameworkDetail {
  name: string;
  score: number;
  assessment: string;
  details: Record<string, unknown>;
}
interface FrameworkAnalysisResult {
  frameworks: Record<string, FaFrameworkDetail>;
  overallScore: number;
  consensus: string;
  tensions: string[];
  recommendation: string;
}

function scoreBadgeColor(score: number): string {
  return score >= 50 ? 'text-green-400' : score >= 20 ? 'text-yellow-400' : 'text-red-400';
}

function FrameworkAnalysisPanel() {
  const [description, setDescription] = useState('');
  const [principlesText, setPrinciplesText] = useState('');
  const [consequences, setConsequences] = useState([
    { description: '', impact: '', affectedCount: '', probability: '' },
  ]);
  const [stakeholders, setStakeholders] = useState([
    { name: '', description: '', vulnerable: false, impact: '' },
  ]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [result, setResult] = useState<FrameworkAnalysisResult | null>(null);

  const setCons = (i: number, field: string, val: string) => {
    setConsequences((prev) => prev.map((c, idx) => (idx === i ? { ...c, [field]: val } : c)));
  };
  const setSh = (i: number, field: string, val: string | boolean) => {
    setStakeholders((prev) => prev.map((s, idx) => (idx === i ? { ...s, [field]: val } : s)));
  };

  const run = async () => {
    setErr('');
    if (!description.trim()) { setErr('Action description required.'); return; }
    const action = {
      description: description.trim(),
      principles: principlesText.split(',').map((p) => p.trim()).filter(Boolean),
      consequences: consequences
        .filter((c) => c.description.trim())
        .map((c) => ({
          description: c.description.trim(),
          impact: c.impact !== '' ? Number(c.impact) : 0,
          affectedCount: c.affectedCount !== '' ? Number(c.affectedCount) : 1,
          probability: c.probability !== '' ? Number(c.probability) : 1,
        })),
      stakeholders: stakeholders
        .filter((s) => s.name.trim())
        .map((s) => ({
          name: s.name.trim(),
          description: s.description.trim(),
          vulnerable: s.vulnerable,
          impact: s.impact !== '' ? Number(s.impact) : 0,
        })),
    };
    setBusy(true);
    const r = await lensRun('ethics', 'frameworkAnalysis', { action });
    setBusy(false);
    if (!r.data.ok) { setErr(r.data.error || 'Analysis failed.'); return; }
    setResult(r.data.result);
  };

  return (
    <div className="space-y-4">
      <div className={SECTION}>
        <h4 className={ds.heading3}>Evaluate one action across four ethical frameworks</h4>
        <p className="text-xs text-gray-500">
          Utilitarian, Kantian deontological, virtue ethics, and care ethics — run
          side by side against the same action, surfacing where they agree and
          where they pull in different directions.
        </p>
        <textarea
          className={ds.textarea}
          rows={2}
          placeholder="Describe the action or decision under evaluation..."
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <input
          className={ds.input}
          placeholder="Principles at stake (comma-separated, e.g. consent, transparency)"
          value={principlesText}
          onChange={(e) => setPrinciplesText(e.target.value)}
        />

        <div className="space-y-2">
          <p className={ds.textMuted}>Consequences</p>
          {consequences.map((c, i) => (
            <div key={i} className="grid grid-cols-12 gap-2 items-center">
              <input className={cn(ds.input, 'col-span-5')} placeholder="What happens"
                value={c.description} onChange={(e) => setCons(i, 'description', e.target.value)} />
              <input type="number" className={cn(ds.input, 'col-span-2')} placeholder="Impact -100..100"
                value={c.impact} onChange={(e) => setCons(i, 'impact', e.target.value)} />
              <input type="number" className={cn(ds.input, 'col-span-2')} placeholder="# affected"
                value={c.affectedCount} onChange={(e) => setCons(i, 'affectedCount', e.target.value)} />
              <input type="number" step="0.1" className={cn(ds.input, 'col-span-2')} placeholder="Prob. 0-1"
                value={c.probability} onChange={(e) => setCons(i, 'probability', e.target.value)} />
              <button className={ds.btnGhost} aria-label="Remove consequence"
                onClick={() => setConsequences((p) => p.filter((_, idx) => idx !== i))}>
                <Trash2 className="w-4 h-4 text-red-400" />
              </button>
            </div>
          ))}
          <button className={ds.btnSecondary}
            onClick={() => setConsequences((p) => [...p, { description: '', impact: '', affectedCount: '', probability: '' }])}>
            <Plus className="w-4 h-4" /> Consequence
          </button>
        </div>

        <div className="space-y-2">
          <p className={ds.textMuted}>Stakeholders</p>
          {stakeholders.map((s, i) => (
            <div key={i} className="grid grid-cols-12 gap-2 items-center">
              <input className={cn(ds.input, 'col-span-3')} placeholder="Name"
                value={s.name} onChange={(e) => setSh(i, 'name', e.target.value)} />
              <input className={cn(ds.input, 'col-span-4')} placeholder="Description"
                value={s.description} onChange={(e) => setSh(i, 'description', e.target.value)} />
              <label className="col-span-2 flex items-center gap-1 text-xs text-gray-400">
                <input type="checkbox" checked={s.vulnerable}
                  onChange={(e) => setSh(i, 'vulnerable', e.target.checked)} />
                Vulnerable
              </label>
              <input type="number" className={cn(ds.input, 'col-span-2')} placeholder="Impact -100..100"
                value={s.impact} onChange={(e) => setSh(i, 'impact', e.target.value)} />
              <button className={ds.btnGhost} aria-label="Remove stakeholder"
                onClick={() => setStakeholders((p) => p.filter((_, idx) => idx !== i))}>
                <Trash2 className="w-4 h-4 text-red-400" />
              </button>
            </div>
          ))}
          <button className={ds.btnSecondary}
            onClick={() => setStakeholders((p) => [...p, { name: '', description: '', vulnerable: false, impact: '' }])}>
            <Plus className="w-4 h-4" /> Stakeholder
          </button>
        </div>

        <button className={ds.btnPrimary} onClick={run} disabled={busy}>
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Brain className="w-4 h-4" />}
          Run Framework Analysis
        </button>
        {err && <div className={errBox}>{err}</div>}
      </div>

      {result && (
        <div className={SECTION}>
          <div className="flex items-start justify-between gap-3">
            <p className="text-white font-medium">
              Overall: <span className={scoreBadgeColor(result.overallScore)}>{result.overallScore}</span>
              <span className="text-gray-500"> / 100</span>
            </p>
            <span className="text-xs text-gray-400">{result.consensus.replace(/-/g, ' ')}</span>
          </div>
          <ChartKit
            kind="bar"
            xKey="name"
            height={180}
            data={Object.values(result.frameworks).map((f) => ({ name: f.name, Score: f.score }))}
            series={[{ key: 'Score', color: '#a855f7' }]}
          />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {Object.entries(result.frameworks).map(([key, f]) => (
              <div key={key} className="rounded-lg border border-lattice-border p-2 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-gray-200 text-sm font-medium">{f.name}</span>
                  <span className={cn('text-sm font-bold', scoreBadgeColor(f.score))}>{f.score}</span>
                </div>
                <p className="text-xs text-gray-400">{f.assessment.replace(/-/g, ' ')}</p>
                <div className="flex flex-wrap gap-1">
                  {Object.entries(f.details)
                    .filter(([, dv]) => typeof dv !== 'object' || dv === null)
                    .map(([dk, dv]) => (
                      <span key={dk} className="text-[10px] px-1.5 py-0.5 rounded bg-lattice-elevated text-gray-400">
                        {dk}: {String(dv)}
                      </span>
                    ))}
                </div>
                {key === 'virtue' && !!f.details.virtueScores && typeof f.details.virtueScores === 'object' && (
                  <div className="flex flex-wrap gap-1">
                    {Object.entries(f.details.virtueScores as Record<string, number>)
                      .filter(([, v]) => v > 0)
                      .map(([vk, vv]) => (
                        <span key={vk} className="text-[10px] px-1.5 py-0.5 rounded bg-neon-purple/10 text-neon-purple">
                          {vk}: {vv}
                        </span>
                      ))}
                  </div>
                )}
              </div>
            ))}
          </div>
          {result.tensions.length > 0 && (
            <div className="space-y-1">
              <p className={ds.textMuted}>Tensions</p>
              {result.tensions.map((t, i) => (
                <p key={i} className="text-xs text-yellow-400">⚠ {t}</p>
              ))}
            </div>
          )}
          <p className="text-sm text-neon-cyan">{result.recommendation}</p>
        </div>
      )}
    </div>
  );
}

/* ───────────────────────── Stakeholder Impact ───────────────────────── */

interface SiStakeholder {
  name: string;
  group?: string;
  power: number;
  interest: number;
  impact: number;
  vulnerability: number;
  urgency: number;
  legitimacy: number;
  salience: number;
  quadrant: string;
  weightedImpact: number;
  priority: string;
}
interface SiGroup {
  members: number;
  avgImpact: number;
  avgVulnerability: number;
  netSentiment: string;
}
interface StakeholderImpactResult {
  message?: string;
  stakeholders: SiStakeholder[];
  groups: Record<string, SiGroup>;
  summary: {
    total: number;
    positivelyAffected: number;
    negativelyAffected: number;
    vulnerableHarmed: number;
    highPriority: number;
  };
  equityScore: number;
  equityAssessment: string;
  quadrantDistribution: Record<string, number>;
}

function StakeholderImpactPanel() {
  const [rows, setRows] = useState([
    { name: '', group: '', power: '', interest: '', impact: '', vulnerability: '' },
  ]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [result, setResult] = useState<StakeholderImpactResult | null>(null);

  const setRow = (i: number, field: string, val: string) => {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, [field]: val } : r)));
  };

  const run = async () => {
    setErr('');
    const payload = rows
      .filter((r) => r.name.trim())
      .map((r) => ({
        name: r.name.trim(),
        group: r.group.trim() || undefined,
        power: r.power !== '' ? Number(r.power) : 50,
        interest: r.interest !== '' ? Number(r.interest) : 50,
        impact: r.impact !== '' ? Number(r.impact) : 0,
        vulnerability: r.vulnerability !== '' ? Number(r.vulnerability) : 0,
      }));
    if (payload.length === 0) { setErr('Add at least one named stakeholder.'); return; }
    setBusy(true);
    const r = await lensRun('ethics', 'stakeholderImpact', { stakeholders: payload });
    setBusy(false);
    if (!r.data.ok) { setErr(r.data.error || 'Analysis failed.'); return; }
    setResult(r.data.result);
  };

  return (
    <div className="space-y-4">
      <div className={SECTION}>
        <h4 className={ds.heading3}>Power/interest salience &amp; equity analysis</h4>
        <p className="text-xs text-gray-500">
          Mitchell-Agle-Wood stakeholder salience: classifies each party into a
          power/interest quadrant, weights negative impact by vulnerability, and
          scores overall decision equity. Distinct from Stakeholder Map — this
          tool analyzes one decision's full stakeholder field, not per-option
          comparisons.
        </p>
        <div className="space-y-2">
          {rows.map((r, i) => (
            <div key={i} className="grid grid-cols-12 gap-2 items-center">
              <input className={cn(ds.input, 'col-span-3')} placeholder="Stakeholder name"
                value={r.name} onChange={(e) => setRow(i, 'name', e.target.value)} />
              <input className={cn(ds.input, 'col-span-2')} placeholder="Group"
                value={r.group} onChange={(e) => setRow(i, 'group', e.target.value)} />
              <input type="number" className={cn(ds.input, 'col-span-2')} placeholder="Power 0-100"
                value={r.power} onChange={(e) => setRow(i, 'power', e.target.value)} />
              <input type="number" className={cn(ds.input, 'col-span-2')} placeholder="Interest 0-100"
                value={r.interest} onChange={(e) => setRow(i, 'interest', e.target.value)} />
              <input type="number" className={cn(ds.input, 'col-span-2')} placeholder="Impact -100..100"
                value={r.impact} onChange={(e) => setRow(i, 'impact', e.target.value)} />
              <button className={ds.btnGhost} aria-label="Remove stakeholder"
                onClick={() => setRows((p) => p.filter((_, idx) => idx !== i))}>
                <Trash2 className="w-4 h-4 text-red-400" />
              </button>
              <input type="number" className={cn(ds.input, 'col-span-3')} placeholder="Vulnerability 0-100"
                value={r.vulnerability} onChange={(e) => setRow(i, 'vulnerability', e.target.value)} />
            </div>
          ))}
          <button className={ds.btnSecondary}
            onClick={() => setRows((p) => [...p, { name: '', group: '', power: '', interest: '', impact: '', vulnerability: '' }])}>
            <Plus className="w-4 h-4" /> Stakeholder
          </button>
        </div>
        <button className={ds.btnPrimary} onClick={run} disabled={busy}>
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Target className="w-4 h-4" />}
          Analyze Impact
        </button>
        {err && <div className={errBox}>{err}</div>}
      </div>

      {result && !result.message && (
        <div className={SECTION}>
          <div className="flex items-start justify-between gap-3">
            <p className="text-white font-medium">
              Equity: <span className={scoreBadgeColor(result.equityScore)}>{result.equityScore}</span>
              <span className="text-gray-500"> / 100 — {result.equityAssessment}</span>
            </p>
            <span className="text-xs text-gray-400">
              {result.summary.vulnerableHarmed} vulnerable harmed · {result.summary.highPriority} high priority
            </span>
          </div>
          <ChartKit
            kind="bar"
            xKey="quadrant"
            height={160}
            data={Object.entries(result.quadrantDistribution).map(([quadrant, count]) => ({ quadrant, Count: count }))}
            series={[{ key: 'Count', color: '#6366f1' }]}
          />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-400 border-b border-lattice-border">
                  <th className="py-1 pr-3">Stakeholder</th>
                  <th className="py-1 pr-3">Quadrant</th>
                  <th className="py-1 pr-3">Salience</th>
                  <th className="py-1 pr-3">Priority</th>
                  <th className="py-1">Weighted impact</th>
                </tr>
              </thead>
              <tbody>
                {result.stakeholders.map((s) => (
                  <tr key={s.name} className="border-b border-lattice-border/50">
                    <td className="py-1 pr-3 text-gray-300">
                      {s.name} {s.group && <span className="text-gray-600">({s.group})</span>}
                    </td>
                    <td className="py-1 pr-3 text-gray-400">{s.quadrant.replace(/-/g, ' ')}</td>
                    <td className="py-1 pr-3 text-gray-400">{s.salience}</td>
                    <td className={cn(
                      'py-1 pr-3',
                      s.priority === 'high' ? 'text-red-400' : s.priority === 'medium' ? 'text-yellow-400' : 'text-gray-400',
                    )}>
                      {s.priority}
                    </td>
                    <td className={cn('py-1', impactColor(s.weightedImpact))}>{s.weightedImpact}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {Object.keys(result.groups).length > 1 && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {Object.entries(result.groups).map(([name, g]) => (
                <div key={name} className="rounded-lg border border-lattice-border p-2">
                  <p className="text-xs text-gray-400">{name}</p>
                  <p className={cn('text-sm font-bold', impactColor(g.avgImpact))}>{g.avgImpact}</p>
                  <p className="text-xs text-gray-500">{g.netSentiment}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ───────────────────────── Bias Audit ───────────────────────── */

interface BiasGroupRow { group: string; total: number; positiveRate: number; }
interface BiasAttrResult {
  groups: BiasGroupRow[];
  disparateImpactRatio: number;
  fourFifthsRule: string;
  statisticalParityDifference: number;
  chiSquared: number;
  pValueApprox: number;
  biasDetected: boolean;
  severity: string;
  favoredGroup?: string;
  disadvantagedGroup?: string;
}
interface BiasDetectionResult {
  attributes: Record<string, BiasAttrResult>;
  totalDecisions: number;
  biasedAttributes: string[];
  overallAssessment: string;
  recommendations: string[];
}

function parseDecisionCsv(text: string):
  | { decisions: { id: string; outcome: string; attributes: Record<string, string> }[]; protectedAttributes: string[] }
  | { error: string } {
  const lines = text.trim().split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return { error: 'Paste a header row (must include "outcome") plus at least 10 data rows.' };
  const header = lines[0].split(',').map((h) => h.trim());
  const outcomeIdx = header.indexOf('outcome');
  if (outcomeIdx === -1) return { error: 'Header row must include an "outcome" column.' };
  const attrCols = header.filter((_, idx) => idx !== outcomeIdx);
  if (attrCols.length === 0) return { error: 'Header row needs at least one protected-attribute column besides "outcome".' };
  const dataLines = lines.slice(1);
  if (dataLines.length < 10) return { error: `Need at least 10 data rows (found ${dataLines.length}).` };
  const decisions = dataLines.map((line, i) => {
    const cells = line.split(',').map((c) => c.trim());
    const attributes: Record<string, string> = {};
    header.forEach((h, idx) => { if (idx !== outcomeIdx) attributes[h] = cells[idx] ?? ''; });
    return { id: `row_${i}`, outcome: cells[outcomeIdx] ?? '', attributes };
  });
  return { decisions, protectedAttributes: attrCols };
}

function BiasAuditPanel() {
  const [csv, setCsv] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [result, setResult] = useState<BiasDetectionResult | null>(null);

  const run = async () => {
    setErr('');
    const parsed = parseDecisionCsv(csv);
    if ('error' in parsed) { setErr(parsed.error); return; }
    setBusy(true);
    const r = await lensRun('ethics', 'biasDetection', {
      decisions: parsed.decisions,
      protectedAttributes: parsed.protectedAttributes,
    });
    setBusy(false);
    if (!r.data.ok) { setErr(r.data.error || 'Audit failed.'); return; }
    setResult(r.data.result);
  };

  return (
    <div className="space-y-4">
      <div className={SECTION}>
        <h4 className={ds.heading3}>Dataset-level disparate-impact audit</h4>
        <p className="text-xs text-gray-500">
          Paste a CSV of decisions — a header row starting with &quot;outcome&quot;,
          then one protected-attribute column per group you want to test
          (gender, race, age bracket, …), and at least 10 data rows. Computes
          the four-fifths rule, statistical parity difference, and a rough
          chi-squared significance per attribute. Distinct from Bias Checklist —
          this audits a dataset of past decisions for disparate impact, not a
          single decision for cognitive bias.
        </p>
        <textarea
          className={cn(ds.textarea, 'font-mono text-xs')}
          rows={8}
          placeholder={'outcome,gender,age_bracket\napproved,female,25-34\ndenied,female,25-34\napproved,male,35-44\n… (10+ rows)'}
          value={csv}
          onChange={(e) => setCsv(e.target.value)}
        />
        <button className={ds.btnPrimary} onClick={run} disabled={busy}>
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldAlert className="w-4 h-4" />}
          Run Bias Audit
        </button>
        {err && <div className={errBox}>{err}</div>}
      </div>

      {result && (
        <div className={SECTION}>
          <div className="flex items-start justify-between gap-3">
            <p className="text-white font-medium">
              {result.totalDecisions} decisions ·{' '}
              <span className={result.overallAssessment === 'no_significant_bias' ? 'text-green-400' : 'text-red-400'}>
                {result.overallAssessment.replace(/_/g, ' ')}
              </span>
            </p>
          </div>
          {Object.entries(result.attributes).map(([attr, a]) => (
            <div key={attr} className="rounded-lg border border-lattice-border p-2 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-gray-200 text-sm font-medium">{attr}</span>
                <span className={cn('text-xs font-bold', a.fourFifthsRule === 'passed' ? 'text-green-400' : 'text-red-400')}>
                  4/5ths rule: {a.fourFifthsRule}
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-gray-400 border-b border-lattice-border">
                      <th className="py-1 pr-3">Group</th>
                      <th className="py-1 pr-3">N</th>
                      <th className="py-1">Positive rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {a.groups.map((g) => (
                      <tr key={g.group} className="border-b border-lattice-border/50">
                        <td className="py-1 pr-3 text-gray-300">
                          {g.group}
                          {g.group === a.favoredGroup && <span className="text-green-400"> (favored)</span>}
                          {g.group === a.disadvantagedGroup && <span className="text-red-400"> (disadvantaged)</span>}
                        </td>
                        <td className="py-1 pr-3 text-gray-400">{g.total}</td>
                        <td className="py-1 text-gray-300">{g.positiveRate}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-[10px] text-gray-500">
                Disparate impact ratio {a.disparateImpactRatio} · parity Δ {a.statisticalParityDifference} ·
                χ² {a.chiSquared} (p≈{a.pValueApprox}) · severity {a.severity}
              </p>
            </div>
          ))}
          {result.recommendations.length > 0 && (
            <div className="space-y-1">
              {result.recommendations.map((rec, i) => (
                <p key={i} className="text-xs text-yellow-400">⚠ {rec}</p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ───────────────────────── shared ───────────────────────── */

function EmptyHint({ label }: { label: string }) {
  return (
    <div className="text-center py-8 text-sm text-gray-600 rounded-xl border border-dashed border-lattice-border">
      No {label} yet — run the tool above to create one.
    </div>
  );
}
