'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Box, Loader2, Search, ExternalLink, Heart, Eye, ChevronRight } from 'lucide-react';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';
import { StickyDeleteConfirm } from '@/components/common/StickyDeleteConfirm';
import { apiHelpers } from '@/lib/api/client';
import { publicLookup, lookupMeta } from '@/lib/public-lookup';

interface SavedDtuRow {
  id: string;
  title?: string;
  tags?: string[];
  timestamp?: string;
  createdAt?: string;
}

/**
 * FIX-ar-016 — the caller's own Sketchfab saves, as library rows in the
 * lens. A Sketchfab "Save as DTU" minted a normal DTU (tagged
 * 'sketchfab') that no surface listed afterwards: the button forgot
 * the id on reload and the save had no row the caller could open or
 * delete. This lists the caller's DTUs carrying the sketchfab tag
 * (scope=mine), opens one in place (full content via dtus.get), and
 * deletes it behind the two-step confirm (dtus.delete). The platform
 * Global Library search leg is a separate, desk-priced item.
 */
function SavedSketchfabDtus() {
  const queryClient = useQueryClient();
  const [openId, setOpenId] = useState<string | null>(null);
  const [openContent, setOpenContent] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  const saved = useQuery({
    queryKey: ['dtus-mine', 'sketchfab'],
    queryFn: async () => {
      const res = await apiHelpers.dtus.paginated({ scope: 'mine', tags: 'sketchfab', limit: 100, offset: 0 });
      const data = (res as { data?: { dtus?: SavedDtuRow[]; items?: SavedDtuRow[] } })?.data;
      const rows = data?.dtus || data?.items || [];
      return rows.filter((d) => (d.tags || []).includes('sketchfab'));
    },
  });
  const rows = saved.data || [];
  if (rows.length === 0) return null;

  const toggleOpen = async (row: SavedDtuRow) => {
    setRowError(null);
    if (openId === row.id) { setOpenId(null); setOpenContent(null); return; }
    setOpenId(row.id);
    setOpenContent(null);
    try {
      const res = await apiHelpers.dtus.get(row.id) as { data?: { content?: string; summary?: string; dtu?: { content?: string; summary?: string } } };
      const dtu = res?.data?.dtu || res?.data;
      setOpenContent(dtu?.content || dtu?.summary || '(no content stored)');
    } catch {
      setRowError('Could not open that DTU.');
    }
  };

  const remove = async (row: SavedDtuRow) => {
    setRowError(null);
    try {
      const resp = await apiHelpers.dtus.delete(row.id) as { data?: { ok?: boolean; error?: string } };
      if (resp?.data && resp.data.ok === false) throw new Error(resp.data.error || 'delete failed');
      if (openId === row.id) { setOpenId(null); setOpenContent(null); }
      await queryClient.invalidateQueries({ queryKey: ['dtus-mine'] });
    } catch {
      setRowError('Could not delete that DTU.');
    }
  };

  return (
    <div className="space-y-2 border-t border-cyan-500/15 pt-3">
      <h3 className="text-xs font-semibold text-white">Your saved Sketchfab DTUs</h3>
      {rowError && <p role="alert" className="text-[11px] text-rose-300">{rowError}</p>}
      <ul className="space-y-1.5">
        {rows.map((row) => (
          <li key={row.id} className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-2">
            <div className="flex items-center gap-2">
              <button onClick={() => void toggleOpen(row)} aria-expanded={openId === row.id}
                aria-label={`Open ${row.title || row.id}`}
                className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-[12px] text-zinc-100 hover:text-cyan-300">
                <ChevronRight className={`h-3 w-3 shrink-0 text-zinc-500 transition-transform ${openId === row.id ? 'rotate-90' : ''}`} />
                <span className="truncate">{row.title || row.id}</span>
              </button>
              {(row.timestamp || row.createdAt) && (
                <span className="shrink-0 text-[10px] text-zinc-500">{new Date(row.timestamp || row.createdAt || '').toLocaleDateString()}</span>
              )}
              <StickyDeleteConfirm
                onConfirm={() => void remove(row)}
                armLabel={<span className="text-[10px]">Delete</span>}
                confirmLabel="Delete DTU?"
                armAriaLabel={`Delete ${row.title || row.id}`}
                confirmAriaLabel="Confirm delete"
                cancelAriaLabel="Cancel delete"
              />
            </div>
            {openId === row.id && (
              <div className="mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap rounded bg-black/40 p-2 text-[11px] text-zinc-300">
                {openContent === null ? 'Loading…' : openContent}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

interface SfModel {
  uid: string;
  name: string;
  description?: string;
  thumbnails?: { images?: { url: string; width: number; height: number }[] };
  viewerUrl: string;
  embedUrl: string;
  user: { username: string; displayName: string };
  likeCount: number;
  viewCount: number;
  vertexCount: number;
  faceCount: number;
  isDownloadable: boolean;
  staffpickedAt?: string;
  categories?: { name: string; slug: string }[];
  tags?: { name: string; slug: string }[];
}

export function SketchfabModels() {
  const [query, setQuery] = useState('');
  const [downloadable, setDownloadable] = useState(true);
  const [hits, setHits] = useState<SfModel[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [noticeData, setNoticeData] = useState<unknown>(null);

  const load = useMutation({
    mutationFn: async () => {
      setError(null);
      try {
        const j = await publicLookup<{ results?: SfModel[] }>('sketchfab-search', { q: query.trim(), downloadable });
        setHits((j.results || []) as SfModel[]);
        setNoticeData(j);
      } catch (e) { setHits([]); setNoticeData(null); setError('Sketchfab is unavailable right now — nothing is being shown in its place.'); }
    },
  });

  const thumb = (m: SfModel) => {
    const imgs = m.thumbnails?.images || [];
    const small = imgs.find((i) => i.width >= 200 && i.width <= 400) || imgs[0];
    return small?.url;
  };

  const noticeMeta = lookupMeta(noticeData);

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2">
          <Box className="h-5 w-5 text-cyan-400" />
          <h2 className="text-sm font-semibold text-white">Sketchfab models</h2>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">Sketchfab · via Concord server</span>
        </div>
        {hits.length > 0 && (
          <SaveAsDtuButton
            compact
            apiSource="sketchfab"
            apiUrl="https://sketchfab.com/search?type=models"
            title={`Sketchfab models — "${query || 'top'}"`}
            content={hits.slice(0, 25).map((m, i) => `${i + 1}. ${m.name} by ${m.user.displayName} (${m.likeCount}♥/${m.viewCount}👁) — ${m.vertexCount.toLocaleString()}v/${m.faceCount.toLocaleString()}f ${m.isDownloadable ? '⬇' : ''}\n   ${m.viewerUrl}`).join('\n\n')}
            extraTags={['ar', 'sketchfab', '3d-models']}
            rawData={{ query, downloadable, hits }}
          />
        )}
      </header>
      <form onSubmit={(e) => { e.preventDefault(); load.mutate(); }} className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
          <input type="text" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search 3D models…" className="w-full rounded-md border border-zinc-800 bg-zinc-950 py-1.5 pl-8 pr-3 text-sm text-white" />
        </div>
        <label className="flex items-center gap-1 text-[11px] text-zinc-400">
          <input type="checkbox" checked={downloadable} onChange={(e) => setDownloadable(e.target.checked)} className="rounded border-zinc-700 bg-zinc-950" />
          Downloadable only
        </label>
        <button type="submit" disabled={load.isPending} className="inline-flex items-center gap-1.5 rounded-md border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5 text-xs text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-50">
          {load.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
          Browse
        </button>
      </form>
      {error && <div className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">{error}</div>}
      {noticeMeta?.stale && <div className="rounded border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-300">Showing cached Sketchfab data{noticeMeta.fetchedAt ? ` from ${new Date(noticeMeta.fetchedAt).toLocaleString()}` : ''} — live source unavailable.</div>}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 max-h-[520px] overflow-y-auto">
        {hits.map((m) => (
          <a key={m.uid} href={m.viewerUrl} target="_blank" rel="noopener noreferrer" className="group block rounded border border-zinc-800 bg-zinc-950 overflow-hidden hover:border-cyan-500/30">
            {thumb(m) ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={thumb(m)} alt={m.name} className="h-32 w-full object-cover" loading="lazy" />
            ) : (
              <div className="flex h-32 items-center justify-center bg-zinc-900"><Box className="h-8 w-8 text-zinc-700" /></div>
            )}
            <div className="px-2 py-1.5">
              <div className="line-clamp-1 text-[11px] text-white group-hover:text-cyan-300">{m.name}</div>
              <div className="line-clamp-1 text-[10px] text-zinc-400">{m.user.displayName}</div>
              <div className="mt-1 flex items-center justify-between font-mono text-[9px] text-zinc-400">
                <span className="flex items-center gap-1"><Heart className="h-2.5 w-2.5" />{m.likeCount}</span>
                <span className="flex items-center gap-1"><Eye className="h-2.5 w-2.5" />{m.viewCount.toLocaleString()}</span>
                {m.isDownloadable && <span className="rounded bg-emerald-500/20 px-1 text-emerald-300">⬇</span>}
                <ExternalLink className="h-2.5 w-2.5" />
              </div>
            </div>
          </a>
        ))}
        {hits.length === 0 && !load.isPending && !error && (
          <div className="col-span-full rounded border border-dashed border-zinc-800 p-6 text-center text-[11px] text-zinc-400">Search for 3D models to anchor in AR.</div>
        )}
      </div>
      <SavedSketchfabDtus />
    </div>
  );
}
