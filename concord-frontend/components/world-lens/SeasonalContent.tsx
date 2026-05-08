'use client';

import React, { useState, useMemo } from 'react';

// ── Types ──────────────────────────────────────────────────────────

type Season = 'spring' | 'summer' | 'fall' | 'winter';

interface SeasonalEventData {
  id: string;
  name: string;
  season: Season;
  startDate: string;
  endDate: string;
  description: string;
  type: 'holiday' | 'challenge' | 'competition' | 'festival';
}

interface MonthlyChallenge {
  id: string;
  title: string;
  description: string;
  objective: string;
  progress: number;
  maxProgress: number;
  reward: { type: string; value: string };
  leaderboardId: string;
}

interface AnnualCompetition {
  id: string;
  title: string;
  categories: string[];
  submissionDeadline: string;
  prizes: string[];
  entryCount: number;
}

interface SeasonalContentProps {
  currentSeason?: Season;
  events?: SeasonalEventData[];
  challenges?: MonthlyChallenge[];
  competitions?: AnnualCompetition[];
  onJoinChallenge?: (id: string) => void;
}

// ── Seed Data ──────────────────────────────────────────────────────

const SEASON_CONFIG: Record<Season, { icon: string; color: string; weather: string }> = {
  spring: { icon: '🌸', color: 'text-pink-400', weather: 'Mild temps, occasional rain. Drainage systems tested.' },
  summer: { icon: '☀️', color: 'text-yellow-400', weather: 'Hot days, thermal expansion stress on structures.' },
  fall: { icon: '🍂', color: 'text-orange-400', weather: 'Cooling temps, crisp winds off the river.' },
  winter: { icon: '❄️', color: 'text-blue-300', weather: 'Snow accumulation tests roof loads. Freeze-thaw cycles.' },
};

const SEED_EVENTS: SeasonalEventData[] = [
  { id: 'evt-spring-fest', name: 'Spring Engineering Festival', season: 'spring', startDate: '2026-03-20', endDate: '2026-04-10', description: 'Celebrate new builds with bonus citation rates.', type: 'festival' },
  { id: 'evt-summer-comp', name: 'Summer Bridge Challenge', season: 'summer', startDate: '2026-06-15', endDate: '2026-07-15', description: 'Design bridges that survive extreme heat expansion.', type: 'competition' },
  { id: 'evt-fall-harvest', name: 'Fall Harvest Market', season: 'fall', startDate: '2026-10-01', endDate: '2026-10-31', description: 'Special marketplace rates and rare material drops.', type: 'holiday' },
  { id: 'evt-winter-stress', name: 'Winter Stress Test Derby', season: 'winter', startDate: '2026-12-20', endDate: '2027-01-05', description: 'Buildings tested under blizzard + earthquake simultaneously.', type: 'challenge' },
];

const SEED_CHALLENGE: MonthlyChallenge = {
  id: 'mc-apr-2026', title: 'Bridge Builder Challenge', description: 'Design a pedestrian bridge rated for 200+ occupants',
  objective: 'Build and validate a pedestrian bridge', progress: 0, maxProgress: 1,
  reward: { type: 'title', value: 'Bridge Master' }, leaderboardId: 'lb-bridge-apr',
};

const SEED_COMPETITION: AnnualCompetition = {
  id: 'ac-2026', title: '2026 Concordia Grand Design Awards',
  categories: ['Best Residential', 'Best Infrastructure', 'Most Innovative Material Use', 'Strongest Structure', 'Best Fantasy World'],
  submissionDeadline: '2026-11-30', prizes: ['1000 Concord Coin', '500 Concord Coin', '250 Concord Coin'], entryCount: 347,
};

// ── Component ──────────────────────────────────────────────────────

