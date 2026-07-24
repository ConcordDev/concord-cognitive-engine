'use client';

/**
 * DpoStudioPanel — the Data-Protection-Officer console for the privacy lens.
 *
 * Four OneTrust-parity GDPR compliance tools, each wired to a real privacy
 * macro via a bespoke structured input form (never a generic JSON-paste box,
 * never a persisted-artifact indirection):
 *   - Data Inventory      → privacy.dataInventory   (PII risk classification)
 *   - Consent Audit       → privacy.consentAudit    (compliance-rate report)
 *   - DPIA                → privacy.impactAssessment (Art. 35 assessment)
 *   - Breach Response     → privacy.breachResponse   (72h Art. 33 timeline)
 *
 * Every call goes through lensRun('privacy', action, {...realInput}); the input
 * body becomes the macro's artifact.data directly, so no artifact is created.
 * These are pure-compute analysis actions (no data is mutated/deleted), so it
 * is honest to render results as soon as the backend returns.
 */

import { useCallback, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { ds } from '@/lib/design-system';
import {
  Boxes,
  ClipboardCheck,
  ShieldAlert,
  Siren,
  Loader2,
  Plus,
  X,
  Trash2,
  AlertTriangle,
  CheckCircle2,
} from 'lucide-react';

// ── Result shapes ──────────────────────────────────────────────────────────

interface InventoryResult {
  message?: string;
  totalItems?: number;
  sensitiveItems?: number;
  categories?: Record<string, number>;
  riskLevel?: string;
  gdprRelevant?: boolean;
  recommendations?: string[];
}
interface ConsentResult {
  totalConsents: number;
  active: number;
  expired: number;
  withdrawn: number;
  complianceRate: number;
  issues: { user: string; expiredOn: string }[];
  action: string;
}
interface DpiaResult {
  dataTypesCount: number;
  purposes: number;
  riskFactors: string[];
  riskLevel: string;
  dpiaRequired: boolean;
  mitigations: { risk: string; mitigation: string }[];
}
interface BreachResult {
  severity: string;
  affectedUsers: number;
  compromisedDataTypes: string[];
  notificationRequired: boolean;
  regulatoryDeadline: string;
  timeline: Record<string, string[]>;
  priorityActions: string[];
}

// ── Shared bits ────────────────────────────────────────────────────────────

const TOOLS = [
  { id: 'inventory', label: 'Data Inventory', icon: Boxes, hint: 'PII risk scan' },
  { id: 'consent', label: 'Consent Audit', icon: ClipboardCheck, hint: 'Compliance rate' },
  { id: 'dpia', label: 'DPIA', icon: ShieldAlert, hint: 'Art. 35 assessment' },
  { id: 'breach', label: 'Breach Response', icon: Siren, hint: 'Art. 33 · 72h' },
] as const;
type ToolId = (typeof TOOLS)[number]['id'];

function riskTone(level?: string): string {
  if (level === 'high' || level === 'critical') return 'text-rose-400';
  if (level === 'moderate' || level === 'medium') return 'text-amber-400';
  return 'text-emerald-400';
}

function RiskBadge({ level }: { level?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider border',
        level === 'high'
          ? 'bg-rose-500/15 text-rose-300 border-rose-500/30'
          : level === 'moderate' || level === 'medium'
            ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
            : 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
      )}
    >
      {level || 'low'} risk
    </span>
  );
}

const inputCls =
  'bg-black/40 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white placeholder:text-gray-500 focus:outline-none focus:border-neon-blue/50';
const runBtnCls =
  'px-3 py-1.5 text-xs bg-neon-blue/15 border border-neon-blue/30 rounded-lg hover:bg-neon-blue/25 disabled:opacity-50 flex items-center gap-1.5 text-neon-blue transition-colors';

// ── Data Inventory tool ────────────────────────────────────────────────────

interface DataItemRow { category: string; sensitive: boolean }

