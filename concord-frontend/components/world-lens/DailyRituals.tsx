'use client';

import React, { useMemo, useState } from 'react';

/* ── Types ─────────────────────────────────────────────────────── */

interface CheckInData {
  lastLoginAt: string;
  currentLoginAt: string;
  daysSinceLastLogin: number;
}

interface OvernightSummary {
  royaltiesEarned: number;
  citationsReceived: number;
  worldEvents: { type: string; title: string; description: string }[];
  weatherChanges: { from: string; to: string; district: string }[];
  npcUpdates: { npcName: string; message: string }[];
  buildingStatusChanges: { buildingName: string; change: string }[];
}

interface StreakData {
  currentStreak: number;
  longestStreak: number;
  todayCheckedIn: boolean;
  rewards: { day: number; reward: string; claimed: boolean }[];
}

interface DailyChallenge {
  id: string;
  title: string;
  description: string;
  type: 'building' | 'engineering' | 'social' | 'exploration';
  difficulty: 'easy' | 'medium' | 'hard';
  reward: string;
  expiresAt: string;
  progress: number; // 0–1
  completed: boolean;
}

interface NewspaperHeadline {
  id: string;
  headline: string;
  summary: string;
  category: 'construction' | 'disaster' | 'competition' | 'governance' | 'economy' | 'social';
  importance: 'breaking' | 'major' | 'minor';
}

interface CommunityUpdate {
  type: 'request' | 'completed' | 'milestone';
  title: string;
  description: string;
  district: string;
}

interface WeatherForecast {
  today: { condition: string; temp: string; wind: string; implications: string };
  tomorrow: { condition: string; temp: string };
}

interface SuggestedAction {
  action: string;
  reason: string;
  district?: string;
}

interface DailyRitualsProps {
  checkIn?: CheckInData;
  overnightSummary?: OvernightSummary;
  streak?: StreakData;
  dailyChallenge?: DailyChallenge;
  newspaper?: NewspaperHeadline[];
  communityUpdates?: CommunityUpdate[];
  weatherForecast?: WeatherForecast;
  npcMemories?: { npcName: string; memory: string; district: string }[];
  suggestedAction?: SuggestedAction;
  onDismiss?: () => void;
  onNavigate?: (district: string) => void;
}

/* ── Constants ────────────────────────────────────────────────── */

const panel = 'bg-black/80 backdrop-blur-sm border border-white/10 rounded-lg';

const CATEGORY_COLORS: Record<NewspaperHeadline['category'], string> = {
  construction: 'text-cyan-400',
  disaster: 'text-red-400',
  competition: 'text-yellow-400',
  governance: 'text-purple-400',
  economy: 'text-green-400',
  social: 'text-blue-400',
};

const IMPORTANCE_STYLES: Record<NewspaperHeadline['importance'], string> = {
  breaking: 'border-l-2 border-red-500 pl-2',
  major: 'border-l-2 border-yellow-500/50 pl-2',
  minor: 'pl-2',
};

const CHALLENGE_COLORS: Record<DailyChallenge['difficulty'], string> = {
  easy: 'text-green-400 border-green-500/30',
  medium: 'text-yellow-400 border-yellow-500/30',
  hard: 'text-red-400 border-red-500/30',
};

const STREAK_MILESTONES = [3, 7, 14, 30, 60, 100];

/* ── Component ────────────────────────────────────────────────── */

type SectionId = 'newspaper' | 'overnight' | 'challenge' | 'community' | 'weather' | 'npc';

