'use client';

import React, { useState, useCallback, useEffect } from 'react';
import {
  X, ScrollText, MapPin, Hammer, PackageCheck, MessageSquare,
  ShieldAlert, Search as SearchIcon, Wrench, CheckCircle2, Circle,
  Star, Coins, Trophy, Filter,
  AlertCircle, Sparkles,
} from 'lucide-react';

/* ── Types ─────────────────────────────────────────────────────── */

type QuestCategory = 'main' | 'side' | 'daily' | 'chain' | 'community';

type ObjectiveType =
  | 'go-to-location'
  | 'build-something'
  | 'deliver-item'
  | 'talk-to-npc'
  | 'survive-disaster'
  | 'inspect-structure'
  | 'craft-item';

interface QuestObjective {
  id: string;
  type: ObjectiveType;
  description: string;
  current: number;
  target: number;
  completed: boolean;
}

interface QuestReward {
  type: 'currency' | 'component' | 'reputation' | 'access' | 'title';
  label: string;
  amount?: number;
}

interface Quest {
  id: string;
  title: string;
  description: string;
  category: QuestCategory;
  questGiver?: string;
  objectives: QuestObjective[];
  rewards: QuestReward[];
  chainIndex?: number;
  chainTotal?: number;
  status: 'active' | 'available' | 'completed';
  district?: string;
}

interface QuestPanelProps {
  quests?: Quest[];
  worldId?: string;
  activeQuest?: string | null;
  onAccept?: (questId: string) => void;
  onAbandon?: (questId: string) => void;
  onTrack?: (questId: string) => void;
  onClose?: () => void;
}

/* ── Constants ─────────────────────────────────────────────────── */

const panel = 'bg-black/80 backdrop-blur-sm border border-white/10 rounded-lg';

const CATEGORY_META: Record<QuestCategory, { label: string; color: string }> = {
  main:      { label: 'Main',      color: 'text-yellow-400 bg-yellow-500/20 border-yellow-500/40' },
  side:      { label: 'Side',      color: 'text-blue-400 bg-blue-500/20 border-blue-500/40' },
  daily:     { label: 'Daily',     color: 'text-green-400 bg-green-500/20 border-green-500/40' },
  chain:     { label: 'Chain',     color: 'text-purple-400 bg-purple-500/20 border-purple-500/40' },
  community: { label: 'Community', color: 'text-pink-400 bg-pink-500/20 border-pink-500/40' },
};

const OBJECTIVE_ICONS: Record<ObjectiveType, React.ComponentType<{ className?: string }>> = {
  'go-to-location':    MapPin,
  'build-something':   Hammer,
  'deliver-item':      PackageCheck,
  'talk-to-npc':       MessageSquare,
  'survive-disaster':  ShieldAlert,
  'inspect-structure': SearchIcon,
  'craft-item':        Wrench,
};

const REWARD_ICONS: Record<QuestReward['type'], React.ComponentType<{ className?: string }>> = {
  currency:   Coins,
  component:  PackageCheck,
  reputation: Star,
  access:     MapPin,
  title:      Trophy,
};

/* ── Backend → panel adapter (defensive: unknown columns degrade gracefully) ── */

