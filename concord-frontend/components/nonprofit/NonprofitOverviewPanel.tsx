'use client';

/**
 * NonprofitOverviewPanel — real dashboard stat strip.
 *
 * Replaces the removed fabricated Quick Stats row (which read `lybunt`/
 * `sybunt`/`hoursThisYear`/`pledgeBalance` fields off a fake generic-artifact
 * Donor/Gift/Grant/Volunteer/Fund store with zero backing macro). Every
 * number here comes from a real macro: nonprofit-dashboard (campaigns +
 * raised + recurring donors), donor-list (donor count + lifetime given),
 * volunteer-list (hours + est. value).
 */

import { useEffect, useState, useCallback } from 'react';
import { Heart, DollarSign, Repeat, HelpingHand, Loader2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface Dash { campaigns: number; active: number; totalRaised: number; donations: number; recurringDonors: number }

function money(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return `$${n.toLocaleString()}`;
}

export function NonprofitOverviewPanel() {
  const [dash, setDash] = useState<Dash | null>(null);
  const [donorCount, setDonorCount] = useState<number | null>(null);
  const [lifetimeGiven, setLifetimeGiven] = useState<number | null>(null);
  const [volHours, setVolHours] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [d, donors, vols] = await Promise.all([
        lensRun<Dash>('nonprofit', 'nonprofit-dashboard', {}),
        lensRun<{ donors: { totalGiven: number }[] }>('nonprofit', 'donor-list', {}),
        lensRun<{ totalHours: number }>('nonprofit', 'volunteer-list', {}),
      ]);
      if (d.data.ok) setDash(d.data.result);
      if (donors.data.ok) {
        const list = donors.data.result?.donors || [];
        setDonorCount(list.length);
        setLifetimeGiven(list.reduce((s, x) => s + (x.totalGiven || 0), 0));
      }
      if (vols.data.ok) setVolHours(Math.round(vols.data.result?.totalHours ?? 0));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (loading && !dash) {
    return (
      <div role="status" aria-live="polite" aria-busy="true" className="flex items-center gap-2 py-6 justify-center text-zinc-400">
        <Loader2 className="w-4 h-4 animate-spin" /> <span className="text-xs">Loading overview…</span>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {error && (
        <div role="alert" className="rounded-lg border border-red-500/40 bg-red-500/5 px-3 py-2 text-xs text-red-300">
          Couldn&apos;t load overview: {error}
        </div>
      )}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="p-3 bg-zinc-900 rounded-lg border border-zinc-800">
          <div className="flex items-center gap-2 mb-1"><Heart className="w-4 h-4 text-rose-400" /></div>
          <p className="text-2xl font-bold text-rose-400">{donorCount ?? '—'}</p>
          <p className="text-xs text-gray-400">Donors</p>
        </div>
        <div className="p-3 bg-zinc-900 rounded-lg border border-zinc-800">
          <div className="flex items-center gap-2 mb-1"><DollarSign className="w-4 h-4 text-emerald-400" /></div>
          <p className="text-2xl font-bold text-emerald-400">{lifetimeGiven != null ? money(lifetimeGiven) : '—'}</p>
          <p className="text-xs text-gray-400">Lifetime given (donor CRM)</p>
        </div>
        <div className="p-3 bg-zinc-900 rounded-lg border border-zinc-800">
          <div className="flex items-center gap-2 mb-1"><Repeat className="w-4 h-4 text-cyan-400" /></div>
          <p className="text-2xl font-bold text-cyan-400">{dash?.recurringDonors ?? '—'}</p>
          <p className="text-xs text-gray-400">Recurring donors</p>
        </div>
        <div className="p-3 bg-zinc-900 rounded-lg border border-zinc-800">
          <div className="flex items-center gap-2 mb-1"><HelpingHand className="w-4 h-4 text-amber-400" /></div>
          <p className="text-2xl font-bold text-amber-400">{volHours ?? '—'}</p>
          <p className="text-xs text-gray-400">Volunteer hours</p>
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <div className="p-3 bg-zinc-900 rounded-lg border border-zinc-800">
          <p className="text-lg font-bold text-white">{dash?.campaigns ?? '—'}</p>
          <p className="text-xs text-gray-400">Campaigns ({dash?.active ?? 0} active)</p>
        </div>
        <div className="p-3 bg-zinc-900 rounded-lg border border-zinc-800">
          <p className="text-lg font-bold text-white">{dash != null ? money(dash.totalRaised) : '—'}</p>
          <p className="text-xs text-gray-400">Raised across campaigns</p>
        </div>
        <div className="p-3 bg-zinc-900 rounded-lg border border-zinc-800">
          <p className="text-lg font-bold text-white">{dash?.donations ?? '—'}</p>
          <p className="text-xs text-gray-400">Campaign donations logged</p>
        </div>
      </div>
    </div>
  );
}

export default NonprofitOverviewPanel;