export default function DailyRituals({
  checkIn,
  overnightSummary,
  streak,
  dailyChallenge,
  newspaper = [],
  communityUpdates = [],
  weatherForecast,
  npcMemories = [],
  suggestedAction,
  onDismiss,
  onNavigate,
}: DailyRitualsProps) {
  const [expandedSection, setExpandedSection] = useState<SectionId | null>('newspaper');
  const [dismissed, setDismissed] = useState(false);

  const isReturningUser = checkIn && checkIn.daysSinceLastLogin > 0;
  const nextStreakMilestone = useMemo(() => {
    if (!streak) return null;
    return STREAK_MILESTONES.find((m) => m > streak.currentStreak) ?? null;
  }, [streak]);

  if (dismissed) return null;

  const toggleSection = (id: SectionId) => {
    setExpandedSection((prev) => (prev === id ? null : id));
  };

  const handleDismiss = () => {
    setDismissed(true);
    onDismiss?.();
  };

  return (
    <div className={`${panel} p-4 w-full max-w-lg`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-sm font-bold text-white">
            {isReturningUser ? 'While You Were Away...' : 'Good Morning, Concordia'}
          </h2>
          {checkIn && (
            <p className="text-[10px] text-gray-500">
              {isReturningUser
                ? `Last seen ${checkIn.daysSinceLastLogin} day${checkIn.daysSinceLastLogin > 1 ? 's' : ''} ago`
                : 'Welcome back'}
            </p>
          )}
        </div>
        <button
          onClick={handleDismiss}
          className="text-[10px] text-gray-500 hover:text-white transition-colors"
        >
          Dismiss
        </button>
      </div>

      {/* Login streak */}
      {streak && (
        <div className="mb-4 p-2.5 rounded bg-white/[0.03] border border-white/5">
          <div className="flex items-center justify-between mb-1.5">
            <div className="flex items-center gap-2">
              <span className="text-sm">🔥</span>
              <span className="text-xs font-bold text-orange-400">{streak.currentStreak}-day streak</span>
            </div>
            {nextStreakMilestone && (
              <span className="text-[9px] text-gray-500">
                {nextStreakMilestone - streak.currentStreak} days to next reward
              </span>
            )}
          </div>
          <div className="h-1 rounded-full bg-white/10 overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-orange-500 to-yellow-400"
              style={{
                width: nextStreakMilestone
                  ? `${(streak.currentStreak / nextStreakMilestone) * 100}%`
                  : '100%',
              }}
            />
          </div>
          {streak.rewards.filter((r) => !r.claimed).length > 0 && (
            <div className="flex gap-1.5 mt-2">
              {streak.rewards
                .filter((r) => !r.claimed)
                .map((r) => (
                  <span
                    key={r.day}
                    className="text-[8px] px-1.5 py-0.5 rounded bg-yellow-500/10 text-yellow-400 border border-yellow-500/20"
                  >
                    Day {r.day}: {r.reward}
                  </span>
                ))}
            </div>
          )}
        </div>
      )}

      {/* Overnight royalties / citations highlight */}
      {overnightSummary && (overnightSummary.royaltiesEarned > 0 || overnightSummary.citationsReceived > 0) && (
        <div className="grid grid-cols-2 gap-2 mb-4">
          {overnightSummary.royaltiesEarned > 0 && (
            <div className="p-2.5 rounded bg-yellow-500/5 border border-yellow-500/20 text-center">
              <p className="text-lg font-bold text-yellow-400">
                +{overnightSummary.royaltiesEarned.toLocaleString()}
              </p>
              <p className="text-[9px] text-yellow-400/60">royalties earned overnight</p>
            </div>
          )}
          {overnightSummary.citationsReceived > 0 && (
            <div className="p-2.5 rounded bg-cyan-500/5 border border-cyan-500/20 text-center">
              <p className="text-lg font-bold text-cyan-400">
                +{overnightSummary.citationsReceived}
              </p>
              <p className="text-[9px] text-cyan-400/60">new citations</p>
            </div>
          )}
        </div>
      )}

      {/* Collapsible sections */}
      <div className="space-y-1">
        {/* Morning Newspaper */}
        {newspaper.length > 0 && (
          <div>
            <button
              onClick={() => toggleSection('newspaper')}
              className="w-full flex items-center justify-between py-2 text-left"
            >
              <span className="text-[10px] font-semibold text-gray-300">
                📰 Morning Newspaper ({newspaper.length})
              </span>
              <span className="text-[10px] text-gray-600">
                {expandedSection === 'newspaper' ? '−' : '+'}
              </span>
            </button>
            {expandedSection === 'newspaper' && (
              <div className="space-y-1.5 pb-2">
                {newspaper.map((h) => (
                  <div key={h.id} className={`py-1.5 ${IMPORTANCE_STYLES[h.importance]}`}>
                    <div className="flex items-center gap-1.5">
                      {h.importance === 'breaking' && (
                        <span className="text-[8px] px-1 py-0.5 rounded bg-red-500/20 text-red-400 font-bold">
                          BREAKING
                        </span>
                      )}
                      <span className={`text-[10px] font-medium ${CATEGORY_COLORS[h.category]}`}>
                        {h.headline}
                      </span>
                    </div>
                    <p className="text-[9px] text-gray-500 mt-0.5">{h.summary}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Overnight details */}
        {overnightSummary && (overnightSummary.worldEvents.length > 0 || overnightSummary.buildingStatusChanges.length > 0) && (
          <div>
            <button
              onClick={() => toggleSection('overnight')}
              className="w-full flex items-center justify-between py-2 text-left"
            >
              <span className="text-[10px] font-semibold text-gray-300">🌙 Overnight Events</span>
              <span className="text-[10px] text-gray-600">
                {expandedSection === 'overnight' ? '−' : '+'}
              </span>
            </button>
            {expandedSection === 'overnight' && (
              <div className="space-y-1.5 pb-2">
                {overnightSummary.worldEvents.map((e, i) => (
                  <div key={i} className="text-[10px] text-gray-400">
                    <span className="text-gray-300 font-medium">{e.title}:</span> {e.description}
                  </div>
                ))}
                {overnightSummary.weatherChanges.map((w, i) => (
                  <div key={`w-${i}`} className="text-[10px] text-gray-500">
                    Weather in {w.district}: {w.from} → {w.to}
                  </div>
                ))}
                {overnightSummary.buildingStatusChanges.map((b, i) => (
                  <div key={`b-${i}`} className="text-[10px] text-gray-500">
                    {b.buildingName}: {b.change}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Daily challenge */}
        {dailyChallenge && (
          <div>
            <button
              onClick={() => toggleSection('challenge')}
              className="w-full flex items-center justify-between py-2 text-left"
            >
              <span className="text-[10px] font-semibold text-gray-300">
                ⚡ Daily Challenge
                {dailyChallenge.completed && <span className="text-green-400 ml-1">✓</span>}
              </span>
              <span className="text-[10px] text-gray-600">
                {expandedSection === 'challenge' ? '−' : '+'}
              </span>
            </button>
            {expandedSection === 'challenge' && (
              <div className={`p-2.5 rounded bg-white/[0.03] border ${CHALLENGE_COLORS[dailyChallenge.difficulty]} mb-2`}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] font-medium text-white">{dailyChallenge.title}</span>
                  <span className={`text-[8px] px-1 py-0.5 rounded capitalize ${CHALLENGE_COLORS[dailyChallenge.difficulty]}`}>
                    {dailyChallenge.difficulty}
                  </span>
                </div>
                <p className="text-[9px] text-gray-400 mb-2">{dailyChallenge.description}</p>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[8px] text-gray-500">Progress</span>
                  <span className="text-[8px] text-gray-500">{Math.round(dailyChallenge.progress * 100)}%</span>
                </div>
                <div className="h-1 rounded-full bg-white/10 overflow-hidden mb-1.5">
                  <div
                    className={`h-full rounded-full ${dailyChallenge.completed ? 'bg-green-500' : 'bg-cyan-500'}`}
                    style={{ width: `${dailyChallenge.progress * 100}%` }}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[8px] text-yellow-400">Reward: {dailyChallenge.reward}</span>
                  <span className="text-[8px] text-gray-600">Expires {dailyChallenge.expiresAt}</span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Community board */}
        {communityUpdates.length > 0 && (
          <div>
            <button
              onClick={() => toggleSection('community')}
              className="w-full flex items-center justify-between py-2 text-left"
            >
              <span className="text-[10px] font-semibold text-gray-300">
                🏘️ Community Board ({communityUpdates.length})
              </span>
              <span className="text-[10px] text-gray-600">
                {expandedSection === 'community' ? '−' : '+'}
              </span>
            </button>
            {expandedSection === 'community' && (
              <div className="space-y-1.5 pb-2">
                {communityUpdates.map((u, i) => (
                  <div key={i} className="flex items-start gap-2 text-[10px]">
                    <span>
                      {u.type === 'request' && '📋'}
                      {u.type === 'completed' && '✅'}
                      {u.type === 'milestone' && '🎉'}
                    </span>
                    <div>
                      <p className="text-gray-300">{u.title}</p>
                      <p className="text-[9px] text-gray-500">{u.description}</p>
                      {onNavigate && (
                        <button
                          onClick={() => onNavigate(u.district)}
                          className="text-[8px] text-cyan-400 hover:text-cyan-300 mt-0.5 transition-colors"
                        >
                          Visit {u.district} →
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Weather forecast */}
        {weatherForecast && (
          <div>
            <button
              onClick={() => toggleSection('weather')}
              className="w-full flex items-center justify-between py-2 text-left"
            >
              <span className="text-[10px] font-semibold text-gray-300">
                🌤️ Weather Forecast
              </span>
              <span className="text-[10px] text-gray-600">
                {expandedSection === 'weather' ? '−' : '+'}
              </span>
            </button>
            {expandedSection === 'weather' && (
              <div className="grid grid-cols-2 gap-2 pb-2">
                <div className="p-2 rounded bg-white/[0.03]">
                  <p className="text-[9px] text-gray-500 mb-1">Today</p>
                  <p className="text-[10px] text-white">{weatherForecast.today.condition}</p>
                  <p className="text-[9px] text-gray-500">{weatherForecast.today.temp} · Wind: {weatherForecast.today.wind}</p>
                  <p className="text-[9px] text-yellow-400/70 mt-1">{weatherForecast.today.implications}</p>
                </div>
                <div className="p-2 rounded bg-white/[0.03]">
                  <p className="text-[9px] text-gray-500 mb-1">Tomorrow</p>
                  <p className="text-[10px] text-white">{weatherForecast.tomorrow.condition}</p>
                  <p className="text-[9px] text-gray-500">{weatherForecast.tomorrow.temp}</p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* NPC memories */}
        {npcMemories.length > 0 && (
          <div>
            <button
              onClick={() => toggleSection('npc')}
              className="w-full flex items-center justify-between py-2 text-left"
            >
              <span className="text-[10px] font-semibold text-gray-300">
                💬 NPC Memories ({npcMemories.length})
              </span>
              <span className="text-[10px] text-gray-600">
                {expandedSection === 'npc' ? '−' : '+'}
              </span>
            </button>
            {expandedSection === 'npc' && (
              <div className="space-y-1.5 pb-2">
                {npcMemories.map((npc, i) => (
                  <div key={i} className="p-2 rounded bg-white/[0.03] text-[10px]">
                    <span className="text-purple-400 font-medium">{npc.npcName}</span>
                    <span className="text-gray-600"> at {npc.district}</span>
                    <p className="text-gray-400 mt-0.5 italic">&ldquo;{npc.memory}&rdquo;</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Suggested action */}
      {suggestedAction && (
        <div className="mt-4 pt-3 border-t border-white/5">
          <p className="text-[9px] text-gray-500 mb-1.5">Start your day</p>
          <button
            onClick={() => suggestedAction.district && onNavigate?.(suggestedAction.district)}
            className="w-full text-left p-2.5 rounded bg-cyan-500/5 border border-cyan-500/20 hover:bg-cyan-500/10 transition-colors"
          >
            <p className="text-[10px] text-cyan-400 font-medium">{suggestedAction.action}</p>
            <p className="text-[9px] text-gray-500 mt-0.5">{suggestedAction.reason}</p>
          </button>
        </div>
      )}
    </div>
  );
}
