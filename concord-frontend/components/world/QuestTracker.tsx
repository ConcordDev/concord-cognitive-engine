'use client';
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh';
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

// Theme 4 (game-feel pass): default to a single breadcrumb line — Ghost
// of Tsushima / Elden Ring lesson "hide UI in the world". Press J to
// expand to the legacy checklist. localStorage persists the choice
// across sessions.
//
// breadcrumb mode: the player sees one line — "Defeat 2 of 3 Ember
//                  Sprites" — at the top-center of the screen.
// list mode:       the original sidebar checklist.
//
// Toggle key: J (matches "journal").

type TrackerMode = 'breadcrumb' | 'list';

const STORAGE_KEY = 'concordia:questTracker:mode';

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
  /** Force a specific mode. If omitted the user's localStorage preference wins. */
  forceMode?: TrackerMode;
}

const OBJECTIVE_ICON: Record<string, React.ReactNode> = {
  kill: <Swords className="w-2.5 h-2.5" />,
  gather: <Package className="w-2.5 h-2.5" />,
  talk_to: <MessageSquare className="w-2.5 h-2.5" />,
  deliver: <Package className="w-2.5 h-2.5" />,
  reach_location: <MapPin className="w-2.5 h-2.5" />,
};

const VERB_FOR: Record<string, string> = {
  kill: 'Defeat',
  gather: 'Gather',
  talk_to: 'Speak with',
  deliver: 'Deliver to',
  reach_location: 'Travel to',
};

function readStoredMode(): TrackerMode {
  if (typeof window === 'undefined') return 'breadcrumb';
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    return v === 'list' ? 'list' : 'breadcrumb';
  } catch {
    return 'breadcrumb';
  }
}

/** Pick the highlighted quest + its next incomplete objective for breadcrumb. */
function pickBreadcrumb(quests: Quest[]): { quest: Quest; obj: QuestObjective } | null {
  // Prefer a quest with all objectives done (so the player gets the
  // "claim reward" cue diegetically). Otherwise, the first quest in the
  // list with an incomplete objective.
  const ready = quests.find((q) => q.progress.length > 0 && q.progress.every((o) => o.obj_completed_at));
  if (ready) return { quest: ready, obj: ready.progress[ready.progress.length - 1]! };
  for (const q of quests) {
    const obj = q.progress.find((o) => !o.obj_completed_at);
    if (obj) return { quest: q, obj };
  }
  return null;
}

export function QuestTracker({ worldId, onClaimReward, forceMode }: QuestTrackerProps) {
  const [quests, setQuests] = useState<Quest[]>([]);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [claiming, setClaiming] = useState<string | null>(null);
  // 'use client' file — readStoredMode is safe in the initialiser. Reading
  // localStorage synchronously here avoids the breadcrumb→list flip after
  // mount (and the test flake of "wait then assert").
  const [mode, setMode] = useState<TrackerMode>(() => forceMode ?? readStoredMode());
  const userTouchedMode = useRef(false);

  // Persist mode whenever the user explicitly changes it (not on first mount,
  // which would otherwise overwrite stored 'list' with default 'breadcrumb').
  useEffect(() => {
    if (forceMode) return;
    if (!userTouchedMode.current) return;
    try { window.localStorage.setItem(STORAGE_KEY, mode); } catch { /* ok */ }
  }, [mode, forceMode]);

  // Toggle on J press. Ignore when typing in an input/textarea/contenteditable.
  useEffect(() => {
    if (forceMode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'j' && e.key !== 'J') return;
      const tgt = e.target as HTMLElement | null;
      if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.isContentEditable)) return;
      userTouchedMode.current = true;
      setMode((prev) => (prev === 'breadcrumb' ? 'list' : 'breadcrumb'));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [forceMode]);

  const reload = useCallback(() => {
    fetch(`/api/worlds/${worldId}/quests/active`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.quests) setQuests(d.quests);
      })
      .catch(() => {});
  }, [worldId]);

  // Push: quest lifecycle events reload the tracker instantly; slow backstop poll.
  useRealtimeRefresh(['quest:new', 'quest:completed', 'quest:lineage-quest'], reload, { backstopMs: 30000 });

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

  const breadcrumb = useMemo(() => pickBreadcrumb(quests), [quests]);

  if (quests.length === 0) return null;

  // ── Breadcrumb (default) ──────────────────────────────────────────
  if (mode === 'breadcrumb') {
    if (!breadcrumb) return null;
    const { quest, obj } = breadcrumb;
    const allDone = quest.progress.length > 0 && quest.progress.every((o) => o.obj_completed_at);
    const verb = obj.description ?? `${VERB_FOR[obj.type] ?? 'Do'}: ${obj.target}`;
    return (
      <div className="flex flex-col items-center" data-testid="quest-breadcrumb">
        <div
          className={`flex items-center gap-2 px-3 py-1.5 bg-black/60 border rounded-full backdrop-blur-sm shadow-md ${
            allDone ? 'border-amber-500/50' : 'border-white/15'
          }`}
        >
          {allDone ? (
            <Gift className="w-3 h-3 text-amber-400 flex-shrink-0" />
          ) : (
            (OBJECTIVE_ICON[obj.type] ?? <Package className="w-2.5 h-2.5 text-white/60" />)
          )}
          <span className={`text-[11px] truncate max-w-[60vw] ${allDone ? 'text-amber-200' : 'text-white/80'}`}>
            {allDone ? `${quest.title} — Reward ready` : verb}
          </span>
          {!allDone && obj.required_count > 1 && (
            <span className="text-[10px] text-white/40 tabular-nums">
              {obj.current_count}/{obj.required_count}
            </span>
          )}
          {allDone && (
            <button
              onClick={() => claimReward(quest)}
              disabled={!!claiming}
              className="ml-1 text-[10px] bg-amber-500/20 text-amber-200 border border-amber-500/40 px-2 py-0.5 rounded-full hover:bg-amber-500/30 disabled:opacity-50"
            >
              {claiming === quest.id ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Claim'}
            </button>
          )}
        </div>
        <div className="text-[9px] text-white/30 mt-0.5 select-none">press J for journal</div>
      </div>
    );
  }

  // ── List mode (legacy) ────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-2 w-56" data-testid="quest-list">
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
      <div className="text-[9px] text-white/30 mt-0.5 select-none text-center">press J to collapse</div>
    </div>
  );
}
