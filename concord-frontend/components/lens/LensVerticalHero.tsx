'use client';

/**
 * LensVerticalHero — top-of-page workspace card that promotes a "light
 * vertical" lens to a full vertical by giving it a domain header, live
 * stat tiles from the lens's substrate, and a featured-actions grid
 * with input drilldown.
 *
 * Phase 9: lifts the 38 "light vertical" lenses (foundry, philosophy,
 * understanding, lab, quantum, projects, anon, schema, veterinary,
 * etc.) to "solid vertical" by adding a real workspace surface.
 * Composes:
 *   - manifest-driven title + icon + tagline (no per-lens authoring)
 *   - live useLensData() pulled-count + recent activity
 *   - auto-discovered featured actions (top 6 from
 *     /api/lens-actions/<domain>, hand-prioritized by isAnalysis →
 *     isGenerative → isCompute → isAi over CRUD/social noise)
 *   - JSON input pane per action (same UX as AutoActionStrip)
 *   - empty state CTA from the manifest
 *
 * Mounted via codemod in each of the 38 light-vertical lens pages
 * right after DepthBadge.  Additive — does NOT replace existing
 * page content.  The lens visually gains: hero card + stat tiles +
 * featured-actions row above whatever was already there.
 */

import { useMemo, useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { api } from '@/lib/api/client';
import { getLensManifest } from '@/lib/lenses/manifest';
import { cn } from '@/lib/utils';
import {
  Layers, Zap, Activity, Database, Loader2, AlertTriangle, Check,
  Sparkles, BarChart3, Calculator,
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

const HIDDEN_PREFIXES = ['live_', 'recent_mine', 'list_mine'];
const HIDDEN_EXACT = new Set([
  'list', 'get', 'create', 'update', 'delete', 'export', 'run',
  'bulkCreate', 'paginated', 'search',
  'like', 'dislike', 'vote', 'star', 'pin', 'unpin', 'bookmark',
  'share', 'repost', 'comment', 'tag', 'assign', 'rate',
  'archive', 'duplicate', 'lock', 'unlock', 'move', 'priority',
  'status', 'publish', 'unpublish', 'save',
  'analyze', 'generate', 'suggest',
]);

function shouldHide(a: ActionMeta): boolean {
  if (HIDDEN_EXACT.has(a.action)) return true;
  return HIDDEN_PREFIXES.some(p => a.action.startsWith(p));
}

function classifyAction(a: ActionMeta): { icon: typeof Zap; tint: string; bg: string } {
  if (a.isGenerative) return { icon: Sparkles, tint: 'text-violet-300', bg: 'bg-violet-500/10 border-violet-500/30 hover:bg-violet-500/15' };
  if (a.isAnalysis)  return { icon: BarChart3, tint: 'text-amber-300', bg: 'bg-amber-500/10 border-amber-500/30 hover:bg-amber-500/15' };
  if (a.isAi)        return { icon: Zap,       tint: 'text-indigo-300', bg: 'bg-indigo-500/10 border-indigo-500/30 hover:bg-indigo-500/15' };
  return { icon: Calculator, tint: 'text-cyan-300', bg: 'bg-cyan-500/10 border-cyan-500/30 hover:bg-cyan-500/15' };
}

function rankAction(a: ActionMeta): number {
  // Lower is better.  Surface analysis first, then generative, then
  // pure compute, then AI catch-alls.  Inside each band keep declared
  // order to preserve the lens author's curation intent.
  if (a.isAnalysis && !a.isAi)  return 1;
  if (a.isGenerative && !a.isAi) return 2;
  if (a.isCompute && !a.isAi)   return 3;
  if (a.isAi)                   return 4;
  return 5;
}

function prettyLabel(name: string): string {
  return name
    .replace(/[-_]/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^\w/, c => c.toUpperCase());
}

export interface LensVerticalHeroProps {
  /** Lens domain slug — matches manifest.domain + registerLensAction("X"). */
  lensId: string;
  /** Override featured-action count.  Default 6. */
  maxActions?: number;
  /** Override the primary artifact type used for the stat tiles. */
  primaryArtifact?: string;
  className?: string;
}

export function LensVerticalHero({
  lensId,
  maxActions = 6,
  primaryArtifact,
  className,
}: LensVerticalHeroProps) {
  // Manifest-driven copy + artifact discovery.
  const manifest = useMemo(() => {
    try { return getLensManifest(lensId); }
    catch { return null; }
  }, [lensId]);

  const artifactType = primaryArtifact || manifest?.artifacts?.[0] || null;

  // Live substrate count via useLensData.  Skip if no manifest.
  const lensData = useLensData<Record<string, unknown>>(
    lensId,
    artifactType || 'item',
    { seed: [] },
  );
  const itemCount = lensData?.items?.length ?? 0;
  const thisWeek = useMemo(() => {
    if (!lensData?.items) return 0;
    const cutoff = Date.now() - 7 * 86400 * 1000;
    return lensData.items.filter((it) => {
      const updated = (it as { updatedAt?: string | number })?.updatedAt;
      if (!updated) return false;
      const ts = typeof updated === 'number' ? updated * 1000 : new Date(updated).getTime();
      return ts >= cutoff;
    }).length;
  }, [lensData?.items]);

  // Action discovery.
  const { data: actionsResp, isLoading: actionsLoading } = useQuery<ActionsResponse | null>({
    queryKey: ['lens-actions', lensId],
    queryFn: async () => {
      try {
        const r = await api.get(`/api/lens-actions/${lensId}`);
        return r?.data as ActionsResponse;
      } catch { return null; }
    },
    staleTime: 5 * 60 * 1000,
  });

  const featured: ActionMeta[] = useMemo(() => {
    const all = actionsResp?.actions || [];
    const visible = all.filter(a => !shouldHide(a));
    return [...visible].sort((a, b) => rankAction(a) - rankAction(b)).slice(0, maxActions);
  }, [actionsResp, maxActions]);

  // Per-action state.
  const [activeAction, setActiveAction] = useState<string | null>(null);
  const [paramText, setParamText] = useState('');
  const [paramOpen, setParamOpen] = useState<string | null>(null);
  const [result, setResult] = useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);
  const runAction = useRunArtifact(lensId);

  const onRun = useCallback(async (name: string, extraInput?: Record<string, unknown>) => {
    setActiveAction(name);
    setResult(null);
    setError(null);
    try {
      const r = await runAction.mutateAsync({
        id: (lensData?.items?.[0] as { id?: string } | undefined)?.id || `${lensId}-hero-${Date.now()}`,
        action: name,
        ...(extraInput ? { input: extraInput, params: extraInput } : {}),
      });
      const envelope = (r as { ok: boolean; result?: unknown; error?: string } | undefined);
      if (envelope?.ok === false) {
        setError((envelope as { error?: string }).error || 'action_failed');
      } else {
        setResult(envelope?.result ?? envelope);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [runAction, lensId, lensData?.items]);

  const onRunWithParams = useCallback(async (name: string) => {
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
  }, [onRun, paramText]);

  const tagline = manifest?.emptyState?.caption || manifest?.label || lensId;

  return (
    <section
      className={cn(
        'rounded-xl border border-zinc-800 bg-gradient-to-br from-zinc-950/95 to-zinc-900/60 overflow-hidden',
        className,
      )}
      data-lens-hero={lensId}
    >
      <header className="px-4 py-3 border-b border-zinc-800/60">
        <div className="flex items-baseline gap-2 flex-wrap">
          <h2 className="text-lg font-bold text-zinc-100">
            {manifest?.label || prettyLabel(lensId)}
          </h2>
          <span className="text-[10px] uppercase tracking-wider text-emerald-400 font-mono px-1.5 py-0.5 rounded border border-emerald-500/30 bg-emerald-500/10">
            workspace
          </span>
          {manifest?.dataTier && (
            <span className="text-[10px] uppercase tracking-wider text-zinc-400 font-mono">
              {manifest.dataTier}
            </span>
          )}
        </div>
        <p className="text-xs text-zinc-400 mt-0.5 line-clamp-2">{tagline}</p>
      </header>

      <div className="grid grid-cols-3 divide-x divide-zinc-800/60 border-b border-zinc-800/60">
        <Tile icon={Database} label="In substrate" value={itemCount} tint="text-cyan-300" />
        <Tile icon={Activity} label="Last 7 days" value={thisWeek} tint="text-emerald-300" />
        <Tile icon={Layers} label="Actions" value={actionsResp?.total ?? 0} tint="text-violet-300" />
      </div>

      <div className="p-3">
        <div className="flex items-center gap-2 mb-2">
          <Zap className="w-3.5 h-3.5 text-amber-300" />
          <h3 className="text-xs uppercase tracking-wider text-zinc-400 font-mono">Featured actions</h3>
          {actionsLoading && <Loader2 className="w-3 h-3 animate-spin text-zinc-500" />}
        </div>
        {featured.length === 0 && !actionsLoading && (
          <div className="text-xs text-zinc-500 italic px-2 py-3">
            No actions registered for this lens yet.
          </div>
        )}
        {featured.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
            {featured.map(a => {
              const { icon: Icon, tint, bg } = classifyAction(a);
              const isActive = activeAction === a.action;
              const isRunning = runAction.isPending && isActive;
              return (
                <div key={a.action} className="flex items-stretch">
                  <button
                    type="button"
                    onClick={() => void onRun(a.action)}
                    disabled={runAction.isPending}
                    title={a.desc || `Run ${a.action} with defaults`}
                    className={cn(
                      'flex-1 flex flex-col items-start gap-0.5 px-2.5 py-1.5 rounded-l border text-left transition-colors',
                      bg, runAction.isPending && 'opacity-50 cursor-wait',
                    )}
                  >
                    <span className={cn('flex items-center gap-1.5 text-xs', tint)}>
                      {isRunning ? <Loader2 className="w-3 h-3 animate-spin" /> : <Icon className="w-3 h-3" />}
                      <span className="font-medium text-zinc-100">{prettyLabel(a.action)}</span>
                    </span>
                    {a.desc && (
                      <span className="text-[10px] text-zinc-500 line-clamp-1">{a.desc}</span>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setParamOpen(paramOpen === a.action ? null : a.action);
                      if (paramOpen !== a.action) setParamText('{\n  \n}');
                    }}
                    disabled={runAction.isPending}
                    title="Edit input JSON"
                    className={cn(
                      'px-1.5 flex items-center text-[10px] rounded-r border border-l-0 transition-colors',
                      bg,
                    )}
                  >
                    {'{}'}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {paramOpen && (
        <div className="px-3 pb-3">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] uppercase tracking-wider text-zinc-500 font-mono">
              Input JSON for {prettyLabel(paramOpen)}
            </span>
            <button
              type="button"
              onClick={() => { setParamOpen(null); setParamText(''); }}
              className="ml-auto text-[10px] text-zinc-500 hover:text-zinc-200"
            >
              close
            </button>
          </div>
          <textarea
            value={paramText}
            onChange={(e) => setParamText(e.target.value)}
            spellCheck={false}
            rows={4}
            className="w-full text-[11px] bg-zinc-950/60 border border-zinc-800 rounded px-2 py-1 text-zinc-200 font-mono focus:outline-none focus:ring-1 focus:ring-indigo-500/40"
            placeholder='{"key": "value"}'
          />
          <button
            type="button"
            onClick={() => void onRunWithParams(paramOpen)}
            disabled={runAction.isPending}
            className="mt-1.5 text-xs px-2 py-1 rounded bg-indigo-700/40 hover:bg-indigo-700/60 text-indigo-100 border border-indigo-600/60 disabled:opacity-40"
          >
            {runAction.isPending && activeAction === paramOpen ? 'Running…' : `Run ${prettyLabel(paramOpen)}`}
          </button>
        </div>
      )}

      {(result !== null || error) && (
        <div className="border-t border-zinc-800/60 px-3 py-2 bg-zinc-900/30">
          <div className="flex items-center gap-2 mb-1">
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
    </section>
  );
}

function Tile({ icon: Icon, label, value, tint }: { icon: typeof Zap; label: string; value: number; tint: string }) {
  return (
    <div className="px-3 py-2">
      <div className="flex items-center gap-1.5">
        <Icon className={cn('w-3 h-3', tint)} />
        <span className="text-[10px] uppercase tracking-wider text-zinc-500 font-mono">{label}</span>
      </div>
      <div className={cn('text-lg font-bold tabular-nums mt-0.5', tint)}>{value}</div>
    </div>
  );
}

export default LensVerticalHero;
