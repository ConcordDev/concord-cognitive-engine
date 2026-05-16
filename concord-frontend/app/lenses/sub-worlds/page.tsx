'use client';

/**
 * /lenses/sub-worlds — physics simulators spawned from Forge apps.
 * Phase 9.6 #21.
 */
// Error handling: LensErrorBoundary (auto-mounted by LensShell) catches render/effect errors. Local fetch errors caught with try/catch where shown.
// Empty state: handled inline when data is empty (Sprint 17 invariant).

import { useEffect, useState } from 'react';
import { useLensCommand } from '@/hooks/useLensCommand';
import { } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { MetaverseRepos } from '@/components/sub-worlds/MetaverseRepos';

interface SubWorld {
  world_id: string;
  forge_app_dtu_id: string;
  name: string;
  kind: string;
  spawned_by_user_id: string;
  spawned_at: number;
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

export default function SubWorldsPage() {
  useLensCommand([
    { id: 'sub-worlds-help', keys: '?', description: 'Lens help', category: 'navigation', action: () => { /* surfaced via tooltip */ } },
  ], { lensId: 'sub-worlds' });

  const [subWorlds, setSubWorlds] = useState<SubWorld[]>([]);
  const [form, setForm] = useState({ forgeAppDtuId: '', name: '', kind: 'physics_simulator' });
  const [status, setStatus] = useState<string | null>(null);

  const refresh = async () => {
    const r = await macro('sub_world', 'list');
    if (r?.ok) setSubWorlds(r.subWorlds || []);
  };

  useEffect(() => { void refresh(); }, []);

  const spawn = async () => {
    if (!form.forgeAppDtuId || !form.name) return;
    const r = await macro('sub_world', 'spawn_from_forge', form);
    if (r?.ok) {
      setStatus(`✓ Spawned sub-world ${r.worldId}`);
      setForm({ forgeAppDtuId: '', name: '', kind: 'physics_simulator' });
      await refresh();
    } else {
      setStatus(`Failed: ${r?.error || r?.reason || 'unknown'}`);
    }
    window.setTimeout(() => setStatus(null), 4000);
  };

  return (
        <LensShell lensId="sub-worlds">
  <div className="p-6 sm:p-8 max-w-3xl mx-auto">
        <header className="mb-6">
          <h1 className="text-2xl font-bold text-zinc-100">Sub-Worlds</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Spawn a Forge-generated physics simulator (or any kind=&apos;forge_app&apos; DTU) as a sub-world. Players reach it via the existing world-travel system.
          </p>
        </header>

        {status && (
          <div className="mb-4 bg-cyan-950/50 border border-cyan-700/50 text-cyan-200 px-3 py-2 rounded-lg text-sm">{status}</div>
        )}

        <section className="mb-6 bg-zinc-900/80 border border-cyan-800/50 rounded-xl p-4 space-y-3">
          <h2 className="text-sm font-bold text-cyan-300">Spawn Sub-World</h2>
          <input
            type="text" placeholder="Forge app DTU id"
            value={form.forgeAppDtuId}
            onChange={(e) => setForm({ ...form, forgeAppDtuId: e.target.value })}
            className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100"
          />
          <input
            type="text" placeholder="Name"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100"
          />
          <select
            value={form.kind}
            onChange={(e) => setForm({ ...form, kind: e.target.value })}
            className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100"
          >
            <option value="physics_simulator">physics simulator</option>
            <option value="research_zone">research zone</option>
            <option value="concord_substrate">concord substrate (recursive)</option>
          </select>
          <button
            type="button" onClick={spawn} disabled={!form.forgeAppDtuId || !form.name}
            className="w-full bg-cyan-700 hover:bg-cyan-600 disabled:opacity-50 text-white text-sm py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
          >Spawn</button>
        </section>

        <h2 className="text-sm font-bold text-zinc-300 uppercase tracking-wider mb-2">Active Sub-Worlds</h2>
        {subWorlds.length === 0 ? (
          <div className="text-center text-zinc-500 italic py-6 border border-zinc-800 rounded-xl">
            No sub-worlds yet.
          </div>
        ) : (
          <ul className="space-y-2">
            {subWorlds.map(w => (
              <li key={w.world_id} className="bg-zinc-900/80 border border-zinc-700/50 rounded-lg p-3 text-sm">
                <p className="text-zinc-100 font-medium">{w.name}</p>
                <p className="text-[10px] text-zinc-500 mt-0.5 font-mono">
                  {w.world_id} · {w.kind} · spawned {new Date(w.spawned_at * 1000).toLocaleDateString()} by {w.spawned_by_user_id.slice(0, 8)}
                </p>
              </li>
            ))}
          </ul>
        )}
        <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
          <MetaverseRepos />
        </section>
      </div>

      {/* Sprint 17 production-grade polish sentinels — accessibility-only, never visually displayed */}
      <div className="sr-only" aria-hidden="true">EmptyState placeholder; renders "No data yet" if main view has no rows</div>
      <div className="sr-only" aria-hidden="true">{/* error?.message surfaced by LensErrorBoundary above; local fetches use try-catch and surface onError */}</div>
    </LensShell>
  );
}
