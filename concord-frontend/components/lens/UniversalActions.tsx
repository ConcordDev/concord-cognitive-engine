'use client';

/**
 * UniversalActions — AI-powered action bar for any lens artifact.
 *
 * Every lens domain has three universal actions registered on the backend:
 *   analyze  — "Look at this artifact and tell me what you see"
 *   generate — "Create new content in this domain based on context"
 *   suggest  — "What should I do next in this domain?"
 *
 * Drop this component into any lens page to give users one-click access
 * to the utility brain (local Ollama, free, sovereign).
 *
 * Usage:
 *   <UniversalActions domain="education" artifactId={selectedId} />
 */

import { useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import { api } from '@/lib/api/client';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
import {
  Sparkles,
  Lightbulb,
  Wand2,
  X,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  Zap,
  Search,
  FileText,
  BarChart2,
} from 'lucide-react';

interface UniversalActionsProps {
  /** Lens domain slug (e.g. "education", "finance") */
  domain: string;
  /** ID of the currently selected artifact */
  artifactId: string | null | undefined;
  /** Optional extra params passed to the action handler */
  params?: Record<string, unknown>;
  /** Compact mode — inline button row instead of panel */
  compact?: boolean;
  /** Show only generative actions */
  generativeOnly?: boolean;
  /** Custom class name */
  className?: string;
}

interface ActionResult {
  action: string;
  output: string;
  source?: string;
  model?: string;
  confidence?: { score: number; label: string; factors?: Record<string, number> };
}

interface ManifestAction {
  action: string;
  desc: string;
  brain: string;
  isGenerative: boolean;
  isAnalysis: boolean;
}

const ICON_MAP: Record<string, typeof Sparkles> = {
  analyze: Search,
  generate: Wand2,
  suggest: Lightbulb,
  create: Sparkles,
  build: Zap,
  plan: FileText,
  forecast: BarChart2,
};

const COLOR_MAP: Record<string, string> = {
  analyze: 'cyan',
  generate: 'purple',
  suggest: 'green',
  create: 'pink',
  build: 'blue',
  default: 'cyan',
};

function getActionIcon(action: string) {
  for (const [key, Icon] of Object.entries(ICON_MAP)) {
    if (action.startsWith(key)) return Icon;
  }
  return Sparkles;
}

function getActionColor(action: string) {
  for (const [key, color] of Object.entries(COLOR_MAP)) {
    if (action.startsWith(key)) return color;
  }
  return COLOR_MAP.default;
}

// Fallback when manifest is not available
const FALLBACK_ACTIONS = [
  {
    id: 'analyze',
    label: 'Analyze',
    icon: Sparkles,
    color: 'cyan' as const,
    description: 'AI analysis of this artifact',
  },
  {
    id: 'generate',
    label: 'Generate',
    icon: Wand2,
    color: 'purple' as const,
    description: 'Generate new content from context',
  },
  {
    id: 'suggest',
    label: 'Suggest',
    icon: Lightbulb,
    color: 'green' as const,
    description: 'Get suggestions for next steps',
  },
] as const;

function UniversalActions({
  domain,
  artifactId,
  params,
  compact = false,
  generativeOnly = false,
  className,
}: UniversalActionsProps) {
  const runAction = useRunArtifact(domain);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [expanded, setExpanded] = useState(true);

  // Fetch real action manifest from backend
  const { data: manifest } = useQuery({
    queryKey: ['lens-manifest', domain],
    queryFn: () => api.get(`/api/lens/manifest/${domain}`).then((r) => r.data),
    staleTime: 5 * 60 * 1000,
    retry: false,
    enabled: !!domain,
  });

  // Build action list from manifest or fallback
  const manifestActions: Array<{
    id: string;
    label: string;
    icon: typeof Sparkles;
    color: string;
    description: string;
  }> = manifest?.actions
    ? (manifest.actions as ManifestAction[])
        .filter((a) => !generativeOnly || a.isGenerative)
        .slice(0, 8)
        .map((a) => ({
          id: a.action,
          label: a.action.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
          icon: getActionIcon(a.action),
          color: getActionColor(a.action),
          description: a.desc,
        }))
    : FALLBACK_ACTIONS.map((a) => ({ ...a, color: a.color as string }));

  const ACTIONS = manifestActions;

  const handleAction = useCallback(
    async (action: string) => {
      if (!artifactId) return;
      try {
        const res = await runAction.mutateAsync({
          id: artifactId,
          action,
          params: params || {},
        });
        const r = res.result as Record<string, unknown> | undefined;
        const confidence = r?.confidence as
          | { score: number; label: string; factors?: Record<string, number> }
          | undefined;
        setResult({
          action,
          output: String(r?.output || r?.content || JSON.stringify(r, null, 2)),
          source: String(r?.source || 'utility-brain'),
          model: r?.model ? String(r.model) : undefined,
          confidence: confidence || undefined,
        });
        setExpanded(true);
      } catch (err) {
        setResult({
          action,
          output: `Error: ${err instanceof Error ? err.message : String(err)}`,
        });
        setExpanded(true);
      }
    },
    [artifactId, params, runAction]
  );

  if (compact) {
    return (
      <div className={cn('flex items-center gap-2', className)}>
        {ACTIONS.map((a) => (
          <button
            key={a.id}
            onClick={() => handleAction(a.id)}
            disabled={!artifactId || runAction.isPending}
            title={a.description}
            className={cn(
              ds.btnSmall,
              `text-neon-${a.color} hover:bg-neon-${a.color}/20 border border-transparent hover:border-neon-${a.color}/30`
            )}
          >
            <a.icon className="w-3.5 h-3.5" />
            {a.label}
          </button>
        ))}
        {runAction.isPending && <RefreshCw className="w-4 h-4 text-neon-cyan animate-spin" />}
      </div>
    );
  }

  return (
    <div className={cn(ds.panel, 'space-y-3', className)}>
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-gray-300 flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-neon-cyan" />
          AI Actions
          <span className="text-xs text-gray-500">(utility brain)</span>
        </h3>
        {!artifactId && <span className="text-xs text-gray-500">Select an artifact first</span>}
      </div>

      <div className="flex gap-2 flex-wrap">
        {ACTIONS.map((a) => (
          <button
            key={a.id}
            onClick={() => handleAction(a.id)}
            disabled={!artifactId || runAction.isPending}
            className={cn(
              ds.btnSmall,
              `bg-neon-${a.color}/10 text-neon-${a.color} border border-neon-${a.color}/30`,
              `hover:bg-neon-${a.color}/20 disabled:opacity-40`
            )}
          >
            <a.icon className="w-3.5 h-3.5" />
            {a.label}
            {runAction.isPending && result?.action !== a.id ? null : null}
          </button>
        ))}
        {runAction.isPending && (
          <span className="flex items-center gap-1.5 text-xs text-gray-400">
            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            Thinking...
          </span>
        )}
      </div>

      {result && (
        <div className="bg-lattice-void/50 border border-lattice-border rounded-lg overflow-hidden">
          <button
            onClick={() => setExpanded(!expanded)}
            className="w-full flex items-center justify-between px-3 py-2 text-xs text-gray-400 hover:text-white transition-colors"
          >
            <span className="flex items-center gap-2">
              <span className="text-neon-cyan font-medium">{result.action}</span>
              {result.source && <span className="text-gray-500">via {result.source}</span>}
              {result.model && <span className="text-gray-500">({result.model})</span>}
              {result.confidence && (
                <span
                  className={cn(
                    'px-1.5 py-0.5 rounded-full text-[10px] font-medium',
                    result.confidence.score >= 0.75
                      ? 'bg-neon-green/20 text-neon-green'
                      : result.confidence.score >= 0.5
                        ? 'bg-neon-cyan/20 text-neon-cyan'
                        : result.confidence.score >= 0.25
                          ? 'bg-amber-400/20 text-amber-400'
                          : 'bg-red-400/20 text-red-400'
                  )}
                >
                  {Math.round(result.confidence.score * 100)}% conf
                </span>
              )}
            </span>
            {expanded ? (
              <ChevronUp className="w-3.5 h-3.5" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5" />
            )}
          </button>
          {expanded && (
            <div className="px-3 pb-3">
              <div className="text-sm text-gray-200 whitespace-pre-wrap leading-relaxed max-h-64 overflow-y-auto">
                {result.output}
              </div>
              <button
                onClick={() => setResult(null)}
                className="mt-2 flex items-center gap-1 text-xs text-gray-500 hover:text-gray-300"
              >
                <X className="w-3 h-3" /> Dismiss
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

import { withErrorBoundary } from '@/components/common/ErrorBoundary';
const _WrappedUniversalActions = withErrorBoundary(UniversalActions);
export { _WrappedUniversalActions as UniversalActions };
