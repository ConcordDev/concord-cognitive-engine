'use client';

/**
 * WeldingOperations — field-service operations console for the welding lens.
 *
 * Wires the welding-domain operational macros into one purpose-built
 * surface (Jobber / ServiceTitan parity):
 *
 *  - Schedule   → welding.calendar / job-schedule / job-update
 *  - Quotes     → welding.estimate-create / estimate-list / estimate-send
 *                 / estimate-to-job
 *  - Invoices   → welding.invoice-from-job / invoice-list / invoice-payment
 *  - WPS        → welding.wps-create / wps-list / wps-approve
 *  - Certs      → welding.cert-add / cert-status / cert-renew
 *  - Photos     → welding.photo-attach / photo-list / photo-remove
 *  - Codes      → welding.code-search
 *
 * Every value rendered comes from a real macro call. No mock data.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CalendarDays, FileText, Receipt, BookOpen, Award, Camera,
  Search, Loader2, Plus, Trash2, Send, ArrowRightCircle,
  DollarSign, CheckCircle2, AlertTriangle, ShieldCheck, RefreshCw,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { ChartKit } from '@/components/viz';

type OpsTab = 'schedule' | 'quotes' | 'invoices' | 'wps' | 'certs' | 'photos' | 'codes';

const TABS: { id: OpsTab; label: string; icon: typeof CalendarDays }[] = [
  { id: 'schedule', label: 'Schedule', icon: CalendarDays },
  { id: 'quotes', label: 'Quotes', icon: FileText },
  { id: 'invoices', label: 'Invoices', icon: Receipt },
  { id: 'wps', label: 'WPS', icon: BookOpen },
  { id: 'certs', label: 'Certs', icon: Award },
  { id: 'photos', label: 'Photos', icon: Camera },
  { id: 'codes', label: 'Codes', icon: BookOpen },
];

// ── shared shapes ───────────────────────────────────────────────────
interface Job {
  id: string; title: string; client?: string; address?: string;
  crew?: string[]; scheduledDate?: string; durationDays?: number;
  status?: string; estimateId?: string | null; invoiceId?: string;
  contractValue?: number; notes?: string;
}
interface CalendarDay { date: string; jobs: { id: string; title: string; client?: string; status?: string; crew?: string[] }[] }
interface LineItem { description: string; quantity: number; unitPrice: number; kind: string }
interface Estimate {
  id: string; title: string; client?: string; address?: string;
  lineItems: LineItem[]; subtotal: number; taxRate: number; tax: number;
  total: number; status: string; jobId?: string | null; portalToken?: string;
}
interface Payment { id: string; amount: number; method: string; reference?: string; recordedAt: string }
interface Invoice {
  id: string; invoiceNumber: string; jobId: string; client?: string; title?: string;
  amount: number; amountPaid: number; balance: number; status: string;
  issuedDate: string; dueDate: string; payments: Payment[]; portalToken?: string;
  overdue?: boolean;
}
interface Wps {
  id: string; wpsNumber: string; jobId?: string | null; process: string;
  baseMetal: string; jointDesign: string; positions: string[];
  fillerMetal?: string; amperageRange?: string; voltageRange?: string;
  thicknessRange?: string; preheat?: string; code: string; revision: string;
  status: string; approvedBy?: string;
}
interface Cert {
  id: string; welder: string; certType: string; certNumber?: string;
  process?: string; position?: string; issuedBy?: string;
  issuedDate?: string; expiryDate?: string; lastContinuityDate?: string;
  daysToExpiry?: number | null; daysSinceContinuity?: number | null;
  standing?: string;
}
interface CertAlert { certId: string; welder: string; certType: string; standing: string; message: string }
interface WeldPhoto { id: string; url: string; stage: string; caption?: string; weldId?: string; addedAt: string }
interface CodeEntry { id: string; code: string; clause: string; title: string; body: string; keywords: string[]; relevance?: number }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function run<T = any>(action: string, input: Record<string, unknown> = {}): Promise<T | null> {
  const r = await lensRun<T>('welding', action, input);
  if (!r.data.ok) return null;
  return r.data.result;
}

const fmt = (n: number | undefined) => `$${(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
const inputCls = 'rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white';
const btnCls = 'inline-flex items-center gap-1 rounded bg-orange-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-orange-400 disabled:opacity-40';
const ghostBtn = 'inline-flex items-center gap-1 rounded border border-zinc-800 px-2 py-1 text-[11px] text-zinc-300 hover:border-orange-500/40';

function StandingBadge({ standing }: { standing?: string }) {
  const map: Record<string, string> = {
    valid: 'bg-emerald-500/20 text-emerald-200',
    expiring_soon: 'bg-amber-500/20 text-amber-200',
    expired: 'bg-rose-500/20 text-rose-200',
    continuity_lapsed: 'bg-rose-500/20 text-rose-200',
  };
  return <span className={`rounded px-1.5 py-0.5 text-[10px] ${map[standing || ''] || 'bg-zinc-700 text-zinc-300'}`}>{(standing || 'unknown').replace(/_/g, ' ')}</span>;
}

// ── Schedule tab ────────────────────────────────────────────────────
function ScheduleTab() {
  const [cal, setCal] = useState<{ days: CalendarDay[]; unscheduled: { id: string; title: string; client?: string }[]; crewLoad: Record<string, number>; scheduledCount: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState('');
  const [client, setClient] = useState('');
  const [date, setDate] = useState('');
  const [crew, setCrew] = useState('');
  const [duration, setDuration] = useState('1');

  const reload = useCallback(async () => {
    setBusy(true);
    setCal(await run('calendar', { rangeDays: 30 }));
    setBusy(false);
  }, []);
  useEffect(() => { void reload(); }, [reload]);

  const create = async () => {
    if (!title.trim()) return;
    setBusy(true);
    await run('job-schedule', {
      title, client, scheduledDate: date, durationDays: Number(duration) || 1,
      crew: crew.split(',').map((c) => c.trim()).filter(Boolean),
    });
    setTitle(''); setClient(''); setDate(''); setCrew(''); setDuration('1');
    await reload();
  };

  const crewLoad = cal ? Object.entries(cal.crewLoad).map(([name, days]) => ({ name, days })) : [];

  return (
    <div className="space-y-3">
      <div className="grid gap-2 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3 sm:grid-cols-6">
        <input className={`${inputCls} sm:col-span-2`} placeholder="Job title" value={title} onChange={(e) => setTitle(e.target.value)} />
        <input className={inputCls} placeholder="Client" value={client} onChange={(e) => setClient(e.target.value)} />
        <input type="date" className={inputCls} value={date} onChange={(e) => setDate(e.target.value)} />
        <input type="number" min={1} className={inputCls} placeholder="Days" value={duration} onChange={(e) => setDuration(e.target.value)} />
        <button type="button" className={btnCls} onClick={create} disabled={busy || !title.trim()}><Plus className="h-3.5 w-3.5" /> Schedule</button>
        <input className={`${inputCls} sm:col-span-6`} placeholder="Crew (comma-separated welder names)" value={crew} onChange={(e) => setCrew(e.target.value)} />
      </div>

      {busy && !cal && <div className="flex items-center gap-2 text-xs text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading calendar…</div>}

      {cal && (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <div className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5"><div className="text-[10px] uppercase tracking-wider text-zinc-500">Scheduled jobs</div><div className="font-mono text-lg text-orange-300">{cal.scheduledCount}</div></div>
            <div className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5"><div className="text-[10px] uppercase tracking-wider text-zinc-500">Unscheduled</div><div className="font-mono text-lg text-amber-300">{cal.unscheduled.length}</div></div>
            <div className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5"><div className="text-[10px] uppercase tracking-wider text-zinc-500">Crew on roster</div><div className="font-mono text-lg text-cyan-300">{Object.keys(cal.crewLoad).length}</div></div>
          </div>

          {crewLoad.length > 0 && (
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
              <div className="mb-2 text-[10px] uppercase tracking-wider text-zinc-500">Crew load (job-days assigned)</div>
              <ChartKit kind="bar" data={crewLoad} xKey="name" series={[{ key: 'days', label: 'Job-days', color: '#f59e0b' }]} height={180} showLegend={false} />
            </div>
          )}

          <div className="grid grid-cols-7 gap-1">
            {cal.days.map((d) => {
              const day = new Date(d.date);
              return (
                <div key={d.date} className={`min-h-[64px] rounded border p-1 ${d.jobs.length ? 'border-orange-500/30 bg-orange-500/5' : 'border-zinc-800 bg-zinc-950/40'}`}>
                  <div className="text-[9px] text-zinc-500">{day.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</div>
                  {d.jobs.map((j) => (
                    <div key={j.id} className="mt-0.5 truncate rounded bg-orange-500/20 px-1 py-0.5 text-[9px] text-orange-100" title={`${j.title}${j.client ? ` · ${j.client}` : ''}`}>{j.title}</div>
                  ))}
                </div>
              );
            })}
          </div>

          {cal.unscheduled.length > 0 && (
            <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
              <div className="mb-1.5 text-[10px] uppercase tracking-wider text-amber-300">Needs a date</div>
              {cal.unscheduled.map((u) => (
                <UnscheduledRow key={u.id} job={u} onAssigned={reload} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function UnscheduledRow({ job, onAssigned }: { job: { id: string; title: string; client?: string }; onAssigned: () => void }) {
  const [date, setDate] = useState('');
  const [busy, setBusy] = useState(false);
  const assign = async () => {
    if (!date) return;
    setBusy(true);
    await run('job-update', { jobId: job.id, scheduledDate: date });
    setBusy(false);
    onAssigned();
  };
  return (
    <div className="flex items-center gap-2 py-0.5 text-[11px]">
      <span className="flex-1 truncate text-zinc-200">{job.title}{job.client ? ` · ${job.client}` : ''}</span>
      <input type="date" className={inputCls} value={date} onChange={(e) => setDate(e.target.value)} />
      <button type="button" className={ghostBtn} onClick={assign} disabled={busy || !date}>Assign</button>
    </div>
  );
}

// ── Quotes tab ──────────────────────────────────────────────────────
function QuotesTab() {
  const [data, setData] = useState<{ estimates: Estimate[]; pipelineValue: number; wonValue: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState('');
  const [client, setClient] = useState('');
  const [taxRate, setTaxRate] = useState('0');
  const [items, setItems] = useState<{ description: string; quantity: string; unitPrice: string; kind: string }[]>([{ description: '', quantity: '1', unitPrice: '0', kind: 'labor' }]);
  const [portal, setPortal] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setBusy(true);
    setData(await run('estimate-list'));
    setBusy(false);
  }, []);
  useEffect(() => { void reload(); }, [reload]);

  const create = async () => {
    if (!title.trim()) return;
    setBusy(true);
    await run('estimate-create', {
      title, client, taxRate: Number(taxRate) || 0,
      lineItems: items.filter((i) => i.description.trim()).map((i) => ({
        description: i.description, quantity: Number(i.quantity) || 0, unitPrice: Number(i.unitPrice) || 0, kind: i.kind,
      })),
    });
    setTitle(''); setClient(''); setTaxRate('0');
    setItems([{ description: '', quantity: '1', unitPrice: '0', kind: 'labor' }]);
    await reload();
  };
  const send = async (id: string) => {
    const r = await run<{ portalToken: string }>('estimate-send', { estimateId: id });
    if (r?.portalToken) setPortal(r.portalToken);
    await reload();
  };
  const convert = async (id: string) => {
    await run('estimate-to-job', { estimateId: id });
    await reload();
  };

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3 space-y-2">
        <div className="grid gap-2 sm:grid-cols-4">
          <input className={`${inputCls} sm:col-span-2`} placeholder="Estimate title" value={title} onChange={(e) => setTitle(e.target.value)} />
          <input className={inputCls} placeholder="Client" value={client} onChange={(e) => setClient(e.target.value)} />
          <input type="number" step="0.01" min={0} max={0.25} className={inputCls} placeholder="Tax rate (0–0.25)" value={taxRate} onChange={(e) => setTaxRate(e.target.value)} />
        </div>
        {items.map((it, i) => (
          <div key={i} className="grid grid-cols-[1fr_70px_80px_90px_30px] gap-1.5">
            <input className={inputCls} placeholder="Line item description" value={it.description} onChange={(e) => setItems((xs) => xs.map((x, idx) => idx === i ? { ...x, description: e.target.value } : x))} />
            <input type="number" min={0} className={inputCls} placeholder="Qty" value={it.quantity} onChange={(e) => setItems((xs) => xs.map((x, idx) => idx === i ? { ...x, quantity: e.target.value } : x))} />
            <input type="number" min={0} className={inputCls} placeholder="Unit $" value={it.unitPrice} onChange={(e) => setItems((xs) => xs.map((x, idx) => idx === i ? { ...x, unitPrice: e.target.value } : x))} />
            <select className={inputCls} value={it.kind} onChange={(e) => setItems((xs) => xs.map((x, idx) => idx === i ? { ...x, kind: e.target.value } : x))}>
              <option value="labor">labor</option><option value="material">material</option><option value="equipment">equipment</option>
            </select>
            <button type="button" className="rounded border border-zinc-800 text-zinc-500 hover:text-rose-300" onClick={() => setItems((xs) => xs.filter((_, idx) => idx !== i))} aria-label="Remove line"><Trash2 className="mx-auto h-3 w-3" /></button>
          </div>
        ))}
        <div className="flex items-center gap-2">
          <button type="button" className={ghostBtn} onClick={() => setItems((xs) => [...xs, { description: '', quantity: '1', unitPrice: '0', kind: 'material' }])}><Plus className="h-3 w-3" /> Line item</button>
          <button type="button" className={btnCls} onClick={create} disabled={busy || !title.trim()}><Plus className="h-3.5 w-3.5" /> Create estimate</button>
        </div>
      </div>

      {data && (
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5"><div className="text-[10px] uppercase tracking-wider text-zinc-500">Pipeline (draft+sent)</div><div className="font-mono text-lg text-amber-300">{fmt(data.pipelineValue)}</div></div>
          <div className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5"><div className="text-[10px] uppercase tracking-wider text-zinc-500">Won (accepted)</div><div className="font-mono text-lg text-emerald-300">{fmt(data.wonValue)}</div></div>
        </div>
      )}

      {portal && (
        <div className="rounded border border-cyan-500/30 bg-cyan-500/5 px-3 py-2 text-[11px] text-cyan-200">
          Client-portal token issued: <span className="font-mono">{portal}</span> — share for quote approval.
        </div>
      )}

      <div className="space-y-1.5">
        {busy && !data && <div className="flex items-center gap-2 text-xs text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>}
        {data?.estimates.map((e) => (
          <div key={e.id} className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-2.5">
            <div className="flex items-center justify-between">
              <div className="min-w-0">
                <div className="truncate text-[12px] font-medium text-white">{e.title}</div>
                <div className="text-[10px] text-zinc-500">{e.client || 'no client'} · {e.lineItems.length} line items</div>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-sm text-emerald-300">{fmt(e.total)}</span>
                <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-300">{e.status}</span>
              </div>
            </div>
            <div className="mt-1.5 flex items-center gap-1.5">
              {e.status === 'draft' && <button type="button" className={ghostBtn} onClick={() => send(e.id)}><Send className="h-3 w-3" /> Send to client</button>}
              {(e.status === 'sent' || e.status === 'accepted') && !e.jobId && <button type="button" className={ghostBtn} onClick={() => convert(e.id)}><ArrowRightCircle className="h-3 w-3" /> Convert to job</button>}
              {e.jobId && <span className="text-[10px] text-emerald-400">linked to job</span>}
            </div>
          </div>
        ))}
        {data && data.estimates.length === 0 && <div className="rounded border border-dashed border-zinc-800 p-4 text-center text-[11px] text-zinc-500">No estimates yet.</div>}
      </div>
    </div>
  );
}

// ── Invoices tab ────────────────────────────────────────────────────
function InvoicesTab() {
  const [data, setData] = useState<{ invoices: Invoice[]; outstanding: number; collected: number; overdueCount: number } | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [busy, setBusy] = useState(false);
  const [jobId, setJobId] = useState('');
  const [amount, setAmount] = useState('');

  const reload = useCallback(async () => {
    setBusy(true);
    const [inv, cal] = await Promise.all([
      run('invoice-list'),
      run<{ days: CalendarDay[] }>('calendar', { rangeDays: 30 }),
    ]);
    setData(inv);
    // Surface jobs eligible to invoice from the calendar (any with a job id).
    const seen = new Map<string, Job>();
    (cal?.days || []).forEach((d) => d.jobs.forEach((j) => { if (!seen.has(j.id)) seen.set(j.id, { id: j.id, title: j.title, status: j.status }); }));
    setJobs([...seen.values()]);
    setBusy(false);
  }, []);
  useEffect(() => { void reload(); }, [reload]);

  const createInvoice = async () => {
    if (!jobId) return;
    setBusy(true);
    await run('invoice-from-job', { jobId, amount: Number(amount) || 0 });
    setJobId(''); setAmount('');
    await reload();
  };

  return (
    <div className="space-y-3">
      <div className="grid gap-2 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3 sm:grid-cols-4">
        <select className={`${inputCls} sm:col-span-2`} value={jobId} onChange={(e) => setJobId(e.target.value)}>
          <option value="">Select a job to invoice…</option>
          {jobs.map((j) => <option key={j.id} value={j.id}>{j.title}</option>)}
        </select>
        <input type="number" min={0} className={inputCls} placeholder="Amount (if no estimate)" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <button type="button" className={btnCls} onClick={createInvoice} disabled={busy || !jobId}><Receipt className="h-3.5 w-3.5" /> Generate invoice</button>
      </div>

      {data && (
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5"><div className="text-[10px] uppercase tracking-wider text-zinc-500">Outstanding</div><div className="font-mono text-lg text-amber-300">{fmt(data.outstanding)}</div></div>
          <div className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5"><div className="text-[10px] uppercase tracking-wider text-zinc-500">Collected</div><div className="font-mono text-lg text-emerald-300">{fmt(data.collected)}</div></div>
          <div className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5"><div className="text-[10px] uppercase tracking-wider text-zinc-500">Overdue</div><div className="font-mono text-lg text-rose-300">{data.overdueCount}</div></div>
        </div>
      )}

      <div className="space-y-1.5">
        {busy && !data && <div className="flex items-center gap-2 text-xs text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>}
        {data?.invoices.map((inv) => <InvoiceRow key={inv.id} invoice={inv} onPaid={reload} />)}
        {data && data.invoices.length === 0 && <div className="rounded border border-dashed border-zinc-800 p-4 text-center text-[11px] text-zinc-500">No invoices yet — generate one from a completed job.</div>}
      </div>
    </div>
  );
}

function InvoiceRow({ invoice, onPaid }: { invoice: Invoice; onPaid: () => void }) {
  const [amt, setAmt] = useState('');
  const [method, setMethod] = useState('card');
  const [busy, setBusy] = useState(false);
  const pay = async () => {
    const n = Number(amt);
    if (!n || n <= 0) return;
    setBusy(true);
    await run('invoice-payment', { invoiceId: invoice.id, amount: n, method });
    setAmt('');
    setBusy(false);
    onPaid();
  };
  return (
    <div className={`rounded-lg border p-2.5 ${invoice.overdue ? 'border-rose-500/30 bg-rose-500/5' : 'border-zinc-800 bg-zinc-950/40'}`}>
      <div className="flex items-center justify-between">
        <div className="min-w-0">
          <div className="truncate text-[12px] font-medium text-white">{invoice.invoiceNumber} · {invoice.title || invoice.client}</div>
          <div className="text-[10px] text-zinc-500">due {invoice.dueDate}{invoice.overdue ? ' · OVERDUE' : ''}</div>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-mono text-[11px] text-zinc-400">{fmt(invoice.amountPaid)} / {fmt(invoice.amount)}</span>
          <span className={`rounded px-1.5 py-0.5 text-[10px] ${invoice.status === 'paid' ? 'bg-emerald-500/20 text-emerald-200' : invoice.status === 'partial' ? 'bg-amber-500/20 text-amber-200' : 'bg-zinc-700 text-zinc-300'}`}>{invoice.status}</span>
        </div>
      </div>
      {invoice.status !== 'paid' && (
        <div className="mt-1.5 flex items-center gap-1.5">
          <input type="number" min={0} className={`${inputCls} w-28`} placeholder={`Balance ${fmt(invoice.balance)}`} value={amt} onChange={(e) => setAmt(e.target.value)} />
          <select className={inputCls} value={method} onChange={(e) => setMethod(e.target.value)}>
            <option value="card">card</option><option value="ach">ach</option><option value="cash">cash</option><option value="check">check</option>
          </select>
          <button type="button" className={ghostBtn} onClick={pay} disabled={busy || !amt}><DollarSign className="h-3 w-3" /> Record payment</button>
        </div>
      )}
      {invoice.payments.length > 0 && (
        <div className="mt-1 text-[10px] text-zinc-500">{invoice.payments.length} payment(s): {invoice.payments.map((p) => `${fmt(p.amount)} ${p.method}`).join(', ')}</div>
      )}
    </div>
  );
}

// ── WPS tab ─────────────────────────────────────────────────────────
function WpsTab() {
  const [list, setList] = useState<Wps[]>([]);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    wpsNumber: '', process: 'SMAW', baseMetal: 'mild-steel', baseMetalSpec: '',
    thicknessRange: '', jointDesign: 'fillet', fillerMetal: '', shieldingGas: '',
    amperageRange: '', voltageRange: '', travelSpeed: '', preheat: '',
    interpassTemp: '', code: 'AWS D1.1', positions: 'flat',
  });

  const reload = useCallback(async () => {
    setBusy(true);
    const r = await run<{ wps: Wps[] }>('wps-list');
    setList(r?.wps || []);
    setBusy(false);
  }, []);
  useEffect(() => { void reload(); }, [reload]);

  const create = async () => {
    setBusy(true);
    await run('wps-create', { ...form, positions: form.positions.split(',').map((p) => p.trim()).filter(Boolean) });
    setForm((f) => ({ ...f, wpsNumber: '', fillerMetal: '', amperageRange: '', voltageRange: '', thicknessRange: '', preheat: '' }));
    await reload();
  };
  const approve = async (id: string) => {
    const r = await lensRun('welding', 'wps-approve', { wpsId: id });
    if (!r.data.ok) {
      // result.missing carries the incomplete-field list
      alert(r.data.error === 'incomplete_wps' ? 'WPS incomplete — fill filler metal, amperage range and thickness range.' : (r.data.error || 'approve failed'));
    }
    await reload();
  };
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <div className="space-y-3">
      <div className="grid gap-2 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3 sm:grid-cols-4">
        <input className={inputCls} placeholder="WPS number (auto)" value={form.wpsNumber} onChange={set('wpsNumber')} />
        <select className={inputCls} value={form.process} onChange={set('process')}>{['SMAW', 'GMAW', 'GTAW', 'FCAW', 'SAW'].map((p) => <option key={p}>{p}</option>)}</select>
        <input className={inputCls} placeholder="Base metal" value={form.baseMetal} onChange={set('baseMetal')} />
        <input className={inputCls} placeholder="Base metal spec" value={form.baseMetalSpec} onChange={set('baseMetalSpec')} />
        <input className={inputCls} placeholder="Thickness range (req.)" value={form.thicknessRange} onChange={set('thicknessRange')} />
        <input className={inputCls} placeholder="Joint design" value={form.jointDesign} onChange={set('jointDesign')} />
        <input className={inputCls} placeholder="Positions (csv)" value={form.positions} onChange={set('positions')} />
        <input className={inputCls} placeholder="Filler metal (req.)" value={form.fillerMetal} onChange={set('fillerMetal')} />
        <input className={inputCls} placeholder="Shielding gas" value={form.shieldingGas} onChange={set('shieldingGas')} />
        <input className={inputCls} placeholder="Amperage range (req.)" value={form.amperageRange} onChange={set('amperageRange')} />
        <input className={inputCls} placeholder="Voltage range" value={form.voltageRange} onChange={set('voltageRange')} />
        <input className={inputCls} placeholder="Travel speed" value={form.travelSpeed} onChange={set('travelSpeed')} />
        <input className={inputCls} placeholder="Preheat" value={form.preheat} onChange={set('preheat')} />
        <input className={inputCls} placeholder="Interpass temp" value={form.interpassTemp} onChange={set('interpassTemp')} />
        <select className={inputCls} value={form.code} onChange={set('code')}>{['AWS D1.1', 'AWS D1.6', 'ASME IX', 'API 1104'].map((c) => <option key={c}>{c}</option>)}</select>
        <button type="button" className={btnCls} onClick={create} disabled={busy}><Plus className="h-3.5 w-3.5" /> Create WPS</button>
      </div>

      <div className="space-y-1.5">
        {busy && list.length === 0 && <div className="flex items-center gap-2 text-xs text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>}
        {list.map((w) => (
          <div key={w.id} className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-2.5">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[12px] font-medium text-white">{w.wpsNumber} <span className="font-normal text-zinc-500">· {w.process} · {w.code} rev {w.revision}</span></div>
                <div className="text-[10px] text-zinc-500">{w.baseMetal} · {w.jointDesign} · {w.positions.join(', ')}{w.fillerMetal ? ` · ${w.fillerMetal}` : ''}{w.amperageRange ? ` · ${w.amperageRange}` : ''}</div>
              </div>
              <div className="flex items-center gap-2">
                <span className={`rounded px-1.5 py-0.5 text-[10px] ${w.status === 'approved' ? 'bg-emerald-500/20 text-emerald-200' : 'bg-zinc-700 text-zinc-300'}`}>{w.status}</span>
                {w.status !== 'approved' && <button type="button" className={ghostBtn} onClick={() => approve(w.id)}><ShieldCheck className="h-3 w-3" /> Approve</button>}
              </div>
            </div>
            {w.approvedBy && <div className="mt-1 text-[10px] text-emerald-400">approved by {w.approvedBy}</div>}
          </div>
        ))}
        {!busy && list.length === 0 && <div className="rounded border border-dashed border-zinc-800 p-4 text-center text-[11px] text-zinc-500">No WPS documents yet.</div>}
      </div>
    </div>
  );
}

// ── Certs tab ───────────────────────────────────────────────────────
function CertsTab() {
  const [data, setData] = useState<{ certs: Cert[]; alerts: CertAlert[]; validCount: number; atRiskCount: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ welder: '', certType: 'AWS D1.1 Structural', certNumber: '', process: '', position: '', issuedBy: '', issuedDate: '', expiryDate: '' });

  const reload = useCallback(async () => {
    setBusy(true);
    setData(await run('cert-status', { warnDays: 60 }));
    setBusy(false);
  }, []);
  useEffect(() => { void reload(); }, [reload]);

  const add = async () => {
    if (!form.welder.trim()) return;
    setBusy(true);
    await run('cert-add', { ...form });
    setForm({ welder: '', certType: 'AWS D1.1 Structural', certNumber: '', process: '', position: '', issuedBy: '', issuedDate: '', expiryDate: '' });
    await reload();
  };
  const renew = async (id: string, expiry: string) => {
    await run('cert-renew', { certId: id, expiryDate: expiry });
    await reload();
  };
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <div className="space-y-3">
      <div className="grid gap-2 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3 sm:grid-cols-4">
        <input className={inputCls} placeholder="Welder name" value={form.welder} onChange={set('welder')} />
        <select className={inputCls} value={form.certType} onChange={set('certType')}>
          {['AWS D1.1 Structural', 'AWS CWI', 'ASME Section IX', 'API 1104', '6G Pipe Certification'].map((c) => <option key={c}>{c}</option>)}
        </select>
        <input className={inputCls} placeholder="Cert number" value={form.certNumber} onChange={set('certNumber')} />
        <input className={inputCls} placeholder="Process" value={form.process} onChange={set('process')} />
        <input className={inputCls} placeholder="Position" value={form.position} onChange={set('position')} />
        <input className={inputCls} placeholder="Issued by" value={form.issuedBy} onChange={set('issuedBy')} />
        <label className="text-[10px] text-zinc-500">Issued<input type="date" className={`${inputCls} mt-0.5 w-full`} value={form.issuedDate} onChange={set('issuedDate')} /></label>
        <label className="text-[10px] text-zinc-500">Expires<input type="date" className={`${inputCls} mt-0.5 w-full`} value={form.expiryDate} onChange={set('expiryDate')} /></label>
        <button type="button" className={`${btnCls} sm:col-span-4`} onClick={add} disabled={busy || !form.welder.trim()}><Plus className="h-3.5 w-3.5" /> Add certification</button>
      </div>

      {data && (
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5"><div className="text-[10px] uppercase tracking-wider text-zinc-500">Valid</div><div className="font-mono text-lg text-emerald-300">{data.validCount}</div></div>
          <div className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5"><div className="text-[10px] uppercase tracking-wider text-zinc-500">At risk</div><div className="font-mono text-lg text-rose-300">{data.atRiskCount}</div></div>
        </div>
      )}

      {data && data.alerts.length > 0 && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-3">
          <div className="mb-1 flex items-center gap-1 text-[10px] uppercase tracking-wider text-rose-300"><AlertTriangle className="h-3 w-3" /> Expiry &amp; continuity alerts</div>
          {data.alerts.map((a) => (
            <div key={a.certId} className="py-0.5 text-[11px] text-rose-200">{a.message}</div>
          ))}
        </div>
      )}

      <div className="space-y-1.5">
        {busy && !data && <div className="flex items-center gap-2 text-xs text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>}
        {data?.certs.map((c) => <CertRow key={c.id} cert={c} onRenew={renew} />)}
        {data && data.certs.length === 0 && <div className="rounded border border-dashed border-zinc-800 p-4 text-center text-[11px] text-zinc-500">No certifications tracked.</div>}
      </div>
    </div>
  );
}

function CertRow({ cert, onRenew }: { cert: Cert; onRenew: (id: string, expiry: string) => void }) {
  const [expiry, setExpiry] = useState('');
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-2.5">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[12px] font-medium text-white">{cert.welder} <span className="font-normal text-zinc-500">· {cert.certType}</span></div>
          <div className="text-[10px] text-zinc-500">
            {cert.certNumber ? `#${cert.certNumber} · ` : ''}
            {cert.daysToExpiry != null ? (cert.daysToExpiry < 0 ? `expired ${Math.abs(cert.daysToExpiry)}d ago` : `expires in ${cert.daysToExpiry}d`) : 'no expiry'}
            {cert.daysSinceContinuity != null ? ` · ${cert.daysSinceContinuity}d since last use` : ''}
          </div>
        </div>
        <StandingBadge standing={cert.standing} />
      </div>
      <div className="mt-1.5 flex items-center gap-1.5">
        <input type="date" className={inputCls} value={expiry} onChange={(e) => setExpiry(e.target.value)} />
        <button type="button" className={ghostBtn} onClick={() => onRenew(cert.id, expiry)} disabled={!expiry}><RefreshCw className="h-3 w-3" /> Renew / log continuity</button>
      </div>
    </div>
  );
}

// ── Photos tab ──────────────────────────────────────────────────────
/* eslint-disable @next/next/no-img-element */
function PhotosTab() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [jobId, setJobId] = useState('');
  const [photos, setPhotos] = useState<{ photos: WeldPhoto[]; byStage: Record<string, number> } | null>(null);
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState('');
  const [stage, setStage] = useState('after');
  const [caption, setCaption] = useState('');
  const [weldId, setWeldId] = useState('');

  const loadJobs = useCallback(async () => {
    const cal = await run<{ days: CalendarDay[] }>('calendar', { rangeDays: 60 });
    const seen = new Map<string, Job>();
    (cal?.days || []).forEach((d) => d.jobs.forEach((j) => { if (!seen.has(j.id)) seen.set(j.id, { id: j.id, title: j.title }); }));
    setJobs([...seen.values()]);
  }, []);
  useEffect(() => { void loadJobs(); }, [loadJobs]);

  const loadPhotos = useCallback(async (id: string) => {
    if (!id) { setPhotos(null); return; }
    setBusy(true);
    setPhotos(await run('photo-list', { jobId: id }));
    setBusy(false);
  }, []);
  useEffect(() => { void loadPhotos(jobId); }, [jobId, loadPhotos]);

  const attach = async () => {
    if (!jobId || !url.trim()) return;
    setBusy(true);
    await run('photo-attach', { jobId, url, stage, caption, weldId });
    setUrl(''); setCaption(''); setWeldId('');
    await loadPhotos(jobId);
  };
  const remove = async (photoId: string) => {
    await run('photo-remove', { jobId, photoId });
    await loadPhotos(jobId);
  };

  return (
    <div className="space-y-3">
      <select className={`${inputCls} w-full`} value={jobId} onChange={(e) => setJobId(e.target.value)}>
        <option value="">Select a job to document…</option>
        {jobs.map((j) => <option key={j.id} value={j.id}>{j.title}</option>)}
      </select>

      {jobId && (
        <div className="grid gap-2 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3 sm:grid-cols-4">
          <input className={`${inputCls} sm:col-span-2`} placeholder="Photo URL" value={url} onChange={(e) => setUrl(e.target.value)} />
          <select className={inputCls} value={stage} onChange={(e) => setStage(e.target.value)}>
            {['before', 'fit-up', 'root-pass', 'fill', 'cap', 'after', 'ndt'].map((s) => <option key={s}>{s}</option>)}
          </select>
          <input className={inputCls} placeholder="Weld ID" value={weldId} onChange={(e) => setWeldId(e.target.value)} />
          <input className={`${inputCls} sm:col-span-3`} placeholder="Caption" value={caption} onChange={(e) => setCaption(e.target.value)} />
          <button type="button" className={btnCls} onClick={attach} disabled={busy || !url.trim()}><Camera className="h-3.5 w-3.5" /> Attach photo</button>
        </div>
      )}

      {photos && Object.keys(photos.byStage).length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(photos.byStage).map(([s, n]) => (
            <span key={s} className="rounded bg-zinc-800 px-2 py-0.5 text-[10px] text-zinc-300">{s}: {n}</span>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {busy && !photos && <div className="flex items-center gap-2 text-xs text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>}
        {photos?.photos.map((p) => (
          <div key={p.id} className="overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950/40">
            <img src={p.url} alt={p.caption || p.stage} className="h-28 w-full object-cover" />
            <div className="p-1.5">
              <div className="flex items-center justify-between">
                <span className="rounded bg-orange-500/20 px-1.5 py-0.5 text-[9px] text-orange-200">{p.stage}</span>
                <button type="button" className="text-zinc-500 hover:text-rose-300" onClick={() => remove(p.id)} aria-label="Remove photo"><Trash2 className="h-3 w-3" /></button>
              </div>
              {p.caption && <div className="mt-0.5 line-clamp-2 text-[10px] text-zinc-400">{p.caption}</div>}
              {p.weldId && <div className="text-[9px] text-zinc-600">weld {p.weldId}</div>}
            </div>
          </div>
        ))}
      </div>
      {jobId && photos && photos.photos.length === 0 && !busy && <div className="rounded border border-dashed border-zinc-800 p-4 text-center text-[11px] text-zinc-500">No photos for this job yet.</div>}
    </div>
  );
}
/* eslint-enable @next/next/no-img-element */

// ── Codes tab ───────────────────────────────────────────────────────
function CodesTab() {
  const [query, setQuery] = useState('');
  const [codeFilter, setCodeFilter] = useState('');
  const [results, setResults] = useState<CodeEntry[]>([]);
  const [codes, setCodes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const search = useCallback(async () => {
    setBusy(true);
    const r = await run<{ results: CodeEntry[]; codes: string[] }>('code-search', { query, code: codeFilter });
    setResults(r?.results || []);
    if (r?.codes) setCodes(r.codes);
    setBusy(false);
  }, [query, codeFilter]);
  useEffect(() => { void search(); }, [search]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
          <input className={`${inputCls} w-full pl-8`} placeholder="Search AWS D1.1 / ASME IX / API 1104 clauses…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <select className={inputCls} value={codeFilter} onChange={(e) => setCodeFilter(e.target.value)}>
          <option value="">All codes</option>
          {codes.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      {busy && <div className="flex items-center gap-2 text-xs text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> Searching…</div>}

      <div className="space-y-1.5">
        {results.map((c) => (
          <div key={c.id} className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
            <div className="flex items-center gap-2">
              <span className="rounded bg-orange-500/20 px-1.5 py-0.5 font-mono text-[10px] text-orange-200">{c.code} {c.clause}</span>
              <span className="text-[12px] font-medium text-white">{c.title}</span>
              {c.relevance != null && <span className="ml-auto text-[9px] text-zinc-600">relevance {c.relevance}</span>}
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-zinc-400">{c.body}</p>
            <div className="mt-1 flex flex-wrap gap-1">
              {c.keywords.map((k) => <span key={k} className="rounded bg-zinc-800 px-1.5 py-0.5 text-[9px] text-zinc-500">{k}</span>)}
            </div>
          </div>
        ))}
        {!busy && results.length === 0 && <div className="rounded border border-dashed border-zinc-800 p-4 text-center text-[11px] text-zinc-500">No matching clauses.</div>}
      </div>
    </div>
  );
}

// ── shell ───────────────────────────────────────────────────────────
export function WeldingOperations() {
  const [tab, setTab] = useState<OpsTab>('schedule');
  const [ops, setOps] = useState<{ activeJobs: number; completedJobs: number; pipelineValue: number; outstanding: number; collected: number; overdueInvoices: number; certAtRisk: number } | null>(null);

  useEffect(() => {
    let alive = true;
    run<typeof ops>('ops-summary').then((r) => { if (alive) setOps(r); });
    return () => { alive = false; };
  }, [tab]);

  const stats = useMemo(() => ops ? [
    { label: 'Active jobs', value: String(ops.activeJobs), tone: 'text-orange-300' },
    { label: 'Completed', value: String(ops.completedJobs), tone: 'text-emerald-300' },
    { label: 'Pipeline', value: fmt(ops.pipelineValue), tone: 'text-amber-300' },
    { label: 'Outstanding', value: fmt(ops.outstanding), tone: 'text-rose-300' },
    { label: 'Collected', value: fmt(ops.collected), tone: 'text-emerald-300' },
    { label: 'Overdue inv.', value: String(ops.overdueInvoices), tone: 'text-rose-300' },
    { label: 'Certs at risk', value: String(ops.certAtRisk), tone: 'text-amber-300' },
  ] : [], [ops]);

  return (
    <div className="space-y-3">
      <header className="flex items-center gap-2 border-b border-orange-500/15 pb-2">
        <CheckCircle2 className="h-4 w-4 text-orange-400" />
        <h2 className="text-sm font-semibold text-white">Field-service operations</h2>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">Jobber-parity console</span>
      </header>

      {stats.length > 0 && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
          {stats.map((s) => (
            <div key={s.label} className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5">
              <div className="text-[9px] uppercase tracking-wider text-zinc-500">{s.label}</div>
              <div className={`font-mono text-base ${s.tone}`}>{s.value}</div>
            </div>
          ))}
        </div>
      )}

      <nav className="flex flex-wrap items-center gap-1.5">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-xs transition-colors ${tab === t.id ? 'bg-orange-500/20 text-orange-200' : 'text-zinc-400 hover:bg-zinc-800 hover:text-white'}`}
          >
            <t.icon className="h-3.5 w-3.5" />{t.label}
          </button>
        ))}
      </nav>

      {tab === 'schedule' && <ScheduleTab />}
      {tab === 'quotes' && <QuotesTab />}
      {tab === 'invoices' && <InvoicesTab />}
      {tab === 'wps' && <WpsTab />}
      {tab === 'certs' && <CertsTab />}
      {tab === 'photos' && <PhotosTab />}
      {tab === 'codes' && <CodesTab />}
    </div>
  );
}
