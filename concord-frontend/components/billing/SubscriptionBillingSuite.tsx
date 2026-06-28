'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * SubscriptionBillingSuite — the subscription-billing core for the billing lens.
 * Wires every billing.* macro added for Stripe-Billing feature parity:
 *  - Recurring plans + subscriptions + mid-cycle proration
 *  - Usage-based / metered billing with graduated rate tiers
 *  - Coupons / promo codes
 *  - Dunning workflow for failed payments
 *  - Customer billing portal (card on file, invoices)
 *  - Tax calculation per jurisdiction
 *  - Revenue analytics (MRR/ARR, cohorts, expansion)
 *
 * Every value rendered comes from a real macro round-trip — no mock data.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Layers, Repeat, Gauge, Ticket, AlertTriangle, UserCog,
  Landmark, LineChart as LineChartIcon, Plus, RefreshCw, Loader2, X,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { ChartKit } from '@/components/viz';

type MacroJSON = Record<string, any>;

const TABS = [
  { key: 'plans', label: 'Plans & Subscriptions', icon: Repeat },
  { key: 'usage', label: 'Metered Usage', icon: Gauge },
  { key: 'coupons', label: 'Coupons', icon: Ticket },
  { key: 'dunning', label: 'Dunning', icon: AlertTriangle },
  { key: 'portal', label: 'Customer Portal', icon: UserCog },
  { key: 'tax', label: 'Tax', icon: Landmark },
  { key: 'analytics', label: 'Revenue Analytics', icon: LineChartIcon },
] as const;
type TabKey = (typeof TABS)[number]['key'];

async function run(action: string, input: Record<string, unknown> = {}): Promise<MacroJSON | null> {
  const r = await lensRun('billing', action, input);
  if (!r.data.ok) throw new Error(r.data.error || `${action} failed`);
  return r.data.result as MacroJSON;
}

function money(v: number | undefined, cur = 'USD'): string {
  return `${cur} ${(Number(v) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function SubscriptionBillingSuite() {
  const [tab, setTab] = useState<TabKey>('plans');
  const [err, setErr] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      <header className="flex items-center gap-2 border-b border-cyan-500/15 pb-3">
        <Layers className="h-5 w-5 text-cyan-400" />
        <h2 className="text-sm font-semibold text-white">Subscription Billing</h2>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">
          billing.* macros
        </span>
      </header>

      <div className="flex flex-wrap gap-1">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => { setTab(key); setErr(null); }}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
              tab === key
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                : 'bg-zinc-900 text-zinc-400 hover:text-white border border-transparent'
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </div>

      {err && (
        <div role="alert" className="flex items-center justify-between rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">
          {err}
          <button onClick={() => setErr(null)} aria-label="Dismiss error"><X className="h-3.5 w-3.5" /></button>
        </div>
      )}

      {tab === 'plans' && <PlansPanel onError={setErr} />}
      {tab === 'usage' && <UsagePanel onError={setErr} />}
      {tab === 'coupons' && <CouponsPanel onError={setErr} />}
      {tab === 'dunning' && <DunningPanel onError={setErr} />}
      {tab === 'portal' && <PortalPanel onError={setErr} />}
      {tab === 'tax' && <TaxPanel onError={setErr} />}
      {tab === 'analytics' && <AnalyticsPanel onError={setErr} />}
    </div>
  );
}

// ── shared bits ─────────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-[11px] text-zinc-400">
      {label}
      {children}
    </label>
  );
}
const inputCls =
  'rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs text-white focus:border-cyan-500 focus:outline-none';

function Card({ children }: { children: React.ReactNode }) {
  return <div className="rounded-md border border-zinc-800 bg-zinc-950/40 p-3">{children}</div>;
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5">
      <div className="text-[10px] uppercase tracking-wider text-zinc-400">{label}</div>
      <div className={`mt-0.5 font-mono text-lg ${accent || 'text-cyan-300'}`}>{value}</div>
    </div>
  );
}

function Btn({
  children, onClick, busy, kind = 'primary',
}: { children: React.ReactNode; onClick: () => void; busy?: boolean; kind?: 'primary' | 'ghost' }) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 ${
        kind === 'primary'
          ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 hover:bg-cyan-500/30'
          : 'bg-zinc-900 text-zinc-300 border border-zinc-700 hover:text-white'
      }`}
    >
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
      {children}
    </button>
  );
}

