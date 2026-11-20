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
import { activateOnEnterOrSpace } from '@/lib/a11y/editable-target';

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
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] bg-[var(--nb-wash,rgba(255,255,255,0.05))] text-[color:var(--nb-muted,#a1a1aa)] border border-[color:var(--nb-rule,rgba(255,255,255,0.05))]">
      <Icon className="w-2.5 h-2.5" />
      {label}
    </span>
  );
}

// ── Tier Badge ───────────────────────────────────────────────────────────────

const TIER_COLORS: Record<string, string> = {
  regular: 'bg-[var(--nb-blue-soft,rgba(0,212,255,0.1))] text-[color:var(--nb-blue,#00d4ff)] border-[color:var(--nb-blue,rgba(0,212,255,0.3))]',
  mega: 'bg-[var(--nb-red-soft,rgba(168,85,247,0.1))] text-[color:var(--nb-red,#a855f7)] border-[color:var(--nb-red,rgba(168,85,247,0.3))]',
  hyper: 'bg-[var(--nb-red-soft,rgba(236,72,153,0.1))] text-[color:var(--nb-red,#ec4899)] border-[color:var(--nb-red,rgba(236,72,153,0.3))]',
  shadow: 'bg-[var(--nb-wash-2,rgba(113,113,122,0.1))] text-[color:var(--nb-muted,#a1a1aa)] border-[color:var(--nb-rule-2,rgba(113,113,122,0.3))]',
};

// ── Budget Bar ───────────────────────────────────────────────────────────────

