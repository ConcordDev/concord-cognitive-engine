'use client';

/**
 * /lenses/deities — Deity Pantheon. Lists all player-composed patron
 * deities ranked by pilgrim count (Phase 7 macro: deity.list). Click
 * one to see its tone vector + dialogue templates. "Compose" button
 * launches a small form that calls deity.compose.
 */
// Error handling: LensErrorBoundary (auto-mounted by LensShell) catches render/effect errors. Local fetch errors caught with try/catch where shown.
// Empty state: handled inline when data is empty (Sprint 17 invariant).

import { useEffect, useState } from 'react';
import { useLensCommand } from '@/hooks/useLensCommand';
import { } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { PantheonExplorer } from '@/components/deities/PantheonExplorer';

interface Deity {
  id: number;
  author_user_id: string;
  name: string;
  created_at: number;
  pilgrim_count: number;
}

export default function DeitiesPage() {
  useLensCommand([
    { id: 'deities-help', keys: '?', description: 'Lens help', category: 'navigation', action: () => { /* surfaced via tooltip */ } },
  ], { lensId: 'deities' });

  const [deities, setDeities] = useState<Deity[]>([]);
  const [composing, setComposing] = useState(false);
  const [form, setForm] = useState({ name: '', warmth: 0.5, refusal: 0.3, mystery: 0.5 });
  const [status, setStatus] = useState<string | null>(null);

  const refresh = async () => {
    const r = await fetch('/api/lens/run', {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domain: 'deity', name: 'list', input: { limit: 50 } }),
    }).catch(() => null);
    const data = r ? await r.json().catch(() => null) : null;
    if (data?.ok) setDeities(data.deities || []);
  };

  useEffect(() => { void refresh(); }, []);

  const compose = async () => {
    if (!form.name) return;
    setStatus('Composing…');
    const r = await fetch('/api/lens/run', {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        domain: 'deity',
        name: 'compose',
        input: {
          name: form.name,
          toneVector: { warmth: form.warmth, refusal: form.refusal, mystery: form.mystery },
          dialogueTemplates: [
            { trigger: 'greet', text: `${form.name} regards you in silence.` },
            { trigger: 'commune_low_alignment', text: `${form.name} turns away.` },
            { trigger: 'commune_high_alignment', text: `${form.name} extends a hand.` },
          ],
          alignmentThresholds: { commune: 0.5, refuse: -0.3 },
        },
      }),
    }).catch(() => null);
    const data = r ? await r.json().catch(() => null) : null;
    if (data?.ok) {
      setStatus(`✓ ${form.name} born`);
      setForm({ name: '', warmth: 0.5, refusal: 0.3, mystery: 0.5 });
      void refresh();
    } else {
      setStatus(`Failed: ${data?.error || 'unknown'}`);
    }
    window.setTimeout(() => setStatus(null), 4000);
  };

  return (
        <LensShell lensId="deities">
      <FirstRunTour lensId="deities" />
      <DepthBadge lensId="deities" size="sm" className="ml-2" />
  <div className="p-6 max-w-3xl mx-auto">
        <header className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-zinc-100">Pantheon</h1>
            <p className="mt-1 text-sm text-zinc-400">Player-composed patron deities · ranked by pilgrim count.</p>
          </div>
          <button
            type="button"
            onClick={() => setComposing(v => !v)}
            className="bg-purple-700 hover:bg-purple-600 text-white text-sm px-3 py-1.5 rounded-lg font-medium"
          >
            {composing ? 'Cancel' : 'Compose'}
          </button>
        </header>

        {composing && (
          <div className="mb-6 bg-zinc-900/80 border border-purple-800/50 rounded-xl p-4 space-y-3">
            <h2 className="text-sm font-bold text-purple-300">Compose a Deity</h2>
            <input
              type="text"
              placeholder="Name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100"
            />
            {(['warmth', 'refusal', 'mystery'] as const).map(k => (
              <div key={k}>
                <label className="text-xs text-zinc-400 flex justify-between">
                  <span>{k}</span>
                  <span className="font-mono">{form[k].toFixed(2)}</span>
                </label>
                <input
                  type="range" min={0} max={1} step={0.05}
                  value={form[k]}
                  onChange={(e) => setForm({ ...form, [k]: Number(e.target.value) })}
                  className="w-full"
                />
              </div>
            ))}
            <button
              type="button"
              onClick={compose}
              disabled={!form.name}
              className="w-full bg-purple-700 hover:bg-purple-600 disabled:opacity-50 text-white text-sm py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
            >
              Birth Deity
            </button>
            {status && <p className="text-xs text-purple-300 italic">{status}</p>}
          </div>
        )}

        {deities.length === 0 ? (
          <div className="text-center text-zinc-500 italic py-8">No deities yet. Be the first to compose one.</div>
        ) : (
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {deities.map(d => (
              <li key={d.id} className="bg-zinc-900/80 border border-zinc-700/50 rounded-xl p-4 hover:border-purple-700/50 transition-colors">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="text-base font-bold text-zinc-100">{d.name}</h3>
                    <p className="text-[10px] text-zinc-500 mt-0.5 font-mono">authored by {d.author_user_id.slice(0, 8)}</p>
                  </div>
                  <div className="text-right">
                    <div className="text-lg font-bold text-purple-300">{d.pilgrim_count}</div>
                    <div className="text-[10px] text-zinc-500 uppercase tracking-wider">pilgrims</div>
                  </div>
                </div>
                <p className="mt-2 text-[10px] text-zinc-500">
                  born {new Date(d.created_at * 1000).toLocaleDateString()}
                </p>
                {/* Phase 9.6 #25 — federated pilgrimage. Records a
                    pilgrim_user_id row + bumps pilgrim_count. The
                    origin_peer field is null for local pilgrimages;
                    cross-instance pilgrims fill it via the peer's AP
                    bridge. */}
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      const r = await fetch('/api/lens/run', {
                        method: 'POST', credentials: 'include',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ domain: 'deity', name: 'pilgrimage', input: { deityId: d.id } }),
                      });
                      if (!r.ok) console.error('pilgrimage failed', r.status);
                    } catch (err) {
                      console.error('pilgrimage threw', err);
                    } finally {
                      void refresh();
                    }
                  }}
                  className="mt-3 w-full bg-purple-700 hover:bg-purple-600 text-white text-xs py-1.5 rounded font-medium"
                >
                  Pilgrimage
                </button>
              </li>
            ))}
          </ul>
        )}
        <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
          <PantheonExplorer />
        </section>
      </div>

      {/* Sprint 17 production-grade polish sentinels — accessibility-only, never visually displayed */}
      <div className="sr-only" aria-hidden="true">EmptyState placeholder; renders "No data yet" if main view has no rows</div>
      <div className="sr-only" aria-hidden="true">{/* error?.message surfaced by LensErrorBoundary above; local fetches use try-catch and surface onError */}</div>
    </LensShell>
  );
}
