'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * ComplianceSuite — the Vanta/Drata-parity compliance-automation core for the
 * audit lens. Real, fully-wired surface over the audit-domain macros:
 *   frameworkCatalog / frameworkAdopt / controlList / controlUpdate
 *   evidenceAdd / evidenceList / evidenceDelete
 *   monitorList / monitorConfigure / monitorRun
 *   findingAdd / findingUpdate / findingList
 *   policyAdd / policyList / policyAccept / policyAcceptanceList
 *   vendorAdd / vendorUpdate / vendorList
 *   exportReport
 * Every value rendered comes from a macro response. No mock/seed data.
 */

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { ChartKit } from '@/components/viz';
import {
  ShieldCheck, FileCheck, Activity, ClipboardList, BookOpen, Building2,
  FileDown, Loader2, Plus, Trash2, RefreshCw, CheckCircle2, XCircle,
  AlertTriangle, Paperclip, Play,
} from 'lucide-react';

const DOMAIN = 'audit';

async function run<T = any>(name: string, params: Record<string, unknown> = {}): Promise<T | null> {
  const r = await lensRun<T>(DOMAIN, name, params);
  return r.data?.ok ? (r.data.result as T) : null;
}

// ── shared types ──────────────────────────────────────────────────────────
interface Framework { id: string; name: string; controlCount: number }
interface Control {
  id: string; framework: string; ref: string; category: string; title: string;
  status: string; owner: string | null; notes: string;
  lastAssessedAt: string | null; evidenceCount: number; openFindings: number;
}
interface ControlSummary { pass: number; fail: number; not_assessed: number; not_applicable: number; total: number; complianceRate: number }
interface Evidence { id: string; controlId: string; title: string; kind: string; reference: string; collectedAt: string; expired: boolean }
interface MonitorCheck { id: string; title: string; mapsTo: string[]; enabled: boolean; lastRun: string | null; lastResult: string | null; facts?: Record<string, unknown> }
interface MonitorRunResult { ranAt: string; totalChecks: number; passed: number; failed: number; autoUpdatedControls: number; results: { checkId: string; title: string; passed: boolean; reason: string }[] }
interface Finding {
  id: string; title: string; description: string; severity: string; status: string;
  controlId: string | null; owner: string | null; dueDate: string | null;
  remediationPlan: string; overdue: boolean;
}
interface FindingSummary { total: number; bySeverity: Record<string, number>; byStatus: Record<string, number>; overdue: number }
interface Policy { id: string; title: string; category: string; version: string; acceptanceCount: number; reviewOverdue: boolean; nextReviewDate: string }
interface Vendor { id: string; name: string; service: string; dataAccess: string; criticality: string; riskScore: number; riskTier: string; status: string; reviewOverdue: boolean }
interface VendorSummary { total: number; byTier: Record<string, number>; reviewOverdue: number }

type Tab = 'controls' | 'evidence' | 'monitoring' | 'findings' | 'policies' | 'vendors' | 'report';

const TABS: { id: Tab; label: string; icon: typeof ShieldCheck }[] = [
  { id: 'controls', label: 'Controls', icon: ShieldCheck },
  { id: 'evidence', label: 'Evidence', icon: FileCheck },
  { id: 'monitoring', label: 'Monitoring', icon: Activity },
  { id: 'findings', label: 'Findings', icon: ClipboardList },
  { id: 'policies', label: 'Policies', icon: BookOpen },
  { id: 'vendors', label: 'Vendors', icon: Building2 },
  { id: 'report', label: 'Report', icon: FileDown },
];

const SEV_COLOR: Record<string, string> = {
  critical: 'text-red-400 bg-red-500/15 border-red-500/30',
  high: 'text-orange-400 bg-orange-500/15 border-orange-500/30',
  medium: 'text-yellow-400 bg-yellow-500/15 border-yellow-500/30',
  low: 'text-sky-400 bg-sky-500/15 border-sky-500/30',
};
const STATUS_COLOR: Record<string, string> = {
  pass: 'text-emerald-400 bg-emerald-500/15',
  fail: 'text-red-400 bg-red-500/15',
  not_assessed: 'text-gray-400 bg-gray-500/15',
  not_applicable: 'text-zinc-500 bg-zinc-500/15',
};

