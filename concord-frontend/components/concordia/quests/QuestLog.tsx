'use client';

import { useState, useEffect, useCallback } from 'react';
import type { Quest, QuestReward } from '@/lib/concordia/quest-system';
import { questTracker } from '@/lib/concordia/quest-system';
import { subscribe } from '@/lib/realtime/socket';
import { useUIStore } from '@/store/ui';

// ── Sub-components ────────────────────────────────────────────────────

function RewardSummary({ reward }: { reward: QuestReward }) {
  return (
    <div className="flex items-center gap-2 text-[10px] text-gray-400 flex-wrap">
      <span className="text-yellow-400">{reward.cc} CC</span>
      <span className="text-cyan-400">{reward.xp} XP</span>
      {reward.karmaBonus > 0 && <span className="text-green-400">+{reward.karmaBonus} karma</span>}
      {reward.factionRep && <span className="text-violet-400">+{reward.factionRep} rep</span>}
      {reward.perkPoint && <span className="text-amber-400">★ Perk Point</span>}
    </div>
  );
}

function ObjectiveRow({ progress, target, description }: { progress: number; target: number; description: string }) {
  const pct = Math.min(1, progress / target);
  const done = progress >= target;
  return (
    <div className="space-y-0.5">
      <div className="flex items-center justify-between text-[10px]">
        <span className={done ? 'text-green-400 line-through' : 'text-gray-300'}>{description}</span>
        <span className={done ? 'text-green-400' : 'text-gray-500'}>{progress}/{target}</span>
      </div>
      <div className="h-0.5 bg-white/10 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${done ? 'bg-green-400' : 'bg-cyan-400'}`}
          style={{ width: `${pct * 100}%` }}
        />
      </div>
    </div>
  );
}

