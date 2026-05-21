'use client';

/**
 * CrtMembershipPanel — Patreon-style supporter tiers + recurring
 * subscriptions. Tiers and subscribers are real user input; MRR/ARR
 * compute live from active subscriptions. Nothing seeded.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Trash2, Crown, UserMinus, Users } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface Tier {
  id: string;
  name: string;
  priceMonthly: number;
  perks: string[];
  description: string | null;
  activeSubscribers: number;
  monthlyRevenue: number;
}
interface Subscription {
  id: string;
  tierId: string;
  tierName: string;
  supporter: string;
  priceMonthly: number;
  status: 'active' | 'cancelled';
  startedAt: string;
  cancelledAt: string | null;
}
interface MemberSummary {
  tierCount: number;
  activeSubscribers: number;
  cancelledSubscribers: number;
  mrr: number;
  arr: number;
  avgRevenuePerSupporter: number;
}

export function CrtMembershipPanel({ onChange }: { onChange: () => void }) {
  const [tiers, setTiers] = useState<Tier[]>([]);
  const [subs, setSubs] = useState<Subscription[]>([]);
  const [summary, setSummary] = useState<MemberSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tierForm, setTierForm] = useState({ name: '', priceMonthly: '', perks: '', description: '' });
  const [subForm, setSubForm] = useState({ tierId: '', supporter: '' });

  const refresh = useCallback(async () => {
    setLoading(true);
    const [t, s, m] = await Promise.all([
      lensRun('creator', 'membership-tier-list', {}),
      lensRun('creator', 'subscription-list', { status: 'all' }),
      lensRun('creator', 'membership-summary', {}),
    ]);
    setTiers((t.data?.result?.tiers as Tier[]) || []);
    setSubs((s.data?.result?.subscriptions as Subscription[]) || []);
    setSummary((m.data?.result as MemberSummary | null) || null);
    setLoading(false);
    onChange();
  }, [onChange]);

  useEffect(() => { void refresh(); }, [refresh]);

  const addTier = async () => {
    const price = Number(tierForm.priceMonthly);
    if (!tierForm.name.trim()) { setError('Tier name required.'); return; }
    if (!(price > 0)) { setError('Monthly price must be positive.'); return; }
    const r = await lensRun('creator', 'membership-tier-add', {
      name: tierForm.name.trim(),
      priceMonthly: price,
      perks: tierForm.perks.split(',').map((p) => p.trim()).filter(Boolean),
      description: tierForm.description.trim(),
    });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setTierForm({ name: '', priceMonthly: '', perks: '', description: '' });
    setError(null);
    await refresh();
  };

  const deleteTier = async (id: string) => {
    const r = await lensRun('creator', 'membership-tier-delete', { id });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setError(null);
    await refresh();
  };

  const addSub = async () => {
    if (!subForm.tierId) { setError('Pick a tier first.'); return; }
    if (!subForm.supporter.trim()) { setError('Supporter name required.'); return; }
    const r = await lensRun('creator', 'subscription-add', {
      tierId: subForm.tierId,
      supporter: subForm.supporter.trim(),
    });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setSubForm({ tierId: '', supporter: '' });
    setError(null);
    await refresh();
  };

  const cancelSub = async (id: string) => {
    const r = await lensRun('creator', 'subscription-cancel', { id });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setError(null);
    await refresh();
  };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-500"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  return (
    <div className="space-y-4">
      {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <SummaryStat label="MRR" value={`$${summary.mrr.toLocaleString()}`} accent="text-emerald-300" />
          <SummaryStat label="ARR" value={`$${summary.arr.toLocaleString()}`} accent="text-emerald-300" />
          <SummaryStat label="Active supporters" value={summary.activeSubscribers} accent="text-zinc-100" />
          <SummaryStat label="Avg / supporter" value={`$${summary.avgRevenuePerSupporter.toLocaleString()}`} accent="text-zinc-100" />
        </div>
      )}

      {/* Create tier */}
      <section className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 space-y-2">
        <h3 className="text-xs font-semibold text-zinc-300 flex items-center gap-1.5">
          <Crown className="w-3.5 h-3.5 text-amber-400" /> New supporter tier
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <input placeholder="Tier name" value={tierForm.name}
            onChange={(e) => setTierForm({ ...tierForm, name: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <input placeholder="$ / month" inputMode="decimal" value={tierForm.priceMonthly}
            onChange={(e) => setTierForm({ ...tierForm, priceMonthly: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <input placeholder="Perks (comma-separated)" value={tierForm.perks}
            onChange={(e) => setTierForm({ ...tierForm, perks: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <button type="button" onClick={addTier}
            className="flex items-center justify-center gap-1 bg-red-600 hover:bg-red-500 text-white text-xs font-medium rounded-lg">
            <Plus className="w-3.5 h-3.5" /> Add tier
          </button>
        </div>
        <input placeholder="Description (optional)" value={tierForm.description}
          onChange={(e) => setTierForm({ ...tierForm, description: e.target.value })}
          className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
      </section>

      {/* Tiers */}
      {tiers.length === 0 ? (
        <p className="text-[11px] text-zinc-500 italic">No tiers yet — create one above to start offering memberships.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {tiers.map((t) => (
            <div key={t.id} className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-zinc-100 truncate">{t.name}</p>
                  <p className="text-lg font-bold text-emerald-300">${t.priceMonthly.toLocaleString()}<span className="text-[10px] text-zinc-500">/mo</span></p>
                </div>
                <button type="button" onClick={() => deleteTier(t.id)} title="Delete tier"
                  className="text-zinc-600 hover:text-rose-400">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
              {t.description && <p className="text-[11px] text-zinc-500 mt-1">{t.description}</p>}
              {t.perks.length > 0 && (
                <ul className="mt-2 space-y-0.5">
                  {t.perks.map((p, i) => (
                    <li key={i} className="text-[11px] text-zinc-400 flex items-start gap-1">
                      <span className="text-amber-500">•</span> {p}
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-2 pt-2 border-t border-zinc-800 flex items-center justify-between text-[11px]">
                <span className="text-zinc-400 flex items-center gap-1">
                  <Users className="w-3 h-3" /> {t.activeSubscribers} active
                </span>
                <span className="text-emerald-400">${t.monthlyRevenue.toLocaleString()}/mo</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add subscriber */}
      {tiers.length > 0 && (
        <section className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 space-y-2">
          <h3 className="text-xs font-semibold text-zinc-300">Record a supporter</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <select value={subForm.tierId} onChange={(e) => setSubForm({ ...subForm, tierId: e.target.value })}
              className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100">
              <option value="">Select tier…</option>
              {tiers.map((t) => <option key={t.id} value={t.id}>{t.name} (${t.priceMonthly}/mo)</option>)}
            </select>
            <input placeholder="Supporter name / handle" value={subForm.supporter}
              onChange={(e) => setSubForm({ ...subForm, supporter: e.target.value })}
              className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
            <button type="button" onClick={addSub}
              className="flex items-center justify-center gap-1 bg-red-600 hover:bg-red-500 text-white text-xs font-medium rounded-lg">
              <Plus className="w-3.5 h-3.5" /> Add supporter
            </button>
          </div>
        </section>
      )}

      {/* Subscribers */}
      {subs.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-zinc-300 mb-2">Supporters</h3>
          <ul className="space-y-1">
            {subs.map((sub) => (
              <li key={sub.id}
                className="flex items-center gap-2 bg-zinc-900/70 border border-zinc-800 rounded-lg px-3 py-1.5">
                <span className="text-xs text-zinc-200 flex-1 truncate">{sub.supporter}</span>
                <span className="text-[10px] text-zinc-500">{sub.tierName}</span>
                <span className="text-xs text-emerald-300">${sub.priceMonthly}/mo</span>
                {sub.status === 'active' ? (
                  <button type="button" onClick={() => cancelSub(sub.id)} title="Cancel subscription"
                    className="text-zinc-600 hover:text-rose-400">
                    <UserMinus className="w-3.5 h-3.5" />
                  </button>
                ) : (
                  <span className="text-[10px] text-rose-400 uppercase">cancelled</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function SummaryStat({ label, value, accent }: { label: string; value: string | number; accent: string }) {
  return (
    <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 text-center">
      <p className={`text-xl font-bold ${accent}`}>{value}</p>
      <p className="text-[10px] text-zinc-500 uppercase">{label}</p>
    </div>
  );
}
