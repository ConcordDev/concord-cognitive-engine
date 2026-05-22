'use client';

/**
 * /admin/endpoints — full HTTP route inventory.
 *
 * Companion to /admin/wires.  Where /admin/wires only shows live_*
 * external-API macros, this page enumerates every HTTP route the
 * backend declares — ~2,400 endpoints across server.js + routes/*.js
 * — with auth posture and a one-click Test button.
 *
 * Auth posture per row (derived from real source, not declared):
 *   - public:   GET path matches publicReadPaths or _safeReadPaths
 *   - required: requireAuth() / requireRole() appears on the
 *               registration line
 *   - gated:    we couldn't statically prove either; treat as
 *               middleware-protected.  Test button is the ground truth.
 *
 * The Test button:
 *   - GET / HEAD: fires immediately, shows status + latency
 *   - POST / PUT / PATCH / DELETE: confirms ("Sends a real request")
 *     before firing
 *
 * No fake data — every row is a real route registration; every Test
 * result is whatever the live server returns.
 */

import { useMemo, useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import {
  Loader2, RefreshCw, Search, ChevronDown, ChevronRight, AlertTriangle, CheckCircle2, ShieldCheck, ShieldAlert, Eye,
} from 'lucide-react';
import Link from 'next/link';

interface EndpointRow {
  method: string;
  path: string;
  file: string;
  line: number;
  auth: 'public' | 'required' | 'gated';
  mountPrefixDetected?: boolean;
}

interface InventoryResponse {
  ok: boolean;
  endpoints?: EndpointRow[];
  counters?: {
    total: number;
    public: number;
    required: number;
    gated: number;
    byMethod: Record<string, number>;
  };
  generatedAt?: number;
  error?: string;
}

type TestState = {
  status: 'idle' | 'running' | 'ok' | 'fail';
  httpStatus?: number;
  reason?: string;
  durationMs?: number;
};

function baseGroupOf(p: string): string {
  // Group by the first two non-:param segments of the path.
  const parts = p.split('/').filter(Boolean);
  const meaningful: string[] = [];
  for (const part of parts) {
    if (part.startsWith(':')) break;
    meaningful.push(part);
    if (meaningful.length >= 2) break;
  }
  return '/' + meaningful.join('/');
}

function authBadge(auth: EndpointRow['auth']) {
  if (auth === 'public') {
    return <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-emerald-500/10 text-emerald-300 border border-emerald-500/30"><Eye className="w-3 h-3" /> public</span>;
  }
  if (auth === 'required') {
    return <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-rose-500/10 text-rose-300 border border-rose-500/30"><ShieldCheck className="w-3 h-3" /> required</span>;
  }
  return <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-amber-500/10 text-amber-300 border border-amber-500/30"><ShieldAlert className="w-3 h-3" /> gated</span>;
}

function methodTone(m: string) {
  switch (m) {
    case 'GET': return 'bg-sky-500/15 text-sky-300 border-sky-500/30';
    case 'POST': return 'bg-violet-500/15 text-violet-300 border-violet-500/30';
    case 'PUT': return 'bg-amber-500/15 text-amber-300 border-amber-500/30';
    case 'PATCH': return 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30';
    case 'DELETE': return 'bg-rose-500/15 text-rose-300 border-rose-500/30';
    default: return 'bg-zinc-700/40 text-zinc-300 border-zinc-700';
  }
}

export default function AdminEndpointsPage() {
  const { data, isLoading, refetch, isFetching } = useQuery<InventoryResponse>({
    queryKey: ['admin-endpoints-inventory'],
    queryFn: async () => {
      const r = await api.get<InventoryResponse>('/api/admin/endpoints');
      return r?.data || { ok: false, error: 'no_data' };
    },
    staleTime: 60_000,
  });

  const endpoints = useMemo(() => data?.endpoints ?? [], [data]);
  const counters = data?.counters;

  const [search, setSearch] = useState('');
  const [methodFilter, setMethodFilter] = useState<string>('all');
  const [authFilter, setAuthFilter] = useState<string>('all');
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  const [tests, setTests] = useState<Record<string, TestState>>({});

  const grouped = useMemo(() => {
    const filtered = endpoints.filter(e => {
      if (methodFilter !== 'all' && e.method !== methodFilter) return false;
      if (authFilter !== 'all' && e.auth !== authFilter) return false;
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        if (!e.path.toLowerCase().includes(q) && !e.file.toLowerCase().includes(q)) return false;
      }
      return true;
    });
    const groups = new Map<string, EndpointRow[]>();
    for (const e of filtered) {
      const g = baseGroupOf(e.path);
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g)!.push(e);
    }
    return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [endpoints, search, methodFilter, authFilter]);

  const toggleGroup = useCallback((g: string) => {
    setOpenGroups(prev => {
      const next = new Set(prev);
      if (next.has(g)) next.delete(g); else next.add(g);
      return next;
    });
  }, []);

  const keyFor = (e: EndpointRow) => `${e.method} ${e.path}`;

  const runTest = useCallback(async (e: EndpointRow) => {
    const isMutator = e.method !== 'GET' && e.method !== 'HEAD' && e.method !== 'OPTIONS';
    if (isMutator) {
      const ok = window.confirm(`Sends a REAL ${e.method} to:\n${e.path}\n\nProceed?`);
      if (!ok) return;
    }
    // Replace `:param` with placeholder
    const liveUrl = e.path.replace(/:([a-zA-Z0-9_]+)/g, 'test');
    const k = keyFor(e);
    setTests(prev => ({ ...prev, [k]: { status: 'running' } }));
    const t0 = performance.now();
    try {
      const headers: HeadersInit = { 'Accept': 'application/json' };
      // For mutators, send empty JSON body so the server doesn't choke on
      // missing content-type.
      const init: RequestInit = {
        method: e.method,
        credentials: 'include',
        headers: isMutator ? { ...headers, 'Content-Type': 'application/json' } : headers,
        body: isMutator ? '{}' : undefined,
      };
      const resp = await fetch(liveUrl, init);
      const durationMs = Math.round(performance.now() - t0);
      let reason: string | undefined;
      // Best-effort: parse JSON for the error key
      try {
        const txt = await resp.text();
        const j = txt && txt.startsWith('{') ? JSON.parse(txt) : null;
        reason = j?.error || (j?.ok === false ? 'not_ok' : undefined);
      } catch { /* ignore */ }
      setTests(prev => ({
        ...prev,
        [k]: {
          status: resp.ok ? 'ok' : 'fail',
          httpStatus: resp.status,
          durationMs,
          reason,
        },
      }));
    } catch (err) {
      const durationMs = Math.round(performance.now() - t0);
      setTests(prev => ({
        ...prev,
        [k]: { status: 'fail', reason: (err instanceof Error ? err.message : null) || 'network_error', durationMs },
      }));
    }
  }, []);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-indigo-400" />
      </div>
    );
  }

  if (!data?.ok) {
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-100 p-6">
        <div className="max-w-2xl mx-auto bg-rose-500/10 border border-rose-500/30 rounded p-4 text-rose-300">
          <div className="flex items-center gap-2 mb-2"><AlertTriangle className="w-4 h-4" /> Inventory unavailable</div>
          <div className="text-sm">{data?.error || 'unknown'}</div>
          <div className="text-xs mt-2 text-rose-300/70">
            This page requires the <code className="bg-zinc-900 px-1 rounded">admin</code> or{' '}
            <code className="bg-zinc-900 px-1 rounded">sovereign</code> role.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="max-w-7xl mx-auto p-6 space-y-4">
        <header className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold">Endpoint inventory</h1>
            <p className="text-sm text-zinc-400">
              Every HTTP route the backend declares. Auth posture is derived from real source.{' '}
              <Link href="/admin/wires" className="text-indigo-400 hover:underline">/admin/wires</Link> for live_* macros only.
            </p>
          </div>
          <button
            type="button"
            onClick={() => refetch()}
            disabled={isFetching}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded bg-indigo-600/70 hover:bg-indigo-600 text-white text-sm disabled:opacity-60"
          >
            {isFetching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Refresh
          </button>
        </header>

        {counters && (
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
            <Counter label="Total" value={counters.total} />
            <Counter label="Public" value={counters.public} tone="emerald" />
            <Counter label="Required" value={counters.required} tone="rose" />
            <Counter label="Gated" value={counters.gated} tone="amber" />
            {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map(m => (
              counters.byMethod[m] ? <Counter key={m} label={m} value={counters.byMethod[m]} /> : null
            ))}
          </div>
        )}

        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[240px]">
            <Search className="w-4 h-4 absolute left-2 top-1/2 -translate-y-1/2 text-zinc-500" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter path or file…"
              className="w-full pl-8 pr-3 py-1.5 rounded bg-zinc-900 border border-zinc-800 text-sm focus:border-indigo-500 outline-none"
            />
          </div>
          <select
            value={methodFilter}
            onChange={(e) => setMethodFilter(e.target.value)}
            className="px-2 py-1.5 rounded bg-zinc-900 border border-zinc-800 text-sm"
          >
            <option value="all">All methods</option>
            {['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'].map(m => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
          <select
            value={authFilter}
            onChange={(e) => setAuthFilter(e.target.value)}
            className="px-2 py-1.5 rounded bg-zinc-900 border border-zinc-800 text-sm"
          >
            <option value="all">All auth</option>
            <option value="public">Public</option>
            <option value="required">Required</option>
            <option value="gated">Gated</option>
          </select>
        </div>

        <div className="space-y-1">
          {grouped.map(([group, rows]) => {
            const open = openGroups.has(group);
            return (
              <div key={group} className="border border-zinc-800 rounded">
                <button
                  type="button"
                  onClick={() => toggleGroup(group)}
                  className="w-full flex items-center justify-between px-3 py-2 hover:bg-zinc-900 text-left"
                >
                  <span className="flex items-center gap-2">
                    {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                    <span className="font-mono text-sm text-zinc-200">{group}</span>
                    <span className="text-xs text-zinc-500">{rows.length} route{rows.length === 1 ? '' : 's'}</span>
                  </span>
                </button>
                {open && (
                  <ul className="divide-y divide-zinc-800/70">
                    {rows.map((e, idx) => {
                      const k = keyFor(e) + ':' + idx;
                      const t = tests[keyFor(e)];
                      return (
                        <li key={k} className="px-3 py-2 grid grid-cols-[80px_1fr_auto] gap-2 items-center text-sm">
                          <span className={cn('inline-block px-1.5 py-0.5 rounded text-[10px] font-mono border text-center', methodTone(e.method))}>
                            {e.method}
                          </span>
                          <div className="min-w-0">
                            <div className="font-mono text-zinc-100 truncate">{e.path}</div>
                            <div className="text-[10px] text-zinc-500 flex items-center gap-2 flex-wrap">
                              {authBadge(e.auth)}
                              <span className="font-mono">{e.file}:{e.line}</span>
                              {e.mountPrefixDetected === false && e.file.startsWith('routes/') && (
                                <span className="text-amber-400/80">prefix-undetected</span>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            {t?.status === 'ok' && (
                              <span className="text-[10px] text-emerald-300 inline-flex items-center gap-1">
                                <CheckCircle2 className="w-3 h-3" /> {t.httpStatus} · {t.durationMs}ms
                              </span>
                            )}
                            {t?.status === 'fail' && (
                              <span className="text-[10px] text-rose-300 inline-flex items-center gap-1" title={t.reason || ''}>
                                <AlertTriangle className="w-3 h-3" /> {t.httpStatus || 'err'} · {t.durationMs}ms
                              </span>
                            )}
                            <button
                              type="button"
                              onClick={() => runTest(e)}
                              disabled={t?.status === 'running'}
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-zinc-700 hover:border-indigo-500 hover:text-indigo-300 text-[11px]"
                            >
                              {t?.status === 'running' ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                              Test
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            );
          })}
          {grouped.length === 0 && (
            <div className="text-sm text-zinc-500 py-12 text-center">No endpoints match your filter.</div>
          )}
        </div>
      </div>
    </div>
  );
}

function Counter({ label, value, tone }: { label: string; value: number; tone?: 'emerald' | 'rose' | 'amber' }) {
  const toneCls =
    tone === 'emerald' ? 'border-emerald-500/30 text-emerald-300' :
    tone === 'rose' ? 'border-rose-500/30 text-rose-300' :
    tone === 'amber' ? 'border-amber-500/30 text-amber-300' :
    'border-zinc-800 text-zinc-200';
  return (
    <div className={cn('rounded border bg-zinc-900/50 px-3 py-2', toneCls)}>
      <div className="text-[10px] uppercase tracking-wide text-zinc-500">{label}</div>
      <div className="text-xl font-semibold">{value.toLocaleString()}</div>
    </div>
  );
}