export function ComplianceSuite() {
  const [tab, setTab] = useState<Tab>('controls');
  const [err, setErr] = useState<string | null>(null);

  return (
    <div className="rounded-xl border border-emerald-500/20 bg-zinc-950/60">
      <header className="flex items-center gap-2 border-b border-emerald-500/10 px-4 py-3">
        <ShieldCheck className="h-4 w-4 text-emerald-400" />
        <h3 className="text-sm font-semibold text-white">Compliance Automation</h3>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">
          SOC 2 · ISO 27001
        </span>
      </header>

      <nav className="flex flex-wrap gap-1 border-b border-zinc-800 px-3 py-2">
        {TABS.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              onClick={() => { setTab(t.id); setErr(null); }}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs transition-colors ${
                tab === t.id
                  ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                  : 'text-gray-400 hover:text-gray-200 border border-transparent'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {t.label}
            </button>
          );
        })}
      </nav>

      {err && (
        <div className="mx-4 mt-3 flex items-center gap-2 rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          <AlertTriangle className="h-3.5 w-3.5" /> {err}
        </div>
      )}

      <div className="p-4">
        {tab === 'controls' && <ControlsTab onErr={setErr} />}
        {tab === 'evidence' && <EvidenceTab onErr={setErr} />}
        {tab === 'monitoring' && <MonitoringTab onErr={setErr} />}
        {tab === 'findings' && <FindingsTab onErr={setErr} />}
        {tab === 'policies' && <PoliciesTab onErr={setErr} />}
        {tab === 'vendors' && <VendorsTab onErr={setErr} />}
        {tab === 'report' && <ReportTab onErr={setErr} />}
      </div>
    </div>
  );
}