function adaptQuest(q: Record<string, unknown>): Quest {
  const cat = String(q.category ?? '');
  const status = String(q.status ?? 'available');
  const rawObj = Array.isArray(q.objectives) ? q.objectives : [];
  const rawReward = (q.reward ?? q.rewards) as unknown;
  const objectives: QuestObjective[] = rawObj.map((o: Record<string, unknown>, i: number) => ({
    id: String(o?.id ?? i),
    type: (String(o?.type ?? 'custom') as ObjectiveType),
    description: String(o?.description ?? o?.text ?? ''),
    current: Number(o?.current ?? 0),
    target: Number(o?.target ?? 1),
    completed: !!(o?.completed ?? o?.done),
  }));
  let rewards: QuestReward[] = [];
  if (Array.isArray(rawReward)) {
    rewards = rawReward.map((r: Record<string, unknown>) => ({
      type: (String(r?.type ?? 'currency') as QuestReward['type']),
      label: String(r?.label ?? r?.name ?? ''),
      amount: r?.amount != null ? Number(r.amount) : undefined,
    }));
  } else if (rawReward && typeof rawReward === 'object') {
    const r = rawReward as Record<string, unknown>;
    if (r.amount != null || r.label != null || r.currency != null) {
      rewards = [{ type: 'currency', label: String(r.label ?? 'Reward'), amount: r.amount != null ? Number(r.amount) : (r.currency != null ? Number(r.currency) : undefined) }];
    }
  }
  return {
    id: String(q.id ?? ''),
    title: String(q.title ?? q.name ?? 'Quest'),
    description: String(q.description ?? ''),
    category: (['main', 'side', 'daily', 'chain'].includes(cat) ? cat : 'side') as QuestCategory,
    questGiver: String(q.questGiver ?? q.giver_npc_id ?? q.giver ?? '') || undefined,
    objectives,
    rewards,
    status: (['active', 'available', 'completed'].includes(status) ? status : 'available') as Quest['status'],
    district: String(q.district ?? q.region ?? '') || undefined,
  };
}

/* ── Component ─────────────────────────────────────────────────── */

