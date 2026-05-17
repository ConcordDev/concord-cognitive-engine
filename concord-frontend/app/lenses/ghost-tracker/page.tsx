'use client';

/**
 * /lenses/ghost-tracker — Phase V dispatch target for the
 * ghost-hunt game mode. Reads spectral drift residues via
 * ghost-hunt.residues + offers a confront CTA bound to
 * ghost-hunt.confront.
 */

import { useEffect, useState, useCallback } from 'react';
import { LensShell } from '@/components/lens/LensShell';
import { RecentMineCard } from '@/components/lens/RecentMineCard';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { HauntingsFeed } from '@/components/ghost-tracker/HauntingsFeed';
import { ManifestActionBar } from '@/components/lens/ManifestActionBar';
import { useLensCommand } from '@/hooks/useLensCommand';

interface Residue {
  id: string;
  drift_type: string;
  severity: string;
  signature: string;
  context_json: string;
  detected_at: number;
}

const ACTIVE_WORLD_KEY = 'concordia:activeWorldId';

async function runMacro<T>(domain: string, name: string, input: Record<string, unknown> = {}): Promise<T | null> {
  const r = await fetch('/api/lens/run', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ domain, name, input }),
  });
  if (!r.ok) return null;
  const json = await r.json();
  return (json?.result ?? json) as T;
}

export default function GhostTrackerPage() {
  const [residues, setResidues] = useState<Residue[]>([]);
  const [loading, setLoading] = useState(true);

  useLensCommand([
    { id: 'refresh', keys: 'r', description: 'Refresh', category: 'navigation', action: () => refresh() },
  ], { lensId: 'ghost-tracker' });

  const refresh = useCallback(async () => {
    setLoading(true);
    const worldId = (typeof window !== 'undefined' && localStorage.getItem(ACTIVE_WORLD_KEY)) || 'concordia-hub';
    const r = await runMacro<{ ok: boolean; residues?: Residue[] }>('ghost-hunt', 'residues', { worldId });
    setResidues(r?.residues ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const confront = useCallback(async (residueId: string) => {
    const worldId = (typeof window !== 'undefined' && localStorage.getItem(ACTIVE_WORLD_KEY)) || 'concordia-hub';
    await runMacro('ghost-hunt', 'confront', { residueId, worldId });
    refresh();
  }, [refresh]);

  return (
    <LensShell lensId="ghost-tracker" asMain={false}>
      <FirstRunTour lensId="ghost-tracker" />
      <ManifestActionBar />
      <DepthBadge lensId="ghost-tracker" size="sm" className="ml-2" />
      <div className="min-h-screen bg-[#0b0f17] text-gray-100 p-6">
        <header className="mb-5">
          <h1 className="text-3xl font-semibold text-violet-300">Ghost Tracker</h1>
          <p className="text-gray-400 mt-1">Spectral residues left by drift events. Confront one to extinguish it.</p>
        </header>

        {loading && <p className="text-gray-500">Loading…</p>}
        {!loading && residues.length === 0 && (
          <div className="rounded border border-white/10 bg-white/5 p-6 text-center text-gray-400">
            No spectral residues here. The world reads true.
          </div>
        )}
        {!loading && residues.length > 0 && (
          <ul className="space-y-3">
            {residues.map((r) => (
              <li key={r.id} className="rounded border border-violet-700/30 bg-violet-900/10 p-4 flex items-start justify-between">
                <div>
                  <h2 className="text-sm uppercase tracking-wide text-violet-400">{r.drift_type}</h2>
                  <p className="text-xs text-gray-500 mt-0.5">severity {r.severity} · {new Date(r.detected_at * 1000).toLocaleString()}</p>
                  <p className="text-sm text-gray-300 mt-2 break-all">{r.signature}</p>
                </div>
                <button
                  type="button"
                  onClick={() => confront(r.id)}
                  className="px-3 py-2 text-sm bg-violet-600/30 text-violet-100 border border-violet-500/40 rounded hover:bg-violet-600/50 ml-3"
                >
                  Confront
                </button>
              </li>
            ))}
          </ul>
        )}
        <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
          <HauntingsFeed />
        </section>
      </div>
          <RecentMineCard domain="ghost-tracker" limit={10} hideWhenEmpty className="mt-4" />
          <CrossLensRecentsPanel lensId="ghost-tracker" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
    </LensShell>
  );
}
