'use client';

/**
 * /lenses/photos — Phase BE1 photo gallery.
 *
 * Two views: My photos (yours, with share + delete) and World feed
 * (public photos in a chosen world).
 */

import { useCallback, useEffect, useState } from 'react';
import { Camera, Share2, Trash2, RefreshCcw, Globe2 } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { ManifestActionBar } from '@/components/lens/ManifestActionBar';

interface PhotoRow {
  id: string;
  user_id?: string;
  world_id?: string | null;
  caption: string | null;
  taken_at: number;
  dtu_id: string | null;
  visibility?: string;
}

function timeAgo(ts: number): string {
  const d = Math.max(0, Math.floor(Date.now() / 1000) - ts);
  if (d < 60) return `${d}s ago`;
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  return `${Math.floor(d / 86400)}d ago`;
}

export default function PhotosLensPage() {
  const [tab, setTab] = useState<'mine' | 'world'>('mine');
  const [mine, setMine] = useState<PhotoRow[]>([]);
  const [worldFeed, setWorldFeed] = useState<PhotoRow[]>([]);
  const [worldId, setWorldId] = useState('tunya');

  const refreshMine = useCallback(() => {
    fetch('/api/photos/mine', { credentials: 'include' })
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d?.ok) setMine(d.photos || []); })
      .catch(() => {});
  }, []);

  const refreshWorld = useCallback((wid: string) => {
    fetch(`/api/photos/world/${encodeURIComponent(wid)}/public`)
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d?.ok) setWorldFeed(d.photos || []); })
      .catch(() => {});
  }, []);

  useEffect(() => { refreshMine(); }, [refreshMine]);
  useEffect(() => { if (tab === 'world') refreshWorld(worldId); }, [tab, worldId, refreshWorld]);

  const share = useCallback(async (id: string) => {
    await fetch(`/api/photos/${id}/share`, { method: 'POST', credentials: 'include' });
    refreshMine();
  }, [refreshMine]);

  const remove = useCallback(async (id: string) => {
    await fetch(`/api/photos/${id}/delete`, { method: 'POST', credentials: 'include' });
    refreshMine();
  }, [refreshMine]);

  return (
    <LensShell lensId="photos" asMain={false}>
      <ManifestActionBar />
      <main className="min-h-screen bg-gradient-to-br from-slate-950 via-zinc-950 to-sky-950/10 text-slate-100">
        <header className="border-b border-sky-500/20 bg-zinc-950/60 px-4 py-3 backdrop-blur sm:px-6">
          <div className="mx-auto flex max-w-screen-2xl items-center gap-3">
            <div className="rounded-lg border border-sky-500/40 bg-sky-500/10 p-2">
              <Camera className="h-5 w-5 text-sky-400" />
            </div>
            <div className="flex-1 min-w-0">
              <h1 className="text-base font-semibold tracking-tight sm:text-lg">Photos</h1>
              <p className="mt-0.5 truncate text-xs text-slate-400">Open Photo Mode (P) in the world, save to gallery, share.</p>
            </div>
            <div className="flex gap-1">
              {(['mine', 'world'] as const).map(t => (
                <button key={t} onClick={() => setTab(t)}
                  className={`rounded px-2 py-1 text-xs ${tab === t ? 'bg-sky-500/20 text-sky-100' : 'text-slate-400 hover:text-slate-200'}`}>
                  {t === 'mine' ? 'My photos' : 'World feed'}
                </button>
              ))}
              <button onClick={() => tab === 'mine' ? refreshMine() : refreshWorld(worldId)}
                aria-label="Refresh" className="ml-1 rounded-full border border-sky-500/30 bg-sky-500/10 p-1.5 text-sky-300 hover:bg-sky-500/20">
                <RefreshCcw className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </header>

        <section className="mx-auto max-w-screen-2xl px-4 py-5 sm:px-6">
          {tab === 'world' && (
            <div className="mb-3 flex items-center gap-2 text-[12px]">
              <Globe2 className="h-3 w-3 text-slate-400" />
              <span className="text-slate-400">World:</span>
              <input value={worldId} onChange={(e) => setWorldId(e.target.value)}
                className="rounded border border-slate-700 bg-slate-900/60 px-2 py-1 text-slate-100" />
              <button onClick={() => refreshWorld(worldId)} className="rounded bg-sky-500/20 px-2 py-1 text-sky-100">Browse</button>
            </div>
          )}

          {(tab === 'mine' ? mine : worldFeed).length === 0 ? (
            <p className="py-12 text-center text-[12px] text-slate-400">
              {tab === 'mine' ? 'No photos yet. Press P in the world to open Photo Mode.' : 'No public photos in this world yet.'}
            </p>
          ) : (
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {(tab === 'mine' ? mine : worldFeed).map((p) => (
                <li key={p.id} className="rounded-xl border border-sky-500/20 bg-zinc-950/60 p-3">
                  <h3 className="truncate text-[12px] font-medium text-sky-100">{p.caption || 'Untitled'}</h3>
                  <p className="mt-0.5 text-[10px] text-slate-400">
                    {p.world_id && `${p.world_id} · `}{timeAgo(p.taken_at)}
                  </p>
                  {tab === 'mine' && (
                    <div className="mt-2 flex gap-1">
                      {!p.dtu_id && (
                        <button onClick={() => share(p.id)}
                          className="flex-1 rounded bg-emerald-500/20 px-2 py-1 text-[11px] text-emerald-100 hover:bg-emerald-500/30">
                          <Share2 className="inline h-3 w-3 mr-1" /> Share
                        </button>
                      )}
                      <button onClick={() => remove(p.id)}
                        className="rounded bg-rose-500/20 px-2 py-1 text-[11px] text-rose-200 hover:bg-rose-500/30"
                        aria-label="Delete"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  )}
                  {p.dtu_id && (
                    <p className="mt-1 text-[10px] text-emerald-300/70">DTU minted · royalty active</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </LensShell>
  );
}
