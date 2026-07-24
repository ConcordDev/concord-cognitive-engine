'use client';

/**
 * PluginGalleryList — the browsable list for `GET /api/plugins/gallery`
 * (`server/lib/plugin-gallery.js#listGallery`, mounted in `server.js`).
 *
 * Real, unrelated to `/api/plugins` (the older emergent/developer-sdk loader
 * behind `components/world-lens/LensPluginSystem.tsx`). This surface is the
 * signed, browsable marketplace: publish → gallery entry → list / install /
 * rate.
 *
 * Search box is wired to the real `?q=` query param the route reads
 * (`req.query.q`) — never a client-side filter over a fixed page of results.
 *
 * Honest-empty-state invariant (matches `/lenses/world-observatory` and
 * `/lenses/concord-link-frontier`): a genuinely empty gallery, or a search
 * with zero matches, renders the fact plainly — never a fabricated row.
 * A fetch failure renders the real error text, never a silent blank list.
 */

import { useCallback, useEffect, useState } from 'react';
import { Package, Download, ThumbsUp, ThumbsDown, Search, AlertTriangle, RefreshCcw } from 'lucide-react';
import { PluginInstallConsent } from './PluginInstallConsent';
import { AuthorBadge } from './AuthorBadge';
import type { GalleryPlugin, GalleryListResponse, GalleryErrorResponse, InstallResponse, RateResponse } from './types';

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString();
  } catch {
    return iso;
  }
}