export default function QuestPanel({
  quests: questsProp,
  worldId,
  activeQuest: trackedQuestId = 'q1',
  onAccept,
  onAbandon,
  onTrack,
  onClose,
}: QuestPanelProps) {
  // Real quests come from /api/worlds/:worldId/quests. Start EMPTY — never seed
  // fabricated quests. The list is whatever the backend returns (or nothing).
  const [quests, setQuests] = useState<Quest[]>(questsProp ?? []);
  useEffect(() => {
    if (questsProp) return; // caller supplied data — respect it
    let cancelled = false;
    (async () => {
      try {
        const wid = worldId || 'concordia-hub';
        const grab = (status: string) =>
          fetch(`/api/worlds/${encodeURIComponent(wid)}/quests?status=${status}`, { credentials: 'include' })
            .then((r) => (r.ok ? r.json() : null)).catch(() => null);
        const [avail, active] = await Promise.all([grab('available'), grab('active')]);
        const rows = [...(avail?.quests ?? []), ...(active?.quests ?? [])];
        if (!cancelled) setQuests(rows.map(adaptQuest));
      } catch { if (!cancelled) setQuests([]); }
    })();
    return () => { cancelled = true; };
  }, [worldId, questsProp]);

  const [categoryFilter, setCategoryFilter] = useState<QuestCategory | 'all'>('all');
  const [statusFilter, setStatusFilter] = useState<'active' | 'available' | 'completed' | 'all'>('all');
  const [selectedQuestId, setSelectedQuestId] = useState<string | null>(trackedQuestId);

  const filtered = quests
    .filter((q) => categoryFilter === 'all' || q.category === categoryFilter)
    .filter((q) => statusFilter === 'all' || q.status === statusFilter);

  const activeQuests = filtered.filter((q) => q.status === 'active');
  const availableQuests = filtered.filter((q) => q.status === 'available');
  const completedQuests = filtered.filter((q) => q.status === 'completed');

  const selectedQuest = quests.find((q) => q.id === selectedQuestId) ?? null;

  const questProgress = useCallback((quest: Quest) => {
    const total = quest.objectives.length;
    const done = quest.objectives.filter((o) => o.completed).length;
    return { done, total, pct: total > 0 ? Math.round((done / total) * 100) : 0 };
  }, []);

  return (
    <div className={`w-[460px] flex flex-col max-h-[calc(100vh-4rem)] ${panel} overflow-hidden`}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
        <div className="flex items-center gap-2">
          <ScrollText className="w-4 h-4 text-cyan-400" />
          <h2 className="text-sm font-semibold">Quest Journal</h2>
          <span className="text-[10px] text-gray-400">
            {quests.filter((q) => q.status === 'active').length} active
          </span>
        </div>
        {onClose && (
          <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Category filter */}
      <div className="flex items-center gap-1 px-3 py-2 border-b border-white/5 overflow-x-auto">
        <button
          onClick={() => setCategoryFilter('all')}
          className={`px-2 py-1 text-[10px] rounded whitespace-nowrap transition-colors ${
            categoryFilter === 'all'
              ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/40'
              : 'text-gray-400 hover:text-gray-300'
          }`}
        >
          All
        </button>
        {(Object.keys(CATEGORY_META) as QuestCategory[]).map((cat) => {
          const meta = CATEGORY_META[cat];
          return (
            <button
              key={cat}
              onClick={() => setCategoryFilter(cat)}
              className={`px-2 py-1 text-[10px] rounded whitespace-nowrap transition-colors ${
                categoryFilter === cat
                  ? meta.color + ' border'
                  : 'text-gray-400 hover:text-gray-300'
              }`}
            >
              {meta.label}
            </button>
          );
        })}
      </div>

      {/* Status filter */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-white/5">
        <Filter className="w-3 h-3 text-gray-600" />
        {(['all', 'active', 'available', 'completed'] as const).map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`text-[10px] capitalize transition-colors ${
              statusFilter === s ? 'text-cyan-400' : 'text-gray-600 hover:text-gray-400'
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Quest list */}
        <div className="w-48 border-r border-white/5 overflow-y-auto">
          {/* Active quests */}
          {activeQuests.length > 0 && (
            <>
              <p className="text-[9px] text-gray-400 uppercase tracking-wider px-3 pt-2 pb-1">
                Active ({activeQuests.length})
              </p>
              {activeQuests.map((quest) => {
                const prog = questProgress(quest);
                const catMeta = CATEGORY_META[quest.category];
                return (
                  <button
                    key={quest.id}
                    onClick={() => setSelectedQuestId(quest.id)}
                    className={`w-full text-left px-3 py-2 border-b border-white/5 transition-colors ${
                      selectedQuestId === quest.id ? 'bg-white/10' : 'hover:bg-white/5'
                    }`}
                  >
                    <div className="flex items-center gap-1.5">
                      {quest.id === trackedQuestId && (
                        <Sparkles className="w-3 h-3 text-yellow-400 shrink-0" />
                      )}
                      <span className="text-[11px] text-white truncate flex-1">{quest.title}</span>
                    </div>
                    <div className="flex items-center gap-1.5 mt-1">
                      <span className={`text-[8px] px-1 py-0.5 rounded border ${catMeta.color}`}>
                        {catMeta.label}
                      </span>
                      <div className="flex-1 h-1 rounded-full bg-white/10 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-cyan-500/60"
                          style={{ width: `${prog.pct}%` }}
                        />
                      </div>
                      <span className="text-[8px] text-gray-400">{prog.done}/{prog.total}</span>
                    </div>
                  </button>
                );
              })}
            </>
          )}

          {/* Available quests */}
          {availableQuests.length > 0 && (
            <>
              <p className="text-[9px] text-gray-400 uppercase tracking-wider px-3 pt-2 pb-1">
                Available ({availableQuests.length})
              </p>
              {availableQuests.map((quest) => {
                const catMeta = CATEGORY_META[quest.category];
                return (
                  <button
                    key={quest.id}
                    onClick={() => setSelectedQuestId(quest.id)}
                    className={`w-full text-left px-3 py-2 border-b border-white/5 transition-colors ${
                      selectedQuestId === quest.id ? 'bg-white/10' : 'hover:bg-white/5'
                    }`}
                  >
                    <div className="flex items-center gap-1.5">
                      <AlertCircle className="w-3 h-3 text-yellow-400 shrink-0" />
                      <span className="text-[11px] text-gray-300 truncate flex-1">{quest.title}</span>
                    </div>
                    <div className="mt-1">
                      <span className={`text-[8px] px-1 py-0.5 rounded border ${catMeta.color}`}>
                        {catMeta.label}
                      </span>
                      {quest.district && (
                        <span className="text-[8px] text-gray-400 ml-1.5">{quest.district}</span>
                      )}
                    </div>
                  </button>
                );
              })}
            </>
          )}

          {/* Completed quests */}
          {completedQuests.length > 0 && (
            <>
              <p className="text-[9px] text-gray-400 uppercase tracking-wider px-3 pt-2 pb-1">
                Completed ({completedQuests.length})
              </p>
              {completedQuests.map((quest) => (
                <button
                  key={quest.id}
                  onClick={() => setSelectedQuestId(quest.id)}
                  className={`w-full text-left px-3 py-2 border-b border-white/5 transition-colors ${
                    selectedQuestId === quest.id ? 'bg-white/10' : 'hover:bg-white/5'
                  }`}
                >
                  <div className="flex items-center gap-1.5">
                    <CheckCircle2 className="w-3 h-3 text-green-400 shrink-0" />
                    <span className="text-[11px] text-gray-400 truncate flex-1 line-through">{quest.title}</span>
                  </div>
                </button>
              ))}
            </>
          )}

          {filtered.length === 0 && (
            <div className="px-3 py-6 text-center">
              <ScrollText className="w-6 h-6 text-gray-700 mx-auto mb-1" />
              <p className="text-[10px] text-gray-400">No quests match your filters.</p>
            </div>
          )}
        </div>

        {/* Quest detail */}
        <div className="flex-1 overflow-y-auto p-3">
          {!selectedQuest ? (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <ScrollText className="w-8 h-8 text-gray-700 mb-2" />
              <p className="text-xs text-gray-400">Select a quest to view details.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {/* Title + category */}
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="text-sm font-semibold text-white">{selectedQuest.title}</h3>
                  <span className={`text-[8px] px-1.5 py-0.5 rounded border ${CATEGORY_META[selectedQuest.category].color}`}>
                    {CATEGORY_META[selectedQuest.category].label}
                  </span>
                </div>
                <p className="text-[11px] text-gray-400">{selectedQuest.description}</p>
                {selectedQuest.questGiver && (
                  <p className="text-[10px] text-gray-400 mt-1 flex items-center gap-1">
                    <MessageSquare className="w-3 h-3" />
                    Quest from: <span className="text-cyan-400">{selectedQuest.questGiver}</span>
                  </p>
                )}
              </div>

              {/* Chain visualization */}
              {selectedQuest.chainIndex !== undefined && selectedQuest.chainTotal !== undefined && (
                <div className="flex items-center gap-1">
                  {Array.from({ length: selectedQuest.chainTotal }).map((_, i) => (
                    <React.Fragment key={i}>
                      <div
                        className={`w-3 h-3 rounded-full border ${
                          i < selectedQuest.chainIndex!
                            ? 'bg-cyan-500/60 border-cyan-500/80'
                            : i === selectedQuest.chainIndex!
                            ? 'bg-yellow-500/60 border-yellow-500/80 ring-1 ring-yellow-400/40'
                            : 'bg-white/10 border-white/20'
                        }`}
                      />
                      {i < selectedQuest.chainTotal! - 1 && (
                        <div className={`w-4 h-0.5 ${i < selectedQuest.chainIndex! ? 'bg-cyan-500/40' : 'bg-white/10'}`} />
                      )}
                    </React.Fragment>
                  ))}
                  <span className="text-[9px] text-gray-400 ml-1">
                    Step {selectedQuest.chainIndex + 1} of {selectedQuest.chainTotal}
                  </span>
                </div>
              )}

              {/* Objectives */}
              <div>
                <p className="text-[10px] text-gray-400 uppercase tracking-wider mb-1.5">Objectives</p>
                <div className="space-y-1">
                  {selectedQuest.objectives.map((obj) => {
                    const ObjIcon = OBJECTIVE_ICONS[obj.type];
                    const pct = obj.target > 0 ? Math.round((obj.current / obj.target) * 100) : 0;
                    return (
                      <div
                        key={obj.id}
                        className={`flex items-start gap-2 p-1.5 rounded border transition-colors ${
                          obj.completed
                            ? 'bg-green-500/5 border-green-500/20'
                            : 'bg-white/5 border-white/5'
                        }`}
                      >
                        {obj.completed ? (
                          <CheckCircle2 className="w-3.5 h-3.5 text-green-400 shrink-0 mt-0.5" />
                        ) : (
                          <Circle className="w-3.5 h-3.5 text-gray-600 shrink-0 mt-0.5" />
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <ObjIcon className="w-3 h-3 text-gray-400" />
                            <span className={`text-[11px] ${obj.completed ? 'text-gray-400 line-through' : 'text-gray-300'}`}>
                              {obj.description}
                            </span>
                          </div>
                          {!obj.completed && obj.target > 1 && (
                            <div className="flex items-center gap-2 mt-1">
                              <div className="flex-1 h-1 rounded-full bg-white/10 overflow-hidden">
                                <div
                                  className="h-full rounded-full bg-cyan-500/50"
                                  style={{ width: `${pct}%` }}
                                />
                              </div>
                              <span className="text-[9px] text-gray-400">{obj.current}/{obj.target}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Rewards */}
              <div>
                <p className="text-[10px] text-gray-400 uppercase tracking-wider mb-1.5">Rewards</p>
                <div className="flex flex-wrap gap-1.5">
                  {selectedQuest.rewards.map((reward, i) => {
                    const RIcon = REWARD_ICONS[reward.type];
                    return (
                      <div
                        key={i}
                        className="flex items-center gap-1 px-2 py-1 rounded bg-white/5 border border-white/10 text-[10px] text-gray-300"
                      >
                        <RIcon className="w-3 h-3 text-yellow-400" />
                        {reward.label}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Actions */}
              <div className="flex gap-2 pt-1">
                {selectedQuest.status === 'available' && (
                  <button
                    onClick={() => onAccept?.(selectedQuest.id)}
                    className="flex-1 py-1.5 rounded text-xs font-semibold bg-cyan-500/20 text-cyan-400 border border-cyan-500/40 hover:bg-cyan-500/30 transition-colors"
                  >
                    Accept Quest
                  </button>
                )}
                {selectedQuest.status === 'active' && (
                  <>
                    <button
                      onClick={() => onTrack?.(selectedQuest.id)}
                      className={`flex-1 py-1.5 rounded text-xs font-semibold transition-colors ${
                        trackedQuestId === selectedQuest.id
                          ? 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/40'
                          : 'bg-white/10 text-gray-400 border border-white/10 hover:bg-white/15'
                      }`}
                    >
                      {trackedQuestId === selectedQuest.id ? 'Tracking' : 'Track'}
                    </button>
                    <button
                      onClick={() => onAbandon?.(selectedQuest.id)}
                      className="py-1.5 px-3 rounded text-xs text-red-400/70 border border-red-500/20 hover:bg-red-500/10 transition-colors"
                    >
                      Abandon
                    </button>
                  </>
                )}
                {selectedQuest.status === 'completed' && (
                  <div className="flex items-center gap-1.5 text-xs text-green-400">
                    <CheckCircle2 className="w-4 h-4" />
                    Quest Completed
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Footer notice */}
      <div className="px-3 py-2 border-t border-white/5">
        <p className="text-[9px] text-gray-400 flex items-center gap-1">
          <Coins className="w-3 h-3 text-yellow-400/60" />
          Quest designers earn royalties when players complete their quests.
        </p>
      </div>
    </div>
  );
}
