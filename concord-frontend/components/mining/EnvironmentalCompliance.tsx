'use client';

/**
 * EnvironmentalCompliance — permit/inspection compliance tracking plus a
 * per-site reclamation status (bond, phase, disturbed/reclaimed acreage).
 * Closes the "environmental compliance / reclamation tracking" gap
 * (docs/lens-specs/mining-capability-map.md): the previous "Environmental"
 * tab was 100% fake generic-CRUD (client-invented fields, no real state)
 * and was removed rather than kept as a fake surface. This is the real
 * build against `mining.compliance-*` / `mining.reclamation-*`
 * (server/domains/mining.js) — no client-invented fields.
 *
 * The site picker is sourced live from `mining.site-list`, never free
 * text — same discipline as the insurance lens's ProducerCompliance
 * panel. Category + status are real selects, not a JSON textarea: this
 * is an MSHA-adjacent regulatory-risk panel, so violations/overdue items
 * must be visible at a glance, not buried in a form.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ShieldCheck, Plus, Loader2, AlertTriangle, Sprout } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

type ComplianceCategory =
  | 'air_quality_permit' | 'water_discharge_permit' | 'tailings_management'
  | 'land_disturbance_permit' | 'blasting_permit' | 'reclamation_bond' | 'other';
type ComplianceStatus = 'compliant' | 'violation' | 'pending_review';
type ReclamationPhase = 'not_started' | 'planning' | 'in_progress' | 'completed';
type BondStatus = 'not_posted' | 'posted' | 'released' | 'forfeited';

interface Site { id: string; name: string; status: string }

interface ComplianceRecord {
  id: string;
  siteId: string;
  siteName: string;
  category: ComplianceCategory;
  status: ComplianceStatus;
  permitNumber: string | null;
  issuingAgency: string | null;
  inspectionDate: string;
  expiryDate: string | null;
  notes: string | null;
  isOverdue: boolean;
  daysUntilExpiry: number | null;
  createdAt: string;
  updatedAt: string;
}

interface Reclamation {
  phase: ReclamationPhase;
  acresDisturbed: number;
  acresReclaimed: number;
  bondAmount: number;
  bondStatus: BondStatus;
}

const CATEGORIES: { id: ComplianceCategory; label: string }[] = [
  { id: 'air_quality_permit', label: 'Air Quality Permit' },
  { id: 'water_discharge_permit', label: 'Water Discharge Permit' },
  { id: 'tailings_management', label: 'Tailings Management' },
  { id: 'land_disturbance_permit', label: 'Land Disturbance Permit' },
  { id: 'blasting_permit', label: 'Blasting Permit' },
  { id: 'reclamation_bond', label: 'Reclamation Bond' },
  { id: 'other', label: 'Other' },
];
const CATEGORY_LABEL: Record<ComplianceCategory, string> = CATEGORIES.reduce(
  (acc, c) => ({ ...acc, [c.id]: c.label }),
  {} as Record<ComplianceCategory, string>,
);

const STATUSES: { id: ComplianceStatus; label: string }[] = [
  { id: 'compliant', label: 'Compliant' },
  { id: 'pending_review', label: 'Pending Review' },
  { id: 'violation', label: 'Violation' },
];
const STATUS_LABEL: Record<ComplianceStatus, string> = {
  compliant: 'Compliant', violation: 'Violation', pending_review: 'Pending Review',
};
// violation=red, pending_review=amber, compliant=emerald — a regulatory-risk
// panel, so a violation must read as unambiguously urgent at a glance.
const STATUS_BADGE: Record<ComplianceStatus, string> = {
  violation: 'bg-red-500/20 text-red-300 border border-red-500/30',
  pending_review: 'bg-amber-500/20 text-amber-300 border border-amber-500/30',
  compliant: 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30',
};

const PHASES: { id: ReclamationPhase; label: string }[] = [
  { id: 'not_started', label: 'Not Started' },
  { id: 'planning', label: 'Planning' },
  { id: 'in_progress', label: 'In Progress' },
  { id: 'completed', label: 'Completed' },
];
const PHASE_LABEL: Record<ReclamationPhase, string> = PHASES.reduce(
  (acc, p) => ({ ...acc, [p.id]: p.label }),
  {} as Record<ReclamationPhase, string>,
);

const BOND_STATUSES: { id: BondStatus; label: string }[] = [
  { id: 'not_posted', label: 'Not Posted' },
  { id: 'posted', label: 'Posted' },
  { id: 'released', label: 'Released' },
  { id: 'forfeited', label: 'Forfeited' },
];
const BOND_LABEL: Record<BondStatus, string> = BOND_STATUSES.reduce(
  (acc, b) => ({ ...acc, [b.id]: b.label }),
  {} as Record<BondStatus, string>,
);
const BOND_BADGE: Record<BondStatus, string> = {
  not_posted: 'bg-white/5 text-zinc-400 border border-white/10',
  posted: 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30',
  released: 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30',
  forfeited: 'bg-red-500/20 text-red-300 border border-red-500/30',
};

const inputCls = 'px-2 py-1.5 bg-zinc-950 border border-zinc-800 rounded text-zinc-200 text-xs w-full';
const btnPrimary = 'px-3 py-1.5 rounded bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-1.5';

const EMPTY_FORM = {
  category: 'air_quality_permit' as ComplianceCategory,
  status: 'pending_review' as ComplianceStatus,
  permitNumber: '', issuingAgency: '', inspectionDate: '', expiryDate: '', notes: '',
};

const DEFAULT_RECLAMATION: Reclamation = {
  phase: 'not_started', acresDisturbed: 0, acresReclaimed: 0, bondAmount: 0, bondStatus: 'not_posted',
};

function failMessage(r: { data?: { ok?: boolean; result?: unknown; error?: string | null } }, fallback: string): string | null {
  const resultOk = (r.data?.result as { ok?: boolean } | null)?.ok;
  if (r.data?.ok === false || resultOk === false) {
    return ((r.data?.result as { error?: string } | null)?.error) || r.data?.error || fallback;
  }
  return null;
}

export function EnvironmentalCompliance() {
  const [sites, setSites] = useState<Site[]>([]);
  const [siteId, setSiteId] = useState('');
  const [records, setRecords] = useState<ComplianceRecord[]>([]);
  const [violationCount, setViolationCount] = useState(0);
  const [overdueCount, setOverdueCount] = useState(0);
  const [byCategory, setByCategory] = useState<Record<string, number>>({});
  const [reclamation, setReclamation] = useState<Reclamation | null>(null);
  const [loadingSites, setLoadingSites] = useState(true);
  const [loadingSiteData, setLoadingSiteData] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [reclForm, setReclForm] = useState({
    phase: 'not_started' as ReclamationPhase,
    acresDisturbed: '', acresReclaimed: '', bondAmount: '',
    bondStatus: 'not_posted' as BondStatus,
  });

  const refreshSiteData = useCallback(async (id: string) => {
    if (!id) {
      setRecords([]); setReclamation(null);
      setViolationCount(0); setOverdueCount(0); setByCategory({});
      return;
    }
    setLoadingSiteData(true);
    try {
      const [cl, rl] = await Promise.all([
        lensRun<{ records: ComplianceRecord[]; violationCount: number; overdueCount: number; byCategory: Record<string, number> }>(
          'mining', 'compliance-list', { siteId: id },
        ),
        lensRun<{ sites: { siteId: string; reclamation: Reclamation }[] }>('mining', 'reclamation-list', {}),
      ]);
      if (cl.data?.ok && cl.data.result) {
        setRecords(cl.data.result.records || []);
        setViolationCount(cl.data.result.violationCount || 0);
        setOverdueCount(cl.data.result.overdueCount || 0);
        setByCategory(cl.data.result.byCategory || {});
      }
      const match = rl.data?.result?.sites?.find((s) => s.siteId === id) || null;
      const recl = match?.reclamation || null;
      setReclamation(recl);
      setReclForm({
        phase: recl?.phase || 'not_started',
        acresDisturbed: recl ? String(recl.acresDisturbed) : '',
        acresReclaimed: recl ? String(recl.acresReclaimed) : '',
        bondAmount: recl ? String(recl.bondAmount) : '',
        bondStatus: recl?.bondStatus || 'not_posted',
      });
    } finally {
      setLoadingSiteData(false);
    }
  }, []);

  const refreshSites = useCallback(async () => {
    const r = await lensRun<{ sites: Site[] }>('mining', 'site-list', {});
    const list = (r.data?.result?.sites) || [];
    setSites(list);
    return list;
  }, []);

  useEffect(() => {
    (async () => {
      const list = await refreshSites();
      setSiteId((prev) => prev || (list.length > 0 ? list[0].id : ''));
      setLoadingSites(false);
    })();
    // Site roster is fetched once on mount; the picker is re-hydrated via refreshSites().
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { void refreshSiteData(siteId); }, [siteId, refreshSiteData]);

  async function addRecord() {
    setError(null);
    if (!siteId) { setError('Select a mine site first.'); return; }
    setBusy(true);
    try {
      const r = await lensRun('mining', 'compliance-log', {
        siteId, category: form.category, status: form.status,
        permitNumber: form.permitNumber.trim() || undefined,
        issuingAgency: form.issuingAgency.trim() || undefined,
        inspectionDate: form.inspectionDate || undefined,
        expiryDate: form.expiryDate || undefined,
        notes: form.notes.trim() || undefined,
      });
      const msg = failMessage(r, 'Could not log compliance record.');
      if (msg) { setError(msg); return; }
      setForm({ ...EMPTY_FORM, category: form.category });
      await refreshSiteData(siteId);
    } finally {
      setBusy(false);
    }
  }

  async function saveReclamation() {
    if (!siteId) return;
    setError(null);
    setBusy(true);
    try {
      const params: Record<string, unknown> = { siteId, phase: reclForm.phase, bondStatus: reclForm.bondStatus };
      if (reclForm.acresDisturbed !== '') params.acresDisturbed = Number(reclForm.acresDisturbed);
      if (reclForm.acresReclaimed !== '') params.acresReclaimed = Number(reclForm.acresReclaimed);
      if (reclForm.bondAmount !== '') params.bondAmount = Number(reclForm.bondAmount);
      const r = await lensRun('mining', 'reclamation-update', params);
      const msg = failMessage(r, 'Could not update reclamation status.');
      if (msg) { setError(msg); return; }
      await refreshSiteData(siteId);
    } finally {
      setBusy(false);
    }
  }

  const activeReclamation = reclamation || DEFAULT_RECLAMATION;
  const reclamationPercent = useMemo(() => {
    if (activeReclamation.acresDisturbed <= 0) return 0;
    return Math.round((activeReclamation.acresReclaimed / activeReclamation.acresDisturbed) * 100);
  }, [activeReclamation]);

  if (loadingSites) {
    return <div className="flex items-center justify-center py-6 text-zinc-400"><Loader2 className="w-4 h-4 animate-spin" /></div>;
  }

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4 space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <ShieldCheck className="w-4 h-4 text-amber-400" />
        <h3 className="text-sm font-bold text-zinc-100">Environmental Compliance &amp; Reclamation</h3>
        <select
          aria-label="Mine site"
          className={cn(inputCls, 'ml-auto max-w-[220px]')}
          value={siteId}
          onChange={(e) => setSiteId(e.target.value)}
        >
          <option value="">Select mine site…</option>
          {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>

      {sites.length === 0 && (
        <p className="text-xs text-zinc-400 italic py-3 text-center">Add a mine site (Sites &amp; Safety tab) to track compliance.</p>
      )}

      {siteId && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <div className={cn('rounded-lg p-2.5 text-center', violationCount > 0 ? 'bg-red-500/10 border border-red-500/30' : 'bg-zinc-900/60 border border-zinc-800')}>
              <div className={cn('text-lg font-bold tabular-nums flex items-center justify-center gap-1', violationCount > 0 ? 'text-red-300' : 'text-zinc-100')}>
                {violationCount > 0 && <AlertTriangle className="w-4 h-4" />}
                {violationCount}
              </div>
              <div className="text-[9px] uppercase tracking-wider text-zinc-400">Violations</div>
            </div>
            <div className={cn('rounded-lg p-2.5 text-center', overdueCount > 0 ? 'bg-amber-500/10 border border-amber-500/30' : 'bg-zinc-900/60 border border-zinc-800')}>
              <div className={cn('text-lg font-bold tabular-nums', overdueCount > 0 ? 'text-amber-300' : 'text-zinc-100')}>{overdueCount}</div>
              <div className="text-[9px] uppercase tracking-wider text-zinc-400">Overdue renewals</div>
            </div>
            <div className="rounded-lg p-2.5 text-center bg-zinc-900/60 border border-zinc-800">
              <div className="text-lg font-bold tabular-nums text-zinc-100">{records.length}</div>
              <div className="text-[9px] uppercase tracking-wider text-zinc-400">Tracked records</div>
            </div>
            <div className="rounded-lg p-2.5 text-center bg-zinc-900/60 border border-zinc-800">
              <div className="text-lg font-bold tabular-nums text-amber-300">{reclamationPercent}%</div>
              <div className="text-[9px] uppercase tracking-wider text-zinc-400">Reclaimed</div>
            </div>
          </div>

          {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

          {/* Reclamation status */}
          <div className="border border-zinc-800 rounded-lg p-3 space-y-2">
            <div className="flex items-center gap-2">
              <Sprout className="w-3.5 h-3.5 text-emerald-400" />
              <span className="text-[11px] uppercase tracking-wider text-zinc-400 font-semibold">Reclamation status</span>
              <span className="ml-auto text-[10px] px-2 py-0.5 rounded-full bg-zinc-900/80 text-zinc-300 border border-zinc-800">
                {PHASE_LABEL[reclForm.phase]}
              </span>
            </div>
            <div
              className="h-2 w-full rounded-full bg-zinc-900 overflow-hidden"
              role="progressbar"
              aria-valuenow={reclamationPercent}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Acres reclaimed"
            >
              <div className="h-full rounded-full bg-emerald-500" style={{ width: `${reclamationPercent}%` }} />
            </div>
            <p className="text-[10px] text-zinc-500">
              {reclamation
                ? `${reclamation.acresReclaimed} / ${reclamation.acresDisturbed} acres reclaimed`
                : 'No reclamation activity recorded yet.'}
            </p>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
              <select aria-label="Reclamation phase" className={inputCls} value={reclForm.phase} onChange={(e) => setReclForm((f) => ({ ...f, phase: e.target.value as ReclamationPhase }))}>
                {PHASES.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
              <input aria-label="Acres disturbed" className={inputCls} type="number" placeholder="Acres disturbed" value={reclForm.acresDisturbed} onChange={(e) => setReclForm((f) => ({ ...f, acresDisturbed: e.target.value }))} />
              <input aria-label="Acres reclaimed" className={inputCls} type="number" placeholder="Acres reclaimed" value={reclForm.acresReclaimed} onChange={(e) => setReclForm((f) => ({ ...f, acresReclaimed: e.target.value }))} />
              <input aria-label="Bond amount" className={inputCls} type="number" placeholder="Bond amount ($)" value={reclForm.bondAmount} onChange={(e) => setReclForm((f) => ({ ...f, bondAmount: e.target.value }))} />
              <select aria-label="Bond status" className={inputCls} value={reclForm.bondStatus} onChange={(e) => setReclForm((f) => ({ ...f, bondStatus: e.target.value as BondStatus }))}>
                {BOND_STATUSES.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <span className={cn('text-[9px] px-1.5 py-0.5 rounded font-medium', BOND_BADGE[reclForm.bondStatus])}>
                Bond: {BOND_LABEL[reclForm.bondStatus]}
              </span>
              <button onClick={() => void saveReclamation()} disabled={busy} className={cn(btnPrimary, 'ml-auto')}>
                {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null} Save reclamation status
              </button>
            </div>
          </div>

          {/* Compliance record add form */}
          <div className="border border-zinc-800 rounded-lg p-3 space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <select aria-label="Compliance category" className={inputCls} value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value as ComplianceCategory }))}>
                {CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
              <select aria-label="Compliance status" className={inputCls} value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as ComplianceStatus }))}>
                {STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <input className={inputCls} placeholder="Permit number" value={form.permitNumber} onChange={(e) => setForm((f) => ({ ...f, permitNumber: e.target.value }))} />
              <input className={inputCls} placeholder="Issuing agency" value={form.issuingAgency} onChange={(e) => setForm((f) => ({ ...f, issuingAgency: e.target.value }))} />
              <label className="flex flex-col gap-0.5 text-[10px] text-zinc-500">
                Inspection date
                <input type="date" className={inputCls} value={form.inspectionDate} onChange={(e) => setForm((f) => ({ ...f, inspectionDate: e.target.value }))} />
              </label>
              <label className="flex flex-col gap-0.5 text-[10px] text-zinc-500">
                Expiry / renewal date
                <input type="date" className={inputCls} value={form.expiryDate} onChange={(e) => setForm((f) => ({ ...f, expiryDate: e.target.value }))} />
              </label>
            </div>
            <input className={inputCls} placeholder="Notes (optional)" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
            <button onClick={() => void addRecord()} disabled={busy} className={cn(btnPrimary, 'w-full justify-center')}>
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Log compliance record
            </button>
          </div>

          {Object.keys(byCategory).length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(byCategory).map(([cat, count]) => (
                <span key={cat} className="text-[10px] px-2 py-1 rounded-full bg-zinc-900/80 text-zinc-300 border border-zinc-800">
                  {CATEGORY_LABEL[cat as ComplianceCategory] || cat}: <span className="font-semibold text-zinc-100">{count}</span>
                </span>
              ))}
            </div>
          )}

          {loadingSiteData ? (
            <div className="px-3 py-6 text-center text-xs text-zinc-400"><Loader2 className="w-4 h-4 animate-spin inline mr-2" />Loading…</div>
          ) : records.length === 0 ? (
            <div className="px-3 py-8 text-center text-xs text-zinc-400 border border-zinc-800 rounded-lg">
              No compliance records logged for this site yet.
            </div>
          ) : (
            <ul className="space-y-2">
              {records.map((rec) => (
                <li key={rec.id} className="border border-zinc-800 rounded-lg px-3 py-2">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300 font-bold uppercase">{CATEGORY_LABEL[rec.category]}</span>
                    <span className={cn('text-[9px] px-1.5 py-0.5 rounded font-medium', STATUS_BADGE[rec.status])}>{STATUS_LABEL[rec.status]}</span>
                    {rec.isOverdue && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded font-medium bg-red-500/20 text-red-300 border border-red-500/30">Overdue</span>
                    )}
                  </div>
                  <p className="text-[11px] text-zinc-400 mt-1">
                    {rec.permitNumber ? `#${rec.permitNumber} · ` : ''}{rec.issuingAgency || 'agency n/a'} · inspected {rec.inspectionDate}
                    {rec.expiryDate ? ` · expires ${rec.expiryDate}${rec.daysUntilExpiry != null ? ` (${rec.daysUntilExpiry}d)` : ''}` : ''}
                  </p>
                  {rec.notes && <p className="text-[10px] text-zinc-500 mt-0.5">{rec.notes}</p>}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

export default EnvironmentalCompliance;
