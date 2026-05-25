'use client';

import { useCallback, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Shield, ShieldCheck, ShieldX, RefreshCw, Loader2, Trash2, Layers } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface SWState {
  supported: boolean;
  registered: boolean;
  active: boolean;
  scope: string | null;
  controlling: boolean;
}

interface CacheStats {
  entries: number;
  maxEntries: number;
}

interface ManifestEntry {
  url: string;
  role: string;
  strategy: string;
}

interface RuntimeEntry {
  pattern: string;
  strategy: string;
  note: string;
}

interface SWManifest {
  cacheName: string;
  precache: ManifestEntry[];
  runtimeCaching: RuntimeEntry[];
  backgroundSyncTag: string;
  maxCacheEntries: number;
  maxCacheAgeHours: number;
}

/**
 * Workbox-style service-worker control surface. Registers /sw.js (the
 * caching + background-sync worker), reports live registration state, and
 * lets the user trim the runtime cache. The precache plan is driven by the
 * backend `offline.swManifest` macro.
 */
export function ServiceWorkerPanel() {
  const [sw, setSw] = useState<SWState>({
    supported: false, registered: false, active: false, scope: null, controlling: false,
  });
  const [cacheStats, setCacheStats] = useState<CacheStats | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const manifest = useQuery({
    queryKey: ['offline', 'sw-manifest'],
    queryFn: async () => {
      const r = await lensRun<SWManifest>('offline', 'swManifest', {});
      if (!r.data.ok || !r.data.result) throw new Error(r.data.error || 'manifest failed');
      return r.data.result;
    },
    staleTime: 5 * 60 * 1000,
  });

  const refreshState = useCallback(async () => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
      setSw({ supported: false, registered: false, active: false, scope: null, controlling: false });
      return;
    }
    const reg = await navigator.serviceWorker.getRegistration('/sw.js');
    setSw({
      supported: true,
      registered: !!reg,
      active: !!reg?.active,
      scope: reg?.scope ?? null,
      controlling: !!navigator.serviceWorker.controller,
    });
  }, []);

  const refreshCacheStats = useCallback(() => {
    if (typeof navigator === 'undefined' || !navigator.serviceWorker?.controller) {
      setCacheStats(null);
      return;
    }
    const channel = new MessageChannel();
    const handler = (ev: MessageEvent) => {
      if (ev.data?.type === 'CACHE_STATS') {
        setCacheStats({ entries: ev.data.entries, maxEntries: ev.data.maxEntries });
      }
    };
    navigator.serviceWorker.addEventListener('message', handler, { once: true });
    navigator.serviceWorker.controller.postMessage({ type: 'GET_CACHE_STATS' });
    // Some browsers prefer a dedicated port — send via both paths.
    channel.port1.onmessage = handler;
  }, []);

  useEffect(() => {
    refreshState();
    const onCtrl = () => refreshState();
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('controllerchange', onCtrl);
    }
    return () => {
      if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
        navigator.serviceWorker.removeEventListener('controllerchange', onCtrl);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (sw.active) refreshCacheStats();
  }, [sw.active, refreshCacheStats]);

  const register = useCallback(async () => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    setBusy('register');
    try {
      const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      await reg.update();
      await refreshState();
    } catch (e) {
      console.error('SW register failed:', e);
    } finally { setBusy(null); }
  }, [refreshState]);

  const unregister = useCallback(async () => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    setBusy('unregister');
    try {
      const reg = await navigator.serviceWorker.getRegistration('/sw.js');
      if (reg) await reg.unregister();
      await refreshState();
      setCacheStats(null);
    } catch (e) {
      console.error('SW unregister failed:', e);
    } finally { setBusy(null); }
  }, [refreshState]);

  const trimCache = useCallback(() => {
    if (typeof navigator === 'undefined' || !navigator.serviceWorker?.controller) return;
    setBusy('trim');
    navigator.serviceWorker.controller.postMessage({ type: 'TRIM_CACHE' });
    setTimeout(() => { refreshCacheStats(); setBusy(null); }, 600);
  }, [refreshCacheStats]);

  const statusIcon = !sw.supported ? <ShieldX className="h-5 w-5 text-zinc-400" />
    : sw.active ? <ShieldCheck className="h-5 w-5 text-emerald-400" />
      : <Shield className="h-5 w-5 text-amber-400" />;

  const statusLabel = !sw.supported ? 'Not supported in this browser'
    : sw.active ? 'Active — offline caching enabled'
      : sw.registered ? 'Registered — activating'
        : 'Not registered';

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2">
          {statusIcon}
          <div>
            <h2 className="text-sm font-semibold text-white">Service Worker · Workbox cache</h2>
            <p className="text-[11px] text-zinc-400">{statusLabel}</p>
          </div>
        </div>
        <button
          onClick={() => { refreshState(); refreshCacheStats(); }}
          className="rounded border border-zinc-700 p-1.5 text-zinc-400 hover:text-white"
          aria-label="Refresh service worker state"
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
      </header>

      <div className="grid grid-cols-3 gap-2">
        {[
          { label: 'Registered', on: sw.registered },
          { label: 'Controlling page', on: sw.controlling },
          { label: 'Cache active', on: sw.active },
        ].map((b) => (
          <div key={b.label} className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-2">
            <div className="text-[10px] uppercase tracking-wider text-zinc-400">{b.label}</div>
            <div className={`mt-0.5 text-sm font-semibold ${b.on ? 'text-emerald-400' : 'text-zinc-400'}`}>
              {b.on ? 'Yes' : 'No'}
            </div>
          </div>
        ))}
      </div>

      {cacheStats && (
        <div className="rounded border border-zinc-800 bg-zinc-950 p-3">
          <div className="mb-1 flex items-center justify-between text-[11px]">
            <span className="text-zinc-400">Runtime cache entries</span>
            <span className="font-mono text-zinc-200">{cacheStats.entries} / {cacheStats.maxEntries}</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-800">
            <div
              className="h-full rounded-full bg-gradient-to-r from-cyan-500/70 to-emerald-500/70"
              style={{ width: `${Math.min((cacheStats.entries / Math.max(cacheStats.maxEntries, 1)) * 100, 100)}%` }}
            />
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {!sw.registered ? (
          <button
            onClick={register}
            disabled={!sw.supported || busy === 'register'}
            className="flex items-center gap-1.5 rounded bg-emerald-500/15 px-3 py-1.5 text-xs text-emerald-300 hover:bg-emerald-500/25 disabled:opacity-50"
          >
            {busy === 'register' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}
            Enable offline mode
          </button>
        ) : (
          <button
            onClick={unregister}
            disabled={busy === 'unregister'}
            className="flex items-center gap-1.5 rounded bg-red-500/15 px-3 py-1.5 text-xs text-red-300 hover:bg-red-500/25 disabled:opacity-50"
          >
            {busy === 'unregister' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldX className="h-3.5 w-3.5" />}
            Disable offline mode
          </button>
        )}
        <button
          onClick={trimCache}
          disabled={!sw.active || busy === 'trim'}
          className="flex items-center gap-1.5 rounded border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:text-white disabled:opacity-50"
        >
          {busy === 'trim' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
          Trim stale cache
        </button>
      </div>

      {manifest.data && (
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
            <Layers className="h-3.5 w-3.5" /> Precache manifest · {manifest.data.cacheName}
          </div>
          <div className="space-y-1">
            {manifest.data.precache.map((e) => (
              <div key={e.url} className="flex items-center justify-between rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-[11px]">
                <span className="font-mono text-zinc-200">{e.url}</span>
                <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[9px] text-cyan-300">{e.strategy}</span>
              </div>
            ))}
          </div>
          <div className="space-y-1">
            {manifest.data.runtimeCaching.map((e) => (
              <div key={e.pattern} className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-[11px]">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-zinc-300">{e.pattern}</span>
                  <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[9px] text-emerald-300">{e.strategy}</span>
                </div>
                <p className="mt-0.5 text-[10px] text-zinc-400">{e.note}</p>
              </div>
            ))}
          </div>
        </div>
      )}
      {manifest.isError && (
        <p className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-[11px] text-red-300">
          Could not load precache manifest.
        </p>
      )}
    </div>
  );
}
