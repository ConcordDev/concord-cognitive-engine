'use client';

/**
 * AutoActionStrip — drop-in surface that auto-discovers every backend
 * action registered for a lens domain and renders a button per action.
 *
 * Phase 8 (depth-gap closer): closes the "registered but never wired
 * into UI" gap that left ~250 compute actions unreachable across the
 * trades/vertical lenses (accounting, aviation, healthcare, electrical,
 * plumbing, HVAC, masonry, welding, carpentry, landscaping, mining,
 * food, retail, logistics, etc.).
 *
 * Backed by GET /api/lens-actions/:domain (public-read). Returns the
 * union of LENS_ACTIONS (legacy registerLensAction) + MACROS
 * (canonical macro registry).
 *
 * Clicks fire useRunArtifact(domain).mutateAsync({ id, action }) and
 * display the raw result envelope below the strip. Honest empty/error
 * states; no fake data.
 *
 * Mount:
 *   <AutoActionStrip domain="aviation" artifactId={selectedFlightId} />
 *
 * Hidden categories:
 *   - "list_mine" / "recent_mine" / "list" / "get" / "create" / "update" /
 *     "delete" — standard CRUD that already has its own UI surface
 *   - actions starting with "live_" — surfaced by the per-API live panels
 *   - draft / dtu / session domain helpers (handled by their own widgets)
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import {
  Zap, Sparkles, BarChart3, Calculator, Loader2, AlertTriangle, Check,
  ChevronDown, ChevronUp, RefreshCw, Code2,
} from 'lucide-react';

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

// Names we hide because they're already exposed by other surfaces
// or are noise (social-feature CRUD on every domain).
const HIDDEN_PREFIXES = ['live_', 'recent_mine', 'list_mine'];
const HIDDEN_EXACT = new Set([
  // Generic CRUD
  'list', 'get', 'create', 'update', 'delete', 'export', 'run',
  'bulkCreate', 'paginated', 'search',
  // Social engagement (every domain gets these via a generic
  // registerLensAction sweep; they're surfaced by Like/Share/Save chips
  // on individual cards, not as actions you'd "run").
  'like', 'dislike', 'vote', 'star', 'pin', 'unpin', 'bookmark',
  'share', 'repost', 'comment', 'tag', 'assign', 'rate',
  'archive', 'duplicate', 'lock', 'unlock', 'move', 'priority',
  'status', 'publish', 'unpublish', 'save',
  // Generic AI catch-alls that UniversalActions already exposes.
  'analyze', 'generate', 'suggest',
]);

function classifyAction(a: ActionMeta): { icon: typeof Zap; tint: string } {
  if (a.isLive) return { icon: RefreshCw, tint: 'text-emerald-300 hover:bg-emerald-500/10 border-emerald-500/20' };
  if (a.isGenerative) return { icon: Sparkles, tint: 'text-violet-300 hover:bg-violet-500/10 border-violet-500/20' };
  if (a.isAnalysis) return { icon: BarChart3, tint: 'text-amber-300 hover:bg-amber-500/10 border-amber-500/20' };
  if (a.isAi) return { icon: Zap, tint: 'text-indigo-300 hover:bg-indigo-500/10 border-indigo-500/20' };
  // Pure compute
  return { icon: Calculator, tint: 'text-cyan-300 hover:bg-cyan-500/10 border-cyan-500/20' };
}

function shouldHide(a: ActionMeta): boolean {
  if (HIDDEN_EXACT.has(a.action)) return true;
  return HIDDEN_PREFIXES.some(p => a.action.startsWith(p));
}

function prettyLabel(name: string): string {
  return name
    .replace(/[-_]/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^\w/, c => c.toUpperCase());
}

export interface AutoActionStripProps {
  /** Lens domain slug (matches the backend registerLensAction("X", ...)). */
  domain: string;
  /** Optional currently-selected artifact id. Required for some actions. */
  artifactId?: string | null;
  /** Override visible-action filter (return false to hide). */
  filter?: (a: ActionMeta) => boolean;
  /** Hide entirely when zero actions registered. Default true. */
  hideWhenEmpty?: boolean;
  /** Optional title; default "Compute actions". */
  title?: string;
  /** Extra static params merged into every action call. */
  params?: Record<string, unknown>;
  className?: string;
}

