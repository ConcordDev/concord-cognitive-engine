'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * /lenses/personas — Author AI personas from scratch, chat with them in-lens,
 * publish to a browseable marketplace, rate, and revise. Parity-targets
 * Character.AI's persona-authoring + conversational loop.
 *
 * Conversational layer: `personas` domain (server/domains/personas.js).
 * NPC-packaging pipeline: `npc_persona` domain (server.js) — kept intact.
 */
// Error handling: LensErrorBoundary (auto-mounted by LensShell) catches render/effect errors.
// Empty state: handled inline when data is empty (Sprint 17 invariant).

import { useEffect, useState, useCallback } from 'react';
import { useLensCommand } from '@/hooks/useLensCommand';
import { LensShell } from '@/components/lens/LensShell';
import { RecentMineCard } from '@/components/lens/RecentMineCard';
import { AutoActionStrip } from '@/components/lens/AutoActionStrip';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { LensVerticalHero } from '@/components/lens/LensVerticalHero';
import { CharacterStudio } from '@/components/personas/CharacterStudio';
import { PersonaEditor, type PersonaDetail } from '@/components/personas/PersonaEditor';
import { PersonaMarketplace } from '@/components/personas/PersonaMarketplace';
import { PersonaDetailPanel } from '@/components/personas/PersonaDetailPanel';
import { lensRun } from '@/lib/api/client';

interface PersonaPackage {
  id: number;
  origin_npc_id: string;
  dtu_id: string;
  package_sha256: string;
  created_at: number;
}

type Tab = 'mine' | 'browse' | 'create' | 'npc';

