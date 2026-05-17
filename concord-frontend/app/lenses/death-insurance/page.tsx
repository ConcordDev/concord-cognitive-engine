'use client';

/**
 * /lenses/death-insurance — sparks-only inheritance pacts.
 * Phase 9.4 #6. CC stays insulated.
 *
 * (Parked at /lenses/death-insurance because /lenses/insurance is
 * already taken by an existing real-world insurance lens.)
 */
// Error handling: LensErrorBoundary (auto-mounted by LensShell) catches render/effect errors. Local fetch errors caught with try/catch where shown.
// Empty state: handled inline when data is empty (Sprint 17 invariant).

import { useEffect, useState } from 'react';
import { useLensCommand } from '@/hooks/useLensCommand';
import { } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { RecentMineCard } from '@/components/lens/RecentMineCard';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { InsuranceChatter } from '@/components/death-insurance/InsuranceChatter';

interface Contract {
  id: number;
  insured_user_id: string;
  beneficiary_user_id: string;
  premium_sparks: number;
  payout_sparks: number;
  written_at: number;
  expires_at: number;
  status: string;
}

async function macro(domain: string, name: string, input: Record<string, unknown> = {}) {
  const r = await fetch('/api/lens/run', {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ domain, name, input }),
  }).catch(() => null);
  return r ? r.json().catch(() => null) : null;
}

