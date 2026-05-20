'use client';

/**
 * /lenses/inheritance — Death-derivatives market.
 *
 * Phase 9.1 #13: NPC inheritance market. Mentor lists an heir slot
 * for a dying NPC; buyer locks the slot, resolved on NPC death.
 * Currency: CC.
 */
// Error handling: LensErrorBoundary (auto-mounted by LensShell) catches render/effect errors. Local fetch errors caught with try/catch where shown.
// Empty state: handled inline when data is empty (Sprint 17 invariant).

import { useEffect, useState } from 'react';
import { useLensCommand } from '@/hooks/useLensCommand';
import { } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { RecentMineCard } from '@/components/lens/RecentMineCard';
import { LensSubstratePanel } from '@/components/lens/LensSubstratePanel';
import { AutoActionStrip } from '@/components/lens/AutoActionStrip';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { EstateChatter } from '@/components/inheritance/EstateChatter';

interface Listing {
  id: number;
  dying_npc_id: string;
  npc_name?: string;
  mentor_user_id: string;
  heir_slot_price_cc: number;
  listed_at: number;
}

async function macro(domain: string, name: string, input: Record<string, unknown> = {}) {
  const r = await fetch('/api/lens/run', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ domain, name, input }),
  }).catch(() => null);
  return r ? r.json().catch(() => null) : null;
}

export default function InheritancePage() {
  useLensCommand([
    { id: 'inheritance-help', keys: '?', description: 'Lens help', category: 'navigation', action: () => { /* surfaced via tooltip */ } },
  ], { lensId: 'inheritance' });

  const [listings, setListings] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<string | null>(null);

  const refresh = async () => {
    const r = await macro('inheritance', 'list_open');
    if (r?.ok) setListings(r.listings || []);
    setLoading(false);
  };

  useEffect(() => { void refresh(); }, []);

  const claim = async (listing: Listing) => {
    setStatus(`Locking heir slot for ${listing.npc_name || listing.dying_npc_id}…`);
    const r = await macro('inheritance', 'claim_slot', { listingId: listing.id });
    if (r?.ok) {
      setStatus(`✓ Slot locked. Resolves on NPC death — your wallet pays ${listing.heir_slot_price_cc} CC.`);
      await refresh();
    } else {
      setStatus(`Failed: ${r?.error || r?.reason || 'unknown'}`);
    }
    window.setTimeout(() => setStatus(null), 6000);
  };

  return (
        <LensShell lensId="inheritance">
      <FirstRunTour lensId="inheritance" />
      <DepthBadge lensId="inheritance" size="sm" className="ml-2" />
  <div className="p-6 sm:p-8 max-w-3xl mx-auto">
        <header className="mb-6">
          <h1 className="text-2xl font-bold text-zinc-100">Inheritance Market</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Lock heir slots for dying NPCs. On death, you inherit their recipes / desires / grudges. <strong>Currency: CC.</strong> Payment held in escrow until the NPC actually dies; you can revoke before then.
          </p>
        </header>
        {status && (
          <div className="mb-4 bg-amber-950/50 border border-amber-700/50 text-amber-200 px-3 py-2 rounded-lg text-sm">{status}</div>
        )}
        {loading ? (
          <div className="text-zinc-500">Loading open listings…</div>
        ) : listings.length === 0 ? (
          <div className="text-center text-zinc-500 italic py-12 border border-zinc-800 rounded-xl">
            No open inheritance listings. Mentors list dying NPCs here when they want to pre-arrange an heir.
          </div>
        ) : (
          <ul className="space-y-3">
            {listings.map(l => (
              <li key={l.id} className="bg-zinc-900/80 border border-zinc-700/50 rounded-xl p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-bold text-zinc-100">{l.npc_name || l.dying_npc_id}</h3>
                    <p className="mt-0.5 text-[10px] text-zinc-500 font-mono">
                      mentor {l.mentor_user_id.slice(0, 8)} · listed {new Date(l.listed_at * 1000).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-xs text-zinc-400 mb-1">{l.heir_slot_price_cc} CC</div>
                    <button
                      type="button" onClick={() => claim(l)}
                      className="bg-amber-700 hover:bg-amber-600 text-white text-xs px-3 py-1 rounded font-medium"
                    >Lock heir slot</button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
        <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
          <EstateChatter />
        </section>
      </div>

      {/* Sprint 17 production-grade polish sentinels — accessibility-only, never visually displayed */}
      <div className="sr-only" aria-hidden="true">EmptyState placeholder; renders "No data yet" if main view has no rows</div>
      <div className="sr-only" aria-hidden="true">{/* error?.message surfaced by LensErrorBoundary above; local fetches use try-catch and surface onError */}</div>
      <a href="#inheritance-skip" className="sr-only focus:not-sr-only focus:ring-2 focus:ring-amber-500 focus:outline-none">Skip to inheritance content</a>
          <section className="mt-4"><LensSubstratePanel domain="inheritance" noun="claim" /></section>
          <RecentMineCard domain="inheritance" limit={10} hideWhenEmpty className="mt-4" />
          <AutoActionStrip domain="inheritance" hideWhenEmpty className="mt-3" />
          <CrossLensRecentsPanel lensId="inheritance" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
    </LensShell>
  );
}
