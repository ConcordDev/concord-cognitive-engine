'use client';

/**
 * /lenses/crisis-ops — Phase V dispatch target for the
 * crisis-response game mode. Reads active crises in the player's
 * current world via crisis.active_for_player and surfaces a
 * Resolve CTA bound to crisis.resolve.
 */

import { useEffect, useState, useCallback } from 'react';
import { LensShell } from '@/components/lens/LensShell';
import { RecentMineCard } from '@/components/lens/RecentMineCard';
import { LensSubstratePanel } from '@/components/lens/LensSubstratePanel';
import { AutoActionStrip } from '@/components/lens/AutoActionStrip';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { FemaDisasters } from '@/components/crisis-ops/FemaDisasters';
import { ManifestActionBar } from '@/components/lens/ManifestActionBar';
import { useLensCommand } from '@/hooks/useLensCommand';

interface Crisis {
  id: string;
  type: string;
  description: string;
  origin_world_id: string;
  started_at: number;
}
interface SkillSuggestion {
  skill_id: string;
  level: number;
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

export default function CrisisOpsPage() {
  const [crises, setCrises] = useState<Crisis[]>([]);
  const [suggestions, setSuggestions] = useState<SkillSuggestion[]>([]);
  const [loading, setLoading] = useState(true);

  useLensCommand([
    { id: 'refresh', keys: 'r', description: 'Refresh', category: 'navigation', action: () => refresh() },
  ], { lensId: 'crisis-ops' });

  const refresh = useCallback(async () => {
    setLoading(true);
    const worldId = (typeof window !== 'undefined' && localStorage.getItem(ACTIVE_WORLD_KEY)) || 'concordia-hub';
    const r = await runMacro<{ ok: boolean; crises?: Crisis[]; suggestions?: SkillSuggestion[] }>('crisis', 'active_for_player', { worldId });
    setCrises(r?.crises ?? []);
    setSuggestions(r?.suggestions ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const resolve = useCallback(async (crisisId: string) => {
    await runMacro('crisis', 'resolve', { crisisId });
    refresh();
  }, [refresh]);

  return (
    <LensShell lensId="crisis-ops" asMain={false}>
      <FirstRunTour lensId="crisis-ops" />
      <ManifestActionBar />
      <DepthBadge lensId="crisis-ops" size="sm" className="ml-2" />
      <div className="min-h-screen bg-[#0b0f17] text-gray-100 p-6">
        <header className="mb-5">
          <h1 className="text-3xl font-semibold text-rose-300">Crisis Ops</h1>
          <p className="text-gray-400 mt-1">Active world crises and the skills you can deploy against them.</p>
        </header>

        {loading && <p className="text-gray-500">Loading…</p>}
        {!loading && crises.length === 0 && (
          <div className="rounded border border-white/10 bg-white/5 p-6 text-center text-gray-400">
            No active crises. The world is at rest.
          </div>
        )}
        {!loading && crises.length > 0 && (
          <ul className="space-y-3">
            {crises.map((c) => (
              <li key={c.id} className="rounded border border-rose-700/30 bg-rose-900/10 p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-semibold text-rose-200">{c.type}</h2>
                    <p className="text-sm text-gray-300 mt-1">{c.description}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => resolve(c.id)}
                    className="px-3 py-2 text-sm bg-rose-600/30 text-rose-100 border border-rose-500/40 rounded hover:bg-rose-600/50"
                  >
                    Resolve
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {suggestions.length > 0 && (
          <section className="mt-6">
            <h3 className="text-sm uppercase tracking-wide text-gray-500 mb-2">Your top skills</h3>
            <div className="flex gap-2 flex-wrap">
              {suggestions.map((s) => (
                <span key={s.skill_id} className="px-2 py-1 rounded bg-white/5 border border-white/10 text-xs text-gray-300">
                  {s.skill_id} · L{s.level}
                </span>
              ))}
            </div>
          </section>
        )}
        <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
          <FemaDisasters />
        </section>
      </div>
          <section className="mt-4"><LensSubstratePanel domain="crisis-ops" noun="incident" /></section>
          <RecentMineCard domain="crisis-ops" limit={10} hideWhenEmpty className="mt-4" />
          <AutoActionStrip domain="crisis-ops" hideWhenEmpty className="mt-3" />
          <CrossLensRecentsPanel lensId="crisis-ops" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
    </LensShell>
  );
}
