'use client';

import { useCallback, useEffect, useState } from 'react';
import { HardDrive, RefreshCw, Loader2, Lock } from 'lucide-react';

interface QuotaState {
  supported: boolean;
  usage: number;
  quota: number;
  persisted: boolean | null;
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/**
 * Real browser-quota surface — reads `navigator.storage.estimate()` (the same
 * API a Dexie/PWA app uses to know how much room it has left) and lets the
 * user request persistent storage so the browser won't evict the offline DB
 * under disk pressure.
 */
export function StorageQuotaPanel() {
  const [state, setState] = useState<QuotaState>({
    supported: false,
    usage: 0,
    quota: 0,
    persisted: null,
  });
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (typeof navigator === 'undefined' || !navigator.storage?.estimate) {
      setState({ supported: false, usage: 0, quota: 0, persisted: null });
      return;
    }
    setBusy(true);
    try {
      const est = await navigator.storage.estimate();
      let persisted: boolean | null = null;
      if (navigator.storage.persisted) {
        persisted = await navigator.storage.persisted();
      }
      setState({
        supported: true,
        usage: est.usage ?? 0,
        quota: est.quota ?? 0,
        persisted,
      });
    } catch {
      setState({ supported: false, usage: 0, quota: 0, persisted: null });
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const requestPersist = useCallback(async () => {
    if (typeof navigator === 'undefined' || !navigator.storage?.persist) return;
    setBusy(true);
    try {
      await navigator.storage.persist();
      await refresh();
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  const pct = state.quota > 0 ? Math.min((state.usage / state.quota) * 100, 100) : 0;

  return (
    <div className="space-y-3">
      <header className="flex items-center justify-between border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2">
          <HardDrive className="h-5 w-5 text-cyan-300" />
          <div>
            <h2 className="text-sm font-semibold text-white">Browser storage quota</h2>
            <p className="text-[11px] text-zinc-400">
              {state.supported
                ? 'navigator.storage.estimate() — real device allocation'
                : 'StorageManager API not available in this browser'}
            </p>
          </div>
        </div>
        <button
          onClick={refresh}
          disabled={busy}
          className="rounded border border-zinc-700 p-1.5 text-zinc-400 hover:text-white disabled:opacity-50"
          aria-label="Refresh storage estimate"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
        </button>
      </header>

      {state.supported ? (
        <>
          <div className="rounded border border-zinc-800 bg-zinc-950 p-3">
            <div className="mb-1.5 flex items-center justify-between text-[11px]">
              <span className="text-zinc-400">Used by this origin</span>
              <span className="font-mono text-zinc-200">
                {fmtBytes(state.usage)} / {fmtBytes(state.quota)} ({pct.toFixed(2)}%)
              </span>
            </div>
            <div className="h-3 w-full overflow-hidden rounded-full bg-zinc-800">
              <div
                className={`h-full rounded-full ${
                  pct > 85
                    ? 'bg-gradient-to-r from-amber-500 to-rose-500'
                    : 'bg-gradient-to-r from-cyan-500/70 to-emerald-500/70'
                }`}
                style={{ width: `${Math.max(pct, 1)}%` }}
              />
            </div>
            <div className="mt-1 flex justify-between text-[10px] text-zinc-400">
              <span>0</span>
              <span>{fmtBytes(state.quota)} quota</span>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-2">
              <div className="text-[10px] uppercase tracking-wider text-zinc-400">Used</div>
              <div className="mt-0.5 font-mono text-sm text-zinc-200">{fmtBytes(state.usage)}</div>
            </div>
            <div className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-2">
              <div className="text-[10px] uppercase tracking-wider text-zinc-400">Free</div>
              <div className="mt-0.5 font-mono text-sm text-zinc-200">
                {fmtBytes(Math.max(state.quota - state.usage, 0))}
              </div>
            </div>
            <div className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-2">
              <div className="text-[10px] uppercase tracking-wider text-zinc-400">Persistent</div>
              <div
                className={`mt-0.5 font-mono text-sm ${
                  state.persisted ? 'text-emerald-400' : 'text-zinc-400'
                }`}
              >
                {state.persisted === null ? 'n/a' : state.persisted ? 'Yes' : 'No'}
              </div>
            </div>
          </div>

          {state.persisted === false && (
            <button
              onClick={requestPersist}
              disabled={busy}
              className="flex items-center gap-1.5 rounded bg-cyan-500/15 px-3 py-1.5 text-xs text-cyan-300 hover:bg-cyan-500/25 disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Lock className="h-3.5 w-3.5" />}
              Request persistent storage
            </button>
          )}
        </>
      ) : (
        <p className="rounded border border-zinc-800 bg-zinc-950 px-3 py-4 text-center text-[11px] text-zinc-400">
          This browser does not expose the StorageManager API. The offline DB
          still works, but quota cannot be measured here.
        </p>
      )}
    </div>
  );
}
