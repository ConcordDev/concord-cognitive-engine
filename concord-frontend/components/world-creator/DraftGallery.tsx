'use client';

/**
 * DraftGallery — the world-creator landing surface. Lists the creator's
 * in-progress draft worlds, offers a template gallery to start from a
 * preset, and surfaces a discovery listing of public worlds built by
 * other creators. Backed by world-creator.{draft-list,templates,
 * draft-create,discover} macros.
 */

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';

interface DraftSummary {
  id: string; name: string; biomeLabel: string; universeType: string;
  template: string | null; visibility: string; publishedWorldId: string | null;
  propCount: number; npcCount: number; zoneCount: number; spawnCount: number;
  factionCount: number; updatedAt: string;
}
interface Template {
  id: string; label: string; biome: string; biomeLabel: string;
  description: string; propCount: number; spawnCount: number; zoneCount: number;
}
interface DiscoverWorld {
  id: string; name: string; description: string; biomeLabel: string;
  universeType: string; creatorId: string; publishedWorldId: string | null;
  propCount: number; npcCount: number; zoneCount: number;
}

const VIS_TONE: Record<string, string> = {
  private: 'text-stone-400', unlisted: 'text-sky-300', public: 'text-emerald-300',
};

export function DraftGallery({ onOpen }: { onOpen: (draftId: string) => void }) {
  const [drafts, setDrafts] = useState<DraftSummary[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [discover, setDiscover] = useState<DiscoverWorld[]>([]);
  const [discoverQ, setDiscoverQ] = useState('');
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [showDiscover, setShowDiscover] = useState(false);
  // Genuine load-state machine for the drafts surface so a backend failure is
  // surfaced (role=alert + Retry) rather than swallowed into a silent empty page.
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [loadErr, setLoadErr] = useState<string | null>(null);

  const loadDrafts = useCallback(async () => {
    setLoadState('loading');
    setLoadErr(null);
    const r = await lensRun<{ drafts: DraftSummary[] }>('world-creator', 'draft-list', {});
    if (r.data?.ok && r.data.result?.drafts) {
      setDrafts(r.data.result.drafts);
      setLoadState('ready');
    } else {
      setLoadErr(r.data?.error || 'Could not load your draft worlds.');
      setLoadState('error');
    }
  }, []);

  const loadDiscover = useCallback(async (q: string) => {
    const r = await lensRun<{ worlds: DiscoverWorld[] }>('world-creator', 'discover', { query: q });
    if (r.data?.ok && r.data.result?.worlds) setDiscover(r.data.result.worlds);
    else setDiscover([]);
  }, []);

  useEffect(() => { loadDrafts(); }, [loadDrafts]);
  useEffect(() => {
    lensRun<{ templates: Template[] }>('world-creator', 'templates', {}).then(r => {
      if (r.data?.ok && r.data.result?.templates) setTemplates(r.data.result.templates);
    });
  }, []);
  useEffect(() => { if (showDiscover) loadDiscover(discoverQ); }, [showDiscover, discoverQ, loadDiscover]);

  const createDraft = useCallback(async (template?: string) => {
    const name = newName.trim() || (template ? `${template} world` : 'Untitled world');
    if (name.length < 3) { setErr('Name must be at least 3 characters.'); return; }
    setBusy(true); setErr(null);
    const r = await lensRun<{ draft: { id: string } }>('world-creator', 'draft-create',
      { name, ...(template ? { template } : {}) });
    setBusy(false);
    if (r.data?.ok && r.data.result?.draft) {
      setNewName('');
      await loadDrafts();
      onOpen(r.data.result.draft.id);
    } else setErr(r.data?.error || 'failed to create draft');
  }, [newName, loadDrafts, onOpen]);

  return (
    <div className="space-y-8">
      {err && <div role="alert" className="rounded border border-red-800 bg-red-950/40 px-3 py-2 text-sm text-red-200">{err}</div>}

      {/* new draft */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-stone-100">Start a new world</h2>
        <div className="flex gap-2">
          <input value={newName} onChange={e => setNewName(e.target.value)}
            placeholder="World name" maxLength={64}
            className="flex-1 rounded border border-stone-700 bg-stone-900 px-3 py-2 text-sm text-stone-100" />
          <button onClick={() => createDraft()} disabled={busy}
            className="rounded bg-amber-600 px-4 py-2 text-sm font-medium text-stone-900 hover:bg-amber-500 disabled:opacity-50">
            Blank draft
          </button>
        </div>

        {/* template gallery */}
        <div>
          <p className="mb-2 text-xs uppercase tracking-wider text-stone-500">Or start from a template</p>
          <div className="grid gap-2 sm:grid-cols-3">
            {templates.map(t => (
              <button key={t.id} disabled={busy} onClick={() => createDraft(t.id)}
                className="rounded-lg border border-stone-700 bg-stone-900 p-3 text-left transition hover:border-amber-500">
                <div className="text-sm font-medium text-stone-100">{t.label}</div>
                <div className="mt-0.5 text-[11px] text-stone-400">{t.biomeLabel}</div>
                <p className="mt-1 text-xs text-stone-500">{t.description}</p>
                <div className="mt-1.5 text-[10px] text-stone-600">
                  {t.propCount} props · {t.spawnCount} spawn · {t.zoneCount} zone
                </div>
              </button>
            ))}
            {templates.length === 0 && <p className="text-xs text-stone-600">Loading templates…</p>}
          </div>
        </div>
      </section>

      {/* drafts */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-stone-100">Your draft worlds</h2>
        {loadState === 'loading' ? (
          <div role="status" aria-live="polite"
            className="rounded border border-dashed border-stone-800 p-6 text-center text-sm text-stone-500">
            <span className="inline-block h-3 w-3 animate-pulse rounded-full bg-amber-500/70 align-middle" aria-hidden="true" />
            <span className="ml-2 align-middle">Loading your draft worlds…</span>
          </div>
        ) : loadState === 'error' ? (
          <div role="alert"
            className="flex flex-wrap items-center justify-between gap-3 rounded border border-red-800 bg-red-950/40 px-4 py-3 text-sm text-red-200">
            <span>{loadErr || 'Could not load your draft worlds.'}</span>
            <button onClick={() => loadDrafts()}
              className="rounded border border-red-700 bg-red-900/40 px-3 py-1 text-xs font-medium text-red-100 hover:bg-red-900/70">
              Try again
            </button>
          </div>
        ) : drafts.length === 0 ? (
          <p className="rounded border border-dashed border-stone-800 p-6 text-center text-sm text-stone-500">
            No drafts yet. Start a blank draft or pick a template above.
          </p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {drafts.map(d => (
              <button key={d.id} onClick={() => onOpen(d.id)}
                className="rounded-lg border border-stone-700 bg-stone-900 p-3 text-left transition hover:border-amber-500">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-stone-100">{d.name}</span>
                  <span className={`text-[10px] font-semibold uppercase ${VIS_TONE[d.visibility] || 'text-stone-400'}`}>
                    {d.visibility}
                  </span>
                </div>
                <div className="mt-0.5 text-[11px] text-stone-400">{d.biomeLabel}</div>
                <div className="mt-1.5 text-[10px] text-stone-600">
                  {d.propCount} props · {d.npcCount} NPCs · {d.zoneCount} zones · {d.spawnCount} spawns · {d.factionCount} factions
                </div>
                {d.publishedWorldId && (
                  <div className="mt-1 text-[10px] text-emerald-400">↗ minted as world {d.publishedWorldId.slice(0, 12)}…</div>
                )}
              </button>
            ))}
          </div>
        )}
      </section>

      {/* discovery */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-stone-100">Discover public worlds</h2>
          <button onClick={() => setShowDiscover(s => !s)}
            className="text-xs text-amber-400 hover:underline">
            {showDiscover ? 'Hide' : 'Browse'}
          </button>
        </div>
        {showDiscover && (
          <>
            <input value={discoverQ} onChange={e => setDiscoverQ(e.target.value)}
              placeholder="Search public worlds by name…"
              className="w-full rounded border border-stone-700 bg-stone-900 px-3 py-2 text-sm text-stone-100" />
            {discover.length === 0 ? (
              <p className="text-sm text-stone-500">No public worlds match.</p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {discover.map(w => (
                  <div key={w.id} className="rounded-lg border border-stone-800 bg-stone-950 p-3">
                    <div className="text-sm font-medium text-stone-100">{w.name}</div>
                    <div className="text-[11px] text-stone-400">{w.biomeLabel} · {w.universeType}</div>
                    <p className="mt-1 line-clamp-2 text-xs text-stone-500">{w.description || 'No description.'}</p>
                    <div className="mt-1.5 text-[10px] text-stone-600">
                      {w.propCount} props · {w.npcCount} NPCs · {w.zoneCount} zones
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
