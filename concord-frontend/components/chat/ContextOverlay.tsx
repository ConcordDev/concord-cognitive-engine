'use client';

/**
 * ContextOverlay — Working Set Visualization Panel
 *
 * Expandable panel triggered by "View Context" button on assistant messages.
 * Shows which DTUs influenced a specific response, their activation sources,
 * token budget utilization, and subconscious analysis (if available).
 *
 * Full transparency: the user knows exactly what the AI was thinking about
 * when it answered.
 */

import { useState, useCallback } from 'react';
import {
  Database,
  Layers,
  Eye,
  BarChart3,
  X,
  ChevronDown,
  ChevronUp,
  Brain,
  Zap,
  Globe,
  User,
  Cpu,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api/client';

// ── Types ────────────────────────────────────────────────────────────────────

interface ContextDTU {
  id: string;
  title: string;
  tier: string;
  tags: string[];
  score?: number;
  sources?: {
    queryMatch: boolean;
    edgeSpread: boolean;
    globalWarmth: boolean;
    userProfileSeed: boolean;
    autogen: boolean;
  };
}

interface TokenBudget {
  contextWindow: number;
  budgets: {
    systemPrompt: number;
    conversationSummary: number;
    dtuContext: number;
    responseSpace: number;
  };
  ratios: Record<string, number>;
}

interface ContextData {
  ok: boolean;
  workingSet: ContextDTU[];
  totalActivated: number;
  entityState: Record<string, unknown>;
  conversationSummary: string;
  tokenBudget: TokenBudget;
  sources: Record<string, unknown>;
}

interface ContextOverlayProps {
  sessionId: string;
  lens?: string;
  isOpen: boolean;
  onClose: () => void;
}

// ── Source Badge ──────────────────────────────────────────────────────────────

function SourceBadge({ label, icon: Icon, active }: { label: string; icon: typeof Database; active: boolean }) {
  if (!active) return null;
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] bg-white/5 text-zinc-400 border border-white/5">
      <Icon className="w-2.5 h-2.5" />
      {label}
    </span>
  );
}

// ── Tier Badge ───────────────────────────────────────────────────────────────

const TIER_COLORS: Record<string, string> = {
  regular: 'bg-neon-blue/10 text-neon-blue border-neon-blue/30',
  mega: 'bg-neon-purple/10 text-neon-purple border-neon-purple/30',
  hyper: 'bg-neon-pink/10 text-neon-pink border-neon-pink/30',
  shadow: 'bg-zinc-500/10 text-zinc-400 border-zinc-500/30',
};

// ── Budget Bar ───────────────────────────────────────────────────────────────