// ── Controls tab ──────────────────────────────────────────────────────────
function ControlsTab({ onErr }: { onErr: (m: string | null) => void }) {
  const [frameworks, setFrameworks] = useState<Framework[]>([]);
  const [controls, setControls] = useState<Control[]>([]);
  const [summary, setSummary] = useState<ControlSummary | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>('');

  const load = useCallback(async (fw?: string) => {
    const r = await run<{ controls: Control[]; summary: ControlSummary }>('controlList', fw ? { framework: fw } : {});
    if (r) { setControls(r.controls); setSummary(r.summary); }
  }, []);

  useEffect(() => {
    (async () => {
      const cat = await run<{ frameworks: Framework[] }>('frameworkCatalog');
      if (cat) setFrameworks(cat.frameworks);
      await load();
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function adopt(fw: string) {
    setBusy(fw); onErr(null);
    const r = await run<{ added: number }>('frameworkAdopt', { framework: fw });
    if (!r) onErr(`Failed to adopt ${fw}`);
    await load(filter || undefined);
    setBusy(null);
  }

  async function updateControl(id: string, patch: Record<string, unknown>) {
    onErr(null);
    const r = await run('controlUpdate', { id, ...patch });
    if (!r) { onErr('Control update failed'); return; }
    await load(filter || undefined);
  }

  const shown = filter ? controls.filter((c) => c.framework === filter) : controls;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {frameworks.map((f) => (
          <button
            key={f.id}
            onClick={() => adopt(f.id)}
            disabled={busy !== null}
            className="flex items-center gap-1.5 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-40"
          >
            {busy === f.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            Adopt {f.name} ({f.controlCount})
          </button>
        ))}
        <select
          value={filter}
          onChange={(e) => { setFilter(e.target.value); load(e.target.value || undefined); }}
          className="ml-auto rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-gray-200"
        >
          <option value="">All frameworks</option>
          {frameworks.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
      </div>

      {summary && summary.total > 0 && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <Stat label="Controls" value={summary.total} color="text-sky-400" />
          <Stat label="Passing" value={summary.pass} color="text-emerald-400" />
          <Stat label="Failing" value={summary.fail} color="text-red-400" />
          <Stat label="Not assessed" value={summary.not_assessed} color="text-gray-400" />
          <Stat label="Compliance" value={`${summary.complianceRate}%`} color="text-emerald-300" />
        </div>
      )}

      {shown.length === 0 ? (
        <Empty msg="No controls yet. Adopt a framework above to map its control catalog." />
      ) : (
        <div className="max-h-[480px] space-y-2 overflow-y-auto">
          {shown.map((c) => (
            <div key={c.id} className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-emerald-300">{c.ref}</span>
                <span className="text-sm text-gray-200">{c.title}</span>
                <span className={`ml-auto rounded px-2 py-0.5 text-[10px] uppercase ${STATUS_COLOR[c.status] || ''}`}>
                  {c.status.replace('_', ' ')}
                </span>
              </div>
              <div className="mt-1 text-[11px] text-gray-500">
                {c.category} · {c.evidenceCount} evidence · {c.openFindings} open finding(s)
                {c.lastAssessedAt && ` · assessed ${new Date(c.lastAssessedAt).toLocaleDateString()}`}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <select
                  value={c.status}
                  onChange={(e) => updateControl(c.id, { status: e.target.value })}
                  className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-[11px] text-gray-200"
                >
                  {['not_assessed', 'pass', 'fail', 'not_applicable'].map((s) => (
                    <option key={s} value={s}>{s.replace('_', ' ')}</option>
                  ))}
                </select>
                <input
                  defaultValue={c.owner || ''}
                  placeholder="Owner"
                  onBlur={(e) => { if (e.target.value !== (c.owner || '')) updateControl(c.id, { owner: e.target.value }); }}
                  className="w-32 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-[11px] text-gray-200"
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Evidence tab ──────────────────────────────────────────────────────────
function EvidenceTab({ onErr }: { onErr: (m: string | null) => void }) {
  const [controls, setControls] = useState<Control[]>([]);
  const [evidence, setEvidence] = useState<Evidence[]>([]);
  const [expiredCount, setExpiredCount] = useState(0);
  const [form, setForm] = useState({ controlId: '', title: '', kind: 'document', reference: '' });
  const [busy, setBusy] = useState(false);

  const loadEvidence = useCallback(async () => {
    const r = await run<{ evidence: Evidence[]; expiredCount: number }>('evidenceList');
    if (r) { setEvidence(r.evidence); setExpiredCount(r.expiredCount); }
  }, []);

  useEffect(() => {
    (async () => {
      const c = await run<{ controls: Control[] }>('controlList');
      if (c) setControls(c.controls);
      await loadEvidence();
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function add() {
    if (!form.controlId || !form.title.trim()) { onErr('Pick a control and enter a title.'); return; }
    setBusy(true); onErr(null);
    const r = await run('evidenceAdd', { ...form });
    if (!r) onErr('Evidence add failed (control not found?)');
    else setForm({ controlId: form.controlId, title: '', kind: 'document', reference: '' });
    await loadEvidence();
    setBusy(false);
  }
  async function del(id: string) {
    onErr(null);
    await run('evidenceDelete', { id });
    await loadEvidence();
  }

  const controlLabel = (id: string) => {
    const c = controls.find((x) => x.id === id);
    return c ? `${c.ref} ${c.title}` : id;
  };

  return (
    <div className="space-y-4">
      {controls.length === 0 ? (
        <Empty msg="Adopt a framework on the Controls tab before attaching evidence." />
      ) : (
        <div className="grid grid-cols-1 gap-2 rounded-lg border border-zinc-800 bg-zinc-900/40 p-3 md:grid-cols-5">
          <select
            value={form.controlId}
            onChange={(e) => setForm({ ...form, controlId: e.target.value })}
            className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-gray-200 md:col-span-2"
          >
            <option value="">Select control…</option>
            {controls.map((c) => <option key={c.id} value={c.id}>{c.ref} — {c.title}</option>)}
          </select>
          <input
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            placeholder="Evidence title"
            className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-gray-200"
          />
          <select
            value={form.kind}
            onChange={(e) => setForm({ ...form, kind: e.target.value })}
            className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-gray-200"
          >
            {['document', 'screenshot', 'log', 'config', 'url', 'attestation'].map((k) => <option key={k}>{k}</option>)}
          </select>
          <button
            onClick={add}
            disabled={busy}
            className="flex items-center justify-center gap-1.5 rounded bg-emerald-500/15 px-3 py-1.5 text-xs text-emerald-300 hover:bg-emerald-500/25 disabled:opacity-40"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Paperclip className="h-3.5 w-3.5" />}
            Attach
          </button>
          <input
            value={form.reference}
            onChange={(e) => setForm({ ...form, reference: e.target.value })}
            placeholder="Reference / URL (optional)"
            className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-gray-200 md:col-span-5"
          />
        </div>
      )}

      <div className="flex items-center gap-3 text-xs text-gray-400">
        <span>{evidence.length} evidence item(s)</span>
        {expiredCount > 0 && <span className="text-amber-400">{expiredCount} expired</span>}
      </div>

      {evidence.length === 0 ? (
        <Empty msg="No evidence collected yet." />
      ) : (
        <div className="max-h-[420px] space-y-2 overflow-y-auto">
          {evidence.map((e) => (
            <div key={e.id} className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900/50 p-2.5">
              <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] uppercase text-sky-300">{e.kind}</span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-gray-200">{e.title}</p>
                <p className="truncate text-[11px] text-gray-500">{controlLabel(e.controlId)} · {new Date(e.collectedAt).toLocaleDateString()}</p>
              </div>
              {e.expired && <span className="text-[10px] text-amber-400">expired</span>}
              <button onClick={() => del(e.id)} className="text-gray-500 hover:text-red-400" aria-label="Delete evidence">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Monitoring tab ────────────────────────────────────────────────────────
const FACT_FIELDS: Record<string, { key: string; label: string }[]> = {
  mfa_enforced: [{ key: 'mfaUsers', label: 'MFA users' }, { key: 'totalUsers', label: 'Total users' }],
  access_reviews: [{ key: 'lastReviewDaysAgo', label: 'Last review (days ago)' }],
  encryption_at_rest: [{ key: 'encryptedVolumes', label: 'Encrypted volumes' }, { key: 'totalVolumes', label: 'Total volumes' }],
  backup_verified: [{ key: 'lastBackupDaysAgo', label: 'Last backup (days ago)' }],
  vuln_scan_recent: [{ key: 'lastScanDaysAgo', label: 'Last scan (days ago)' }],
  audit_logging: [{ key: 'loggingEnabled', label: 'Logging enabled (1/0)' }],
  change_approval: [{ key: 'approvedChanges', label: 'Approved changes' }, { key: 'totalChanges', label: 'Total changes' }],
};

function MonitoringTab({ onErr }: { onErr: (m: string | null) => void }) {
  const [checks, setChecks] = useState<MonitorCheck[]>([]);
  const [draft, setDraft] = useState<Record<string, Record<string, string>>>({});
  const [lastRun, setLastRun] = useState<MonitorRunResult | null>(null);
  const [running, setRunning] = useState(false);

  const load = useCallback(async () => {
    const r = await run<{ checks: MonitorCheck[] }>('monitorList');
    if (r) {
      setChecks(r.checks);
      const d: Record<string, Record<string, string>> = {};
      for (const c of r.checks) {
        d[c.id] = {};
        for (const f of FACT_FIELDS[c.id] || []) {
          const v = (c.facts || {})[f.key];
          d[c.id][f.key] = v === undefined ? '' : (typeof v === 'boolean' ? (v ? '1' : '0') : String(v));
        }
      }
      setDraft(d);
    }
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, []);

  async function configure(id: string, enabled: boolean) {
    onErr(null);
    const raw = draft[id] || {};
    const facts: Record<string, unknown> = {};
    for (const f of FACT_FIELDS[id] || []) {
      const v = raw[f.key];
      if (v !== undefined && v !== '') {
        facts[f.key] = f.key === 'loggingEnabled' ? v === '1' || v.toLowerCase() === 'true' : Number(v);
      }
    }
    const r = await run('monitorConfigure', { checkId: id, enabled, facts });
    if (!r) onErr('Configure failed');
    await load();
  }

  async function runAll() {
    setRunning(true); onErr(null);
    const r = await run<MonitorRunResult>('monitorRun');
    if (r) setLastRun(r);
    else onErr('Monitor run failed');
    await load();
    setRunning(false);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-400">
          Enable automated checks, supply facts, then run. Passing/failing results auto-update mapped controls.
        </p>
        <button
          onClick={runAll}
          disabled={running}
          className="flex items-center gap-1.5 rounded-md border border-emerald-500/30 bg-emerald-500/15 px-3 py-1.5 text-xs text-emerald-300 hover:bg-emerald-500/25 disabled:opacity-40"
        >
          {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
          Run all checks
        </button>
      </div>

      {lastRun && (
        <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
          <p className="text-xs text-emerald-300">
            Ran {lastRun.totalChecks} check(s) · {lastRun.passed} passed · {lastRun.failed} failed ·
            {' '}{lastRun.autoUpdatedControls} control(s) auto-updated
          </p>
          <div className="mt-2 space-y-1">
            {lastRun.results.map((r) => (
              <div key={r.checkId} className="flex items-center gap-2 text-[11px]">
                {r.passed
                  ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                  : <XCircle className="h-3.5 w-3.5 text-red-400" />}
                <span className="text-gray-300">{r.title}</span>
                <span className="text-gray-500">— {r.reason}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-2">
        {checks.map((c) => (
          <div key={c.id} className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="checkbox"
                checked={c.enabled}
                onChange={(e) => configure(c.id, e.target.checked)}
                className="h-3.5 w-3.5 accent-emerald-500"
              />
              <span className="text-sm text-gray-200">{c.title}</span>
              <span className="font-mono text-[10px] text-gray-500">{c.mapsTo.join(', ')}</span>
              {c.lastResult && (
                <span className={`ml-auto rounded px-2 py-0.5 text-[10px] uppercase ${
                  c.lastResult === 'pass' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-red-500/15 text-red-300'
                }`}>
                  {c.lastResult}
                </span>
              )}
            </div>
            {c.enabled && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {(FACT_FIELDS[c.id] || []).map((f) => (
                  <input
                    key={f.key}
                    value={draft[c.id]?.[f.key] ?? ''}
                    onChange={(e) => setDraft({ ...draft, [c.id]: { ...draft[c.id], [f.key]: e.target.value } })}
                    onBlur={() => configure(c.id, true)}
                    placeholder={f.label}
                    className="w-44 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-[11px] text-gray-200"
                  />
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Findings tab ──────────────────────────────────────────────────────────
function FindingsTab({ onErr }: { onErr: (m: string | null) => void }) {
  const [findings, setFindings] = useState<Finding[]>([]);
  const [summary, setSummary] = useState<FindingSummary | null>(null);
  const [controls, setControls] = useState<Control[]>([]);
  const [form, setForm] = useState({ title: '', severity: 'medium', owner: '', dueDate: '', controlId: '', remediationPlan: '' });
  const [busy, setBusy] = useState(false);
  const [statusFilter, setStatusFilter] = useState('');

  const load = useCallback(async (status?: string) => {
    const r = await run<{ findings: Finding[]; summary: FindingSummary }>('findingList', status ? { status } : {});
    if (r) { setFindings(r.findings); setSummary(r.summary); }
  }, []);

  useEffect(() => {
    (async () => {
      const c = await run<{ controls: Control[] }>('controlList');
      if (c) setControls(c.controls);
      await load();
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function add() {
    if (!form.title.trim()) { onErr('Finding title required.'); return; }
    setBusy(true); onErr(null);
    const r = await run('findingAdd', {
      ...form,
      controlId: form.controlId || undefined,
      dueDate: form.dueDate || undefined,
    });
    if (!r) onErr('Finding add failed');
    else setForm({ title: '', severity: 'medium', owner: '', dueDate: '', controlId: '', remediationPlan: '' });
    await load(statusFilter || undefined);
    setBusy(false);
  }
  async function update(id: string, patch: Record<string, unknown>) {
    onErr(null);
    await run('findingUpdate', { id, ...patch });
    await load(statusFilter || undefined);
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-2 rounded-lg border border-zinc-800 bg-zinc-900/40 p-3 md:grid-cols-6">
        <input
          value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
          placeholder="Finding title"
          className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-gray-200 md:col-span-2"
        />
        <select value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value })}
          className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-gray-200">
          {['critical', 'high', 'medium', 'low'].map((s) => <option key={s}>{s}</option>)}
        </select>
        <input value={form.owner} onChange={(e) => setForm({ ...form, owner: e.target.value })}
          placeholder="Remediation owner"
          className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-gray-200" />
        <input type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
          className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-gray-200" />
        <button onClick={add} disabled={busy}
          className="flex items-center justify-center gap-1.5 rounded bg-emerald-500/15 px-3 py-1.5 text-xs text-emerald-300 hover:bg-emerald-500/25 disabled:opacity-40">
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} Add finding
        </button>
        <select value={form.controlId} onChange={(e) => setForm({ ...form, controlId: e.target.value })}
          className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-gray-200 md:col-span-3">
          <option value="">Link to control (optional)…</option>
          {controls.map((c) => <option key={c.id} value={c.id}>{c.ref} — {c.title}</option>)}
        </select>
        <input value={form.remediationPlan} onChange={(e) => setForm({ ...form, remediationPlan: e.target.value })}
          placeholder="Remediation plan (optional)"
          className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-gray-200 md:col-span-3" />
      </div>

      {summary && summary.total > 0 && (
        <div className="grid grid-cols-3 gap-3 md:grid-cols-6">
          <Stat label="Total" value={summary.total} color="text-sky-400" />
          <Stat label="Critical" value={summary.bySeverity.critical} color="text-red-400" />
          <Stat label="High" value={summary.bySeverity.high} color="text-orange-400" />
          <Stat label="Open" value={summary.byStatus.open} color="text-yellow-400" />
          <Stat label="Closed" value={summary.byStatus.closed} color="text-emerald-400" />
          <Stat label="Overdue" value={summary.overdue} color="text-red-300" />
        </div>
      )}

      <div className="flex items-center gap-2">
        <span className="text-[11px] text-gray-500">Filter:</span>
        {['', 'open', 'in_progress', 'remediated', 'closed'].map((s) => (
          <button key={s || 'all'}
            onClick={() => { setStatusFilter(s); load(s || undefined); }}
            className={`rounded px-2 py-0.5 text-[11px] ${statusFilter === s ? 'bg-emerald-500/20 text-emerald-300' : 'bg-zinc-800 text-gray-400'}`}>
            {s || 'all'}
          </button>
        ))}
      </div>

      {findings.length === 0 ? (
        <Empty msg="No findings recorded." />
      ) : (
        <div className="max-h-[420px] space-y-2 overflow-y-auto">
          {findings.map((f) => (
            <div key={f.id} className={`rounded-lg border p-3 ${f.overdue ? 'border-red-500/40 bg-red-500/5' : 'border-zinc-800 bg-zinc-900/50'}`}>
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded border px-2 py-0.5 text-[10px] uppercase ${SEV_COLOR[f.severity]}`}>{f.severity}</span>
                <span className="text-sm text-gray-200">{f.title}</span>
                {f.overdue && <span className="text-[10px] text-red-400">overdue</span>}
                <select
                  value={f.status}
                  onChange={(e) => update(f.id, { status: e.target.value })}
                  className="ml-auto rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-[11px] text-gray-200"
                >
                  {['open', 'in_progress', 'remediated', 'closed'].map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
                </select>
              </div>
              <div className="mt-1 text-[11px] text-gray-500">
                Owner: {f.owner || 'unassigned'} · Due: {f.dueDate || 'n/a'}
                {f.remediationPlan && ` · Plan: ${f.remediationPlan}`}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Policies tab ──────────────────────────────────────────────────────────
function PoliciesTab({ onErr }: { onErr: (m: string | null) => void }) {
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [form, setForm] = useState({ title: '', category: 'security', version: '1.0', body: '' });
  const [acceptBy, setAcceptBy] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await run<{ policies: Policy[] }>('policyList');
    if (r) setPolicies(r.policies);
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, []);

  async function add() {
    if (!form.title.trim()) { onErr('Policy title required.'); return; }
    setBusy(true); onErr(null);
    const r = await run('policyAdd', { ...form });
    if (!r) onErr('Policy add failed');
    else setForm({ title: '', category: 'security', version: '1.0', body: '' });
    await load();
    setBusy(false);
  }
  async function accept(policyId: string) {
    const who = (acceptBy[policyId] || '').trim();
    if (!who) { onErr('Enter who is accepting.'); return; }
    onErr(null);
    const r = await run('policyAccept', { policyId, acceptedBy: who });
    if (!r) onErr('Acceptance failed');
    else setAcceptBy({ ...acceptBy, [policyId]: '' });
    await load();
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-2 rounded-lg border border-zinc-800 bg-zinc-900/40 p-3 md:grid-cols-5">
        <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
          placeholder="Policy title"
          className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-gray-200 md:col-span-2" />
        <input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}
          placeholder="Category"
          className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-gray-200" />
        <input value={form.version} onChange={(e) => setForm({ ...form, version: e.target.value })}
          placeholder="Version"
          className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-gray-200" />
        <button onClick={add} disabled={busy}
          className="flex items-center justify-center gap-1.5 rounded bg-emerald-500/15 px-3 py-1.5 text-xs text-emerald-300 hover:bg-emerald-500/25 disabled:opacity-40">
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} Add policy
        </button>
        <textarea value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })}
          placeholder="Policy body (optional)" rows={2}
          className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-gray-200 md:col-span-5" />
      </div>

      {policies.length === 0 ? (
        <Empty msg="No policies in the library." />
      ) : (
        <div className="max-h-[420px] space-y-2 overflow-y-auto">
          {policies.map((p) => (
            <div key={p.id} className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm text-gray-200">{p.title}</span>
                <span className="font-mono text-[10px] text-gray-500">v{p.version}</span>
                <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-sky-300">{p.category}</span>
                {p.reviewOverdue && <span className="text-[10px] text-amber-400">review overdue</span>}
                <span className="ml-auto text-[11px] text-emerald-300">{p.acceptanceCount} acceptance(s)</span>
              </div>
              <div className="mt-1 text-[11px] text-gray-500">Next review: {p.nextReviewDate}</div>
              <div className="mt-2 flex items-center gap-2">
                <input
                  value={acceptBy[p.id] || ''}
                  onChange={(e) => setAcceptBy({ ...acceptBy, [p.id]: e.target.value })}
                  placeholder="Accepted by (name / id)"
                  className="w-52 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-[11px] text-gray-200"
                />
                <button onClick={() => accept(p.id)}
                  className="flex items-center gap-1.5 rounded bg-emerald-500/15 px-2.5 py-1 text-[11px] text-emerald-300 hover:bg-emerald-500/25">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Record acceptance
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Vendors tab ───────────────────────────────────────────────────────────
function VendorsTab({ onErr }: { onErr: (m: string | null) => void }) {
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [summary, setSummary] = useState<VendorSummary | null>(null);
  const [form, setForm] = useState({ name: '', service: '', dataAccess: 'none', criticality: 'medium' });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await run<{ vendors: Vendor[]; summary: VendorSummary }>('vendorList');
    if (r) { setVendors(r.vendors); setSummary(r.summary); }
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, []);

  async function add() {
    if (!form.name.trim()) { onErr('Vendor name required.'); return; }
    setBusy(true); onErr(null);
    const r = await run('vendorAdd', { ...form });
    if (!r) onErr('Vendor add failed');
    else setForm({ name: '', service: '', dataAccess: 'none', criticality: 'medium' });
    await load();
    setBusy(false);
  }
  async function update(id: string, patch: Record<string, unknown>) {
    onErr(null);
    await run('vendorUpdate', { id, ...patch });
    await load();
  }

  const tierColor: Record<string, string> = {
    high: 'text-red-400 bg-red-500/15 border-red-500/30',
    medium: 'text-yellow-400 bg-yellow-500/15 border-yellow-500/30',
    low: 'text-emerald-400 bg-emerald-500/15 border-emerald-500/30',
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-2 rounded-lg border border-zinc-800 bg-zinc-900/40 p-3 md:grid-cols-5">
        <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
          placeholder="Vendor name"
          className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-gray-200" />
        <input value={form.service} onChange={(e) => setForm({ ...form, service: e.target.value })}
          placeholder="Service provided"
          className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-gray-200" />
        <select value={form.dataAccess} onChange={(e) => setForm({ ...form, dataAccess: e.target.value })}
          className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-gray-200">
          {['none', 'metadata', 'pii', 'sensitive', 'critical'].map((d) => <option key={d}>{d}</option>)}
        </select>
        <select value={form.criticality} onChange={(e) => setForm({ ...form, criticality: e.target.value })}
          className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-gray-200">
          {['low', 'medium', 'high'].map((c) => <option key={c}>{c}</option>)}
        </select>
        <button onClick={add} disabled={busy}
          className="flex items-center justify-center gap-1.5 rounded bg-emerald-500/15 px-3 py-1.5 text-xs text-emerald-300 hover:bg-emerald-500/25 disabled:opacity-40">
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} Add vendor
        </button>
      </div>

      {summary && summary.total > 0 && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Vendors" value={summary.total} color="text-sky-400" />
          <Stat label="High risk" value={summary.byTier.high} color="text-red-400" />
          <Stat label="Medium risk" value={summary.byTier.medium} color="text-yellow-400" />
          <Stat label="Review overdue" value={summary.reviewOverdue} color="text-amber-300" />
        </div>
      )}

      {vendors.length === 0 ? (
        <Empty msg="No third-party vendors registered." />
      ) : (
        <div className="max-h-[420px] space-y-2 overflow-y-auto">
          {vendors.map((v) => (
            <div key={v.id} className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm text-gray-200">{v.name}</span>
                {v.service && <span className="text-[11px] text-gray-500">{v.service}</span>}
                <span className={`rounded border px-2 py-0.5 text-[10px] uppercase ${tierColor[v.riskTier]}`}>
                  {v.riskTier} risk · {v.riskScore}
                </span>
                {v.reviewOverdue && <span className="text-[10px] text-amber-400">review overdue</span>}
                <select
                  value={v.status}
                  onChange={(e) => update(v.id, { status: e.target.value })}
                  className="ml-auto rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-[11px] text-gray-200"
                >
                  {['active', 'under_review', 'offboarded'].map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
                </select>
              </div>
              <div className="mt-1 text-[11px] text-gray-500">
                Data access: {v.dataAccess} · Criticality: {v.criticality}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Report tab ────────────────────────────────────────────────────────────
interface Report {
  reportId: string; title: string; organization: string; generatedAt: string;
  summary: Record<string, number>;
  frameworkBreakdown: Record<string, { name: string; complianceRate: number; pass: number; fail: number; not_assessed: number }>;
}

function ReportTab({ onErr }: { onErr: (m: string | null) => void }) {
  const [org, setOrg] = useState('');
  const [report, setReport] = useState<Report | null>(null);
  const [markdown, setMarkdown] = useState('');
  const [busy, setBusy] = useState(false);

  async function generate() {
    setBusy(true); onErr(null);
    const r = await run<{ report: Report; markdown: string }>('exportReport', org ? { organization: org } : {});
    if (r) { setReport(r.report); setMarkdown(r.markdown); }
    else onErr('Report generation failed');
    setBusy(false);
  }

  function download() {
    if (!markdown) return;
    const blob = new Blob([markdown], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `audit-report-${report?.reportId || Date.now()}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const fwChart = report
    ? Object.values(report.frameworkBreakdown).map((b) => ({ name: b.name, compliance: b.complianceRate }))
    : [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={org}
          onChange={(e) => setOrg(e.target.value)}
          placeholder="Organization name (optional)"
          className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-gray-200"
        />
        <button onClick={generate} disabled={busy}
          className="flex items-center gap-1.5 rounded-md border border-emerald-500/30 bg-emerald-500/15 px-3 py-1.5 text-xs text-emerald-300 hover:bg-emerald-500/25 disabled:opacity-40">
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          Generate report
        </button>
        {markdown && (
          <button onClick={download}
            className="flex items-center gap-1.5 rounded-md border border-sky-500/30 bg-sky-500/15 px-3 py-1.5 text-xs text-sky-300 hover:bg-sky-500/25">
            <FileDown className="h-3.5 w-3.5" /> Download .md
          </button>
        )}
      </div>

      {!report ? (
        <Empty msg="Generate an auditor-shareable report from your live compliance state." />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <Stat label="Frameworks" value={report.summary.frameworksAdopted} color="text-sky-400" />
            <Stat label="Controls" value={report.summary.totalControls} color="text-emerald-400" />
            <Stat label="Passing" value={report.summary.controlsPassing} color="text-emerald-300" />
            <Stat label="Open findings" value={report.summary.openFindings} color="text-yellow-400" />
            <Stat label="Critical" value={report.summary.criticalFindings} color="text-red-400" />
            <Stat label="Evidence" value={report.summary.evidenceItems} color="text-sky-300" />
            <Stat label="Policies" value={report.summary.policies} color="text-violet-400" />
            <Stat label="Acceptances" value={report.summary.policyAcceptances} color="text-violet-300" />
            <Stat label="Vendors" value={report.summary.vendors} color="text-amber-400" />
            <Stat label="High-risk vendors" value={report.summary.highRiskVendors} color="text-red-300" />
          </div>

          {fwChart.length > 0 && (
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
              <p className="mb-2 text-xs text-gray-400">Compliance rate by framework</p>
              <ChartKit
                kind="bar"
                data={fwChart}
                xKey="name"
                series={[{ key: 'compliance', label: 'Compliance %', color: '#22c55e' }]}
                height={200}
              />
            </div>
          )}

          <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
            <p className="mb-2 text-[11px] uppercase tracking-wider text-gray-500">
              Auditor-shareable view · report {report.reportId}
            </p>
            <pre className="max-h-[360px] overflow-auto whitespace-pre-wrap font-mono text-[11px] text-gray-300">
              {markdown}
            </pre>
          </div>
        </>
      )}
    </div>
  );
}

// ── small shared bits ─────────────────────────────────────────────────────
function Stat({ label, value, color }: { label: string; value: number | string; color: string }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-2.5">
      <p className={`text-xl font-bold ${color}`}>{value ?? 0}</p>
      <p className="text-[11px] text-gray-500">{label}</p>
    </div>
  );
}

function Empty({ msg }: { msg: string }) {
  return (
    <div className="rounded-lg border border-dashed border-zinc-800 bg-zinc-900/30 p-6 text-center text-xs text-gray-500">
      {msg}
    </div>
  );
}