export default function SeasonalContent({
  currentSeason = 'spring',
  events = SEED_EVENTS,
  challenges = [SEED_CHALLENGE],
  competitions = [SEED_COMPETITION],
  onJoinChallenge,
}: SeasonalContentProps) {
  const [selectedTab, setSelectedTab] = useState<'events' | 'challenges' | 'competitions'>('events');

  const seasonInfo = SEASON_CONFIG[currentSeason];
  const seasonEvents = useMemo(() => events.filter(e => e.season === currentSeason), [events, currentSeason]);
  const activeEvent = seasonEvents[0];

  const getTimeRemaining = (endDate: string) => {
    const ms = new Date(endDate).getTime() - Date.now();
    if (ms <= 0) return 'Ended';
    const days = Math.floor(ms / 86400000);
    const hours = Math.floor((ms % 86400000) / 3600000);
    return `${days}d ${hours}h remaining`;
  };

  return (
    <div className="bg-black/80 backdrop-blur-sm border border-white/10 rounded-lg p-4 space-y-4">
      {/* Current Season */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-3xl">{seasonInfo.icon}</span>
          <div>
            <h3 className={`text-lg font-bold capitalize ${seasonInfo.color}`}>{currentSeason}</h3>
            <p className="text-xs text-white/50">{seasonInfo.weather}</p>
          </div>
        </div>
      </div>

      {/* Active Event Banner */}
      {activeEvent && (
        <div className="bg-gradient-to-r from-purple-900/50 to-blue-900/50 border border-purple-500/30 rounded-lg p-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-purple-300 uppercase tracking-wider">Active Event</p>
              <h4 className="text-white font-bold">{activeEvent.name}</h4>
              <p className="text-xs text-white/60 mt-1">{activeEvent.description}</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-yellow-400">{getTimeRemaining(activeEvent.endDate)}</p>
            </div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2">
        {(['events', 'challenges', 'competitions'] as const).map(tab => (
          <button key={tab} onClick={() => setSelectedTab(tab)}
            className={`px-3 py-1 rounded text-xs capitalize ${selectedTab === tab ? 'bg-white/20 text-white' : 'text-white/50 hover:text-white/70'}`}
          >{tab}</button>
        ))}
      </div>

      {/* Tab Content */}
      {selectedTab === 'events' && (
        <div className="space-y-2">
          {events.map(evt => (
            <div key={evt.id} className="flex items-center justify-between p-2 bg-white/5 rounded">
              <div>
                <p className="text-sm text-white">{evt.name}</p>
                <p className="text-xs text-white/40">{evt.startDate} — {evt.endDate}</p>
              </div>
              <span className={`text-xs px-2 py-0.5 rounded ${
                evt.type === 'festival' ? 'bg-pink-500/20 text-pink-300' :
                evt.type === 'competition' ? 'bg-blue-500/20 text-blue-300' :
                evt.type === 'challenge' ? 'bg-orange-500/20 text-orange-300' :
                'bg-green-500/20 text-green-300'
              }`}>{evt.type}</span>
            </div>
          ))}
        </div>
      )}

      {selectedTab === 'challenges' && (
        <div className="space-y-3">
          {challenges.map(ch => (
            <div key={ch.id} className="p-3 bg-white/5 rounded-lg">
              <h4 className="text-white font-semibold">{ch.title}</h4>
              <p className="text-xs text-white/50 mt-1">{ch.description}</p>
              <div className="mt-2">
                <div className="flex justify-between text-xs text-white/60 mb-1">
                  <span>Progress</span>
                  <span>{ch.progress}/{ch.maxProgress}</span>
                </div>
                <div className="h-2 bg-white/10 rounded-full">
                  <div className="h-full bg-blue-500 rounded-full transition-all" style={{ width: `${(ch.progress / ch.maxProgress) * 100}%` }} />
                </div>
              </div>
              <div className="flex items-center justify-between mt-2">
                <span className="text-xs text-yellow-400">Reward: {ch.reward.value}</span>
                <button onClick={() => onJoinChallenge?.(ch.id)} className="px-3 py-1 bg-blue-600 hover:bg-blue-500 text-xs text-white rounded">Join</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {selectedTab === 'competitions' && (
        <div className="space-y-3">
          {competitions.map(comp => (
            <div key={comp.id} className="p-3 bg-white/5 rounded-lg">
              <h4 className="text-white font-semibold">{comp.title}</h4>
              <p className="text-xs text-white/40 mt-1">Deadline: {comp.submissionDeadline}</p>
              <p className="text-xs text-white/60 mt-1">{comp.entryCount} entries so far</p>
              <div className="mt-2 flex flex-wrap gap-1">
                {comp.categories.map(cat => (
                  <span key={cat} className="text-xs px-2 py-0.5 bg-white/10 rounded text-white/70">{cat}</span>
                ))}
              </div>
              <div className="mt-2 space-y-1">
                {comp.prizes.map((prize, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    <span className={i === 0 ? 'text-yellow-400' : i === 1 ? 'text-gray-300' : 'text-orange-400'}>{['🥇', '🥈', '🥉'][i]}</span>
                    <span className="text-white/70">{prize}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
