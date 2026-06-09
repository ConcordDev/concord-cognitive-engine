'use client';

/**
 * /admin/wires — REAL wires dashboard.
 *
 * Single page that catalogs every live_* external-API wire across the
 * platform with one-click test buttons.  The user can verify at a
 * glance which REAL_FREE wires are reachable from their environment
 * and which are blocked / down.
 *
 * Sources of truth (rendered live):
 *   - GET /api/lens-actions/<domain> for every lens that registers
 *     live_* macros — discovered automatically, no static list to
 *     maintain.
 *
 * Per row:
 *   - lens domain badge
 *   - macro name
 *   - tier chip (REAL_FREE / REAL_LIVE / SIM_GRADE_A / DEMO)
 *   - test button → fires the macro with minimal sensible defaults
 *     and renders the result envelope inline (ok / error / latency)
 */

import { useEffect, useMemo, useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import {
  Zap, RefreshCw, AlertTriangle, CheckCircle2, Loader2, Globe2, Database, Search, ChevronDown, ChevronRight,
} from 'lucide-react';
import Link from 'next/link';

interface ActionMeta {
  action: string;
  desc: string | null;
  brain: string | null;
  isAi: boolean;
  isGenerative: boolean;
  isAnalysis: boolean;
  isLive: boolean;
  isCompute: boolean;
}

interface ActionsResponse {
  ok: boolean;
  domain: string;
  total: number;
  actions: ActionMeta[];
}

interface WireRow {
  domain: string;
  action: string;
  desc: string | null;
}

interface TestResult {
  status: 'idle' | 'running' | 'ok' | 'fail';
  envelope?: unknown;
  reason?: string;
  durationMs?: number;
}

// Candidate input shapes per macro name. Most of my registered live_*
// macros accept default-friendly inputs and tolerate empty calls. A
// few benefit from sample inputs so the test produces useful output.
const SAMPLE_INPUTS: Record<string, Record<string, unknown>> = {
  live_pubmed: { query: 'CRISPR', limit: 3 },
  live_pubmed_neuro: { query: 'neuroplasticity', limit: 3 },
  live_pubchem: { query: 'caffeine' },
  live_openlibrary: { query: 'godel escher bach', limit: 3 },
  live_crossref: { query: 'attention is all you need', limit: 3 },
  live_openalex: { query: 'reinforcement learning', limit: 3 },
  live_wiki_search: { query: 'plate tectonics', limit: 3 },
  live_wiki_summary: { title: 'Plate tectonics' },
  live_wiki_otd: {},
  live_datamuse: { word: 'love', kind: 'rhymes' },
  live_dictionary: { word: 'serendipity' },
  live_countries: { query: 'Japan' },
  live_gbif: { query: 'Quercus robur', limit: 5 },
  live_medlineplus: { query: 'sleep' },
  live_itunes_search: { query: 'this american life' },
  live_quote: { limit: 1 },
  live_poetrydb: { kind: 'title' },
  live_trivia: { amount: 3 },
  live_catfact: { count: 3 },
  live_dog: { count: 3 },
  live_iss_pass: { latitude: 40.7128, longitude: -74.006, count: 3 },
  live_zippopotam: { country: 'us', postalCode: '10001' },
  live_worldbank: { country: 'US', indicator: 'NY.GDP.MKTP.CD' },
  live_breweries: { city: 'San Diego' },
  live_quakes_today: {},
  live_tides: { station: '8443970' },
  live_geocode: { query: 'San Francisco' },
  live_apod: {},
  live_iss: {},
  live_neo: {},
  live_arxiv: { limit: 3 },
  live_food_search: { query: 'oatmeal', limit: 3 },
  live_met_search: { query: 'Van Gogh', limit: 3 },
  live_label_lookup: { query: 'aspirin', limit: 3 },
  live_adverse_events: { query: 'aspirin', limit: 3 },
  live_recalls: { limit: 3 },
  live_spaceflight_news: { limit: 3 },
  live_launches_upcoming: { limit: 3 },
};

// Lenses I know register live_* — drives the parallel discovery fetches.
const KNOWN_LIVE_DOMAINS = [
  'astronomy', 'space', 'history', 'geology', 'ocean', 'pharmacy',
  'cooking', 'food', 'art', 'gallery', 'paper', 'education', 'research',
  'bio', 'chem', 'neuro', 'physics', 'quantum', 'robotics', 'math', 'ml',
  'global', 'finance', 'pets', 'podcast', 'environment', 'forestry',
  'agriculture', 'linguistics', 'creative-writing', 'poetry', 'mental-health',
  'philosophy', 'desert', 'daily', 'reflection', 'retail', 'logistics',
  'travel', 'game', 'atlas',
];

function tierLabel(action: string): { label: string; tint: string } {
  if (action.startsWith('live_')) return { label: 'REAL_FREE', tint: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/30' };
  return { label: 'COMPUTE', tint: 'text-cyan-300 bg-cyan-500/10 border-cyan-500/30' };
}

export default function WiresDashboard() {
  const [results, setResults] = useState<Map<string, TestResult>>(new Map());
  const [filter, setFilter] = useState('');
  const [running, setRunning] = useState<string | null>(null);
  const [autoRunStarted, setAutoRunStarted] = useState(false);

  // Parallel discovery across all known live domains.
  const discoveryQueries = useQuery({
    queryKey: ['wires-discovery', KNOWN_LIVE_DOMAINS.join(',')],
    queryFn: async () => {
      const results = await Promise.all(
        KNOWN_LIVE_DOMAINS.map(async (domain) => {
          try {
            const r = await api.get<ActionsResponse>(`/api/lens-actions/${domain}`);
            return r?.data || null;
          } catch {
            return null;
          }
        }),
      );
      return results.filter(Boolean) as ActionsResponse[];
    },
    staleTime: 5 * 60 * 1000,
  });

  // Flatten + filter to live_* only.
  const wires: WireRow[] = useMemo(() => {
    const all: WireRow[] = [];
    for (const resp of discoveryQueries.data || []) {
      for (const a of resp.actions) {
        if (a.isLive) {
          all.push({ domain: resp.domain, action: a.action, desc: a.desc });
        }
      }
    }
    return all.sort((a, b) => a.domain.localeCompare(b.domain) || a.action.localeCompare(b.action));
  }, [discoveryQueries.data]);

  const filtered = useMemo(() => {
    if (!filter.trim()) return wires;
    const q = filter.toLowerCase();
    return wires.filter(w => w.domain.toLowerCase().includes(q) || w.action.toLowerCase().includes(q));
  }, [wires, filter]);

  const runOne = useCallback(async (row: WireRow) => {
    const key = `${row.domain}.${row.action}`;
    setRunning(key);
    setResults(prev => new Map(prev).set(key, { status: 'running' }));
    const start = Date.now();
    try {
      const input = SAMPLE_INPUTS[row.action] || {};
      const r = await api.post('/api/lens/run', {
        domain: row.domain,
        name: row.action,
        input,
      });
      const env = r?.data;
      const durationMs = Date.now() - start;
      const inner = env?.result || env;
      const innerOk = inner?.ok !== false;
      setResults(prev => new Map(prev).set(key, {
        status: innerOk ? 'ok' : 'fail',
        envelope: inner,
        reason: innerOk ? undefined : inner?.reason || 'unknown_fail',
        durationMs,
      }));
    } catch (e) {
      setResults(prev => new Map(prev).set(key, {
        status: 'fail',
        reason: e instanceof Error ? e.message : String(e),
        durationMs: Date.now() - start,
      }));
    } finally {
      setRunning(null);
    }
  }, []);

  // Auto-run on first paint so the user sees green/red without clicking each one.
  useEffect(() => {
    if (autoRunStarted || filtered.length === 0) return;
    setAutoRunStarted(true);
    (async () => {
      // Stagger so we don't hit rate limits on shared upstreams.
      for (const row of filtered) {
        await runOne(row);
      }
    })();
  }, [filtered, runOne, autoRunStarted]);

  const totals = useMemo(() => {
    let ok = 0, fail = 0, idle = 0, running = 0;
    for (const r of results.values()) {
      if (r.status === 'ok') ok++;
      else if (r.status === 'fail') fail++;
      else if (r.status === 'running') running++;
      else idle++;
    }
    return { ok, fail, running, idle, total: wires.length };
  }, [results, wires.length]);

  return (
    <div className="min-h-screen bg-lattice-void text-zinc-100 p-6">
      <div className="max-w-6xl mx-auto">
        <header className="mb-6">
          <div className="flex items-center gap-3 mb-2">
            <Globe2 className="w-7 h-7 text-emerald-300" />
            <h1 className="text-2xl font-bold">REAL wires status</h1>
          </div>
          <p className="text-sm text-zinc-400">
            Every <code className="text-xs font-mono text-emerald-300">live_*</code> macro registered across the lens fleet,
            auto-discovered from <code className="text-xs font-mono text-zinc-300">/api/lens-actions/&lt;domain&gt;</code>.
            Click any row to test live; the substrate fires the macro with sensible defaults and reports the result.
          </p>
        </header>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-4">
          <Tile label="Total wires" value={totals.total} icon={Zap} tint="text-zinc-200" />
          <Tile label="OK" value={totals.ok} icon={CheckCircle2} tint="text-emerald-300" />
          <Tile label="Failed" value={totals.fail} icon={AlertTriangle} tint="text-rose-300" />
          <Tile label="Running" value={totals.running} icon={Loader2} tint="text-amber-300" />
          <Tile label="Untested" value={totals.idle} icon={Database} tint="text-zinc-400" />
        </div>

        <div className="flex items-center gap-2 mb-3">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-400" />
            <input
              type="search"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter by domain or macro…"
              className="w-full pl-7 pr-2 py-1.5 text-sm bg-zinc-900 border border-zinc-800 rounded text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-emerald-500/40"
            />
          </div>
          <button
            type="button"
            onClick={() => { setResults(new Map()); setAutoRunStarted(false); }}
            className="text-xs px-2.5 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-100 border border-zinc-700 flex items-center gap-1"
          >
            <RefreshCw className="w-3 h-3" /> Re-test all
          </button>
        </div>

        {discoveryQueries.isLoading && (
          <div className="text-sm text-zinc-400 italic">Discovering wires...</div>
        )}

        {!discoveryQueries.isLoading && wires.length === 0 && (
          <div className="rounded border border-zinc-800 bg-zinc-950/60 p-6 text-sm text-zinc-400 italic text-center">
            No live wires discovered. The backend may not be reachable or no live_* macros are registered for the known lens set.
          </div>
        )}

        {filtered.length > 0 && (
          <ul className="space-y-1.5">
            {filtered.map(row => {
              const key = `${row.domain}.${row.action}`;
              const r = results.get(key) || { status: 'idle' as const };
              const tier = tierLabel(row.action);
              return (
                <WireRowCard
                  key={key}
                  row={row}
                  result={r}
                  isRunning={running === key}
                  tier={tier}
                  onRun={() => runOne(row)}
                />
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function Tile({ label, value, icon: Icon, tint }: { label: string; value: number; icon: typeof Zap; tint: string }) {
  return (
    <div className={cn('rounded border border-zinc-800 bg-zinc-950/60 p-3', tint)}>
      <div className="flex items-center gap-2">
        <Icon className="w-3.5 h-3.5" />
        <div className="text-[10px] uppercase tracking-wider text-zinc-400 font-mono">{label}</div>
      </div>
      <div className="text-2xl font-bold tabular-nums mt-1">{value}</div>
    </div>
  );
}

function WireRowCard({
  row, result, isRunning, tier, onRun,
}: {
  row: WireRow;
  result: TestResult;
  isRunning: boolean;
  tier: { label: string; tint: string };
  onRun: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const statusIcon = isRunning || result.status === 'running'
    ? <Loader2 className="w-4 h-4 animate-spin text-amber-300" />
    : result.status === 'ok'
    ? <CheckCircle2 className="w-4 h-4 text-emerald-300" />
    : result.status === 'fail'
    ? <AlertTriangle className="w-4 h-4 text-rose-300" />
    : <div className="w-4 h-4 rounded-full border border-zinc-700" />;

  return (
    <li className="rounded border border-zinc-800 bg-zinc-950/60 overflow-hidden">
      <div className="flex items-center gap-3 px-3 py-2">
        {statusIcon}
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <Link href={`/lenses/${row.domain}`} className="text-sm font-medium text-zinc-100 hover:text-emerald-300">
              {row.domain}
            </Link>
            <span className="text-zinc-600">/</span>
            <span className="text-sm text-zinc-300 font-mono">{row.action}</span>
            <span className={cn('text-[10px] font-mono px-1.5 py-0.5 rounded border', tier.tint)}>{tier.label}</span>
            {result.durationMs != null && (
              <span className="text-[10px] text-zinc-400 font-mono">{result.durationMs}ms</span>
            )}
          </div>
          {result.reason && (
            <div className="text-[11px] text-rose-300/80 mt-0.5">{result.reason}</div>
          )}
        </div>
        <button
          type="button"
          onClick={() => setExpanded(v => !v)}
          disabled={!result.envelope && !result.reason}
          className="text-zinc-400 hover:text-zinc-200 disabled:opacity-30"
          aria-label={expanded ? 'Collapse' : 'Expand'}
        >
          {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </button>
        <button
          type="button"
          onClick={onRun}
          disabled={isRunning}
          className="text-xs px-2 py-1 rounded bg-emerald-800/40 hover:bg-emerald-800/60 text-emerald-100 border border-emerald-700/60 disabled:opacity-40"
        >
          {isRunning ? 'Testing…' : result.status === 'idle' ? 'Test' : 'Retest'}
        </button>
      </div>
      {expanded && result.envelope != null && (
        <div className="border-t border-zinc-800/40 bg-zinc-900/30 px-3 py-2">
          <pre className="text-[11px] text-zinc-300 bg-zinc-950/40 rounded p-2 overflow-x-auto max-h-72 whitespace-pre-wrap break-all">
            {JSON.stringify(result.envelope, null, 2)}
          </pre>
        </div>
      )}
    </li>
  );
}
