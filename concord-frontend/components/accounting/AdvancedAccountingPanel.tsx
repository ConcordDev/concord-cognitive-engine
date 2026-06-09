'use client';

/**
 * AdvancedAccountingPanel — 2026 QuickBooks-parity features:
 * live bank feeds, multi-currency FX, dimensional tagging, payroll
 * tax e-filing + ACH, recurring bills, receipt OCR, edit audit log,
 * and 1099/W-2 IRS FIRE export. All data is real user input or
 * computed from real platform state — no seed/mock data.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Loader2, Plus, Trash2, RefreshCw, Banknote, Globe, Tags, Landmark,
  CalendarClock, ScanLine, History, FileDown, Check, AlertTriangle, Link2,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';

type FeatureTab =
  | 'bankfeed' | 'currency' | 'dimensions' | 'payrolltax'
  | 'recurringbills' | 'receipt' | 'auditlog' | 'efiling';

const FEATURE_TABS: { id: FeatureTab; label: string; icon: typeof Banknote }[] = [
  { id: 'bankfeed',       label: 'Bank feeds',     icon: Banknote },
  { id: 'currency',       label: 'Multi-currency', icon: Globe },
  { id: 'dimensions',     label: 'Dimensions',     icon: Tags },
  { id: 'payrolltax',     label: 'Payroll tax',    icon: Landmark },
  { id: 'recurringbills', label: 'Recurring bills', icon: CalendarClock },
  { id: 'receipt',        label: 'Receipt OCR',    icon: ScanLine },
  { id: 'auditlog',       label: 'Audit log',      icon: History },
  { id: 'efiling',        label: '1099 / W-2',     icon: FileDown },
];

const inp = 'w-full bg-black/40 border border-white/10 rounded px-2 py-1.5 text-xs text-gray-100';
const btn = 'inline-flex items-center justify-center gap-1 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-xs font-medium rounded px-3 py-1.5';
const btnGhost = 'inline-flex items-center gap-1 px-2.5 py-1 rounded border border-white/10 text-xs text-gray-300 hover:text-white hover:bg-white/5';

function Spin() {
  return <div className="flex items-center justify-center py-8 text-gray-400"><Loader2 className="w-4 h-4 animate-spin" /></div>;
}
function Empty({ text }: { text: string }) {
  return <p className="text-[11px] text-gray-400 italic py-2">{text}</p>;
}
function Err({ text }: { text: string }) {
  return <p className="text-[11px] text-rose-300 flex items-start gap-1 py-1"><AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />{text}</p>;
}
const money = (n: number) => `$${(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function AdvancedAccountingPanel() {
  const [tab, setTab] = useState<FeatureTab>('bankfeed');
  return (
    <div className="p-3 space-y-3">
      <nav className="flex flex-wrap items-center gap-1">
        {FEATURE_TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={[
                'inline-flex items-center gap-1.5 px-2 py-1 text-[11px] rounded transition',
                active
                  ? 'bg-emerald-500/15 text-emerald-200 border border-emerald-500/40'
                  : 'text-gray-400 hover:text-gray-200 border border-transparent',
              ].join(' ')}
            >
              <Icon className="w-3 h-3" />
              {t.label}
            </button>
          );
        })}
      </nav>
      <div>
        {tab === 'bankfeed' && <BankFeedTab />}
        {tab === 'currency' && <CurrencyTab />}
        {tab === 'dimensions' && <DimensionsTab />}
        {tab === 'payrolltax' && <PayrollTaxTab />}
        {tab === 'recurringbills' && <RecurringBillsTab />}
        {tab === 'receipt' && <ReceiptTab />}
        {tab === 'auditlog' && <AuditLogTab />}
        {tab === 'efiling' && <EfilingTab />}
      </div>
    </div>
  );
}

/* ── Bank feeds — live aggregator institution links ─────────────────── */

interface Institution {
  id: string; name: string; accountMask: string; status: string;
  linkedAt: string; lastSyncAt: string | null; lastSyncCount: number;
}

