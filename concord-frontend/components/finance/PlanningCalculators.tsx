'use client';

/**
 * Planning calculators: growth projection (instant JS engine, or the pandas
 * engine with one-time deposits/withdrawals), avalanche debt payoff and a
 * monthly budget check. Every figure is the finance domain's own output.
 */

import { useState, type ReactNode } from 'react';
import { Calculator, CreditCard, Loader2, PiggyBank, Plus, Trash2, Wallet } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

const usd = (n: number | undefined | null) =>
  typeof n === 'number' && Number.isFinite(n) ? n.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }) : '—';

function Shell({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <section className="overflow-hidden rounded-lg border border-cyan-500/20 bg-[#0d1117] transition-colors hover:border-cyan-500/35">
      <header className="flex items-center gap-2 border-b border-white/10 px-4 py-2">
        {icon}
        <span className="text-xs font-semibold uppercase tracking-wider text-gray-300">{title}</span>
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

function Field({ label, value, onChange, prefix }: { label: string; value: string; onChange: (v: string) => void; prefix?: string }) {
  return (
    <label className="flex flex-col gap-1 text-[11px] text-gray-400">
      {label}
      <div className="flex items-center rounded border border-lattice-border bg-lattice-deep px-2 focus-within:border-cyan-500/50">
        {prefix && <span className="text-xs text-gray-500">{prefix}</span>}
        <input type="number" value={value} onChange={(e) => onChange(e.target.value)} className="w-full bg-transparent px-1 py-1.5 font-mono text-xs text-white focus:outline-none" />
      </div>
    </label>
  );
}

function Go({ onClick, busy, children }: { onClick: () => void; busy: boolean; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} disabled={busy} className="inline-flex items-center gap-2 rounded bg-cyan-500 px-3 py-1.5 text-xs font-bold text-black transition-colors hover:bg-cyan-400 disabled:opacity-50">
      {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}{children}
    </button>
  );
}

function Fail({ msg }: { msg: string | null }) {
  return msg ? <p role="alert" className="mt-3 rounded border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">{msg}</p> : null;
}

function Bars({ points }: { points: Array<{ label: string; value: number }> }) {
  const max = Math.max(1, ...points.map((p) => p.value));
  return (
    <div className="mt-3 flex h-28 items-end gap-0.5" role="img" aria-label="Projected balance over time">
      {points.map((p) => (
        <div key={p.label} title={`${p.label}: ${usd(p.value)}`} className="flex-1 rounded-t bg-cyan-400/70 transition-all duration-500 hover:bg-cyan-300" style={{ height: `${Math.max(2, (p.value / max) * 100)}%` }} />
      ))}
    </div>
  );
}

interface GrowthJs { finalBalance: number; totalContributed: number; totalInterest: number; interestPercent: number; timeline: Array<{ year: number; balance: number }> }
interface GrowthPy { summary: { finalBalance: number; totalContributed: number; totalGrowth: number }; timeline: Array<{ month: number; balance: number }> }

function GrowthCalculator() {
  const [engine, setEngine] = useState<'js' | 'pandas'>('js');
  const [f, setF] = useState({ principal: '10000', monthly: '500', rate: '7', years: '20' });
  const [events, setEvents] = useState<Array<{ month: string; amount: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [out, setOut] = useState<{ final: number; contributed: number; growth: number; points: Array<{ label: string; value: number }> } | null>(null);

  const run = async () => {
    setBusy(true); setErr(null);
    try {
      const rate = (parseFloat(f.rate) || 0) / 100;
      const years = Math.max(1, parseInt(f.years) || 1);
      if (engine === 'js') {
        const r = await lensRun<GrowthJs>('finance', 'compoundInterest', { principal: f.principal, annualRate: rate, years, monthlyContribution: f.monthly });
        if (!r.data.ok || !r.data.result) throw new Error(r.data.error || 'The projection failed.');
        const g = r.data.result;
        setOut({ final: g.finalBalance, contributed: g.totalContributed, growth: g.totalInterest, points: g.timeline.map((t) => ({ label: `Year ${t.year}`, value: t.balance })) });
      } else {
        const r = await lensRun<GrowthPy>('finance', 'cashflow-projection-python', {
          startingBalance: Number(f.principal) || 0,
          months: years * 12,
          monthlyContribution: Number(f.monthly) || 0,
          annualReturnRate: rate,
          oneTimeEvents: events.map((e) => ({ month: Number(e.month), amount: Number(e.amount) })),
        });
        if (!r.data.ok || !r.data.result) {
          const code = r.data.error || '';
          throw new Error(code === 'python_exec_disabled'
            ? 'The pandas engine is switched off on this server (CONCORD_PYTHON_EXEC_ENABLED). Use the instant engine instead.'
            : code === 'python_package_not_vendored' ? 'pandas is not installed on this server yet.' : code || 'The projection failed.');
        }
        const g = r.data.result;
        setOut({
          final: g.summary.finalBalance, contributed: g.summary.totalContributed, growth: g.summary.totalGrowth,
          points: g.timeline.filter((t) => t.month % 12 === 0).map((t) => ({ label: `Year ${t.month / 12}`, value: t.balance })),
        });
      }
    } catch (e) {
      setOut(null); setErr((e as Error).message);
    } finally { setBusy(false); }
  };

  return (
    <Shell icon={<PiggyBank className="h-4 w-4 text-cyan-400" />} title="Growth projection">
      <div className="mb-3 inline-flex rounded-full border border-white/10 p-0.5">
        {([['js', 'Instant'], ['pandas', 'pandas + one-time events']] as const).map(([id, label]) => (
          <button key={id} type="button" aria-pressed={engine === id} onClick={() => setEngine(id)} className={cn('rounded-full px-3 py-1 text-[11px] transition-colors', engine === id ? 'bg-white/10 text-white' : 'text-gray-500 hover:text-gray-200')}>{label}</button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Field label="Starting balance" prefix="$" value={f.principal} onChange={(v) => setF({ ...f, principal: v })} />
        <Field label="Monthly add" prefix="$" value={f.monthly} onChange={(v) => setF({ ...f, monthly: v })} />
        <Field label="Annual return %" value={f.rate} onChange={(v) => setF({ ...f, rate: v })} />
        <Field label="Years" value={f.years} onChange={(v) => setF({ ...f, years: v })} />
      </div>
      {engine === 'pandas' && (
        <div className="mt-3 space-y-2">
          {events.map((e, i) => (
            <div key={i} className="flex items-end gap-2">
              <Field label="Month #" value={e.month} onChange={(v) => setEvents((xs) => xs.map((x, j) => (j === i ? { ...x, month: v } : x)))} />
              <Field label="Amount (neg = withdraw)" prefix="$" value={e.amount} onChange={(v) => setEvents((xs) => xs.map((x, j) => (j === i ? { ...x, amount: v } : x)))} />
              <button type="button" aria-label="Remove event" onClick={() => setEvents((xs) => xs.filter((_, j) => j !== i))} className="mb-1.5 p-1 text-gray-500 hover:text-rose-300"><Trash2 className="h-3.5 w-3.5" /></button>
            </div>
          ))}
          <button type="button" onClick={() => setEvents((xs) => [...xs, { month: '12', amount: '5000' }])} className="inline-flex items-center gap-1 text-[11px] text-cyan-300 hover:text-cyan-200"><Plus className="h-3 w-3" /> One-time deposit or withdrawal</button>
        </div>
      )}
      <div className="mt-3"><Go onClick={() => void run()} busy={busy}>Project</Go></div>
      <Fail msg={err} />
      {out && (
        <>
          <div className="mt-3 grid grid-cols-3 gap-2 text-center">
            <div className="rounded bg-black/30 p-2"><p className="font-mono text-sm text-cyan-200">{usd(out.final)}</p><p className="text-[10px] text-gray-500">final balance</p></div>
            <div className="rounded bg-black/30 p-2"><p className="font-mono text-sm text-gray-200">{usd(out.contributed)}</p><p className="text-[10px] text-gray-500">you put in</p></div>
            <div className="rounded bg-black/30 p-2"><p className="font-mono text-sm text-emerald-300">{usd(out.growth)}</p><p className="text-[10px] text-gray-500">growth</p></div>
          </div>
          <Bars points={out.points} />
        </>
      )}
    </Shell>
  );
}

interface DebtOut {
  message?: string;
  debts?: Array<{ name: string; balance: number; rate: string; minimumPayment: number; monthsToPayoff: number; totalInterest: number }>;
  totalDebt?: number; totalInterest?: number; strategy?: string; firstTarget?: string; monthsToDebtFree?: number;
}

function DebtPayoff() {
  const [debts, setDebts] = useState([{ name: 'Credit card', balance: '4200', rate: '22.9', minimumPayment: '120' }]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [out, setOut] = useState<DebtOut | null>(null);
  const upd = (i: number, k: string, v: string) => setDebts((xs) => xs.map((x, j) => (j === i ? { ...x, [k]: v } : x)));

  const run = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await lensRun<DebtOut>('finance', 'debtPayoff', {
        debts: debts.map((d) => ({ name: d.name, balance: d.balance, rate: (parseFloat(d.rate) || 0) / 100, minimumPayment: d.minimumPayment })),
      });
      if (!r.data.ok || !r.data.result) throw new Error(r.data.error || 'The payoff plan failed.');
      setOut(r.data.result);
    } catch (e) { setOut(null); setErr((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <Shell icon={<CreditCard className="h-4 w-4 text-rose-300" />} title="Debt payoff">
      <div className="space-y-2">
        {debts.map((d, i) => (
          <div key={i} className="grid grid-cols-2 items-end gap-2 sm:grid-cols-[1.4fr_1fr_0.8fr_1fr_auto]">
            <label className="col-span-2 flex flex-col gap-1 text-[11px] text-gray-400 sm:col-span-1">Name
              <input value={d.name} onChange={(e) => upd(i, 'name', e.target.value)} className="rounded border border-lattice-border bg-lattice-deep px-2 py-1.5 text-xs text-white" />
            </label>
            <Field label="Balance" prefix="$" value={d.balance} onChange={(v) => upd(i, 'balance', v)} />
            <Field label="APR %" value={d.rate} onChange={(v) => upd(i, 'rate', v)} />
            <Field label="Min payment" prefix="$" value={d.minimumPayment} onChange={(v) => upd(i, 'minimumPayment', v)} />
            <button type="button" aria-label={`Remove ${d.name}`} onClick={() => setDebts((xs) => xs.filter((_, j) => j !== i))} className="mb-1.5 p-1 text-gray-500 hover:text-rose-300"><Trash2 className="h-3.5 w-3.5" /></button>
          </div>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => setDebts((xs) => [...xs, { name: `Debt ${xs.length + 1}`, balance: '1000', rate: '10', minimumPayment: '50' }])} className="inline-flex items-center gap-1 text-[11px] text-cyan-300 hover:text-cyan-200"><Plus className="h-3 w-3" /> Add a debt</button>
        <Go onClick={() => void run()} busy={busy}>Plan payoff</Go>
      </div>
      <Fail msg={err} />
      {out?.message && <p className="mt-3 text-xs text-gray-400">{out.message}</p>}
      {out?.debts && (
        <div className="mt-3 space-y-2">
          <p className="text-xs text-gray-300">{out.strategy}. Attack <span className="font-semibold text-rose-200">{out.firstTarget}</span> first. Debt-free in <span className="font-mono text-cyan-200">{out.monthsToDebtFree === 999 ? 'never at these minimums' : `${out.monthsToDebtFree} months`}</span>, paying <span className="font-mono text-rose-200">{usd(out.totalInterest)}</span> in interest.</p>
          <ul className="divide-y divide-white/5 rounded border border-white/10">
            {out.debts.map((d) => (
              <li key={d.name} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs">
                <span className="text-gray-200">{d.name} <span className="text-gray-500">· {d.rate}</span></span>
                <span className="font-mono text-gray-400">{d.monthsToPayoff === 999 ? 'minimum does not cover interest' : `${d.monthsToPayoff} mo · ${usd(d.totalInterest)} interest`}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Shell>
  );
}

interface BudgetOut {
  monthlyIncome: number; totalBudgeted: number; totalSpent: number; remaining: number; savingsRate: number;
  categories: Array<{ category: string; budget: number; spent: number; remaining: number; percentUsed: number; status: string }>;
}

function BudgetCheck() {
  const [income, setIncome] = useState('5000');
  const [cats, setCats] = useState([
    { name: 'Housing', budget: '1600', spent: '1600' },
    { name: 'Groceries', budget: '500', spent: '0' },
  ]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [out, setOut] = useState<BudgetOut | null>(null);
  const upd = (i: number, k: string, v: string) => setCats((xs) => xs.map((x, j) => (j === i ? { ...x, [k]: v } : x)));

  const run = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await lensRun<BudgetOut>('finance', 'budgetTracker', { monthlyIncome: income, categories: cats });
      if (!r.data.ok || !r.data.result) throw new Error(r.data.error || 'The budget check failed.');
      setOut(r.data.result);
    } catch (e) { setOut(null); setErr((e as Error).message); } finally { setBusy(false); }
  };

  const tone = (s: string) => (s === 'over-budget' ? 'bg-rose-400' : s === 'near-limit' ? 'bg-amber-400' : 'bg-emerald-400');

  return (
    <Shell icon={<Wallet className="h-4 w-4 text-emerald-300" />} title="Budget check">
      <div className="max-w-[12rem]"><Field label="Monthly income" prefix="$" value={income} onChange={setIncome} /></div>
      <div className="mt-2 space-y-2">
        {cats.map((c, i) => (
          <div key={i} className="grid grid-cols-[1.4fr_1fr_1fr_auto] items-end gap-2">
            <label className="flex flex-col gap-1 text-[11px] text-gray-400">Category
              <input value={c.name} onChange={(e) => upd(i, 'name', e.target.value)} className="rounded border border-lattice-border bg-lattice-deep px-2 py-1.5 text-xs text-white" />
            </label>
            <Field label="Budget" prefix="$" value={c.budget} onChange={(v) => upd(i, 'budget', v)} />
            <Field label="Spent" prefix="$" value={c.spent} onChange={(v) => upd(i, 'spent', v)} />
            <button type="button" aria-label={`Remove ${c.name}`} onClick={() => setCats((xs) => xs.filter((_, j) => j !== i))} className="mb-1.5 p-1 text-gray-500 hover:text-rose-300"><Trash2 className="h-3.5 w-3.5" /></button>
          </div>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => setCats((xs) => [...xs, { name: 'New category', budget: '100', spent: '0' }])} className="inline-flex items-center gap-1 text-[11px] text-cyan-300 hover:text-cyan-200"><Plus className="h-3 w-3" /> Add a category</button>
        <Go onClick={() => void run()} busy={busy}>Check budget</Go>
      </div>
      <Fail msg={err} />
      {out && (
        <div className="mt-3 space-y-2">
          <p className="text-xs text-gray-300">{usd(out.totalSpent)} spent of {usd(out.totalBudgeted)} budgeted · {usd(out.remaining)} left of income · savings rate <span className="font-mono text-emerald-300">{out.savingsRate}%</span></p>
          {out.categories.map((c) => (
            <div key={c.category}>
              <div className="mb-1 flex justify-between text-[11px] text-gray-400"><span>{c.category}</span><span className="font-mono">{c.percentUsed}% · {usd(c.remaining)} left</span></div>
              <div className="h-1.5 overflow-hidden rounded-full bg-white/5"><div className={cn('h-full transition-all duration-500', tone(c.status))} style={{ width: `${Math.min(100, c.percentUsed)}%` }} /></div>
            </div>
          ))}
        </div>
      )}
    </Shell>
  );
}

export function PlanningCalculators() {
  return (
    <div className="space-y-4">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-200"><Calculator className="h-4 w-4 text-cyan-400" /> Calculators</h3>
      <GrowthCalculator />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <DebtPayoff />
        <BudgetCheck />
      </div>
    </div>
  );
}
