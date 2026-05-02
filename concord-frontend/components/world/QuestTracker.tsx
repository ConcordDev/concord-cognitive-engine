'use client';
import { useState, useEffect, useCallback } from 'react';
import {
  ChevronRight,
  Check,
  Loader2,
  Gift,
  Swords,
  Package,
  MessageSquare,
  MapPin,
} from 'lucide-react';

interface QuestObjective {
  id: string;
  type: 'kill' | 'gather' | 'talk_to' | 'deliver' | 'reach_location';
  target: string;
  required_count: number;
  description?: string;
  current_count: number;
  obj_completed_at?: number | null;
}

interface QuestReward {
  reward_type: string;
  reward_key?: string;
  amount: number;
}

interface Quest {
  id: string;
  title: string;
  description?: string;
  status: string;
  progress: QuestObjective[];
  rewards: QuestReward[];
}

interface QuestTrackerProps {
  worldId: string;
  onClaimReward: (questId: string, rewards: unknown[]) => void;
}

const OBJECTIVE_ICON: Record<string, React.ReactNode> = {
  kill: <Swords className="w-2.5 h-2.5" />,
  gather: <Package className="w-2.5 h-2.5" />,
  talk_to: <MessageSquare className="w-2.5 h-2.5" />,
  deliver: <Package className="w-2.5 h-2.5" />,
  reach_location: <MapPin className="w-2.5 h-2.5" />,
};

export function QuestTracker({ worldId, onClaimReward }: QuestTrackerProps) {
  const [quests, setQuests] = useState<Quest[]>([]);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [claiming, setClaiming] = useState<string | null>(null);

  const reload = useCallback(() => {
    fetch(`/api/worlds/${worldId}/quests/active`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.quests) setQuests(d.quests);
      })
      .catch(() => {});
  }, [worldId]);

  useEffect(() => {
    reload();
    const interval = setInterval(reload, 15_000);
    return () => clearInterval(interval);
  }, [reload]);

  const claimReward = async (quest: Quest) => {
    setClaiming(quest.id);
    try {
      const r = await fetch(`/api/worlds/${worldId}/quests/${quest.id}/claim-reward`, {
        method: 'POST',
      });
      const d = await r.json();
      if (d.ok) {
        onClaimReward(quest.id, d.rewards);
        setQuests((prev) => prev.filter((q) => q.id !== quest.id));
      }
    } catch {
      /* non-fatal */
    }
    setClaiming(null);
  };

  if (quests.length === 0) return null;

  return (
    <div className="flex flex-col gap-2 w-56">
      {quests.map((quest) => {
        const allDone =
          quest.progress.length > 0 && quest.progress.every((o) => o.obj_completed_at);
        const isCollapsed = collapsed[quest.id];

        return (
          <div
            key={quest.id}
            className={`bg-black/80 border rounded-xl overflow-hidden backdrop-blur-sm ${
              allDone ? 'border-amber-500/50' : 'border-white/15'
            }`}
          >
            <button
              onClick={() => setCollapsed((prev) => ({ ...prev, [quest.id]: !prev[quest.id] }))}
              className="w-full flex items-center gap-2 px-3 py-2 text-left"
            >
              {allDone ? (
                <Gift className="w-3 h-3 text-amber-400 flex-shrink-0" />
              ) : (
                <ChevronRight
                  className={`w-3 h-3 text-white/40 flex-shrink-0 transition-transform ${
                    !isCollapsed ? 'rotate-90' : ''
                  }`}
                />
              )}
              <span
                className={`text-xs font-medium truncate flex-1 ${
                  allDone ? 'text-amber-300' : 'text-white/80'
                }`}
              >
                {quest.title}
              </span>
            </button>

            {!isCollapsed && (
              <div className="px-3 pb-3">
                {quest.progress.map((obj) => {
                  const pct = Math.min(100, (obj.current_count / obj.required_count) * 100);
                  return (
                    <div key={obj.id} className="mb-2">
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <span
                          className={obj.obj_completed_at ? 'text-emerald-400' : 'text-white/40'}
                        >
                          {obj.obj_completed_at ? (
                            <Check className="w-2.5 h-2.5" />
                          ) : (
                            (OBJECTIVE_ICON[obj.type] ?? <Package className="w-2.5 h-2.5" />)
                          )}
                        </span>
                        <span className="text-[10px] text-white/60 flex-1 truncate">
                          {obj.description || `${obj.type} ${obj.target}`}
                        </span>
                        <span className="text-[9px] text-white/30">
                          {obj.current_count}/{obj.required_count}
                        </span>
                      </div>
                      <div className="h-0.5 bg-white/10 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${
                            obj.obj_completed_at ? 'bg-emerald-400' : 'bg-amber-400'
                          }`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}

                {allDone && (
                  <button
                    onClick={() => claimReward(quest)}
                    disabled={!!claiming}
                    className="w-full mt-1 flex items-center justify-center gap-1.5 text-[11px] bg-amber-500/20 text-amber-300 border border-amber-500/40 px-3 py-1.5 rounded-lg hover:bg-amber-500/30 transition-colors disabled:opacity-50"
                  >
                    {claiming === quest.id ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <Gift className="w-3 h-3" />
                    )}
                    Claim Reward
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