function InventoryTool() {
  const [rows, setRows] = useState<DataItemRow[]>([
    { category: 'email', sensitive: false },
    { category: 'health_record', sensitive: true },
  ]);
  const [cat, setCat] = useState('');
  const [sensitive, setSensitive] = useState(false);
  const [res, setRes] = useState<InventoryResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const add = useCallback(() => {
    const c = cat.trim();
    if (!c) return;
    setRows((r) => [...r, { category: c, sensitive }]);
    setCat('');
    setSensitive(false);
  }, [cat, sensitive]);

  const run = useCallback(async () => {
    setBusy(true);
    setError(null);
    const r = await lensRun<InventoryResult>('privacy', 'dataInventory', {
      dataItems: rows.map((x) => ({ category: x.category, sensitive: x.sensitive, pii: x.sensitive })),
    });
    if (r.data.ok && r.data.result) setRes(r.data.result);
    else setError(r.data.error || 'analysis failed');
    setBusy(false);
  }, [rows]);

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-400">
        Catalog the personal-data categories you process; get an at-rest PII risk classification and GDPR remediation checklist.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={cat}
          onChange={(e) => setCat(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') add(); }}
          placeholder="Data category (e.g. ip_address)…"
          className={cn(inputCls, 'flex-1 min-w-[180px]')}
        />
        <label className="flex items-center gap-1.5 text-xs text-gray-300 cursor-pointer">
          <input type="checkbox" checked={sensitive} onChange={(e) => setSensitive(e.target.checked)} className="accent-rose-500" />
          sensitive / PII
        </label>
        <button onClick={add} className={runBtnCls}><Plus className="w-3 h-3" /> Add</button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {rows.length === 0 && <span className="text-xs text-gray-500">No data items — add categories above.</span>}
        {rows.map((r, i) => (
          <span
            key={`${r.category}-${i}`}
            className={cn(
              'inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] border',
              r.sensitive ? 'bg-rose-500/10 text-rose-300 border-rose-500/25' : 'bg-white/5 text-gray-300 border-white/10',
            )}
          >
            {r.category}
            <button onClick={() => setRows((rr) => rr.filter((_, j) => j !== i))} className="opacity-60 hover:opacity-100" aria-label={`Remove data item "${r.category}"`}>
              <X className="w-2.5 h-2.5" aria-hidden="true" />
            </button>
          </span>
        ))}
      </div>
      <button onClick={run} disabled={busy || rows.length === 0} className={runBtnCls}>
        {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Boxes className="w-3 h-3" />} Classify inventory
      </button>
      {error && <p className="text-xs text-rose-400">{error}</p>}
      {res && (
        <div className="rounded-lg border border-neon-blue/20 bg-black/30 p-3 space-y-2">
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <span className="text-gray-400">Items: <span className="font-mono text-white">{res.totalItems ?? 0}</span></span>
            <span className="text-gray-400">Sensitive: <span className={cn('font-mono', (res.sensitiveItems ?? 0) > 0 ? 'text-rose-400' : 'text-emerald-400')}>{res.sensitiveItems ?? 0}</span></span>
            <RiskBadge level={res.riskLevel} />
            {res.gdprRelevant && <span className="text-amber-400 text-[11px]">GDPR relevant</span>}
          </div>
          {res.categories && Object.keys(res.categories).length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(res.categories).map(([k, n]) => (
                <span key={k} className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-gray-300">{k}: {n}</span>
              ))}
            </div>
          )}
          {res.recommendations && (
            <ul className="space-y-0.5">
              {res.recommendations.map((r, i) => (
                <li key={i} className="text-[11px] text-gray-300 flex gap-1.5"><CheckCircle2 className="w-3 h-3 text-emerald-400 mt-0.5 shrink-0" />{r}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

// ── Consent Audit tool ─────────────────────────────────────────────────────

interface ConsentRow { subject: string; status: string; expiry: string }

function ConsentTool() {
  const [rows, setRows] = useState<ConsentRow[]>([
    { subject: 'user_1042', status: 'active', expiry: '' },
    { subject: 'user_2071', status: 'active', expiry: '2024-01-01' },
  ]);
  const [subject, setSubject] = useState('');
  const [status, setStatus] = useState('active');
  const [expiry, setExpiry] = useState('');
  const [res, setRes] = useState<ConsentResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const add = useCallback(() => {
    if (!subject.trim()) return;
    setRows((r) => [...r, { subject: subject.trim(), status, expiry }]);
    setSubject('');
    setExpiry('');
  }, [subject, status, expiry]);

  const run = useCallback(async () => {
    setBusy(true);
    setError(null);
    const r = await lensRun<ConsentResult>('privacy', 'consentAudit', {
      consents: rows.map((x) => ({ subject: x.subject, status: x.status, expiry: x.expiry || undefined })),
    });
    if (r.data.ok && r.data.result) setRes(r.data.result);
    else setError(r.data.error || 'analysis failed');
    setBusy(false);
  }, [rows]);

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-400">
        Audit your consent register — active vs. expired vs. withdrawn — and get a compliance rate with re-consent flags.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Data subject id…" className={cn(inputCls, 'flex-1 min-w-[140px]')} />
        <select value={status} onChange={(e) => setStatus(e.target.value)} className={inputCls}>
          <option value="active">active</option>
          <option value="withdrawn">withdrawn</option>
          <option value="pending">pending</option>
        </select>
        <input type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} className={inputCls} title="Optional expiry" />
        <button onClick={add} className={runBtnCls}><Plus className="w-3 h-3" /> Add</button>
      </div>
      <div className="space-y-1">
        {rows.length === 0 && <span className="text-xs text-gray-500">No consent records.</span>}
        {rows.map((r, i) => (
          <div key={`${r.subject}-${i}`} className="flex items-center justify-between rounded-lg border border-white/5 bg-black/30 px-2.5 py-1.5">
            <span className="text-[11px] text-gray-200">{r.subject} · <span className="text-gray-400">{r.status}</span>{r.expiry ? <span className="text-gray-500"> · exp {r.expiry}</span> : null}</span>
            <button onClick={() => setRows((rr) => rr.filter((_, j) => j !== i))} className="text-gray-500 hover:text-rose-400" aria-label={`Remove consent record for ${r.subject}`}><Trash2 className="w-3 h-3" aria-hidden="true" /></button>
          </div>
        ))}
      </div>
      <button onClick={run} disabled={busy || rows.length === 0} className={runBtnCls}>
        {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <ClipboardCheck className="w-3 h-3" />} Run audit
      </button>
      {error && <p className="text-xs text-rose-400">{error}</p>}
      {res && (
        <div className="rounded-lg border border-neon-blue/20 bg-black/30 p-3 space-y-2">
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <span className="text-gray-400">Total: <span className="font-mono text-white">{res.totalConsents}</span></span>
            <span className="text-gray-400">Active: <span className="font-mono text-emerald-400">{res.active}</span></span>
            <span className="text-gray-400">Expired: <span className="font-mono text-rose-400">{res.expired}</span></span>
            <span className="text-gray-400">Withdrawn: <span className="font-mono text-gray-300">{res.withdrawn}</span></span>
            <span className="text-gray-400">Compliance: <span className={cn('font-mono', res.complianceRate >= 90 ? 'text-emerald-400' : res.complianceRate >= 60 ? 'text-amber-400' : 'text-rose-400')}>{res.complianceRate}%</span></span>
          </div>
          <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
            <div className={cn('h-full transition-all duration-500', res.complianceRate >= 90 ? 'bg-emerald-500' : res.complianceRate >= 60 ? 'bg-amber-500' : 'bg-rose-500')} style={{ width: `${res.complianceRate}%` }} />
          </div>
          <p className="text-[11px] text-gray-300">{res.action}</p>
          {res.issues.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {res.issues.map((iss, i) => (
                <span key={i} className="rounded bg-rose-500/10 border border-rose-500/25 px-1.5 py-0.5 text-[10px] text-rose-300">{iss.user} · expired {iss.expiredOn}</span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── DPIA tool ──────────────────────────────────────────────────────────────

function DpiaTool() {
  const [dataTypes, setDataTypes] = useState<string[]>(['health', 'location']);
  const [dt, setDt] = useState('');
  const [purposes, setPurposes] = useState<string[]>(['service_delivery']);
  const [pp, setPp] = useState('');
  const [involvesMinors, setInvolvesMinors] = useState(false);
  const [crossBorder, setCrossBorder] = useState(false);
  const [res, setRes] = useState<DpiaResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async () => {
    setBusy(true);
    setError(null);
    const r = await lensRun<DpiaResult>('privacy', 'impactAssessment', {
      dataTypes,
      purposes,
      involvesMinors,
      crossBorderTransfer: crossBorder,
    });
    if (r.data.ok && r.data.result) setRes(r.data.result);
    else setError(r.data.error || 'analysis failed');
    setBusy(false);
  }, [dataTypes, purposes, involvesMinors, crossBorder]);

  const chipField = (
    label: string,
    values: string[],
    setValues: (v: string[]) => void,
    draft: string,
    setDraft: (v: string) => void,
    placeholder: string,
  ) => (
    <div className="space-y-1.5">
      <p className="text-[11px] uppercase tracking-wider text-gray-500">{label}</p>
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && draft.trim()) { setValues([...values, draft.trim()]); setDraft(''); } }}
          placeholder={placeholder}
          className={cn(inputCls, 'flex-1 min-w-[140px]')}
        />
        <button onClick={() => { if (draft.trim()) { setValues([...values, draft.trim()]); setDraft(''); } }} className={runBtnCls} aria-label={`Add ${label.toLowerCase()}`}><Plus className="w-3 h-3" aria-hidden="true" /></button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {values.map((v, i) => (
          <span key={`${v}-${i}`} className="inline-flex items-center gap-1 rounded bg-white/5 border border-white/10 px-2 py-0.5 text-[11px] text-gray-300">
            {v}
            <button onClick={() => setValues(values.filter((_, j) => j !== i))} className="opacity-60 hover:opacity-100" aria-label={`Remove ${label.toLowerCase()} "${v}"`}><X className="w-2.5 h-2.5" aria-hidden="true" /></button>
          </span>
        ))}
      </div>
    </div>
  );

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-400">
        Article 35 Data Protection Impact Assessment — enumerate processing scope and get an automatic DPIA-required determination with mitigations.
      </p>
      {chipField('Data types processed', dataTypes, setDataTypes, dt, setDt, 'e.g. biometric, financial…')}
      {chipField('Processing purposes', purposes, setPurposes, pp, setPp, 'e.g. fraud_prevention…')}
      <div className="flex flex-wrap gap-4">
        <label className="flex items-center gap-1.5 text-xs text-gray-300 cursor-pointer">
          <input type="checkbox" checked={involvesMinors} onChange={(e) => setInvolvesMinors(e.target.checked)} className="accent-neon-blue" /> Involves minors
        </label>
        <label className="flex items-center gap-1.5 text-xs text-gray-300 cursor-pointer">
          <input type="checkbox" checked={crossBorder} onChange={(e) => setCrossBorder(e.target.checked)} className="accent-neon-blue" /> Cross-border transfer
        </label>
      </div>
      <button onClick={run} disabled={busy} className={runBtnCls}>
        {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <ShieldAlert className="w-3 h-3" />} Assess impact
      </button>
      {error && <p className="text-xs text-rose-400">{error}</p>}
      {res && (
        <div className="rounded-lg border border-neon-blue/20 bg-black/30 p-3 space-y-2">
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <RiskBadge level={res.riskLevel} />
            <span className={cn('inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider border', res.dpiaRequired ? 'bg-rose-500/15 text-rose-300 border-rose-500/30' : 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30')}>
              {res.dpiaRequired ? 'DPIA required' : 'DPIA not required'}
            </span>
            <span className="text-gray-400">Data types: <span className="font-mono text-white">{res.dataTypesCount}</span></span>
            <span className="text-gray-400">Purposes: <span className="font-mono text-white">{res.purposes}</span></span>
          </div>
          {res.riskFactors.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {res.riskFactors.map((f) => <span key={f} className="rounded bg-rose-500/10 border border-rose-500/25 px-1.5 py-0.5 text-[10px] text-rose-300">{f}</span>)}
            </div>
          )}
          {res.mitigations.length > 0 && (
            <ul className="space-y-1">
              {res.mitigations.map((m, i) => (
                <li key={i} className="text-[11px] text-gray-300">
                  <span className="text-amber-400">{m.risk}</span> → {m.mitigation}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

// ── Breach Response tool ───────────────────────────────────────────────────

const TIMELINE_LABELS: Record<string, string> = {
  immediate: 'Immediately',
  within24h: 'Within 24 hours',
  within72h: 'Within 72 hours',
  within30d: 'Within 30 days',
};

function BreachTool() {
  const [severity, setSeverity] = useState('high');
  const [affected, setAffected] = useState('1500');
  const [types, setTypes] = useState<string[]>(['email', 'password_hash']);
  const [dt, setDt] = useState('');
  const [res, setRes] = useState<BreachResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async () => {
    setBusy(true);
    setError(null);
    const r = await lensRun<BreachResult>('privacy', 'breachResponse', {
      severity,
      affectedUsers: parseInt(affected) || 0,
      compromisedData: types,
    });
    if (r.data.ok && r.data.result) setRes(r.data.result);
    else setError(r.data.error || 'analysis failed');
    setBusy(false);
  }, [severity, affected, types]);

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-400">
        Article 33 breach-response playbook — declare a breach and get the regulatory notification clock and a phased remediation runbook.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <select value={severity} onChange={(e) => setSeverity(e.target.value)} className={inputCls}>
          <option value="low">low severity</option>
          <option value="medium">medium severity</option>
          <option value="high">high severity</option>
          <option value="critical">critical severity</option>
        </select>
        <input value={affected} onChange={(e) => setAffected(e.target.value.replace(/[^0-9]/g, ''))} inputMode="numeric" placeholder="Affected users" className={cn(inputCls, 'w-32')} />
        <input
          value={dt}
          onChange={(e) => setDt(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && dt.trim()) { setTypes([...types, dt.trim()]); setDt(''); } }}
          placeholder="Compromised data type + Enter…"
          className={cn(inputCls, 'flex-1 min-w-[160px]')}
        />
      </div>
      <div className="flex flex-wrap gap-1.5">
        {types.map((t, i) => (
          <span key={`${t}-${i}`} className="inline-flex items-center gap-1 rounded bg-rose-500/10 border border-rose-500/25 px-2 py-0.5 text-[11px] text-rose-300">
            {t}
            <button onClick={() => setTypes(types.filter((_, j) => j !== i))} className="opacity-60 hover:opacity-100" aria-label={`Remove compromised data type "${t}"`}><X className="w-2.5 h-2.5" aria-hidden="true" /></button>
          </span>
        ))}
      </div>
      <button onClick={run} disabled={busy} className={runBtnCls}>
        {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Siren className="w-3 h-3" />} Generate response plan
      </button>
      {error && <p className="text-xs text-rose-400">{error}</p>}
      {res && (
        <div className="rounded-lg border border-neon-blue/20 bg-black/30 p-3 space-y-3">
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <span className="text-gray-400">Severity: <span className={cn('font-mono uppercase', riskTone(res.severity))}>{res.severity}</span></span>
            <span className="text-gray-400">Affected: <span className="font-mono text-white">{res.affectedUsers.toLocaleString()}</span></span>
            <span className={cn('inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider border', res.notificationRequired ? 'bg-rose-500/15 text-rose-300 border-rose-500/30' : 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30')}>
              {res.notificationRequired ? <AlertTriangle className="w-2.5 h-2.5" /> : <CheckCircle2 className="w-2.5 h-2.5" />}
              {res.notificationRequired ? 'Notification required' : 'No notification'}
            </span>
            <span className="text-neon-blue text-[11px]">Deadline: {res.regulatoryDeadline}</span>
          </div>
          <div className="space-y-2">
            {Object.entries(res.timeline).map(([phase, steps]) => (
              <div key={phase} className="rounded-lg border border-white/5 bg-white/[0.02] p-2">
                <p className="text-[11px] font-semibold text-neon-blue mb-1">{TIMELINE_LABELS[phase] || phase}</p>
                <ul className="space-y-0.5">
                  {steps.map((s, i) => <li key={i} className="text-[11px] text-gray-300 flex gap-1.5"><span className="text-gray-600">›</span>{s}</li>)}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Panel ──────────────────────────────────────────────────────────────────

export function DpoStudioPanel() {
  const [tool, setTool] = useState<ToolId>('inventory');

  return (
    <div className={cn(ds.hudPanel, 'p-4 space-y-4')}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-white flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-neon-blue" /> DPO Compliance Studio
          </h2>
          <p className="text-xs text-gray-400">GDPR data-protection-officer tooling — inventory, consent, DPIA and breach response.</p>
        </div>
      </div>

      {/* Tool selector */}
      <div className="flex flex-wrap gap-1.5">
        {TOOLS.map((t) => {
          const active = tool === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTool(t.id)}
              className={cn(
                'flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs transition-colors',
                active
                  ? 'bg-neon-blue/20 border-neon-blue/40 text-white'
                  : 'bg-white/[0.02] border-white/10 text-gray-400 hover:bg-white/5 hover:text-gray-200',
              )}
            >
              <t.icon className="w-3.5 h-3.5" />
              <span>{t.label}</span>
              <span className="hidden sm:inline text-[10px] text-gray-500">· {t.hint}</span>
            </button>
          );
        })}
      </div>

      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
        {tool === 'inventory' && <InventoryTool />}
        {tool === 'consent' && <ConsentTool />}
        {tool === 'dpia' && <DpiaTool />}
        {tool === 'breach' && <BreachTool />}
      </div>
    </div>
  );
}
