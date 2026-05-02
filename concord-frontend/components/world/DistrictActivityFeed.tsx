'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Zap,
  Star,
  CalendarDays,
  MessageCircle,
  ChevronDown,
  ChevronUp,
  Activity,
} from 'lucide-react';

interface FeedNPC {
  id: string;
  name: string;
  isConscious?: boolean;
  questAvailable?: boolean;
  faction?: string;
  position: { x: number; y: number };
}

interface WorldEvent {
  id: string;
  name: string;
  type: string;
  status: string;
  participant_count?: number;
}

interface WorldQuest {
  id: string;
  title: string;
  giver_npc_id?: string;
  status: string;
  description?: string;
}

interface DistrictActivityFeedProps {
  worldId: string;
  npcs: FeedNPC[];
  playerPosition: { x: number; y: number };
  onTalkToNpc: (npcId: string, npcName: string) => void;
  onOpenWorldEvents: () => void;
  onOpenQuestLog: () => void;
}

export function DistrictActivityFeed({
  worldId,
  npcs,
  playerPosition,
  onTalkToNpc,
  onOpenWorldEvents,
  onOpenQuestLog,
}: DistrictActivityFeedProps) {
  const [expanded, setExpanded] = useState(false);
  const [events, setEvents] = useState<WorldEvent[]>([]);
  const [quests, setQuests] = useState<WorldQuest[]>([]);

  const nearbyNPCs = npcs.filter(
    (n) => Math.hypot(n.position.x - playerPosition.x, n.position.y - playerPosition.y) < 12
  );
  const interestingNPCs = nearbyNPCs.filter((n) => n.isConscious || n.questAvailable);

  const refresh = useCallback(() => {
    fetch(`/api/worlds/${worldId}/events?status=active&limit=3`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.events) setEvents(d.events);
      })
      .catch(() => {});

    fetch(`/api/worlds/${worldId}/quests?status=available&limit=3`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.quests) setQuests(d.quests);
      })
      .catch(() => {});
  }, [worldId]);

  useEffect(() => {
    refresh();
    const iv = setInterval(refresh, 30_000);
    return () => clearInterval(iv);
  }, [refresh]);

  const actionCount = interestingNPCs.length + events.length + quests.length;
  const hasPulse = interestingNPCs.length > 0 || events.length > 0;

  if (actionCount === 0 && !expanded) return null;

  return (
    <div className="absolute top-4 left-4 z-[18] pointer-events-auto select-none">
      {/* Collapsed pill */}
      {!expanded && (
        <button
          onClick={() => setExpanded(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-black/75 border border-white/10 text-white/80 text-xs font-medium hover:bg-black/90 hover:border-white/20 transition-all"
        >
          <Activity
            className={`w-3.5 h-3.5 ${hasPulse ? 'text-emerald-400 animate-pulse' : 'text-white/50'}`}
          />
          <span>District Activity</span>
          {actionCount > 0 && (
            <span className="bg-emerald-500/80 text-white text-[9px] font-bold rounded-full px-1.5 py-0.5 leading-none">
              {actionCount}
            </span>
          )}
          <ChevronDown className="w-3 h-3 text-white/40" />
        </button>
      )}

      {/* Expanded panel */}
      {expanded && (
        <div className="w-60 bg-black/85 border border-white/10 rounded-xl shadow-xl shadow-black/40 overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-white/[0.08]">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-white/80">
              <Activity
                className={`w-3.5 h-3.5 ${hasPulse ? 'text-emerald-400 animate-pulse' : 'text-white/40'}`}
              />
              District Activity
            </div>
            <button
              onClick={() => setExpanded(false)}
              className="text-white/30 hover:text-white/60 transition-colors"
            >
              <ChevronUp className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="max-h-72 overflow-y-auto">
            {/* Nearby conscious / quest NPCs */}
            {interestingNPCs.length > 0 && (
              <div className="px-3 py-2">
                <div className="text-[9px] uppercase tracking-widest text-white/30 font-semibold mb-1.5">
                  Nearby
                </div>
                <div className="flex flex-col gap-1">
                  {interestingNPCs.slice(0, 4).map((npc) => (
                    <div key={npc.id} className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        {npc.isConscious ? (
                          <Zap className="w-3 h-3 text-yellow-400 flex-shrink-0" />
                        ) : (
                          <Star className="w-3 h-3 text-amber-400 flex-shrink-0" />
                        )}
                        <span className="text-xs text-white truncate">{npc.name}</span>
                        {npc.faction && (
                          <span className="text-[9px] text-white/30 truncate">{npc.faction}</span>
                        )}
                      </div>
                      <button
                        onClick={() => onTalkToNpc(npc.id, npc.name)}
                        className="flex-shrink-0 flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-cyan-500/20 border border-cyan-500/30 text-cyan-300 hover:bg-cyan-500/30 transition-colors"
                      >
                        <MessageCircle className="w-2.5 h-2.5" />
                        Talk
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Active events */}
            {events.length > 0 && (
              <>
                {interestingNPCs.length > 0 && <div className="border-t border-white/[0.05]" />}
                <div className="px-3 py-2">
                  <div className="text-[9px] uppercase tracking-widest text-white/30 font-semibold mb-1.5">
                    Events
                  </div>
                  <div className="flex flex-col gap-1.5">
                    {events.map((ev) => (
                      <div key={ev.id} className="flex items-start gap-1.5">
                        <CalendarDays className="w-3 h-3 text-purple-400 flex-shrink-0 mt-0.5" />
                        <div className="min-w-0">
                          <div className="text-xs text-white/80 truncate">{ev.name}</div>
                          <div className="text-[9px] text-white/30 capitalize">
                            {ev.type}
                            {ev.participant_count ? ` · ${ev.participant_count} attending` : ''}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}

            {/* Available quests */}
            {quests.length > 0 && (
              <>
                {(interestingNPCs.length > 0 || events.length > 0) && (
                  <div className="border-t border-white/[0.05]" />
                )}
                <div className="px-3 py-2">
                  <div className="text-[9px] uppercase tracking-widest text-white/30 font-semibold mb-1.5">
                    Quests
                  </div>
                  <div className="flex flex-col gap-1.5">
                    {quests.map((q) => (
                      <div key={q.id} className="flex items-start gap-1.5">
                        <Star className="w-3 h-3 text-amber-400 flex-shrink-0 mt-0.5" />
                        <div className="min-w-0">
                          <div className="text-xs text-white/80 truncate">{q.title}</div>
                          {q.description && (
                            <div className="text-[9px] text-white/30 truncate">{q.description}</div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}

            {actionCount === 0 && (
              <div className="px-3 py-4 text-center text-xs text-white/25">
                Nothing happening nearby right now
              </div>
            )}
          </div>

          {/* Footer action links */}
          <div className="border-t border-white/[0.08] flex">
            <button
              onClick={onOpenWorldEvents}
              className="flex-1 text-[10px] text-white/40 hover:text-white/70 py-1.5 transition-colors"
            >
              → Events
            </button>
            <div className="w-px bg-white/[0.08]" />
            <button
              onClick={onOpenQuestLog}
              className="flex-1 text-[10px] text-white/40 hover:text-white/70 py-1.5 transition-colors"
            >
              → Quests
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
