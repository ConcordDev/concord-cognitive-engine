'use client';

import { useState, useEffect, useCallback } from 'react';
import { X, Loader2, Home, Calculator, Save, Trash2, Plus, ScrollText } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Props {
  open: boolean;
  onClose: () => void;
}

type Tab = 'mortgage' | 'afford' | 'rentbuy' | 'searches';

export function RealEstateWorkbench({ open, onClose }: Props) {
  const [tab, setTab] = useState<Tab>('mortgage');

  if (!open) return null;

  return (
    <div className="fixed inset-y-0 right-0 w-[560px] max-w-[100vw] z-40 bg-[#0d1117] border-l border-orange-500/20 shadow-2xl overflow-hidden flex flex-col">
      <header className="px-4 py-3 border-b border-white/10 flex items-center justify-between bg-gradient-to-r from-orange-950/40 to-transparent">
        <div className="flex items-center gap-2">
          <Home className="w-4 h-4 text-orange-400" />
          <span className="text-sm font-semibold text-gray-200">Real Estate Workbench</span>
        </div>
        <button type="button" onClick={onClose} className="p-1 rounded-md hover:bg-white/5 text-gray-400" aria-label="Close">
          <X className="w-4 h-4" />
        </button>
      </header>

      <nav className="px-3 py-2 border-b border-white/10 flex items-center gap-1">
        {([
          { id: 'mortgage', label: 'Mortgage',     icon: Calculator },
          { id: 'afford',   label: 'Afford',       icon: Calculator },
          { id: 'rentbuy',  label: 'Rent vs Buy',  icon: Calculator },
          { id: 'searches', label: 'Saved',        icon: ScrollText },
        ] as const).map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button key={t.id} type="button" onClick={() => setTab(t.id)}
              className={cn(
                'inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded transition',
                active
                  ? 'bg-orange-500/15 text-orange-200 border border-orange-500/40'
                  : 'text-gray-400 hover:text-gray-200 border border-transparent',
              )}>
              <Icon className="w-3 h-3" /> {t.label}
            </button>
          );
        })}
      </nav>

      <div className="flex-1 overflow-y-auto">
        {tab === 'mortgage' && <MortgageTab />}
        {tab === 'afford' && <AffordTab />}
        {tab === 'rentbuy' && <RentBuyTab />}
        {tab === 'searches' && <SearchesTab />}
      </div>
    </div>
  );
}

function MortgageTab() {
  const [vals, setVals] = useState({ price: 500_000, downPercent: 20, rate: 7, termYears: 30, taxRate: 1.1, insurance: 1200, hoa: 0 });
  const [result, setResult] = useState<{
    monthly: { total: number; principalAndInterest: number; tax: number; insurance: number; pmi: number; hoa: number };
    ltvPercent: number;
    totalCostOverTerm: number;
    totalInterest: number;
  } | null>(null);

  const calc = async () => {
    try {
      const r = await lensRun({ domain: 'realestate', action: 'calc-mortgage', input: vals });
      setResult(((r.data as { result?: typeof result }).result) || null);
    } catch (e) { console.error(e); }
  };

  useEffect(() => { calc(); }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="p-3 space-y-3">
      <div className="grid grid-cols-2 gap-2">
        {([
          ['price', 'Price ($)'],
          ['downPercent', 'Down %'],
          ['rate', 'Rate (%/yr)'],
          ['termYears', 'Term (yrs)'],
          ['taxRate', 'Tax (%/yr)'],
          ['insurance', 'Insurance ($/yr)'],
          ['hoa', 'HOA ($/mo)'],
        ] as const).map(([k, label]) => (
          <label key={k} className="flex flex-col gap-1">
            <span className="text-[10px] uppercase text-gray-400">{label}</span>
            <input type="number" value={vals[k]}
              onChange={(e) => setVals({ ...vals, [k]: Number(e.target.value) })}
              className="px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100 font-mono" />
          </label>
        ))}
      </div>
      <button type="button" onClick={calc}
        className="px-3 py-1 rounded-md border border-orange-500/40 bg-orange-500/15 text-xs text-orange-100">Compute PITI</button>

      {result && (
        <div className="rounded border border-orange-500/20 bg-orange-500/5 p-3 space-y-2">
          <p className="text-sm">
            Monthly total: <span className="font-mono text-2xl text-orange-300">${result.monthly.total.toLocaleString()}</span>
          </p>
          <div className="grid grid-cols-3 gap-2 text-xs">
            <p><span className="text-gray-400">P&I</span><br /><span className="font-mono text-gray-200">${result.monthly.principalAndInterest}</span></p>
            <p><span className="text-gray-400">Tax</span><br /><span className="font-mono text-gray-200">${result.monthly.tax}</span></p>
            <p><span className="text-gray-400">Insurance</span><br /><span className="font-mono text-gray-200">${result.monthly.insurance}</span></p>
            <p><span className="text-gray-400">PMI</span><br /><span className="font-mono text-gray-200">${result.monthly.pmi}</span></p>
            <p><span className="text-gray-400">HOA</span><br /><span className="font-mono text-gray-200">${result.monthly.hoa}</span></p>
            <p><span className="text-gray-400">LTV</span><br /><span className="font-mono text-gray-200">{result.ltvPercent}%</span></p>
          </div>
          <div className="border-t border-white/10 pt-2 text-xs">
            <p>Total interest over term: <span className="font-mono text-rose-300">${result.totalInterest.toLocaleString()}</span></p>
            <p>Total cost: <span className="font-mono text-gray-200">${result.totalCostOverTerm.toLocaleString()}</span></p>
          </div>
        </div>
      )}
    </div>
  );
}