function QuestCard({ quest, onAccept, onAbandon }: {
  quest: Quest;
  onAccept?: () => void;
  onAbandon?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const statusColors: Record<string, string> = {
    available: 'border-white/10',
    active:    'border-cyan-500/40',
    completed: 'border-green-500/40',
    failed:    'border-red-500/30 opacity-60',
  };

  return (
    <div
      className={`bg-black/70 border rounded-lg overflow-hidden transition-colors ${statusColors[quest.status]}`}
    >
      {/* Header */}
      <button
        className="w-full flex items-start justify-between gap-2 p-3 text-left hover:bg-white/5 transition-colors"
        onClick={() => setExpanded(e => !e)}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
              quest.status === 'active' ? 'bg-cyan-400 animate-pulse' :
              quest.status === 'completed' ? 'bg-green-400' :
              quest.status === 'failed' ? 'bg-red-400' : 'bg-gray-600'
            }`} />
            <span className="text-xs font-medium text-gray-200 truncate">{quest.title}</span>
          </div>
          <p className="text-[10px] text-gray-500 mt-0.5 ml-3.5">{quest.giverName} · {quest.domain}</p>
        </div>
        <span className="text-gray-600 text-xs flex-shrink-0">{expanded ? '▲' : '▼'}</span>
      </button>

      {/* Expanded body */}
      {expanded && (
        <div className="px-3 pb-3 space-y-2 border-t border-white/5 pt-2">
          <p className="text-[11px] text-gray-400 leading-relaxed">{quest.description}</p>

          <div className="space-y-1.5">
            {quest.objectives.map(obj => (
              <ObjectiveRow
                key={obj.id}
                progress={obj.progress}
                target={obj.target}
                description={obj.description}
              />
            ))}
          </div>

          <RewardSummary reward={quest.reward} />

          <div className="flex gap-2 pt-1">
            {quest.status === 'available' && onAccept && (
              <button
                onClick={onAccept}
                className="flex-1 py-1.5 rounded text-[11px] font-medium bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 hover:bg-cyan-500/30 transition-colors"
              >
                Accept
              </button>
            )}
            {quest.status === 'active' && onAbandon && (
              <button
                onClick={onAbandon}
                className="px-3 py-1.5 rounded text-[11px] text-gray-500 hover:text-red-400 border border-white/10 hover:border-red-500/30 transition-colors"
              >
                Abandon
              </button>
            )}
            {quest.status === 'completed' && (
              <span className="text-[11px] text-green-400">✓ Complete</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Quest Log ─────────────────────────────────────────────────────────

interface QuestLogProps {
  quests?: Quest[];
  worldId?: string;
  onClose: () => void;
}

function normaliseServerQuest(raw: Record<string, unknown>): Quest {
  return {
    id: raw.id as string,
    title: raw.title as string,
    description: (raw.description as string) || '',
    domain: (raw.domain as Quest['domain']) || 'mainland',
    giverId: (raw.giver_npc_id as string) || 'world',
    giverName: (raw.giver_npc_id as string) || 'World',
    status: (raw.status as Quest['status']) || 'available',
    objectives: Array.isArray(raw.objectives) ? raw.objectives as Quest['objectives'] : [],
    reward: (raw.reward as Quest['reward']) || { cc: 0, xp: 0, karmaBonus: 0 },
  };
}

export function QuestLog({ quests: propQuests, worldId, onClose }: QuestLogProps) {
  const [tab, setTab] = useState<'active' | 'available' | 'completed'>('active');
  const [serverQuests, setServerQuests] = useState<Quest[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchServerQuests = useCallback(async () => {
    if (!worldId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/worlds/${worldId}/quests?status=all`);
      if (!res.ok) return;
      const data = await res.json();
      const next = (data.quests || []).map(normaliseServerQuest);
      // Phase 18 polish-to-ten: fire quest-complete fanfare when a quest
      // transitions from non-completed to completed in this fetch. Compares
      // against the previous serverQuests state, so only fresh transitions
      // trigger the juice (re-mounts don't re-fire).
      setServerQuests((prev) => {
        const prevById = new Map(prev.map((q) => [q.id, q.status]));
        for (const q of next) {
          if (q.status === 'completed' && prevById.has(q.id) && prevById.get(q.id) !== 'completed') {
            try {
              window.dispatchEvent(new CustomEvent('concordia:game-juice', { detail: { trigger: 'quest-complete' } }));
            } catch { /* juice is best-effort */ }
          }
        }
        return next;
      });
    } finally {
      setLoading(false);
    }
  }, [worldId]);

  useEffect(() => { fetchServerQuests(); }, [fetchServerQuests]);

  // Realtime quest push: refetch + toast + ambient SFX when an emergent
  // quest arrives for the world the player is currently in.
  useEffect(() => {
    if (!worldId) return;
    const addToast = useUIStore.getState().addToast;
    const unsubscribe = subscribe<{ questId: string; worldId: string; title: string }>(
      'quest:new',
      (payload) => {
        if (payload.worldId && payload.worldId !== worldId) return;
        fetchServerQuests();
        addToast({
          type: 'info',
          message: `New quest: ${payload.title}`,
          duration: 8000,
        });
        try {
          window.dispatchEvent(new CustomEvent('concordia:soundscape-command', {
            detail: { action: 'triggerSFX', sfxId: 'notification-glow' },
          }));
        } catch { /* SFX is best-effort */ }
      },
    );
    return unsubscribe;
  }, [worldId, fetchServerQuests]);

  const handleAccept = useCallback(async (questId: string) => {
    if (worldId) {
      await fetch(`/api/worlds/${worldId}/quests/${questId}/accept`, { method: 'POST' });
      fetchServerQuests();
    } else {
      questTracker.accept(questId);
    }
  }, [worldId, fetchServerQuests]);

  const handleAbandon = useCallback((questId: string) => {
    questTracker.abandon(questId);
    if (worldId) fetchServerQuests();
  }, [worldId, fetchServerQuests]);

  const quests = worldId ? serverQuests : (propQuests || []);

  const filtered = quests.filter(q =>
    tab === 'active' ? q.status === 'active' :
    tab === 'available' ? q.status === 'available' :
    q.status === 'completed' || q.status === 'failed'
  );

  const counts = {
    active:    quests.filter(q => q.status === 'active').length,
    available: quests.filter(q => q.status === 'available').length,
    completed: quests.filter(q => q.status === 'completed' || q.status === 'failed').length,
  };

  return (
    <div className="absolute top-16 right-2 z-50 w-80 bg-black/90 border border-white/10 rounded-xl overflow-hidden backdrop-blur-sm">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
        <span className="text-sm font-semibold text-gray-200">Quest Log</span>
        <button onClick={onClose} className="text-gray-600 hover:text-gray-300 transition-colors text-xs">✕</button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-white/10">
        {(['active', 'available', 'completed'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-2 text-[11px] transition-colors capitalize ${
              tab === t ? 'text-cyan-300 border-b border-cyan-500' : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            {t} {counts[t] > 0 && <span className="ml-0.5 text-gray-600">({counts[t]})</span>}
          </button>
        ))}
      </div>

      {/* Quest list */}
      <div className="max-h-96 overflow-y-auto p-2 space-y-1.5">
        {loading ? (
          <p className="text-[11px] text-gray-600 text-center py-6">Loading quests…</p>
        ) : filtered.length === 0 ? (
          <p className="text-[11px] text-gray-600 text-center py-6">
            {tab === 'available' ? 'No quests available — explore more of the district.' :
             tab === 'active' ? 'No active quests. Accept one from Available.' :
             'No completed quests yet.'}
          </p>
        ) : (
          filtered.map(q => (
            <QuestCard
              key={q.id}
              quest={q}
              onAccept={q.status === 'available' ? () => handleAccept(q.id) : undefined}
              onAbandon={q.status === 'active' ? () => handleAbandon(q.id) : undefined}
            />
          ))
        )}
      </div>
    </div>
  );
}