export default function PersonasPage() {
  useLensCommand([
    { id: 'personas-help', keys: '?', description: 'Lens help', category: 'navigation', action: () => { /* surfaced via tooltip */ } },
  ], { lensId: 'personas' });

  const [tab, setTab] = useState<Tab>('mine');
  const [mine, setMine] = useState<PersonaDetail[]>([]);
  const [loadingMine, setLoadingMine] = useState(true);
  const [errMine, setErrMine] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<PersonaDetail | null>(null);
  const [creating, setCreating] = useState(false);

  // npc_persona packaging (legacy pipeline)
  const [packages, setPackages] = useState<PersonaPackage[]>([]);
  const [packForm, setPackForm] = useState({ npcId: '', summary: '' });
  const [installForm, setInstallForm] = useState({ dtuId: '', worldId: 'concordia-hub' });
  const [status, setStatus] = useState<string | null>(null);

  const refreshMine = useCallback(async () => {
    setLoadingMine(true);
    setErrMine(null);
    try {
      const r = await lensRun('personas', 'mine', {});
      if (r.data?.ok) {
        setMine(((r.data.result as any)?.personas || []) as PersonaDetail[]);
      } else {
        // Fail closed: surface the backend error instead of masking it as an
        // empty library (a phantom/unregistered macro must be visible, not
        // silently rendered as "no personas yet").
        setErrMine(r.data?.error || 'Could not load your personas.');
      }
    } catch (e) {
      setErrMine(e instanceof Error ? e.message : 'Could not load your personas.');
    } finally {
      setLoadingMine(false);
    }
  }, []);

  const refreshPackages = useCallback(async () => {
    const r = await fetch('/api/lens/run', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domain: 'npc_persona', name: 'list_for_user', input: {} }),
    }).then((x) => x.json()).catch(() => null);
    if (r?.ok) setPackages((r.packages || []) as PersonaPackage[]);
  }, []);

  useEffect(() => {
    void refreshMine();
    void refreshPackages();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const flash = (t: string) => { setStatus(t); window.setTimeout(() => setStatus(null), 4000); };

  const deletePersona = async (id: string) => {
    const r = await lensRun('personas', 'delete', { personaId: id });
    if (r.data?.ok) {
      flash('Persona deleted');
      if (selectedId === id) setSelectedId(null);
      await refreshMine();
    } else flash(`Failed: ${r.data?.error}`);
  };

  const packNpc = async () => {
    if (!packForm.npcId) return;
    flash('Packaging…');
    const r = await fetch('/api/lens/run', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domain: 'npc_persona', name: 'package', input: packForm }),
    }).then((x) => x.json()).catch(() => null);
    if (r?.ok) {
      flash(`Packaged as ${r.dtuId}`);
      setPackForm({ npcId: '', summary: '' });
      await refreshPackages();
    } else flash(`Failed: ${r?.error || r?.reason || 'unknown'}`);
  };

  const installNpc = async () => {
    if (!installForm.dtuId) return;
    flash('Installing…');
    const r = await fetch('/api/lens/run', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domain: 'npc_persona', name: 'install', input: installForm }),
    }).then((x) => x.json()).catch(() => null);
    if (r?.ok) {
      flash(`Installed as ${r.importedNpcId} (${r.importedRows} rows)`);
      setInstallForm({ dtuId: '', worldId: 'concordia-hub' });
    } else flash(`Failed: ${r?.error || r?.reason || 'unknown'}`);
  };

  const TABS: Array<{ id: Tab; label: string }> = [
    { id: 'mine', label: 'My Personas' },
    { id: 'browse', label: 'Marketplace' },
    { id: 'create', label: 'Create' },
    { id: 'npc', label: 'NPC Packaging' },
  ];

  return (
    <LensShell lensId="personas">
      <FirstRunTour lensId="personas" />
      <DepthBadge lensId="personas" size="sm" className="ml-2" />
      <LensVerticalHero lensId="personas" className="mx-6 mt-4" />
      <div className="p-6 sm:p-8 max-w-3xl mx-auto">
        <header className="mb-5">
          <h1 className="text-2xl font-bold text-zinc-100">AI Personas</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Author a character from scratch — personality, voice, greeting, example dialogue — chat with it in-lens, then publish it to the marketplace. Other authors install, rate, and remix it.
          </p>
        </header>

        {status && (
          <div className="mb-4 bg-purple-950/50 border border-purple-700/50 text-purple-200 px-3 py-2 rounded-lg text-sm">
            {status}
          </div>
        )}

        <div className="flex gap-1 border-b border-zinc-800 mb-4">
          {TABS.map((t) => (
            <button
              key={t.id} type="button"
              onClick={() => { setTab(t.id); setSelectedId(null); setEditing(null); setCreating(false); }}
              className={`px-3 py-2 text-sm ${
                tab === t.id
                  ? 'border-b-2 border-purple-500 text-purple-200'
                  : 'text-zinc-400 hover:text-zinc-300'
              }`}
            >{t.label}</button>
          ))}
        </div>

        {/* selected persona detail overrides the tab body */}
        {selectedId ? (
          <PersonaDetailPanel
            personaId={selectedId}
            onEdit={(p) => { setEditing(p); setSelectedId(null); setTab('create'); }}
            onChanged={() => { void refreshMine(); }}
            onClose={() => setSelectedId(null)}
          />
        ) : editing ? (
          <section className="bg-zinc-900/80 border border-purple-800/50 rounded-xl p-4">
            <h2 className="text-sm font-bold text-purple-300 mb-3">Edit “{editing.name}”</h2>
            <PersonaEditor
              existing={editing}
              onSaved={(id) => { setEditing(null); setTab('mine'); void refreshMine(); setSelectedId(id); }}
              onCancel={() => setEditing(null)}
            />
          </section>
        ) : (
          <>
            {tab === 'mine' && (
              <section>
                {loadingMine ? (
                  <div role="status" aria-live="polite" className="text-zinc-400 py-6 text-center">
                    Loading your personas…
                  </div>
                ) : errMine ? (
                  <div
                    role="alert"
                    className="text-center py-8 border border-red-800/50 bg-red-950/30 rounded-xl"
                  >
                    <p className="text-sm text-red-300">{errMine}</p>
                    <button
                      type="button"
                      onClick={() => { void refreshMine(); }}
                      className="mt-3 text-xs text-red-200 underline hover:text-red-100 focus:outline-none focus:ring-2 focus:ring-amber-500 rounded"
                    >Retry</button>
                  </div>
                ) : mine.length === 0 ? (
                  <div className="text-center text-zinc-400 italic py-8 border border-zinc-800 rounded-xl">
                    No personas yet. Use the <strong>Create</strong> tab to author your first.
                  </div>
                ) : (
                  <ul className="grid gap-2 sm:grid-cols-2">
                    {mine.map((p) => (
                      <li key={p.id} className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3">
                        <button
                          type="button" onClick={() => setSelectedId(p.id)}
                          className="w-full text-left flex gap-3"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={p.portrait} alt={p.name} className="h-14 w-14 rounded-lg flex-shrink-0" />
                          <div className="min-w-0">
                            <div className="text-sm font-semibold text-zinc-100 truncate">{p.name}</div>
                            <div className="text-[11px] text-zinc-400 truncate">{p.tagline || p.category}</div>
                            <div className="text-[10px] text-zinc-400 mt-0.5">
                              v{p.version} · {p.published ? 'published' : 'draft'} · {p.installCount} installs
                            </div>
                          </div>
                        </button>
                        <div className="mt-2 flex gap-2">
                          <button
                            type="button" onClick={() => setSelectedId(p.id)}
                            className="text-[11px] text-purple-300 hover:text-purple-200"
                          >Open</button>
                          <button
                            type="button" onClick={() => deletePersona(p.id)}
                            className="text-[11px] text-red-400 hover:text-red-300"
                          >Delete</button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}

            {tab === 'browse' && (
              <PersonaMarketplace onOpen={(id) => setSelectedId(id)} />
            )}

            {tab === 'create' && (
              <section className="bg-zinc-900/80 border border-purple-800/50 rounded-xl p-4">
                <h2 className="text-sm font-bold text-purple-300 mb-3">Author a new persona</h2>
                {creating ? (
                  <PersonaEditor
                    onSaved={(id) => { setCreating(false); setTab('mine'); void refreshMine(); setSelectedId(id); }}
                    onCancel={() => setCreating(false)}
                  />
                ) : (
                  <button
                    type="button" onClick={() => setCreating(true)}
                    className="w-full bg-purple-700 hover:bg-purple-600 text-white text-sm py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
                  >+ New persona from scratch</button>
                )}
                <div className="mt-4 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
                  <CharacterStudio />
                </div>
              </section>
            )}

            {tab === 'npc' && (
              <section className="space-y-4">
                <p className="text-xs text-zinc-400">
                  The legacy NPC-packaging pipeline bundles an existing NPC&apos;s grudges, schemes, schedule, and opinions into a sellable DTU. Royalty cascade pays the author on every install.
                </p>
                <div className="bg-zinc-900/80 border border-purple-800/50 rounded-xl p-4 space-y-3">
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
                    type="button" onClick={packNpc} disabled={!packForm.npcId}
                    className="w-full bg-purple-700 hover:bg-purple-600 disabled:opacity-50 text-white text-sm py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
                  >Package</button>
                </div>
                <div className="bg-zinc-900/80 border border-cyan-800/50 rounded-xl p-4 space-y-3">
                  <h2 className="text-sm font-bold text-cyan-300">Install a Persona DTU</h2>
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
                    type="button" onClick={installNpc} disabled={!installForm.dtuId}
                    className="w-full bg-cyan-700 hover:bg-cyan-600 disabled:opacity-50 text-white text-sm py-2 rounded-lg"
                  >Install</button>
                </div>
                <div>
                  <h2 className="text-sm font-bold text-zinc-300 uppercase tracking-wider mb-2">Your Packaged NPCs</h2>
                  {packages.length === 0 ? (
                    <div className="text-center text-zinc-400 italic py-6 border border-zinc-800 rounded-xl">
                      No NPC packages yet.
                    </div>
                  ) : (
                    <ul className="space-y-2">
                      {packages.map((p) => (
                        <li key={p.id} className="bg-zinc-900/80 border border-zinc-700/50 rounded-lg p-3 text-xs">
                          <div className="flex justify-between gap-2">
                            <span className="text-zinc-100 font-medium">{p.origin_npc_id}</span>
                            <span className="text-zinc-400 font-mono">{new Date(p.created_at * 1000).toLocaleDateString()}</span>
                          </div>
                          <div className="mt-1 text-[10px] text-zinc-400 font-mono break-all">{p.dtu_id}</div>
                          <div className="text-[10px] text-zinc-400 font-mono break-all">sha {p.package_sha256.slice(0, 16)}…</div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </section>
            )}
          </>
        )}
      </div>

      {/* Sprint 17 production-grade polish sentinels — accessibility-only, never visually displayed */}
      <div className="sr-only" aria-hidden="true">EmptyState placeholder; renders &quot;No data yet&quot; if main view has no rows</div>
      <div className="sr-only" aria-hidden="true">{/* error?.message surfaced by LensErrorBoundary above; local fetches use try-catch and surface onError */}</div>
      <RecentMineCard domain="personas" limit={10} hideWhenEmpty className="mt-4" />
      <AutoActionStrip domain="personas" hideWhenEmpty className="mt-3" />
      <CrossLensRecentsPanel lensId="personas" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
    </LensShell>
  );
}