function BankFeedTab() {
  const [list, setList] = useState<Institution[]>([]);
  const [configured, setConfigured] = useState(false);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [mask, setMask] = useState('');
  const [extId, setExtId] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [syncing, setSyncing] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await lensRun('accounting', 'bank-feeds-institutions-list', {});
    if (r.data?.ok && r.data.result) {
      setList(r.data.result.institutions || []);
      setConfigured(Boolean(r.data.result.aggregatorConfigured));
    }
    setLoading(false);
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const link = async () => {
    setErr(null);
    if (!name.trim()) return;
    const r = await lensRun('accounting', 'bank-feeds-link-institution', {
      name: name.trim(), accountMask: mask.trim(), externalAccountId: extId.trim(),
    });
    if (r.data?.ok) { setName(''); setMask(''); setExtId(''); await refresh(); }
    else setErr(r.data?.error || 'Failed to link institution');
  };
  const sync = async (id: string) => {
    setErr(null); setSyncing(id);
    const r = await lensRun('accounting', 'bank-feeds-sync', { id });
    if (!r.data?.ok) setErr(r.data?.error || 'Sync failed');
    setSyncing(null);
    await refresh();
  };
  const unlink = async (id: string) => {
    await lensRun('accounting', 'bank-feeds-unlink-institution', { id });
    await refresh();
  };

  if (loading) return <Spin />;
  return (
    <div className="space-y-3">
      <div className={[
        'text-[11px] px-2.5 py-1.5 rounded border',
        configured
          ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-300'
          : 'border-amber-500/30 bg-amber-500/5 text-amber-300',
      ].join(' ')}>
        {configured
          ? 'Live aggregator configured — sync pulls real transactions.'
          : 'Live aggregator not configured. Set CONCORD_BANK_AGGREGATOR_URL + token env to enable real bank-feed sync.'}
      </div>
      <section className="bg-black/30 border border-white/10 rounded-lg p-3 space-y-2">
        <h3 className="text-xs font-semibold text-gray-300">Link an institution</h3>
        <input className={inp} placeholder="Institution name (e.g. Chase Business)" value={name} onChange={(e) => setName(e.target.value)} />
        <div className="grid grid-cols-2 gap-2">
          <input className={inp} placeholder="Account mask (last 4)" value={mask} onChange={(e) => setMask(e.target.value)} />
          <input className={inp} placeholder="External account id" value={extId} onChange={(e) => setExtId(e.target.value)} />
        </div>
        <button type="button" className={btn} onClick={link} disabled={!name.trim()}>
          <Link2 className="w-3.5 h-3.5" /> Link account
        </button>
        {err && <Err text={err} />}
      </section>
      {list.length === 0 ? <Empty text="No linked institutions yet." /> : (
        <ul className="space-y-1.5">
          {list.map((i) => (
            <li key={i.id} className="bg-black/20 border border-white/10 rounded-lg p-2.5">
              <div className="flex items-center gap-2">
                <Banknote className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span className="text-xs text-gray-200 flex-1 truncate">
                  {i.name}{i.accountMask ? ` ····${i.accountMask}` : ''}
                </span>
                <button type="button" onClick={() => sync(i.id)} disabled={syncing === i.id} className={btnGhost}>
                  {syncing === i.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />} Sync
                </button>
                <button aria-label="Delete" type="button" onClick={() => unlink(i.id)} className="text-gray-600 hover:text-rose-400">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
              <p className="text-[10px] text-gray-400 mt-0.5">
                {i.lastSyncAt
                  ? `Last sync ${i.lastSyncAt.slice(0, 10)} · ${i.lastSyncCount} txn(s)`
                  : 'Never synced'}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ── Multi-currency + FX revaluation ────────────────────────────────── */

interface FxRate { code: string; rate: number; updatedAt: string }
interface RevalLine {
  label: string; currency: string; foreignBalance: number; bookedRate: number;
  currentRate: number; bookedValue: number; currentValue: number; gainLoss: number;
}

function CurrencyTab() {
  const [base, setBase] = useState('USD');
  const [rates, setRates] = useState<FxRate[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [positions, setPositions] = useState<{ label: string; currency: string; foreignBalance: string; bookedRate: string }[]>([
    { label: '', currency: 'EUR', foreignBalance: '', bookedRate: '' },
  ]);
  const [reval, setReval] = useState<{ lines: RevalLine[]; total: number; direction: string } | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await lensRun('accounting', 'currency-list', {});
    if (r.data?.ok && r.data.result) {
      setBase(r.data.result.base || 'USD');
      setRates(r.data.result.rates || []);
    }
    setLoading(false);
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const refreshRates = async () => {
    setBusy(true); setErr(null);
    const r = await lensRun('accounting', 'currency-refresh-rates', {});
    if (!r.data?.ok) setErr(r.data?.error || 'Rate refresh failed');
    setBusy(false);
    await refresh();
  };
  const saveBase = async (code: string) => {
    const r = await lensRun('accounting', 'currency-set-base', { base: code });
    if (r.data?.ok) await refresh();
  };
  const runReval = async () => {
    setErr(null); setReval(null);
    const clean = positions
      .filter((p) => p.currency.trim() && Number(p.foreignBalance) && Number(p.bookedRate) > 0)
      .map((p) => ({
        label: p.label.trim() || p.currency,
        currency: p.currency.trim().toUpperCase(),
        foreignBalance: Number(p.foreignBalance),
        bookedRate: Number(p.bookedRate),
      }));
    if (!clean.length) { setErr('Add at least one foreign-currency position.'); return; }
    const r = await lensRun('accounting', 'fx-revaluation', { positions: clean });
    if (r.data?.ok && r.data.result) {
      setReval({
        lines: r.data.result.lines || [],
        total: r.data.result.totalUnrealizedGainLoss || 0,
        direction: r.data.result.direction || 'flat',
      });
    } else setErr(r.data?.error || 'Revaluation failed');
  };

  if (loading) return <Spin />;
  return (
    <div className="space-y-3">
      <section className="bg-black/30 border border-white/10 rounded-lg p-3 space-y-2">
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-400">Base currency</label>
          <input
            className="w-20 bg-black/40 border border-white/10 rounded px-2 py-1 text-xs text-gray-100 uppercase font-mono"
            value={base} maxLength={3}
            onChange={(e) => setBase(e.target.value.toUpperCase())}
            onBlur={() => /^[A-Z]{3}$/.test(base) && saveBase(base)}
          />
          <div className="flex-1" />
          <button type="button" className={btnGhost} onClick={refreshRates} disabled={busy}>
            {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />} Refresh FX rates
          </button>
        </div>
        {err && <Err text={err} />}
        {rates.length === 0 ? <Empty text="No FX rates loaded. Click Refresh FX rates (free, keyless)." /> : (
          <div className="grid grid-cols-3 gap-1 max-h-32 overflow-y-auto">
            {rates.slice(0, 30).map((r) => (
              <div key={r.code} className="text-[10px] text-gray-300 bg-black/30 rounded px-1.5 py-0.5 font-mono">
                {r.code} {r.rate.toFixed(4)}
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="bg-black/30 border border-white/10 rounded-lg p-3 space-y-2">
        <h3 className="text-xs font-semibold text-gray-300">FX revaluation</h3>
        {positions.map((p, i) => (
          <div key={i} className="grid grid-cols-4 gap-1.5">
            <input className={inp} placeholder="Label" value={p.label}
              onChange={(e) => setPositions(positions.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
            <input className={`${inp} uppercase font-mono`} placeholder="CUR" maxLength={3} value={p.currency}
              onChange={(e) => setPositions(positions.map((x, j) => (j === i ? { ...x, currency: e.target.value.toUpperCase() } : x)))} />
            <input className={inp} placeholder="Foreign bal" inputMode="decimal" value={p.foreignBalance}
              onChange={(e) => setPositions(positions.map((x, j) => (j === i ? { ...x, foreignBalance: e.target.value } : x)))} />
            <input className={inp} placeholder="Booked rate" inputMode="decimal" value={p.bookedRate}
              onChange={(e) => setPositions(positions.map((x, j) => (j === i ? { ...x, bookedRate: e.target.value } : x)))} />
          </div>
        ))}
        <div className="flex items-center gap-2">
          <button type="button" className="text-[11px] text-gray-400 hover:text-gray-200"
            onClick={() => setPositions([...positions, { label: '', currency: 'EUR', foreignBalance: '', bookedRate: '' }])}>
            + position
          </button>
          <div className="flex-1" />
          <button type="button" className={btn} onClick={runReval}>Revalue</button>
        </div>
        {reval && (
          <div className="mt-2 space-y-1">
            {reval.lines.map((l, i) => (
              <div key={i} className="flex items-center gap-2 text-[11px] bg-black/30 rounded px-2 py-1">
                <span className="text-gray-300 flex-1 truncate">{l.label} ({l.currency})</span>
                <span className="text-gray-400 font-mono">{money(l.bookedValue)} → {money(l.currentValue)}</span>
                <span className={l.gainLoss >= 0 ? 'text-emerald-400 font-mono' : 'text-rose-400 font-mono'}>
                  {l.gainLoss >= 0 ? '+' : ''}{money(l.gainLoss)}
                </span>
              </div>
            ))}
            <div className="flex items-center justify-between text-xs font-semibold pt-1 border-t border-white/10">
              <span className="text-gray-400">Total unrealized {reval.direction}</span>
              <span className={reval.total >= 0 ? 'text-emerald-400 font-mono' : 'text-rose-400 font-mono'}>
                {reval.total >= 0 ? '+' : ''}{money(reval.total)}
              </span>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

/* ── Class / location / project dimensions + segment P&L ────────────── */

interface Dimension { id: string; kind: string; name: string }
interface SegmentRow { segment: string; revenue: number; cogs: number; grossProfit: number; expense: number; netIncome: number }

function DimensionsTab() {
  const [dims, setDims] = useState<Dimension[]>([]);
  const [loading, setLoading] = useState(true);
  const [kind, setKind] = useState<'class' | 'location' | 'project'>('class');
  const [name, setName] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [segKind, setSegKind] = useState<'class' | 'location' | 'project'>('class');
  const [segments, setSegments] = useState<SegmentRow[] | null>(null);
  const [segTotals, setSegTotals] = useState<SegmentRow | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await lensRun('accounting', 'dimension-list', {});
    if (r.data?.ok && r.data.result) setDims(r.data.result.dimensions || []);
    setLoading(false);
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const create = async () => {
    setErr(null);
    if (!name.trim()) return;
    const r = await lensRun('accounting', 'dimension-create', { kind, name: name.trim() });
    if (r.data?.ok) { setName(''); await refresh(); }
    else setErr(r.data?.error || 'Create failed');
  };
  const del = async (id: string) => {
    await lensRun('accounting', 'dimension-delete', { id });
    await refresh();
  };
  const runSegment = async () => {
    const r = await lensRun('accounting', 'segment-pl', { kind: segKind });
    if (r.data?.ok && r.data.result) {
      setSegments(r.data.result.segments || []);
      setSegTotals(r.data.result.totals || null);
    }
  };

  if (loading) return <Spin />;
  return (
    <div className="space-y-3">
      <section className="bg-black/30 border border-white/10 rounded-lg p-3 space-y-2">
        <h3 className="text-xs font-semibold text-gray-300">New dimension tag</h3>
        <div className="flex items-center gap-1.5">
          <select className="bg-black/40 border border-white/10 rounded px-2 py-1.5 text-xs text-gray-100"
            value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
            <option value="class">Class</option>
            <option value="location">Location</option>
            <option value="project">Project</option>
          </select>
          <input className={inp} placeholder="Tag name" value={name} onChange={(e) => setName(e.target.value)} />
          <button aria-label="Add" type="button" className={btn} onClick={create} disabled={!name.trim()}>
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>
        {err && <Err text={err} />}
      </section>
      {dims.length === 0 ? <Empty text="No dimensions yet. Tag journal entries to enable segment P&L." /> : (
        <ul className="grid grid-cols-2 gap-1.5">
          {dims.map((d) => (
            <li key={d.id} className="flex items-center gap-1.5 bg-black/20 border border-white/10 rounded px-2 py-1">
              <span className="text-[9px] uppercase text-gray-400 bg-black/40 rounded px-1">{d.kind}</span>
              <span className="text-xs text-gray-200 flex-1 truncate">{d.name}</span>
              <button aria-label="Delete" type="button" onClick={() => del(d.id)} className="text-gray-600 hover:text-rose-400">
                <Trash2 className="w-3 h-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <section className="bg-black/30 border border-white/10 rounded-lg p-3 space-y-2">
        <div className="flex items-center gap-2">
          <h3 className="text-xs font-semibold text-gray-300 flex-1">Segment P&amp;L</h3>
          <select className="bg-black/40 border border-white/10 rounded px-2 py-1 text-xs text-gray-100"
            value={segKind} onChange={(e) => setSegKind(e.target.value as typeof segKind)}>
            <option value="class">By class</option>
            <option value="location">By location</option>
            <option value="project">By project</option>
          </select>
          <button type="button" className={btn} onClick={runSegment}>Run</button>
        </div>
        {segments && (segments.length === 0 ? <Empty text="No journal activity in this period." /> : (
          <table className="w-full text-[11px]">
            <thead>
              <tr className="text-gray-400 uppercase text-[9px] tracking-wider">
                <th className="text-left pb-1">Segment</th>
                <th className="text-right pb-1">Revenue</th>
                <th className="text-right pb-1">Gross</th>
                <th className="text-right pb-1">Net income</th>
              </tr>
            </thead>
            <tbody>
              {segments.map((row) => (
                <tr key={row.segment} className="border-t border-white/5">
                  <td className="py-1 text-gray-200">{row.segment}</td>
                  <td className="py-1 text-right font-mono text-gray-300">{money(row.revenue)}</td>
                  <td className="py-1 text-right font-mono text-gray-300">{money(row.grossProfit)}</td>
                  <td className={`py-1 text-right font-mono ${row.netIncome >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {money(row.netIncome)}
                  </td>
                </tr>
              ))}
              {segTotals && (
                <tr className="border-t border-white/10 font-semibold">
                  <td className="py-1 text-gray-400">Total</td>
                  <td className="py-1 text-right font-mono text-gray-200">{money(segTotals.revenue)}</td>
                  <td className="py-1 text-right font-mono text-gray-200">{money(segTotals.grossProfit)}</td>
                  <td className="py-1 text-right font-mono text-gray-100">{money(segTotals.netIncome)}</td>
                </tr>
              )}
            </tbody>
          </table>
        ))}
      </section>
    </div>
  );
}

/* ── Payroll tax e-filing + ACH ─────────────────────────────────────── */

interface Filing {
  form: string; year: number; quarter: number; employeeCount: number;
  grossWages: number; federalIncomeTaxWithheld: number; totalTaxLiability: number;
  status: string; note: string;
}
interface AchBatch {
  id: string; entryCount: number; totalNet: number; missingBankInfo: number;
  status: string; note: string;
  entries: { employeeName: string; amount: number; accountOnFile: boolean }[];
}
interface PayRun { id: string; periodStart: string; periodEnd: string; payDate: string }

function PayrollTaxTab() {
  const [runs, setRuns] = useState<PayRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [quarter, setQuarter] = useState(Math.floor(new Date().getUTCMonth() / 3) + 1);
  const [year, setYear] = useState(new Date().getUTCFullYear());
  const [filing, setFiling] = useState<Filing | null>(null);
  const [batch, setBatch] = useState<AchBatch | null>(null);
  const [runId, setRunId] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await lensRun('accounting', 'payrun-list', {});
    if (r.data?.ok && r.data.result) {
      const list: PayRun[] = r.data.result.runs || [];
      setRuns(list);
      if (list.length && !runId) setRunId(list[0].id);
    }
    setLoading(false);
  }, [runId]);
  useEffect(() => { void refresh(); }, [refresh]);

  const prepFiling = async () => {
    setErr(null); setFiling(null);
    const r = await lensRun('accounting', 'payroll-tax-efile', { quarter, year });
    if (r.data?.ok && r.data.result) setFiling(r.data.result.filing);
    else setErr(r.data?.error || 'Filing prep failed');
  };
  const prepAch = async () => {
    setErr(null); setBatch(null);
    if (!runId) { setErr('Select a pay run.'); return; }
    const r = await lensRun('accounting', 'payroll-ach-batch', { runId });
    if (r.data?.ok && r.data.result) setBatch(r.data.result.batch);
    else setErr(r.data?.error || 'ACH batch failed');
  };

  if (loading) return <Spin />;
  return (
    <div className="space-y-3">
      <section className="bg-black/30 border border-white/10 rounded-lg p-3 space-y-2">
        <h3 className="text-xs font-semibold text-gray-300">Form 941 — quarterly payroll tax</h3>
        <div className="flex items-center gap-1.5">
          <select className="bg-black/40 border border-white/10 rounded px-2 py-1.5 text-xs text-gray-100"
            value={quarter} onChange={(e) => setQuarter(Number(e.target.value))}>
            {[1, 2, 3, 4].map((q) => <option key={q} value={q}>Q{q}</option>)}
          </select>
          <input className="w-20 bg-black/40 border border-white/10 rounded px-2 py-1.5 text-xs text-gray-100 font-mono"
            value={year} inputMode="numeric" onChange={(e) => setYear(Number(e.target.value) || year)} />
          <button type="button" className={btn} onClick={prepFiling}>Prepare 941</button>
        </div>
        {filing && (
          <div className="text-[11px] space-y-1 bg-black/30 rounded p-2">
            <Row k="Employees" v={String(filing.employeeCount)} />
            <Row k="Gross wages" v={money(filing.grossWages)} />
            <Row k="Federal withheld" v={money(filing.federalIncomeTaxWithheld)} />
            <Row k="Total tax liability" v={money(filing.totalTaxLiability)} strong />
            <p className="text-[10px] text-amber-300 pt-1">{filing.status} — {filing.note}</p>
          </div>
        )}
      </section>
      <section className="bg-black/30 border border-white/10 rounded-lg p-3 space-y-2">
        <h3 className="text-xs font-semibold text-gray-300">ACH direct-deposit batch</h3>
        {runs.length === 0 ? <Empty text="No pay runs yet — run payroll first." /> : (
          <div className="flex items-center gap-1.5">
            <select className={inp} value={runId} onChange={(e) => setRunId(e.target.value)}>
              {runs.map((r) => <option key={r.id} value={r.id}>{r.payDate} ({r.periodStart}–{r.periodEnd})</option>)}
            </select>
            <button type="button" className={btn} onClick={prepAch}>Prepare ACH</button>
          </div>
        )}
        {batch && (
          <div className="text-[11px] space-y-1 bg-black/30 rounded p-2">
            <Row k="Deposits" v={String(batch.entryCount)} />
            <Row k="Total net" v={money(batch.totalNet)} strong />
            {batch.entries.map((e, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="text-gray-300 flex-1 truncate">{e.employeeName}</span>
                {e.accountOnFile
                  ? <Check className="w-3 h-3 text-emerald-400" />
                  : <span className="text-[9px] text-amber-300">no bank info</span>}
                <span className="font-mono text-gray-400">{money(e.amount)}</span>
              </div>
            ))}
            <p className="text-[10px] text-amber-300 pt-1">{batch.status} — {batch.note}</p>
          </div>
        )}
        {err && <Err text={err} />}
      </section>
    </div>
  );
}

function Row({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-gray-400">{k}</span>
      <span className={strong ? 'font-mono font-semibold text-gray-100' : 'font-mono text-gray-300'}>{v}</span>
    </div>
  );
}

/* ── Recurring bills ────────────────────────────────────────────────── */

interface Vendor { id: string; name: string }
interface CoaAccount { id: string; code: string; name: string; category: string }
interface RecurringBill {
  id: string; vendorName: string; total: number; cadence: string;
  nextRunAt: string; active: boolean; runCount: number;
}

function RecurringBillsTab() {
  const [bills, setBills] = useState<RecurringBill[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [accounts, setAccounts] = useState<CoaAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [vendorId, setVendorId] = useState('');
  const [accountId, setAccountId] = useState('');
  const [total, setTotal] = useState('');
  const [cadence, setCadence] = useState('monthly');
  const [memo, setMemo] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [ranMsg, setRanMsg] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const [b, v, c] = await Promise.all([
      lensRun('accounting', 'recurring-bills-list', {}),
      lensRun('accounting', 'vendors-list', {}),
      lensRun('accounting', 'coa-list', {}),
    ]);
    if (b.data?.ok && b.data.result) setBills(b.data.result.recurringBills || []);
    if (v.data?.ok && v.data.result) setVendors(v.data.result.vendors || []);
    if (c.data?.ok && c.data.result) {
      setAccounts((c.data.result.accounts || []).filter((a: CoaAccount) => a.category === 'expense'));
    }
    setLoading(false);
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const create = async () => {
    setErr(null);
    const r = await lensRun('accounting', 'recurring-bills-create', {
      vendorId, expenseAccountId: accountId, total: Number(total), cadence, memo: memo.trim(),
    });
    if (r.data?.ok) { setTotal(''); setMemo(''); await refresh(); }
    else setErr(r.data?.error || 'Create failed');
  };
  const toggle = async (id: string) => {
    await lensRun('accounting', 'recurring-bills-toggle', { id });
    await refresh();
  };
  const del = async (id: string) => {
    await lensRun('accounting', 'recurring-bills-delete', { id });
    await refresh();
  };
  const runDue = async () => {
    setRanMsg(null);
    const r = await lensRun('accounting', 'recurring-bills-run-due', {});
    if (r.data?.ok && r.data.result) setRanMsg(`Generated ${r.data.result.count} bill(s).`);
    await refresh();
  };

  if (loading) return <Spin />;
  return (
    <div className="space-y-3">
      <section className="bg-black/30 border border-white/10 rounded-lg p-3 space-y-2">
        <h3 className="text-xs font-semibold text-gray-300">Schedule a recurring bill</h3>
        <select className={inp} value={vendorId} onChange={(e) => setVendorId(e.target.value)}>
          <option value="">Select vendor…</option>
          {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
        <select className={inp} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
          <option value="">Select expense account…</option>
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
        </select>
        <div className="grid grid-cols-2 gap-2">
          <input className={inp} placeholder="Amount" inputMode="decimal" value={total} onChange={(e) => setTotal(e.target.value)} />
          <select className={inp} value={cadence} onChange={(e) => setCadence(e.target.value)}>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
            <option value="quarterly">Quarterly</option>
            <option value="annually">Annually</option>
          </select>
        </div>
        <input className={inp} placeholder="Memo (optional)" value={memo} onChange={(e) => setMemo(e.target.value)} />
        <button type="button" className={btn} onClick={create} disabled={!vendorId || !accountId || !(Number(total) > 0)}>
          <Plus className="w-3.5 h-3.5" /> Schedule
        </button>
        {err && <Err text={err} />}
      </section>
      <div className="flex items-center gap-2">
        <button type="button" className={btnGhost} onClick={runDue}>
          <CalendarClock className="w-3 h-3" /> Run due now
        </button>
        {ranMsg && <span className="text-[11px] text-emerald-400">{ranMsg}</span>}
      </div>
      {bills.length === 0 ? <Empty text="No recurring bills scheduled." /> : (
        <ul className="space-y-1.5">
          {bills.map((b) => (
            <li key={b.id} className="bg-black/20 border border-white/10 rounded-lg p-2.5 flex items-center gap-2">
              <span className={`text-[9px] uppercase rounded px-1 ${b.active ? 'bg-emerald-500/15 text-emerald-300' : 'bg-gray-700 text-gray-400'}`}>
                {b.active ? 'active' : 'paused'}
              </span>
              <span className="text-xs text-gray-200 flex-1 truncate">{b.vendorName}</span>
              <span className="text-[10px] text-gray-400">{b.cadence} · next {b.nextRunAt}</span>
              <span className="text-xs font-mono text-gray-300">{money(b.total)}</span>
              <button type="button" onClick={() => toggle(b.id)} className="text-[10px] text-gray-400 hover:text-gray-200">
                {b.active ? 'Pause' : 'Resume'}
              </button>
              <button aria-label="Delete" type="button" onClick={() => del(b.id)} className="text-gray-600 hover:text-rose-400">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ── Receipt OCR → expense ──────────────────────────────────────────── */

interface ParsedReceipt {
  vendor: string | null; date: string | null; total: number | null;
  tax: number | null; missing: string[]; confidence: number;
}

function ReceiptTab() {
  const [accounts, setAccounts] = useState<CoaAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [ocrText, setOcrText] = useState('');
  const [parsed, setParsed] = useState<ParsedReceipt | null>(null);
  const [accountId, setAccountId] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [postedMsg, setPostedMsg] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const c = await lensRun('accounting', 'coa-list', {});
      if (c.data?.ok && c.data.result) {
        setAccounts((c.data.result.accounts || []).filter((a: CoaAccount) => a.category === 'expense'));
      }
      setLoading(false);
    })();
  }, []);

  const scan = async () => {
    setErr(null); setParsed(null); setPostedMsg(null);
    if (!ocrText.trim()) { setErr('Paste the OCR text from your receipt scan.'); return; }
    const r = await lensRun('accounting', 'receipt-ocr', { ocrText });
    if (r.data?.ok && r.data.result) setParsed(r.data.result.parsed);
    else setErr(r.data?.error || 'OCR parse failed');
  };
  const post = async () => {
    setErr(null);
    const r = await lensRun('accounting', 'receipt-ocr-to-expense', { ocrText, accountId });
    if (r.data?.ok && r.data.result) {
      setPostedMsg(`Posted ${r.data.result.expense?.number} for ${money(r.data.result.expense?.amount || 0)}.`);
      setOcrText(''); setParsed(null);
    } else setErr(r.data?.error || 'Could not post expense');
  };

  if (loading) return <Spin />;
  return (
    <div className="space-y-3">
      <section className="bg-black/30 border border-white/10 rounded-lg p-3 space-y-2">
        <h3 className="text-xs font-semibold text-gray-300 flex items-center gap-1">
          <ScanLine className="w-3.5 h-3.5" /> Receipt OCR text
        </h3>
        <p className="text-[10px] text-gray-400">
          Paste the raw text from the mobile receipt scan (on-device OCR). Concord parses the real text — it never invents amounts.
        </p>
        <textarea
          className="w-full h-28 bg-black/40 border border-white/10 rounded px-2 py-1.5 text-xs text-gray-100 font-mono resize-none"
          placeholder="STAPLES #4421&#10;05/12/2026&#10;Printer paper  12.99&#10;TAX  1.07&#10;TOTAL  14.06"
          value={ocrText}
          onChange={(e) => setOcrText(e.target.value)}
        />
        <button type="button" className={btn} onClick={scan} disabled={!ocrText.trim()}>Parse receipt</button>
        {err && <Err text={err} />}
      </section>
      {parsed && (
        <section className="bg-black/30 border border-white/10 rounded-lg p-3 space-y-2">
          <div className="text-[11px] space-y-1">
            <Row k="Vendor" v={parsed.vendor || '—'} />
            <Row k="Date" v={parsed.date || '—'} />
            <Row k="Total" v={parsed.total != null ? money(parsed.total) : '—'} strong />
            <Row k="Tax" v={parsed.tax != null ? money(parsed.tax) : '—'} />
            <Row k="Confidence" v={`${Math.round(parsed.confidence * 100)}%`} />
          </div>
          {parsed.missing.length > 0 && (
            <p className="text-[10px] text-amber-300">OCR could not find: {parsed.missing.join(', ')}.</p>
          )}
          <select className={inp} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            <option value="">Select expense account…</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
          </select>
          <button type="button" className={btn} onClick={post} disabled={!accountId || parsed.total == null}>
            Post as expense
          </button>
        </section>
      )}
      {postedMsg && <p className="text-[11px] text-emerald-400">{postedMsg}</p>}
    </div>
  );
}

/* ── Edit audit log ─────────────────────────────────────────────────── */

interface AuditEntry {
  id: string; at: string; actor: string; action: string;
  entityType: string; entityId: string; summary: string;
}

function AuditLogTab() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await lensRun('accounting', 'audit-log-list', filterType ? { entityType: filterType } : {});
    if (r.data?.ok && r.data.result) setEntries(r.data.result.entries || []);
    setLoading(false);
  }, [filterType]);
  useEffect(() => { void refresh(); }, [refresh]);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <select className="bg-black/40 border border-white/10 rounded px-2 py-1.5 text-xs text-gray-100"
          value={filterType} onChange={(e) => setFilterType(e.target.value)}>
          <option value="">All changes</option>
          <option value="journal-entry">Journal entries</option>
          <option value="expense">Expenses</option>
          <option value="institution">Bank institutions</option>
          <option value="filing">Tax filings</option>
        </select>
        <button type="button" className={btnGhost} onClick={refresh}>
          <RefreshCw className="w-3 h-3" /> Refresh
        </button>
      </div>
      {loading ? <Spin /> : entries.length === 0 ? (
        <Empty text="No edits recorded yet. Every posting and change is logged here." />
      ) : (
        <ul className="space-y-1">
          {entries.map((e) => (
            <li key={e.id} className="bg-black/20 border border-white/10 rounded p-2">
              <div className="flex items-center gap-2">
                <History className="w-3 h-3 text-gray-400 shrink-0" />
                <span className="text-[10px] font-mono text-emerald-400">{e.action}</span>
                <span className="text-[10px] text-gray-400 ml-auto">{e.at.replace('T', ' ').slice(0, 19)}</span>
              </div>
              <p className="text-[11px] text-gray-200 mt-0.5">{e.summary}</p>
              <p className="text-[9px] text-gray-400">by {e.actor} · {e.entityType}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ── 1099 / W-2 IRS FIRE export ─────────────────────────────────────── */

interface FireResult {
  form: string; year: number; format: string; payeeCount?: number;
  employeeCount?: number; totalReported?: number; totalWages?: number;
  fireFile?: string; efw2File?: string; filename: string; note: string;
}

function EfilingTab() {
  const [mode, setMode] = useState<'1099' | 'w2'>('1099');
  const [year, setYear] = useState(new Date().getUTCFullYear() - 1);
  const [entityName, setEntityName] = useState('');
  const [tin, setTin] = useState('');
  const [result, setResult] = useState<FireResult | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const generate = async () => {
    setErr(null); setResult(null);
    if (mode === '1099') {
      const r = await lensRun('accounting', 'efile-1099-fire', {
        year, payer: { name: entityName.trim(), tin: tin.trim() },
      });
      if (r.data?.ok && r.data.result) setResult(r.data.result);
      else setErr(r.data?.error || '1099 export failed');
    } else {
      const r = await lensRun('accounting', 'efile-w2-export', {
        year, employer: { name: entityName.trim(), ein: tin.trim() },
      });
      if (r.data?.ok && r.data.result) setResult(r.data.result);
      else setErr(r.data?.error || 'W-2 export failed');
    }
  };
  const download = () => {
    if (!result) return;
    const content = result.fireFile || result.efw2File || '';
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = result.filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-3">
      <section className="bg-black/30 border border-white/10 rounded-lg p-3 space-y-2">
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => { setMode('1099'); setResult(null); }}
            className={mode === '1099' ? btn : btnGhost}>1099-NEC</button>
          <button type="button" onClick={() => { setMode('w2'); setResult(null); }}
            className={mode === 'w2' ? btn : btnGhost}>W-2</button>
        </div>
        <p className="text-[10px] text-gray-400">
          {mode === '1099'
            ? 'Builds an IRS FIRE-format file (Pub. 1220) from paid 1099 vendors.'
            : 'Builds an SSA EFW2-format file (Pub. 42-007) from this year\'s payroll.'}
        </p>
        <div className="grid grid-cols-3 gap-2">
          <input className="bg-black/40 border border-white/10 rounded px-2 py-1.5 text-xs text-gray-100 font-mono"
            value={year} inputMode="numeric" onChange={(e) => setYear(Number(e.target.value) || year)} />
          <input className="col-span-2 bg-black/40 border border-white/10 rounded px-2 py-1.5 text-xs text-gray-100"
            placeholder={mode === '1099' ? 'Payer name' : 'Employer name'}
            value={entityName} onChange={(e) => setEntityName(e.target.value)} />
        </div>
        <input className={inp} placeholder={mode === '1099' ? 'Payer EIN (9 digits)' : 'Employer EIN (9 digits)'}
          value={tin} onChange={(e) => setTin(e.target.value)} />
        <button type="button" className={btn} onClick={generate} disabled={!entityName.trim() || tin.replace(/\D/g, '').length !== 9}>
          <FileDown className="w-3.5 h-3.5" /> Generate file
        </button>
        {err && <Err text={err} />}
      </section>
      {result && (
        <section className="bg-black/30 border border-white/10 rounded-lg p-3 space-y-2">
          <div className="text-[11px] space-y-1">
            <Row k="Form" v={result.form} />
            <Row k="Format" v={result.format} />
            <Row k={mode === '1099' ? 'Payees' : 'Employees'}
              v={String(result.payeeCount ?? result.employeeCount ?? 0)} />
            <Row k="Total"
              v={money(result.totalReported ?? result.totalWages ?? 0)} strong />
          </div>
          <pre className="text-[9px] font-mono text-gray-400 bg-black/50 rounded p-2 overflow-x-auto max-h-32">
            {(result.fireFile || result.efw2File || '').split('\n').slice(0, 8).join('\n')}
          </pre>
          <button type="button" className={btn} onClick={download}>
            <FileDown className="w-3.5 h-3.5" /> Download {result.filename}
          </button>
          <p className="text-[10px] text-amber-300">{result.note}</p>
        </section>
      )}
    </div>
  );
}

export default AdvancedAccountingPanel;
