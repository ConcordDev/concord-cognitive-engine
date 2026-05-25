'use client';

import React, { useMemo, useRef, useState } from 'react';

/* ── Types ─────────────────────────────────────────────────────── */

interface FeedItem {
  id: string;
  type: 'build' | 'citation' | 'milestone' | 'competition' | 'record' | 'validation';
  message: string;
  timestamp: number;
  userId?: string;
  district?: string;
}

interface PlayerCounts {
  online: number;
  building: number;
  spectating: number;
}

interface TrendingDTU {
  id: string;
  name: string;
  creator: string;
  citationsThisWeek: number;
  district: string;
}

interface Competition {
  id: string;
  name: string;
  entries: number;
  spectators: number;
  endsAt: string;
  district: string;
}

interface DistrictActivity {
  districtId: string;
  districtName: string;
  activityLevel: number; // 0–1
  activePlayers: number;
}

interface WeeklySummary {
  totalBuilds: number;
  totalCitations: number;
  topCreator: string;
  topEvent: string;
  newPlayers: number;
}

interface SocialProofFeedProps {
  feed?: FeedItem[];
  playerCounts?: PlayerCounts;
  trending?: TrendingDTU[];
  competitions?: Competition[];
  districtActivity?: DistrictActivity[];
  records?: FeedItem[];
  milestones?: FeedItem[];
  weeklySummary?: WeeklySummary;
  onNavigate?: (district: string) => void;
}

/* ── Constants ────────────────────────────────────────────────── */

const panel = 'bg-black/80 backdrop-blur-sm border border-white/10 rounded-lg';

const FEED_ICONS: Record<FeedItem['type'], string> = {
  build: '🏗',
  citation: '📄',
  milestone: '🏆',
  competition: '⚔️',
  record: '🎯',
  validation: '✅',
};

const ACTIVITY_COLORS = [
  'bg-gray-600', // 0–0.2
  'bg-green-700', // 0.2–0.4
  'bg-green-500', // 0.4–0.6
  'bg-yellow-500', // 0.6–0.8
  'bg-orange-500', // 0.8–1.0
];

/* ── Component ────────────────────────────────────────────────── */