function BudgetBar({ budget }: { budget: TokenBudget }) {
  const segments = [
    { label: 'System', pct: budget.ratios.systemPrompt * 100, color: 'bg-[var(--nb-blue,#00fff7)]' },
    { label: 'Summary', pct: budget.ratios.conversationSummary * 100, color: 'bg-[var(--nb-green,#22c55e)]' },
    { label: 'DTUs', pct: budget.ratios.dtuContext * 100, color: 'bg-[var(--nb-red,#a855f7)]' },
    { label: 'Response', pct: budget.ratios.responseSpace * 100, color: 'bg-[var(--nb-red,#ec4899)]' },
  ];

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5 text-[10px] text-[color:var(--nb-muted,#a1a1aa)]">
        <BarChart3 className="w-3 h-3" />
        Token Budget ({budget.contextWindow.toLocaleString()} tokens)
      </div>
      <div className="flex h-2 rounded-full overflow-hidden bg-[var(--nb-wash,#27272a)]">
        {segments.map((seg) => (
          <div
            key={seg.label}
            className={cn('h-full', seg.color)}
            style={{ width: `${seg.pct}%` }}
            title={`${seg.label}: ${seg.pct}%`}
          />
        ))}
      </div>
      <div className="flex gap-3 text-[9px] text-[color:var(--nb-muted,#a1a1aa)]">
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--nb-scrim,rgba(0,0,0,0.5))] backdrop-blur-sm">
      <div className="w-full max-w-lg max-h-[80vh] bg-[var(--nb-sheet,rgb(var(--lattice-deep-rgb)))] border border-[color:var(--nb-rule,rgb(var(--lattice-border-rgb)))] rounded-xl shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[color:var(--nb-rule,rgb(var(--lattice-border-rgb)))] bg-[var(--nb-sheet,rgb(var(--lattice-surface-rgb)))]">
          <div className="flex items-center gap-2">
            <Eye className="w-4 h-4 text-[color:var(--nb-blue,#00fff7)]" />
            <span className="text-sm font-medium text-[color:var(--nb-ink,#ffffff)]">Context Working Set</span>
            {data && (
              <span className="text-xs text-[color:var(--nb-muted,#a1a1aa)] px-2 py-0.5 rounded-full bg-[var(--nb-wash,#27272a)]">
                {data.workingSet.length} DTUs
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-[var(--nb-wash,rgb(var(--lattice-elevated-rgb)))] text-[color:var(--nb-muted,#9ca3af)] hover:text-[color:var(--nb-ink,#ffffff)] transition-colors"
          aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
          {loading && (
            <div className="flex items-center justify-center py-8">
              <div className="animate-pulse text-[color:var(--nb-muted,#a1a1aa)] text-sm">Loading context...</div>
            </div>
          )}

          {error && (
            <div className="text-sm text-[color:var(--nb-red,#f87171)] bg-[var(--nb-red-soft,rgba(239,68,68,0.1))] px-3 py-2 rounded-lg border border-[color:var(--nb-red,rgba(239,68,68,0.2))]">
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
                  <div className="flex items-center gap-1.5 text-[10px] text-[color:var(--nb-muted,#a1a1aa)]">
                    <Brain className="w-3 h-3" />
                    Conversation Summary
                  </div>
                  <div className="text-xs text-[color:var(--nb-ink-2,#d4d4d8)] bg-[var(--nb-wash,rgba(39,39,42,0.5))] rounded-lg px-3 py-2 border border-[color:var(--nb-rule,rgba(63,63,70,0.3))]">
                    {data.conversationSummary}
                  </div>
                </div>
              )}

              {/* Entity State */}
              {data.entityState && Object.keys(data.entityState).length > 0 && (
                <div className="space-y-1">
                  <div className="flex items-center gap-1.5 text-[10px] text-[color:var(--nb-muted,#a1a1aa)]">
                    <Cpu className="w-3 h-3" />
                    Entity State
                  </div>
                  <div className="text-[10px] text-[color:var(--nb-muted,#a1a1aa)] bg-[var(--nb-wash,rgba(39,39,42,0.5))] rounded-lg px-3 py-2 border border-[color:var(--nb-rule,rgba(63,63,70,0.3))] font-mono">
                    {Object.entries(data.entityState).map(([key, val]) => (
                      <div key={key}>{key}: {JSON.stringify(val)}</div>
                    ))}
                  </div>
                </div>
              )}

              {/* Sources */}
              <div className="flex items-center gap-2 text-[10px] text-[color:var(--nb-muted,#a1a1aa)]">
                <Layers className="w-3 h-3" />
                Sources:
                {data.sources && Object.entries(data.sources).map(([key, val]) => (
                  <span key={key} className="px-1.5 py-0.5 bg-[var(--nb-wash,#27272a)] rounded text-[color:var(--nb-muted,#a1a1aa)]">
                    {key}: {String(val)}
                  </span>
                ))}
              </div>

              {/* Working Set DTUs */}
              <div className="space-y-1">
                <div className="text-[10px] text-[color:var(--nb-muted,#a1a1aa)] uppercase tracking-wider">
                  DTU Working Set ({data.workingSet.length} / {data.totalActivated} activated)
                </div>
                <div className="space-y-1">
                  {data.workingSet.map((dtu) => (
                    <div
                      key={dtu.id}
                      className={cn(
                        'rounded-lg border bg-[var(--nb-sheet,rgba(24,24,27,0.5))] transition-all cursor-pointer',
                        expandedDtu === dtu.id ? 'border-[color:var(--nb-blue,rgba(0,255,247,0.3))]' : 'border-[color:var(--nb-rule,rgba(39,39,42,0.5))] hover:border-[color:var(--nb-rule,#3f3f46)]'
                      )}
                      onClick={() => setExpandedDtu(expandedDtu === dtu.id ? null : dtu.id)} role="button" tabIndex={0} onKeyDown={activateOnEnterOrSpace}>
                      <div className="flex items-center gap-2 px-3 py-2">
                        <Database className="w-3 h-3 text-[color:var(--nb-muted,#a1a1aa)] shrink-0" />
                        <span className="text-xs text-[color:var(--nb-ink,#e4e4e7)] truncate flex-1">{dtu.title}</span>
                        <span className={cn(
                          'text-[9px] px-1.5 py-0.5 rounded border',
                          TIER_COLORS[dtu.tier] || TIER_COLORS.regular
                        )}>
                          {dtu.tier}
                        </span>
                        {expandedDtu === dtu.id
                          ? <ChevronUp className="w-3 h-3 text-[color:var(--nb-muted,#a1a1aa)]" />
                          : <ChevronDown className="w-3 h-3 text-[color:var(--nb-muted,#a1a1aa)]" />
                        }
                      </div>

                      {expandedDtu === dtu.id && (
                        <div className="px-3 pb-2 pt-1 border-t border-[color:var(--nb-rule,rgba(39,39,42,0.5))] space-y-1.5">
                          {/* Tags */}
                          {dtu.tags && dtu.tags.length > 0 && (
                            <div className="flex flex-wrap gap-1">
                              {dtu.tags.map((tag) => (
                                <span key={tag} className="text-[9px] px-1.5 py-0.5 bg-[var(--nb-wash,#27272a)] text-[color:var(--nb-muted,#a1a1aa)] rounded">
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

                          <div className="text-[9px] text-[color:var(--nb-muted,#a1a1aa)] font-mono">{dtu.id}</div>
                        </div>
                      )}
                    </div>
                  ))}

                  {data.workingSet.length === 0 && (
                    <div className="text-xs text-[color:var(--nb-muted,#a1a1aa)] text-center py-4">
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
