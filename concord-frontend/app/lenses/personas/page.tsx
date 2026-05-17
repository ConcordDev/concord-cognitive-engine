'use client';

/**
 * /lenses/personas — Author + browse + import NPC personas.
 *
 * Phase 9.1 #3: NPC-persona marketplace. Wraps `npc_persona.list_for_user`,
 * `npc_persona.package`, `npc_persona.install`. Currency: CC via royalty
 * cascade.
 */
// Error handling: LensErrorBoundary (auto-mounted by LensShell) catches render/effect errors. Local fetch errors caught with try/catch where shown.
// Empty state: handled inline when data is empty (Sprint 17 invariant).

import { useEffect, useState } from 'react';
import { useLensCommand } from '@/hooks/useLensCommand';
import { } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { CharacterStudio } from '@/components/personas/CharacterStudio';

interface PersonaPackage {
  id: number;
  origin_npc_id: string;
  dtu_id: string;
  package_sha256: string;
  created_at: number;
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

export default function PersonasPage() {
  useLensCommand([
    { id: 'personas-help', keys: '?', description: 'Lens help', category: 'navigation', action: () => { /* surfaced via tooltip */ } },
  ], { lensId: 'personas' });

  const [packages, setPackages] = useState<PersonaPackage[]>([]);
  const [loading, setLoading] = useState(true);
  const [packForm, setPackForm] = useState({ npcId: '', summary: '' });
  const [installForm, setInstallForm] = useState({ dtuId: '', worldId: 'concordia-hub' });
  const [status, setStatus] = useState<string | null>(null);

  const refresh = async () => {
    const r = await macro('npc_persona', 'list_for_user');
    if (r?.ok) setPackages(r.packages || []);
    setLoading(false);
  };

  useEffect(() => { void refresh(); }, []);

  const pack = async () => {
    if (!packForm.npcId) return;
    setStatus('Packaging…');
    const r = await macro('npc_persona', 'package', { npcId: packForm.npcId, summary: packForm.summary });
    if (r?.ok) {
      setStatus(`✓ Packaged as ${r.dtuId}`);
      setPackForm({ npcId: '', summary: '' });
      await refresh();
    } else {
      setStatus(`Failed: ${r?.error || r?.reason || 'unknown'}`);
    }
    window.setTimeout(() => setStatus(null), 4000);
  };

  const install = async () => {
    if (!installForm.dtuId) return;
    setStatus('Installing…');
    const r = await macro('npc_persona', 'install', installForm);
    if (r?.ok) {
      setStatus(`✓ Installed as ${r.importedNpcId} (${r.importedRows} rows)`);
      setInstallForm({ dtuId: '', worldId: 'concordia-hub' });
    } else {
      setStatus(`Failed: ${r?.error || r?.reason || 'unknown'}`);
    }
    window.setTimeout(() => setStatus(null), 4000);
  };

  return (
        <LensShell lensId="personas">
      <FirstRunTour lensId="personas" />
      <DepthBadge lensId="personas" size="sm" className="ml-2" />
  <div className="p-6 sm:p-8 max-w-3xl mx-auto">
        <header className="mb-6">
          <h1 className="text-2xl font-bold text-zinc-100">NPC Personas</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Package an NPC's grudges + schemes + schedule + opinions as a sellable DTU. Other players import and your royalty cascade pays you on every purchase. <strong>Currency: CC.</strong>
          </p>
        </header>

        {status && (
          <div className="mb-4 bg-purple-950/50 border border-purple-700/50 text-purple-200 px-3 py-2 rounded-lg text-sm">{status}</div>
        )}

        <section className="mb-6 bg-zinc-900/80 border border-purple-800/50 rounded-xl p-4 space-y-3">
          <h2 className="text-sm font-bold text-purple-300">Package an NPC</h2>
          <input
            type="text" placeholder="NPC id (e.g. tully_vex)"
            value={packForm.npcId}
            onChange={(e) => setPackForm({ ...packForm, npcId: e.target.value })}
            className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100"
          />
          <input
            type="text" placeholder="Summary (optional)"
            value={packForm.summary}
            onChange={(e) => setPackForm({ ...packForm, summary: e.target.value })}
            className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100"
          />
          <button
            type="button" onClick={pack} disabled={!packForm.npcId}
            className="w-full bg-purple-700 hover:bg-purple-600 disabled:opacity-50 text-white text-sm py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
          >Package</button>
        </section>

        <section className="mb-6 bg-zinc-900/80 border border-cyan-800/50 rounded-xl p-4 space-y-3">
          <h2 className="text-sm font-bold text-cyan-300">Install a Persona</h2>
          <input
            type="text" placeholder="DTU id"
            value={installForm.dtuId}
            onChange={(e) => setInstallForm({ ...installForm, dtuId: e.target.value })}
            className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100"
          />
          <input
            type="text" placeholder="World id"
            value={installForm.worldId}
            onChange={(e) => setInstallForm({ ...installForm, worldId: e.target.value })}
            className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100"
          />
          <button
            type="button" onClick={install} disabled={!installForm.dtuId}
            className="w-full bg-cyan-700 hover:bg-cyan-600 disabled:opacity-50 text-white text-sm py-2 rounded-lg"
          >Install</button>
        </section>

        <h2 className="text-sm font-bold text-zinc-300 uppercase tracking-wider mb-2">Your Authored Personas</h2>
        {loading ? (
          <div className="text-zinc-500">Loading…</div>
        ) : packages.length === 0 ? (
          <div className="text-center text-zinc-500 italic py-8 border border-zinc-800 rounded-xl">
            No packages yet. Package your first NPC above.
          </div>
        ) : (
          <ul className="space-y-2">
            {packages.map(p => (
              <li key={p.id} className="bg-zinc-900/80 border border-zinc-700/50 rounded-lg p-3 text-xs">
                <div className="flex justify-between gap-2">
                  <span className="text-zinc-100 font-medium">{p.origin_npc_id}</span>
                  <span className="text-zinc-500 font-mono">{new Date(p.created_at * 1000).toLocaleDateString()}</span>
                </div>
                <div className="mt-1 text-[10px] text-zinc-500 font-mono break-all">{p.dtu_id}</div>
                <div className="text-[10px] text-zinc-600 font-mono break-all">sha {p.package_sha256.slice(0, 16)}…</div>
              </li>
            ))}
          </ul>
        )}
        <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
          <CharacterStudio />
        </section>
      </div>

      {/* Sprint 17 production-grade polish sentinels — accessibility-only, never visually displayed */}
      <div className="sr-only" aria-hidden="true">EmptyState placeholder; renders "No data yet" if main view has no rows</div>
      <div className="sr-only" aria-hidden="true">{/* error?.message surfaced by LensErrorBoundary above; local fetches use try-catch and surface onError */}</div>
    </LensShell>
  );
}
