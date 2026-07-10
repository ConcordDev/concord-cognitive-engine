'use client';

/**
 * ConsultingCalculators — four deal-desk formula tools every consulting
 * practice keeps a spreadsheet for: fee/scope estimation, utilization
 * rate against a target band, proposal readiness scoring, and client
 * health scoring. Each wires a real pure-compute consulting.* macro
 * (engagementScope / utilizationRate / proposalScore / clientHealth)
 * that previously had no UI at all.
 */

import { useState } from 'react';
import { Calculator, Gauge, ClipboardCheck, HeartPulse, Plus, Trash2, Loader2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

type Tool = 'scope' | 'utilization' | 'proposal' | 'health';

const TOOLS: { id: Tool; label: string; icon: typeof Calculator }[] = [
  { id: 'scope', label: 'Fee & Scope', icon: Calculator },
  { id: 'utilization', label: 'Utilization', icon: Gauge },
  { id: 'proposal', label: 'Proposal Readiness', icon: ClipboardCheck },
  { id: 'health', label: 'Client Health', icon: HeartPulse },
];

interface Deliverable { name: string; hours: string }
interface ScopeResult {
  client: string; totalHours: number; hourlyRate: number; subtotal: number;
  contingency: number; grandTotal: number; timeline: string;
  deliverables: { name: string | null; hours: number; fee: number }[];
}
interface UtilResult { billableHours: number; totalHours: number; utilizationRate: number; target: number; variance: number; status: string }
interface ProposalResult { score: number; sectionsPresent: string[]; sectionsMissing: string[]; completeness: string }
interface HealthResult { client: string; nps: number; paymentRate: number; avgResponseDays: number; healthScore: number; risk: string }

const PROPOSAL_SECTIONS = ['executive-summary', 'methodology', 'timeline', 'pricing', 'team', 'references'];

function StatusPill({ tone, children }: { tone: 'good' | 'warn' | 'bad'; children: React.ReactNode }) {
  const cls = tone === 'good' ? 'bg-emerald-500/10 text-emerald-400' : tone === 'warn' ? 'bg-amber-500/10 text-amber-400' : 'bg-rose-500/10 text-rose-400';
  return <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase ${cls}`}>{children}</span>;
}

function ScopeCalculator() {
  const [client, setClient] = useState('');
  const [rate, setRate] = useState('200');
  const [rows, setRows] = useState<Deliverable[]>([{ name: 'Discovery workshop', hours: '16' }]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ScopeResult | null>(null);

  function addRow() { setRows([...rows, { name: '', hours: '' }]); }
  function updateRow(i: number, patch: Partial<Deliverable>) { setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r))); }
  function removeRow(i: number) { setRows(rows.filter((_, j) => j !== i)); }

  async function run() {
    setBusy(true);
    try {
      const r = await lensRun('consulting', 'engagementScope', {
        artifact: {
          title: client,
          data: {
            client,
            hourlyRate: Number(rate) || 0,
            deliverables: rows.filter(d => d.name.trim()).map(d => ({ name: d.name.trim(), hours: Number(d.hours) || 0 })),
          },
        },
      });
      if (r.data?.ok) setResult(r.data.result as ScopeResult);
    } finally { setBusy(false); }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        <input value={client} onChange={e => setClient(e.target.value)} placeholder="Client"
          className="flex-1 min-w-[120px] bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
        <input value={rate} onChange={e => setRate(e.target.value)} placeholder="$/hr"
          className="w-20 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
      </div>
      <div className="space-y-1">
        {rows.map((row, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <input value={row.name} onChange={e => updateRow(i, { name: e.target.value })} placeholder="Deliverable"
              className="flex-1 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
            <input value={row.hours} onChange={e => updateRow(i, { hours: e.target.value })} placeholder="hrs"
              className="w-16 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
            <button aria-label="Remove deliverable" onClick={() => removeRow(i)} className="text-rose-400"><Trash2 className="w-3 h-3" /></button>
          </div>
        ))}
        <button onClick={addRow} className="text-[11px] text-indigo-300 hover:text-indigo-200 inline-flex items-center gap-1"><Plus className="w-3 h-3" />Add deliverable</button>
      </div>
      <button onClick={run} disabled={busy || rows.every(r => !r.name.trim())}
        className="px-3 py-1.5 text-xs rounded bg-indigo-600 hover:bg-indigo-500 text-white font-semibold disabled:opacity-40 inline-flex items-center gap-1.5">
        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Calculator className="w-3.5 h-3.5" />}Estimate fee
      </button>
      {result && (
        <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-3 space-y-2">
          <div className="grid grid-cols-4 gap-2 text-center">
            {([['Hours', result.totalHours], ['Subtotal', `$${result.subtotal.toLocaleString()}`], ['Contingency (15%)', `$${result.contingency.toLocaleString()}`], ['Grand total', `$${result.grandTotal.toLocaleString()}`]] as const).map(([l, v]) => (
              <div key={l} className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1.5">
                <p className="text-sm font-bold text-zinc-100">{v}</p>
                <p className="text-[9px] text-zinc-400 uppercase">{l}</p>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-zinc-400">Timeline estimate: <span className="text-zinc-200">{result.timeline}</span></p>
          <ul className="space-y-0.5">
            {result.deliverables.map((d, i) => (
              <li key={i} className="text-[11px] text-zinc-400 flex justify-between"><span>{d.name || 'Untitled'}</span><span className="text-zinc-200">{d.hours}h · ${d.fee.toLocaleString()}</span></li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function UtilizationCalculator() {
  const [billable, setBillable] = useState('120');
  const [total, setTotal] = useState('160');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<UtilResult | null>(null);

  async function run() {
    setBusy(true);
    try {
      const r = await lensRun('consulting', 'utilizationRate', { artifact: { data: { billableHours: Number(billable) || 0, totalHours: Number(total) || 0 } } });
      if (r.data?.ok) setResult(r.data.result as UtilResult);
    } finally { setBusy(false); }
  }

  const tone = result ? (result.status === 'excellent' || result.status === 'on-target' ? 'good' : result.status === 'below-target' ? 'warn' : 'bad') : 'warn';

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        <label className="text-[10px] text-zinc-400 flex-1 min-w-[100px]">Billable hours
          <input value={billable} onChange={e => setBillable(e.target.value)} className="mt-1 w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
        </label>
        <label className="text-[10px] text-zinc-400 flex-1 min-w-[100px]">Total hours available
          <input value={total} onChange={e => setTotal(e.target.value)} className="mt-1 w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
        </label>
      </div>
      <button onClick={run} disabled={busy} className="px-3 py-1.5 text-xs rounded bg-indigo-600 hover:bg-indigo-500 text-white font-semibold disabled:opacity-40 inline-flex items-center gap-1.5">
        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Gauge className="w-3.5 h-3.5" />}Calculate
      </button>
      {result && (
        <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-3 space-y-2">
          <div className="flex items-center gap-2">
            <p className="text-2xl font-bold text-zinc-100">{result.utilizationRate}%</p>
            <StatusPill tone={tone}>{result.status}</StatusPill>
          </div>
          <div className="h-1.5 rounded-full bg-zinc-800 overflow-hidden">
            <div className="h-full bg-indigo-500" style={{ width: `${Math.min(100, result.utilizationRate)}%` }} />
          </div>
          <p className="text-[11px] text-zinc-400">Target {result.target}% · variance {result.variance >= 0 ? '+' : ''}{result.variance}pp</p>
        </div>
      )}
    </div>
  );
}

function ProposalReadinessCalculator() {
  const [present, setPresent] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ProposalResult | null>(null);

  function toggle(s: string) { setPresent(prev => { const n = new Set(prev); if (n.has(s)) n.delete(s); else n.add(s); return n; }); }

  async function run() {
    setBusy(true);
    try {
      const data: Record<string, boolean> = {};
      for (const s of present) data[s] = true;
      const r = await lensRun('consulting', 'proposalScore', { artifact: { data } });
      if (r.data?.ok) setResult(r.data.result as ProposalResult);
    } finally { setBusy(false); }
  }

  const tone = result ? (result.completeness === 'ready-to-submit' ? 'good' : result.completeness === 'needs-work' ? 'warn' : 'bad') : 'warn';

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-1.5">
        {PROPOSAL_SECTIONS.map(s => (
          <label key={s} className="flex items-center gap-1.5 text-[11px] text-zinc-300 cursor-pointer">
            <input type="checkbox" checked={present.has(s)} onChange={() => toggle(s)} />
            <span className="capitalize">{s.replace(/-/g, ' ')}</span>
          </label>
        ))}
      </div>
      <button onClick={run} disabled={busy} className="px-3 py-1.5 text-xs rounded bg-indigo-600 hover:bg-indigo-500 text-white font-semibold disabled:opacity-40 inline-flex items-center gap-1.5">
        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ClipboardCheck className="w-3.5 h-3.5" />}Score proposal
      </button>
      {result && (
        <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-3 space-y-2">
          <div className="flex items-center gap-2">
            <p className="text-2xl font-bold text-zinc-100">{result.score}%</p>
            <StatusPill tone={tone}>{result.completeness.replace(/-/g, ' ')}</StatusPill>
          </div>
          {result.sectionsMissing.length > 0 && (
            <p className="text-[11px] text-zinc-400">Missing: <span className="text-amber-300">{result.sectionsMissing.map(s => s.replace(/-/g, ' ')).join(', ')}</span></p>
          )}
        </div>
      )}
    </div>
  );
}

function ClientHealthCalculator() {
  const [client, setClient] = useState('');
  const [nps, setNps] = useState('30');
  const [paid, setPaid] = useState('9');
  const [totalInv, setTotalInv] = useState('10');
  const [responseDays, setResponseDays] = useState('2');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<HealthResult | null>(null);

  async function run() {
    setBusy(true);
    try {
      const r = await lensRun('consulting', 'clientHealth', {
        artifact: { data: { client, nps: Number(nps) || 0, invoicesPaid: Number(paid) || 0, invoicesTotal: Number(totalInv) || 1, avgResponseDays: Number(responseDays) || 0 } },
      });
      if (r.data?.ok) setResult(r.data.result as HealthResult);
    } finally { setBusy(false); }
  }

  const tone = result ? (result.risk === 'low' ? 'good' : result.risk === 'medium' ? 'warn' : 'bad') : 'warn';

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        <input value={client} onChange={e => setClient(e.target.value)} placeholder="Client"
          className="flex-1 min-w-[100px] bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
        <label className="text-[10px] text-zinc-400">NPS (-100..100)
          <input value={nps} onChange={e => setNps(e.target.value)} className="mt-1 w-24 block bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
        </label>
        <label className="text-[10px] text-zinc-400">Invoices paid
          <input value={paid} onChange={e => setPaid(e.target.value)} className="mt-1 w-20 block bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
        </label>
        <label className="text-[10px] text-zinc-400">Invoices total
          <input value={totalInv} onChange={e => setTotalInv(e.target.value)} className="mt-1 w-20 block bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
        </label>
        <label className="text-[10px] text-zinc-400">Avg response (days)
          <input value={responseDays} onChange={e => setResponseDays(e.target.value)} className="mt-1 w-24 block bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
        </label>
      </div>
      <button onClick={run} disabled={busy} className="px-3 py-1.5 text-xs rounded bg-indigo-600 hover:bg-indigo-500 text-white font-semibold disabled:opacity-40 inline-flex items-center gap-1.5">
        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <HeartPulse className="w-3.5 h-3.5" />}Score client
      </button>
      {result && (
        <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-3 space-y-2">
          <div className="flex items-center gap-2">
            <p className="text-2xl font-bold text-zinc-100">{result.healthScore}</p>
            <StatusPill tone={tone}>{result.risk} risk</StatusPill>
          </div>
          <p className="text-[11px] text-zinc-400">Payment rate {result.paymentRate}% · avg response {result.avgResponseDays}d</p>
        </div>
      )}
    </div>
  );
}

export function ConsultingCalculators() {
  const [tool, setTool] = useState<Tool>('scope');
  return (
    <div className="space-y-3">
      <nav className="flex flex-wrap gap-1.5">
        {TOOLS.map(t => {
          const Icon = t.icon;
          return (
            <button key={t.id} onClick={() => setTool(t.id)}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                tool === t.id ? 'bg-indigo-600 text-white' : 'bg-zinc-900 text-zinc-400 hover:text-zinc-200'
              }`}>
              <Icon className="w-3.5 h-3.5" />{t.label}
            </button>
          );
        })}
      </nav>
      {tool === 'scope' && <ScopeCalculator />}
      {tool === 'utilization' && <UtilizationCalculator />}
      {tool === 'proposal' && <ProposalReadinessCalculator />}
      {tool === 'health' && <ClientHealthCalculator />}
    </div>
  );
}