export function PluginGalleryList() {
  const [query, setQuery] = useState('');
  const [plugins, setPlugins] = useState<GalleryPlugin[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);

  const [installTarget, setInstallTarget] = useState<GalleryPlugin | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [rateError, setRateError] = useState<string | null>(null);

  const fetchGallery = useCallback(async (q: string) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set('q', q.trim());
      params.set('limit', '50');
      const res = await fetch(`/api/plugins/gallery?${params.toString()}`, { credentials: 'include' });
      const body = (await res.json().catch(() => null)) as GalleryListResponse | GalleryErrorResponse | null;
      if (!body) {
        setError(`Failed to load plugin gallery (HTTP ${res.status})`);
        setPlugins([]);
      } else if (body.ok) {
        setPlugins(body.plugins);
      } else {
        setError(body.error || 'Failed to load plugin gallery');
        setPlugins([]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPlugins([]);
    } finally {
      setLoading(false);
      setHasLoadedOnce(true);
    }
  }, []);

  useEffect(() => {
    fetchGallery(query);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    fetchGallery(query);
  }

  async function handleRate(plugin: GalleryPlugin, vote: 'up' | 'down') {
    setRateError(null);
    try {
      const res = await fetch(`/api/plugins/gallery/${encodeURIComponent(plugin.pluginId)}/rate`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vote }),
      });
      const body = (await res.json().catch(() => null)) as RateResponse | null;
      if (!body || !body.ok) {
        setRateError(body?.error || `Rating failed (HTTP ${res.status})`);
        return;
      }
      setPlugins((prev) => prev.map((p) => (p.pluginId === plugin.pluginId ? { ...p, rating: body.rating } : p)));
    } catch (e) {
      setRateError(e instanceof Error ? e.message : String(e));
    }
  }

  function handleInstalled(result: InstallResponse, plugin: GalleryPlugin) {
    setInstallTarget(null);
    if (result.ok) {
      setToast(
        result.alreadyInstalled
          ? `${plugin.name} is already installed.`
          : `${plugin.name} installed${result.freshLoad === false ? ' (already running for other users)' : ''}.`,
      );
      // Reflect the install honestly — refetch so installs/loaded stay real,
      // never optimistically bumped client-side.
      fetchGallery(query);
    }
  }

  return (
    <div>
      <form onSubmit={handleSearchSubmit} className="mb-3 flex items-center gap-2">
        <div className="flex flex-1 items-center gap-2 rounded-md border border-zinc-800 bg-zinc-900/60 px-2.5 py-1.5">
          <Search className="h-3.5 w-3.5 text-slate-500" aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search plugins by name or description…"
            aria-label="Search plugin gallery"
            className="w-full bg-transparent text-[12px] text-slate-200 placeholder:text-slate-600 focus:outline-none"
          />
        </div>
        <button
          type="submit"
          disabled={loading}
          className="flex items-center gap-1.5 rounded-md border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5 text-[12px] font-medium text-cyan-300 hover:bg-cyan-500/20 disabled:opacity-60"
        >
          <RefreshCcw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
          Search
        </button>
      </form>

      {toast && (
        <div role="status" className="mb-3 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-[11px] text-emerald-200">
          {toast}
        </div>
      )}
      {rateError && (
        <div role="alert" className="mb-3 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-1.5 text-[11px] text-red-200">
          {rateError}
        </div>
      )}

      {error && (
        <div role="alert" className="mb-3 flex items-center gap-2 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-[11px] text-red-200">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="break-words">{error}</span>
        </div>
      )}

      {!hasLoadedOnce && loading && (
        <p role="status" aria-busy="true" className="text-[11px] text-slate-500">
          Loading plugin gallery…
        </p>
      )}

      {hasLoadedOnce && !error && plugins.length === 0 && (
        <p className="text-[11px] text-slate-500">
          {query.trim() ? `No plugins match "${query.trim()}".` : 'No plugins have been published to the gallery yet.'}
        </p>
      )}

      {plugins.length > 0 && (
        <ul className="space-y-2" aria-label="Plugin gallery" data-testid="plugin-gallery-list">
          {plugins.map((plugin) => (
            <li key={plugin.pluginId} className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Package className="h-4 w-4 text-cyan-400" aria-hidden="true" />
                    <h3 className="truncate text-[13px] font-semibold text-slate-100">{plugin.name}</h3>
                    <span className="shrink-0 rounded-full border border-zinc-700 px-1.5 py-0.5 text-[9px] font-mono text-slate-400">
                      v{plugin.version}
                    </span>
                    {plugin.loaded && (
                      <span className="shrink-0 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0.5 text-[9px] text-emerald-300">
                        running
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-[12px] text-slate-400">{plugin.description || 'No description provided.'}</p>

                  {/* Author identity — real peer reputation (reused from the
                      general reputation system) AND the self-attested
                      signing status, clearly separate signals. */}
                  <AuthorBadge
                    authorId={plugin.authorId}
                    reputation={plugin.authorReputationSummary}
                    trusted={plugin.trusted}
                    trustDescription={plugin.trustDescription}
                  />

                  {plugin.declaredCapabilities?.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {plugin.declaredCapabilities.map((cap) => (
                        <span
                          key={cap}
                          className="rounded border border-zinc-800 bg-zinc-900/60 px-1.5 py-0.5 font-mono text-[9px] text-slate-400"
                        >
                          {cap}
                        </span>
                      ))}
                    </div>
                  )}

                  <div className="mt-2 flex items-center gap-3 text-[10px] text-slate-500">
                    <span className="flex items-center gap-1">
                      <Download className="h-3 w-3" aria-hidden="true" /> {plugin.installs} install{plugin.installs === 1 ? '' : 's'}
                    </span>
                    <span>published {formatDate(plugin.publishedAt)}</span>
                  </div>
                </div>

                <div className="flex shrink-0 flex-col items-end gap-2">
                  <button
                    onClick={() => setInstallTarget(plugin)}
                    className="rounded-md bg-cyan-600 px-3 py-1.5 text-[11px] font-medium text-white hover:bg-cyan-500"
                  >
                    Install
                  </button>
                  <div className="flex items-center gap-1 text-[10px] text-slate-400">
                    <button
                      onClick={() => handleRate(plugin, 'up')}
                      aria-label={`Rate ${plugin.name} up`}
                      className="flex items-center gap-0.5 rounded px-1 py-0.5 hover:bg-zinc-900"
                    >
                      <ThumbsUp className="h-3 w-3" aria-hidden="true" /> {plugin.rating.up}
                    </button>
                    <button
                      onClick={() => handleRate(plugin, 'down')}
                      aria-label={`Rate ${plugin.name} down`}
                      className="flex items-center gap-0.5 rounded px-1 py-0.5 hover:bg-zinc-900"
                    >
                      <ThumbsDown className="h-3 w-3" aria-hidden="true" /> {plugin.rating.down}
                    </button>
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {installTarget && (
        <PluginInstallConsent
          plugin={installTarget}
          onCancel={() => setInstallTarget(null)}
          onInstalled={handleInstalled}
        />
      )}
    </div>
  );
}
