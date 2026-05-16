'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  ScrollText, X, Loader2, Pin, PinOff, CheckCircle2, Circle, ChevronDown, ChevronRight,
} from 'lucide-react';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/utils';

export interface QuestEntry {
  id: string;
  title: string;
  chainId: string;
  status: 'active' | 'completed' | 'failed';
  step: number;
  totalSteps: number;
  breadcrumb?: string;
  pinned: boolean;
}

export interface QuestChain {
  chainId: string;
  quests: QuestEntry[];
  activeCount: number;
  completedCount: number;
}

interface Props {
  worldId: string;
  open: boolean;
  onClose: () => void;
}

const CHAIN_LABEL: Record<string, string> = {
  onboarding:         'Onboarding — First Cycle',
  main_arc:           'Main arc — The Whisper from the Lattice',
  faction_coalition:  'Faction — The Coalition',
  faction_sovereign:  'Faction — The Sovereign',
  faction_weavers:    'Faction — Weavers of Echoes',
  faction_concord:    'Faction — Concord',
  uncategorized:      'Other quests',
};

export function WorldQuestLogPanel({ worldId, open, onClose }: Props) {
  const [chains, setChains] = useState<QuestChain[]>([]);
  const [pinnedCount, setPinnedCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<'all' | 'active' | 'pinned'>('all');

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.post('/api/lens/run', {
        domain: 'world',
        action: 'quest-summary',
        input: { worldId },
      });
      const result = (res.data as {
        result?: { chains?: QuestChain[]; pinnedCount?: number };
      })?.result;
      setChains(result?.chains || []);
      setPinnedCount(result?.pinnedCount || 0);
      // Auto-expand chains with active quests on first load
      const auto = new Set<string>();
      for (const c of result?.chains || []) {
        if (c.activeCount > 0) auto.add(c.chainId);
      }
      setExpanded(auto);
    } catch (e) {
      console.error('[WorldQuestLogPanel] fetch failed', e);
    } finally {
      setLoading(false);
    }
  }, [worldId]);

  useEffect(() => {
    if (open) refresh();
  }, [open, refresh]);

  const togglePin = async (questId: string) => {
    try {
      await api.post('/api/lens/run', {
        domain: 'world',
        action: 'quest-pin-toggle',
        input: { questId },
      });
      await refresh();
    } catch (e) {
      console.error('[WorldQuestLogPanel] pin failed', e);
    }
  };

  const toggleChain = (cid: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(cid)) next.delete(cid);
      else next.add(cid);
      return next;
    });
  };

  if (!open) return null;

  const filteredChains = chains
    .map((c) => {
      let quests = c.quests;
      if (filter === 'active') quests = quests.filter((q) => q.status === 'active');
      else if (filter === 'pinned') quests = quests.filter((q) => q.pinned);
      return { ...c, quests };
    })
    .filter((c) => c.quests.length > 0);

  return (
    <div className="fixed inset-y-0 right-0 w-[440px] max-w-[100vw] z-40 bg-[#0d1117] border-l border-cyan-500/20 shadow-2xl overflow-hidden flex flex-col">
      <header className="px-4 py-3 border-b border-white/10 flex items-center justify-between bg-gradient-to-r from-amber-950/40 to-transparent">
        <div className="flex items-center gap-2">
          <ScrollText className="w-4 h-4 text-amber-400" />
          <span className="text-sm font-semibold text-gray-200">Quest log</span>
          {pinnedCount > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300">
              {pinnedCount} pinned
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-1 rounded-md hover:bg-white/5 text-gray-400"
          aria-label="Close quest log"
        >
          <X className="w-4 h-4" />
        </button>
      </header>

      <div className="px-3 py-2 border-b border-white/10 flex items-center gap-2">
        {(['all', 'active', 'pinned'] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={cn(
              'px-2 py-1 text-[11px] rounded uppercase tracking-wider transition',
              filter === f
                ? 'bg-amber-500/15 text-amber-200 border border-amber-500/40'
                : 'text-gray-500 hover:text-gray-300 border border-transparent',
            )}
          >
            {f}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {loading ? (
          <div className="flex items-center justify-center py-8 text-xs text-gray-500">
            <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…
          </div>
        ) : filteredChains.length === 0 ? (
          <div className="text-center py-8 px-4">
            <ScrollText className="w-8 h-8 mx-auto text-gray-600 mb-2" />
            <p className="text-xs text-gray-500">
              {filter === 'pinned' ? 'No pinned quests yet' : 'No quests'}
            </p>
          </div>
        ) : (
          filteredChains.map((c) => {
            const isExpanded = expanded.has(c.chainId);
            return (
              <div
                key={c.chainId}
                className="rounded-md border border-white/10 bg-black/20 overflow-hidden"
              >
                <button
                  type="button"
                  onClick={() => toggleChain(c.chainId)}
                  className="w-full px-3 py-2 flex items-center justify-between text-left hover:bg-white/5"
                >
                  <div className="flex items-center gap-2">
                    {isExpanded ? (
                      <ChevronDown className="w-3 h-3 text-gray-500" />
                    ) : (
                      <ChevronRight className="w-3 h-3 text-gray-500" />
                    )}
                    <span className="text-sm font-medium text-gray-200">
                      {CHAIN_LABEL[c.chainId] || c.chainId}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-[10px] text-gray-500">
                    {c.activeCount > 0 && (
                      <span className="text-amber-300">{c.activeCount} active</span>
                    )}
                    {c.completedCount > 0 && (
                      <span className="text-emerald-400">{c.completedCount} done</span>
                    )}
                  </div>
                </button>
                {isExpanded && (
                  <ul className="border-t border-white/5 divide-y divide-white/5">
                    {c.quests.map((q) => (
                      <li key={q.id} className="px-3 py-2 hover:bg-white/5 group">
                        <div className="flex items-start gap-2">
                          {q.status === 'completed' ? (
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 mt-0.5 flex-shrink-0" />
                          ) : (
                            <Circle className="w-3.5 h-3.5 text-amber-400 mt-0.5 flex-shrink-0" />
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between">
                              <span
                                className={cn(
                                  'text-xs',
                                  q.status === 'completed'
                                    ? 'text-gray-500 line-through'
                                    : 'text-gray-100 font-medium',
                                )}
                              >
                                {q.title}
                              </span>
                              <span className="text-[10px] text-gray-600 ml-2 flex-shrink-0">
                                {q.step}/{q.totalSteps}
                              </span>
                            </div>
                            {q.breadcrumb && q.status === 'active' && (
                              <p className="text-[11px] text-gray-500 mt-0.5 italic">
                                → {q.breadcrumb}
                              </p>
                            )}
                          </div>
                          {q.status === 'active' && (
                            <button
                              type="button"
                              onClick={() => togglePin(q.id)}
                              className={cn(
                                'p-1 rounded transition',
                                q.pinned
                                  ? 'text-amber-300'
                                  : 'text-gray-600 opacity-0 group-hover:opacity-100 hover:text-amber-300',
                              )}
                              aria-label={q.pinned ? 'Unpin quest' : 'Pin quest'}
                              title={q.pinned ? 'Unpin from HUD' : 'Pin to HUD'}
                            >
                              {q.pinned ? <PinOff className="w-3 h-3" /> : <Pin className="w-3 h-3" />}
                            </button>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

export default WorldQuestLogPanel;