// ── Plans & Subscriptions ───────────────────────────────────────────────────

function PlansPanel({ onError }: { onError: (e: string) => void }) {
  const [plans, setPlans] = useState<MacroJSON[]>([]);
  const [subData, setSubData] = useState<MacroJSON | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [pName, setPName] = useState('');
  const [pInterval, setPInterval] = useState('monthly');
  const [pAmount, setPAmount] = useState('29');
  const [pTrial, setPTrial] = useState('0');
  const [subPlan, setSubPlan] = useState('');
  const [subCustomer, setSubCustomer] = useState('');
  const [subQty, setSubQty] = useState('1');
  const [proSub, setProSub] = useState('');
  const [proNewPlan, setProNewPlan] = useState('');
  const [proResult, setProResult] = useState<MacroJSON | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setLoadErr(null);
    try {
      const [pl, su] = await Promise.all([run('plan-list'), run('subscription-list')]);
      setPlans(pl?.plans || []);
      setSubData(su);
    } catch (e) {
      // Surface the load failure in the panel's own alert (with Retry) — do NOT
      // also bubble to the suite-level banner, which has no re-fetch affordance.
      setLoadErr(e instanceof Error ? e.message : 'load failed');
    } finally {
      setLoading(false);
    }
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { reload(); }, []);

  if (loading) {
    return (
      <div role="status" aria-live="polite" className="flex items-center gap-2 px-3 py-6 text-xs text-zinc-400">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading plans &amp; subscriptions…
      </div>
    );
  }

  if (loadErr) {
    return (
      <div role="alert" className="space-y-2 rounded border border-red-500/20 bg-red-500/5 px-3 py-4 text-xs text-red-300">
        <div>Could not load billing data: {loadErr}</div>
        <Btn onClick={reload} kind="ghost"><RefreshCw className="h-3.5 w-3.5" />Retry</Btn>
      </div>
    );
  }

  const createPlan = async () => {
    if (!pName.trim()) { onError('plan name required'); return; }
    setBusy(true);
    try {
      await run('plan-create', { name: pName, interval: pInterval, amount: Number(pAmount), trialDays: Number(pTrial) });
      setPName('');
      await reload();
    } catch (e) { onError(e instanceof Error ? e.message : 'create failed'); }
    setBusy(false);
  };

  const createSub = async () => {
    if (!subPlan) { onError('select a plan'); return; }
    setBusy(true);
    try {
      await run('subscription-create', { planId: subPlan, customerName: subCustomer || 'Customer', quantity: Number(subQty) });
      await reload();
    } catch (e) { onError(e instanceof Error ? e.message : 'subscribe failed'); }
    setBusy(false);
  };

  const previewProration = async () => {
    if (!proSub || !proNewPlan) { onError('select subscription + target plan'); return; }
    setBusy(true);
    try {
      setProResult(await run('subscription-proration', { subscriptionId: proSub, newPlanId: proNewPlan }));
    } catch (e) { onError(e instanceof Error ? e.message : 'proration failed'); }
    setBusy(false);
  };

  const applyProration = async () => {
    if (!proSub || !proNewPlan) return;
    setBusy(true);
    try {
      setProResult(await run('subscription-proration', { subscriptionId: proSub, newPlanId: proNewPlan, apply: true }));
      await reload();
    } catch (e) { onError(e instanceof Error ? e.message : 'apply failed'); }
    setBusy(false);
  };

  const cancelSub = async (id: string, immediate: boolean) => {
    setBusy(true);
    try {
      await run('subscription-cancel', { subscriptionId: id, immediate });
      await reload();
    } catch (e) { onError(e instanceof Error ? e.message : 'cancel failed'); }
    setBusy(false);
  };

  const subs: MacroJSON[] = subData?.subscriptions || [];
  const isEmpty = plans.length === 0 && subs.length === 0;

  return (
    <div className="space-y-3">
      {isEmpty && (
        <div className="rounded-md border border-dashed border-cyan-500/30 bg-cyan-500/5 px-4 py-5 text-center">
          <p className="text-sm font-medium text-zinc-200">No recurring plans yet.</p>
          <p className="mt-1 text-xs text-zinc-400">Create your first plan below to start subscribing customers and tracking MRR.</p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="MRR" value={money(subData?.mrr)} accent="text-emerald-300" />
        <Stat label="ARR" value={money(subData?.arr)} accent="text-emerald-300" />
        <Stat label="Active" value={String(subData?.activeCount ?? 0)} />
        <Stat label="Trialing" value={String(subData?.trialingCount ?? 0)} />
      </div>

      <Card>
        <div className="mb-2 text-xs font-semibold text-zinc-200">Create recurring plan</div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          <Field label="Name"><input className={inputCls} value={pName} onChange={(e) => setPName(e.target.value)} placeholder="Pro" /></Field>
          <Field label="Interval">
            <select className={inputCls} value={pInterval} onChange={(e) => setPInterval(e.target.value)}>
              <option value="weekly">weekly</option>
              <option value="monthly">monthly</option>
              <option value="quarterly">quarterly</option>
              <option value="annual">annual</option>
            </select>
          </Field>
          <Field label="Amount"><input className={inputCls} type="number" value={pAmount} onChange={(e) => setPAmount(e.target.value)} /></Field>
          <Field label="Trial days"><input className={inputCls} type="number" value={pTrial} onChange={(e) => setPTrial(e.target.value)} /></Field>
          <div className="flex items-end"><Btn onClick={createPlan} busy={busy}><Plus className="h-3.5 w-3.5" />Create plan</Btn></div>
        </div>
      </Card>

      {plans.length > 0 && (
        <Card>
          <div className="mb-2 text-xs font-semibold text-zinc-200">Plans ({plans.length})</div>
          <div className="space-y-1">
            {plans.map((p) => (
              <div key={p.id} className="flex items-center justify-between rounded bg-zinc-950 px-2.5 py-1.5 text-xs">
                <span className="text-white">{p.name}</span>
                <span className="text-zinc-400">{money(p.amount, p.currency)} / {p.interval}{p.trialDays > 0 ? ` · ${p.trialDays}d trial` : ''}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card>
        <div className="mb-2 text-xs font-semibold text-zinc-200">Subscribe a customer</div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Field label="Plan">
            <select className={inputCls} value={subPlan} onChange={(e) => setSubPlan(e.target.value)}>
              <option value="">—</option>
              {plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
          <Field label="Customer"><input className={inputCls} value={subCustomer} onChange={(e) => setSubCustomer(e.target.value)} placeholder="Acme Inc" /></Field>
          <Field label="Seats"><input className={inputCls} type="number" value={subQty} onChange={(e) => setSubQty(e.target.value)} /></Field>
          <div className="flex items-end"><Btn onClick={createSub} busy={busy}><Plus className="h-3.5 w-3.5" />Subscribe</Btn></div>
        </div>
      </Card>

      {subs.length > 0 && (
        <Card>
          <div className="mb-2 text-xs font-semibold text-zinc-200">Subscriptions ({subs.length})</div>
          <div className="space-y-1">
            {subs.map((su) => (
              <div key={su.id} className="flex flex-wrap items-center justify-between gap-2 rounded bg-zinc-950 px-2.5 py-1.5 text-xs">
                <div>
                  <span className="text-white">{su.customerName}</span>
                  <span className="ml-2 text-zinc-400">{su.plan?.name || su.planId} · {su.quantity} seat(s)</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`rounded px-1.5 py-0.5 text-[10px] ${
                    su.status === 'active' ? 'bg-emerald-500/20 text-emerald-300'
                      : su.status === 'trialing' ? 'bg-cyan-500/20 text-cyan-300'
                        : 'bg-zinc-700 text-zinc-300'}`}>{su.status}</span>
                  {su.cancelAtPeriodEnd && <span className="text-[10px] text-amber-400">cancels at period end</span>}
                  {su.status !== 'canceled' && (
                    <>
                      <button onClick={() => cancelSub(su.id, false)} className="text-[10px] text-zinc-400 hover:text-amber-300">cancel@end</button>
                      <button onClick={() => cancelSub(su.id, true)} className="text-[10px] text-zinc-400 hover:text-red-300">cancel now</button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card>
        <div className="mb-2 text-xs font-semibold text-zinc-200">Mid-cycle proration</div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Field label="Subscription">
            <select className={inputCls} value={proSub} onChange={(e) => setProSub(e.target.value)}>
              <option value="">—</option>
              {subs.map((su) => <option key={su.id} value={su.id}>{su.customerName}</option>)}
            </select>
          </Field>
          <Field label="Switch to plan">
            <select className={inputCls} value={proNewPlan} onChange={(e) => setProNewPlan(e.target.value)}>
              <option value="">—</option>
              {plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
          <div className="flex items-end"><Btn onClick={previewProration} busy={busy} kind="ghost">Preview</Btn></div>
          <div className="flex items-end"><Btn onClick={applyProration} busy={busy}>Apply switch</Btn></div>
        </div>
        {proResult && (
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Unused credit" value={money(proResult.unusedCredit)} accent="text-emerald-300" />
            <Stat label="New plan prorated" value={money(proResult.newPlanProrated)} />
            <Stat label="Amount due" value={money(proResult.amountDue)} accent={proResult.amountDue >= 0 ? 'text-amber-300' : 'text-emerald-300'} />
            <Stat label="Direction" value={String(proResult.direction || '')} accent="text-zinc-300" />
          </div>
        )}
      </Card>

      <Btn onClick={reload} kind="ghost"><RefreshCw className="h-3.5 w-3.5" />Refresh</Btn>
    </div>
  );
}

// ── Metered Usage ───────────────────────────────────────────────────────────

function UsagePanel({ onError }: { onError: (e: string) => void }) {
  const [subs, setSubs] = useState<MacroJSON[]>([]);
  const [subId, setSubId] = useState('');
  const [metric, setMetric] = useState('api_calls');
  const [qty, setQty] = useState('1000');
  const [summary, setSummary] = useState<MacroJSON | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    try {
      const su = await run('subscription-list');
      setSubs(su?.subscriptions || []);
    } catch (e) { onError(e instanceof Error ? e.message : 'load failed'); }
  }, [onError]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { reload(); }, []);

  const record = async () => {
    if (!subId) { onError('select a subscription'); return; }
    setBusy(true);
    try {
      await run('usage-record', { subscriptionId: subId, metric, quantity: Number(qty) });
      setSummary(await run('usage-summary', { subscriptionId: subId }));
    } catch (e) { onError(e instanceof Error ? e.message : 'record failed'); }
    setBusy(false);
  };

  const refreshSummary = async () => {
    if (!subId) { onError('select a subscription'); return; }
    setBusy(true);
    try {
      setSummary(await run('usage-summary', { subscriptionId: subId }));
    } catch (e) { onError(e instanceof Error ? e.message : 'summary failed'); }
    setBusy(false);
  };

  const tiers: MacroJSON[] = summary?.tierBreakdown || [];

  return (
    <div className="space-y-3">
      <Card>
        <div className="mb-2 text-xs font-semibold text-zinc-200">Record usage event</div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Field label="Subscription">
            <select className={inputCls} value={subId} onChange={(e) => setSubId(e.target.value)}>
              <option value="">—</option>
              {subs.map((su) => <option key={su.id} value={su.id}>{su.customerName}</option>)}
            </select>
          </Field>
          <Field label="Metric"><input className={inputCls} value={metric} onChange={(e) => setMetric(e.target.value)} /></Field>
          <Field label="Quantity"><input className={inputCls} type="number" value={qty} onChange={(e) => setQty(e.target.value)} /></Field>
          <div className="flex items-end gap-2">
            <Btn onClick={record} busy={busy}><Plus className="h-3.5 w-3.5" />Record</Btn>
            <Btn onClick={refreshSummary} busy={busy} kind="ghost">Summary</Btn>
          </div>
        </div>
      </Card>

      {summary && (
        <Card>
          <div className="mb-2 text-xs font-semibold text-zinc-200">Graduated rate-tier billing</div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Stat label="Events" value={String(summary.recordCount ?? 0)} />
            <Stat label="Total units" value={(Number(summary.totalQuantity) || 0).toLocaleString()} />
            <Stat label="Metered charge" value={money(summary.totalCharge)} accent="text-amber-300" />
          </div>
          {tiers.length > 0 && (
            <div className="mt-2 space-y-1">
              {tiers.map((t, i) => (
                <div key={i} className="flex items-center justify-between rounded bg-zinc-950 px-2.5 py-1 text-xs">
                  <span className="font-mono text-zinc-400">{t.range}</span>
                  <span className="text-zinc-400">{(Number(t.units) || 0).toLocaleString()} × {t.unitPrice}</span>
                  <span className="text-white">{money(t.charge)}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

// ── Coupons ─────────────────────────────────────────────────────────────────

function CouponsPanel({ onError }: { onError: (e: string) => void }) {
  const [coupons, setCoupons] = useState<MacroJSON[]>([]);
  const [code, setCode] = useState('');
  const [kind, setKind] = useState('percent');
  const [value, setValue] = useState('20');
  const [duration, setDuration] = useState('once');
  const [maxRedemptions, setMaxRedemptions] = useState('');
  const [applyCode, setApplyCode] = useState('');
  const [applyAmount, setApplyAmount] = useState('100');
  const [applyResult, setApplyResult] = useState<MacroJSON | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    try { setCoupons((await run('coupon-list'))?.coupons || []); }
    catch (e) { onError(e instanceof Error ? e.message : 'load failed'); }
  }, [onError]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { reload(); }, []);

  const create = async () => {
    if (!code.trim()) { onError('coupon code required'); return; }
    setBusy(true);
    try {
      await run('coupon-create', {
        code, kind, value: Number(value), duration,
        maxRedemptions: maxRedemptions ? Number(maxRedemptions) : undefined,
      });
      setCode('');
      await reload();
    } catch (e) { onError(e instanceof Error ? e.message : 'create failed'); }
    setBusy(false);
  };

  const apply = async (redeem: boolean) => {
    if (!applyCode.trim()) { onError('enter a code to apply'); return; }
    setBusy(true);
    try {
      setApplyResult(await run('coupon-apply', { code: applyCode, amount: Number(applyAmount), redeem }));
      if (redeem) await reload();
    } catch (e) { onError(e instanceof Error ? e.message : 'apply failed'); }
    setBusy(false);
  };

  return (
    <div className="space-y-3">
      <Card>
        <div className="mb-2 text-xs font-semibold text-zinc-200">Create coupon</div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-6">
          <Field label="Code"><input className={inputCls} value={code} onChange={(e) => setCode(e.target.value)} placeholder="LAUNCH20" /></Field>
          <Field label="Kind">
            <select className={inputCls} value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="percent">percent</option>
              <option value="fixed">fixed</option>
            </select>
          </Field>
          <Field label="Value"><input className={inputCls} type="number" value={value} onChange={(e) => setValue(e.target.value)} /></Field>
          <Field label="Duration">
            <select className={inputCls} value={duration} onChange={(e) => setDuration(e.target.value)}>
              <option value="once">once</option>
              <option value="repeating">repeating</option>
              <option value="forever">forever</option>
            </select>
          </Field>
          <Field label="Max redemptions"><input className={inputCls} type="number" value={maxRedemptions} onChange={(e) => setMaxRedemptions(e.target.value)} placeholder="∞" /></Field>
          <div className="flex items-end"><Btn onClick={create} busy={busy}><Plus className="h-3.5 w-3.5" />Create</Btn></div>
        </div>
      </Card>

      {coupons.length > 0 && (
        <Card>
          <div className="mb-2 text-xs font-semibold text-zinc-200">Coupons ({coupons.length})</div>
          <div className="space-y-1">
            {coupons.map((c) => (
              <div key={c.id} className="flex items-center justify-between rounded bg-zinc-950 px-2.5 py-1.5 text-xs">
                <span className="font-mono text-cyan-300">{c.code}</span>
                <span className="text-zinc-400">{c.kind === 'percent' ? `${c.value}% off` : money(c.value)} · {c.duration}</span>
                <span className="text-zinc-400">
                  {c.redemptions} / {c.maxRedemptions ?? '∞'} used
                  <span className={`ml-2 ${c.active ? 'text-emerald-400' : 'text-zinc-600'}`}>{c.active ? 'active' : 'inactive'}</span>
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card>
        <div className="mb-2 text-xs font-semibold text-zinc-200">Apply / redeem a code</div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Field label="Code"><input className={inputCls} value={applyCode} onChange={(e) => setApplyCode(e.target.value)} /></Field>
          <Field label="Amount"><input className={inputCls} type="number" value={applyAmount} onChange={(e) => setApplyAmount(e.target.value)} /></Field>
          <div className="flex items-end"><Btn onClick={() => apply(false)} busy={busy} kind="ghost">Preview</Btn></div>
          <div className="flex items-end"><Btn onClick={() => apply(true)} busy={busy}>Redeem</Btn></div>
        </div>
        {applyResult && (
          <div className="mt-2 grid grid-cols-3 gap-2">
            <Stat label="Discount" value={money(applyResult.discount)} accent="text-emerald-300" />
            <Stat label="Original" value={money(applyResult.originalAmount)} accent="text-zinc-300" />
            <Stat label="Final" value={money(applyResult.finalAmount)} accent="text-amber-300" />
          </div>
        )}
      </Card>
    </div>
  );
}

// ── Dunning ─────────────────────────────────────────────────────────────────

function DunningPanel({ onError }: { onError: (e: string) => void }) {
  const [data, setData] = useState<MacroJSON | null>(null);
  const [amount, setAmount] = useState('99');
  const [reason, setReason] = useState('card_declined');
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    try { setData(await run('dunning-list')); }
    catch (e) { onError(e instanceof Error ? e.message : 'load failed'); }
  }, [onError]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { reload(); }, []);

  const open = async () => {
    setBusy(true);
    try {
      await run('dunning-open', { amount: Number(amount), reason });
      await reload();
    } catch (e) { onError(e instanceof Error ? e.message : 'open failed'); }
    setBusy(false);
  };

  const retry = async (id: string, outcome: 'succeeded' | 'failed') => {
    setBusy(true);
    try {
      await run('dunning-retry', { dunningId: id, outcome });
      await reload();
    } catch (e) { onError(e instanceof Error ? e.message : 'retry failed'); }
    setBusy(false);
  };

  const cases: MacroJSON[] = data?.cases || [];

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        <Stat label="Open" value={String(data?.openCount ?? 0)} accent="text-amber-300" />
        <Stat label="Recovered" value={String(data?.recoveredCount ?? 0)} accent="text-emerald-300" />
        <Stat label="Lost" value={String(data?.lostCount ?? 0)} accent="text-red-300" />
      </div>

      <Card>
        <div className="mb-2 text-xs font-semibold text-zinc-200">Open dunning case for a failed payment</div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Field label="Amount"><input className={inputCls} type="number" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
          <Field label="Reason">
            <select className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)}>
              <option value="card_declined">card_declined</option>
              <option value="insufficient_funds">insufficient_funds</option>
              <option value="expired_card">expired_card</option>
              <option value="processing_error">processing_error</option>
            </select>
          </Field>
          <div className="flex items-end"><Btn onClick={open} busy={busy}><Plus className="h-3.5 w-3.5" />Open case</Btn></div>
        </div>
      </Card>

      {cases.map((d) => (
        <Card key={d.id}>
          <div className="mb-2 flex items-center justify-between text-xs">
            <span className="text-white">{money(d.amount, d.currency)} · {d.reason}</span>
            <span className={`rounded px-1.5 py-0.5 text-[10px] ${
              d.status === 'in_progress' ? 'bg-amber-500/20 text-amber-300'
                : d.status === 'recovered' ? 'bg-emerald-500/20 text-emerald-300'
                  : 'bg-red-500/20 text-red-300'}`}>{d.status}</span>
          </div>
          <div className="space-y-1">
            {(d.schedule || []).map((a: MacroJSON) => (
              <div key={a.attempt} className="flex items-center justify-between rounded bg-zinc-950 px-2.5 py-1 text-[11px]">
                <span className="text-zinc-400">Attempt {a.attempt} · {a.emailTemplate}</span>
                <span className="text-zinc-600">{new Date(a.scheduledFor).toLocaleDateString()}</span>
                <span className={`${a.status === 'succeeded' ? 'text-emerald-400' : a.status === 'failed' ? 'text-red-400' : 'text-zinc-400'}`}>{a.status}</span>
              </div>
            ))}
          </div>
          {d.status === 'in_progress' && (
            <div className="mt-2 flex gap-2">
              <Btn onClick={() => retry(d.id, 'succeeded')} busy={busy}>Retry succeeded</Btn>
              <Btn onClick={() => retry(d.id, 'failed')} busy={busy} kind="ghost">Retry failed</Btn>
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}

// ── Customer Portal ─────────────────────────────────────────────────────────

function PortalPanel({ onError }: { onError: (e: string) => void }) {
  const [data, setData] = useState<MacroJSON | null>(null);
  const [name, setName] = useState('');
  const [cardNumber, setCardNumber] = useState('');
  const [expMonth, setExpMonth] = useState('12');
  const [expYear, setExpYear] = useState(String(new Date().getFullYear() + 2));
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    try { setData(await run('portal-overview')); }
    catch (e) { onError(e instanceof Error ? e.message : 'load failed'); }
  }, [onError]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { reload(); }, []);

  const saveCard = async () => {
    if (cardNumber.replace(/\D/g, '').length < 12) { onError('enter a valid card number'); return; }
    setBusy(true);
    try {
      await run('portal-update-card', {
        name: name || 'Account holder', cardNumber,
        expMonth: Number(expMonth), expYear: Number(expYear),
      });
      setCardNumber('');
      await reload();
    } catch (e) { onError(e instanceof Error ? e.message : 'save failed'); }
    setBusy(false);
  };

  const pm = data?.paymentMethod;
  const invoices: MacroJSON[] = data?.invoices || [];
  const activeSubs: MacroJSON[] = data?.activeSubscriptions || [];

  return (
    <div className="space-y-3">
      <Card>
        <div className="mb-2 text-xs font-semibold text-zinc-200">Payment method on file</div>
        {pm ? (
          <div className="rounded bg-zinc-950 px-2.5 py-1.5 text-xs text-white">
            {pm.brand} •••• {pm.last4} · exp {String(pm.expMonth).padStart(2, '0')}/{pm.expYear}
          </div>
        ) : <div className="text-xs text-zinc-400">No card on file.</div>}
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-5">
          <Field label="Name"><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Card number"><input className={inputCls} value={cardNumber} onChange={(e) => setCardNumber(e.target.value)} placeholder="4242 4242 4242 4242" /></Field>
          <Field label="Exp month"><input className={inputCls} type="number" value={expMonth} onChange={(e) => setExpMonth(e.target.value)} /></Field>
          <Field label="Exp year"><input className={inputCls} type="number" value={expYear} onChange={(e) => setExpYear(e.target.value)} /></Field>
          <div className="flex items-end"><Btn onClick={saveCard} busy={busy}>Update card</Btn></div>
        </div>
      </Card>

      {activeSubs.length > 0 && (
        <Card>
          <div className="mb-2 text-xs font-semibold text-zinc-200">Active subscriptions</div>
          <div className="space-y-1">
            {activeSubs.map((su) => (
              <div key={su.id} className="flex items-center justify-between rounded bg-zinc-950 px-2.5 py-1.5 text-xs">
                <span className="text-white">{su.customerName} · {su.plan?.name || su.planId}</span>
                <span className="text-zinc-400">{su.status}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card>
        <div className="mb-2 text-xs font-semibold text-zinc-200">
          Invoice history ({invoices.length}) · {data?.openInvoiceCount ?? 0} open
        </div>
        {invoices.length === 0 ? <div className="text-xs text-zinc-400">No invoices yet.</div> : (
          <div className="space-y-1">
            {invoices.map((inv) => (
              <div key={inv.id} className="flex items-center justify-between rounded bg-zinc-950 px-2.5 py-1.5 text-xs">
                <span className="text-zinc-400">{new Date(inv.createdAt).toLocaleDateString()}</span>
                <span className="text-white">{inv.customerName}</span>
                <span className="text-white">{money(inv.amount, inv.currency)}</span>
                <span className={`rounded px-1.5 py-0.5 text-[10px] ${
                  inv.status === 'paid' ? 'bg-emerald-500/20 text-emerald-300'
                    : inv.status === 'past_due' ? 'bg-red-500/20 text-red-300'
                      : 'bg-zinc-700 text-zinc-300'}`}>{inv.status}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

// ── Tax ─────────────────────────────────────────────────────────────────────

function TaxPanel({ onError }: { onError: (e: string) => void }) {
  const [jurisdictions, setJurisdictions] = useState<MacroJSON[]>([]);
  const [jur, setJur] = useState('US-CA');
  const [amount, setAmount] = useState('100');
  const [b2b, setB2b] = useState(false);
  const [taxId, setTaxId] = useState('');
  const [result, setResult] = useState<MacroJSON | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      try { setJurisdictions((await run('tax-jurisdictions'))?.jurisdictions || []); }
      catch (e) { onError(e instanceof Error ? e.message : 'load failed'); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const calculate = async () => {
    setBusy(true);
    try {
      setResult(await run('tax-calculate', { jurisdiction: jur, amount: Number(amount), b2b, taxId }));
    } catch (e) { onError(e instanceof Error ? e.message : 'calc failed'); }
    setBusy(false);
  };

  return (
    <div className="space-y-3">
      <Card>
        <div className="mb-2 text-xs font-semibold text-zinc-200">Tax calculation per jurisdiction</div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Field label="Jurisdiction">
            <select className={inputCls} value={jur} onChange={(e) => setJur(e.target.value)}>
              {jurisdictions.map((j) => <option key={j.code} value={j.code}>{j.code} — {j.ratePct}%</option>)}
            </select>
          </Field>
          <Field label="Net amount"><input className={inputCls} type="number" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
          <Field label="VAT ID (B2B)"><input className={inputCls} value={taxId} onChange={(e) => setTaxId(e.target.value)} placeholder="optional" /></Field>
          <div className="flex flex-col justify-end gap-1">
            <label className="flex items-center gap-1.5 text-[11px] text-zinc-400">
              <input type="checkbox" checked={b2b} onChange={(e) => setB2b(e.target.checked)} /> B2B (reverse charge)
            </label>
            <Btn onClick={calculate} busy={busy}>Calculate</Btn>
          </div>
        </div>
      </Card>

      {result && (
        <Card>
          <div className="mb-2 text-xs font-semibold text-zinc-200">{result.label} · {result.taxKind}</div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Net" value={money(result.netAmount)} accent="text-zinc-300" />
            <Stat label={`Tax (${result.ratePct}%)`} value={money(result.taxAmount)} accent="text-amber-300" />
            <Stat label="Gross" value={money(result.grossAmount)} accent="text-emerald-300" />
            <Stat label="Reverse charge" value={result.reverseCharge ? 'yes' : 'no'} accent="text-zinc-300" />
          </div>
          {result.note && <p className="mt-2 text-[11px] text-zinc-400">{result.note}</p>}
        </Card>
      )}
    </div>
  );
}

// ── Revenue Analytics ───────────────────────────────────────────────────────

function AnalyticsPanel({ onError }: { onError: (e: string) => void }) {
  const [data, setData] = useState<MacroJSON | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    setBusy(true);
    try { setData(await run('revenue-analytics')); }
    catch (e) { onError(e instanceof Error ? e.message : 'load failed'); }
    setBusy(false);
  }, [onError]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { reload(); }, []);

  const cohorts: MacroJSON[] = data?.cohorts || [];
  const chartData = cohorts.map((c) => ({
    month: c.month, mrr: c.mrr, retentionPct: c.retentionPct,
  }));

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="MRR" value={money(data?.mrr)} accent="text-emerald-300" />
        <Stat label="ARR" value={money(data?.arr)} accent="text-emerald-300" />
        <Stat label="ARPA" value={money(data?.arpa)} />
        <Stat label="Churn rate" value={`${data?.churnRatePct ?? 0}%`} accent="text-red-300" />
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Active subs" value={String(data?.activeSubscriptions ?? 0)} />
        <Stat label="Total subs" value={String(data?.totalSubscriptions ?? 0)} accent="text-zinc-300" />
        <Stat label="Expansion seats" value={String(data?.expansionSeats ?? 0)} accent="text-cyan-300" />
        <Stat label="Expansion MRR" value={money(data?.expansionMrr)} accent="text-cyan-300" />
      </div>

      {chartData.length > 0 && (
        <Card>
          <div className="mb-2 text-xs font-semibold text-zinc-200">Cohort MRR by signup month</div>
          <ChartKit
            kind="bar"
            data={chartData}
            xKey="month"
            series={[{ key: 'mrr', label: 'MRR', color: '#22c55e' }]}
            height={200}
          />
        </Card>
      )}

      {cohorts.length > 0 && (
        <Card>
          <div className="mb-2 text-xs font-semibold text-zinc-200">Cohort retention</div>
          <div className="space-y-1">
            {cohorts.map((c) => (
              <div key={c.month} className="flex items-center justify-between rounded bg-zinc-950 px-2.5 py-1.5 text-xs">
                <span className="font-mono text-zinc-400">{c.month}</span>
                <span className="text-zinc-400">{c.signups} signups · {c.churned} churned</span>
                <span className="text-cyan-300">{c.retentionPct}% retained</span>
                <span className="text-emerald-300">{money(c.mrr)}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Btn onClick={reload} busy={busy} kind="ghost"><RefreshCw className="h-3.5 w-3.5" />Refresh analytics</Btn>
    </div>
  );
}