export function AutoActionStrip({
  domain,
  artifactId,
  filter,
  hideWhenEmpty = true,
  title = 'Actions',
  params,
  className,
}: AutoActionStripProps) {
  const [expanded, setExpanded] = useState(false);
  const [activeAction, setActiveAction] = useState<string | null>(null);
  const [result, setResult] = useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);
  // Phase 8b: optional JSON input per action so callers can feed real
  // params (not just defaults).  Stored as raw text; parsed on submit.
  const [paramText, setParamText] = useState<string>('');
  const [paramOpen, setParamOpen] = useState<string | null>(null);

  const { data, isLoading, refetch } = useQuery<ActionsResponse | null>({
    queryKey: ['lens-actions', domain],
    queryFn: async () => {
      try {
        const r = await api.get(`/api/lens-actions/${domain}`);
        return r?.data as ActionsResponse;
      } catch {
        return null;
      }
    },
    staleTime: 5 * 60 * 1000,
    enabled: !!domain,
  });

  const runAction = useRunArtifact(domain);

  const visible = (data?.actions || [])
    .filter(a => !shouldHide(a))
    .filter(a => (filter ? filter(a) : true));

  // Group by kind for the row layout.
  const compute = visible.filter(a => a.isCompute && !a.isAnalysis);
  const analysis = visible.filter(a => a.isAnalysis);
  const generative = visible.filter(a => a.isGenerative);
  const ai = visible.filter(a => a.isAi && !a.isGenerative && !a.isAnalysis);
  const other = visible.filter(a =>
    !compute.includes(a) && !analysis.includes(a) && !generative.includes(a) && !ai.includes(a),
  );

  const onRun = async (name: string, extraInput?: Record<string, unknown>) => {
    setActiveAction(name);
    setResult(null);
    setError(null);
    try {
      const r = await runAction.mutateAsync({
        id: artifactId || `${domain}-auto-${Date.now()}`,
        action: name,
        ...(params || {}),
        ...(extraInput ? { input: extraInput, params: extraInput } : {}),
      });
      // Result shape: { ok, result: { ... } } OR { ok, ... }
      const envelope = (r as { ok: boolean; result?: unknown; error?: string } | undefined);
      if (envelope?.ok === false) {
        setError((envelope as { error?: string }).error || 'action_failed');
      } else {
        setResult(envelope?.result ?? envelope);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const onRunWithParams = async (name: string) => {
    let parsed: Record<string, unknown> | undefined;
    if (paramText.trim()) {
      try { parsed = JSON.parse(paramText); }
      catch (e) {
        setError(`Invalid JSON: ${e instanceof Error ? e.message : String(e)}`);
        setActiveAction(name);
        return;
      }
    }
    await onRun(name, parsed);
  };

  if (isLoading) {
    return (
      <section className={cn('rounded-lg border border-zinc-800 bg-zinc-950/60 p-3 text-xs text-zinc-500 flex items-center gap-2', className)}>
        <Loader2 className="w-3.5 h-3.5 animate-spin" /> Discovering {domain} actions...
      </section>
    );
  }

  if (!data?.ok && hideWhenEmpty) return null;
  if (visible.length === 0 && hideWhenEmpty) return null;

  const renderRow = (group: ActionMeta[], rowLabel: string) => {
    if (group.length === 0) return null;
    return (
      <div className="mb-2 last:mb-0">
        <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1 font-mono">{rowLabel}</div>
        <div className="flex flex-wrap gap-1.5">
          {group.map(a => {
            const { icon: Icon, tint } = classifyAction(a);
            const isRunning = runAction.isPending && activeAction === a.action;
            return (
              <span key={a.action} className="inline-flex items-center">
                <button
                  type="button"
                  onClick={() => void onRun(a.action)}
                  disabled={runAction.isPending}
                  title={a.desc || `Click to run ${a.action} (uses default params). Shift-click to open input field.`}
                  className={cn(
                    'inline-flex items-center gap-1 text-xs px-2 py-1 rounded-l border bg-zinc-900/40 transition-colors',
                    tint,
                    runAction.isPending && 'opacity-50 cursor-wait',
                  )}
                  onAuxClick={(e) => { e.preventDefault(); setParamOpen(a.action); setParamText('{\n  \n}'); }}
                >
                  {isRunning ? <Loader2 className="w-3 h-3 animate-spin" /> : <Icon className="w-3 h-3" />}
                  <span>{prettyLabel(a.action)}</span>
                </button>
                <button
                  type="button"
                  onClick={() => { setParamOpen(paramOpen === a.action ? null : a.action); if (paramOpen !== a.action) setParamText('{\n  \n}'); }}
                  disabled={runAction.isPending}
                  title="Edit input JSON"
                  className={cn(
                    'inline-flex items-center text-xs px-1 py-1 rounded-r border border-l-0 bg-zinc-900/40 transition-colors',
                    tint,
                  )}
                >
                  {'{}'}
                </button>
              </span>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <section className={cn('rounded-lg border border-zinc-800 bg-zinc-950/80 overflow-hidden', className)}>
      <header className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800/80 bg-zinc-900/40">
        <Code2 className="w-4 h-4 text-zinc-400" aria-hidden="true" />
        <h3 className="text-sm font-medium text-zinc-100 flex-1">
          {title}
          <span className="ml-2 text-[10px] text-zinc-500 font-mono">{visible.length} / {data?.total || 0}</span>
        </h3>
        <button
          type="button"
          onClick={() => setExpanded(v => !v)}
          className="text-zinc-500 hover:text-zinc-200 transition-colors"
          aria-label={expanded ? 'Collapse' : 'Expand'}
        >
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
        <button
          type="button"
          onClick={() => void refetch()}
          className="text-zinc-500 hover:text-zinc-200 transition-colors"
          aria-label="Refresh"
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </header>

      <div className={cn('px-3 py-3 transition-all', !expanded && visible.length > 12 && 'max-h-[160px] overflow-hidden')}>
        {renderRow(compute, 'Compute')}
        {renderRow(analysis, 'Analysis')}
        {renderRow(generative, 'Generative')}
        {renderRow(ai, 'AI')}
        {renderRow(other, 'Other')}
      </div>

      {paramOpen && (
        <div className="border-t border-zinc-800/40 px-3 py-2 bg-zinc-900/30">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] uppercase tracking-wider text-zinc-500 font-mono">Input JSON for {paramOpen}</span>
            <button
              type="button"
              onClick={() => { setParamOpen(null); setParamText(''); }}
              className="ml-auto text-[10px] text-zinc-500 hover:text-zinc-200"
            >close</button>
          </div>
          <textarea
            value={paramText}
            onChange={(e) => setParamText(e.target.value)}
            spellCheck={false}
            rows={4}
            className="w-full text-[11px] bg-zinc-950/60 border border-zinc-800 rounded px-2 py-1 text-zinc-200 font-mono focus:outline-none focus:ring-1 focus:ring-indigo-500/40"
            placeholder='{"key": "value"}'
          />
          <div className="flex items-center gap-2 mt-1.5">
            <button
              type="button"
              onClick={() => void onRunWithParams(paramOpen!)}
              disabled={runAction.isPending}
              className="text-xs px-2 py-1 rounded bg-indigo-700/40 hover:bg-indigo-700/60 text-indigo-100 border border-indigo-600/60 disabled:opacity-40"
            >
              {runAction.isPending && activeAction === paramOpen ? 'Running…' : `Run ${prettyLabel(paramOpen)}`}
            </button>
            <span className="text-[10px] text-zinc-500 italic">Edit JSON above, then submit. Empty JSON = same as click-the-button default.</span>
          </div>
        </div>
      )}

      {(result !== null || error) && (
        <div className="border-t border-zinc-800/40 px-3 py-2 bg-zinc-900/30">
          <div className="flex items-center gap-2 mb-1.5">
            {error ? (
              <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />
            ) : (
              <Check className="w-3.5 h-3.5 text-emerald-400" />
            )}
            <span className="text-[11px] text-zinc-300 font-mono">{activeAction}</span>
            <button
              type="button"
              onClick={() => { setResult(null); setError(null); setActiveAction(null); }}
              className="ml-auto text-[10px] text-zinc-500 hover:text-zinc-200"
            >
              clear
            </button>
          </div>
          {error && (
            <pre className="text-[11px] text-rose-300/80 whitespace-pre-wrap break-all">{error}</pre>
          )}
          {!error && result !== null && (
            <pre className="text-[11px] text-zinc-300 bg-zinc-950/40 rounded p-2 overflow-x-auto max-h-64 whitespace-pre-wrap break-all">
              {typeof result === 'string' ? result : JSON.stringify(result, null, 2)}
            </pre>
          )}
        </div>
      )}

      <footer className="px-3 py-1.5 text-[10px] text-zinc-500 border-t border-zinc-800/40">
        Auto-discovered from /api/lens-actions/{domain}
      </footer>
    </section>
  );
}

export default AutoActionStrip;
