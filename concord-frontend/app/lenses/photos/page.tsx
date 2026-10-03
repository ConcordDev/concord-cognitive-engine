'use client';

/**
 * /lenses/photos — Phase BE1 photo gallery.
 *
 * Two views: My photos (yours, with share + delete) and World feed
 * (public photos in a chosen world). Backed by the real `photos` domain
 * (server/domains/photos.js → server/lib/photo-gallery.js) and the
 * /api/photos/* REST surface that delegates to the same lib.
 *
 * Four UX states are explicit: loading (role=status + spinner), error
 * (role=alert + Retry), empty, and populated (reduced-motion-aware
 * entrance animation). Share/delete fire success/error toasts.
 * Pinned by tests/photos-lens-states.test.tsx.
 *
 * Clicking a thumbnail opens `PhotoLightboxModal` (components/photos/
 * PhotoLightboxModal.tsx), which calls the real `photos.get` macro for
 * single-photo detail — closing the last documented gap in
 * docs/lens-specs/photos-capability-map.md (`photos.get` was previously
 * UNSURFACED). Pinned by tests/photos-lightbox.test.tsx.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, Share2, Trash2, RefreshCcw, Globe2, Loader2, Upload, Images } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { PhotoLightboxModal } from '@/components/photos/PhotoLightboxModal';
import { useUIStore } from '@/store/ui';
import { useAuth } from '@/hooks/useAuth';
import { useLensCommand } from '@/hooks/useLensCommand';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { cn } from '@/lib/utils';

interface PhotoRow {
  id: string;
  user_id?: string;
  world_id?: string | null;
  caption: string | null;
  taken_at: number;
  dtu_id: string | null;
  visibility?: string;
}

type LoadState = 'loading' | 'error' | 'ready';

function timeAgo(ts: number): string {
  const d = Math.max(0, Math.floor(Date.now() / 1000) - ts);
  if (d < 60) return `${d}s ago`;
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  return `${Math.floor(d / 86400)}d ago`;
}

function readAsPngDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const c = document.createElement('canvas');
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        const ctx = c.getContext('2d');
        if (!ctx) throw new Error('Canvas is unavailable in this browser.');
        ctx.drawImage(img, 0, 0);
        resolve(c.toDataURL('image/png'));
      } catch (e) {
        reject(e);
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file is not an image the browser can read.')); };
    img.src = url;
  });
}

export default function PhotosLensPage() {
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const fileRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [tab, setTab] = useState<'mine' | 'world'>('mine');
  const [mine, setMine] = useState<PhotoRow[]>([]);
  const [worldFeed, setWorldFeed] = useState<PhotoRow[]>([]);
  const [worldId, setWorldId] = useState('tunya');
  const [state, setState] = useState<LoadState>('loading');
  const [error, setError] = useState<string | null>(null);
  const [lightboxId, setLightboxId] = useState<string | null>(null);
  const addToast = useUIStore((s) => s.addToast);

  const refreshMine = useCallback(async () => {
    setState('loading');
    setError(null);
    try {
      const r = await fetch('/api/photos/mine', { credentials: 'include' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      if (!d?.ok) throw new Error(d?.reason || d?.error || 'Request failed');
      setMine(d.photos || []);
      setState('ready');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load your photos.');
      setState('error');
    }
  }, []);

  const refreshWorld = useCallback(async (wid: string) => {
    setState('loading');
    setError(null);
    try {
      const r = await fetch(`/api/photos/world/${encodeURIComponent(wid)}/public`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      if (!d?.ok) throw new Error(d?.reason || d?.error || 'Request failed');
      setWorldFeed(d.photos || []);
      setState('ready');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the world feed.');
      setState('error');
    }
  }, []);

  const refresh = useCallback(() => {
    if (tab === 'mine') return refreshMine();
    return refreshWorld(worldId);
  }, [tab, worldId, refreshMine, refreshWorld]);

  useEffect(() => { void refresh(); }, [refresh]);

  const share = useCallback(async (id: string) => {
    try {
      const r = await fetch(`/api/photos/${id}/share`, { method: 'POST', credentials: 'include' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      addToast({ type: 'success', message: 'Photo shared — DTU minted', duration: 2500 });
    } catch {
      addToast({ type: 'error', message: 'Could not share photo' });
    } finally {
      void refreshMine();
    }
  }, [refreshMine, addToast]);

  const remove = useCallback(async (id: string) => {
    try {
      const r = await fetch(`/api/photos/${id}/delete`, { method: 'POST', credentials: 'include' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      addToast({ type: 'success', message: 'Photo deleted', duration: 2500 });
    } catch {
      addToast({ type: 'error', message: 'Could not delete photo' });
    } finally {
      void refreshMine();
    }
  }, [refreshMine, addToast]);

  const openImport = useCallback(() => {
    setTab('mine');
    fileRef.current?.click();
  }, []);

  const onFiles = useCallback(async (files: FileList | null) => {
    const list = Array.from(files || []);
    if (!list.length) return;
    setImporting(true);
    let saved = 0;
    try {
      for (const f of list) {
        try {
          const dataUrl = await readAsPngDataUrl(f);
          const r = await fetch('/api/photos/save', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ dataUrl, caption: f.name.replace(/\.[^.]+$/, ''), visibility: 'private' }),
          });
          const d = await r.json().catch(() => null);
          if (!r.ok || !d?.ok) throw new Error(d?.error === 'blob_too_large' ? 'Over the 5 MB limit once converted to PNG.' : (d?.error || `HTTP ${r.status}`));
          saved++;
        } catch (e) {
          addToast({ type: 'error', message: `${f.name}: ${e instanceof Error ? e.message : 'import failed'}` });
        }
      }
      if (saved) addToast({ type: 'success', message: `Imported ${saved} photo${saved === 1 ? '' : 's'}`, duration: 2500 });
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = '';
      void refreshMine();
    }
  }, [addToast, refreshMine]);

  useLensCommand(
    [
      { id: 'tab-mine', keys: '1', description: 'My photos', category: 'navigation', action: () => setTab('mine') },
      { id: 'tab-world', keys: '2', description: 'World feed', category: 'navigation', action: () => setTab('world') },
      { id: 'photos-import', keys: 'i', description: 'Import photos', category: 'actions', action: openImport },
      { id: 'photos-refresh', keys: 'r', description: 'Refresh', category: 'actions', action: () => void refresh() },
    ],
    { lensId: 'photos' },
  );

  const rows = tab === 'mine' ? mine : worldFeed;

  return (
    <LensShell lensId="photos" asMain={false}>
      <div data-lens-theme="photos" className="relative min-h-full px-8 pb-28 pt-6">
        <p className="text-[14px] text-zinc-500">Photos</p>
        <h1 className="mb-5 mt-1 font-vault text-[2.25rem] leading-tight text-zinc-100 sm:text-5xl">
          {tab === 'mine' ? `The frame${who ? `, ${who}` : ''}` : 'What the world is framing'}
        </h1>

        <div className="mb-6 flex flex-wrap items-center gap-3">
          <nav className="inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-full border border-white/10 bg-white/[0.03] p-1" aria-label="Photo views">
            {([['mine', 'My photos', Camera, '1'], ['world', 'World feed', Images, '2']] as const).map(([t, label, Icon, k]) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                aria-pressed={tab === t}
                title={`${label} (${k})`}
                className={cn(
                  'inline-flex items-center gap-2 whitespace-nowrap rounded-full px-4 py-1.5 text-[14px] transition-colors',
                  tab === t ? 'bg-white/10 text-zinc-50' : 'text-zinc-500 hover:text-zinc-200',
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
                <kbd className="hidden rounded border border-white/10 bg-white/5 px-1 py-0.5 font-mono text-[10px] text-white/30 sm:inline-block">{k}</kbd>
              </button>
            ))}
          </nav>
          <button
            type="button"
            onClick={() => void refresh()}
            aria-label="Refresh"
            title="Refresh (R)"
            className="rounded-full border border-white/10 bg-white/[0.03] p-2 text-zinc-400 transition-colors hover:text-zinc-100"
          >
            <RefreshCcw className="h-3.5 w-3.5" />
          </button>
          <span className="text-[13px] text-zinc-500">Open Photo Mode (P) in the world, import your own, share to mint a DTU.</span>
        </div>

        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          aria-label="Import photos"
          onChange={(e) => void onFiles(e.target.files)}
        />

        <section>
          {tab === 'world' && (
            <div className="mb-3 flex items-center gap-2 text-[12px]">
              <Globe2 className="h-3 w-3 text-slate-400" />
              <span className="text-slate-400">World:</span>
              <input value={worldId} onChange={(e) => setWorldId(e.target.value)}
                aria-label="World id"
                className="rounded border border-slate-700 bg-slate-900/60 px-2 py-1 text-slate-100" />
              <button onClick={() => void refreshWorld(worldId)} className="rounded bg-white/10 px-3 py-1 text-zinc-100 hover:bg-white/15">Browse</button>
            </div>
          )}

          {state === 'loading' ? (
            <div
              data-testid="photos-loading"
              role="status"
              aria-busy="true"
              aria-live="polite"
              className="flex items-center justify-center gap-2 py-12 text-center text-[12px] text-slate-400"
            >
              <Loader2 className="w-4 h-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
              Loading photos…
            </div>
          ) : state === 'error' ? (
            <div data-testid="photos-error" role="alert" className="mx-auto max-w-md rounded-xl border border-rose-500/30 bg-rose-500/10 p-5 text-center">
              <p className="text-[13px] font-medium text-rose-100">Could not load photos.</p>
              {error && <p className="mt-1 text-[11px] text-rose-300/80">{error}</p>}
              <button onClick={() => void refresh()}
                className="mt-3 rounded bg-rose-500/20 px-3 py-1.5 text-[12px] text-rose-100 hover:bg-rose-500/30">
                Retry
              </button>
            </div>
          ) : rows.length === 0 ? (
            <p data-testid="photos-empty" className="py-12 text-center text-[12px] text-slate-500">
              {tab === 'mine' ? 'No photos yet. Press P in the world to open Photo Mode.' : 'No public photos in this world yet.'}
            </p>
          ) : (
            <ul data-testid="photos-list" className="grid grid-cols-1 gap-3 animate-in fade-in duration-200 motion-reduce:animate-none sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {rows.map((p) => (
                <li key={p.id} className="rounded-2xl border border-white/10 bg-[#111] p-3">
                  <button
                    type="button"
                    onClick={() => setLightboxId(p.id)}
                    aria-label={`View photo ${p.caption || 'Untitled'}`}
                    className="mb-2 block aspect-video w-full overflow-hidden rounded-lg bg-black/40 transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-400"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`/api/photos/${p.id}/image`}
                      alt={p.caption || 'Untitled photo'}
                      loading="lazy"
                      className="h-full w-full object-cover"
                      onError={(e) => {
                        // Honest degrade — hide the broken-image icon rather
                        // than fabricate a placeholder thumbnail; the caption
                        // text below still identifies the entry.
                        (e.currentTarget as HTMLImageElement).style.display = 'none';
                      }}
                    />
                  </button>
                  <h3 className="truncate text-[12px] font-medium text-zinc-100">{p.caption || 'Untitled'}</h3>
                  <p className="mt-0.5 text-[10px] text-slate-500">
                    {p.world_id && `${p.world_id} · `}{timeAgo(p.taken_at)}
                  </p>
                  {tab === 'mine' && (
                    <div className="mt-2 flex gap-1">
                      {!p.dtu_id && (
                        <button onClick={() => void share(p.id)}
                          aria-label={`Share photo ${p.caption || 'Untitled'}`}
                          className="flex-1 rounded bg-emerald-500/20 px-2 py-1 text-[11px] text-emerald-100 hover:bg-emerald-500/30">
                          <Share2 className="inline h-3 w-3 mr-1" aria-hidden="true" /> Share
                        </button>
                      )}
                      <button onClick={() => void remove(p.id)}
                        className="rounded bg-rose-500/20 px-2 py-1 text-[11px] text-rose-200 hover:bg-rose-500/30"
                        aria-label={`Delete photo ${p.caption || 'Untitled'}`}
                      >
                        <Trash2 className="h-3 w-3" aria-hidden="true" />
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

        <CrossLensRecentsPanel lensId="photos" sinceDays={7} limit={6} hideWhenEmpty className="mt-8" />

        <button
          type="button"
          onClick={openImport}
          disabled={importing}
          title="Import photos (I)"
          className="fixed bottom-8 right-8 z-30 inline-flex items-center gap-2 rounded-full bg-teal-400 px-6 py-3.5 text-[15px] font-medium text-black shadow-[0_8px_32px_rgba(45,212,191,0.25)] transition-colors hover:bg-teal-300 disabled:opacity-60"
        >
          {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          {importing ? 'Importing…' : 'Import'}
        </button>
      </div>
      <PhotoLightboxModal photoId={lightboxId} onClose={() => setLightboxId(null)} />
    </LensShell>
  );
}
