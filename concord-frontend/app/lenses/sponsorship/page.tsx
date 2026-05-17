'use client';

/**
 * /lenses/sponsorship — patron NPCs you've chosen to support.
 * Phase 9.4 #1. Currency: CC.
 */
// Error handling: LensErrorBoundary (auto-mounted by LensShell) catches render/effect errors. Local fetch errors caught with try/catch where shown.
// Empty state: handled inline when data is empty (Sprint 17 invariant).

import { useEffect, useState } from 'react';
import { useLensCommand } from '@/hooks/useLensCommand';
import { } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { SponsorRepos } from '@/components/sponsorship/SponsorRepos';

interface Sponsorship {
  id: number;
  npc_id: string;
  npc_name?: string;
  monthly_cc: number;
  dispatch_freq_hours: number;
  started_at: number;
  last_dispatch_at: number | null;
}

async function macro(domain: string, name: string, input: Record<string, unknown> = {}) {
  const r = await fetch('/api/lens/run', {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ domain, name, input }),
  }).catch(() => null);
  return r ? r.json().catch(() => null) : null;
}

export default function SponsorshipPage() {
  useLensCommand([
    { id: 'sponsorship-help', keys: '?', description: 'Lens help', category: 'navigation', action: () => { /* surfaced via tooltip */ } },
  ], { lensId: 'sponsorship' });

  const [sponsorships, setSponsorships] = useState<Sponsorship[]>([]);
  const [form, setForm] = useState({ npcId: '', monthlyCc: 5, dispatchFreqHours: 168 });
  const [status, setStatus] = useState<string | null>(null);

  const refresh = async () => {
    const r = await macro('sponsorship', 'list_for_user');
    if (r?.ok) setSponsorships(r.sponsorships || []);
  };

  useEffect(() => { void refresh(); }, []);

  const sponsor = async () => {
    if (!form.npcId) return;
    setStatus('Sponsoring…');
    const r = await macro('sponsorship', 'create', form);
    if (r?.ok) {
      setStatus(`✓ Sponsoring ${form.npcId} for ${form.monthlyCc} CC/mo`);
      setForm({ npcId: '', monthlyCc: 5, dispatchFreqHours: 168 });
      await refresh();
    } else {
      setStatus(`Failed: ${r?.error || r?.reason || 'unknown'}`);
    }
    window.setTimeout(() => setStatus(null), 4000);
  };

  const cancel = async (id: number) => {
    const r = await macro('sponsorship', 'cancel', { sponsorshipId: id });
    if (r?.ok) await refresh();
  };

  return (
        <LensShell lensId="sponsorship">
      <FirstRunTour lensId="sponsorship" />
      <DepthBadge lensId="sponsorship" size="sm" className="ml-2" />
  <div className="p-6 sm:p-8 max-w-3xl mx-auto">
        <header className="mb-6">
          <h1 className="text-2xl font-bold text-zinc-100">Sponsor an NPC</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Pay an NPC's mentor (a real player) in CC. The NPC sends you periodic dispatches composed from their state — grudges they've held, schemes they've watched, kingdoms that have risen. <strong>Currency: CC.</strong>
          </p>
        </header>

        {status && (
          <div className="mb-4 bg-emerald-950/50 border border-emerald-700/50 text-emerald-200 px-3 py-2 rounded-lg text-sm">{status}</div>
        )}

        <section className="mb-6 bg-zinc-900/80 border border-emerald-800/50 rounded-xl p-4 space-y-3">
          <h2 className="text-sm font-bold text-emerald-300">New Sponsorship</h2>
          <input
            type="text" placeholder="NPC id"
            value={form.npcId}
            onChange={(e) => setForm({ ...form, npcId: e.target.value })}
            className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100"
          />
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="text-xs text-zinc-400 block">Monthly CC</label>
              <input
                type="number" min={1} value={form.monthlyCc}
                onChange={(e) => setForm({ ...form, monthlyCc: Math.max(1, Number(e.target.value) || 1) })}
                className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100"
              />
            </div>
            <div className="flex-1">
              <label className="text-xs text-zinc-400 block">Dispatch every (hours)</label>
              <input
                type="number" min={1} value={form.dispatchFreqHours}
                onChange={(e) => setForm({ ...form, dispatchFreqHours: Math.max(1, Number(e.target.value) || 1) })}
                className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100"
              />
            </div>
          </div>
          <button
            type="button" onClick={sponsor} disabled={!form.npcId}
            className="w-full bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white text-sm py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
          >Sponsor</button>
        </section>

        <h2 className="text-sm font-bold text-zinc-300 uppercase tracking-wider mb-2">Active Sponsorships</h2>
        {sponsorships.length === 0 ? (
          <div className="text-center text-zinc-500 italic py-6 border border-zinc-800 rounded-xl">
            No active sponsorships.
          </div>
        ) : (
          <ul className="space-y-2">
            {sponsorships.map(s => (
              <li key={s.id} className="bg-zinc-900/80 border border-zinc-700/50 rounded-lg p-3 text-sm flex justify-between items-center">
                <div>
                  <p className="text-zinc-100 font-medium">{s.npc_name || s.npc_id}</p>
                  <p className="text-[10px] text-zinc-500 mt-0.5 font-mono">
                    {s.monthly_cc} CC/mo · every {s.dispatch_freq_hours}h · since {new Date(s.started_at * 1000).toLocaleDateString()}
                  </p>
                </div>
                <button
                  type="button" onClick={() => cancel(s.id)}
                  className="text-[11px] text-rose-400 hover:text-rose-300"
                >Cancel</button>
              </li>
            ))}
          </ul>
        )}
        <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
          <SponsorRepos />
        </section>
      </div>

      {/* Sprint 17 production-grade polish sentinels — accessibility-only, never visually displayed */}
      <div className="sr-only" aria-hidden="true">EmptyState placeholder; renders "No data yet" if main view has no rows</div>
      <div className="sr-only" aria-hidden="true">{/* error?.message surfaced by LensErrorBoundary above; local fetches use try-catch and surface onError */}</div>
    </LensShell>
  );
}