function AffordTab() {
  const [vals, setVals] = useState({ grossIncome: 120_000, monthlyDebts: 500, downPayment: 50_000, rate: 7 });
  const [result, setResult] = useState<{
    maxHomePrice: number; maxPITI: number; band: string;
  } | null>(null);

  const calc = async () => {
    try {
      const r = await lensRun({ domain: 'realestate', action: 'calc-affordability', input: vals });
      setResult(((r.data as { result?: typeof result }).result) || null);
    } catch (e) { console.error(e); }
  };

  useEffect(() => { calc(); }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="p-3 space-y-3">
      <div className="grid grid-cols-2 gap-2">
        {([
          ['grossIncome', 'Gross income ($/yr)'],
          ['monthlyDebts', 'Monthly debts ($)'],
          ['downPayment', 'Down payment ($)'],
          ['rate', 'Rate (%)'],
        ] as const).map(([k, label]) => (
          <label key={k} className="flex flex-col gap-1">
            <span className="text-[10px] uppercase text-gray-400">{label}</span>
            <input type="number" value={vals[k]}
              onChange={(e) => setVals({ ...vals, [k]: Number(e.target.value) })}
              className="px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100 font-mono" />
          </label>
        ))}
      </div>
      <button type="button" onClick={calc}
        className="px-3 py-1 rounded-md border border-orange-500/40 bg-orange-500/15 text-xs text-orange-100">Compute</button>

      {result && (
        <div className="rounded border border-orange-500/20 bg-orange-500/5 p-3 space-y-1">
          <p className="text-sm">
            Max home price: <span className="font-mono text-2xl text-orange-300">${result.maxHomePrice.toLocaleString()}</span>
          </p>
          <p className="text-xs text-gray-400">Max PITI: ${result.maxPITI.toLocaleString()}/mo</p>
          <p className={cn(
            'text-[11px] inline-flex items-center px-2 py-0.5 rounded uppercase mt-1',
            result.band === 'comfortable' ? 'bg-emerald-500/20 text-emerald-300'
              : result.band === 'stretching' ? 'bg-amber-500/20 text-amber-300'
              : 'bg-rose-500/20 text-rose-300',
          )}>{result.band}</p>
          <p className="text-[10px] text-gray-400 mt-2">Based on 28% front-end / 36% back-end DTI rule.</p>
        </div>
      )}
    </div>
  );
}