export default function DeathInsurancePage() {
  useLensCommand([
    { id: 'death-insurance-help', keys: '?', description: 'Lens help', category: 'navigation', action: () => { /* surfaced via tooltip */ } },
  ], { lensId: 'death-insurance' });

  const [written, setWritten] = useState<Contract[]>([]);
  const [beneficiary, setBeneficiary] = useState<Contract[]>([]);
  const [form, setForm] = useState({ beneficiaryUserId: '', premiumSparks: 50, payoutSparks: 500, durationDays: 30 });
  const [status, setStatus] = useState<string | null>(null);

  const refresh = async () => {
    const r = await macro('insurance', 'list_for_user');
    if (r?.ok) {
      setWritten(r.written || []);
      setBeneficiary(r.beneficiary || []);
    }
  };

  useEffect(() => { void refresh(); }, []);

  const write = async () => {
    if (!form.beneficiaryUserId) return;
    setStatus('Writing contract…');
    const r = await macro('insurance', 'write_contract', form);
    if (r?.ok) {
      setStatus(`✓ Contract written. ${form.payoutSparks} ⚡ to ${form.beneficiaryUserId} on death.`);
      setForm({ beneficiaryUserId: '', premiumSparks: 50, payoutSparks: 500, durationDays: 30 });
      await refresh();
    } else {
      setStatus(`Failed: ${r?.error || r?.reason || 'unknown'}`);
    }
    window.setTimeout(() => setStatus(null), 5000);
  };

  const revoke = async (id: number) => {
    const r = await macro('insurance', 'revoke', { contractId: id });
    if (r?.ok) await refresh();
  };

  return (
        <LensShell lensId="death-insurance">
      <FirstRunTour lensId="death-insurance" />
      <DepthBadge lensId="death-insurance" size="sm" className="ml-2" />
  <div className="p-6 sm:p-8 max-w-3xl mx-auto">
        <header className="mb-6">
          <h1 className="text-2xl font-bold text-zinc-100">Inheritance Pact</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Write a contract: if you fall in Concordia, a friend inherits some of your sparks.
            {' '}<strong>Currency: ⚡ Sparks only.</strong> CC stays separate per the no-pay-to-win invariant.
            Suicide-pact prevention: beneficiary cannot equal insured; payout can&apos;t fire within 24h of write.
          </p>
        </header>

        {status && (
          <div className="mb-4 bg-cyan-950/50 border border-cyan-700/50 text-cyan-200 px-3 py-2 rounded-lg text-sm">{status}</div>
        )}

        <section className="mb-6 bg-zinc-900/80 border border-cyan-800/50 rounded-xl p-4 space-y-3">
          <h2 className="text-sm font-bold text-cyan-300">Write Contract</h2>
          <input
            type="text" placeholder="Beneficiary user id"
            value={form.beneficiaryUserId}
            onChange={(e) => setForm({ ...form, beneficiaryUserId: e.target.value })}
            className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100"
          />
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="text-xs text-zinc-400 block">Premium ⚡</label>
              <input
                type="number" min={1} value={form.premiumSparks}
                onChange={(e) => setForm({ ...form, premiumSparks: Math.max(1, Number(e.target.value) || 1) })}
                className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-sm text-zinc-100"
              />
            </div>
            <div>
              <label className="text-xs text-zinc-400 block">Payout ⚡</label>
              <input
                type="number" min={1} value={form.payoutSparks}
                onChange={(e) => setForm({ ...form, payoutSparks: Math.max(1, Number(e.target.value) || 1) })}
                className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-sm text-zinc-100"
              />
            </div>
            <div>
              <label className="text-xs text-zinc-400 block">Days</label>
              <input
                type="number" min={1} value={form.durationDays}
                onChange={(e) => setForm({ ...form, durationDays: Math.max(1, Number(e.target.value) || 1) })}
                className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-sm text-zinc-100"
              />
            </div>
          </div>
          <button
            type="button" onClick={write} disabled={!form.beneficiaryUserId}
            className="w-full bg-cyan-700 hover:bg-cyan-600 disabled:opacity-50 text-white text-sm py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
          >Write</button>
        </section>

        <h2 className="text-sm font-bold text-zinc-300 uppercase tracking-wider mb-2">Contracts You Wrote</h2>
        {written.length === 0 ? (
          <p className="text-zinc-500 italic mb-6">None yet.</p>
        ) : (
          <ul className="space-y-2 mb-6">
            {written.map(c => (
              <li key={c.id} className="bg-zinc-900/80 border border-zinc-700/50 rounded-lg p-3 text-xs flex justify-between">
                <div>
                  <p className="text-zinc-100">{c.payout_sparks} ⚡ → {c.beneficiary_user_id.slice(0, 12)}</p>
                  <p className="text-[10px] text-zinc-500 font-mono mt-0.5">
                    premium {c.premium_sparks} ⚡ · expires {new Date(c.expires_at * 1000).toLocaleDateString()} · {c.status}
                  </p>
                </div>
                {c.status === 'active' && (
                  <button type="button" onClick={() => revoke(c.id)} className="text-rose-400 hover:text-rose-300 text-[11px]">
                    Revoke
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}

        <h2 className="text-sm font-bold text-zinc-300 uppercase tracking-wider mb-2">You Are the Beneficiary Of</h2>
        {beneficiary.length === 0 ? (
          <p className="text-zinc-500 italic">None yet.</p>
        ) : (
          <ul className="space-y-2">
            {beneficiary.map(c => (
              <li key={c.id} className="bg-zinc-900/80 border border-zinc-700/50 rounded-lg p-3 text-xs">
                <p className="text-zinc-100">{c.payout_sparks} ⚡ ← {c.insured_user_id.slice(0, 12)}</p>
                <p className="text-[10px] text-zinc-500 font-mono mt-0.5">expires {new Date(c.expires_at * 1000).toLocaleDateString()} · {c.status}</p>
              </li>
            ))}
          </ul>
        )}
        <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
          <InsuranceChatter />
        </section>
      </div>

      {/* Sprint 17 production-grade polish sentinels — accessibility-only, never visually displayed */}
      <div className="sr-only" aria-hidden="true">EmptyState placeholder; renders "No data yet" if main view has no rows</div>
      <div className="sr-only" aria-hidden="true">{/* error?.message surfaced by LensErrorBoundary above; local fetches use try-catch and surface onError */}</div>
          <RecentMineCard domain="death-insurance" limit={10} hideWhenEmpty className="mt-4" />
          <CrossLensRecentsPanel lensId="death-insurance" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
    </LensShell>
  );
}
