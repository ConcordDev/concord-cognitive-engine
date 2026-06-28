'use client';

/**
 * DecisionToolkit — the actionable ethics-decision surface for the
 * ethics lens. Wires all six backlog features end-to-end against the
 * `ethics` domain macros:
 *   - multiFrameworkDilemma / listMultiFramework
 *   - stakeholderMap / listStakeholderMaps
 *   - decisionMatrix / listDecisionMatrices
 *   - biasChecklistTemplate / biasChecklist / listBiasChecklists
 *   - submitReview / addReviewOpinion / recordVerdict / listReviews
 *   - archiveCase / searchCases / deleteCase
 *
 * Every value rendered comes from a real macro response.
 */

import { useState, useEffect, useCallback, type ReactNode } from 'react';
import { lensRun } from '@/lib/api/client';
import { ChartKit } from '@/components/viz';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
import {
  Scale, Users, Grid3x3, ListChecks, MessagesSquare, Archive,
  Plus, Trash2, X, Loader2, Search, Gavel, ThumbsUp, ThumbsDown, RefreshCw,
} from 'lucide-react';

type ToolTab = 'multiframework' | 'stakeholder' | 'matrix' | 'bias' | 'review' | 'cases';

const TOOL_TABS: { id: ToolTab; label: string; icon: typeof Scale }[] = [
  { id: 'multiframework', label: 'Multi-Framework', icon: Scale },
  { id: 'stakeholder', label: 'Stakeholder Map', icon: Users },
  { id: 'matrix', label: 'Decision Matrix', icon: Grid3x3 },
  { id: 'bias', label: 'Bias Checklist', icon: ListChecks },
  { id: 'review', label: 'Ethics Review', icon: MessagesSquare },
  { id: 'cases', label: 'Case Library', icon: Archive },
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

export function DecisionToolkit() {
  const [tab, setTab] = useState<ToolTab>('multiframework');

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
          </button>
        ))}
      </nav>
      {tab === 'multiframework' && <MultiFrameworkPanel />}
      {tab === 'stakeholder' && <StakeholderMapPanel />}
      {tab === 'matrix' && <DecisionMatrixPanel />}
      {tab === 'bias' && <BiasChecklistPanel />}
      {tab === 'review' && <ReviewWorkflowPanel />}
      {tab === 'cases' && <CaseLibraryPanel />}
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

/* ───────────────────────── shared ───────────────────────── */

function EmptyHint({ label }: { label: string }) {
  return (
    <div className="text-center py-8 text-sm text-gray-600 rounded-xl border border-dashed border-lattice-border">
      No {label} yet — run the tool above to create one.
    </div>
  );
}
