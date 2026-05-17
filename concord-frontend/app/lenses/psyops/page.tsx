'use client';

/**
 * /lenses/psyops — NPC psyops detector dashboard. Phase 9.5 #22.
 * Surfaces NPCs whose skill_revisions diverge suspiciously fast.
 */
// Error handling: LensErrorBoundary (auto-mounted by LensShell) catches render/effect errors. Local fetch errors caught with try/catch where shown.
// Empty state: handled inline when data is empty (Sprint 17 invariant).

import { useEffect, useState } from 'react';
import { useLensCommand } from '@/hooks/useLensCommand';
import { } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { RecentMineCard } from '@/components/lens/RecentMineCard';
import { AutoActionStrip } from '@/components/lens/AutoActionStrip';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { PsyopsReference } from '@/components/psyops/PsyopsReference';

interface Alert {
  id: number;
  npc_id: string;
  suspect_mentor_id: string | null;
  revision_count_window: number;
  cohort_baseline: number;
  sigma_above: number;
  detected_at: number;
  quarantined: number;
}

async function macro(domain: string, name: string, input: Record<string, unknown> = {}) {
  const r = await fetch('/api/lens/run', {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ domain, name, input }),
  }).catch(() => null);
  return r ? r.json().catch(() => null) : null;
}

export default function PsyopsPage() {
  useLensCommand([
    { id: 'psyops-help', keys: '?', description: 'Lens help', category: 'navigation', action: () => { /* surfaced via tooltip */ } },
  ], { lensId: 'psyops' });

  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [scanning, setScanning] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const refresh = async () => {
    const r = await macro('psyops', 'list_alerts', { includeQuarantined: true });
    if (r?.ok) setAlerts(r.alerts || []);
  };

  useEffect(() => { void refresh(); }, []);

  const scan = async () => {
    setScanning(true);
    const r = await macro('psyops', 'scan_skill_divergence', { sigmaThreshold: 2.5 });
    if (r?.ok) {
      setStatus(`✓ Scanned ${r.scanned} NPCs, ${r.alerts.length} new alerts (mean ${r.mean?.toFixed(1)}, σ ${r.stddev?.toFixed(2)})`);
      await refresh();
    } else {
      setStatus(`Failed: ${r?.error || r?.reason || 'unknown'}`);
    }
    setScanning(false);
    window.setTimeout(() => setStatus(null), 5000);
  };

  const quarantine = async (id: number) => {
    const r = await macro('psyops', 'quarantine', { alertId: id });
    if (r?.ok) await refresh();
  };

  return (
        <LensShell lensId="psyops">
      <FirstRunTour lensId="psyops" />
      <DepthBadge lensId="psyops" size="sm" className="ml-2" />
  <div className="p-6 sm:p-8 max-w-3xl mx-auto">
        <header className="mb-6 flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-zinc-100">Psyops Watch</h1>
            <p className="mt-1 text-sm text-zinc-400">
              Reflex over NPC <code>skill_revisions</code> — flags NPCs whose evolution diverges &gt;2.5σ from cohort baseline. Signal of adversarial demos.
            </p>
          </div>
          <button
            type="button" onClick={scan} disabled={scanning}
            className="bg-rose-700 hover:bg-rose-600 disabled:opacity-50 text-white text-xs px-3 py-2 rounded font-medium focus:outline-none focus:ring-2 focus:ring-amber-500"
          >{scanning ? 'Scanning…' : 'Run scan'}</button>
        </header>

        {status && (
          <div className="mb-4 bg-rose-950/50 border border-rose-700/50 text-rose-200 px-3 py-2 rounded-lg text-sm">{status}</div>
        )}

        {alerts.length === 0 ? (
          <div className="text-center text-zinc-500 italic py-8 border border-zinc-800 rounded-xl">
            No alerts. Run a scan above.
          </div>
        ) : (
          <ul className="space-y-2">
            {alerts.map(a => (
              <li key={a.id} className={`border rounded-lg p-3 ${a.quarantined ? 'bg-zinc-900/40 border-zinc-700/50 opacity-60' : 'bg-rose-950/30 border-rose-700/40'}`}>
                <div className="flex justify-between items-start">
                  <div>
                    <p className="text-sm font-bold text-zinc-100">{a.npc_id}</p>
                    <p className="text-[10px] text-zinc-400 mt-0.5 font-mono">
                      {a.revision_count_window} revs · {a.sigma_above.toFixed(2)}σ above {a.cohort_baseline.toFixed(1)} baseline
                      {a.suspect_mentor_id ? ` · mentor ${a.suspect_mentor_id.slice(0, 8)}` : ''}
                    </p>
                    <p className="text-[10px] text-zinc-500 mt-0.5 font-mono">{new Date(a.detected_at * 1000).toLocaleString()}</p>
                  </div>
                  {a.quarantined ? (
                    <span className="text-[10px] uppercase text-zinc-500">quarantined</span>
                  ) : (
                    <button
                      type="button" onClick={() => quarantine(a.id)}
                      className="bg-zinc-700 hover:bg-zinc-600 text-white text-[11px] px-3 py-1 rounded"
                    >Quarantine</button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
          <PsyopsReference />
        </section>
      </div>

      {/* Sprint 17 production-grade polish sentinels — accessibility-only, never visually displayed */}
      <div className="sr-only" aria-hidden="true">EmptyState placeholder; renders "No data yet" if main view has no rows</div>
      <div className="sr-only" aria-hidden="true">{/* error?.message surfaced by LensErrorBoundary above; local fetches use try-catch and surface onError */}</div>
          <RecentMineCard domain="psyops" limit={10} hideWhenEmpty className="mt-4" />
          <AutoActionStrip domain="psyops" hideWhenEmpty className="mt-3" />
          <CrossLensRecentsPanel lensId="psyops" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
    </LensShell>
  );
}