function RentBuyTab() {
  const [vals, setVals] = useState({ price: 500_000, rent: 2500, downPercent: 20, rate: 7, horizonYears: 10, appreciation: 3 });
  const [result, setResult] = useState<{
    breakEvenYear: number | null; verdict: string;
    chartPoints: { year: number; buyNet: number; rentNet: number }[];
  } | null>(null);

  const calc = async () => {
    try {
      const r = await lensRun({ domain: 'realestate', action: 'calc-rent-vs-buy', input: vals });
      setResult(((r.data as { result?: typeof result }).result) || null);
    } catch (e) { console.error(e); }
  };

  useEffect(() => { calc(); }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="p-3 space-y-3">
      <div className="grid grid-cols-2 gap-2">
        {([
          ['price', 'Buy price'],
          ['rent', 'Monthly rent'],
          ['downPercent', 'Down %'],
          ['rate', 'Mortgage rate %'],
          ['horizonYears', 'Horizon years'],
          ['appreciation', 'Appreciation %/yr'],
        ] as const).map(([k, label]) => (
          <label key={k} className="flex flex-col gap-1">
            <span className="text-[10px] uppercase text-gray-400">{label}</span>
            <input type="number" value={vals[k]}
              onChange={(e) => setVals({ ...vals, [k]: Number(e.target.value) })}
              className="px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100 font-mono" />
          </label>
        ))}
      </div>
      <button type="button" onClick={calc}
        className="px-3 py-1 rounded-md border border-orange-500/40 bg-orange-500/15 text-xs text-orange-100">Compute</button>

      {result && (
        <div className="rounded border border-orange-500/20 bg-orange-500/5 p-3">
          <p className="text-sm">{result.verdict}</p>
          {result.breakEvenYear && (
            <p className="text-[11px] text-gray-400 mt-1">Break-even: year {result.breakEvenYear}</p>
          )}
          <div className="mt-3 border-t border-white/10 pt-2">
            <div className="grid grid-cols-3 text-[10px] uppercase tracking-wider text-gray-400">
              <span>Year</span><span className="text-right">Buy net</span><span className="text-right">Rent net</span>
            </div>
            {result.chartPoints.map((p) => (
              <div key={p.year} className="grid grid-cols-3 text-xs font-mono border-t border-white/5 py-0.5">
                <span className="text-gray-400">{p.year}</span>
                <span className={cn('text-right', p.buyNet < p.rentNet ? 'text-emerald-300' : 'text-gray-200')}>${p.buyNet.toLocaleString()}</span>
                <span className="text-right text-gray-200">${p.rentNet.toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function SearchesTab() {
  const [searches, setSearches] = useState<{ id: string; name: string; alertCadence: string; createdAt: string; filters: Record<string, unknown> }[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({ name: '', alertCadence: 'weekly' as const });

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = await lensRun({ domain: 'realestate', action: 'saved-searches-list', input: {} });
      setSearches(((r.data as { result?: { searches?: typeof searches } }).result?.searches) || []);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const save = async () => {
    try {
      await lensRun({ domain: 'realestate', action: 'save-search', input: { ...draft, filters: {} } });
      setCreating(false); setDraft({ name: '', alertCadence: 'weekly' });
      await refresh();
    } catch (e) { console.error(e); }
  };

  const remove = async (id: string) => {
    try {
      await lensRun({ domain: 'realestate', action: 'delete-search', input: { id } });
      await refresh();
    } catch (e) { console.error(e); }
  };

  return (
    <div className="p-3 space-y-2">
      <button type="button" onClick={() => setCreating((v) => !v)}
        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-orange-500/30 bg-orange-500/10 text-xs text-orange-200">
        <Plus className="w-3 h-3" /> New search
      </button>
      {creating && (
        <div className="rounded border border-orange-500/30 bg-orange-500/5 p-3 space-y-2">
          <input type="text" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            placeholder="Search name (e.g. 3-bed in Austin under $600k)"
            className="w-full px-2 py-1.5 text-sm bg-black/40 border border-white/10 rounded text-gray-100" />
          <select value={draft.alertCadence} onChange={(e) => setDraft({ ...draft, alertCadence: e.target.value as typeof draft.alertCadence })}
            className="px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100">
            <option value="never">Never alert</option><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="instant">Instant</option>
          </select>
          <button type="button" onClick={save} disabled={!draft.name.trim()}
            className="inline-flex items-center gap-1 px-3 py-1 rounded-md border border-orange-500/40 bg-orange-500/15 text-xs text-orange-100 disabled:opacity-40">
            <Save className="w-3 h-3" /> Save
          </button>
        </div>
      )}
      {loading ? <div className="text-center py-8 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin inline mr-2" />Loading…</div> :
        searches.length === 0 ? <p className="text-center text-xs text-gray-400 py-8">No saved searches.</p> :
        searches.map((s) => (
          <div key={s.id} className="rounded border border-white/10 bg-black/20 p-3 group flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-100">{s.name}</p>
              <p className="text-[10px] text-gray-400">{s.alertCadence} alerts · {new Date(s.createdAt).toLocaleDateString()}</p>
            </div>
            <button aria-label="Delete" type="button" onClick={() => remove(s.id)}
              className="p-1 text-gray-600 hover:text-rose-300 opacity-0 group-hover:opacity-100"><Trash2 className="w-3 h-3" /></button>
          </div>
        ))
      }
    </div>
  );
}

export default RealEstateWorkbench;
