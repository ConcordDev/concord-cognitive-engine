'use client';

/**
 * PipingProvider — page-scoped pipe registry so lens panels can hand each
 * other structured outputs without leaving the page.
 *
 * Producers call `pipe.publish('collab.session', result)` whenever a macro
 * succeeds. Consumers either read on demand via `pipe.read(key)` or render a
 * `<PipeImporter>` next to an input that should be loadable from upstream.
 *
 * Keys are dot-namespaced (`<domain>.<slot>`). The provider keeps the last 16
 * publications per key with timestamps so the importer UI can show "session
 * (3s ago)" and let the user pick which version to load.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownToLine, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface PipeEntry<T = unknown> {
  key: string;
  value: T;
  publishedAt: number;
  label?: string;
  /** Optional domain hint so importers can scope (e.g. only show same-domain pipes). */
  domain?: string;
}

interface PipeApi {
  publish: <T>(key: string, value: T, opts?: { label?: string; domain?: string }) => void;
  read: <T>(key: string) => T | undefined;
  history: (key: string) => PipeEntry[];
  keys: () => string[];
  subscribe: (cb: (key: string, entry: PipeEntry) => void) => () => void;
}

const PipeCtx = createContext<PipeApi | null>(null);

const MAX_HISTORY = 16;

export function PipingProvider({ children }: { children: React.ReactNode }) {
  // Keep history in a ref to avoid forcing every consumer to re-render on each publish.
  // A bump counter triggers re-render only for components that subscribed.
  const storeRef = useRef<Map<string, PipeEntry[]>>(new Map());
  const subsRef = useRef<Set<(key: string, entry: PipeEntry) => void>>(new Set());
  const [, bump] = useState(0);

  const publish = useCallback(<T,>(key: string, value: T, opts?: { label?: string; domain?: string }) => {
    const store = storeRef.current;
    const list = store.get(key) ?? [];
    const entry: PipeEntry<T> = {
      key, value, publishedAt: Date.now(),
      label: opts?.label,
      domain: opts?.domain ?? key.split('.')[0],
    };
    const next = [entry, ...list].slice(0, MAX_HISTORY);
    store.set(key, next);
    bump((n) => (n + 1) & 0xfff);
    subsRef.current.forEach((cb) => { try { cb(key, entry as PipeEntry); } catch { /* swallow */ } });
  }, []);

  const read = useCallback(<T,>(key: string): T | undefined => {
    return storeRef.current.get(key)?.[0]?.value as T | undefined;
  }, []);

  const history = useCallback((key: string): PipeEntry[] => {
    return storeRef.current.get(key) ?? [];
  }, []);

  const keys = useCallback(() => {
    return Array.from(storeRef.current.keys());
  }, []);

  const subscribe = useCallback((cb: (key: string, entry: PipeEntry) => void) => {
    subsRef.current.add(cb);
    return () => { subsRef.current.delete(cb); };
  }, []);

  const api = useMemo<PipeApi>(() => ({ publish, read, history, keys, subscribe }), [publish, read, history, keys, subscribe]);

  return <PipeCtx.Provider value={api}>{children}</PipeCtx.Provider>;
}

export function usePipe(): PipeApi {
  const api = useContext(PipeCtx);
  if (!api) {
    // No-op fallback so panels remain usable outside a PipingProvider.
    return {
      publish: () => {},
      read: () => undefined,
      history: () => [],
      keys: () => [],
      subscribe: () => () => {},
    };
  }
  return api;
}

/**
 * Subscribe to a specific pipe key. Returns the most recent entry (or null).
 * Re-renders the host component when a new value lands on the key.
 */
export function usePipeValue<T = unknown>(key: string): PipeEntry<T> | null {
  const api = usePipe();
  const [entry, setEntry] = useState<PipeEntry<T> | null>(() => {
    const v = api.read<T>(key);
    return v === undefined ? null : { key, value: v, publishedAt: Date.now() };
  });
  useEffect(() => {
    return api.subscribe((k, e) => { if (k === key) setEntry(e as PipeEntry<T>); });
  }, [api, key]);
  return entry;
}

/**
 * PipeImporter — a small chevron menu rendered next to an input. Lists
 * available pipes matching the `accept` keys, with timestamps; selecting one
 * fires onImport with the published value.
 */
export function PipeImporter<T = unknown>({
  accept, onImport, label = 'Import', compact,
}: {
  accept: string[];
  onImport: (value: T, entry: PipeEntry<T>) => void;
  label?: string;
  compact?: boolean;
}) {
  const api = usePipe();
  const [open, setOpen] = useState(false);
  const [, bump] = useState(0);

  // Re-render when any matching pipe is published.
  useEffect(() => {
    return api.subscribe((k) => { if (accept.includes(k)) bump((n) => (n + 1) & 0xfff); });
  }, [api, accept]);

  const entries = accept.flatMap((k) => api.history(k).slice(0, 3));
  entries.sort((a, b) => b.publishedAt - a.publishedAt);

  if (entries.length === 0) return null;

  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'flex items-center gap-1 rounded border border-zinc-700 bg-zinc-900/60 text-zinc-300 hover:text-white hover:border-zinc-500',
          compact ? 'text-[9px] px-1 py-0.5' : 'text-[10px] px-1.5 py-0.5',
        )}
        title="Import from another panel"
      >
        <ArrowDownToLine className={cn(compact ? 'w-2.5 h-2.5' : 'w-3 h-3')} />
        {label}
        <ChevronDown className={cn(compact ? 'w-2.5 h-2.5' : 'w-3 h-3', 'opacity-60')} />
      </button>
      {open && (
        <div className="absolute z-30 mt-1 right-0 min-w-[14rem] rounded border border-zinc-700 bg-zinc-950 shadow-xl shadow-black/50 p-1">
          {entries.map((e, i) => {
            const age = Math.round((Date.now() - e.publishedAt) / 1000);
            const ageLabel = age < 60 ? `${age}s ago` : age < 3600 ? `${Math.round(age / 60)}m ago` : `${Math.round(age / 3600)}h ago`;
            return (
              <button
                key={`${e.key}-${i}`}
                type="button"
                onClick={() => { onImport(e.value as T, e as PipeEntry<T>); setOpen(false); }}
                className="block w-full text-left px-2 py-1 text-[10px] text-zinc-200 hover:bg-zinc-800 rounded"
              >
                <div className="font-mono text-zinc-100">{e.label ?? e.key}</div>
                <div className="text-[9px] text-zinc-500">{e.key} · {ageLabel}</div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