export default function SocialProofFeed({
  feed = [],
  playerCounts,
  trending = [],
  competitions = [],
  districtActivity = [],
  records = [],
  milestones = [],
  weeklySummary,
  onNavigate,
}: SocialProofFeedProps) {
  const [showExpanded, setShowExpanded] = useState(false);
  const tickerRef = useRef<HTMLDivElement>(null);
  const [tickerPaused, setTickerPaused] = useState(false);

  // Auto-scroll ticker
  const recentFeed = useMemo(
    () => [...feed].sort((a, b) => b.timestamp - a.timestamp).slice(0, 20),
    [feed],
  );

  // Activity level color helper
  const getActivityColor = (level: number) => {
    const idx = Math.min(ACTIVITY_COLORS.length - 1, Math.floor(level * ACTIVITY_COLORS.length));
    return ACTIVITY_COLORS[idx];
  };

  const formatTime = (ts: number) => {
    const diff = Date.now() - ts;
    if (diff < 60000) return 'just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return `${Math.floor(diff / 86400000)}d ago`;
  };

  return (
    <div className="w-full space-y-3">
      {/* Live activity ticker (top bar) */}
      <div
        className={`${panel} px-3 py-2 overflow-hidden relative`}
        onMouseEnter={() => setTickerPaused(true)}
        onMouseLeave={() => setTickerPaused(false)}
      >
        <div className="flex items-center gap-3">
          {/* Player counts */}
          {playerCounts && (
            <div className="flex items-center gap-3 flex-shrink-0 border-r border-white/10 pr-3">
              <div className="flex items-center gap-1">
                <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                <span className="text-[10px] text-green-400 font-medium">
                  {playerCounts.online.toLocaleString()} online
                </span>
              </div>
              <span className="text-[10px] text-gray-400">
                {playerCounts.building} building
              </span>
            </div>
          )}

          {/* Scrolling feed */}
          <div ref={tickerRef} className="flex-1 overflow-hidden">
            <div
              className="flex gap-6 whitespace-nowrap"
              style={{
                animation: tickerPaused ? 'none' : `tickerScroll ${Math.max(20, recentFeed.length * 5)}s linear infinite`,
              }}
            >
              {recentFeed.map((item) => (
                <span key={item.id} className="text-[10px] text-gray-400 inline-flex items-center gap-1">
                  <span>{FEED_ICONS[item.type]}</span>
                  <span>{item.message}</span>
                  <span className="text-gray-600">{formatTime(item.timestamp)}</span>
                </span>
              ))}
              {recentFeed.length === 0 && (
                <span className="text-[10px] text-gray-400">Waiting for activity...</span>
              )}
            </div>
          </div>

          {/* Expand toggle */}
          <button
            onClick={() => setShowExpanded((prev) => !prev)}
            className="text-[10px] text-gray-400 hover:text-white flex-shrink-0 transition-colors"
          >
            {showExpanded ? 'Collapse' : 'Expand'}
          </button>
        </div>
      </div>

      {/* Expanded social proof panel */}
      {showExpanded && (
        <div className="grid grid-cols-3 gap-3">
          {/* Trending Creations */}
          <div className={`${panel} p-3`}>
            <h4 className="text-[10px] font-semibold text-gray-300 mb-2">Trending This Week</h4>
            {trending.length > 0 ? (
              <div className="space-y-1.5">
                {trending.slice(0, 5).map((dtu, i) => (
                  <div key={dtu.id} className="flex items-center gap-2">
                    <span className="text-[10px] font-bold text-gray-400 w-4">{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-[10px] text-white truncate">{dtu.name}</p>
                      <p className="text-[8px] text-gray-400">by @{dtu.creator} · {dtu.district}</p>
                    </div>
                    <span className="text-[9px] text-cyan-400 flex-shrink-0">
                      {dtu.citationsThisWeek} cited
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[10px] text-gray-400">No trending data yet.</p>
            )}
          </div>

          {/* Competitions */}
          <div className={`${panel} p-3`}>
            <h4 className="text-[10px] font-semibold text-gray-300 mb-2">Active Competitions</h4>
            {competitions.length > 0 ? (
              <div className="space-y-2">
                {competitions.map((comp) => (
                  <div key={comp.id} className="p-2 rounded bg-white/[0.03] border border-white/5">
                    <p className="text-[10px] font-medium text-white">{comp.name}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-[8px] text-gray-400">{comp.entries} entries</span>
                      <span className="text-[8px] text-gray-400">{comp.spectators.toLocaleString()} spectators</span>
                    </div>
                    <div className="flex items-center justify-between mt-1.5">
                      <span className="text-[8px] text-gray-400">Ends {comp.endsAt}</span>
                      {onNavigate && (
                        <button
                          onClick={() => onNavigate(comp.district)}
                          className="text-[8px] text-cyan-400 hover:text-cyan-300 transition-colors"
                        >
                          Spectate →
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[10px] text-gray-400">No active competitions.</p>
            )}
          </div>

          {/* District Activity */}
          <div className={`${panel} p-3`}>
            <h4 className="text-[10px] font-semibold text-gray-300 mb-2">District Activity</h4>
            <div className="space-y-1.5">
              {districtActivity.map((da) => (
                <div key={da.districtId} className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full ${getActivityColor(da.activityLevel)}`} />
                  <span className="text-[10px] text-gray-400 flex-1">{da.districtName}</span>
                  <span className="text-[8px] text-gray-400">{da.activePlayers} active</span>
                  {onNavigate && da.activityLevel > 0.5 && (
                    <button
                      onClick={() => onNavigate(da.districtId)}
                      className="text-[8px] text-cyan-400 hover:text-cyan-300 transition-colors"
                    >
                      Join
                    </button>
                  )}
                </div>
              ))}
            </div>
            {districtActivity.length === 0 && (
              <p className="text-[10px] text-gray-400">No activity data.</p>
            )}
          </div>

          {/* Record Alerts */}
          {records.length > 0 && (
            <div className={`${panel} p-3`}>
              <h4 className="text-[10px] font-semibold text-yellow-400 mb-2">Record Alerts</h4>
              <div className="space-y-1.5">
                {records.slice(0, 5).map((r) => (
                  <div key={r.id} className="flex items-start gap-2">
                    <span className="text-[10px]">🎯</span>
                    <div>
                      <p className="text-[10px] text-white">{r.message}</p>
                      <span className="text-[8px] text-gray-400">{formatTime(r.timestamp)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Milestone Stream */}
          {milestones.length > 0 && (
            <div className={`${panel} p-3`}>
              <h4 className="text-[10px] font-semibold text-purple-400 mb-2">Recent Milestones</h4>
              <div className="space-y-1.5">
                {milestones.slice(0, 5).map((m) => (
                  <div key={m.id} className="flex items-start gap-2">
                    <span className="text-[10px]">🏆</span>
                    <div>
                      <p className="text-[10px] text-gray-300">{m.message}</p>
                      <span className="text-[8px] text-gray-400">{formatTime(m.timestamp)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* This Week in Concordia */}
          {weeklySummary && (
            <div className={`${panel} p-3`}>
              <h4 className="text-[10px] font-semibold text-gray-300 mb-2">This Week in Concordia</h4>
              <div className="space-y-1">
                <div className="flex items-center justify-between text-[10px]">
                  <span className="text-gray-400">Total Builds</span>
                  <span className="text-white font-medium">{weeklySummary.totalBuilds.toLocaleString()}</span>
                </div>
                <div className="flex items-center justify-between text-[10px]">
                  <span className="text-gray-400">Citations</span>
                  <span className="text-cyan-400 font-medium">{weeklySummary.totalCitations.toLocaleString()}</span>
                </div>
                <div className="flex items-center justify-between text-[10px]">
                  <span className="text-gray-400">Top Creator</span>
                  <span className="text-yellow-400">@{weeklySummary.topCreator}</span>
                </div>
                <div className="flex items-center justify-between text-[10px]">
                  <span className="text-gray-400">Top Event</span>
                  <span className="text-white">{weeklySummary.topEvent}</span>
                </div>
                <div className="flex items-center justify-between text-[10px]">
                  <span className="text-gray-400">New Players</span>
                  <span className="text-green-400">+{weeklySummary.newPlayers.toLocaleString()}</span>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      <style jsx>{`
        @keyframes tickerScroll {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
      `}</style>
    </div>
  );
}