function BudgetBar({ budget }: { budget: TokenBudget }) {
  const segments = [
    { label: 'System', pct: budget.ratios.systemPrompt * 100, color: 'bg-neon-cyan' },
    { label: 'Summary', pct: budget.ratios.conversationSummary * 100, color: 'bg-neon-green' },
    { label: 'DTUs', pct: budget.ratios.dtuContext * 100, color: 'bg-neon-purple' },
    { label: 'Response', pct: budget.ratios.responseSpace * 100, color: 'bg-neon-pink' },
  ];

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5 text-[10px] text-zinc-500">
        <BarChart3 className="w-3 h-3" />
        Token Budget ({budget.contextWindow.toLocaleString()} tokens)
      </div>
      <div className="flex h-2 rounded-full overflow-hidden bg-zinc-800">
        {segments.map((seg) => (
          <div
            key={seg.label}
            className={cn('h-full', seg.color)}
            style={{ width: `${seg.pct}%` }}
            title={`${seg.label}: ${seg.pct}%`}
          />
        ))}
      </div>
      <div className="flex gap-3 text-[9px] text-zinc-500">
        {segments.map((seg) => (
          <span key={seg.label} className="flex items-center gap-1">
            <span className={cn('w-1.5 h-1.5 rounded-full', seg.color)} />
            {seg.label} {seg.pct}%
          </span>
        ))}
      </div>
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────────────────────

export function ContextOverlay({ sessionId, lens, isOpen, onClose }: ContextOverlayProps) {
  const [data, setData] = useState<ContextData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedDtu, setExpandedDtu] = useState<string | null>(null);

  const fetchContext = useCallback(async () => {
    if (data) return; // Already loaded
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ sessionId });
      if (lens) params.set('lens', lens);
      const res = await api.get(`/api/chat/context?${params.toString()}`);
      setData(res.data);
    } catch (err) {
      setError(String((err as Error).message || 'Failed to load context'));
    } finally {
      setLoading(false);
    }
  }, [sessionId, lens, data]);

  // Fetch on open
  if (isOpen && !data && !loading && !error) {
    fetchContext();
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-lg max-h-[80vh] bg-lattice-deep border border-lattice-border rounded-xl shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-lattice-border bg-lattice-surface">
          <div className="flex items-center gap-2">
            <Eye className="w-4 h-4 text-neon-cyan" />
            <span className="text-sm font-medium text-white">Context Working Set</span>
            {data && (
              <span className="text-xs text-zinc-500 px-2 py-0.5 rounded-full bg-zinc-800">
                {data.workingSet.length} DTUs
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-lattice-elevated text-gray-400 hover:text-white transition-colors"
          aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
          {loading && (
            <div className="flex items-center justify-center py-8">
              <div className="animate-pulse text-zinc-500 text-sm">Loading context...</div>
            </div>
          )}

          {error && (
            <div className="text-sm text-red-400 bg-red-500/10 px-3 py-2 rounded-lg border border-red-500/20">
              {error}
            </div>
          )}

          {data && (
            <>
              {/* Token Budget */}
              {data.tokenBudget && <BudgetBar budget={data.tokenBudget} />}

              {/* Conversation Summary */}
              {data.conversationSummary && (
                <div className="space-y-1">
                  <div className="flex items-center gap-1.5 text-[10px] text-zinc-500">
                    <Brain className="w-3 h-3" />
                    Conversation Summary
                  </div>
                  <div className="text-xs text-zinc-300 bg-zinc-800/50 rounded-lg px-3 py-2 border border-zinc-700/30">
                    {data.conversationSummary}
                  </div>
                </div>
              )}

              {/* Entity State */}
              {data.entityState && Object.keys(data.entityState).length > 0 && (
                <div className="space-y-1">
                  <div className="flex items-center gap-1.5 text-[10px] text-zinc-500">
                    <Cpu className="w-3 h-3" />
                    Entity State
                  </div>
                  <div className="text-[10px] text-zinc-400 bg-zinc-800/50 rounded-lg px-3 py-2 border border-zinc-700/30 font-mono">
                    {Object.entries(data.entityState).map(([key, val]) => (
                      <div key={key}>{key}: {JSON.stringify(val)}</div>
                    ))}
                  </div>
                </div>
              )}

              {/* Sources */}
              <div className="flex items-center gap-2 text-[10px] text-zinc-500">
                <Layers className="w-3 h-3" />
                Sources:
                {data.sources && Object.entries(data.sources).map(([key, val]) => (
                  <span key={key} className="px-1.5 py-0.5 bg-zinc-800 rounded text-zinc-400">
                    {key}: {String(val)}
                  </span>
                ))}
              </div>

              {/* Working Set DTUs */}
              <div className="space-y-1">
                <div className="text-[10px] text-zinc-500 uppercase tracking-wider">
                  DTU Working Set ({data.workingSet.length} / {data.totalActivated} activated)
                </div>
                <div className="space-y-1">
                  {data.workingSet.map((dtu) => (
                    <div
                      key={dtu.id}
                      className={cn(
                        'rounded-lg border bg-zinc-900/50 transition-all cursor-pointer',
                        expandedDtu === dtu.id ? 'border-neon-cyan/30' : 'border-zinc-800/50 hover:border-zinc-700'
                      )}
                      onClick={() => setExpandedDtu(expandedDtu === dtu.id ? null : dtu.id)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
                      <div className="flex items-center gap-2 px-3 py-2">
                        <Database className="w-3 h-3 text-zinc-500 shrink-0" />
                        <span className="text-xs text-zinc-200 truncate flex-1">{dtu.title}</span>
                        <span className={cn(
                          'text-[9px] px-1.5 py-0.5 rounded border',
                          TIER_COLORS[dtu.tier] || TIER_COLORS.regular
                        )}>
                          {dtu.tier}
                        </span>
                        {expandedDtu === dtu.id
                          ? <ChevronUp className="w-3 h-3 text-zinc-500" />
                          : <ChevronDown className="w-3 h-3 text-zinc-500" />
                        }
                      </div>

                      {expandedDtu === dtu.id && (
                        <div className="px-3 pb-2 pt-1 border-t border-zinc-800/50 space-y-1.5">
                          {/* Tags */}
                          {dtu.tags && dtu.tags.length > 0 && (
                            <div className="flex flex-wrap gap-1">
                              {dtu.tags.map((tag) => (
                                <span key={tag} className="text-[9px] px-1.5 py-0.5 bg-zinc-800 text-zinc-500 rounded">
                                  {tag}
                                </span>
                              ))}
                            </div>
                          )}

                          {/* Activation sources */}
                          {dtu.sources && (
                            <div className="flex flex-wrap gap-1">
                              <SourceBadge label="Query" icon={Zap} active={dtu.sources.queryMatch} />
                              <SourceBadge label="Spread" icon={Layers} active={dtu.sources.edgeSpread} />
                              <SourceBadge label="Global" icon={Globe} active={dtu.sources.globalWarmth} />
                              <SourceBadge label="Profile" icon={User} active={dtu.sources.userProfileSeed} />
                            </div>
                          )}

                          <div className="text-[9px] text-zinc-600 font-mono">{dtu.id}</div>
                        </div>
                      )}
                    </div>
                  ))}

                  {data.workingSet.length === 0 && (
                    <div className="text-xs text-zinc-500 text-center py-4">
                      No DTUs in working set. The substrate will fill as conversations happen.
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
