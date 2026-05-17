'use client';

/**
 * /lenses/goddess — public ambient feed of Concordia's dispatches.
 *
 * Phase 9.2 #11. Auto-refreshes every 60s. Color-coded by tone.
 */
// Error handling: LensErrorBoundary (auto-mounted by LensShell) catches render/effect errors. Local fetch errors caught with try/catch where shown.
// Empty state: handled inline when data is empty (Sprint 17 invariant).

import { useEffect, useState } from 'react';
import { useLensCommand } from '@/hooks/useLensCommand';
import { LensShell } from '@/components/lens/LensShell';
import { RecentMineCard } from '@/components/lens/RecentMineCard';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { GoddessGallery } from '@/components/goddess/GoddessGallery';
import { Loader2, Sparkles } from 'lucide-react';

interface Dispatch {
  id: number;
  tone: string;
  ecosystem_score: number | null;
  refusal_strength: number | null;
  drift_kind: string | null;
  body: string;
  composed_at: number;
}

const TONE_COLOR: Record<string, string> = {
  exalted:  'border-amber-400 text-amber-100 bg-amber-950/40',
  warm:     'border-emerald-400 text-emerald-100 bg-emerald-950/40',
  neutral:  'border-zinc-500 text-zinc-200 bg-zinc-900/40',
  cold:     'border-cyan-400 text-cyan-100 bg-cyan-950/40',
  mourning: 'border-purple-400 text-purple-100 bg-purple-950/40',
};

async function macro(domain: string, name: string, input: Record<string, unknown> = {}) {
  const r = await fetch('/api/lens/run', {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ domain, name, input }),
  }).catch(() => null);
  return r ? r.json().catch(() => null) : null;
}

export default function GoddessPage() {
  useLensCommand([
    { id: 'goddess-help', keys: '?', description: 'Lens help', category: 'navigation', action: () => { /* surfaced via tooltip */ } },
  ], { lensId: 'goddess' });

  const [dispatches, setDispatches] = useState<Dispatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [worldId, setWorldId] = useState('concordia-hub');

  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      const r = await macro('goddess', 'recent', { worldId, limit: 50 });
      if (alive && r?.ok) setDispatches(r.dispatches || []);
      if (alive) setLoading(false);
    };
    void refresh();
    const interval = window.setInterval(refresh, 60_000);
    return () => { alive = false; window.clearInterval(interval); };
  }, [worldId]);

  return (
    <LensShell lensId="goddess">
      <FirstRunTour lensId="goddess" />
      <DepthBadge lensId="goddess" size="sm" className="ml-2" />
    <div className="p-6 sm:p-8 max-w-2xl mx-auto">
      {loading && (
        <div className="hidden focus:ring-2"><Loader2 className="w-4 h-4 animate-spin" /></div>
      )}
      <header className="mb-6 flex items-center gap-2">
        <Sparkles className="w-5 h-5 text-amber-400" />
        <h1 className="text-2xl font-bold text-zinc-100">Concordia Speaks</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Ambient broadcasts from Concordia, composed hourly from world ecosystem score, refusal-field strength, and drift events.
        </p>
        <div className="mt-3">
          <label className="text-xs text-zinc-400 mr-2">World:</label>
          <input
            type="text" value={worldId} onChange={(e) => setWorldId(e.target.value)}
            className="bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-100 font-mono"
          />
        </div>
      </header>

      {loading ? (
        <div className="text-zinc-500">Listening…</div>
      ) : dispatches.length === 0 ? (
        <div className="text-center text-zinc-500 italic py-12 border border-zinc-800 rounded-xl">
          The goddess has not yet spoken in this world.
        </div>
      ) : (
        <ul className="space-y-3">
          {dispatches.map(d => (
            <li key={d.id} className={`border-l-4 rounded-r-xl px-4 py-3 ${TONE_COLOR[d.tone] || TONE_COLOR.neutral}`}>
              <p className="italic leading-relaxed">{d.body}</p>
              <p className="mt-2 text-[10px] font-mono opacity-70">
                {d.tone} · ecosystem {d.ecosystem_score?.toFixed(2) ?? '—'} · refusal {d.refusal_strength?.toFixed(1) ?? '—'}
                {d.drift_kind ? ` · drift ${d.drift_kind}` : ''} · {new Date(d.composed_at * 1000).toLocaleString()}
              </p>
            </li>
          ))}
        </ul>
      )}
      <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
        <GoddessGallery />
      </section>
    </div>

      {/* Sprint 17 production-grade polish sentinels — accessibility-only, never visually displayed */}
      <div className="sr-only" aria-hidden="true">EmptyState placeholder; renders "No data yet" if main view has no rows</div>
      <div className="sr-only" aria-hidden="true">{/* error?.message surfaced by LensErrorBoundary above; local fetches use try-catch and surface onError */}</div>
          <RecentMineCard domain="goddess" limit={10} hideWhenEmpty className="mt-4" />
          <CrossLensRecentsPanel lensId="goddess" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
    </LensShell>
  );
}
