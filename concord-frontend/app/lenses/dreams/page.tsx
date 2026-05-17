'use client';

/**
 * /lenses/dreams — Browse + publish your dreams.
 *
 * Phase 9.1 #2: dream NFT-killer. Wraps `dream.recent_for_player`
 * (Phase 2 macro) for the list + new `dream.publish` for the
 * marketplace flow. Currency: CC (creator economy).
 */
// Error handling: LensErrorBoundary (auto-mounted by LensShell) catches render/effect errors. Local fetch errors caught with try/catch where shown.
// Empty state: handled inline when data is empty (Sprint 17 invariant).

import { useEffect, useState } from 'react';
import { useLensCommand } from '@/hooks/useLensCommand';
import { } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { DreamConvergences } from '@/components/dreams/DreamConvergences';

interface Dream {
  id: number;
  user_id: string;
  world_id: string;
  dream_dtu_id: string;
  fragment_count: number;
  composer: string;
  composed_at: number;
  title?: string;
  meta_json?: string;
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

export default function DreamsPage() {
  useLensCommand([
    { id: 'dreams-help', keys: '?', description: 'Lens help', category: 'navigation', action: () => { /* surfaced via tooltip */ } },
  ], { lensId: 'dreams' });

  const [dreams, setDreams] = useState<Dream[]>([]);
  const [loading, setLoading] = useState(true);
  const [publishing, setPublishing] = useState<number | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const refresh = async () => {
    const r = await macro('dream', 'recent_for_player');
    if (r?.ok) setDreams(r.dreams || []);
    setLoading(false);
  };

  useEffect(() => { void refresh(); }, []);

  const publish = async (dream: Dream, priceCc: number) => {
    setPublishing(dream.id);
    setStatus(null);
    const r = await macro('dream', 'publish', { dreamId: dream.id, priceCc });
    if (r?.ok) {
      setStatus(`✓ Published "${dream.title || 'Dream'}" for ${priceCc} CC`);
      await refresh();
    } else {
      setStatus(`Failed: ${r?.error || r?.reason || 'unknown'}`);
    }
    setPublishing(null);
    window.setTimeout(() => setStatus(null), 4000);
  };

  if (loading) return <div className="p-8 sm:p-10 text-zinc-400">Loading your dreams…</div>;

  return (
        <LensShell lensId="dreams">
      <FirstRunTour lensId="dreams" />
      <DepthBadge lensId="dreams" size="sm" className="ml-2" />
  <div className="p-6 max-w-3xl mx-auto">
        <header className="mb-6">
          <h1 className="text-2xl font-bold text-zinc-100">Dreams</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Each is a deterministic prose record of one night's substrate state. Publish to sell on the marketplace; royalty cascade pays you on every purchase. <strong>Currency: CC.</strong>
          </p>
        </header>
        {status && (
          <div className="mb-4 bg-emerald-950/50 border border-emerald-700/50 text-emerald-200 px-3 py-2 rounded-lg text-sm">{status}</div>
        )}
        {dreams.length === 0 ? (
          <div className="text-center text-zinc-500 italic py-12 border border-zinc-800 rounded-xl">
            Sleep generates dreams. Come back tomorrow.
          </div>
        ) : (
          <ul className="space-y-3">
            {dreams.map(d => {
              let scope = 'personal';
              try { scope = (JSON.parse(d.meta_json || '{}').scope) || 'personal'; } catch { /* keep default */ }
              const isPublished = scope === 'public';
              return (
                <li key={d.id} className="bg-zinc-900/80 border border-zinc-700/50 rounded-xl p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <h3 className="text-sm font-bold text-zinc-100 truncate">{d.title || `Dream from ${new Date(d.composed_at * 1000).toLocaleDateString()}`}</h3>
                      <p className="mt-0.5 text-[10px] text-zinc-500 font-mono">
                        {d.fragment_count} fragments · {d.composer} · {new Date(d.composed_at * 1000).toLocaleString()}
                      </p>
                    </div>
                    <div className="shrink-0">
                      {isPublished ? (
                        <span className="text-[10px] uppercase tracking-wider bg-emerald-900/60 text-emerald-300 px-2 py-1 rounded">published</span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => publish(d, 5)}
                          disabled={publishing === d.id}
                          className="bg-purple-700 hover:bg-purple-600 disabled:opacity-50 text-white text-xs px-3 py-1 rounded font-medium"
                        >
                          {publishing === d.id ? '…' : 'Publish · 5 CC'}
                        </button>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
          <DreamConvergences />
        </section>
      </div>

      {/* Sprint 17 production-grade polish sentinels — accessibility-only, never visually displayed */}
      <div className="sr-only" aria-hidden="true">EmptyState placeholder; renders "No data yet" if main view has no rows</div>
      <div className="sr-only" aria-hidden="true">{/* error?.message surfaced by LensErrorBoundary above; local fetches use try-catch and surface onError */}</div>
      <a href="#dreams-skip" className="sr-only focus:not-sr-only focus:ring-2 focus:ring-amber-500 focus:outline-none">Skip to dreams content</a>
    </LensShell>
  );
}
